"""Lo que el motor necesita saber de un sitio: rasgos (para `auto`), marca, categorías, zonas y variantes.

Un sitio conocido trae su carpeta escrita a mano (`sitios/<id>/`: `sitio.json`, `estructura.css` y sus variantes),
que tiene prioridad. Un sitio sin carpeta sale de lo medido en la página (`disenador.zonas.medir`): zonas con
selectores estables, rasgos por señales simples, el color de marca más pesado entre botones, franjas y enlaces, y los
colores de categoría si la página repite un conjunto; si no lo repite, las categorías son tonos derivados de la marca
(las recetas de baldosas y discos necesitan colores, no el rasgo). Sin medida, solo el mapa: marca y formulario.
"""

import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path

from disenador.motor.color import Color, ok

SITIOS = Path(__file__).with_name("sitios")
# Rasgos que puntúan las direcciones en `auto`; sin medirlos, un sitio no se inclina por ninguna.
RASGOS_NEUTROS = {"institucional": 0.5, "comercio": 0.5, "categorias_color": 0, "video_hero": 0,
                  "tarea_formulario": 0.5}
MARCA_NEUTRA = {"l": 0.5, "c": 0.14, "h": 255}
TEMPERATURA_MEDIDA = 1.6
_RGB = re.compile(r"rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)")


@dataclass
class Sitio:
    id: str
    rasgos: dict[str, float] = field(default_factory=lambda: dict(RASGOS_NEUTROS))
    marca: dict[str, float] = field(default_factory=lambda: dict(MARCA_NEUTRA))
    categorias: list[dict] = field(default_factory=list)
    """`{nombre, num, color: [l, c, h]}`: los colores con los que el sitio clasifica (las líneas en metro)."""
    lanzador_categorias: list[int] | None = None
    vistas: dict[str, str] = field(default_factory=dict)
    """Los ids de vista (`atajo`, `lanzador`) para los que está escrita la hoja del sitio, si no los pasa el improver."""
    zonas: dict[str, str] = field(default_factory=dict)
    """Selectores medidos por nombre (`nav`, `panel`, `pie`...): las recetas que los usan solo entran si existen."""
    heroes: list[str] = field(default_factory=list)
    ordenes: list[str] = field(default_factory=list)
    disposiciones: list[str] = field(default_factory=list)
    carpeta: Path | None = None
    identidad: dict = field(default_factory=dict)
    """Medido: `fondo` y `tinta` ([l, c, h]), `familia_texto`, `familia_titulos` y `radio` del sitio (la dirección
    Nativa parte de aquí)."""
    categorias_derivadas: bool = False
    """Las categorías son tonos derivados de la marca, no colores que el sitio use para clasificar."""
    temperatura: float = 1.0
    """Cuánto se aplanan los puntajes de `auto`: los rasgos medidos son indicios, menos seguros que una carpeta."""
    holgura_tarjetas: int = 0
    """Medido: los px libres entre tarjetas vecinas; el anillo que las agranda no pasa de la mitad."""
    oscuros: dict[str, bool] = field(default_factory=dict)
    """Medido: si la cabecera y el pie del sitio son oscuros (sus logos y textos están pensados para ese fondo)."""

    def variante(self, nombre: str) -> str | None:
        """El CSS de una variante del sitio (`hero-ocultar`, `orden-tareas-primero`...), si la tiene."""
        ruta = self.carpeta / f"{nombre}.css" if self.carpeta else None
        return ruta.read_text(encoding="utf-8") if ruta and ruta.is_file() else None

    def estructura(self) -> str | None:
        return self.variante("estructura")


def id_de_host(host: str) -> str:
    """`www.metro.cl` → `metro`: el nombre de la carpeta de un sitio conocido."""
    partes = [p for p in host.lower().split(".") if p and p != "www"]
    return partes[0] if partes else host


def _oklch_de_rgb(texto: str) -> Color | None:
    coincide = _RGB.search(texto or "")
    if not coincide or (coincide.group(4) and float(coincide.group(4).rstrip("%")) == 0):
        return None
    r, g, b = (float(coincide.group(i)) / 255 for i in (1, 2, 3))
    lineal = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in (r, g, b)]
    l_ = (0.4122214708 * lineal[0] + 0.5363325363 * lineal[1] + 0.0514459929 * lineal[2]) ** (1 / 3)
    m_ = (0.2119034982 * lineal[0] + 0.6806995451 * lineal[1] + 0.1073969566 * lineal[2]) ** (1 / 3)
    s_ = (0.0883024619 * lineal[0] + 0.2817188376 * lineal[1] + 0.6299787005 * lineal[2]) ** (1 / 3)
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    b2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    return ok(L, math.hypot(a, b2), math.degrees(math.atan2(b2, a)) % 360)


