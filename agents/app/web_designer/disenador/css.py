"""El CSS de un tema: lectura, saneamiento como lo haría la extensión, ámbito `html.mi-tema` y riesgos.

El lector es pequeño y tolerante: entiende reglas, listas de selectores, at-reglas agrupadoras (`@media`,
`@supports`...), `@keyframes`, at-reglas de declaraciones (`@font-face`...) y anidamiento CSS. No valida
propiedades ni valores: eso queda para el navegador.

Las cadenas se leen como el navegador: un salto de línea (o CR o FF) sin escapar termina la cadena (es una
"bad string"). Así el árbol corta las reglas donde las cortaría Chromium, y la cadena rota se marca para descartar
el fragmento que la contiene.

Saneamiento (se revisa cada texto que se vuelve a escribir: selectores, declaraciones y preludios de at-reglas):
- Se descarta todo texto que contenga algo que pueda cargar recursos o ejecutar código (`url(`, `src(`,
  `image(`/`image-set(`, `expression(`, `javascript:`, `behavior:`, `-moz-binding`, `@import`), una barra invertida,
  una cadena rota o sin cerrar, una llave o un comentario fuera de una cadena, o paréntesis o corchetes sin cerrar.
  Una declaración así se descarta sola; una regla cuyo selector la tenga, entera.
- Una cadena de más de `MAX_CADENA` caracteres (el texto de `content:`) también se descarta.
- Solo se aceptan las at-reglas `@media`, `@supports`, `@layer`, `@container` y `@keyframes`; las demás
  (`@font-face`, `@import`, `@namespace`, `@page`, `@property`, `@scope`...) se descartan enteras.
- Cada selector de primer nivel debe empezar por `html.mi-tema`. Si no, se antepone (`body` pasa a
  `html.mi-tema body`, `html`/`:root` a `html.mi-tema`) y se informa como violación. Una regla anidada debe empezar
  por `&` o no usarlo (`:not(&) b` saldría del ámbito y se descarta). No se reescribe nada más: `!important` se
  conserva (el tema es una hoja de autor y lo necesita para ganarle al sitio).

El navegador tiene la última palabra: `pagina.verificar_css` vuelve a leer el CSS saneado con el parser de Chromium.
"""

import re
from dataclasses import dataclass, field

AGRUPADORAS = {"media", "supports", "layer", "container", "document", "scope", "starting-style"}
PERMITIDAS = {"media", "supports", "layer", "container"}          # además de @keyframes
KEYFRAMES = {"keyframes", "-webkit-keyframes"}
MAX_CADENA = 200    # caracteres de una cadena (el texto de `content:`, o de una variable que lo lleve)

# Marca que deja la lectura donde una cadena terminó en un salto de línea o en el final del texto. Nunca se escribe:
# el fragmento que la contiene se descarta.
CADENA_ROTA = "\ue000"
_FIN_DE_CADENA = "\n\r\f"

