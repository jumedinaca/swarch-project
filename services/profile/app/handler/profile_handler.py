import uuid

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile, status
from fastapi.exceptions import RequestValidationError

from app.core.security import TokenClaims
from app.handler.deps import get_claims, get_profile_service
from app.schema.profile_schema import AvatarOut, ProfileOut, ProfileUpdate
from app.service.profile_service import AVATAR_CONTENT_TYPE, ProfileService

router = APIRouter(prefix="/profiles", tags=["profiles"])

BATCH_MAX_IDS = 100
AVATAR_CACHE_CONTROL = "public, max-age=31536000, immutable"


def parse_ids(raw: str) -> list[uuid.UUID]:
    ids: list[uuid.UUID] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            value = uuid.UUID(part)
        except ValueError:
            raise RequestValidationError(
                [{"type": "uuid_parsing", "loc": ("query", "ids"), "msg": f"'{part}' no es un UUID"}]
            ) from None
        if value not in ids:
            ids.append(value)
    if not 1 <= len(ids) <= BATCH_MAX_IDS:
        raise RequestValidationError(
            [{"type": "too_long", "loc": ("query", "ids"), "msg": f"Se aceptan entre 1 y {BATCH_MAX_IDS} ids"}]
        )
    return ids


# ==========================================
# Perfil propio
# ==========================================

@router.get("/me", response_model=ProfileOut)
async def get_me(
    claims: TokenClaims = Depends(get_claims),
    service: ProfileService = Depends(get_profile_service),
):
    return await service.get_me(claims)


@router.patch("/me", response_model=ProfileOut)
async def update_me(
    body: ProfileUpdate,
    claims: TokenClaims = Depends(get_claims),
    service: ProfileService = Depends(get_profile_service),
):
    return await service.update_me(claims, body)


@router.post("/me/avatar", response_model=AvatarOut)
async def upload_avatar(
    request: Request,
    file: UploadFile = File(...),
    claims: TokenClaims = Depends(get_claims),
    service: ProfileService = Depends(get_profile_service),
):
    # Se lee un byte de más para detectar archivos por encima del límite.
    data = await file.read(request.app.state.settings.avatar_max_bytes + 1)
    profile = await service.upload_avatar(claims, data)
    return AvatarOut(avatar_url=profile.avatar_url)


@router.delete("/me/avatar", status_code=status.HTTP_204_NO_CONTENT)
async def delete_avatar(
    claims: TokenClaims = Depends(get_claims),
    service: ProfileService = Depends(get_profile_service),
):
    await service.delete_avatar(claims)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ==========================================
# Perfiles de otros usuarios
# Las rutas fijas van antes de /{user_id} para que no se interpreten como un id.
# ==========================================

@router.get("/batch", response_model=list[ProfileOut])
async def get_batch(
    ids: str = Query(..., description="UUIDs separados por coma (máximo 100)"),
    _: TokenClaims = Depends(get_claims),
    service: ProfileService = Depends(get_profile_service),
):
    return await service.get_batch(parse_ids(ids))


@router.get("/search", response_model=list[ProfileOut])
async def search(
    q: str = Query(..., min_length=1, max_length=50),
    limit: int = Query(20, ge=1, le=50),
    _: TokenClaims = Depends(get_claims),
    service: ProfileService = Depends(get_profile_service),
):
    query = q.strip()
    if not query:
        raise RequestValidationError([{"type": "string_too_short", "loc": ("query", "q"), "msg": "vacío"}])
    return await service.search(query, limit)


@router.get("/avatars/{key:path}")
async def get_avatar(key: str, service: ProfileService = Depends(get_profile_service)):
    # Pública: las etiquetas <img> no pueden enviar el JWT. La clave incluye un
    # UUID aleatorio, así que cada versión del avatar tiene su propia URL inmutable.
    data = await service.open_avatar(key)
    return Response(
        content=data,
        media_type=AVATAR_CONTENT_TYPE,
        headers={"Cache-Control": AVATAR_CACHE_CONTROL, "X-Content-Type-Options": "nosniff"},
    )


@router.get("/{user_id}", response_model=ProfileOut)
async def get_profile(
    user_id: uuid.UUID,
    _: TokenClaims = Depends(get_claims),
    service: ProfileService = Depends(get_profile_service),
):
    return await service.get(user_id)
