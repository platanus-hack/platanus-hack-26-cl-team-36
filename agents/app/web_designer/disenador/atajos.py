"""Los componentes del kit que salen de lo medido, sin modelo: el `atajo`, el `lanzador` y el `buscador`.

- Atajo: una ruta verificada de la Guía que solo elige opciones (`select`) y termina en una URL con consulta (el deep
  link, p. ej. `/el-viaje/planificador/?inicio=SP&fin=EL`). Cada clave de la consulta es un campo cuyas opciones se
  copian del `<select>` de la página que le corresponde; una clave sin `<select>` va fija en el enlace. Si la Guía
  envió el formulario sin elegir nada (con lo que traía), valen solo las claves que nombran un `<select>` de la página.
- Lanzador: los objetivos del catálogo, cada uno con la URL a la que llegó la Guía o su `entry`; si llegó enviando un
  formulario, sin la consulta (las elecciones de esa corrida, como un viaje SP→EL). Primero los que
  tienen ruta verificada (el enlace lleva de verdad a la tarea), después los que menos lograron los Visitantes (donde
  un atajo ayuda más) y, a igual medida, los más prominentes del catálogo.
- Buscador: todos los objetivos del catálogo con enlace (hasta `MAX_BUSCADOR`, también el del atajo), con el mismo
  título y detalle que el lanzador y, si el catálogo los agrupa (`parent`), el título del objetivo padre como grupo.

Todos los enlaces quedan como rutas relativas del mismo sitio; lo que apunta a otro sitio no entra.
"""

import re
from dataclasses import dataclass
from urllib.parse import parse_qsl, urljoin, urlsplit

from shared.nodes.urls import site_host

ID_LANZADOR = "tareas"
MAX_TAREAS = 8
MOSTRAR_TAREAS = 6
ID_BUSCADOR = "buscar"
MAX_BUSCADOR = 40
_PROMINENCIA = {"primary": 0, "secondary": 1, "buried": 2}
_ELECCIONES = {"select", "check", "uncheck"}
_ROLES_ELECCION = {"combobox", "listbox", "option", "radio", "checkbox"}
_ID_CSS = re.compile(r"^#([A-Za-z][\w-]*)$")
_TITULO_MAX = 48
_TITULO_PALABRAS = 6
_ENLACES = {"a", "al", "como", "con", "cuando", "de", "del", "desde", "donde", "e", "el", "en", "entre", "hacia",
            "hasta", "la", "las", "lo", "los", "mediante", "mi", "mis", "ni", "o", "para", "por", "que", "según", "sin",
            "sobre", "su", "sus", "todas", "todos", "tu", "tus", "u", "un", "una", "unos", "unas", "y"}
_GERUNDIO = re.compile(r"\w{2,}(?:ando|iendo|yendo)$", re.I)
_RELLENO = re.compile(r"\b(?:informaci[oó]n|detalles|datos) (?:sobre|acerca de) (?=\w)", re.I)
_DE_FORMULARIO = {"select", "check", "uncheck", "fill", "type", "press"}


@dataclass
class SelectDePagina:
    """Un `<select>` de la página abierta: un selector que lo encuentra, su id y name, y sus opciones usables; y la
    voz del sitio a su alrededor: el texto de su opción vacía, el título de su sección y el del botón que lo envía."""

    selector: str
    id: str = ""
    name: str = ""
    etiqueta: str = ""
    valores: tuple[str, ...] = ()
    elegido: str = ""
    vacia: str = ""
    seccion: str = ""
    boton: str = ""


def mismo_sitio(url: str | None, inicio: str) -> str | None:
    """`url` como ruta relativa (con consulta y fragmento) si es del sitio de `inicio`; si no, None."""
    if not url:
        return None
    try:
        url = urljoin(inicio, url)
        partes = urlsplit(url)
        if partes.scheme not in ("http", "https") or site_host(url) != site_host(inicio):
            return None
    except ValueError:
        return None
    ruta = "/" + partes.path.lstrip("/")
    return ruta + (f"?{partes.query}" if partes.query else "") + (f"#{partes.fragment}" if partes.fragment else "")


def ruta_de(url: str) -> str:
    """La ruta de `url` tal cual la ve el navegador en `location.pathname`, con su barra final si la tiene."""
    return urlsplit(url).path or "/"


