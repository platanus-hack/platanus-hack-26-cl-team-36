"""Compone un tema desde una dirección de arte: el modelo elige, el código escribe el CSS y lo verifica.

`tema.css` = elegancia (capa base) + tokens (de la dirección y la semilla) + kit (atajo y lanzador) + estructura del
sitio y sus variantes (si el sitio tiene carpeta; si no, la genérica sobre las zonas medidas) + recetas (bloques que
solo leen tokens), saneado con `css.sanear`. Un bloque `{{#z.x}}…{{/z.x}}` de una hoja entra solo si el sitio tiene la
zona `x`: una receta pide solo las zonas que usa fuera de esos bloques.
La paleta se verifica AA y, si un par no llega, se mueve L en OKLCH hasta que cumpla.

Una dirección (`direcciones/<id>.json`) son datos: rangos de neutros, tinta, acento, tipo, forma y densidad; las
recetas fijas y las opcionales con su probabilidad; y la afinidad con los rasgos del sitio para `auto`. La semilla
elige un punto en cada rango; los ajustes del modelo fijan un valor, recortado al rango.
"""

import copy
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path

from disenador.css import sanear
from disenador.motor import paleta
from disenador.motor.azar import Azar
from disenador.motor.color import Color, css, fijo, num, ok
from disenador.motor.sitio import Sitio

RAIZ = Path(__file__).parent
DIRECCIONES = ("A", "B", "C")
# Los componentes del kit que el CSS nombra por su id (`{{v.atajo}}` → `data-mt-vista="<id>"`). Los ids los pasa el
# improver (los de las vistas que derivó) o los trae el sitio (`vistas` en su `sitio.json`); uno que falta queda con
# un id que no dibuja ninguna vista y sus reglas no aplican.
COMPONENTES_KIT = ("atajo", "lanzador")
# Los ajustes que no son rangos numéricos: eligen una variante del sitio.
VARIANTES = {"hero": "heroes", "disposicion": "disposiciones", "orden": "ordenes"}
PROBABILIDAD_MEZCLA = 0.45

