import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.config import Settings
from app.domain.models import Session, User
from app.repository.auth_repository import SessionRepository, UserRepository


class AuthError(Exception):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def invalid_credentials() -> AuthError:
    return AuthError(401, "invalid_credentials", "Usuario o contraseña incorrectos.")


def invalid_token() -> AuthError:
    return AuthError(401, "invalid_token", "Sesión inválida. Inicia sesión de nuevo.")


@dataclass
class IssuedTokens:
    user: User
    access_token: str
    refresh_token: str
    expires_in: int


@dataclass
class ClientInfo:
    user_agent: str | None = None
    ip_address: str | None = None


def as_utc(value: datetime | None) -> datetime | None:
    """SQLite (tests) devuelve fechas sin zona horaria; PostgreSQL las devuelve en UTC."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


class AuthService:
    def __init__(self, db: AsyncSession, settings: Settings):
        self.db = db
        self.settings = settings
        self.users = UserRepository(db)
        self.sessions = SessionRepository(db)

    # ==========================================
    # Registro y login
    # ==========================================

    async def register(
        self, username: str, email: str, password: str, client: ClientInfo
    ) -> IssuedTokens:
        username = username.strip()
        email = email.strip().lower()

        if await self.users.username_exists(username):
            raise AuthError(409, "username_taken", "El nombre de usuario ya está en uso.")
        if await self.users.email_exists(email):
            raise AuthError(409, "email_taken", "El correo electrónico ya está registrado.")

        palette = self.settings.avatar_color_list
        user = User(
            id=uuid.uuid4(),
            username=username,
            email=email,
            password_hash=security.hash_password(password),
            color=palette[await self.users.count() % len(palette)],
            last_login_at=security.utcnow(),
        )
        self.users.add(user)
        try:
            await self.db.flush()
        except IntegrityError as exc:
            # Dos registros simultáneos con el mismo usuario/correo
            await self.db.rollback()
            raise AuthError(409, "user_exists", "El usuario o correo ya está registrado.") from exc

        tokens = self._start_session(user, client)
        await self.db.commit()
        return tokens

    async def login(self, identifier: str, password: str, client: ClientInfo) -> IssuedTokens:
        now = security.utcnow()
        user = await self.users.get_by_username_or_email(identifier)

        if user is None:
            security.verify_password(None, password)  # tiempo constante
            raise invalid_credentials()

        locked_until = as_utc(user.locked_until)
        if locked_until and locked_until > now:
            minutes = math.ceil((locked_until - now).total_seconds() / 60)
            raise AuthError(
                423,
                "account_locked",
                f"Cuenta bloqueada temporalmente por intentos fallidos. Intenta de nuevo en {minutes} min.",
            )

        if not security.verify_password(user.password_hash, password):
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= self.settings.max_failed_login_attempts:
                user.locked_until = now + timedelta(minutes=self.settings.lockout_minutes)
                user.failed_login_attempts = 0
            await self.db.commit()
            raise invalid_credentials()

        if not user.is_active:
            raise AuthError(403, "user_inactive", "La cuenta está desactivada.")

        user.failed_login_attempts = 0
        user.locked_until = None
        user.last_login_at = now
        if security.password_needs_rehash(user.password_hash):
            user.password_hash = security.hash_password(password)

        tokens = self._start_session(user, client)
        await self.db.commit()
        return tokens

    # ==========================================
    # Tokens
    # ==========================================

    async def refresh(self, refresh_token: str) -> IssuedTokens:
        now = security.utcnow()
        try:
            session_id, secret = security.parse_refresh_token(refresh_token)
        except security.InvalidTokenError as exc:
            raise invalid_token() from exc

        found = await self.sessions.get_with_user(session_id)
        if found is None:
            raise invalid_token()
        session, user = found

        if session.revoked_at is not None or as_utc(session.expires_at) <= now or not user.is_active:
            raise invalid_token()

        if not security.refresh_secret_matches(secret, session.refresh_token_hash):
            # Se presentó un refresh token ya rotado: posible robo. Se revoca la sesión completa.
            session.revoked_at = now
            await self.db.commit()
            raise invalid_token()

        new_refresh, new_hash = security.create_refresh_token(session.id)
        session.refresh_token_hash = new_hash
        session.last_used_at = now
        access, expires_in = security.create_access_token(
            self.settings, user.id, session.id, user.username
        )
        await self.db.commit()
        return IssuedTokens(user, access, new_refresh, expires_in)

    async def authenticate(self, access_token: str) -> tuple[User, Session, security.AccessTokenClaims]:
        """Valida firma, expiración y que la sesión siga activa (permite revocar tokens con logout)."""
        try:
            claims = security.decode_access_token(self.settings, access_token)
        except security.InvalidTokenError as exc:
            raise AuthError(401, "invalid_token", str(exc)) from exc

        found = await self.sessions.get_with_user(claims.session_id)
        if found is None:
            raise invalid_token()
        session, user = found

        if (
            session.user_id != claims.user_id
            or session.revoked_at is not None
            or as_utc(session.expires_at) <= security.utcnow()
            or not user.is_active
        ):
            raise invalid_token()
        return user, session, claims

    # ==========================================
    # Sesiones
    # ==========================================

    async def logout(self, session: Session) -> None:
        session.revoked_at = security.utcnow()
        await self.db.commit()

    async def logout_all(self, user: User) -> int:
        count = await self.sessions.revoke_all(user.id, security.utcnow())
        await self.db.commit()
        return count

    async def list_sessions(self, user: User) -> list[Session]:
        return await self.sessions.list_active(user.id, security.utcnow())

    async def revoke_session(self, user: User, session_id: uuid.UUID) -> None:
        session = await self.sessions.get(session_id)
        if session is None or session.user_id != user.id or session.revoked_at is not None:
            raise AuthError(404, "session_not_found", "Sesión no encontrada.")
        session.revoked_at = security.utcnow()
        await self.db.commit()

    # ==========================================
    # Perfil
    # ==========================================

    async def change_password(
        self, user: User, current_session: Session, current_password: str, new_password: str
    ) -> None:
        if not security.verify_password(user.password_hash, current_password):
            raise AuthError(400, "wrong_password", "La contraseña actual es incorrecta.")
        if current_password == new_password:
            raise AuthError(400, "same_password", "La nueva contraseña debe ser diferente.")

        user.password_hash = security.hash_password(new_password)
        # Cierra las demás sesiones abiertas con la contraseña anterior
        await self.sessions.revoke_all(user.id, security.utcnow(), except_session=current_session.id)
        await self.db.commit()

    async def update_profile(self, user: User, color: str | None) -> User:
        if color is not None:
            user.color = color.upper()
        await self.db.commit()
        await self.db.refresh(user)
        return user

    # ==========================================
    # Internos
    # ==========================================

    def _start_session(self, user: User, client: ClientInfo) -> IssuedTokens:
        session_id = uuid.uuid4()
        refresh, refresh_hash = security.create_refresh_token(session_id)
        self.sessions.add(
            Session(
                id=session_id,
                user_id=user.id,
                refresh_token_hash=refresh_hash,
                user_agent=(client.user_agent or "")[:255] or None,
                ip_address=client.ip_address,
                expires_at=security.utcnow() + timedelta(days=self.settings.refresh_token_expire_days),
            )
        )
        access, expires_in = security.create_access_token(
            self.settings, user.id, session_id, user.username
        )
        return IssuedTokens(user, access, refresh, expires_in)
