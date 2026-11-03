import secrets
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.schema.moderation_schema import DecisionResponse, ModerateRequest
from app.service.moderation_service import ModerationRequest, ModerationService

router = APIRouter(prefix="/internal", tags=["internal"])


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.session_factory() as session:
        yield session


def build_moderation_service(app, db: AsyncSession) -> ModerationService:
    """Lo usan las rutas HTTP y el consumidor de eventos."""
    return ModerationService(
        db,
        app.state.settings,
        app.state.rules,
        app.state.classifier,
        app.state.moderation_event_publisher,
    )


def get_moderation_service(request: Request, db: AsyncSession = Depends(get_db)) -> ModerationService:
    return build_moderation_service(request.app, db)


def require_internal_token(request: Request, x_internal_token: str | None = Header(default=None)) -> None:
    expected = request.app.state.settings.internal_token
    if x_internal_token is None or not secrets.compare_digest(x_internal_token, expected):
        raise HTTPException(401, "Falta o no es válido el encabezado X-Internal-Token.")


@router.post("/moderate", response_model=DecisionResponse, dependencies=[Depends(require_internal_token)])
async def moderate(body: ModerateRequest, service: ModerationService = Depends(get_moderation_service)):
    """Decisión directa para pruebas o pre-check: no guarda ni publica nada."""
    result = await service.evaluate(
        ModerationRequest(
            message_id=body.message_id,
            author_id=body.author_id,
            content=body.content,
            message_version=body.message_version,
        )
    )
    return DecisionResponse(message_id=body.message_id, message_version=body.message_version, **vars(result))


@router.get(
    "/decisions/{message_id}", response_model=DecisionResponse, dependencies=[Depends(require_internal_token)]
)
async def latest_decision(message_id: uuid.UUID, service: ModerationService = Depends(get_moderation_service)):
    record = await service.get_latest(message_id)
    if record is None:
        raise HTTPException(404, "No hay decisiones para ese mensaje.")
    return DecisionResponse.model_validate(record).model_copy(update={"decided_at": record.created_at})