# Las familias que empaqueta la extensión («MT …», con su cara «MT … Fallback» de métricas ajustadas), y después las
# del sistema. La extensión inyecta las fuentes solo si el tema nombra alguna «MT …».
def _pila(*familias: str, sistema: str = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif') -> str:
    return ", ".join([*(f'"{f}"' for f in familias), sistema])


FAMILIAS_DISPONIBLES = ("MT Inter", "MT Serif", "MT Archivo", "MT Geist", "MT Geist Mono")
FAMILIAS = {
    "condensada": {
        "display": _pila("MT Archivo", "MT Archivo Fallback", "Archivo", "Bahnschrift", "DIN Condensed",
                         "Avenir Next Condensed", "Roboto Condensed", "Arial Narrow", sistema="system-ui, sans-serif"),
        "texto": _pila("MT Inter", "MT Inter Fallback", "Inter"),
        "texto_ancho": "76%",
    },
    # Roboto Flex no se empaqueta (pesa mucho): el ancho expandido sale del eje wdth de Archivo (62–125).
    "expresiva": {
        "display": _pila("MT Archivo", "MT Archivo Fallback", "Archivo", "Roboto Flex"),
        "texto": _pila("MT Inter", "MT Inter Fallback", "Inter", "Roboto Flex"),
        "texto_ancho": "100%",
    },
    "neogrotesca": {
        "display": _pila("MT Geist", "MT Geist Fallback", "Geist", "Inter Display", "SF Pro Display"),
        "texto": _pila("MT Geist", "MT Geist Fallback", "Geist", "MT Inter", "Inter"),
        "mono": _pila("MT Geist Mono", "MT Geist Mono Fallback", "Geist Mono",
                      sistema='ui-monospace, "SF Mono", Menlo, Consolas, monospace'),
        "texto_ancho": "100%",
    },
}
MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'


class ErrorDeComposicion(Exception):
    """El pedido no se puede componer (una dirección desconocida, una receta que pide una zona inexistente...)."""


@dataclass
class Tema:
    css: str
    informe: dict

    @property
    def ok(self) -> bool:
        return not self.informe["saneador"]["rechazos"] and not self.informe["contraste"]["fallas"]


def _leer_json(ruta: Path):
    return json.loads(ruta.read_text(encoding="utf-8"))


def direcciones() -> dict[str, dict]:
    return {d: _leer_json(RAIZ / "direcciones" / f"{d}.json") for d in DIRECCIONES}


def recetas_meta() -> dict[str, dict]:
    return {k: v for k, v in _leer_json(RAIZ / "recetas" / "recetas.json").items() if not k.startswith("_")}


def _receta(nombre: str) -> str:
    return (RAIZ / "recetas" / f"{nombre}.css").read_text(encoding="utf-8")


_SI_ZONA_BLOQUE = re.compile(r"(?m)^[ \t]*\{\{#z\.(\w+)\}\}\n([\s\S]*?)^[ \t]*\{\{/z\.\1\}\}\n")
_SI_ZONA = re.compile(r"\{\{#z\.(\w+)\}\}([\s\S]*?)\{\{/z\.\1\}\}")


def _condicionales(texto: str, zonas) -> str:
    """Resuelve los bloques `{{#z.x}}…{{/z.x}}`: quedan si la zona existe y se van si no (en su línea o en línea)."""
    texto = _SI_ZONA_BLOQUE.sub(lambda m: m.group(2) if m.group(1) in zonas else "", texto)
    return _SI_ZONA.sub(lambda m: m.group(2) if m.group(1) in zonas else "", texto)


def zonas_de(texto: str) -> set[str]:
    """Las zonas que una hoja necesita: las que usa fuera de un bloque condicional."""
    return set(re.findall(r"\{\{z\.(\w+)\}\}", _condicionales(texto, ())))


def _redondear(x: float) -> int:
    """Como `Math.round` de JS: las mitades hacia arriba (`round` de Python va al par)."""
    return math.floor(x + 0.5)


# ---------- 1. Dirección: fija o elegida según los rasgos del sitio ----------

def _puntajes(sitio: Sitio, dirs: dict) -> dict[str, float]:
    puntajes = {}
    for d in dirs.values():
        total = 0.0
        for rasgo, peso in d["afinidad"].items():
            total += peso * sitio.rasgos.get(rasgo, 0)
        puntajes[d["id"]] = fijo(total, 2)
    return puntajes


def probabilidades_auto(sitio: Sitio) -> dict[str, float]:
    """Con qué probabilidad `auto` elige cada dirección para este sitio."""
    pesos = {k: math.exp(v / sitio.temperatura) for k, v in _puntajes(sitio, direcciones()).items()}
    total = sum(pesos.values())
    return {k: round(p / total, 2) for k, p in pesos.items()}


def _elegir_direccion(pedida: str, sitio: Sitio, dirs: dict, azar: Azar) -> tuple[dict, dict | None]:
    if pedida != "auto":
        return dirs[pedida], None
    puntajes = _puntajes(sitio, dirs)
    return dirs[azar.ponderado({k: math.exp(v / sitio.temperatura) for k, v in puntajes.items()})], puntajes


# ---------- 2. Ajustes del modelo: solo dentro de los rangos de la dirección ----------

def _es_numero(x) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)


def aplicar_ajustes(direccion: dict, ajustes: dict | None, sitio: Sitio, avisos: list[str]) -> dict:
    d = copy.deepcopy(direccion)
    for ruta, valor in (ajustes or {}).items():
        if ruta == "recetas":
            continue
        if ruta in VARIANTES:
            permitidas = getattr(sitio, VARIANTES[ruta])
            if valor not in permitidas:
                avisos.append(f"ajuste ignorado: {ruta}={valor!r} no es una variante del sitio ({permitidas})")
            else:
                d[ruta] = {valor: 1} if ruta == "hero" else valor
            continue
        partes = ruta.split(".")
        padre = d
        for clave in partes[:-1]:
            padre = padre.get(clave) if isinstance(padre, dict) else None
        rango = padre.get(partes[-1]) if isinstance(padre, dict) else None
        if not (isinstance(rango, list) and len(rango) == 2 and all(_es_numero(x) for x in rango)):
            avisos.append(f"ajuste ignorado: {ruta} no es un rango numérico de la dirección")
            continue
        if not _es_numero(valor):
            avisos.append(f"ajuste ignorado: {ruta}={valor!r} no es un número")
            continue
        recortado = min(rango[1], max(rango[0], valor))
        if recortado != valor:
            avisos.append(f"ajuste {ruta}={num(valor)} fuera de [{num(rango[0])}, {num(rango[1])}],"
                          f" queda {num(recortado)}")
        padre[partes[-1]] = recortado
    return d


