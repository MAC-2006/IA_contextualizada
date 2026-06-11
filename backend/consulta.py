import os
from typing import Optional

from qdrant_client import QdrantClient
import ollama

# ─── Config ───────────────────────────────────────────────────────────────────

QDRANT_HOST = os.getenv("QDRANT_HOST", "localhost")
QDRANT_PORT = int(os.getenv("QDRANT_PORT", 6333))
EMBED_MODEL = "nomic-embed-text"
CHAT_MODEL = os.getenv("CHAT_MODEL", "llama3.2:3b")
TOP_K = 5  # quantos chunks recuperar por pergunta

client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)

# ─── System prompts por profissão ─────────────────────────────────────────────

SYSTEM_PROMPTS = {
    "advogado": (
        "Você é um assistente jurídico especializado. "
        "Responda APENAS com base nos trechos de documentos fornecidos abaixo. "
        "Cite a fonte (nome do arquivo e página) quando possível. "
        "Se a informação não estiver nos documentos, diga claramente que não encontrou. "
        "Use linguagem técnica adequada ao Direito, mas seja claro e objetivo."
    ),
    "médico": (
        "Você é um assistente médico especializado. "
        "Responda APENAS com base nos trechos de documentos fornecidos abaixo. "
        "Cite a fonte (nome do arquivo) quando possível. "
        "Se a informação não estiver nos documentos, diga claramente que não encontrou. "
        "Use terminologia médica precisa. Nunca forneça diagnósticos ou prescrições — "
        "apenas analise e resuma as informações contidas nos documentos."
    ),
    "professor": (
        "Você é um assistente pedagógico especializado. "
        "Responda APENAS com base nos trechos de documentos fornecidos abaixo. "
        "Cite a fonte (nome do arquivo) quando possível. "
        "Se a informação não estiver nos documentos, diga claramente que não encontrou. "
        "Adapte a linguagem ao contexto educacional, com foco em clareza didática."
    ),
    "geral": (
        "Você é um assistente especializado em análise de documentos. "
        "Responda APENAS com base nos trechos de documentos fornecidos abaixo. "
        "Cite a fonte (nome do arquivo) quando possível. "
        "Se a informação não estiver nos documentos, diga claramente que não encontrou."
    ),
}


# ─── Helpers ──────────────────────────────────────────────────────────────────

def get_embedding(text: str) -> list[float]:
    response = ollama.embeddings(model=EMBED_MODEL, prompt=text)
    return response["embedding"]


def buscar_chunks(question: str, collection_name: str, top_k: int = TOP_K) -> list[dict]:
    """Busca os chunks mais relevantes no Qdrant para a pergunta."""
    if not client.collection_exists(collection_name):
        return []

    query_vector = get_embedding(question)
    results = client.search(
        collection_name=collection_name,
        query_vector=query_vector,
        limit=top_k,
        with_payload=True,
    )

    chunks = []
    for hit in results:
        payload = hit.payload or {}
        chunks.append({
            "text": payload.get("text", ""),
            "source": payload.get("source", "desconhecido"),
            "page": payload.get("page", ""),
            "score": round(hit.score, 3),
        })
    return chunks


def montar_contexto(chunks: list[dict]) -> str:
    """Formata os chunks recuperados em um bloco de contexto para o LLM."""
    if not chunks:
        return "Nenhum documento relevante encontrado na base de conhecimento."

    partes = []
    for i, c in enumerate(chunks, 1):
        source_info = c["source"]
        if c["page"]:
            source_info += f", página {c['page']}"
        partes.append(f"[Trecho {i} — Fonte: {source_info}]\n{c['text']}")

    return "\n\n---\n\n".join(partes)


# ─── Main: responder_pergunta ─────────────────────────────────────────────────

def responder_pergunta(
    question: str,
    collection_name: str,
    profession: Optional[str] = None,
    sub_area: Optional[str] = None,
) -> str:
    """
    Pipeline RAG completo:
    1. Busca os chunks mais relevantes na coleção do usuário.
    2. Monta o prompt com contexto + pergunta.
    3. Envia ao modelo local via Ollama.
    4. Retorna a resposta gerada.
    """
    # Seleciona o system prompt pela profissão
    prof_key = (profession or "geral").lower()
    system_prompt = SYSTEM_PROMPTS.get(prof_key, SYSTEM_PROMPTS["geral"])
    if sub_area:
        system_prompt += f"\n\nEspecialidade ativa: {sub_area}."

    # Recupera contexto
    chunks = buscar_chunks(question, collection_name)
    contexto = montar_contexto(chunks)

    # Prompt final
    user_message = (
        f"Documentos disponíveis:\n\n{contexto}\n\n"
        f"---\n\n"
        f"Pergunta: {question}\n\n"
        f"Responda em português, de forma clara e direta, baseando-se estritamente "
        f"nos documentos acima."
    )

    # Chamada ao modelo local
    response = ollama.chat(
        model=CHAT_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
    )

    return response["message"]["content"]
