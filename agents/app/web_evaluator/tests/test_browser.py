"""Pruebas del navegador y las acciones con páginas locales (sin llamar a la API)."""

import asyncio
import io

import pytest
from PIL import Image
from playwright.async_api import async_playwright

from actions import Executor, InvalidActionError, UnavailableActionError, is_back_key, translate_key
from browser import BrowserSession, connect_browser, create_context
from profiles import Profile
from recording import blocked_form_count, element_at, has_no_effect, screen_change_ratio

DESKTOP = Profile("test_desktop", "Prueba", 1024, 768, False, "")
MOBILE = Profile("test_mobile", "Prueba móvil", 390, 844, True, "")


def test_translate_key():
    assert translate_key("ctrl+a") == "Control+a"
    assert translate_key("Return") == "Enter"
    assert translate_key("Page_Down") == "PageDown"
    assert is_back_key("alt+Left")
    assert not is_back_key("Left")


@pytest.fixture
def site(tmp_path):
    (tmp_path / "two.html").write_text("<title>Dos</title><h1 style='background:#fc0'>Página dos</h1>", encoding="utf-8")
    (tmp_path / "one.html").write_text(
        """<meta name="viewport" content="width=device-width"><title>Uno</title>
        <a href="two.html" style="position:absolute;left:20px;top:20px;font-size:30px">Ir a dos</a>
        <form method="post" action="send" style="position:absolute;left:20px;top:200px">
          <button style="font-size:30px">Enviar</button>
        </form>
        <div style="height:3000px"></div>""",
        encoding="utf-8",
    )
    return tmp_path


async def _with_session(site, profile, body):
    async with async_playwright() as playwright:
        browser = await connect_browser(playwright)
        context = await create_context(browser, profile)
        session = BrowserSession(context, profile)
        await session.open((site / "one.html").as_uri())
        try:
            await body(session, Executor(session))
        finally:
            await browser.close()


def test_click_navigates_and_back_returns(site):
    async def body(session, executor):
        screenshot = await session.screenshot()
        assert len(screenshot) > 1000
        element = await element_at(session.page, 40, 35)
        assert element["tag"] == "a" and element["text"] == "Ir a dos"
        await executor.execute("left_click", {"coordinate": [40, 35]})
        await session.wait_until_settled()
        assert (await session.url_and_title())[1] == "Dos"
        executed = await executor.execute("key", {"text": "alt+Left"})
        await session.wait_until_settled()
        assert executed.went_back
        assert (await session.url_and_title())[1] == "Uno"

    asyncio.run(_with_session(site, DESKTOP, body))


def test_click_on_empty_space_has_no_effect_but_scroll_does(site):
    async def body(session, executor):
        before = await session.screenshot()
        await executor.execute("left_click", {"coordinate": [800, 600]})
        await session.wait_until_settled()
        after = await session.screenshot()
        url = session.page.url
        assert has_no_effect(url, url, screen_change_ratio(before, after))
        await executor.execute("scroll", {"scroll_direction": "down", "scroll_amount": 3})
        await session.wait_until_settled()
        assert screen_change_ratio(after, await session.screenshot()) > 0.005

    asyncio.run(_with_session(site, DESKTOP, body))


def test_post_form_is_blocked(site):
    async def body(session, executor):
        await executor.execute("left_click", {"coordinate": [60, 220]})
        await session.wait_until_settled()
        assert session.page.url.endswith("one.html")
        assert await blocked_form_count(session.page) == 1

    asyncio.run(_with_session(site, DESKTOP, body))


def test_zoom_and_off_screen_coordinates_raise(site):
    async def body(session, executor):
        with pytest.raises(UnavailableActionError):
            await executor.execute("zoom", {"region": [0, 0, 100, 100]})
        with pytest.raises(InvalidActionError):
            await executor.execute("left_click", {"coordinate": [5000, 10]})

    asyncio.run(_with_session(site, DESKTOP, body))


def test_mobile_taps_and_scrolls(site):
    async def body(session, executor):
        screenshot = await session.screenshot()
        assert Image.open(io.BytesIO(screenshot)).size == (390, 844)
        await executor.execute("scroll", {"scroll_direction": "down", "scroll_amount": 3, "coordinate": [200, 400]})
        await session.wait_until_settled()
        assert screen_change_ratio(screenshot, await session.screenshot()) > 0.005
        await executor.execute("scroll", {"scroll_direction": "up", "scroll_amount": 10, "coordinate": [200, 400]})
        await session.wait_until_settled()
        await executor.execute("left_click", {"coordinate": [40, 35]})
        await session.wait_until_settled()
        assert (await session.url_and_title())[1] == "Dos"

    asyncio.run(_with_session(site, MOBILE, body))