# ---------- 3. Recetas: fijas + opcionales por semilla, respetando grupos, requisitos y exclusiones ----------

def _cabe(nombre: str, elegidas: list[str], meta: dict, ctx: dict) -> str | None:
    """Por qué `nombre` no entra junto a `elegidas`, o None si entra."""
    m = meta.get(nombre)
    if not m:
        return f"no existe la receta {nombre}"
    requiere = m.get("requiere") or {}
    if "modo" in requiere and ctx["modo"] not in requiere["modo"]:
        return f"{nombre} requiere modo {','.join(requiere['modo'])}"
    if "familia" in requiere and ctx["familia"] not in requiere["familia"]:
        return f"{nombre} requiere familia {','.join(requiere['familia'])}"
    if requiere.get("categorias") and not ctx["categorias"]:
        return f"{nombre} requiere categorías"
    faltan = sorted(ctx["zonas_de"](nombre) - ctx["zonas"])
    if faltan:
        return f"{nombre} requiere zonas del sitio que no están medidas: {', '.join(faltan)}"
    for otra in elegidas:
        if m.get("grupo") and meta.get(otra, {}).get("grupo") == m["grupo"]:
            return f"{nombre} choca con {otra} (grupo {m['grupo']})"
        if otra in m.get("excluye", []) or nombre in meta.get(otra, {}).get("excluye", []):
            return f"{nombre} excluye {otra}"
    return None


def _resolver_recetas(d: dict, ctx: dict, meta: dict, azar: Azar, ajustes: dict | None, mezcla: list[str],
                      avisos: list[str]) -> list[str]:
    pedido = (ajustes or {}).get("recetas") or {}
    if not isinstance(pedido, dict) or not all(isinstance(pedido.get(k) or [], list) for k in ("agregar", "quitar")):
        avisos.append(f"ajuste ignorado: recetas={pedido!r} no es {{agregar: [...], quitar: [...]}}")
        pedido = {}
    quitar = {str(r) for r in pedido.get("quitar") or []}
    elegidas: list[str] = []

    def sumar(receta: str, origen: str) -> None:
        if receta in quitar or receta in elegidas:
            return
        motivo = _cabe(receta, elegidas, meta, ctx)
        if motivo:
            avisos.append(f"{origen}: {motivo}")
        else:
            elegidas.append(receta)

    for receta in pedido.get("agregar") or []:
        sumar(str(receta), "ajuste")
    # La mezcla de `auto` entra antes que las fijas: reemplaza la receta de su grupo.
    for receta in mezcla:
        sumar(receta, "mezcla")
    for receta in d["recetas"]["fijas"]:
        sumar(receta, "fija")
    for receta, p in d["recetas"]["opcionales"].items():
        if azar.si(p):
            sumar(receta, "opcional")
    return [r for r in meta if r in elegidas]


def _mezcla_auto(d: dict, dirs: dict, meta: dict, ctx: dict, azar: Azar) -> list[str]:
    """En `auto`, a veces otra dirección presta una receta compatible (otra forma de lanzador, una opcional)."""
    if not azar.si(PROBABILIDAD_MEZCLA):
        return []
    ajenas: list[str] = []
    for otra in dirs.values():
        if otra["id"] == d["id"]:
            continue
        for receta in [*otra["recetas"]["fijas"], *otra["recetas"]["opcionales"]]:
            if receta not in d["recetas"]["fijas"] and not _cabe(receta, [], meta, ctx) and receta not in ajenas:
                ajenas.append(receta)
    return [azar.elegir(ajenas)] if ajenas else []


