"""
Script de diagnóstico para o auto_indexer.

Roda fora do FastAPI: testa cada URL com httpx (com e sem headers de
navegador), mostra status code, tamanho da resposta, tipo exato da
exceção (se houver) e tenta extrair texto com trafilatura.

Uso:
    cd backend
    python ../debug_auto_indexer.py
(ou ajuste o caminho conforme onde salvar o arquivo)
"""

import asyncio
import httpx
import trafilatura

URLS = [
    "https://www.planalto.gov.br/ccivil_03/leis/l10406compilada.htm",
    "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm",
]

# Headers "de navegador" — muitos sites gov.br bloqueiam clientes sem
# User-Agent ou com headers mínimos típicos de bots/scripts.
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
}


async def testar_url(url: str, headers: dict | None, label: str):
    print(f"\n{'='*70}")
    print(f"[{label}] {url}")
    print(f"{'='*70}")
    try:
        async with httpx.AsyncClient(
            timeout=30,
            headers=headers,
            follow_redirects=True,
            verify=True,
        ) as client:
            resp = await client.get(url)

        print(f"  Status code : {resp.status_code}")
        print(f"  URL final   : {resp.url}")
        print(f"  Content-Type: {resp.headers.get('content-type')}")
        print(f"  Tamanho     : {len(resp.text)} chars")

        if resp.status_code >= 400:
            print(f"  >>> HTTP error, primeiros 300 chars do corpo:")
            print(f"  {resp.text[:300]!r}")
            return

        texto = trafilatura.extract(
            resp.text, include_links=False, include_tables=True
        )
        if texto:
            print(f"  trafilatura : extraiu {len(texto)} chars")
            print(f"  Preview     : {texto[:200]!r}")
        else:
            print("  trafilatura : retornou None / vazio")
            print(f"  HTML preview: {resp.text[:300]!r}")

    except Exception as e:
        # Mostra o tipo exato + repr, já que str(e) costuma vir vazio
        # para alguns erros de timeout/connect do httpx.
        print(f"  >>> EXCEÇÃO: {type(e).__module__}.{type(e).__name__}")
        print(f"  >>> repr   : {e!r}")
        print(f"  >>> str    : {str(e)!r}")


async def main():
    for url in URLS:
        # 1. Sem headers (igual ao código atual do auto_indexer.py)
        await testar_url(url, headers=None, label="SEM headers")
        # 2. Com headers de navegador
        await testar_url(url, headers=BROWSER_HEADERS, label="COM headers de navegador")


if __name__ == "__main__":
    asyncio.run(main())