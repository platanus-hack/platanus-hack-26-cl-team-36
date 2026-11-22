import asyncio
import http.server
import threading
import time

import pytest
from playwright.async_api import async_playwright

from shared.browser.session import BrowserSession, connect_browser, create_context

from guide import operate
from guide.locators import record_locators, resolve_locators
from guide.operate import ActionRejected, perform_step
from guide.page_view import element_for_ref, read_page_view
from tests.conftest import DESKTOP


async def _handle(session, name):
    view = await read_page_view(session.page)
    element = next(element for element in view.elements if element.name == name)
    return element, await element_for_ref(session.page, element.ref)


def test_hidden_element_is_rejected_until_its_menu_opens(with_session):
    async def body(session):
        _, help_link = await _handle(session, "Ayuda")
        with pytest.raises(ActionRejected, match="no está a la vista"):
            await perform_step(session, "click", None, help_link, None)
        _, menu = await _handle(session, "Menú")
        opened = await perform_step(session, "click", None, menu, None)
        assert not opened.changes_node and opened.in_viewport
        _, help_link = await _handle(session, "Ayuda")
        step = await perform_step(session, "click", None, help_link, None)
        assert step.title_after == "Ayuda" and step.changes_node and len(step.screenshot) > 1000

    with_session("index.html", body)


def test_element_that_hides_and_comes_back_is_awaited(with_session):
    async def body(session):
        _, products = await _handle(session, "Productos")
        hide = "(el, ms) => { el.hidden = true; setTimeout(() => { el.hidden = false; }, ms); }"
        await products.evaluate(hide, 5000)
        with pytest.raises(ActionRejected, match="no está a la vista"):
            await perform_step(session, "click", None, products, None, reappear_s=0.5)
        await products.evaluate(hide, 500)
        step = await perform_step(session, "click", None, products, None, reappear_s=3)
        assert step.title_after == "Productos" and step.in_viewport

    with_session("index.html", body)


def test_a_click_that_times_out_tells_the_model_what_may_be_wrong(with_session, monkeypatch):
    monkeypatch.setattr(operate, "_ACTION_TIMEOUT_MS", 500)

    async def body(session):
        _, products = await _handle(session, "Productos")
        await session.page.evaluate("""() => document.body.insertAdjacentHTML('beforeend',
            '<div style="position:fixed;inset:0;z-index:9"></div>')""")
        with pytest.raises(ActionRejected, match="intercepts pointer events.*abre primero ese menú"):
            await perform_step(session, "click", None, products, None)

    with_session("index.html", body)


def test_click_below_the_fold_records_it_was_off_screen(with_session):
    async def body(session):
        _, contact = await _handle(session, "Contacto")
        step = await perform_step(session, "click", None, contact, None)
        assert step.in_viewport is False and step.scrolls_needed == 1 and step.ui_actions == 2

    with_session("index.html", body)


def test_fill_select_and_password_guard(with_session):
    async def body(session):
        _, search = await _handle(session, "Buscar")
        await perform_step(session, "fill", "baja", search, None)
        assert await search.input_value() == "baja"
        _, region = await _handle(session, "Región")
        await perform_step(session, "select", "Sur", region, None)
        assert await region.input_value() == "Sur"
        _, password = await _handle(session, "Clave")
        with pytest.raises(ActionRejected, match="contraseña"):
            await perform_step(session, "fill", "x", password, None)
        with pytest.raises(ActionRejected, match="necesita un elemento"):
            await perform_step(session, "click", None, None, None)

    with_session("form.html", body)


def test_locators_resolve_the_same_element_after_reload(with_session):
    async def body(session):
        element, handle = await _handle(session, "Productos")
        locators = await record_locators(session.page, handle, element)
        assert [locator["by"] for locator in locators] == ["role", "text", "href", "css"]
        await session.page.reload()
        resolved = await resolve_locators(session.page, locators)
        assert await resolved.get_attribute("href") == "productos.html"
        assert await resolve_locators(session.page, [{"by": "text", "value": "No existe", "nth": 0}]) is None

    with_session("index.html", body)


def test_locator_with_nth_resolves_the_second_match(with_session):
    async def body(session):
        view = await read_page_view(session.page)
        second = [element for element in view.elements if element.name == "Repetido"][1]
        locators = await record_locators(session.page, await element_for_ref(session.page, second.ref), second)
        assert locators[0] == {"by": "role", "role": "link", "value": "Repetido", "nth": 1}
        resolved = await resolve_locators(session.page, locators[:1])
        assert await resolved.get_attribute("href") == "dos.html"

    with_session("clip.html", body)


def test_scroll_moves_the_page_and_is_an_in_page_step(with_session):
    async def body(session):
        step = await perform_step(session, "scroll", "down", None, None)
        assert await session.page.evaluate("scrollY") > 500
        assert not step.changes_node and step.ui_actions == 1 and step.in_viewport is None
        with pytest.raises(ActionRejected, match="dirección del scroll"):
            await perform_step(session, "scroll", "sideways", None, None)

    with_session("clip.html", body)


def test_click_that_starts_a_slow_navigation_is_recorded(monkeypatch):
    monkeypatch.setattr(operate, "_ACTION_TIMEOUT_MS", 1000)

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            slow = self.path == "/lenta.html"
            if slow:
                time.sleep(2.5)
            body = ("<title>Lenta</title>" if slow else '<title>Inicio</title><a href="/lenta.html">Ir</a>').encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()

    async def main():
        async with async_playwright() as playwright:
            browser = await connect_browser(playwright)
            try:
                session = BrowserSession(await create_context(browser, DESKTOP), DESKTOP)
                await session.open(f"http://127.0.0.1:{httpd.server_port}/")
                _, link = await _handle(session, "Ir")
                return await perform_step(session, "click", None, link, None)
            finally:
                await browser.close()

    try:
        step = asyncio.run(main())
    finally:
        httpd.shutdown()
    assert step.title_after == "Lenta" and step.changes_node