# ---------- 4. Parámetros muestreados (el orden de las llamadas al azar es el del prototipo) ----------

def _muestrear(d: dict, sitio: Sitio, azar: Azar) -> dict:
    R = azar.rango
    hero = azar.ponderado(d["hero"])
    n, tinta, acento, tipo = d["neutros"], d["tinta"], d["acento"], d["tipo"]
    p = {"modo": d["modo"], "hero": hero}
    p["neutros"] = {"tono": R(n["tono"]), "croma": R(n["croma"]), "fondo": R(n["fondo"]), "paso": R(n["paso"])}
    p["tinta"] = {"l": R(tinta["l"]), "l2": R(tinta["l2"]), "croma": tinta.get("croma")}
    p["acento"] = {"l": R(acento["l"]), "c": R(acento["c"])}
    p["marca"] = {"l": R((d.get("marca") or {}).get("l", sitio.marca["l"] * 100))}
    p["foco"] = d["foco"]
    p["categorias"] = d["categorias"]
    p["suaves"] = {"l": R(d["suaves"]["l"]), "c": R(d["suaves"]["c"])} if d.get("suaves") else {"l": 90, "c": 0.06}
    display = tipo["display"]
    p["tipo"] = {
        "familia": tipo["familia"],
        "escala": R(tipo["escala"]),
        "peso": _redondear(R(display["peso"]) / 10) * 10,
        "ancho": _redondear(R(display["ancho"])),
        "caja": display["caja"],
        "tracking": R(display["tracking"]),
        "interlinea": R(display["interlinea"]),
        "titulo_peso": _redondear(R(tipo["titulo_peso"]) / 10) * 10,
        "display_pasos": tipo.get("display_pasos", 6),
        "titulo_pasos": tipo.get("titulo_pasos", 4),
        "display_min": tipo.get("display_min", 46),
    }
    p["radio"] = _redondear(R(d["forma"]["radio"]))
    p["densidad"] = R(d["densidad"])
    p["nav"], p["panel"], p["disposicion"], p["orden"] = d["nav"], d["panel"], d["disposicion"], d["orden"]
    franja = d.get("franja")
    p["franja"] = {"alto": _redondear(R(franja["alto"])), "forma": franja["forma"]} if franja else {"alto": 3,
                                                                                              "forma": "gradiente"}
    p["filete"] = _redondear(R(d.get("filete", [2, 2])))
    return p


# ---------- 5. Tokens ----------

def _px(n: float) -> str:
    return f"{num(fijo(n, 2))}px"


def _fluido(minimo: float, maximo: float) -> str:
    return f"clamp({_px(minimo)}, {num(fijo(maximo / 1280 * 100, 2))}vw, {_px(maximo)})"


def _tono_aurora(sitio: Sitio) -> float:
    """La categoría cuyo tono está más lejos del de la marca: la segunda luz de la aurora."""
    h = sitio.marca["h"]

    def distancia(t):
        return min(abs(t - h), 360 - abs(t - h))

    tonos = sorted((c["color"][2] for c in sitio.categorias), key=distancia, reverse=True)
    return tonos[0] if tonos else h + 180


def _franjas(p: dict, n: int) -> tuple[str, str]:
    """La franja (firma) y el espectro (hilo de luz) con los colores de las categorías; sin ellas, el acento."""
    if n < 2:
        unico = "linear-gradient(90deg, var(--mt-acento), var(--mt-acento-legible))"
        return unico, unico
    cats = [f"var(--mt-c{i + 1})" for i in range(n)]
    if p["franja"]["forma"] == "segmentos":
        franja = ", ".join(f"{c} 0 {num(fijo((i + 1) / n * 100, 2))}%" for i, c in enumerate(cats))
    else:
        franja = ", ".join(cats)
    espectro = ", ".join(f"{c} {_redondear(i / (n - 1) * 100)}%" for i, c in enumerate(cats))
    return f"linear-gradient(90deg, {franja})", f"linear-gradient(90deg, {espectro})"


