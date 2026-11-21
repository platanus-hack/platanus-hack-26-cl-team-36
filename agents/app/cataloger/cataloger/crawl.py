"""Recorrido en anchura de las páginas del mismo sitio, una a la vez, sin enviar formularios."""

import asyncio
from collections.abc import Callable
from urllib.parse import urlsplit

from playwright.async_api import Browser
from playwright.async_api import Error as PlaywrightError

from shared.browser.session import PAGE_LOAD_TIMEOUT_MS, BrowserSession, create_context
from shared.browser.viewports import Screen
from shared.catalog.outline import PageOutline, SiteOutline
from shared.nodes.urls import normalize_url, same_site

from cataloger import config
from cataloger.outline import read_outline
from cataloger.rules import page_gates

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
    for pause_s in (config.CRAWL_DELAY_S, config.CRAWL_RETRY_DELAY_S):
        await asyncio.sleep(pause_s)
        session.http_status = None
        if session.page is None:
            await session.open(url)
        else:
            await session.page.goto(url, wait_until="domcontentloaded", timeout=PAGE_LOAD_TIMEOUT_MS)
            await session.wait_until_settled()
        if session.http_status is None or session.http_status < 400:
            break
    return session.http_status


async def crawl(browser: Browser, screen: Screen, start_url: str, max_pages: int, max_depth: int,
                log: Callable[[str], None]) -> SiteOutline:
    outline = SiteOutline(start_url, urlsplit(start_url).hostname or "", f"{screen.width}x{screen.height}", [], [])
    queue: list[tuple[str, int]] = [(start_url, 0)]
    seen = {normalize_url(start_url)}
    context = await create_context(browser, screen)
    try:
        session = BrowserSession(context, screen)
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
