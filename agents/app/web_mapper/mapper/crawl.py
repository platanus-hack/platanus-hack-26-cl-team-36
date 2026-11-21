"""Recorrido en anchura de las páginas del mismo sitio, una a la vez, sin enviar formularios."""

import asyncio
from urllib.parse import urlsplit

from playwright.async_api import Browser
from playwright.async_api import Error as PlaywrightError

import config as evaluator_config
from browser import BrowserSession, create_context
from profiles import Profile
from route_tree import normalize_url

from mapper import config as mapper_config
from mapper.goal_rules import page_gates
from mapper.operate import Log
from mapper.outline import PageOutline, SiteOutline, read_outline
from mapper.page_view import same_site

_ZONE_ORDER = {"nav": 0, "main": 1, "footer": 2}
_SKIPPED_EXTENSIONS = (".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".zip", ".doc", ".docx", ".xls", ".xlsx", ".mp4")


def _crawlable(url: str, start_url: str) -> bool:
    parts = urlsplit(url)
    return (
        parts.scheme in ("http", "https")
        and same_site(url, start_url)
        and not parts.path.lower().endswith(_SKIPPED_EXTENSIONS)
    )


def next_urls(page: PageOutline, start_url: str) -> list[str]:
    """Enlaces del mismo sitio, primero los del encabezado y la navegación, después el contenido y el pie."""
    links = sorted(page.links, key=lambda link: _ZONE_ORDER[link.zone])
    return list(dict.fromkeys(link.href for link in links if _crawlable(link.href, start_url)))


async def _load(session: BrowserSession, url: str) -> int | None:
    """Carga la página con una pausa previa; si responde con error, espera más y reintenta una vez."""
    for pause_s in (mapper_config.CRAWL_DELAY_S, mapper_config.CRAWL_RETRY_DELAY_S):
        await asyncio.sleep(pause_s)
        session.http_status = None
        if session.page is None:
            await session.open(url)
        else:
            await session.page.goto(url, wait_until="domcontentloaded", timeout=evaluator_config.PAGE_LOAD_TIMEOUT_MS)
            await session.wait_until_settled()
        if session.http_status is None or session.http_status < 400:
            break
    return session.http_status


async def crawl(browser: Browser, profile: Profile, start_url: str, max_pages: int, max_depth: int, log: Log) -> SiteOutline:
    outline = SiteOutline(start_url, urlsplit(start_url).hostname or "", f"{profile.width}x{profile.height}", [], [])
    queue: list[tuple[str, int]] = [(start_url, 0)]
    seen = {normalize_url(start_url)}
    context = await create_context(browser, profile)
    try:
        session = BrowserSession(context, profile)
        while queue and len(outline.pages) < max_pages:
            url, depth = queue.pop(0)
            try:
                status = await _load(session, url)
                if status is not None and status >= 400:
                    outline.failures.append(f"{url}: HTTP {status}")
                    continue
                page = await read_outline(session.page, depth)
            except PlaywrightError as error:
                outline.failures.append(f"{url}: {error.message.splitlines()[0]}")
                continue
            final_url = normalize_url(page.url)
            if not same_site(page.url, start_url):
                outline.failures.append(f"{url}: redirige a otro sitio, {page.url}")
                continue
            if final_url != normalize_url(url) and final_url in seen:
                continue
            seen.add(final_url)
            page.gates = page_gates(page)
            outline.pages.append(page)
            log(f"esquema {len(outline.pages)}/{max_pages} (profundidad {depth}): {page.title} — {page.url}")
            if depth >= max_depth:
                continue
            for link in next_urls(page, start_url):
                if normalize_url(link) not in seen:
                    seen.add(normalize_url(link))
                    queue.append((link, depth + 1))
    finally:
        await context.close()
    return outline