def tokens(p: dict, col: dict[str, Color], sitio: Sitio) -> dict[str, str]:
    oscuro = p["modo"] == "oscuro"
    t = p["tipo"]
    r = t["escala"]
    fam = FAMILIAS[t["familia"]]

    def paso(k):
        return 16 * r ** k

    display_max, titulo_max = paso(t["display_pasos"]), paso(t["titulo_pasos"])
    franja, espectro = _franjas(p, len(sitio.categorias))

    def tinta_alfa(a):
        return css(col["tinta"].con(a=a))

    barra = p["nav"] == "barra"
    v = {
        "--mt-esquema": "dark" if oscuro else "light",
        "--mt-familia-texto": fam["texto"],
        "--mt-familia-display": fam["display"],
        "--mt-familia-mono": fam.get("mono", MONO),
        "--mt-fuente": "var(--mt-familia-texto)",
        "--mt-texto-ancho": fam["texto_ancho"],
        "--mt-paso--1": _px(paso(-1)),
        "--mt-paso-0": _px(16),
        "--mt-paso-1": _px(paso(1)),
        "--mt-paso-2": _px(paso(2)),
        "--mt-paso-3": _fluido(paso(2), paso(3)),
        "--mt-paso-4": _fluido(paso(3), paso(4)),
        "--mt-paso-titulo": _fluido(max(30, titulo_max * 0.7), titulo_max),
        "--mt-paso-display": _fluido(t["display_min"], display_max),
        "--mt-paso-display-min": _px(t["display_min"]),
        "--mt-display-peso": str(t["peso"]),
        "--mt-peso-display": str(t["titulo_peso"]),
        "--mt-titulo-peso": str(t["titulo_peso"]),
        "--mt-display-ancho": f"{t['ancho']}%",
        "--mt-display-caja": t["caja"],
        "--mt-display-tracking": f"{num(fijo(t['tracking'], 3))}em",
        "--mt-display-interlinea": num(fijo(t["interlinea"], 2)),
        "--mt-radio-1": _px(max(3, _redondear(p["radio"] * 0.55))),
        "--mt-radio-2": _px(p["radio"]),
        "--mt-radio-3": _px(_redondear(p["radio"] * 1.5)),
        "--mt-radio": "var(--mt-radio-2)",
        "--mt-radio-pildora": "999px" if p["nav"] == "pildora" else "var(--mt-radio-1)",
        "--mt-d": num(fijo(p["densidad"], 3)),
        "--mt-esp-s": "calc(var(--mt-d) * 1rem)",
        "--mt-hueco": "calc(var(--mt-d) * 16px)",
        "--mt-respiro": "calc(var(--mt-d) * clamp(48px, 7vw, 88px))",
        "--mt-ancho": "min(1116px, 100% - 32px)",
        "--mt-filete": _px(p["filete"]),
        "--mt-franja-alto": _px(p["franja"]["alto"]),
        "--mt-franja": franja,
        "--mt-espectro": espectro,
        "--mt-duracion": "180ms",
        "--mt-curva": "cubic-bezier(0.2, 0.7, 0.1, 1)",
        "--mt-texto": "var(--mt-tinta)",
        "--mt-texto-2": "var(--mt-tinta-2)",
        "--mt-borde": "var(--mt-linea)",
        "--mt-linea": "oklch(100% 0 0 / 0.1)" if oscuro else tinta_alfa(0.1),
        "--mt-linea-fuerte": "oklch(100% 0 0 / 0.2)" if oscuro else tinta_alfa(0.2),
        "--mt-panel-linea": "transparent" if p["panel"] == "tinta" else "var(--mt-linea)",
        "--mt-seleccion": css(col["acento"].con(a=0.45 if oscuro else 0.22)),
        "--mt-halo": css(col["foco"].con(a=0.25)),
        "--mt-sombra-1": "0 1px 2px oklch(0% 0 0 / 0.35)" if oscuro else f"0 1px 2px {tinta_alfa(0.06)}",
        "--mt-sombra-2": ("0 24px 48px -24px oklch(0% 0 0 / 0.7)" if oscuro
                          else f"0 2px 4px {tinta_alfa(0.04)}, 0 18px 40px -20px {tinta_alfa(0.22)}"),
        "--mt-brillo": "inset 0 1px 0 oklch(100% 0 0 / 0.08)",
        "--mt-iconos": "invert(1)" if oscuro else "none",
        "--mt-anillo": "oklch(100% 0 0 / 0.9)" if oscuro else "transparent",
        "--mt-img-filtro": "brightness(0.88) saturate(0.95)" if oscuro else "none",
        "--mt-nav-fondo": ("var(--mt-fondo)" if barra else "var(--mt-superficie)" if oscuro
                           else css(col["superficie"].con(a=0.9))),
        "--mt-nav-radio": "0" if barra else "999px",
        "--mt-nav-sombra": ("inset 0 -1px 0 var(--mt-linea)" if barra
                            else "inset 0 0 0 1px var(--mt-linea), var(--mt-sombra-1)"),
        "--mt-vidrio-linea": "oklch(100% 0 0 / 0.12)",
        "--mt-velo": css(col["fondo"].con(a=0.3)),
        "--mt-velo-fuerte": css(col["fondo"].con(a=0.65)),
        "--mt-aurora-1": css(ok(0.55, 0.22, sitio.marca["h"], 0.3)),
        "--mt-aurora-2": css(ok(0.52, 0.2, _tono_aurora(sitio), 0.24)),
        "--mt-aurora-3": css(ok(0.55, 0.22, sitio.marca["h"], 0.12)),
        "--mt-aurora-3b": css(ok(0.55, 0.18, _tono_aurora(sitio), 0.12)),
        "--mt-titular-pie": css(ok(0.84, 0.04, sitio.marca["h"])),
    }
    for nombre, color in col.items():
        v[f"--mt-{nombre}"] = css(color)
    return v


