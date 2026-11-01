import uuid

from fastapi import APIRouter, Depends, status

from app.handler.deps import CurrentAuth, get_auth_service, get_client_info, get_current_auth
from app.schema.auth_schema import (
    AuthData,
    ChangePasswordRequest,
    Envelope,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    SessionOut,
    UserOut,
)
from app.service.auth_service import AuthService, ClientInfo, IssuedTokens

router = APIRouter(prefix="/auth", tags=["auth"])


def to_auth_data(tokens: IssuedTokens) -> AuthData:
    return AuthData(
        user=UserOut.model_validate(tokens.user),
        token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        expires_in=tokens.expires_in,
    )


# ==========================================
# Públicos
# ==========================================

@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=Envelope[AuthData])
async def register(
    body: RegisterRequest,
    service: AuthService = Depends(get_auth_service),
    client: ClientInfo = Depends(get_client_info),
):
    tokens = await service.register(body.username, body.email, body.password, client)
    return Envelope(data=to_auth_data(tokens), message="Usuario registrado correctamente.")


@router.post("/login", response_model=Envelope[AuthData])
async def login(
    body: LoginRequest,
    service: AuthService = Depends(get_auth_service),
    client: ClientInfo = Depends(get_client_info),
):
    tokens = await service.login(body.username_or_email, body.password, client)
    return Envelope(data=to_auth_data(tokens))


@router.post("/refresh", response_model=Envelope[AuthData])
async def refresh(body: RefreshRequest, service: AuthService = Depends(get_auth_service)):
    tokens = await service.refresh(body.refresh_token)
    return Envelope(data=to_auth_data(tokens))


# ==========================================
# Autenticados
# ==========================================

@router.get("/profile", response_model=Envelope[UserOut])
async def get_profile(auth: CurrentAuth = Depends(get_current_auth)):
    return Envelope(data=UserOut.model_validate(auth.user))


@router.put("/password", response_model=Envelope[None])
async def change_password(
    body: ChangePasswordRequest,
    auth: CurrentAuth = Depends(get_current_auth),
    service: AuthService = Depends(get_auth_service),
):
    await service.change_password(auth.user, auth.session, body.current_password, body.new_password)
    return Envelope(message="Contraseña actualizada. Se cerraron las demás sesiones.")


@router.post("/logout", response_model=Envelope[None])
async def logout(
    auth: CurrentAuth = Depends(get_current_auth),
    service: AuthService = Depends(get_auth_service),
):
    await service.logout(auth.session)
    return Envelope(message="Sesión cerrada.")


@router.post("/logout-all", response_model=Envelope[None])
async def logout_all(
    auth: CurrentAuth = Depends(get_current_auth),
    service: AuthService = Depends(get_auth_service),
):
    count = await service.logout_all(auth.user)
    return Envelope(message=f"Se cerraron {count} sesiones.")


@router.get("/sessions", response_model=Envelope[list[SessionOut]])
async def list_sessions(
    auth: CurrentAuth = Depends(get_current_auth),
    service: AuthService = Depends(get_auth_service),
):
    sessions = await service.list_sessions(auth.user)
    data = [
        SessionOut.model_validate(s).model_copy(update={"current": s.id == auth.session.id})
        for s in sessions
    ]
    return Envelope(data=data)


@router.delete("/sessions/{session_id}", response_model=Envelope[None])
async def revoke_session(
    session_id: uuid.UUID,
    auth: CurrentAuth = Depends(get_current_auth),
    service: AuthService = Depends(get_auth_service),
):
    await service.revoke_session(auth.user, session_id)
    return Envelope(message="Sesión revocada.")