def misma_ruta(a: str, b: str) -> bool:
    """Si dos rutas son la misma página: la barra final no cuenta, como en `features/vista.js`."""
    return a.rstrip("/") == b.rstrip("/")


def id_de_vista(texto: str) -> str:
    limpio = re.sub(r"[^a-z0-9]+", "-", texto.lower()).strip("-")
    limpio = re.sub(r"^[^a-z]+", "", limpio)[:40].rstrip("-")
    return limpio or "vista"


def _es_eleccion(paso: dict) -> bool:
    objetivo = paso.get("target") or {}
    return paso.get("action") in _ELECCIONES or (
        paso.get("action") == "click"
        and (objetivo.get("tag") in ("select", "option") or objetivo.get("role") in _ROLES_ELECCION))


def _selectores_de_ruta(pasos: list[dict]) -> list[str]:
    """Los selectores CSS por id de los `<select>` que eligió la ruta, en orden."""
    selectores = []
    for paso in pasos:
        if paso.get("action") != "select":
            continue
        for localizador in paso.get("locators") or []:
            valor = str(localizador.get("value") or "")
            if localizador.get("by") == "css" and _ID_CSS.match(valor) and valor not in selectores:
                selectores.append(valor)
    return selectores


def _campo_para(clave: str, valor: str, selects: list[SelectDePagina], de_ruta: list[str],
                usados: set[str], solo_nombre: bool = False) -> SelectDePagina | None:
    libres = [s for s in selects if s.selector not in usados]
    for s in libres:
        if clave in (s.name, s.id):
            return s
    if solo_nombre:
        return None
    for s in libres:
        if s.selector in de_ruta and valor in s.valores:
            return s
    con_valor = [s for s in libres if valor in s.valores]
    if len(con_valor) == 1:
        return con_valor[0]
    if not selects:
        # Sin la página abierta, solo se confía en un localizador de la ruta que nombra la clave.
        selector = f"#{clave}"
        return SelectDePagina(selector, id=clave) if selector in de_ruta and selector not in usados else None
    return None


def atajo(objetivo_id: str, route: dict, selects: list[SelectDePagina], inicio: str) -> tuple[dict | None, str]:
    """La vista `atajo` de una ruta, o None con la razón por la que no sirve."""
    if not isinstance(route, dict) or route.get("status") != "verified":
        return None, "la ruta no está verificada"
    pasos = [p for p in route.get("steps") or [] if isinstance(p, dict)]
    if not pasos:
        return None, "la ruta no tiene pasos"
    final = pasos[-1].get("url_after") or ""
    destino = mismo_sitio(final, inicio)
    consulta = parse_qsl(urlsplit(final).query, keep_blank_values=False)
    if not destino or not consulta:
        return None, "la ruta no termina en una URL con consulta del mismo sitio"
    elecciones = pasos[:-1]
    if not all(_es_eleccion(p) for p in elecciones):
        return None, "la ruta hace algo más que elegir opciones"
    # Sin `select` la Guía envió el formulario con lo que traía: solo cuenta la clave que nombra un `<select>`.
    solo_nombre = not any(p.get("action") == "select" for p in elecciones)
    paginas = {ruta_de(p.get("url_before") or "").rstrip("/") for p in elecciones or pasos}
    origen = (elecciones or pasos)[0].get("url_before") or ""
    if len(paginas) != 1 or not mismo_sitio(origen, inicio):
        return None, "las elecciones no ocurren en una sola página del sitio"
    pagina = ruta_de(origen)
    # Los `<select>` leídos son los de la página abierta: si el atajo va en otra, solo valen los de la ruta.
    selects = selects if misma_ruta(pagina, ruta_de(inicio)) else []

    de_ruta = _selectores_de_ruta(elecciones)
    campos, fijos, usados, por_nombre = [], {}, set(), {}
    for clave, valor in consulta:
        select = _campo_para(clave, valor, selects, de_ruta, usados, solo_nombre)
        if select is None:
            fijos[clave] = valor
            continue
        usados.add(select.selector)
        por_nombre[clave] = select
        etiqueta = select.etiqueta or clave.capitalize()
        vacio = bool(select.valores) and select.elegido not in select.valores
        campos.append({"nombre": clave, "etiqueta": {"es": etiqueta, "en": etiqueta}, "opciones": select.selector,
                       "requerido": select.selector in de_ruta or vacio})
    if not campos:
        return None, "ninguna clave de la consulta tiene un <select> en la página"

    opciones: dict = {"destino": urlsplit(destino).path}
    if fijos:
        opciones["fijos"] = fijos
    # Dos campos con las mismas opciones (origen y destino) se pueden intercambiar; elegir uno obliga al otro.
    for i, a in enumerate(campos):
        par = next((b for b in campos[i + 1:] if len(por_nombre[a["nombre"]].valores) > 1
                    and set(por_nombre[a["nombre"]].valores) == set(por_nombre[b["nombre"]].valores)), None)
        if par:
            opciones["invertir"] = [a["nombre"], par["nombre"]]
            if a["requerido"] or par["requerido"]:
                a["requerido"] = par["requerido"] = True
            break
    return {
        "id": id_de_vista(objetivo_id),
        "rutas": [pagina],
        "contenedor": f"body > :has({campos[0]['opciones']})",
        "reemplazar": False,
        "componente": "atajo",
        "datos": campos,
        "opciones": opciones,
    }, ""


