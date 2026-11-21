from mapper.operate import perform_step
from mapper.page_view import element_for_ref, page_text, read_page_view
from mapper.prompts import render_view


def _by_name(view, name):
    return next(element for element in view.elements if element.name == name)


def test_view_flags_hidden_offscreen_and_revealer(with_session):
    async def body(session):
        view = await read_page_view(session.page)
        assert view.title == "Inicio" and "h1 Bienvenida" in view.headings
        menu, help_link = _by_name(view, "Menú"), _by_name(view, "Ayuda")
        assert (menu.role, menu.visible, menu.in_viewport, menu.expanded) == ("button", True, True, False)
        assert not help_link.visible and help_link.revealed_by == menu.ref
        contact = _by_name(view, "Contacto")
        assert contact.visible and not contact.in_viewport
        assert contact.same_host_href(view.url) == contact.href
        lines = render_view(view)
        assert f"{help_link.ref} · link · «Ayuda»" in lines and "oculto, lo muestra " + menu.ref in lines
        assert await element_for_ref(session.page, menu.ref) is not None
        assert await element_for_ref(session.page, "e999") is None

    with_session("index.html", body)


def test_view_of_form_fields_and_element_off_the_left_edge(with_session):
    async def body(session):
        view = await read_page_view(session.page)
        assert _by_name(view, "Buscar").role == "searchbox"
        assert _by_name(view, "Región").value == "Norte"
        assert not _by_name(view, "Fuera").visible

    with_session("form.html", body)


def test_closed_details_content_is_hidden(with_session):
    async def body(session):
        view = await read_page_view(session.page)
        summary = _by_name(view, "¿Cómo doy de baja?")
        assert summary.expanded is False and "llama al 103" not in view.text

    with_session("ayuda.html", body)


def test_elements_above_the_page_or_clipped_by_an_ancestor_are_hidden(with_session):
    async def body(session):
        view = await read_page_view(session.page)
        assert not _by_name(view, "Saltar al contenido").visible
        assert not _by_name(view, "En acordeón cerrado").visible

    with_session("clip.html", body)


def test_text_sent_to_the_model_follows_the_scroll(with_session):
    async def body(session):
        top = render_view(await read_page_view(session.page))
        assert "Respuesta al fondo" not in top and "scroll down para leer más" in top
        await session.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        bottom = render_view(await read_page_view(session.page))
        assert "Respuesta al fondo de la página." in bottom and "scroll up para verlo" in bottom

    with_session("clip.html", body)


def test_text_follows_the_scroll_past_a_sticky_header(with_session):
    async def body(session):
        await session.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        bottom = render_view(await read_page_view(session.page))
        assert "Respuesta bajo el encabezado fijo." in bottom and "scroll up para verlo" in bottom

    with_session("sticky.html", body)


def test_text_clipped_by_a_collapsed_accordion_is_not_in_the_view(with_session):
    async def body(session):
        assert "La respuesta es 42." not in (await read_page_view(session.page)).text
        assert "La respuesta es 42." not in await page_text(session.page)
        await session.page.click("button")
        assert "La respuesta es 42." in (await read_page_view(session.page)).text
        assert "La respuesta es 42." in await page_text(session.page)

    with_session("acordeon.html", body)


def test_element_below_the_fold_of_an_inner_scroll_panel_is_usable(with_session):
    async def body(session):
        view = await read_page_view(session.page)
        link = _by_name(view, "Al fondo del panel")
        assert link.visible and not link.in_viewport
        step = await perform_step(session, "click", None, await element_for_ref(session.page, link.ref), None)
        assert step.title_after == "Productos" and step.in_viewport is False

    with_session("app.html", body)
