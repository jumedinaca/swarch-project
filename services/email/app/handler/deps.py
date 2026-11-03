from collections.abc import AsyncIterator

from fastapi import Depends, FastAPI, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.repository.email_repository import EmailRepository
from app.service.email_service import EmailService


async def get_db_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.session_factory() as session:
        yield session


def build_email_service(app: FastAPI, session: AsyncSession) -> EmailService:
    return EmailService(
        settings=app.state.settings,
        repo=EmailRepository(session),
        renderer=app.state.template_renderer,
        smtp=app.state.smtp_client,
        global_limiter=app.state.global_limiter,
        publisher=app.state.event_publisher,
        dispatcher=app.state.job_dispatcher,
    )


def get_email_service(
    request: Request,
    session: AsyncSession = Depends(get_db_session),
) -> EmailService:
    return build_email_service(request.app, session)
