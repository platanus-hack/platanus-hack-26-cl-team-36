"""De los parámetros muestreados a colores con nombre, y la verificación AA que los corrige moviendo L en OKLCH."""

from dataclasses import dataclass, field

from disenador.motor.color import Color, Srgb, a_srgb, componer, contraste, fijo, luminancia, mejor_tinta, ok

BLANCO = ok(0.995, 0, 0)
LUCES_MARCA = (0.5, 0.62, 0.42, 0.7, 0.56, 0.66)


def construir(p: dict, sitio) -> dict[str, Color]:
    """`p`: los parámetros muestreados de la dirección; `sitio`: su marca y sus categorías."""
    oscuro = p["modo"] == "oscuro"
    n = p["neutros"]
    h, c, f, paso = n["tono"], n["croma"], n["fondo"], n["paso"]
    mh, mc = sitio.marca["h"], sitio.marca["c"]
    col: dict[str, Color] = {}

    col["fondo"] = ok(f / 100, c, h)
    if oscuro:
        col["superficie"] = ok((f + paso) / 100, c * 1.1, h)
        col["superficie-2"] = ok((f + 2 * paso) / 100, c * 1.2, h)
        col["tinta"] = ok(p["tinta"]["l"] / 100, c * 0.4, h)
        col["tinta-2"] = ok(p["tinta"]["l2"] / 100, c, h)
    else:
        croma_tinta = p["tinta"].get("croma") or 0.02
        col["superficie"] = ok(min(99.8, f + 1.8) / 100, c * 0.35, h)
        col["superficie-2"] = ok((f - paso) / 100, c * 1.3, h)
        col["tinta"] = ok(p["tinta"]["l"] / 100, croma_tinta, h)
        col["tinta-2"] = ok(p["tinta"]["l2"] / 100, croma_tinta * 1.4, h)
    col["campo"] = col["superficie-2"]

    acento = p["acento"]
    col["acento"] = ok(acento["l"] / 100, acento["c"], mh)
    col["acento-texto"] = BLANCO
    col["acento-hover"] = ok(acento["l"] / 100 + (0.04 if oscuro else -0.06), acento["c"], mh)
    col["acento-legible"] = ok(0.7 if oscuro else 0.48, min(acento["c"], 0.16 if oscuro else 0.2), mh)
    col["foco"] = ok(p["foco"]["l"] / 100, p["foco"]["c"], p["foco"]["tono"])

    if p["panel"] == "tinta":
        col["panel"] = ok(0.21, 0.02, h)
        col["panel-2"] = ok(0.3, 0.022, h)
        col["panel-texto"] = BLANCO
        col["panel-texto-2"] = ok(0.88, 0.012, h)
    else:
        col["panel"] = col["superficie"]
        col["panel-2"] = col["superficie-2"]
        col["panel-texto"] = col["tinta"]
        col["panel-texto-2"] = col["tinta-2"]

    lm = p["marca"]["l"] / 100
    col["marca"] = ok(lm, mc, mh)
    col["marca-2"] = ok(lm + 0.045, mc, mh + 1)
    col["marca-hondo"] = ok(lm - 0.08, mc * 0.85, mh)
    col["marca-texto"] = BLANCO
    col["marca-campo"] = ok(0.995, 0.004, mh)
    col["marca-campo-texto"] = ok(0.21, 0.02, mh)
    col["marca-campo-texto-2"] = ok(0.45, 0.03, mh)
    col["marca-boton"] = ok(0.21, 0.02, mh)
    col["marca-boton-texto"] = BLANCO

    clara, oscura = ok(0.99, 0, 0), ok(0.17, 0.01, h)
    # Con categorías derivadas, Nativa no inventa colores: son luces del tono de la marca.
    monocromas = p["categorias"] == "marca" and getattr(sitio, "categorias_derivadas", False)
    for i, categoria in enumerate(sitio.categorias, start=1):
        l0, c0, h0 = categoria["color"]
        if monocromas:
            l0, c0, h0 = LUCES_MARCA[(i - 1) % len(LUCES_MARCA)], min(c0, mc), mh
        base = ok(max(l0, 0.66) if p["categorias"] == "aclaradas" else l0, c0, h0)
        col[f"c{i}"] = base
        col[f"c{i}-tinta"] = mejor_tinta(base, clara, oscura)
        col[f"c{i}-punto"] = BLANCO if contraste(base, col["marca"]) < 1.6 else base
        s = p["suaves"]
        col[f"c{i}-suave"] = ok(0.3, 0.05, h0) if oscuro else ok(s["l"] / 100, s["c"], h0)
        col[f"c{i}-suave-tinta"] = ok(0.93, 0.03, h0) if oscuro else ok(0.27, 0.07, h0)
        col[f"c{i}-luz"] = ok(max(l0, 0.72), min(c0, 0.17), h0) if oscuro else ok(min(l0, 0.5), c0, h0)
    # Destello: la categoría más luminosa (el amarillo en metro), para el botón de intercambiar; sin categorías, el foco.
    claras = sorted((col[f"c{i}"] for i in range(1, len(sitio.categorias) + 1)), key=luminancia, reverse=True)
    col["destello"] = claras[0] if claras else col["foco"]
    col["destello-tinta"] = mejor_tinta(col["destello"], clara, oscura)
    col["vivo"] = ok(0.74 if oscuro else 0.6, 0.17, 150)

    col["vidrio"] = col["superficie"].con(l=col["superficie"].l + 0.01, a=0.62)
    col["vidrio-campo"] = ok(1, 0, 0, 0.055)
    return col


