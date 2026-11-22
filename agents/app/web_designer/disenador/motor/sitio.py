"""Lo que el motor necesita saber de un sitio: rasgos (para `auto`), marca, categorías, zonas y variantes.

Hoy un sitio conocido trae su carpeta escrita a mano (`sitios/<id>/`: `sitio.json` y la estructura medida). Un sitio
sin carpeta sale del mapa de la página: la marca del color de sus botones o enlaces, sin categorías ni zonas, y el
motor compone con lo que no depende de ellas. Cuando el diagnóstico mida zonas y categorías, entran por aquí.
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
_RGB = re.compile(r"rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)")


@dataclass
class Sitio:
    id: str
    rasgos: dict[str, float] = field(default_factory=lambda: dict(RASGOS_NEUTROS))
    marca: dict[str, float] = field(default_factory=lambda: dict(MARCA_NEUTRA))
    categorias: list[dict] = field(default_factory=list)
    """`{nombre, num, color: [l, c, h]}`: los colores con los que el sitio clasifica (las líneas en metro)."""
    lanzador_categorias: list[int] | None = None
    zonas: dict[str, str] = field(default_factory=dict)
    """Selectores medidos por nombre (`nav`, `panel`, `pie`...): las recetas que los usan solo entran si existen."""
    heroes: list[str] = field(default_factory=list)
    ordenes: list[str] = field(default_factory=list)
    disposiciones: list[str] = field(default_factory=list)
    carpeta: Path | None = None

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


def rasgos_del_sitio(host: str, mapa: dict | None = None) -> Sitio:
    """El sitio de `host`: su carpeta si la tiene; si no, lo que se puede sacar del mapa de la página."""
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
            zonas=datos.get("zonas") or {},
            heroes=datos.get("heroes") or [],
            ordenes=datos.get("ordenes") or [],
            disposiciones=datos.get("disposiciones") or [],
            carpeta=carpeta,
        )
    sitio = Sitio(id=id_de_host(host))
    if mapa:
        sitio.marca = _marca_del_mapa(mapa) or sitio.marca
        if (mapa.get("conteos") or {}).get("campos", 0) >= 2:
            sitio.rasgos["tarea_formulario"] = 1
    return sitio

