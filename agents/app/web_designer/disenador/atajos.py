"""Los componentes del kit que salen de lo medido, sin modelo: el `atajo`, el `lanzador` y el `buscador`.

- Atajo: una ruta verificada de la Guía que solo elige opciones (`select`) y termina en una URL con consulta (el deep
  link, p. ej. `/el-viaje/planificador/?inicio=SP&fin=EL`). Cada clave de la consulta es un campo cuyas opciones se
  copian del `<select>` de la página que le corresponde; una clave sin `<select>` va fija en el enlace. Si la Guía
  envió el formulario sin elegir nada (con lo que traía), valen solo las claves que nombran un `<select>` de la página.
- Lanzador: los objetivos del catálogo, cada uno con la URL a la que llegó la Guía o su `entry`; si llegó enviando un
  formulario, sin la consulta (las elecciones de esa corrida, como un viaje SP→EL), y sin lo que la página ya enlaza
  en su primer pantallazo. Primero los que
  tienen ruta verificada (el enlace lleva de verdad a la tarea), después los que menos lograron los Visitantes (donde
  un atajo ayuda más) y, a igual medida, los más prominentes del catálogo.
- Buscador: todos los objetivos del catálogo con enlace (hasta `MAX_BUSCADOR`, también el del atajo), con el mismo
  título y detalle que el lanzador y, si el catálogo los agrupa (`parent`), el título del objetivo padre como grupo.

Todos los enlaces quedan como rutas relativas del mismo sitio; lo que apunta a otro sitio no entra. Los textos van solo
en español (`{"es": …}`): el inglés lo escribe el modelo, y sin él la extensión muestra el español.
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
_TITULO_MAX = 56
_TITULO_PALABRAS = 9
_ENLACES = {"a", "al", "como", "con", "cuando", "de", "del", "desde", "donde", "e", "el", "en", "entre", "hacia",
            "hasta", "la", "las", "lo", "los", "mediante", "mi", "mis", "ni", "o", "para", "por", "que", "según", "sin",
            "sobre", "su", "sus", "todas", "todos", "tu", "tus", "u", "un", "una", "unos", "unas", "y"}
_GERUNDIO = re.compile(r"\w{2,}(?:ando|iendo|yendo)$", re.I)
_RELLENO = re.compile(r"\b(?:informaci[oó]n|detalles|datos) (?:sobre|acerca de) (?=\w)", re.I)
# «Llega a la página de la Encuesta…», «Ve al sitio de…»: el verbo de navegar no nombra la tarea.
_NAVEGAR = re.compile(r"^(?:llega|ve|ir|entra|accede|navega)\s+(?:a\s+|al\s+)(?:(?:la|las|el|los)\s+)?"
                      r"(?:(?:p[aá]gina|sitio|secci[oó]n)\s+(?:de\s+(?:la\s+|las\s+|los\s+|el\s+)?|del\s+))?",
                      re.I)
# «Llega a la sala de prensa para leer…»: tras el verbo de navegar, el propósito no es parte del nombre (salvo que
# el destino sea una sola palabra).
_PROPOSITO = re.compile(r"\s+para\s+(?=\w+(?:ar|er|ir)\b)", re.I)
# «Encuentra el valor de la UTM», «Consulta cómo rectificar…»: el verbo de la instrucción no nombra la tarea; lo que
# sigue sí, si es el nombre de algo (con artículo definido o posesivo) o una pregunta («cómo…», «cuáles son…»).
_INSTRUCCION = re.compile(
    r"^(?:encuentra|consulta|revisa|accede|obt[eé]n|conoce|busca|ubica|averigua|descubre|mira|lee|descarga"
    r"|localiza|identifica|infórmate\s+(?:sobre|de))\s+"
    r"(?:(?P<articulo>(?:a\s+)?(?:el|la|los|las|lo)\s+|al\s+)|(?:cu[aá]les\s+son|cu[aá]l\s+es)\s+"
    r"|(?=(?:c[oó]mo|d[oó]nde|cu[aá]ndo|cu[aá]nto|qu[eé]|tus?|sus?)\s))", re.I)
# Donde se corta un título largo sin dejar una frase a medias: antes de un complemento («para…», «en…»); si no hay,
# antes de «de» o de una conjunción.
_CORTE = {"a", "al", "como", "con", "cuando", "desde", "donde", "en", "entre", "hacia", "hasta", "mediante", "para",
          "por", "que", "según", "sin", "sobre"}
_CORTE_DEBIL = {"de", "del", "e", "o", "u", "y"}
# Una ruta con fecha (/2026/11/06/…): una noticia o comunicado que mañana ya no es lo más reciente.
_FECHADA = re.compile(r"/(?:19|20)\d{2}/\d{1,2}/")
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
        campos.append({"nombre": clave, "etiqueta": {"es": etiqueta}, "opciones": select.selector,
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


def _mayuscula(texto: str) -> str:
    return texto[:1].upper() + texto[1:]


def sin_instruccion(texto: str, articulo: bool = False) -> str:
    """`texto` sin el verbo de instrucción del catálogo con que empieza («Encuentra el valor de la UTM» → «Valor de la
    UTM»), si lo que sigue nombra algo; con `articulo`, conserva el artículo («El valor de la UTM»)."""
    if not (encontrado := _INSTRUCCION.match(texto)):
        return texto
    inicio = encontrado.start("articulo") if articulo and encontrado.group("articulo") else encontrado.end()
    resto = texto[inicio:]
    if articulo:
        resto = re.sub(r"^al\s+", "el ", re.sub(r"^a\s+", "", resto, flags=re.I), flags=re.I)
    return _mayuscula(resto) if resto.strip() else texto


def _nombre_partido(palabras: list[str], i: int) -> bool:
    """Si cortar antes de `palabras[i]` parte un nombre: lo separa de su número o letra («Línea 7», «Línea A») o corta
    dentro de uno («Índice de Precios al Consumidor»)."""
    palabra, antes = palabras[i], palabras[i - 1]
    if antes[:1].isupper() and len(palabra) <= 3 and (palabra.isdigit() or palabra.isupper()):
        return True
    despues = palabras[i + 1] if i + 1 < len(palabras) else ""
    return i > 1 and antes[:1].isupper() and palabra.lower() in _ENLACES and despues[:1].isupper()


def _recortar(palabras: list[str]) -> list[str]:
    """Las primeras palabras que caben en `_TITULO_PALABRAS` y `_TITULO_MAX`, cortando antes de un complemento
    («… para personas») o, si no hay, antes de «de» o una conjunción; nunca entre un nombre y su número."""
    def cabe(i: int) -> bool:
        return i <= _TITULO_PALABRAS and len(" ".join(palabras[:i])) <= _TITULO_MAX

    if cabe(len(palabras)):
        return palabras
    cortes = [i for i in range(2, len(palabras)) if cabe(i) and not _nombre_partido(palabras, i)]
    for corte in (_CORTE, _CORTE_DEBIL):
        if utiles := [i for i in cortes if palabras[i].lower() in corte]:
            return palabras[:max(utiles)]
    return palabras[:max(cortes)] if cortes else palabras[:1]


def _titulo(descripcion: str) -> str:
    """La primera frase de la descripción (tras la escena que precede a «:») hasta su primer gerundio («ingresando…»),
    sin «información sobre», el verbo de navegar («Llega a la página de…») con su propósito ni el de instrucción
    («Encuentra el…»), en hasta `_TITULO_PALABRAS` palabras y `_TITULO_MAX` caracteres cortados donde termina una
    frase, sin terminar en preposición, artículo ni conjunción."""
    frase = re.split(r"[.;(]", " ".join(descripcion.split()), maxsplit=1)[0]
    escena, dos_puntos, tarea = frase.partition(":")
    # «Te contactaron para una encuesta del INE: encuentra la información…»: la tarea va después de la escena.
    if dos_puntos and tarea.strip()[:1].islower():
        frase = _mayuscula(tarea.strip())
    texto = re.split(r"[:,]", frase, maxsplit=1)[0].strip()
    texto = _RELLENO.sub("", texto)
    if (sin_verbo := _NAVEGAR.sub("", texto)) and sin_verbo != texto:
        destino, *proposito = _PROPOSITO.split(sin_verbo, maxsplit=1)
        # «Llega al trámite para iniciar actividades»: un destino de una palabra no dice cuál; lo dice el propósito.
        texto = _mayuscula(proposito[0] if proposito and len(destino.split()) < 2 else destino)
    texto = _RELLENO.sub("", sin_instruccion(texto))
    palabras = []
    for palabra in texto.split(" "):
        # Tras un artículo o preposición no es gerundio sino sustantivo («el arriendo»).
        if palabras and palabras[-1].lower() not in _ENLACES and _GERUNDIO.match(palabra):
            break
        palabras.append(palabra)
    palabras = _recortar(palabras)
    while len(palabras) > 1 and palabras[-1].lower() in _ENLACES and not palabras[-1].isupper():
        palabras.pop()
    return _mayuscula(" ".join(palabras)) or texto[:_TITULO_MAX]


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
    if llego and entrada and _FECHADA.search(urlsplit(llego).path) and not _FECHADA.search(entrada):
        llego = entrada  # la página estable del tema, no la noticia del día
    for enlace in (llego, entrada):
        if enlace and not (misma_ruta(ruta_de(enlace), ruta_de(inicio)) and "?" not in enlace):
            return enlace, enlace == llego
    return None, False


def _tarea(goal, enlace: str) -> dict:
    titulo = _titulo(goal.description)
    tarea = {"titulo": {"es": titulo}, "enlace": enlace}
    detalle = " ".join(goal.description.split()).rstrip(".")
    detalle = _mayuscula(_NAVEGAR.sub("", detalle)) or detalle  # «Llega a la página de…» no agrega nada al título
    detalle = sin_instruccion(detalle, articulo=True)  # «Encuentra el valor de la UTM del mes» → «El valor de…»
    if detalle and detalle.lower() != titulo.lower():
        tarea["detalle"] = {"es": detalle[:160]}
    return tarea


def _ordenadas(goals: list, rutas: dict[str, dict], inicio: str, excluir: set[str],
               tasas: dict[str, float | None] | None = None,
               a_mano: set[str] | None = None) -> list[tuple[str, object]]:
    """`(enlace, goal)` sin enlaces repetidos, en orden lexicográfico: no está ya a la vista (`a_mano`: las rutas de
    los enlaces del primer pantallazo, como los indicadores de la portada), ruta verificada, menor tasa de llegada (sin
    medir cuenta como 0.5), mayor prominencia y el orden del catálogo."""
    a_mano = {r.rstrip("/") for r in a_mano or ()}
    candidatos = []
    for posicion, goal in enumerate(goals):
        if goal.id in excluir:
            continue
        enlace, verificada = _enlace(goal, rutas, inicio)
        if enlace:
            tasa = (tasas or {}).get(goal.id)
            clave = (ruta_de(enlace).rstrip("/") in a_mano, not verificada, 0.5 if tasa is None else tasa,
                     _PROMINENCIA.get(goal.prominence, 3), posicion)
            candidatos.append((clave, enlace, goal))
    ordenadas, vistos = [], set()
    for _, enlace, goal in sorted(candidatos, key=lambda c: c[0]):
        if enlace not in vistos:
            vistos.add(enlace)
            ordenadas.append((enlace, goal))
    return ordenadas


def lanzador(goals: list, rutas: dict[str, dict], inicio: str, excluir: set[str],
             tasas: dict[str, float | None] | None = None, a_mano: set[str] | None = None) -> dict | None:
    """La vista `lanzador` con los objetivos del catálogo (sin los de `excluir`), o None si ninguno tiene enlace.
    `tasas`: la tasa de llegada del Visitante por objetivo, si se midió. Lo que la página ya enlaza en su primer
    pantallazo (`a_mano`, como unos «Accesos rápidos») no entra: el lanzador no repite un bloque del sitio, y ocultar
    ese bloque se llevaría lo que el kit no puede enlazar (otros subdominios, «Más opciones»). Sigue en el buscador."""
    a_la_vista = {r.rstrip("/") for r in a_mano or ()}
    ordenadas = [(enlace, goal) for enlace, goal in _ordenadas(goals, rutas, inicio, excluir, tasas=tasas)
                 if ruta_de(enlace).rstrip("/") not in a_la_vista]
    tareas = [_tarea(goal, enlace) for enlace, goal in ordenadas[:MAX_TAREAS]]
    if not tareas:
        return None
    return {"id": ID_LANZADOR, "rutas": [ruta_de(inicio)], "contenedor": "main", "reemplazar": False,
            "componente": "lanzador", "datos": tareas, "opciones": {"max": MOSTRAR_TAREAS}}


def buscador(goals: list, rutas: dict[str, dict], inicio: str, catalogo: list | None = None,
             a_mano: set[str] | None = None) -> dict | None:
    """La vista `buscador` con los objetivos de `goals` que tienen enlace, o None si ninguno. `catalogo`: todos los
    objetivos, también los de nivel resumen, para nombrar el grupo de cada uno por su `parent`."""
    grupos = {g.id: _titulo(g.description) for g in catalogo or goals}
    tareas = []
    for enlace, goal in _ordenadas(goals, rutas, inicio, set(), a_mano=a_mano)[:MAX_BUSCADOR]:
        tarea = _tarea(goal, enlace)
        if grupo := grupos.get(goal.parent or ""):
            tarea["grupo"] = {"es": grupo}
        tareas.append(tarea)
    if not tareas:
        return None
    opciones = {"max": MOSTRAR_TAREAS + 2, "sugeridas": min(MOSTRAR_TAREAS, len(tareas))}
    if any("grupo" in t for t in tareas):
        opciones["agrupar"] = True
    return {"id": ID_BUSCADOR, "rutas": [ruta_de(inicio)], "contenedor": "main", "reemplazar": False,
            "componente": "buscador", "datos": tareas, "opciones": opciones}


def derivar(goals: list, rutas: dict[str, dict], selects: list[SelectDePagina], inicio: str,
            tasas: dict[str, float | None] | None = None, catalogo: list | None = None,
            a_mano: set[str] | None = None) -> dict:
    """`{atajos: [{objetivo, vista}], lanzador: vista | None, buscador: vista | None, descartes: [{objetivo, razon}]}`.
    `a_mano`: las rutas que la página ya enlaza en su primer pantallazo: no van al lanzador y en el buscador van al
    final."""
    atajos, descartes = [], []
    for goal in goals:
        if goal.id not in rutas:
            continue
        vista, razon = atajo(goal.id, rutas[goal.id], selects, inicio)
        if vista:
            atajos.append({"objetivo": goal.id, "vista": vista})
        else:
            descartes.append({"objetivo": goal.id, "razon": razon})
    vista_lanzador = lanzador(goals, rutas, inicio, {a["objetivo"] for a in atajos}, tasas, a_mano)
    if vista_lanzador and atajos:
        # Junto al primer atajo: lo que la página ya muestra para empezar.
        vista_lanzador["contenedor"] = atajos[0]["vista"]["contenedor"]
    vista_buscador = buscador(goals, rutas, inicio, catalogo, a_mano)
    if vista_buscador and vista_lanzador:
        vista_buscador["contenedor"] = vista_lanzador["contenedor"]
    return {"atajos": atajos, "lanzador": vista_lanzador, "buscador": vista_buscador, "descartes": descartes}