def fondos_compuestos(col: dict[str, Color], p: dict) -> dict[str, Srgb]:
    """Lo que de verdad queda detrás del texto translúcido."""
    hero_peor = componer(col["fondo"].con(a=0.475), a_srgb(ok(0.45, 0, 0)))
    detras_vidrio = hero_peor if p["hero"] == "atmosfera" else a_srgb(col["fondo"])
    vidrio = componer(col["vidrio"], detras_vidrio)
    return {"heroPeor": hero_peor, "vidrio": vidrio, "vidrioCampo": componer(col["vidrio-campo"], vidrio)}


@dataclass
class Par:
    fg: str
    bg: str
    minimo: float = 4.5
    mover: str = "fg"

    @property
    def nombre(self) -> str:
        return f"{self.fg} / {self.bg}"


def pares(p: dict, recetas: list[str], n_categorias: int) -> list[Par]:
    """Los pares de texto y fondo que el tema usa, según la dirección y las recetas elegidas."""
    lista: list[Par] = []

    def par(fg, bg, minimo=4.5, mover="fg"):
        lista.append(Par(fg, bg, minimo, mover))

    for bg in ("fondo", "superficie", "superficie-2"):
        par("tinta", bg)
        par("tinta-2", bg)
    par("acento-texto", "acento", 4.5, "bg")
    par("acento-texto", "acento-hover", 4.5, "bg")
    par("acento-legible", "fondo")
    par("acento-legible", "superficie")
    par("foco", "fondo", 3)
    par("panel-texto", "panel")
    par("panel-texto-2", "panel")
    par("panel-texto-2", "panel-2")
    if "superficie-marca" in recetas:
        par("marca-texto", "marca", 4.5, "bg")
        par("marca-texto", "marca-2", 4.5, "bg")
        par("marca-campo-texto", "marca-campo")
        par("marca-campo-texto-2", "marca-campo")
        par("marca-boton-texto", "marca-boton", 4.5, "bg")
        par("destello-tinta", "destello", 3, "bg")
    for i in range(1, n_categorias + 1):
        if "placas-atajo" in recetas or "discos-lanzador" in recetas:
            par(f"c{i}-tinta", f"c{i}", 4.5, "bg")
        if "bento-lanzador" in recetas:
            par(f"c{i}-suave-tinta", f"c{i}-suave")
        if "comandos-lanzador" in recetas:
            par(f"c{i}-luz", "superficie")
    if "vidrio" in recetas:
        par("tinta", "@vidrio")
        par("tinta-2", "@vidrio")
        par("tinta", "@vidrioCampo")
    if p["hero"] == "atmosfera":
        par("tinta", "@heroPeor")
        par("tinta-2", "@heroPeor")
    return lista


@dataclass
class Verificacion:
    ajustes: list[dict] = field(default_factory=list)
    fallas: list[dict] = field(default_factory=list)
    tabla: list[tuple[str, float]] = field(default_factory=list)

    @property
    def minimo(self) -> float | None:
        return min((r for _, r in self.tabla), default=None)


def verificar(col: dict[str, Color], p: dict, lista: list[Par]) -> Verificacion:
    """Mueve L (paso 0,5 %) del lado que se mueve hasta cumplir; repite la lista hasta que nada cambie. Modifica `col`."""
    resultado = Verificacion()

    def fondo(clave: str):
        return fondos_compuestos(col, p)[clave[1:]] if clave.startswith("@") else col[clave]

    def presente(par: Par) -> bool:
        return par.fg in col and (par.bg.startswith("@") or par.bg in col)

    for _ in range(6):
        cambio = False
        for par in lista:
            if not presente(par):
                continue
            r = contraste(col[par.fg], fondo(par.bg))
            if r >= par.minimo:
                continue
            clave = par.fg if par.mover == "fg" or par.bg.startswith("@") else par.bg
            otra = fondo(par.bg) if clave == par.fg else col[par.fg]
            antes = col[clave].l
            subir = luminancia(col[clave]) >= luminancia(otra)
            guardia = 0
            while r < par.minimo and guardia < 200:
                guardia += 1
                l = col[clave].l + (0.005 if subir else -0.005)
                if l < 0 or l > 1:
                    break
                col[clave] = col[clave].con(l=l)
                r = contraste(col[par.fg], fondo(par.bg))
            cambio = True
            resultado.ajustes.append({"par": par.nombre, "mueve": clave, "de": fijo(antes * 100, 1),
                                      "a": fijo(col[clave].l * 100, 1), "razon": fijo(r, 2)})
        if not cambio:
            break
    for par in lista:
        if presente(par):
            razon = fijo(contraste(col[par.fg], fondo(par.bg)), 2)
            resultado.tabla.append((par.nombre, razon))
            if razon < par.minimo:
                resultado.fallas.append({"par": par.nombre, "min": par.minimo, "razon": razon})
    return resultado