PROHIBIDOS = [
    ("cadena rota", re.compile(CADENA_ROTA)),
    ("url(", re.compile(r"url\s*\(", re.I)),
    ("src(", re.compile(r"(?<![\w-])src\s*\(", re.I)),
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
    """Sin comentarios. Una cadena que termina en un salto de línea o en el final queda marcada con CADENA_ROTA."""
    salida, i, comilla = [], 0, None
    while i < len(css):
        c = css[i]
        if comilla:
            if c in _FIN_DE_CADENA:  # como en CSS: la cadena termina aquí, rota, y el salto queda fuera
                salida += [CADENA_ROTA, c]
                comilla = None
                i += 1
                continue
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
    if comilla:
        salida.append(CADENA_ROTA)
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
            if c == comilla or c in _FIN_DE_CADENA:
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
            preludio = " ".join(fragmento.split())
            selectores = [preludio] if preludio.startswith("@") else dividir_selectores(fragmento)
            anidadas.append(Regla(selectores, sub_declaraciones, sub_anidadas))
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


def _estructura(texto: str) -> str | None:
    """Lo que haría que el navegador corte el texto en otro lugar que esta lectura, o una cadena demasiado larga."""
    pila, comilla, inicio, i = [], None, 0, 0
    while i < len(texto):
        c = texto[i]
        if comilla:
            if c == "\\":
                i += 2
                continue
            if c in _FIN_DE_CADENA:
                return "cadena rota"
            if c == comilla:
                comilla = None
                if i - inicio - 1 > MAX_CADENA:
                    return "cadena demasiado larga"
        elif c in "\"'":
            comilla, inicio = c, i
        elif c in "{}":
            return "llave fuera de una cadena"
        elif texto.startswith("/*", i) or texto.startswith("*/", i):
            return "comentario"
        elif c in "([":
            pila.append(")" if c == "(" else "]")
        elif c in ")]" and (not pila or pila.pop() != c):
            return "paréntesis o corchetes desbalanceados"
        i += 1
    if comilla:
        return "cadena rota"
    if pila:
        return "paréntesis o corchetes desbalanceados"
    return None


def prohibido_en(texto: str) -> str | None:
    """Por qué no se puede escribir este texto (selector, declaración o preludio), o None si se puede."""
    for motivo, patron in PROHIBIDOS:
        if patron.search(texto):
            return motivo
    return _estructura(texto)


def con_ambito(selector: str) -> str | None:
    """El selector bajo `html.mi-tema`, o None si ya lo estaba."""
    if _AMBITO.match(selector):
        return None
    for inicio in (":root", "html"):
        if re.match(rf"^{inicio}(?![\w-])", selector, re.I):
            return "html.mi-tema" + selector[len(inicio):]
    return f"html.mi-tema {selector}"


def _recortar(texto: str) -> str:
    texto = texto.replace(CADENA_ROTA, "")
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


def _sanear_regla(regla: Regla, rechazos: list[dict], fuera: list[dict], contexto: str) -> Regla | None:
    """`contexto`: "primer_nivel" (se exige `html.mi-tema`), "anidada" (dentro de otra regla, relativa a ella) o
    "keyframes" (`from`, `to`, `50%`: sin ámbito)."""
    texto_selectores = ", ".join(regla.selectores)
    motivo = prohibido_en(texto_selectores)
    if not motivo and contexto == "anidada":
        nombre = re.match(r"@([\w-]+)", texto_selectores)
        if nombre and nombre.group(1).lower() not in PERMITIDAS:
            motivo = f"@{nombre.group(1).lower()} no permitida"
        elif not nombre and any("&" in s and not s.startswith("&") for s in regla.selectores):
            motivo = "& fuera del inicio de una regla anidada"
    if motivo:
        rechazos.append({"motivo": f"{motivo} en el selector", "texto": _recortar(texto_selectores)})
        return None
    selectores = regla.selectores
    if contexto == "primer_nivel":
        selectores = []
        for selector in regla.selectores:
            corregido = con_ambito(selector)
            if corregido:
                fuera.append({"selector": selector, "corregido": corregido})
            selectores.append(corregido or selector)
    declaraciones = _sanear_declaraciones(regla.declaraciones, rechazos)
    anidadas = [r for r in (_sanear_regla(sub, rechazos, fuera, "anidada") for sub in regla.anidadas) if r]
    if not declaraciones and not anidadas and (regla.declaraciones or regla.anidadas):
        return None  # quedó vacía por los rechazos
    return Regla(selectores, declaraciones, anidadas)


def _sanear_lista(items: list, rechazos: list[dict], fuera: list[dict], en_keyframes: bool = False) -> list:
    limpios = []
    for item in items:
        if isinstance(item, Regla):
            regla = _sanear_regla(item, rechazos, fuera, "keyframes" if en_keyframes else "primer_nivel")
            if regla:
                limpios.append(regla)
        elif isinstance(item, AtBloque):
            if en_keyframes or item.nombre not in PERMITIDAS | KEYFRAMES:
                motivo = f"@{item.nombre} no permitida" + (" en @keyframes" if en_keyframes else "")
                rechazos.append({"motivo": motivo, "texto": _recortar(f"@{item.nombre} {item.preludio}")})
                continue
            motivo = prohibido_en(item.preludio)
            if motivo:
                rechazos.append({"motivo": f"{motivo} en @{item.nombre}", "texto": _recortar(item.preludio)})
                continue
            hijos = _sanear_lista(item.hijos, rechazos, fuera, item.nombre in KEYFRAMES)
            if hijos:
                limpios.append(AtBloque(item.nombre, item.preludio, hijos))
        elif isinstance(item, AtDeclaraciones):
            rechazos.append({"motivo": f"@{item.nombre} no permitida",
                             "texto": _recortar(f"@{item.nombre} {item.preludio}")})
        elif isinstance(item, AtSentencia):
            motivo = "@import" if item.nombre == "import" else prohibido_en(item.texto)
            if motivo or item.nombre != "layer" or en_keyframes:
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
