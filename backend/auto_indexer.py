import httpx
import trafilatura
from ingestao import processar_arquivo
import tempfile, os

# Mapa de fontes por profissão/subárea
SOURCES = {
    ("Advogado", "civel"): [
        "https://www.planalto.gov.br/ccivil_03/leis/l10406compilada.htm",
        "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm",
    ],
    ("Advogado", "trab"): [
        "https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm",
    ],
    ("Médico", "clinica"): [
        "https://bvsms.saude.gov.br/bvs/publicacoes/",
    ],
    ("Professor", "pub"): [
        "http://basenacionalcomum.mec.gov.br/",
    ],
}

async def auto_indexar(
    profession: str,
    sub_area: str,
    state: str,           # ← parâmetro que faltava
    collection_name: str,
):
    """
    Busca fontes públicas relevantes e as indexa na coleção do usuário.
    Chamado ao finalizar o onboarding.
    """
    key = (profession, sub_area)
    urls = SOURCES.get(key, [])

    for url in urls:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(url, follow_redirects=True)

            texto = trafilatura.extract(resp.text, include_links=False, include_tables=True)
            if not texto or len(texto) < 200:
                continue

            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".txt", delete=False, encoding="utf-8"
            ) as f:
                f.write(texto)
                tmp_path = f.name

            processar_arquivo(
                caminho_arquivo=tmp_path,
                collection_name=collection_name,
                metadata_extra={
                    "source_type": "auto_index",
                    "source_url": url,
                    "profession": profession,
                    "sub_area": sub_area,
                    "state": state,
                },
            )
            os.unlink(tmp_path)

        except Exception as e:
            print(f"[auto_indexer] Erro em {url}: {e}")