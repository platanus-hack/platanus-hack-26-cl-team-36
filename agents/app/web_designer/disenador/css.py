"""El CSS de un tema: lectura, saneamiento como lo haría la extensión, ámbito `html.mi-tema` y riesgos.

El lector es pequeño y tolerante: entiende reglas, listas de selectores, at-reglas agrupadoras (`@media`,
`@supports`...), `@keyframes`, at-reglas de declaraciones (`@font-face`...) y anidamiento CSS. No valida
propiedades ni valores: eso queda para el navegador.

Saneamiento:
- Se descarta toda declaración que contenga algo que pueda cargar recursos o ejecutar código (`url(`,
  `image-set(`, `expression(`, `javascript:`, `behavior:`, `-moz-binding`) o una barra invertida; una regla cuyo
  selector tenga alguno de ellos se descarta entera; `@import` y las at-reglas sueltas que no son `@layer` también.
- Cada selector de primer nivel debe empezar por `html.mi-tema`. Si no, se antepone (`body` pasa a
  `html.mi-tema body`, `html`/`:root` a `html.mi-tema`) y se informa como violación. No se reescribe nada más:
  `!important` se conserva (el tema es una hoja de autor y lo necesita para ganarle al sitio).
"""

import re
from dataclasses import dataclass, field

AGRUPADORAS = {"media", "supports", "layer", "container", "document", "scope", "starting-style"}

PROHIBIDOS = [
    ("url(", re.compile(r"url\s*\(", re.I)),
    ("image-set(", re.compile(r"(?<![\w-])(?:-webkit-)?image(?:-set)?\s*\(", re.I)),
    ("@import", re.compile(r"@import", re.I)),
    ("barra invertida", re.compile(r"\\")),
    ("expression(", re.compile(r"expression\s*\(", re.I)),
    ("javascript:", re.compile(r"javascript\s*:", re.I)),
    ("behavior", re.compile(r"(?<![\w-])behavior\s*:", re.I)),
    ("-moz-binding", re.compile(r"-moz-binding", re.I)),
]

_AMBITO = re.compile(r"^html\.mi-tema(?![\w-])")
_UNIVERSAL = re.compile(r"(^|[\s>+~(,])\*")
_LAYOUT = re.compile(
    r"(?<![\w-])(all|width|height|min-width|min-height|max-width|max-height|top|left|right|bottom|inset|"
    r"margin(?:-[a-z]+)?|padding(?:-[a-z]+)?|font-size|line-height|border(?:-[a-z]+)?-width|flex(?:-[a-z]+)?|"
    r"grid(?:-[a-z]+)*)(?![\w-])",
    re.I,
)
_SIN_PROPIEDAD = re.compile(
    r"^(ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|steps\(.*\)|cubic-bezier\(.*\)|"
    r"allow-discrete|normal|[\d.]+m?s)$",
    re.I,
)


@dataclass
class Regla:
    selectores: list[str]
    declaraciones: list[str] = field(default_factory=list)
    anidadas: list["Regla"] = field(default_factory=list)


@dataclass
class AtBloque:
    """@media, @supports, @keyframes...: un bloque con reglas adentro."""

    nombre: str
    preludio: str
    hijos: list = field(default_factory=list)


@dataclass
class AtDeclaraciones:
    """@font-face, @page, @property...: un bloque de declaraciones."""

    nombre: str
    preludio: str
    declaraciones: list[str] = field(default_factory=list)


@dataclass
class AtSentencia:
    """@import, @layer a, b; @charset...: sin bloque."""

    nombre: str
    texto: str


@dataclass
class Suelto:
    """Texto que no forma una regla (llaves desbalanceadas, declaraciones fuera de una regla)."""

    texto: str


# ---------------------------------------------------------------------------
# Lectura
# ---------------------------------------------------------------------------

def quitar_comentarios(css: str) -> str:
    salida, i, comilla = [], 0, None
    while i < len(css):
        c = css[i]
        if comilla:
            salida.append(c)
            if c == "\\" and i + 1 < len(css):
                salida.append(css[i + 1])
                i += 2
                continue
            if c == comilla:
                comilla = None
        elif c in "\"'":
            comilla = c
            salida.append(c)
        elif css.startswith("/*", i):
            fin = css.find("*/", i + 2)
            i = len(css) if fin < 0 else fin + 2
            continue
        else:
            salida.append(c)
        i += 1
    return "".join(salida)


