"""Los componentes del kit que salen de lo medido, sin modelo: el `atajo` y el `lanzador`.

- Atajo: una ruta verificada de la Guía que solo elige opciones (`select`) y termina en una URL con consulta (el deep
  link, p. ej. `/el-viaje/planificador/?inicio=SP&fin=EL`). Cada clave de la consulta es un campo cuyas opciones se
  copian del `<select>` de la página que le corresponde; una clave sin `<select>` va fija en el enlace.
- Lanzador: los objetivos del catálogo por prominencia, cada uno con la URL a la que llegó la Guía o su `entry`.

Todos los enlaces quedan como rutas relativas del mismo sitio; lo que apunta a otro sitio no entra.
"""

import re
from dataclasses import dataclass
from urllib.parse import parse_qsl, urljoin, urlsplit

from shared.nodes.urls import normalize_url, site_host

ID_LANZADOR = "tareas"
MAX_TAREAS = 8
MOSTRAR_TAREAS = 6
_PROMINENCIA = {"primary": 0, "secondary": 1, "buried": 2}
_ELECCIONES = {"select", "check", "uncheck"}
_ROLES_ELECCION = {"combobox", "listbox", "option", "radio", "checkbox"}
_ID_CSS = re.compile(r"^#([A-Za-z][\w-]*)$")
_TITULO_MAX = 48
_ENLACES = {"a", "al", "con", "de", "del", "el", "en", "la", "las", "los", "o", "para", "por", "su", "tu", "un",
            "una", "y"}


@dataclass
class SelectDePagina:
    """Un `<select>` de la página abierta: un selector que lo encuentra, su id y name, y sus opciones usables."""

    selector: str
    id: str = ""
    name: str = ""
    etiqueta: str = ""
    valores: tuple[str, ...] = ()
    elegido: str = ""


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


def _ruta_de(url: str) -> str:
    return urlsplit(normalize_url(url)).path


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
                usados: set[str]) -> SelectDePagina | None:
    libres = [s for s in selects if s.selector not in usados]
    for s in libres:
        if clave in (s.name, s.id):
            return s
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
    if len(pasos) < 2:
        return None, "la ruta no tiene elecciones antes de llegar"
    final = pasos[-1].get("url_after") or ""
    destino = mismo_sitio(final, inicio)
    consulta = parse_qsl(urlsplit(final).query, keep_blank_values=False)
    if not destino or not consulta:
        return None, "la ruta no termina en una URL con consulta del mismo sitio"
    elecciones = pasos[:-1]
    if not all(_es_eleccion(p) for p in elecciones) or not any(p.get("action") == "select" for p in elecciones):
        return None, "la ruta hace algo más que elegir opciones"
    paginas = {_ruta_de(p.get("url_before") or "") for p in elecciones}
    origen = elecciones[0].get("url_before") or ""
    if len(paginas) != 1 or not mismo_sitio(origen, inicio):
        return None, "las elecciones no ocurren en una sola página del sitio"
    pagina = paginas.pop()
    # Los `<select>` leídos son los de la página abierta: si el atajo va en otra, solo valen los de la ruta.
    selects = selects if pagina == _ruta_de(inicio) else []

    de_ruta = _selectores_de_ruta(elecciones)
    campos, fijos, usados, por_nombre = [], {}, set(), {}
    for clave, valor in consulta:
        select = _campo_para(clave, valor, selects, de_ruta, usados)
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
    """La primera frase de la descripción, sin el punto; si es larga, cortada en una palabra que no sea de enlace."""
    texto = re.split(r"[.;:(]", " ".join(descripcion.split()), maxsplit=1)[0].strip().rstrip(",")
    if len(texto) <= _TITULO_MAX:
        return texto
    palabras = texto[:_TITULO_MAX + 1].split(" ")[:-1]
    while len(palabras) > 1 and palabras[-1].lower() in _ENLACES:
        palabras.pop()
    return " ".join(palabras).rstrip(",")


def llegada(route: dict | None) -> str | None:
    if not isinstance(route, dict) or route.get("status") != "verified":
        return None
    pasos = [p for p in route.get("steps") or [] if isinstance(p, dict)]
    return pasos[-1].get("url_after") if pasos else None


def lanzador(goals: list, rutas: dict[str, dict], inicio: str, excluir: set[str]) -> dict | None:
    """La vista `lanzador` con los objetivos del catálogo (sin los de `excluir`), o None si ninguno tiene enlace."""
    candidatos = []
    for posicion, goal in enumerate(goals):
        if goal.id in excluir:
            continue
        final = llegada(rutas.get(goal.id))
        enlace = mismo_sitio(final, inicio) or mismo_sitio(goal.entry, inicio)
        if not enlace or (_ruta_de(enlace) == _ruta_de(inicio) and "?" not in enlace):
            continue
        candidatos.append(((_PROMINENCIA.get(goal.prominence, 3), final is None, posicion), enlace, goal))
    tareas, vistos = [], set()
    for _, enlace, goal in sorted(candidatos, key=lambda c: c[0]):
        if enlace in vistos:
            continue
        vistos.add(enlace)
        titulo = _titulo(goal.description)
        tarea = {"titulo": {"es": titulo, "en": titulo}, "enlace": enlace}
        detalle = " ".join(goal.description.split()).rstrip(".")
        if detalle and detalle != titulo:
            tarea["detalle"] = {"es": detalle[:160], "en": detalle[:160]}
        tareas.append(tarea)
        if len(tareas) == MAX_TAREAS:
            break
    if not tareas:
        return None
    return {"id": ID_LANZADOR, "rutas": [_ruta_de(inicio)], "contenedor": "main", "reemplazar": False,
            "componente": "lanzador", "datos": tareas, "opciones": {"max": MOSTRAR_TAREAS}}


def derivar(goals: list, rutas: dict[str, dict], selects: list[SelectDePagina], inicio: str) -> dict:
    """`{atajos: [{objetivo, vista}], lanzador: vista | None, descartes: [{objetivo, razon}]}`."""
    atajos, descartes = [], []
    for goal in goals:
        if goal.id not in rutas:
            continue
        vista, razon = atajo(goal.id, rutas[goal.id], selects, inicio)
        if vista:
            atajos.append({"objetivo": goal.id, "vista": vista})
        else:
            descartes.append({"objetivo": goal.id, "razon": razon})
    vista_lanzador = lanzador(goals, rutas, inicio, {a["objetivo"] for a in atajos})
    if vista_lanzador and atajos:
        # Junto al primer atajo: lo que la página ya muestra para empezar.
        vista_lanzador["contenedor"] = atajos[0]["vista"]["contenedor"]
    return {"atajos": atajos, "lanzador": vista_lanzador, "descartes": descartes}
