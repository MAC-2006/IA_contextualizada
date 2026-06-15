import httpx
import trafilatura
from ingestao import processar_arquivo
import tempfile, os

# Headers "de navegador" — sem isso, sites gov.br (ex: planalto.gov.br)
# costumam dar ReadTimeout em vez de responder.
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
}

# Mapa de fontes por profissão/subárea
SOURCES = {
    ("Advogado", "civel"): [
        # ATENÇÃO: precisa do /2002/ no caminho — sem ele o planalto
        # retorna 404 ("Ocorreu um erro!").
        "https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm",
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
            async with httpx.AsyncClient(
                timeout=60,
                headers=BROWSER_HEADERS,
                follow_redirects=True,
            ) as client:
                resp = await client.get(url)
                resp.raise_for_status()

            # Passa bytes (resp.content) em vez de resp.text: o trafilatura
            # detecta o encoding correto (muitas páginas gov.br são
            # ISO-8859-1/Windows-1252, mas httpx assume UTF-8 por padrão
            # quando o header Content-Type não declara charset).
            texto = trafilatura.extract(
                resp.content, include_links=False, include_tables=True
            )
            if not texto or len(texto) < 200:
                print(f"[auto_indexer] Conteúdo insuficiente em {url} "
                      f"({len(texto) if texto else 0} chars)")
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
            print(f"[auto_indexer] ✅ Indexado: {url} ({len(texto)} chars)")

        except Exception as e:
            # type(e).__name__ porque str(e) costuma vir vazio em
            # ReadTimeout/ConnectTimeout do httpx.
            print(f"[auto_indexer] Erro em {url}: {type(e).__name__}: {e!r}")