def _escanear(texto: str, i: int, paradas: str) -> tuple[str, int, str]:
    """Avanza hasta un carácter de `paradas` fuera de comillas y paréntesis: (fragmento, índice, carácter)."""
    inicio, profundidad, comilla = i, 0, None
    while i < len(texto):
        c = texto[i]
        if comilla:
            if c == "\\":
                i += 2
                continue
            if c == comilla:
                comilla = None
        elif c in "\"'":
            comilla = c
        elif c in "([":
            profundidad += 1
        elif c in ")]":
            profundidad = max(0, profundidad - 1)
        elif profundidad == 0 and c in paradas:
            return texto[inicio:i], i, c
        i += 1
    return texto[inicio:], i, ""


def dividir_selectores(preludio: str) -> list[str]:
    selectores, i = [], 0
    while i <= len(preludio):
        parte, i, c = _escanear(preludio, i, ",")
        if parte.strip():
            selectores.append(" ".join(parte.split()))
        if not c:
            break
        i += 1
    return selectores


def _saltar_espacios(texto: str, i: int) -> int:
    while i < len(texto) and texto[i] in " \t\r\n;":
        i += 1
    return i


def _leer_cuerpo(texto: str, i: int) -> tuple[list[str], list[Regla], int]:
    """Declaraciones y reglas anidadas hasta la `}` que cierra el bloque."""
    declaraciones, anidadas = [], []
    while True:
        i = _saltar_espacios(texto, i)
        if i >= len(texto):
            return declaraciones, anidadas, i
        if texto[i] == "}":
            return declaraciones, anidadas, i + 1
        fragmento, j, c = _escanear(texto, i, "{;}")
        if c == "{":
            sub_declaraciones, sub_anidadas, i = _leer_cuerpo(texto, j + 1)
            anidadas.append(Regla([" ".join(fragmento.split())], sub_declaraciones, sub_anidadas))
            continue
        if fragmento.strip():
            declaraciones.append(fragmento.strip())
        i = j + 1 if c == ";" else j


def _leer_lista(texto: str, i: int) -> tuple[list, int]:
    """Reglas y at-reglas hasta el final o la `}` que cierra el bloque agrupador."""
    items: list = []
    while True:
        i = _saltar_espacios(texto, i)
        if i >= len(texto):
            return items, i
        if texto[i] == "}":
            return items, i + 1
        if texto[i] == "@":
            preludio, j, c = _escanear(texto, i, "{;}")
            coincidencia = re.match(r"@([\w-]+)", preludio)
            nombre = coincidencia.group(1).lower() if coincidencia else ""
            resto = preludio[len(nombre) + 1:].strip()
            if c != "{":
                items.append(AtSentencia(nombre, preludio.strip()))
                i = j + 1 if c == ";" else j
            elif nombre in AGRUPADORAS or nombre.endswith("keyframes"):
                hijos, i = _leer_lista(texto, j + 1)
                items.append(AtBloque(nombre, resto, hijos))
            else:
                declaraciones, _, i = _leer_cuerpo(texto, j + 1)
                items.append(AtDeclaraciones(nombre, resto, declaraciones))
            continue
        preludio, j, c = _escanear(texto, i, "{;}")
        if c != "{":
            if preludio.strip():
                items.append(Suelto(preludio.strip()))
            if c == "}":
                return items, j + 1  # cierra el bloque que contenía el texto suelto
            i = j + 1 if c == ";" else j
            continue
        declaraciones, anidadas, i = _leer_cuerpo(texto, j + 1)
        items.append(Regla(dividir_selectores(preludio), declaraciones, anidadas))


def leer(css: str) -> list:
    """El árbol del CSS. Una `}` sobrante en el primer nivel se ignora."""
    texto, items, i = quitar_comentarios(css), [], 0
    while i < len(texto):
        parte, i = _leer_lista(texto, i)
        items.extend(parte)
    return items


# ---------------------------------------------------------------------------
# Escritura
# ---------------------------------------------------------------------------

