"""Sesión de navegación con páginas locales: capturas, pestañas, videos y la red de seguridad de formularios."""

import asyncio
import io

import pytest
from PIL import Image
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright

from shared.browser import session as session_module
from shared.browser.session import BrowserSession, blocked_form_count, connect_browser, create_context
from shared.browser.viewports import SCREENS

DESKTOP = SCREENS["desktop"]


@pytest.fixture
def site(tmp_path):
    (tmp_path / "two.html").write_text("<title>Dos</title><h1>Página dos</h1>", encoding="utf-8")
    (tmp_path / "one.html").write_text(
        """<title>Uno</title>
        <form method="post" action="send"><input type="password"><button id="send">Enviar</button></form>
        <form method="get" action="two.html"><button id="search">Buscar</button></form>""",
        encoding="utf-8",
    )
    return tmp_path


def test_post_and_password_forms_are_blocked_and_get_forms_are_not(site):
    async def scenario():
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright)
            try:
                session = BrowserSession(await create_context(browser, DESKTOP), DESKTOP)
                await session.open((site / "one.html").as_uri())
                await session.page.click("#send")
                await session.wait_until_settled()
                blocked, title = await blocked_form_count(session.page), (await session.url_and_title())[1]
                await session.page.click("#search")
                await session.wait_until_settled()
                return blocked, title, (await session.url_and_title())[1]
            finally:
                await browser.close()

    assert asyncio.run(scenario()) == (1, "Uno", "Dos")


def test_record_video_saves_one_webm_per_tab(site, tmp_path):
    video_dir = tmp_path / "run"
    video_dir.mkdir()
    (site / "opener.html").write_text(
        """<title>Abre</title>
        <a href="two.html" target="_blank" style="position:absolute;left:20px;top:20px;font-size:30px">Nueva</a>""",
        encoding="utf-8",
    )

    async def scenario():
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright)
            try:
                context = await create_context(browser, DESKTOP, video_dir)
                session = BrowserSession(context, DESKTOP)
                await session.open((site / "opener.html").as_uri())
                await session.page.mouse.click(40, 35)
                await session.wait_until_settled()
                assert (await session.url_and_title())[1] == "Dos"
                await context.close()
                return await session.save_videos(video_dir, [])
            finally:
                await browser.close()

    names = asyncio.run(scenario())
    assert names == ["video.webm", "video-2.webm"]
    for name in names:
        data = (video_dir / name).read_bytes()
        assert data[:4] == b"\x1a\x45\xdf\xa3"  # cabecera EBML de WebM
    assert sorted(p.name for p in video_dir.iterdir()) == sorted(names)  # no quedan archivos con nombre aleatorio


def test_without_video_dir_nothing_is_recorded(site, tmp_path):
    async def scenario():
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright)
            try:
                context = await create_context(browser, DESKTOP)
                session = BrowserSession(context, DESKTOP)
                await session.open((site / "one.html").as_uri())
                await context.close()
                return await session.save_videos(tmp_path, [])
            finally:
                await browser.close()

    assert asyncio.run(scenario()) == []


async def _with_session(site, body):
    async with async_playwright() as playwright:
        browser = await connect_browser(playwright)
        try:
            session = BrowserSession(await create_context(browser, DESKTOP), DESKTOP)
            await session.open((site / "one.html").as_uri())
            await body(session)
        finally:
            await browser.close()


def test_screenshot_reintenta_un_error_de_protocolo(monkeypatch):
    class PaginaInestable:
        def __init__(self, fallas):
            self.fallas, self.llamadas = fallas, 0

        async def screenshot(self, **_):
            self.llamadas += 1
            if self.llamadas <= self.fallas:
                raise PlaywrightError("Protocol error (Page.captureScreenshot): Unable to capture screenshot")
            return b"png"

    monkeypatch.setattr(session_module, "SCREENSHOT_ESPERA_S", 0)
    session = BrowserSession(None, DESKTOP)
    session.page = PaginaInestable(fallas=2)
    assert asyncio.run(session.screenshot()) == b"png" and session.page.llamadas == 3
    session.page = PaginaInestable(fallas=3)
    with pytest.raises(PlaywrightError, match="Unable to capture"):
        asyncio.run(session.screenshot())
    assert session.page.llamadas == 3


def test_screenshot_sin_esperar_fuentes_va_por_cdp(site, monkeypatch):
    """Si Playwright se queda esperando las fuentes, la captura sale igual, del tamaño del viewport."""

    async def body(session):
        async def se_cuelga(**_):
            raise PlaywrightTimeoutError("Page.screenshot: Timeout 15000ms exceeded. waiting for fonts to load...")

        monkeypatch.setattr(session.page, "screenshot", se_cuelga)
        png = await session.screenshot()
        assert Image.open(io.BytesIO(png)).size == (DESKTOP.width, DESKTOP.height)

    asyncio.run(_with_session(site, body))


def test_una_pestana_que_solo_descarga_se_cierra(tmp_path):
    """Un enlace target=_blank a un archivo abre una pestaña en blanco que no se puede capturar: se vuelve a la anterior."""
    (tmp_path / "archivo.bin").write_bytes(b"\0" * 2048)
    (tmp_path / "one.html").write_text(
        '<title>Uno</title><a href="archivo.bin" download target="_blank" '
        'style="position:absolute;left:20px;top:20px;font-size:30px">Bajar</a>',
        encoding="utf-8",
    )

    async def body(session):
        await session.page.mouse.click(40, 35)
        await session.wait_until_settled()
        assert (await session.url_and_title())[1] == "Uno"
        assert len(await session.screenshot()) > 1000
        assert any(event.startswith("download:") for event in session.events)
        assert "download_tab_closed" in session.events and len(session.pages) == 2

    asyncio.run(_with_session(tmp_path, body))
