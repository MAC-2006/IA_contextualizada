from sqlalchemy import Column, String, DateTime, ForeignKey, Text, JSON, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base
import uuid, datetime

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email          = Column(String, unique=True, nullable=False)
    password_hash  = Column(String, nullable=False)
    full_name      = Column(String)
    preferred_name = Column(String)
    organization   = Column(String)
    city           = Column(String)
    state          = Column(String)
    profession     = Column(String)      # Advogado | Médico | Professor | Outro
    sub_area_id    = Column(String)
    custom_desc    = Column(Text)
    created_at     = Column(DateTime, default=datetime.datetime.utcnow)

class Collection(Base):
    __tablename__ = "collections"
    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id        = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    name           = Column(String, nullable=False)   # chave no Qdrant
    profession     = Column(String)
    sub_area       = Column(String)
    state          = Column(String)
    meta           = Column(JSON, default={})
    created_at     = Column(DateTime, default=datetime.datetime.utcnow)

class Document(Base):
    __tablename__ = "documents"
    id             = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    collection_id  = Column(UUID(as_uuid=True), ForeignKey("collections.id"))
    filename       = Column(String)
    source_type    = Column(String)   # "upload" | "auto_index" | "scrape"
    source_url     = Column(String)
    chunks_count   = Column(Integer, default=0)
    indexed_at     = Column(DateTime, default=datetime.datetime.utcnow)