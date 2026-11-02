import asyncio
import logging
import re
import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.colors import default_color
from app.core.config import Settings
from app.core.ratelimit import UploadRateLimiter
from app.core.security import TokenClaims
from app.domain.models import Profile, utcnow
from app.messaging.events import ProfileUpdatedEvent, ProfileUpdatedPayload
from app.messaging.publisher import ProfileEventPublisher
from app.repository.profile_repository import ProfileRepository
from app.schema.profile_schema import ProfileUpdate
from app.service.images import ImageRejected, process_avatar
from app.storage.avatar_storage import AvatarStorage

logger = logging.getLogger(__name__)

AVATAR_CONTENT_TYPE = "image/webp"
# Solo se sirven claves con la forma que genera este servicio.
AVATAR_KEY_PATTERN = re.compile(r"^avatars/[0-9a-f-]{36}/[0-9a-f]{32}\.webp$")
USERNAME_MAX_LENGTH = 50


class ProfileError(Exception):
    def __init__(self, status_code: int, code: str, message: str, headers: dict[str, str] | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = headers


def _not_found() -> ProfileError:
    return ProfileError(404, "profile_not_found", "El perfil no existe.")


def _storage_unavailable() -> ProfileError:
    return ProfileError(503, "storage_unavailable", "El almacenamiento de avatares no está disponible.")


class ProfileService:
    def __init__(
        self,
        db: AsyncSession,
        settings: Settings,
        storage: AvatarStorage | None,
        publisher: ProfileEventPublisher | None,
        upload_limiter: UploadRateLimiter,
    ):
        self.db = db
        self.settings = settings
        self.storage = storage
        self.publisher = publisher
        self.upload_limiter = upload_limiter
        self.profiles = ProfileRepository(db)

    # ==========================================
    # Lectura
    # ==========================================

    async def get_me(self, claims: TokenClaims) -> Profile:
        # Perezoso: el evento user.registered.v1 puede no haber llegado aún.
        return await self._get_or_create(claims.user_id, claims.username)

    async def get(self, user_id: uuid.UUID) -> Profile:
        profile = await self.profiles.get(user_id)
        if profile is None:
            raise _not_found()
        return profile

    async def get_batch(self, user_ids: list[uuid.UUID]) -> list[Profile]:
        found = {p.user_id: p for p in await self.profiles.get_many(user_ids)}
        # Mismo orden que la petición; los inexistentes se omiten.
        return [found[i] for i in user_ids if i in found]

    async def search(self, query: str, limit: int) -> list[Profile]:
        return await self.profiles.search(query, limit)

    # ==========================================
    # Edición del perfil propio
    # ==========================================

    async def update_me(self, claims: TokenClaims, changes: ProfileUpdate) -> Profile:
        profile = await self._get_or_create(claims.user_id, claims.username)
        sent = changes.model_fields_set
        changed: list[str] = []

        if "display_name" in sent and changes.display_name != profile.display_name:
            profile.display_name = changes.display_name
            changed.append("displayName")
        if "about" in sent and changes.about != profile.about:
            profile.about = changes.about
            changed.append("about")
        if "color" in sent:
            color = changes.color or default_color(profile.user_id)
            if color != profile.color:
                profile.color = color
                changed.append("color")

        if changed:
            profile.updated_at = utcnow()
            await self.db.commit()
            await self._publish_updated(profile, changed)
        return profile

    # ==========================================
    # Avatar
    # ==========================================

    async def upload_avatar(self, claims: TokenClaims, data: bytes) -> Profile:
        storage = self._require_storage()
        if len(data) > self.settings.avatar_max_bytes:
            limit_mb = self.settings.avatar_max_bytes // (1024 * 1024)
            raise ProfileError(413, "avatar_too_large", f"La imagen no puede superar {limit_mb} MB.")
        if not data:
            raise ProfileError(422, "invalid_image", "El archivo está vacío.")

        retry_after = self.upload_limiter.try_acquire(claims.user_id)
        if retry_after is not None:
            raise ProfileError(
                429,
                "rate_limited",
                "Alcanzaste el límite de subidas de avatar. Intenta más tarde.",
                headers={"Retry-After": str(retry_after)},
            )

        try:
            webp = await asyncio.to_thread(process_avatar, data)
        except ImageRejected as exc:
            raise ProfileError(exc.status_code, exc.code, exc.message) from exc

        profile = await self._get_or_create(claims.user_id, claims.username)
        key = f"avatars/{profile.user_id}/{uuid.uuid4().hex}.webp"
        try:
            await storage.put(key, webp, AVATAR_CONTENT_TYPE)
        except Exception as exc:
            logger.exception("No se pudo guardar el avatar (userId=%s).", profile.user_id)
            raise _storage_unavailable() from exc

        previous_key = profile.avatar_key
        profile.avatar_key = key
        profile.avatar_url = self.settings.avatar_url_for(key)
        profile.updated_at = utcnow()
        try:
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            await self._delete_object_quietly(key)
            raise

        # El anterior solo se borra cuando el nuevo ya quedó confirmado.
        if previous_key and previous_key != key:
            await self._delete_object_quietly(previous_key)
        await self._publish_updated(profile, ["avatarUrl"])
        return profile

    async def delete_avatar(self, claims: TokenClaims) -> None:
        profile = await self.profiles.get(claims.user_id)
        if profile is None or profile.avatar_key is None:
            return
        self._require_storage()

        key = profile.avatar_key
        profile.avatar_key = None
        profile.avatar_url = None
        profile.updated_at = utcnow()
        await self.db.commit()
        await self._delete_object_quietly(key)
        await self._publish_updated(profile, ["avatarUrl"])

    async def open_avatar(self, key: str) -> bytes:
        if not AVATAR_KEY_PATTERN.fullmatch(key):
            raise ProfileError(404, "avatar_not_found", "El avatar no existe.")
        storage = self._require_storage()
        try:
            data = await storage.get(key)
        except Exception as exc:
            logger.exception("No se pudo leer el avatar %s.", key)
            raise _storage_unavailable() from exc
        if data is None:
            raise ProfileError(404, "avatar_not_found", "El avatar no existe.")
        return data

    # ==========================================
    # Eventos de identidad (consumidos desde auth)
    # ==========================================

    async def on_user_registered(self, user_id: uuid.UUID, username: str) -> None:
        profile = await self._get_or_create(user_id, username)
        # Si el perfil se creó antes de forma perezosa, el evento trae el username real.
        await self._sync_username(profile, username)

    async def on_user_updated(self, user_id: uuid.UUID, username: str) -> None:
        profile = await self._get_or_create(user_id, username)
        await self._sync_username(profile, username)

    async def on_user_deleted(self, user_id: uuid.UUID) -> None:
        profile = await self.profiles.get(user_id)
        if profile is None:
            return
        key = profile.avatar_key
        await self.profiles.delete(profile)
        await self.db.commit()
        if key:
            await self._delete_object_quietly(key)

    # ==========================================
    # Internos
    # ==========================================

    async def _get_or_create(self, user_id: uuid.UUID, username: str | None) -> Profile:
        profile = await self.profiles.get(user_id)
        if profile is not None:
            return profile

        # Los tokens de desarrollo no traen username: se usa uno provisional que
        # se corrige al llegar user.registered.v1.
        name = (username or f"user-{user_id.hex[:8]}")[:USERNAME_MAX_LENGTH]
        now = utcnow()
        profile = Profile(
            user_id=user_id,
            username=name,
            display_name=name,
            color=default_color(user_id),
            created_at=now,
            updated_at=now,
        )
        self.profiles.add(profile)
        try:
            await self.db.commit()
        except IntegrityError:
            # Otra petición o el consumidor lo crearon al mismo tiempo.
            await self.db.rollback()
            profile = await self.profiles.get(user_id)
            if profile is None:
                raise
        return profile

    async def _sync_username(self, profile: Profile, username: str) -> None:
        username = username[:USERNAME_MAX_LENGTH]
        if profile.username == username:
            return
        # displayName nace como copia del username; si el usuario nunca lo
        # personalizó, se mantiene sincronizado.
        if profile.display_name == profile.username:
            profile.display_name = username
        profile.username = username
        profile.updated_at = utcnow()
        await self.db.commit()

    def _require_storage(self) -> AvatarStorage:
        if self.storage is None:
            raise _storage_unavailable()
        return self.storage

    async def _delete_object_quietly(self, key: str) -> None:
        if self.storage is None:
            return
        try:
            await self.storage.delete(key)
        except Exception:
            # Queda un objeto huérfano en el bucket, pero el perfil ya es consistente.
            logger.exception("No se pudo borrar el avatar %s.", key)

    async def _publish_updated(self, profile: Profile, changed: list[str]) -> None:
        if self.publisher is None:
            return
        event = ProfileUpdatedEvent(
            payload=ProfileUpdatedPayload(
                user_id=profile.user_id,
                changed_fields=changed,
                display_name=profile.display_name,
                avatar_url=profile.avatar_url,
                color=profile.color,
                updated_at=profile.updated_at,
            )
        )
        try:
            await self.publisher.publish(event)
        except Exception:
            # Igual que auth: el cambio ya está guardado y no se revierte por el broker.
            logger.exception("No se pudo publicar profile.updated.v1 (userId=%s).", profile.user_id)