def _titulo(descripcion: str) -> str:
    """La primera frase de la descripción hasta su primer gerundio («ingresando…») y sin «información sobre», en
    hasta `_TITULO_PALABRAS` palabras y `_TITULO_MAX` caracteres, sin terminar en preposición, artículo ni
    conjunción."""
    texto = re.split(r"[.;:(,]", " ".join(descripcion.split()), maxsplit=1)[0].strip()
    texto = _RELLENO.sub("", texto)
    palabras = []
    for palabra in texto.split(" "):
        # Tras un artículo o preposición no es gerundio sino sustantivo («el arriendo»).
        gerundio = palabras and palabras[-1].lower() not in _ENLACES and _GERUNDIO.match(palabra)
        # «Línea 7», «Línea A»: el nombre propio no se corta antes de su número o letra.
        nombre = (palabras and palabras[-1][:1].isupper() and len(palabra) <= 3
                  and (palabra.isdigit() or palabra.isupper()))
        if gerundio or (not nombre and len(palabras) >= _TITULO_PALABRAS) \
                or len(" ".join([*palabras, palabra])) > _TITULO_MAX:
            break
        palabras.append(palabra)
    while len(palabras) > 1 and palabras[-1].lower() in _ENLACES and not palabras[-1].isupper():
        palabras.pop()
    return " ".join(palabras) or texto[:_TITULO_MAX]


def llegada(route: dict | None) -> str | None:
    if not isinstance(route, dict) or route.get("status") != "verified":
        return None
    pasos = [p for p in route.get("steps") or [] if isinstance(p, dict)]
    return pasos[-1].get("url_after") if pasos else None


def _de_formulario(route: dict) -> bool:
    """Si la ruta llega enviando un formulario: elige o escribe algo, o termina en un clic que no es un enlace."""
    pasos = [p for p in route.get("steps") or [] if isinstance(p, dict)]
    ultimo = (pasos[-1].get("target") or {}) if pasos else {}
    return any(p.get("action") in _DE_FORMULARIO or _es_eleccion(p) for p in pasos) or (
        bool(pasos) and ultimo.get("tag") != "a" and not ultimo.get("href"))


def _enlace(goal, rutas: dict[str, dict], inicio: str) -> tuple[str | None, bool]:
    """El enlace relativo de un objetivo (adonde llegó la Guía, o su `entry`) y si viene de una ruta verificada; None
    si sale del sitio o es la misma página abierta sin consulta. Si la Guía llegó enviando un formulario, su consulta
    son las elecciones de esa corrida (un viaje SP→EL): el enlace es la página sin ella."""
    route = rutas.get(goal.id)
    llego, entrada = mismo_sitio(llegada(route), inicio), mismo_sitio(goal.entry, inicio)
    if llego and "?" in llego and _de_formulario(route):
        llego = urlsplit(llego).path
    for enlace in (llego, entrada):
        if enlace and not (misma_ruta(ruta_de(enlace), ruta_de(inicio)) and "?" not in enlace):
            return enlace, enlace == llego
    return None, False


def _tarea(goal, enlace: str) -> dict:
    titulo = _titulo(goal.description)
    tarea = {"titulo": {"es": titulo, "en": titulo}, "enlace": enlace}
    detalle = " ".join(goal.description.split()).rstrip(".")
    if detalle and detalle != titulo:
        tarea["detalle"] = {"es": detalle[:160], "en": detalle[:160]}
    return tarea


