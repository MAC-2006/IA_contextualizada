from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session as SQLASession
import os

from models import Base

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://admin:password123@localhost:5432/knowledge_engine",
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def init_db() -> None:
    """
    Cria as tabelas que ainda não existem.

    NOTA: Em um ambiente de produção real, use uma ferramenta de migração
    (ex: Alembic) em vez de create_all — isso permite alterar colunas em
    tabelas que já têm dados sem perder informação. create_all só CRIA
    tabelas novas, nunca altera as existentes.
    """
    Base.metadata.create_all(bind=engine)


def get_db():
    """Dependency do FastAPI: fornece uma sessão de banco por requisição."""
    db: SQLASession = SessionLocal()
    try:
        yield db
    finally:
        db.close()