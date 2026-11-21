from mapper.page_view import element_for_ref, read_page_view
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


def test_view_of_form_fields_and_closed_details(with_session):
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
