"""Saneamiento, ámbito html.mi-tema y riesgos del CSS; lectura del skill y del JSON del modelo."""

from disenador.css import CADENA_ROTA, analizar, con_ambito, quitar_comentarios, sanear
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
                       "barra invertida en el selector", "@font-face no permitida", "@charset no permitida"]
    assert "color: #eee !important;" in saneado.css
    assert "html.mi-tema .b {\n  color: red;\n}" in saneado.css
    assert "html.mi-tema a" not in saneado.css  # quedó vacía
    for prohibido in ("url(", "@import", "\\", "expression(", "javascript:"):
        assert prohibido not in saneado.css


def test_ambito_en_media_y_no_en_keyframes_ni_anidadas():
    css = """@media (max-width: 600px) { nav { display: none } }
    @keyframes mt-aparecer { from { opacity: 0 } to { opacity: 1 } }
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


# Las dos cargas de la revisión: un salto de línea dentro de una cadena la termina en CSS, y antes el lector la seguía
# hasta la comilla siguiente, así que el navegador veía reglas que el saneamiento no.
CARGA_FONT_FACE = '@font-face "\n;html.mi-tema body{background:url(https://evil.example/b)} " {font-family:a}'
CARGA_CONTENT = 'html.mi-tema a{content:"x\n} *{display:none !important} "}'
CARGA_LAYER = '@layer "\n;body{background:url(https://evil.example/c)} html.mi-tema q{color:blue}'


def test_cadena_con_salto_de_linea_se_rechaza():
    saneado = sanear(CARGA_FONT_FACE)
    assert saneado.css.strip() == ""
    assert [r["motivo"] for r in saneado.rechazos] == ["cadena rota", "url(", "texto fuera de una regla"]

    # La regla que Chromium ve después de la cadena rota se lee igual aquí: queda bajo html.mi-tema y es violación.
    saneado = sanear(CARGA_CONTENT)
    assert saneado.css == "html.mi-tema * {\n  display:none !important;\n}\n"
    assert saneado.fuera_de_ambito == [{"selector": "*", "corregido": "html.mi-tema *"}]
    assert [r["motivo"] for r in saneado.rechazos] == ["cadena rota", "texto fuera de una regla"]

    saneado = sanear(CARGA_LAYER)
    assert "evil" not in saneado.css and "@layer" not in saneado.css
    assert "html.mi-tema q" in saneado.css
    assert [r["motivo"] for r in saneado.rechazos] == ["cadena rota", "url("]

    for salto in ("\r", "\f"):
        assert sanear(f'html.mi-tema a {{ content: "x{salto}y"; color: red }}').rechazos[0]["motivo"] == "cadena rota"
    assert sanear('html.mi-tema a { content: "sin cerrar').rechazos[0]["motivo"] == "cadena rota"
    # La comilla final abre otra cadena que llega al final del texto: también rota.
    assert quitar_comentarios('a{content:"x\n/* c */"}') == 'a{content:"x' + CADENA_ROTA + '\n"}' + CADENA_ROTA


def test_solo_at_reglas_permitidas():
    css = """@font-face { font-family: a; }
    @page { margin: 0 }
    @namespace svg x;
    @property --x { syntax: '<color>'; inherits: false; initial-value: red; }
    @scope (body) { a { color: red } }
    @starting-style { html.mi-tema a { opacity: 0 } }
    @media (min-width: 600px) { html.mi-tema a { color: red } }
    @supports (display: grid) { html.mi-tema b { display: grid } }
    @layer tema { html.mi-tema c { color: red } }
    @layer base, tema;
    @container (min-width: 1px) { html.mi-tema d { color: red } }
    @keyframes mt-k { from { opacity: 0 } @media (x) { a { b: c } } to { opacity: 1 } }
    @keyframes fadeIn { from { opacity: 0 } to { opacity: 0 } }
    @-webkit-keyframes spin { to { opacity: 0 } }
    html.mi-tema e { color: red; @media (x) { color: blue } @font-face { font-family: b } @layer x { color: red } }"""
    saneado = sanear(css)
    motivos = [r["motivo"] for r in saneado.rechazos]
    # @layer y los nombres de @keyframes son globales: con el tema apagado seguirían cambiando el sitio.
    assert motivos == ["@font-face no permitida", "@page no permitida", "@namespace no permitida",
                       "@property no permitida", "@scope no permitida", "@starting-style no permitida",
                       "@layer no permitida", "@layer no permitida", "@media no permitida en @keyframes",
                       "@keyframes sin el prefijo mt-", "@-webkit-keyframes sin el prefijo mt-",
                       "@font-face no permitida en el selector", "@layer no permitida en el selector"]
    for permitida in ("@media (min-width: 600px)", "@supports (display: grid)", "@container (min-width: 1px)",
                      "@keyframes mt-k", "@media (x)"):
        assert permitida in saneado.css, permitida
    for global_ in ("@layer", "fadeIn", "spin"):
        assert global_ not in saneado.css, global_


def test_estructura_y_recursos():
    css = f"""html.mi-tema a {{ color: f({{); background: src("x.png"); content: "{'x' * 201}"; height: 1px); }}
    html.mi-tema b {{ color: red; :not(&) i {{ color: red }} &:hover, .c {{ color: blue }} }}
    html.mi-tema d {{ content: "{'y' * 200}"; }}
    html.mi-tema z {{ width: calc(1px; }} html.mi-tema y {{ color: red }}"""
    saneado = sanear(css)
    # Un paréntesis sin cerrar se traga el resto, como en el navegador: el último fragmento lleva llaves.
    assert [r["motivo"] for r in saneado.rechazos] == [
        "llave fuera de una cadena", "src(", "cadena demasiado larga", "paréntesis o corchetes desbalanceados",
        "& fuera del inicio de una regla anidada en el selector", "llave fuera de una cadena",
    ]
    assert "html.mi-tema a" not in saneado.css and ":not(&)" not in saneado.css
    assert "&:hover, .c {" in saneado.css and "y" * 200 in saneado.css
