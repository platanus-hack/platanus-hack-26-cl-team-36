"""Saneamiento, ámbito html.mi-tema y riesgos del CSS; lectura del skill y del JSON del modelo."""

from disenador.css import analizar, con_ambito, sanear
from disenador.modelo import CONTRATO, json_tolerante, leer_skill, prompt_de_sistema


def test_con_ambito():
    assert con_ambito("html.mi-tema body") is None
    assert con_ambito("html.mi-tema") is None
    assert con_ambito("body") == "html.mi-tema body"
    assert con_ambito(":root") == "html.mi-tema"
    assert con_ambito("html") == "html.mi-tema"
    assert con_ambito("html.mi-tema-foco a") == "html.mi-tema.mi-tema-foco a"
    assert con_ambito("html[lang] p") == "html.mi-tema[lang] p"
    assert con_ambito("*") == "html.mi-tema *"


def test_rechaza_lo_peligroso_y_conserva_important():
    css = r"""@import "x.css";
    html.mi-tema body { color: #eee !important; background: url(http://x/y.png); }
    html.mi-tema a { content: "\201C"; behavior: url(x.htc); width: expression(alert(1)); }
    html.mi-tema .b { background: javascript:alert(1); color: red; }
    .md\:flex { display: flex; }
    @font-face { font-family: Propia; src: url(a.woff2); }
    @charset "utf-8";"""
    saneado = sanear(css)
    motivos = [r["motivo"] for r in saneado.rechazos]
    assert motivos == ["@import", "url(", "barra invertida", "url(", "expression(", "javascript:",
                       "barra invertida en el selector", "url(", "@charset no permitida"]
    assert "color: #eee !important;" in saneado.css
    assert "html.mi-tema .b {\n  color: red;\n}" in saneado.css
    assert "html.mi-tema a" not in saneado.css  # quedó vacía
    for prohibido in ("url(", "@import", "\\", "expression(", "javascript:"):
        assert prohibido not in saneado.css


def test_ambito_en_media_y_no_en_keyframes_ni_anidadas():
    css = """@media (max-width: 600px) { nav { display: none } }
    @keyframes aparecer { from { opacity: 0 } to { opacity: 1 } }
    html.mi-tema .tarjeta { color: red; &:hover { color: blue } }
    /* un comentario { con llaves } */
    body, html.mi-tema p { margin: 0 }"""
    saneado = sanear(css)
    assert [v["selector"] for v in saneado.fuera_de_ambito] == ["nav", "body"]
    assert "html.mi-tema nav" in saneado.css
    assert "from {" in saneado.css and "html.mi-tema from" not in saneado.css
    assert "&:hover" in saneado.css
    assert "comentario" not in saneado.css
    assert "html.mi-tema body, html.mi-tema p" in saneado.css


def test_quita_el_cerco_de_codigo():
    saneado = sanear("```css\nhtml.mi-tema body { color: red }\n```")
    assert saneado.css.strip() == "html.mi-tema body {\n  color: red;\n}"
    assert not saneado.rechazos


def test_analiza_riesgos():
    css = """html.mi-tema body { filter: invert(1); position: fixed; transition: .3s; }
    html.mi-tema * { backdrop-filter: blur(2px) !important; transition: color .2s, width 1s; }
    html.mi-tema .x { transition: color .2s ease; display: none; filter: none; }"""
    analisis = analizar(sanear(css))
    assert analisis["reglas"] == 3
    assert analisis["filtros"] == 1
    assert analisis["backdrop_filter"] == 1
    assert analisis["position_fixed"] == 1
    assert analisis["selectores_universales"] == 1
    assert analisis["transiciones_de_layout"] == 2   # `.3s` (all) y `width 1s`; `color .2s ease` no
    assert analisis["ocultan_elementos"] == 1
    assert analisis["important"] == 1
    assert analisis["fuera_de_mi_tema"] == [] and analisis["rechazos"] == []


def test_json_tolerante():
    assert json_tolerante('```json\n{"css": "a"}\n```') == {"css": "a"}
    assert json_tolerante('Aquí va: {"css": "a\\nb"}') == {"css": "a\nb"}
    assert json_tolerante("sin json") is None


def test_skill_y_prompt(tmp_path):
    ruta = tmp_path / "disenar-tema" / "SKILL.md"
    ruta.parent.mkdir()
    ruta.write_text("---\nname: disenar-tema\ndescription: algo\n---\n\n# Diseñar\nCuerpo.\n", encoding="utf-8")
    skill = leer_skill(ruta)
    assert skill.nombre == "disenar-tema" and skill.cuerpo == "# Diseñar\nCuerpo." and len(skill.sha256) == 12
    assert prompt_de_sistema(skill).startswith("# Diseñar") and CONTRATO in prompt_de_sistema(skill)
    assert CONTRATO in prompt_de_sistema(None) and "Diseñar" not in prompt_de_sistema(None)
