"""
Funções utilitárias de autenticação:
- Hash e verificação de senha (bcrypt)
- Validação de senha forte
- Criação/decodificação de tokens JWT (access + refresh)
- TOTP (2FA): geração de secret, QR code e verificação de código
- Códigos de recuperação de 2FA
"""

import datetime
import os
import re
import secrets
import hashlib
import io
import base64

import pyotp
import qrcode
from jose import jwt, JWTError
from passlib.context import CryptContext
from dotenv import load_dotenv
load_dotenv()  # Isso carrega as variáveis do arquivo .env

# ──────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────

JWT_SECRET = os.getenv("JWT_SECRET")
if not JWT_SECRET:
    # Em produção, ISSO DEVE vir de variável de ambiente / secrets manager.
    # Gerar com: python -c "import secrets; print(secrets.token_urlsafe(64))"
    JWT_SECRET = "DEV-ONLY-CHANGE-ME-" + secrets.token_urlsafe(32)
    print(
        "[auth] AVISO: JWT_SECRET não definido. Usando chave temporária de "
        "desenvolvimento. Defina a variável de ambiente JWT_SECRET em produção."
    )

ALGORITHM = "HS256"

ACCESS_TOKEN_EXPIRE_MINUTES = 15          # access token de vida curta
REFRESH_TOKEN_EXPIRE_DAYS = 30            # refresh token de vida longa

TOTP_ISSUER = "ProMind"

pwd_ctx = CryptContext(schemes=["bcrypt"], bcrypt__rounds=12)


# ──────────────────────────────────────────────────────────────────────────
# Senhas
# ──────────────────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return pwd_ctx.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_ctx.verify(password, password_hash)


# Política de senha forte. Ajuste conforme a política da sua organização,
# mas NUNCA enfraqueça isso — toda validação de senha de cadastro DEVE
# passar por aqui, no backend, independentemente do que o frontend valida.
PASSWORD_MIN_LENGTH = 10

_PASSWORD_RULES: list[tuple[str, "re.Pattern"]] = [
    ("Pelo menos uma letra minúscula", re.compile(r"[a-z]")),
    ("Pelo menos uma letra maiúscula", re.compile(r"[A-Z]")),
    ("Pelo menos um número", re.compile(r"\d")),
    ("Pelo menos um caractere especial (!@#$%^&*...)", re.compile(r"[^A-Za-z0-9]")),
]

# Lista mínima de senhas/sequências triviais. Em produção, considere usar
# uma lista maior (ex: top 10k senhas vazadas) ou um serviço como
# "Have I Been Pwned" (k-anonimato) para checar vazamentos.
_COMMON_PASSWORDS = {
    "password", "12345678", "123456789", "qwerty123", "senha123",
    "password1", "abc12345", "admin123", "letmein123",
}


def validate_password_strength(password: str) -> list[str]:
    """
    Retorna uma lista de problemas encontrados na senha.
    Lista vazia = senha aceitável.
    """
    errors: list[str] = []

    if len(password) < PASSWORD_MIN_LENGTH:
        errors.append(f"A senha deve ter pelo menos {PASSWORD_MIN_LENGTH} caracteres.")

    for message, pattern in _PASSWORD_RULES:
        if not pattern.search(password):
            errors.append(message)

    if password.lower() in _COMMON_PASSWORDS:
        errors.append("Essa senha é muito comum. Escolha uma senha mais difícil de adivinhar.")

    # Bloqueia senhas com 4+ caracteres repetidos em sequência (ex: "aaaa", "1111")
    if re.search(r"(.)\1{3,}", password):
        errors.append("Evite repetir o mesmo caractere várias vezes em sequência.")

    return errors


def is_strong_password(password: str) -> bool:
    return len(validate_password_strength(password)) == 0


# ──────────────────────────────────────────────────────────────────────────
# JWT — Access & Refresh tokens
# ──────────────────────────────────────────────────────────────────────────

def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def create_access_token(user_id: str, extra_claims: dict | None = None) -> str:
    payload = {
        "sub": str(user_id),
        "type": "access",
        "iat": _now(),
        "exp": _now() + datetime.timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


def create_refresh_token(user_id: str) -> tuple[str, str, datetime.datetime]:
    """
    Cria um refresh token JWT e retorna (token, token_hash, expires_at).

    O token_hash é o que deve ser persistido no banco (tabela RefreshToken),
    NUNCA o token em si — assim, se o banco for comprometido, os tokens
    não podem ser reutilizados diretamente.
    """
    expires_at = _now() + datetime.timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    jti = secrets.token_urlsafe(32)  # identificador único do token

    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "jti": jti,
        "iat": _now(),
        "exp": expires_at,
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)
    token_hash = hash_token(token)
    return token, token_hash, expires_at


def hash_token(token: str) -> str:
    """Hash determinístico (SHA-256) usado para indexar tokens no banco."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def decode_token(token: str) -> dict:
    """
    Decodifica e valida um token JWT (access ou refresh).
    Lança jose.JWTError se inválido/expirado — trate isso na camada de rota.
    """
    return jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])


# ──────────────────────────────────────────────────────────────────────────
# 2FA — TOTP (compatível com Google Authenticator, Authy, 1Password, etc.)
# ──────────────────────────────────────────────────────────────────────────

def generate_totp_secret() -> str:
    """Gera um novo secret base32 para TOTP."""
    return pyotp.random_base32()


def get_totp_uri(secret: str, account_email: str) -> str:
    """URI otpauth:// usado para gerar o QR code escaneável."""
    return pyotp.totp.TOTP(secret).provisioning_uri(
        name=account_email,
        issuer_name=TOTP_ISSUER,
    )


def generate_qr_code_base64(uri: str) -> str:
    """Gera um QR code PNG (base64) a partir da URI do TOTP."""
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def verify_totp_code(secret: str, code: str) -> bool:
    """
    Verifica um código TOTP de 6 dígitos.
    valid_window=1 permite tolerância de ±30s para diferenças de relógio
    entre o dispositivo do usuário e o servidor.
    """
    code = (code or "").strip().replace(" ", "")
    if not re.fullmatch(r"\d{6}", code):
        return False
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


# ──────────────────────────────────────────────────────────────────────────
# Códigos de recuperação de 2FA
# ──────────────────────────────────────────────────────────────────────────

def generate_recovery_codes(count: int = 8) -> list[str]:
    """
    Gera códigos de recuperação no formato XXXX-XXXX (legíveis, sem
    caracteres ambíguos como 0/O e 1/I/l).
    """
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    codes = []
    for _ in range(count):
        part1 = "".join(secrets.choice(alphabet) for _ in range(4))
        part2 = "".join(secrets.choice(alphabet) for _ in range(4))
        codes.append(f"{part1}-{part2}")
    return codes


def hash_recovery_code(code: str) -> str:
    """
    Hash de um código de recuperação para armazenamento.
    Usamos SHA-256 (e não bcrypt) porque os códigos já têm alta entropia
    e precisamos comparar contra uma lista — bcrypt seria caro demais
    para N comparações. Normalizamos para maiúsculas antes do hash.
    """
    normalized = code.strip().upper().replace(" ", "")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def verify_recovery_code(code: str, hashed_codes: list[str]) -> bool:
    target = hash_recovery_code(code)
    return any(secrets.compare_digest(target, h) for h in hashed_codes)