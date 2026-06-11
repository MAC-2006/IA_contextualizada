from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import shutil
import os

from ingestao import processar_arquivo
from consulta import responder_pergunta

app = FastAPI(title="ProMind API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Helpers ──────────────────────────────────────────────────────────────────

def build_collection_name(
    profession: str,
    sub_area: str,
    estado: Optional[str] = None,
    materia: Optional[str] = None,
) -> str:
    base = f"{profession}_{sub_area}".lower().replace(" ", "_")
    if profession.lower() == "advogado" and estado:
        base = f"{base}_{estado.lower().replace(' ', '_')}"
    if profession.lower() == "professor" and materia:
        base = f"{base}_{materia.lower().replace(' ', '_')}"
    return base


# ─── Onboarding Complete (chama o auto-indexer) ───────────────────────────────

class OnboardingRequest(BaseModel):
    profession: str
    sub_area: Optional[str] = "geral"
    state: Optional[str] = ""
    collection_name: Optional[str] = None


@app.post("/onboarding/complete")
async def onboarding_complete(req: OnboardingRequest):
    """
    Chamado ao finalizar o onboarding.
    Dispara o auto-indexer em background para indexar fontes públicas.
    """
    col = req.collection_name or build_collection_name(
        req.profession, req.sub_area or "geral", req.state
    )
    try:
        from auto_indexer import auto_indexar
        import asyncio
        # Roda em background para não bloquear o frontend
        asyncio.create_task(
            auto_indexar(
                profession=req.profession,
                sub_area=req.sub_area or "geral",
                state=req.state or "",
                collection_name=col,
            )
        )
    except Exception as e:
        # Não falha o onboarding se o auto-indexer tiver problema
        print(f"[onboarding] auto_indexer ignorado: {e}")

    return {"status": "ok", "collection": col}


# ─── Upload ───────────────────────────────────────────────────────────────────

@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    profession: str = Form("geral"),
    sub_area: str = Form("geral"),
    collection_name: Optional[str] = Form(None),
    estado: Optional[str] = Form(None),
    materia: Optional[str] = Form(None),
    nivel: Optional[str] = Form(None),
):
    col = collection_name or build_collection_name(profession, sub_area, estado, materia)

    data_dir = os.path.join("data", col)
    os.makedirs(data_dir, exist_ok=True)

    file_path = os.path.join(data_dir, file.filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        processar_arquivo(
            caminho_arquivo=file_path,
            collection_name=col,
            metadata_extra={
                "profession": profession,
                "sub_area": sub_area,
                "estado": estado or "",
                "materia": materia or "",
                "nivel": nivel or "",
            },
        )
        return {
            "status": "success",
            "filename": file.filename,
            "collection": col,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Chat ─────────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    question: str
    collection_name: str
    profession: Optional[str] = None
    sub_area: Optional[str] = None


@app.post("/chat")
async def chat(req: ChatRequest):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Pergunta vazia.")

    try:
        answer = responder_pergunta(
            question=req.question,
            collection_name=req.collection_name,
            profession=req.profession,
            sub_area=req.sub_area,
        )
        return {"answer": answer, "collection": req.collection_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)