def _marca_del_mapa(mapa: dict) -> dict | None:
    """El primer color con croma de los botones destacados o de los enlaces: el de marca."""
    candidatos = [b.get("fondo") or "" for b in mapa.get("botones_destacados") or []
                  if isinstance(b, dict)]
    candidatos += [e.get("color") or "" for e in mapa.get("colores_de_enlace") or [] if isinstance(e, dict)]
    for texto in candidatos:
        color = _oklch_de_rgb(str(texto))
        if color and color.c >= 0.06:
            return {"l": round(min(0.62, max(0.4, color.l)), 3), "c": round(min(color.c, 0.22), 3),
                    "h": round(color.h, 1)}
    return None


def _marca_medida(candidatos: list[dict]) -> dict | None:
    """El tono con más peso entre los colores con croma (botones, franjas, enlaces) y, en él, el color más pesado."""
    por_tono: dict[int, list[tuple[float, Color]]] = {}
    for candidato in candidatos or []:
        color = _oklch_de_rgb(str(candidato.get("color") or "")) if isinstance(candidato, dict) else None
        peso = candidato.get("peso") if isinstance(candidato, dict) else None
        if color and color.c >= 0.06 and isinstance(peso, (int, float)) and peso > 0:
            por_tono.setdefault(round(color.h / 20) % 18, []).append((float(peso), color))
    if not por_tono:
        return None
    grupo = max(por_tono.values(), key=lambda g: sum(p for p, _ in g))
    color = max(grupo, key=lambda par: par[0])[1]
    return {"l": round(min(0.62, max(0.4, color.l)), 3), "c": round(min(color.c, 0.22), 3), "h": round(color.h, 1)}


def _categorias_medidas(lista: list[dict]) -> list[dict]:
    categorias = []
    for item in lista or []:
        color = _oklch_de_rgb(str(item.get("color") or "")) if isinstance(item, dict) else None
        if not color:
            continue
        nombre = " ".join(str(item.get("nombre") or "").split())[:40] or f"Categoría {len(categorias) + 1}"
        num = nombre if len(nombre) <= 3 else str(len(categorias) + 1)
        categorias.append({"nombre": nombre, "num": num,
                           "color": [round(color.l, 3), round(min(color.c, 0.24), 3), round(color.h, 1)]})
    return categorias[:8]


# Los tonos derivados de la marca: la marca, dos vecinos y sus opuestos, con la luz y el croma de un color de línea.
_GIROS = (0, 150, 40, 210, 285, 95)


def tonos_de_marca(marca: dict) -> list[dict]:
    c = round(min(0.16, max(0.11, marca["c"])), 3)
    tonos = []
    for i, giro in enumerate(_GIROS, start=1):
        h = round((marca["h"] + giro) % 360, 1)
        # Amarillos y verdes amarillentos a L 0,6 quedan oliva: suben de luz.
        tonos.append({"nombre": f"Tono {i}", "num": str(i), "color": [0.76 if 70 <= h <= 135 else 0.6, c, h]})
    return tonos


_INSTITUCION = re.compile(r"\.(gob|gov|gub|mil)(\.[a-z]{2})?$|\.(gob|gov)\.|^(www\.)?(gob|gov)\.")
_ACADEMIA = re.compile(r"\.(edu|ac|org)(\.[a-z]{2})?$|\.(uc|uchile|usach)\.cl$")


def rasgos_medidos(host: str, medida: dict, mapa: dict | None = None) -> dict[str, float]:
    """Los rasgos de `auto` por señales simples. Ninguno llega a 1 o 0 por una sola señal: son indicios."""
    senales = medida.get("senales") or {}
    host = (host or "").lower()
    institucional = 0.85 if _INSTITUCION.search(host) else 0.55 if _ACADEMIA.search(host) else 0.25
    if senales.get("institucion_texto"):
        institucional = min(1.0, institucional + 0.35)
    precios = senales.get("precios") or 0
    comercio = min(1.0, 0.1 + precios / 8 + (0.45 if senales.get("carro") else 0))
    if institucional >= 0.85:
        comercio = min(comercio, 0.3)
    categorias = len(medida.get("categorias") or [])
    campos = senales.get("campos")
    if not isinstance(campos, (int, float)):
        campos = (mapa or {}).get("conteos", {}).get("campos", 0)
    return {
        "institucional": round(institucional, 2),
        "comercio": round(comercio, 2),
        "categorias_color": 1 if categorias >= 4 else 0.5 if categorias == 3 else 0,
        "video_hero": 1 if senales.get("videos") else 0.3 if senales.get("hero_imagen") else 0,
        "tarea_formulario": 1 if campos >= 2 else 0.5 if campos == 1 else 0,
    }


