import pytest

from mapper.locators import record_locators, resolve_locators
from mapper.operate import ActionRejected, perform_step
from mapper.page_view import element_for_ref, read_page_view


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
