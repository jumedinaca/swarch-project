import uuid

from fastapi import APIRouter, Depends, status

from app.core.security import require_internal_token
from app.handler.deps import get_email_service
from app.schema.email_schema import EmailQueuedOut, EmailStatusOut, InternalEmailCreateRequest
from app.service.email_service import EmailService

router = APIRouter(
    prefix="/internal/emails",
    tags=["internal-emails"],
    dependencies=[Depends(require_internal_token)],
)


@router.post("", response_model=EmailQueuedOut, status_code=status.HTTP_202_ACCEPTED)
async def enqueue_email(
    payload: InternalEmailCreateRequest,
    service: EmailService = Depends(get_email_service),
) -> EmailQueuedOut:
    return await service.enqueue_internal_email(payload)


@router.get("/{id}", response_model=EmailStatusOut, status_code=status.HTTP_200_OK)
async def get_email_status(
    id: uuid.UUID,
    service: EmailService = Depends(get_email_service),
) -> EmailStatusOut:
    return await service.get_email_status(id)