# ---------- 6. Composición ----------

def _bucle(texto: str, nombre: str, items: list[dict]) -> str:
    def expandir_cuerpo(m):
        cuerpo = m.group(1)
        partes = []
        for k, item in enumerate(items):
            def valor(c, k=k, item=item):
                clave = c.group(1)
                if clave == "sep":
                    return ", " if k < len(items) - 1 else ""
                return str(item[clave]) if clave in item else c.group(0)
            partes.append(re.sub(r"\{\{(\w+)\}\}", valor, cuerpo))
        return "".join(partes)

    return re.sub(rf"\{{\{{#{nombre}\}}\}}([\s\S]*?)\{{\{{/{nombre}\}}\}}", expandir_cuerpo, texto)


def expandir(texto: str, sitio: Sitio, vistas: dict[str, list[str]], zonas: dict[str, str] | None = None) -> str:
    """Resuelve los marcadores de una receta o una hoja del sitio: categorías, zonas y ids de las vistas. `zonas`:
    las que valen para esta hoja, si no son todas las del sitio."""
    zonas = sitio.zonas if zonas is None else zonas
    texto = _condicionales(texto, zonas)
    cats = [{"i": i + 1, "nombre": c["nombre"], "num": c["num"]} for i, c in enumerate(sitio.categorias)]
    indices = sitio.lanzador_categorias if sitio.lanzador_categorias is not None else list(range(len(cats)))
    lanz = [{"i": i + 1, "c": c + 1} for i, c in enumerate(indices)]
    t = _bucle(_bucle(texto, "cats", cats), "lanz", lanz)
    t = t.replace("{{ncats}}", str(len(cats)))

    def zona(m):
        if m.group(1) not in zonas:
            raise ErrorDeComposicion(f"se usa la zona {m.group(1)}, que el sitio no define")
        return zonas[m.group(1)]

    def ids(componente: str) -> list[str]:
        if componente not in vistas:
            raise ErrorDeComposicion(f"se usa la vista {componente}, que no existe")
        return vistas[componente]

    def atributo(m):
        # Con varios atajos, la regla vale para cualquiera de ellos.
        atributos = [f'[data-mt-vista="{i}"]' for i in ids(m.group(1))]
        return atributos[0] if len(atributos) == 1 else f":is({', '.join(atributos)})"

    t = re.sub(r"\{\{z\.(\w+)\}\}", zona, t)
    t = re.sub(r'\[data-mt-vista="\{\{v\.(\w+)\}\}"\]', atributo, t)
    t = re.sub(r"\{\{v\.(\w+)\}\}", lambda m: ids(m.group(1))[0], t)
    if pendiente := re.search(r"\{\{[^}]*\}\}", t):
        raise ErrorDeComposicion(f"marcador sin resolver: {pendiente.group(0)}")
    # Un bucle vacío (un sitio sin categorías) deja declaraciones sin valor.
    return re.sub(r"(?m)^\s*[\w-]+:\s*;\s*\n", "", t)


