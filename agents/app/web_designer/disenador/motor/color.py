"""OKLCH → sRGB con mapeo de gama, luminancia y contraste WCAG 2.x, composición alfa y escritura en CSS.

Un color es `Color(l, c, h, a)` con `l` en 0..1 y `a` en 0..1 (1: opaco). Un fondo ya compuesto se pasa como sRGB con
gamma, una tupla de tres valores en 0..1.
"""

import math
from dataclasses import dataclass, replace
from decimal import ROUND_HALF_UP, Decimal


@dataclass(frozen=True)
class Color:
    l: float
    c: float
    h: float
    a: float = 1.0

    def con(self, **cambios) -> "Color":
        return replace(self, **cambios)


Srgb = tuple[float, float, float]


def ok(l: float, c: float, h: float, a: float | None = None) -> Color:
    return Color(l, c, h, a if a is not None and a < 1 else 1.0)


def _lineal(x: float) -> float:
    return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4


def _gamma(x: float) -> float:
    return 12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055


def _oklch_a_lineal(l: float, c: float, h: float) -> list[float]:
    r = h * math.pi / 180
    a, b = c * math.cos(r), c * math.sin(r)
    l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
    return [
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
    ]


def _dentro(rgb: list[float]) -> bool:
    return all(-1e-4 <= v <= 1 + 1e-4 for v in rgb)


def a_srgb(color: Color) -> Srgb:
    """Como el navegador: si no cabe en sRGB, baja el croma (bisección) hasta caber."""
    l = min(1.0, max(0.0, color.l))
    rgb = _oklch_a_lineal(l, color.c, color.h)
    if not _dentro(rgb):
        lo, hi = 0.0, color.c
        for _ in range(24):
            medio = (lo + hi) / 2
            if _dentro(_oklch_a_lineal(l, medio, color.h)):
                lo = medio
            else:
                hi = medio
        rgb = _oklch_a_lineal(l, lo, color.h)
    return tuple(_gamma(min(1.0, max(0.0, v))) for v in rgb)


def _srgb(x: Color | Srgb) -> Srgb:
    return x if isinstance(x, tuple) else a_srgb(x)


def componer(arriba: Color, abajo: Color | Srgb) -> Srgb:
    """`arriba` (con alfa) sobre `abajo` (opaco), en sRGB con gamma, como pinta el navegador."""
    s, d = a_srgb(arriba), _srgb(abajo)
    return tuple(v * arriba.a + d[i] * (1 - arriba.a) for i, v in enumerate(s))


def luminancia(x: Color | Srgb) -> float:
    r, g, b = (_lineal(v) for v in _srgb(x))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contraste(a: Color | Srgb, b: Color | Srgb) -> float:
    la, lb = luminancia(a), luminancia(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def mejor_tinta(fondo: Color, clara: Color, oscura: Color) -> Color:
    """La tinta que más contrasta con `fondo`."""
    return clara if contraste(clara, fondo) >= contraste(oscura, fondo) else oscura


def fijo(x: float, decimales: int) -> float:
    """Como `Number.prototype.toFixed` de JS (mitades hacia afuera sobre el valor exacto), de vuelta a número."""
    return float(Decimal(x).quantize(Decimal(1).scaleb(-decimales), rounding=ROUND_HALF_UP))


def num(x: float) -> str:
    """El número más corto que lo representa, sin `.0` (como lo escribe JS)."""
    if x == int(x):
        return str(int(x))
    return repr(x)


def css(color: Color) -> str:
    l, c, h = num(fijo(color.l * 100, 1)), num(fijo(color.c, 3)), num(fijo(color.h, 1))
    if color.a < 1:
        return f"oklch({l}% {c} {h} / {num(fijo(color.a, 3))})"
    return f"oklch({l}% {c} {h})"
