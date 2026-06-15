from sqlalchemy import Column, String, DateTime, ForeignKey, Text, JSON, Integer, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base
import uuid, datetime

Base = declarative_base()


def utcnow():
    return datetime.datetime.now(datetime.timezone.utc)


class User(Base):
    __tablename__ = "users"

    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email          = Column(String, unique=True, nullable=False, index=True)

    # Senha. Nula quando o usuário só usa login social (Google).
    password_hash  = Column(String, nullable=True)

    # Dados de perfil
    full_name      = Column(String)
    preferred_name = Column(String)
    organization   = Column(String)
    city           = Column(String)
    state          = Column(String)
    profession     = Column(String)      # Advogado | Médico | Professor | Outro
    sub_area_id    = Column(String)
    custom_desc    = Column(Text)

    # ── Autenticação social ─────────────────────────────────────────────
    google_sub     = Column(String, unique=True, nullable=True, index=True)
    avatar_url     = Column(String, nullable=True)

    # ── Verificação de e-mail ───────────────────────────────────────────
    email_verified = Column(Boolean, default=False, nullable=False)

    # ── Two-Factor Authentication (TOTP) ────────────────────────────────
    totp_secret      = Column(String, nullable=True)   # secret base32, só existe após setup
    totp_enabled     = Column(Boolean, default=False, nullable=False)
    totp_recovery_codes = Column(JSON, default=list)    # hashes dos códigos de recuperação

    # ── Segurança / auditoria ───────────────────────────────────────────
    failed_login_attempts = Column(Integer, default=0, nullable=False)
    locked_until           = Column(DateTime, nullable=True)
    last_login_at          = Column(DateTime, nullable=True)

    # ── Onboarding ───────────────────────────────────────────────────────
    onboarding_completed = Column(Boolean, default=False, nullable=False)

    created_at     = Column(DateTime, default=utcnow)
    updated_at     = Column(DateTime, default=utcnow, onupdate=utcnow)


class RefreshToken(Base):
    """
    Permite revogar sessões individualmente (logout real) e fazer rotação
    de refresh tokens. Cada linha representa uma sessão ativa/expirada.
    """
    __tablename__ = "refresh_tokens"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id     = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    token_hash  = Column(String, nullable=False, unique=True, index=True)
    user_agent  = Column(String, nullable=True)
    ip_address  = Column(String, nullable=True)
    revoked     = Column(Boolean, default=False, nullable=False)
    expires_at  = Column(DateTime, nullable=False)
    created_at  = Column(DateTime, default=utcnow)


class Collection(Base):
    __tablename__ = "collections"
    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id        = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    name           = Column(String, nullable=False)   # chave no Qdrant
    profession     = Column(String)
    sub_area       = Column(String)
    state          = Column(String)
    meta           = Column(JSON, default={})
    created_at     = Column(DateTime, default=utcnow)


class Document(Base):
    __tablename__ = "documents"
    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    collection_id  = Column(UUID(as_uuid=True), ForeignKey("collections.id"))
    filename       = Column(String)
    source_type    = Column(String)   # "upload" | "auto_index" | "scrape"
    source_url     = Column(String)
    chunks_count   = Column(Integer, default=0)
    indexed_at     = Column(DateTime, default=utcnow)