def _hojas_genericas(sitio: Sitio, oscuro: bool, vistas: dict[str, list[str]]) -> list[str]:
    """Las hojas de un sitio sin carpeta. Lo que el sitio ya pensó para un fondo oscuro (una cabecera oscura con su
    logo claro) no se repinta claro: en una dirección clara esa franja queda como está; en una oscura, el logo solo va
    sobre una placa si la cabecera era clara. El pie toma el fondo del modo; en claro, el panel si el pie era oscuro."""
    zonas = dict(sitio.zonas)
    if not oscuro or sitio.oscuros.get("cabecera"):
        zonas.pop("logo", None)
    if not oscuro and sitio.oscuros.get("cabecera"):
        for zona in ("cabecera", "nav", "nav_enlace"):
            zonas.pop(zona, None)
    if oscuro:
        pie = ("var(--mt-superficie)", "var(--mt-tinta-2)", "var(--mt-tinta)")
    elif sitio.oscuros.get("pie"):
        pie = ("var(--mt-panel)", "var(--mt-panel-texto-2)", "var(--mt-panel-texto)")
    else:
        pie = ("var(--mt-superficie-2)", "var(--mt-tinta-2)", "var(--mt-tinta)")
    anillo = max(0, min(10, sitio.holgura_tarjetas // 2 - 2))
    hojas = [f"html.mi-tema {{\n  --mt-pie-fondo: {pie[0]};\n  --mt-pie-texto: {pie[1]};\n  --mt-pie-titulo: {pie[2]};\n"
             f"  --mt-anillo-tarjeta: {anillo}px;\n}}"]
    if oscuro:
        hojas.append(expandir((RAIZ / "base" / "oscuro-generico.css").read_text(encoding="utf-8"), sitio, vistas,
                              zonas))
    hojas.append(expandir((RAIZ / "base" / "estructura-generica.css").read_text(encoding="utf-8"), sitio, vistas,
                          zonas))
    return hojas


def regla_de_ocultar(vista: str, selector: str) -> str:
    """El bloque original que reemplaza un componente: se oculta solo si el componente se dibujó y la persona no
    pidió ver el original."""
    return (f'html.mi-tema:not(.mt-vista-original):has([data-mt-vista="{vista}"]) {selector} {{\n'
            "  display: none !important;\n}")


def componer(sitio: Sitio, direccion: str = "auto", semilla: int = 1, ajustes: dict | None = None,
             vistas: dict[str, str | list[str]] | None = None, ocultar: list[tuple[str, str]] = ()) -> Tema:
    """`ajustes`: los del modelo (`{"tipo.escala": 1.3, "hero": "ocultar", "recetas": {"agregar": [...],
    "quitar": [...]}}`); `vistas`: el id (o los ids, si hay varios atajos) de cada componente del kit; `ocultar`:
    `(vista, selector)` de los bloques que reemplazan."""
    elegidas: dict = {c: f"mt-sin-{c}" for c in COMPONENTES_KIT}
    for fuente in (sitio.vistas, vistas or {}):
        elegidas.update({c: i for c, i in fuente.items() if i})
    vistas = {c: [i] if isinstance(i, str) else list(i) for c, i in elegidas.items()}
    dirs, meta = direcciones(), recetas_meta()
    if direccion != "auto" and direccion not in dirs:
        raise ErrorDeComposicion(f"dirección desconocida: {direccion}")
    semilla = int(semilla)
    azar = Azar(semilla)
    avisos: list[str] = []

    d0, puntajes = _elegir_direccion(direccion, sitio, dirs, azar)
    d = aplicar_ajustes(d0, ajustes, sitio, avisos)
    p = _muestrear(d, sitio, azar)
    textos = {r: _receta(r) for r in meta}
    ctx = {"modo": p["modo"], "familia": p["tipo"]["familia"], "categorias": bool(sitio.categorias),
           "zonas": set(sitio.zonas), "zonas_de": lambda r: zonas_de(textos.get(r, ""))}
    mezcla = _mezcla_auto(d, dirs, meta, ctx, azar) if direccion == "auto" else []
    recetas = _resolver_recetas(d, ctx, meta, azar, ajustes, mezcla, avisos)
    # El video de fondo necesita vidrio encima; el mosaico necesita un atajo con caja.
    if p["hero"] == "atmosfera" and "vidrio" not in recetas:
        p["hero"] = "ocultar"
    if p["disposicion"] == "mosaico" and "vidrio" in recetas:
        p["disposicion"] = "apilado"
    # Una variante que el sitio no tiene no se aplica (ni se verifica su contraste).
    for clave, lista in VARIANTES.items():
        if p[clave] not in getattr(sitio, lista):
            p[clave] = None

    col = paleta.construir(p, sitio)
    verificacion = paleta.verificar(col, p, paleta.pares(p, recetas, len(sitio.categorias)))
    v = tokens(p, col, sitio)

    partes = [(RAIZ / "base" / "elegancia.css").read_text(encoding="utf-8")]
    partes.append("html.mi-tema,\nhtml.mi-tema.mt-oscuro {\n" + "\n".join(f"  {k}: {x};" for k, x in v.items()) + "\n}")
    partes.append(expandir((RAIZ / "base" / "kit.css").read_text(encoding="utf-8"), sitio, vistas))
    if estructura := sitio.estructura():
        partes.append(expandir(estructura, sitio, vistas))
    elif sitio.carpeta is None:
        partes += _hojas_genericas(sitio, p["modo"] == "oscuro", vistas)
    for clave in VARIANTES:
        if p[clave] and (variante := sitio.variante(f"{clave}-{p[clave]}")):
            partes.append(expandir(variante, sitio, vistas))
    partes += [expandir(textos[r], sitio, vistas) for r in recetas]
    partes += [regla_de_ocultar(vista, selector) for vista, selector in ocultar]
    saneado = sanear("\n\n".join(partes))

    tabla = verificacion.tabla
    informe = {
        "sitio": sitio.id,
        "pedida": direccion,
        "direccion": d["id"],
        "nombre": d["nombre"],
        "semilla": semilla,
        "puntajes": puntajes,
        "mezcla": mezcla,
        "recetas": recetas,
        "parametros": {
            "tono": fijo(p["neutros"]["tono"], 1), "croma": fijo(p["neutros"]["croma"], 4),
            "fondo": fijo(p["neutros"]["fondo"], 1), "paso": fijo(p["neutros"]["paso"], 2),
            "tinta": fijo(p["tinta"]["l"], 1), "tinta2": fijo(p["tinta"]["l2"], 1),
            "escala": fijo(p["tipo"]["escala"], 3), "peso": p["tipo"]["peso"], "ancho": p["tipo"]["ancho"],
            "radio": p["radio"], "densidad": fijo(p["densidad"], 3), "hero": p["hero"],
            "disposicion": p["disposicion"], "orden": p["orden"],
        },
        "tokens": v,
        "contraste": {"ajustes": verificacion.ajustes, "fallas": verificacion.fallas, "pares": len(tabla),
                      "minimo": verificacion.minimo},
        "saneador": {"rechazos": saneado.rechazos, "fuera_de_ambito": saneado.fuera_de_ambito},
        "ocultar": [{"vista": vista, "selector": selector} for vista, selector in ocultar],
        "avisos": avisos,
        "bytes": len(saneado.css),
    }
    return Tema(saneado.css, informe)