def _ordenadas(goals: list, rutas: dict[str, dict], inicio: str, excluir: set[str],
               tasas: dict[str, float | None] | None = None) -> list[tuple[str, object]]:
    """`(enlace, goal)` sin enlaces repetidos, en orden lexicográfico: ruta verificada, menor tasa de llegada (sin
    medir cuenta como 0.5), mayor prominencia y el orden del catálogo."""
    candidatos = []
    for posicion, goal in enumerate(goals):
        if goal.id in excluir:
            continue
        enlace, verificada = _enlace(goal, rutas, inicio)
        if enlace:
            tasa = (tasas or {}).get(goal.id)
            clave = (not verificada, 0.5 if tasa is None else tasa, _PROMINENCIA.get(goal.prominence, 3), posicion)
            candidatos.append((clave, enlace, goal))
    ordenadas, vistos = [], set()
    for _, enlace, goal in sorted(candidatos, key=lambda c: c[0]):
        if enlace not in vistos:
            vistos.add(enlace)
            ordenadas.append((enlace, goal))
    return ordenadas


def lanzador(goals: list, rutas: dict[str, dict], inicio: str, excluir: set[str],
             tasas: dict[str, float | None] | None = None) -> dict | None:
    """La vista `lanzador` con los objetivos del catálogo (sin los de `excluir`), o None si ninguno tiene enlace.
    `tasas`: la tasa de llegada del Visitante por objetivo, si se midió."""
    ordenadas = _ordenadas(goals, rutas, inicio, excluir, tasas=tasas)
    tareas = [_tarea(goal, enlace) for enlace, goal in ordenadas[:MAX_TAREAS]]
    if not tareas:
        return None
    return {"id": ID_LANZADOR, "rutas": [ruta_de(inicio)], "contenedor": "main", "reemplazar": False,
            "componente": "lanzador", "datos": tareas, "opciones": {"max": MOSTRAR_TAREAS}}


def buscador(goals: list, rutas: dict[str, dict], inicio: str, catalogo: list | None = None) -> dict | None:
    """La vista `buscador` con los objetivos de `goals` que tienen enlace, o None si ninguno. `catalogo`: todos los
    objetivos, también los de nivel resumen, para nombrar el grupo de cada uno por su `parent`."""
    grupos = {g.id: _titulo(g.description) for g in catalogo or goals}
    tareas = []
    for enlace, goal in _ordenadas(goals, rutas, inicio, set())[:MAX_BUSCADOR]:
        tarea = _tarea(goal, enlace)
        if grupo := grupos.get(goal.parent or ""):
            tarea["grupo"] = {"es": grupo, "en": grupo}
        tareas.append(tarea)
    if not tareas:
        return None
    opciones = {"max": MOSTRAR_TAREAS + 2, "sugeridas": min(MOSTRAR_TAREAS, len(tareas))}
    if any("grupo" in t for t in tareas):
        opciones["agrupar"] = True
    return {"id": ID_BUSCADOR, "rutas": [ruta_de(inicio)], "contenedor": "main", "reemplazar": False,
            "componente": "buscador", "datos": tareas, "opciones": opciones}


def derivar(goals: list, rutas: dict[str, dict], selects: list[SelectDePagina], inicio: str,
            tasas: dict[str, float | None] | None = None, catalogo: list | None = None) -> dict:
    """`{atajos: [{objetivo, vista}], lanzador: vista | None, buscador: vista | None, descartes: [{objetivo, razon}]}`."""
    atajos, descartes = [], []
    for goal in goals:
        if goal.id not in rutas:
            continue
        vista, razon = atajo(goal.id, rutas[goal.id], selects, inicio)
        if vista:
            atajos.append({"objetivo": goal.id, "vista": vista})
        else:
            descartes.append({"objetivo": goal.id, "razon": razon})
    vista_lanzador = lanzador(goals, rutas, inicio, {a["objetivo"] for a in atajos}, tasas)
    if vista_lanzador and atajos:
        # Junto al primer atajo: lo que la página ya muestra para empezar.
        vista_lanzador["contenedor"] = atajos[0]["vista"]["contenedor"]
    vista_buscador = buscador(goals, rutas, inicio, catalogo)
    if vista_buscador and vista_lanzador:
        vista_buscador["contenedor"] = vista_lanzador["contenedor"]
    return {"atajos": atajos, "lanzador": vista_lanzador, "buscador": vista_buscador, "descartes": descartes}