_FAMILIA = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _-]{0,40}$")


def _identidad(datos) -> dict:
    """Lo que define al sitio a la vista, saneado: colores en OKLCH, familias que se pueden nombrar en CSS sin
    escapar y un radio razonable."""
    if not isinstance(datos, dict):
        return {}
    identidad = {}
    for clave in ("fondo", "tinta"):
        if color := _oklch_de_rgb(str(datos.get(clave) or "")):
            identidad[clave] = [round(color.l, 3), round(color.c, 3), round(color.h, 1)]
    for clave in ("familia_texto", "familia_titulos"):
        familia = str(datos.get(clave) or "").strip()
        if _FAMILIA.match(familia) and familia.lower() not in ("inherit", "initial", "serif", "sans-serif"):
            identidad[clave] = familia
    if isinstance(datos.get("radio"), (int, float)):
        identidad["radio"] = max(0, min(24, round(datos["radio"])))
    return identidad


def sitio_medido(host: str, medida: dict, mapa: dict | None = None) -> Sitio:
    """Un sitio sin carpeta a partir de lo medido en su página."""
    sitio = Sitio(id=id_de_host(host), temperatura=TEMPERATURA_MEDIDA)
    sitio.marca = _marca_medida(medida.get("marca")) or (_marca_del_mapa(mapa) if mapa else None) or sitio.marca
    sitio.rasgos = {**RASGOS_NEUTROS, **rasgos_medidos(host, medida, mapa)}
    sitio.zonas = {k: v for k, v in (medida.get("zonas") or {}).items() if isinstance(v, str) and v}
    sitio.categorias = _categorias_medidas(medida.get("categorias"))
    if not sitio.categorias:
        sitio.categorias, sitio.categorias_derivadas = tonos_de_marca(sitio.marca), True
    sitio.identidad = _identidad(medida.get("identidad"))
    holgura = medida.get("tarjetas_holgura")
    sitio.holgura_tarjetas = int(holgura) if isinstance(holgura, (int, float)) and holgura > 0 else 0
    sitio.oscuros = {k: bool(v) for k, v in (medida.get("oscuros") or {}).items() if k in ("cabecera", "pie")}
    return sitio


def rasgos_del_sitio(host: str, mapa: dict | None = None, medida: dict | None = None) -> Sitio:
    """El sitio de `host`: su carpeta si la tiene; si no, lo medido en la página (`medida`) o, sin medida, lo que se
    puede sacar del mapa."""
    carpeta = SITIOS / id_de_host(host)
    if (carpeta / "sitio.json").is_file():
        datos = json.loads((carpeta / "sitio.json").read_text(encoding="utf-8"))
        return Sitio(
            id=datos.get("id") or carpeta.name,
            rasgos={**RASGOS_NEUTROS, **{k: v for k, v in datos.get("rasgos", {}).items()
                                         if isinstance(v, (int, float))}},
            marca=datos.get("marca") or dict(MARCA_NEUTRA),
            categorias=datos.get("categorias") or [],
            lanzador_categorias=datos.get("lanzador_categorias"),
            vistas=datos.get("vistas") or {},
            zonas=datos.get("zonas") or {},
            heroes=datos.get("heroes") or [],
            ordenes=datos.get("ordenes") or [],
            disposiciones=datos.get("disposiciones") or [],
            carpeta=carpeta,
            identidad=_identidad((medida or {}).get("identidad")),
        )
    if medida:
        return sitio_medido(host, medida, mapa)
    sitio = Sitio(id=id_de_host(host))
    sitio.categorias, sitio.categorias_derivadas = tonos_de_marca(sitio.marca), True
    if mapa:
        sitio.marca = _marca_del_mapa(mapa) or sitio.marca
        if (mapa.get("conteos") or {}).get("campos", 0) >= 2:
            sitio.rasgos["tarea_formulario"] = 1
        sitio.categorias = tonos_de_marca(sitio.marca)
    return sitio

