from mapper.quote import quote_in_text


def test_quote_ignores_spacing_case_and_wrapping_quotes():
    text = "WOM Fibra\n\nDesde cualquier teléfono\n600 600 1106"
    assert quote_in_text("«desde cualquier  teléfono 600 600 1106»", text)
    assert quote_in_text("WOM Fibra", text)


def test_quote_must_be_in_text():
    assert not quote_in_text("Desde cualquier celular", "Desde cualquier teléfono")
    assert not quote_in_text("  ", "algo")


def test_quote_on_screen_only_when_inside_the_viewport(with_session):
    from mapper.quote import quote_on_screen

    async def body(session):
        assert await quote_on_screen(session.page, "Centro de ayuda")
        await session.page.evaluate("document.querySelector('details').open = true")
        assert not await quote_on_screen(session.page, "«Para dar de baja llama al 103.»")
        await session.page.evaluate("document.querySelector('details').scrollIntoView()")
        assert await quote_on_screen(session.page, "Para dar de baja llama al 103.")

    with_session("ayuda.html", body)


def test_quote_on_screen_skips_a_hidden_duplicate(with_session):
    from mapper.quote import quote_on_screen

    async def body(session):
        assert await quote_on_screen(session.page, "Horario de atención: 9 a 18 horas.")

    with_session("duplicado.html", body)
