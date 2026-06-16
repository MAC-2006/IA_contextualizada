import os
import random
import zipfile
import tempfile
from typing import Optional

from langchain_community.document_loaders import (
    PyMuPDFLoader,
    Docx2txtLoader,
    UnstructuredPowerPointLoader,
)
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
import pandas as pd

# ─── Config ───────────────────────────────────────────────────────────────────

QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", 6333))
EMBED_MODEL = "nomic-embed-text"
VECTOR_SIZE = 768
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 100

QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")
if QDRANT_API_KEY:
    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT, api_key=QDRANT_API_KEY, https=True)
else:
    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)

# ─── Embedding ────────────────────────────────────────────────────────────────

def get_embedding(text: str) -> list[float]:
    """Gera embedding via Groq (nomic-embed-text)."""
    import os
    from groq import Groq
    groq_key = os.getenv("GROQ_API_KEY")
    if groq_key:
        client = Groq(api_key=groq_key)
        response = client.embeddings.create(model=EMBED_MODEL, input=text)
        return response.data[0].embedding
    raise RuntimeError("GROQ_API_KEY não definida")


# ─── Loaders por tipo de arquivo ─────────────────────────────────────────────

def _load_pdf(path: str) -> list[Document]:
    return PyMuPDFLoader(path).load()


def _load_docx(path: str) -> list[Document]:
    return Docx2txtLoader(path).load()


def _load_pptx(path: str) -> list[Document]:
    return UnstructuredPowerPointLoader(path).load()


def _load_xlsx(path: str) -> list[Document]:
    """Lê todas as abas e converte para texto."""
    docs = []
    xls = pd.ExcelFile(path)
    for sheet in xls.sheet_names:
        df = pd.read_excel(xls, sheet_name=sheet).fillna("")
        text = f"[Planilha: {sheet}]\n{df.to_string(index=False)}"
        docs.append(Document(page_content=text, metadata={"sheet": sheet}))
    return docs


def _load_txt(path: str) -> list[Document]:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return [Document(page_content=f.read())]


def _load_file(path: str) -> list[Document]:
    """Roteador: escolhe o loader certo pela extensão."""
    ext = os.path.splitext(path)[1].lower()
    loaders = {
        ".pdf": _load_pdf,
        ".docx": _load_docx,
        ".doc": _load_docx,
        ".pptx": _load_pptx,
        ".ppt": _load_pptx,
        ".xlsx": _load_xlsx,
        ".xls": _load_xlsx,
        ".csv": lambda p: [Document(page_content=pd.read_csv(p).to_string())],
        ".txt": _load_txt,
        ".md": _load_txt,
    }
    loader_fn = loaders.get(ext)
    if loader_fn is None:
        print(f"[ingestao] Extensão não suportada: {ext} — ignorando {path}")
        return []
    return loader_fn(path)


# ─── ZIP handler ──────────────────────────────────────────────────────────────

def _extract_zip(zip_path: str, dest_dir: str) -> list[str]:
    """Extrai ZIP/RAR e retorna lista de caminhos de arquivos."""
    extracted = []
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(dest_dir)
        for name in z.namelist():
            full = os.path.join(dest_dir, name)
            if os.path.isfile(full):
                extracted.append(full)
    return extracted


# ─── Core: processar_arquivo ─────────────────────────────────────────────────

def processar_arquivo(
    caminho_arquivo: str,
    collection_name: str,
    metadata_extra: Optional[dict] = None,
) -> None:
    """
    Lê, divide em chunks, gera embeddings e salva no Qdrant.
    Suporta: PDF, DOCX, PPTX, XLSX, CSV, TXT, MD, ZIP.
    O isolamento de contexto é garantido pelo collection_name exclusivo por
    profissão + subárea + localidade/matéria.
    """
    print(f"[ingestao] Iniciando: {caminho_arquivo} → coleção '{collection_name}'")

    # Garante que a coleção existe com as dimensões certas
    if not client.collection_exists(collection_name):
        client.create_collection(
            collection_name=collection_name,
            vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
        )

    ext = os.path.splitext(caminho_arquivo)[1].lower()

    # Se for ZIP, extrai e processa cada arquivo individualmente
    if ext in (".zip", ".rar"):
        with tempfile.TemporaryDirectory() as tmpdir:
            files = _extract_zip(caminho_arquivo, tmpdir)
            for f in files:
                try:
                    processar_arquivo(f, collection_name, metadata_extra)
                except Exception as e:
                    print(f"[ingestao] Erro ao processar {f}: {e}")
        return

    # Carrega o documento
    docs = _load_file(caminho_arquivo)
    if not docs:
        print(f"[ingestao] Nenhum conteúdo extraído de {caminho_arquivo}")
        return

    # Divide em chunks
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    chunks = splitter.split_documents(docs)
    print(f"[ingestao] {len(chunks)} chunks gerados")

    # Gera embeddings e monta pontos Qdrant
    points = []
    filename = os.path.basename(caminho_arquivo)
    for chunk in chunks:
        try:
            vector = get_embedding(chunk.page_content)
        except Exception as e:
            print(f"[ingestao] Erro ao gerar embedding: {e}")
            continue

        payload = {
            "text": chunk.page_content,
            "source": filename,
            "page": chunk.metadata.get("page", 0),
        }
        if metadata_extra:
            payload.update(metadata_extra)

        points.append(
            PointStruct(
                id=random.randint(0, 2**31),
                vector=vector,
                payload=payload,
            )
        )

    if points:
        # Upsert em lotes de 100 para não sobrecarregar
        batch_size = 100
        for i in range(0, len(points), batch_size):
            client.upsert(
                collection_name=collection_name,
                points=points[i : i + batch_size],
            )
        print(f"[ingestao] ✅ {len(points)} vetores salvos em '{collection_name}'")
    else:
        print(f"[ingestao] ⚠️  Nenhum vetor gerado para {caminho_arquivo}")
