"""
Rotas de autenticação.

Estratégia de sessão: cookies httpOnly.
  - access_token  : vida curta (15 min), enviado em todo request, valida via dependency.
  - refresh_token : vida longa (30 dias), usado só em /auth/refresh para renovar
                    o access_token. Hash armazenado na tabela refresh_tokens,
                    permitindo revogação (logout) e detecção de reuso.

Fluxo de 2FA:
  1. Usuário com 2FA OFF faz login normal -> recebe cookies, pronto.
  2. Usuário com 2FA ON faz login -> backend NÃO emite cookies ainda;
     retorna {"requires_2fa": true, "challenge_token": "..."}.
  3. Frontend pede o código de 6 dígitos e chama /auth/2fa/login com o
     challenge_token + código. Se válido, emite os cookies normalmente.

Fluxo Google OAuth (Authorization Code, server-side):
  1. Frontend chama GET /auth/google/login -> backend redireciona para o Google.
  2. Google redireciona para GET /auth/google/callback com ?code=...
  3. Backend troca o code por tokens, busca o perfil do usuário no Google,
     cria/atualiza o User local (vinculando por google_sub ou e-mail) e
     emite os cookies de sessão, redirecionando de volta ao frontend.
"""

import datetime
import os
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session
from authlib.integrations.starlette_client import OAuth, OAuthError
from jose import JWTError

import auth
from database import get_db
from models import RefreshToken, User
import uuid  # Adicione esta linha no topo

router = APIRouter(prefix="/auth", tags=["auth"])


# ──────────────────────────────────────────────────────────────────────────
# Config de cookies
# ──────────────────────────────────────────────────────────────────────────

# Em produção (HTTPS): COOKIE_SECURE=true e ajuste COOKIE_SAMESITE se o
# frontend estiver em domínio diferente do backend (precisa de "none" + secure).
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax")  # "lax" | "strict" | "none"
COOKIE_DOMAIN = os.getenv("COOKIE_DOMAIN") or None  # None = host atual

ACCESS_COOKIE_NAME = "access_token"
REFRESH_COOKIE_NAME = "refresh_token"

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    response.set_cookie(
        key=ACCESS_COOKIE_NAME,
        value=access_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        domain=COOKIE_DOMAIN,
        max_age=auth.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        domain=COOKIE_DOMAIN,
        max_age=auth.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        # Restringe o refresh token a /auth/* — ele só é necessário no refresh/logout.
        path="/auth",
    )


def _clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE_NAME, path="/", domain=COOKIE_DOMAIN)
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/auth", domain=COOKIE_DOMAIN)


def _issue_session(db: Session, user: User, request: Request, response: Response) -> None:
    """Cria access+refresh tokens, persiste o refresh e seta os cookies."""
    access_token = auth.create_access_token(str(user.id))
    refresh_token, refresh_hash, expires_at = auth.create_refresh_token(str(user.id))

    db.add(RefreshToken(
        user_id=user.id,
        token_hash=refresh_hash,
        user_agent=request.headers.get("user-agent", "")[:255],
        ip_address=request.client.host if request.client else None,
        expires_at=expires_at,
    ))
    user.last_login_at = datetime.datetime.now(datetime.timezone.utc)
    user.failed_login_attempts = 0
    db.commit()

    _set_auth_cookies(response, access_token, refresh_token)


# ──────────────────────────────────────────────────────────────────────────
# Dependency: usuário autenticado a partir do cookie de access token
# ──────────────────────────────────────────────────────────────────────────

