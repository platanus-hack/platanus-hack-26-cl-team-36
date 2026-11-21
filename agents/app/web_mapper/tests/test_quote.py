from mapper.quote import quote_in_text


def test_quote_ignores_spacing_case_and_wrapping_quotes():
    text = "WOM Fibra\n\nDesde cualquier teléfono\n600 600 1106"
    assert quote_in_text("«desde cualquier  teléfono 600 600 1106»", text)
    assert quote_in_text("WOM Fibra", text)


def test_quote_must_be_in_text():
    assert not quote_in_text("Desde cualquier celular", "Desde cualquier teléfono")
    assert not quote_in_text("  ", "algo")