def _escribir_bloque(cabecera: str, declaraciones: list[str], anidadas: list[Regla], nivel: int) -> str:
    sangria = "  " * nivel
    lineas = [f"{sangria}{cabecera} {{"]
    lineas += [f"{sangria}  {declaracion};" for declaracion in declaraciones]
    lineas += [_escribir_regla(regla, nivel + 1) for regla in anidadas]
    lineas.append(f"{sangria}}}")
    return "\n".join(lineas)


def _escribir_regla(regla: Regla, nivel: int) -> str:
    return _escribir_bloque(", ".join(regla.selectores), regla.declaraciones, regla.anidadas, nivel)


def escribir(items: list, nivel: int = 0) -> str:
    partes = []
    sangria = "  " * nivel
    for item in items:
        if isinstance(item, Regla):
            partes.append(_escribir_regla(item, nivel))
        elif isinstance(item, AtBloque):
            cabecera = f"@{item.nombre} {item.preludio}".strip()
            partes.append(f"{sangria}{cabecera} {{\n{escribir(item.hijos, nivel + 1)}\n{sangria}}}")
        elif isinstance(item, AtDeclaraciones):
            partes.append(_escribir_bloque(f"@{item.nombre} {item.preludio}".strip(), item.declaraciones, [], nivel))
        elif isinstance(item, AtSentencia):
            partes.append(f"{sangria}{item.texto};")
    return "\n".join(partes)


# ---------------------------------------------------------------------------
# Saneamiento y ámbito
# ---------------------------------------------------------------------------

@dataclass
class Saneado:
    css: str
    arbol: list
    rechazos: list[dict]            # {motivo, texto}
    fuera_de_ambito: list[dict]     # {selector, corregido}


def prohibido_en(texto: str) -> str | None:
    for motivo, patron in PROHIBIDOS:
        if patron.search(texto):
            return motivo
    return None


def con_ambito(selector: str) -> str | None:
    """El selector bajo `html.mi-tema`, o None si ya lo estaba."""
    if _AMBITO.match(selector):
        return None
    for inicio in (":root", "html"):
        if re.match(rf"^{inicio}(?![\w-])", selector, re.I):
            return "html.mi-tema" + selector[len(inicio):]
    return f"html.mi-tema {selector}"


def _recortar(texto: str) -> str:
    return texto if len(texto) <= 160 else texto[:157] + "..."


def _sanear_declaraciones(declaraciones: list[str], rechazos: list[dict]) -> list[str]:
    limpias = []
    for declaracion in declaraciones:
        motivo = prohibido_en(declaracion)
        if motivo:
            rechazos.append({"motivo": motivo, "texto": _recortar(declaracion)})
        else:
            limpias.append(declaracion)
    return limpias


def _sanear_regla(regla: Regla, rechazos: list[dict], fuera: list[dict] | None) -> Regla | None:
    """`fuera` es None dentro de @keyframes y en reglas anidadas: ahí no se exige el ámbito."""
    texto_selectores = ", ".join(regla.selectores)
    motivo = prohibido_en(texto_selectores)
    if motivo:
        rechazos.append({"motivo": f"{motivo} en el selector", "texto": _recortar(texto_selectores)})
        return None
    selectores = regla.selectores
    if fuera is not None:
        selectores = []
        for selector in regla.selectores:
            corregido = con_ambito(selector)
            if corregido:
                fuera.append({"selector": selector, "corregido": corregido})
            selectores.append(corregido or selector)
    declaraciones = _sanear_declaraciones(regla.declaraciones, rechazos)
    anidadas = [r for r in (_sanear_regla(sub, rechazos, None) for sub in regla.anidadas) if r]
    if not declaraciones and not anidadas and (regla.declaraciones or regla.anidadas):
        return None  # quedó vacía por los rechazos
    return Regla(selectores, declaraciones, anidadas)