def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(ACCESS_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Não autenticado.")

    try:
        payload = auth.decode_token(token)
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão inválida ou expirada.")

    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido.")

    user = db.get(User, payload["sub"])
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário não encontrado.")

    return user


# ──────────────────────────────────────────────────────────────────────────
# Schemas
# ──────────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TwoFactorLoginRequest(BaseModel):
    challenge_token: str
    code: str


class TwoFactorVerifyRequest(BaseModel):
    code: str


class TwoFactorRecoveryLoginRequest(BaseModel):
    challenge_token: str
    recovery_code: str


class PasswordCheckRequest(BaseModel):
    password: str


class UserOut(BaseModel):
    id: uuid.UUID  # <--- Mude de str para uuid.UUID
    email: str
    full_name: str | None
    preferred_name: str | None
    avatar_url: str | None
    totp_enabled: bool
    email_verified: bool
    onboarding_completed: bool

    class Config:
        from_attributes = True


# ──────────────────────────────────────────────────────────────────────────
# Registro
# ──────────────────────────────────────────────────────────────────────────

@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    email = payload.email.lower().strip()

    if db.query(User).filter(User.email == email).first():
        # Mensagem genérica de propósito: não confirmamos para um atacante
        # se um e-mail já está cadastrado (evita enumeração de contas).
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Não foi possível concluir o cadastro com os dados informados.",
        )

    password_errors = auth.validate_password_strength(payload.password)
    if password_errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"message": "Senha não atende aos requisitos mínimos.", "errors": password_errors},
        )

    user = User(
        email=email,
        password_hash=auth.hash_password(payload.password),
        full_name=payload.full_name.strip(),
        preferred_name=payload.full_name.strip().split(" ")[0],
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    _issue_session(db, user, request, response)
    return user


@router.post("/check-password")
def check_password_strength(payload: PasswordCheckRequest):
    """
    Endpoint auxiliar para o frontend mostrar feedback em tempo real
    (a validação AUTORITATIVA continua sendo a do /auth/register).
    """
    errors = auth.validate_password_strength(payload.password)
    return {"valid": len(errors) == 0, "errors": errors}


# ──────────────────────────────────────────────────────────────────────────
# Login (com suporte a 2FA)
# ──────────────────────────────────────────────────────────────────────────

# Challenge tokens de 2FA: armazenados em memória, com expiração curta.
# Em produção com múltiplas instâncias do backend, troque por Redis.
_TWOFA_CHALLENGES: dict[str, dict] = {}
TWOFA_CHALLENGE_TTL_SECONDS = 5 * 60

MAX_FAILED_LOGIN_ATTEMPTS = 5
LOCKOUT_DURATION_MINUTES = 15


def _create_2fa_challenge(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    _TWOFA_CHALLENGES[token] = {
        "user_id": user_id,
        "expires_at": datetime.datetime.now(datetime.timezone.utc)
        + datetime.timedelta(seconds=TWOFA_CHALLENGE_TTL_SECONDS),
    }
    return token


def _consume_2fa_challenge(token: str) -> str | None:
    data = _TWOFA_CHALLENGES.pop(token, None)
    if not data:
        return None
    if data["expires_at"] < datetime.datetime.now(datetime.timezone.utc):
        return None
    return data["user_id"]


@router.post("/login")
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    email = payload.email.lower().strip()
    user = db.query(User).filter(User.email == email).first()

    generic_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="E-mail ou senha incorretos.",
    )

    if user is None or user.password_hash is None:
        # password_hash is None => conta criada via Google, sem senha local.
        raise generic_error

    now = datetime.datetime.now(datetime.timezone.utc)
    if user.locked_until and user.locked_until > now:
        minutes_left = max(1, int((user.locked_until - now).total_seconds() // 60))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Conta temporariamente bloqueada por excesso de tentativas. "
                   f"Tente novamente em {minutes_left} minuto(s).",
        )

    if not auth.verify_password(payload.password, user.password_hash):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= MAX_FAILED_LOGIN_ATTEMPTS:
            user.locked_until = now + datetime.timedelta(minutes=LOCKOUT_DURATION_MINUTES)
            user.failed_login_attempts = 0
        db.commit()
        raise generic_error

    # Senha correta. Se 2FA estiver ativo, não emite sessão ainda.
    if user.totp_enabled:
        challenge_token = _create_2fa_challenge(str(user.id))
        return {"requires_2fa": True, "challenge_token": challenge_token}

    _issue_session(db, user, request, response)
    return {"requires_2fa": False, "user": UserOut.model_validate(user)}


@router.post("/2fa/login")
def login_with_2fa(
    payload: TwoFactorLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    user_id = _consume_2fa_challenge(payload.challenge_token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Desafio de verificação inválido ou expirado. Faça login novamente.",
        )

    user = db.get(User, user_id)
    if user is None or not user.totp_enabled or not user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="2FA não configurado para este usuário.")

    if not auth.verify_totp_code(user.totp_secret, payload.code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Código de verificação inválido.")

    _issue_session(db, user, request, response)
    return {"user": UserOut.model_validate(user)}


@router.post("/2fa/login/recovery")
def login_with_recovery_code(
    payload: TwoFactorRecoveryLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    user_id = _consume_2fa_challenge(payload.challenge_token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Desafio de verificação inválido ou expirado. Faça login novamente.",
        )

    user = db.get(User, user_id)
    if user is None or not user.totp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="2FA não configurado para este usuário.")

    codes: list[str] = user.totp_recovery_codes or []
    target_hash = auth.hash_recovery_code(payload.recovery_code)
    remaining = [c for c in codes if c != target_hash]

    if len(remaining) == len(codes):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Código de recuperação inválido.")

    # Código de recuperação é de uso único: remove da lista.
    user.totp_recovery_codes = remaining
    db.commit()

    _issue_session(db, user, request, response)
    return {
        "user": UserOut.model_validate(user),
        "recovery_codes_remaining": len(remaining),
    }


# ──────────────────────────────────────────────────────────────────────────
# Sessão atual / refresh / logout
# ──────────────────────────────────────────────────────────────────────────

@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/refresh")
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão expirada. Faça login novamente.")

    try:
        payload = auth.decode_token(token)
    except JWTError:
        _clear_auth_cookies(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão expirada. Faça login novamente.")

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido.")

    token_hash = auth.hash_token(token)
    stored = db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).first()

    if stored is None or stored.revoked:
        # Token desconhecido ou já usado/revogado: pode ser reuso de token
        # roubado. Por segurança, revoga TODAS as sessões deste usuário.
        _clear_auth_cookies(response)
        if stored is not None:
            db.query(RefreshToken).filter(RefreshToken.user_id == stored.user_id).update({"revoked": True})
            db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão inválida. Faça login novamente.")

    now = datetime.datetime.now(datetime.timezone.utc)
    if stored.expires_at < now:
        _clear_auth_cookies(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão expirada. Faça login novamente.")

    user = db.get(User, stored.user_id)
    if user is None:
        _clear_auth_cookies(response)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuário não encontrado.")

    # Rotação: revoga o refresh token atual e emite um novo (mitiga replay).
    stored.revoked = True

    new_access = auth.create_access_token(str(user.id))
    new_refresh, new_refresh_hash, expires_at = auth.create_refresh_token(str(user.id))
    db.add(RefreshToken(
        user_id=user.id,
        token_hash=new_refresh_hash,
        user_agent=request.headers.get("user-agent", "")[:255],
        ip_address=request.client.host if request.client else None,
        expires_at=expires_at,
    ))
    db.commit()

    _set_auth_cookies(response, new_access, new_refresh)
    return {"status": "ok"}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    token = request.cookies.get(REFRESH_COOKIE_NAME)
    if token:
        token_hash = auth.hash_token(token)
        db.query(RefreshToken).filter(RefreshToken.token_hash == token_hash).update({"revoked": True})
        db.commit()

    _clear_auth_cookies(response)
    return {"status": "ok"}


@router.post("/logout/all")
def logout_all(
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revoga todas as sessões do usuário (ex: 'Sair de todos os dispositivos')."""
    db.query(RefreshToken).filter(RefreshToken.user_id == current_user.id).update({"revoked": True})
    db.commit()
    _clear_auth_cookies(response)
    return {"status": "ok"}


# ──────────────────────────────────────────────────────────────────────────
# 2FA — setup e gerenciamento (requer estar autenticado)
# ──────────────────────────────────────────────────────────────────────────

@router.post("/2fa/setup")
def setup_2fa(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    Gera um novo secret TOTP (ainda não ativado) e retorna o QR code.
    O usuário precisa confirmar com um código válido em /2fa/enable
    antes do 2FA ser de fato ativado.
    """
    if current_user.totp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="2FA já está ativado nesta conta.")

    secret = auth.generate_totp_secret()
    current_user.totp_secret = secret  # ainda não habilitado (totp_enabled=False)
    db.commit()

    uri = auth.get_totp_uri(secret, current_user.email)
    qr_base64 = auth.generate_qr_code_base64(uri)

    return {
        "secret": secret,            # permite digitação manual no app
        "qr_code_base64": qr_base64,  # <img src="data:image/png;base64,...">
        "otpauth_uri": uri,
    }


@router.post("/2fa/enable")
def enable_2fa(
    payload: TwoFactorVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Confirma o setup do 2FA validando um código gerado pelo app autenticador."""
    if current_user.totp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="2FA já está ativado.")

    if not current_user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Inicie o processo em /auth/2fa/setup primeiro.")

    if not auth.verify_totp_code(current_user.totp_secret, payload.code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Código de verificação inválido.")

    current_user.totp_enabled = True
    recovery_codes = auth.generate_recovery_codes()
    current_user.totp_recovery_codes = [auth.hash_recovery_code(c) for c in recovery_codes]
    db.commit()

    return {
        "status": "enabled",
        # Exibidos UMA ÚNICA VEZ — o frontend deve instruir o usuário a salvá-los.
        "recovery_codes": recovery_codes,
    }


class TwoFactorDisableRequest(BaseModel):
    password: str | None = None
    code: str | None = None


@router.post("/2fa/disable")
def disable_2fa(
    payload: TwoFactorDisableRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.totp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="2FA não está ativado.")

    # Exige reconfirmação (senha OU código TOTP) para desativar — evita que
    # uma sessão sequestrada desligue a proteção sem nova autenticação.
    verified = False
    if payload.code and current_user.totp_secret:
        verified = auth.verify_totp_code(current_user.totp_secret, payload.code)
    if not verified and payload.password and current_user.password_hash:
        verified = auth.verify_password(payload.password, current_user.password_hash)

    if not verified:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Confirme com sua senha ou um código do app autenticador para desativar o 2FA.",
        )

    current_user.totp_enabled = False
    current_user.totp_secret = None
    current_user.totp_recovery_codes = []
    db.commit()
    return {"status": "disabled"}


# ──────────────────────────────────────────────────────────────────────────
# Google OAuth
# ──────────────────────────────────────────────────────────────────────────
#
# Configuração necessária (variáveis de ambiente):
#   GOOGLE_CLIENT_ID
#   GOOGLE_CLIENT_SECRET
#   GOOGLE_REDIRECT_URI   (ex: http://localhost:8000/auth/google/callback)
#
# No Google Cloud Console:
#   1. APIs & Services > Credentials > Create Credentials > OAuth client ID
#   2. Tipo: "Web application"
#   3. Authorized redirect URIs: adicione exatamente o valor de
#      GOOGLE_REDIRECT_URI acima.
#   4. Configure a tela de consentimento OAuth (OAuth consent screen) com
#      pelo menos: nome do app, e-mail de suporte, escopos "openid",
#      "email", "profile".

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/google/callback")

oauth = OAuth()
if GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET:
    oauth.register(
        name="google",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )


def _google_configured() -> bool:
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)


@router.get("/google/login")
async def google_login(request: Request):
    if not _google_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Login com Google não está configurado neste ambiente.",
        )
    redirect_uri = GOOGLE_REDIRECT_URI
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/google/callback")
async def google_callback(request: Request, db: Session = Depends(get_db)):
    if not _google_configured():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Login com Google não está configurado.")

    try:
        token = await oauth.google.authorize_access_token(request)
    except OAuthError as e:
        return RedirectResponse(f"{FRONTEND_URL}/login?error=google_oauth_failed&detail={e.error}")

    userinfo = token.get("userinfo")
    if not userinfo:
        return RedirectResponse(f"{FRONTEND_URL}/login?error=google_oauth_failed")

    google_sub = userinfo["sub"]
    email = userinfo.get("email", "").lower().strip()
    email_verified = bool(userinfo.get("email_verified", False))
    name = userinfo.get("name") or email.split("@")[0]
    picture = userinfo.get("picture")

    # 1. Já existe um usuário vinculado a este google_sub?
    user = db.query(User).filter(User.google_sub == google_sub).first()

    if user is None and email:
        # 2. Existe um usuário com este e-mail (cadastrado via senha)?
        #    Só vincula automaticamente se o Google confirma o e-mail —
        #    caso contrário, alguém poderia sequestrar uma conta criando
        #    um e-mail não verificado igual ao de outra pessoa.
        existing = db.query(User).filter(User.email == email).first()
        if existing and email_verified:
            existing.google_sub = google_sub
            existing.avatar_url = existing.avatar_url or picture
            existing.email_verified = True
            user = existing
        elif existing and not email_verified:
            return RedirectResponse(f"{FRONTEND_URL}/login?error=email_in_use")

    if user is None:
        # 3. Novo usuário via Google.
        user = User(
            email=email,
            google_sub=google_sub,
            full_name=name,
            preferred_name=name.split(" ")[0],
            avatar_url=picture,
            email_verified=email_verified,
            password_hash=None,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        db.commit()

    # Usuários vinculados ao Google e com 2FA ativo ainda passam pelo
    # desafio de 2FA antes de receber os cookies de sessão.
    if user.totp_enabled:
        challenge_token = _create_2fa_challenge(str(user.id))
        return RedirectResponse(f"{FRONTEND_URL}/login?twofa_challenge={challenge_token}")

    response = RedirectResponse(f"{FRONTEND_URL}/auth/callback")
    _issue_session(db, user, request, response)
    return response