def _sanear_lista(items: list, rechazos: list[dict], fuera: list[dict] | None) -> list:
    limpios = []
    for item in items:
        if isinstance(item, Regla):
            regla = _sanear_regla(item, rechazos, fuera)
            if regla:
                limpios.append(regla)
        elif isinstance(item, AtBloque):
            motivo = prohibido_en(item.preludio)
            if motivo:
                rechazos.append({"motivo": f"{motivo} en @{item.nombre}", "texto": _recortar(item.preludio)})
                continue
            en_keyframes = item.nombre.endswith("keyframes")
            hijos = _sanear_lista(item.hijos, rechazos, None if en_keyframes else fuera)
            if hijos:
                limpios.append(AtBloque(item.nombre, item.preludio, hijos))
        elif isinstance(item, AtDeclaraciones):
            declaraciones = _sanear_declaraciones(item.declaraciones, rechazos)
            if declaraciones:
                limpios.append(AtDeclaraciones(item.nombre, item.preludio, declaraciones))
        elif isinstance(item, AtSentencia):
            motivo = "@import" if item.nombre == "import" else prohibido_en(item.texto)
            if motivo or item.nombre != "layer":
                rechazos.append({"motivo": motivo or f"@{item.nombre} no permitida", "texto": _recortar(item.texto)})
            else:
                limpios.append(item)
        elif isinstance(item, Suelto) and item.texto:
            rechazos.append({"motivo": "texto fuera de una regla", "texto": _recortar(item.texto)})
    return limpios


def sanear(css: str) -> Saneado:
    """`css` es el texto ya decodificado del JSON (un `\\n` del JSON es un salto de línea, no una barra)."""
    css = re.sub(r"^\s*```[a-z]*\s*\n|\n\s*```\s*$", "", css)  # por si el modelo lo envolvió en un bloque
    rechazos: list[dict] = []
    fuera: list[dict] = []
    arbol = _sanear_lista(leer(css), rechazos, fuera)
    return Saneado(escribir(arbol) + "\n", arbol, rechazos, fuera)


# ---------------------------------------------------------------------------
# Riesgos
# ---------------------------------------------------------------------------

def _reglas(items: list):
    for item in items:
        if isinstance(item, Regla):
            yield item
            yield from _reglas(item.anidadas)
        elif isinstance(item, AtBloque):
            yield from _reglas(item.hijos)


def _transicion_de_layout(propiedad: str, valor: str) -> bool:
    if propiedad == "transition-property":
        return bool(_LAYOUT.search(valor))
    for tramo in valor.split(","):
        palabras = [p for p in tramo.replace("!important", "").split() if not _SIN_PROPIEDAD.match(p)]
        if not palabras or _LAYOUT.fullmatch(palabras[0]):
            return True  # sin propiedad, la transición es de `all`
    return False


def analizar(saneado: Saneado) -> dict:
    """Tamaño y cosas riesgosas del CSS ya saneado, más las violaciones y rechazos del saneamiento."""
    cuenta = {
        "reglas": 0, "selectores": 0, "declaraciones": 0, "important": 0, "filtros": 0, "backdrop_filter": 0,
        "selectores_universales": 0, "transiciones_de_layout": 0, "position_fixed": 0, "ocultan_elementos": 0,
        "animaciones": 0,
    }
    for regla in _reglas(saneado.arbol):
        cuenta["reglas"] += 1
        cuenta["selectores"] += len(regla.selectores)
        cuenta["selectores_universales"] += sum(1 for s in regla.selectores if _UNIVERSAL.search(s))
        for declaracion in regla.declaraciones:
            cuenta["declaraciones"] += 1
            propiedad, _, valor = declaracion.partition(":")
            propiedad, valor = propiedad.strip().lower(), valor.strip().lower()
            sin_important = valor.replace("!important", "").strip()
            cuenta["important"] += "!important" in valor
            if propiedad in ("filter", "-webkit-filter") and sin_important != "none":
                cuenta["filtros"] += 1
            if propiedad in ("backdrop-filter", "-webkit-backdrop-filter") and sin_important != "none":
                cuenta["backdrop_filter"] += 1
            if propiedad in ("transition", "transition-property") and _transicion_de_layout(propiedad, sin_important):
                cuenta["transiciones_de_layout"] += 1
            if propiedad == "position" and sin_important == "fixed":
                cuenta["position_fixed"] += 1
            if (propiedad == "display" and sin_important == "none") or (
                propiedad == "visibility" and sin_important == "hidden"
            ):
                cuenta["ocultan_elementos"] += 1
            if propiedad in ("animation", "animation-name"):
                cuenta["animaciones"] += 1
    return {
        "bytes": len(saneado.css.encode()),
        **cuenta,
        "fuera_de_mi_tema": saneado.fuera_de_ambito,
        "rechazos": saneado.rechazos,
    }
