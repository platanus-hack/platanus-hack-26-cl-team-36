#!/usr/bin/env python3
"""Export the Chameleon Mode brand assets from the original vector masters.

Verified requirements: fonttools==4.68.0, brotli==1.2.0,
uharfbuzz==0.57.0, resvg_py==0.5.0, pillow==13.0.0.
Run from any directory. Font outlines are shaped with HarfBuzz; PNGs use resvg.
No runtime product assets are changed. All colors remain sRGB.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import struct
from pathlib import Path
from xml.etree import ElementTree as ET

import resvg_py
import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image


BASE = Path(__file__).resolve().parents[1]
SOURCE = BASE / "sources"
ASSETS = BASE / "assets"
FONTS = BASE / "fonts"
NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", NS)
INK = "#1C1B22"
WHITE = "#FBFBFE"
BACKGROUND = "#15151D"
STATE_OFF = "#A7A7B5"
ENTRIES: list[dict] = []
FONT_CACHE = {}


def svg(width, height, content, title="chameleon mode"):
    return (
        f'<svg xmlns="{NS}" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-label="{title}">'
        f"<title>{title}</title>{content}</svg>\n"
    )


def nested(source, x, y, size, *, strip_tile=False):
    root = ET.fromstring(source)
    root.set("x", str(x))
    root.set("y", str(y))
    root.set("width", str(size))
    root.set("height", str(size))
    if strip_tile:
        for child in list(root):
            if child.tag == f"{{{NS}}}path" and child.get("fill") == "url(#fondo)":
                root.remove(child)
    return ET.tostring(root, encoding="unicode")


def disabled_extension(source):
    """Replace the spectrum with a state color, retaining the original tile/eye.

    This is a functional global-disabled state, not a replacement brand mark.
    No opacity, CSS filter, or change to the original geometry is applied.
    """
    root = ET.fromstring(source)
    for gradient in root.iter(f"{{{NS}}}linearGradient"):
        if gradient.get("id") != "fondo":
            for stop in gradient.iter(f"{{{NS}}}stop"):
                stop.set("stop-color", STATE_OFF)
    for element in root.iter():
        if element.get("fill") == "#B8FF5C":
            element.set("fill", STATE_OFF)
    return ET.tostring(root, encoding="unicode") + "\n"


def geometry_signature(markup):
    """Compare vector geometry while permitting the documented state colors."""
    return [
        (element.tag, sorted((key, value) for key, value in element.attrib.items() if key not in {"fill", "stop-color"}))
        for element in ET.fromstring(markup).iter()
    ]


def get_font(weight):
    if weight not in FONT_CACHE:
        font = instantiateVariableFont(
            TTFont(FONTS / "InterVariable.ttf"),
            {"wght": weight, "opsz": 32},
            inplace=False,
        )
        data = io.BytesIO()
        font.save(data)
        face = hb.Face(data.getvalue())
        shaper = hb.Font(face)
        shaper.scale = (font["head"].unitsPerEm,) * 2
        hb.ot_font_set_funcs(shaper)
        FONT_CACHE[weight] = (font, shaper)
    return FONT_CACHE[weight]


def text_paths(text, size, weight, color):
    font, shaper = get_font(weight)
    glyphs = font.getGlyphSet()
    glyph_order = font.getGlyphOrder()
    scale = size / font["head"].unitsPerEm
    buffer = hb.Buffer()
    buffer.add_str(text)
    buffer.guess_segment_properties()
    hb.shape(shaper, buffer, {"kern": True, "liga": True})
    advance = 0
    pen = SVGPathPen(glyphs)
    tracking = -0.018 * size / scale
    for info, position in zip(buffer.glyph_infos, buffer.glyph_positions):
        transformed = TransformPen(
            pen,
            (1, 0, 0, 1, advance + position.x_offset, position.y_offset),
        )
        glyphs[glyph_order[info.codepoint]].draw(transformed)
        advance += position.x_advance + tracking
    advance -= tracking
    return (
        f'<path fill="{color}" transform="scale({scale:.9f} {-scale:.9f})" '
        f'd="{pen.getCommands()}"/>',
        advance * scale,
    )


def wordmark(size, color):
    first, first_width = text_paths("chameleon", size, 600, color)
    second, second_width = text_paths("mode", size * 0.72, 400, color)
    gap = size * 0.28
    return (
        first + f'<g transform="translate({first_width + gap:.4f} 0)">{second}</g>',
        first_width + gap + second_width,
    )


def register(path, role, intended_background=None, **extra):
    raw = path.read_bytes()
    entry = {
        "file": str(path.relative_to(BASE)),
        "format": path.suffix.lstrip("."),
        "role": role,
        "bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }
    if intended_background:
        entry["intended_background"] = intended_background
    if path.suffix == ".svg":
        root = ET.fromstring(raw)
        box = list(map(float, root.attrib["viewBox"].split()))
        entry["viewBox"] = box
        entry["vector_only"] = True
        entry["external_font_dependency"] = False
    elif path.suffix == ".png":
        with Image.open(path) as im:
            alpha = im.convert("RGBA").getchannel("A")
            entry.update(
                width=im.width,
                height=im.height,
                alpha_channel="A" in im.getbands(),
                transparent_pixels=alpha.getextrema()[0] < 255,
                color_space="sRGB",
            )
    entry.update(extra)
    ENTRIES.append(entry)


def save_svg(name, markup, role, intended_background=None, **extra):
    path = ASSETS / f"{name}.svg"
    path.write_text(markup, encoding="utf-8")
    register(path, role, intended_background, **extra)
    return markup


def save_png(name, markup, width, height, role, intended_background=None, opaque=False, **extra):
    raw = resvg_py.svg_to_bytes(
        svg_string=markup,
        width=width,
        height=height,
        skip_system_fonts=True,
    )
    im = Image.open(io.BytesIO(raw)).convert("RGB" if opaque else "RGBA")
    path = ASSETS / f"{name}.png"
    im.save(path, optimize=True)
    register(path, role, intended_background, **extra)
    return path


def save_lockup(name, markup, width, height, role, intended_background):
    save_svg(name, markup, role, intended_background)
    save_png(name, markup, width, height, role, intended_background, scale=1)
    save_png(f"{name}@2x", markup, width * 2, height * 2, role, intended_background, scale=2)


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    original = (SOURCE / "logo.svg").read_text()
    micro = (SOURCE / "logo-16.svg").read_text()
    mono_ink = (SOURCE / "logo-mono-tinta.svg").read_text()
    mono_white = (SOURCE / "logo-mono-blanco.svg").read_text()

    for name, markup, role, bg in [
        ("symbol-color", original, "Símbolo maestro original, color sobre baldosa", "any"),
        ("symbol-mono-ink", mono_ink, "Símbolo a una tinta", "light"),
        ("symbol-mono-white", mono_white, "Símbolo a una tinta", "dark"),
        ("symbol-micro-16", micro, "Maestro óptico original exclusivamente para 16 px", "dark"),
    ]:
        save_svg(name, markup, role, bg, original_geometry=True)
        if name != "symbol-micro-16":
            for size in (512, 1024):
                save_png(f"{name}-{size}", markup, size, size, role, bg)

    for suffix, color, symbol, bg in [
        ("on-light", INK, original, "light"),
        ("on-dark", WHITE, original, "dark"),
        ("mono-ink", INK, mono_ink, "light"),
        ("mono-white", WHITE, mono_white, "dark"),
    ]:
        lettering, text_width = wordmark(48, color)
        width = math.ceil(136 + text_width + 24)
        content = nested(symbol, 16, 16, 96)
        content += f'<g transform="translate(136 81)">{lettering}</g>'
        save_lockup(
            f"logo-horizontal-{suffix}", svg(width, 128, content), width, 128,
            "Firma horizontal; símbolo + chameleon semibold + mode regular al 72%", bg,
        )
        if suffix.startswith("on-"):
            stacked_width = math.ceil(text_width + 64)
            stacked = nested(original, (stacked_width - 176) / 2, 16, 176)
            stacked += f'<g transform="translate(32 252)">{lettering}</g>'
            save_lockup(
                f"logo-stacked-{suffix}", svg(stacked_width, 288, stacked),
                stacked_width, 288, "Firma centrada para portadas y piezas verticales", bg,
            )
            mark = f'<g transform="translate(16 57)">{lettering}</g>'
            save_lockup(
                f"wordmark-{suffix}", svg(math.ceil(text_width + 32), 80, mark),
                math.ceil(text_width + 32), 80, "Wordmark sin símbolo para espacios secundarios", bg,
            )

    favicon_micro = svg(16, 16, '<rect width="16" height="16" rx="3.5" fill="#15151D"/>' + nested(micro, 0, 0, 16))
    save_svg("favicon", favicon_micro, "Favicon con geometría óptica 16 px y fondo de contraste", "any")
    ico_parts = []
    for size in (16, 32, 48):
        markup = favicon_micro if size == 16 else original
        path = save_png(f"favicon-{size}", markup, size, size, "Favicon", "any")
        ico_parts.append((size, path.read_bytes()))
    offset = 6 + 16 * len(ico_parts)
    directory = []
    for size, data in ico_parts:
        directory.append(struct.pack("<BBBBHHII", size, size, 0, 0, 1, 32, len(data), offset))
        offset += len(data)
    ico = ASSETS / "favicon.ico"
    ico.write_bytes(struct.pack("<HHH", 0, 1, len(ico_parts)) + b"".join(directory) + b"".join(data for _, data in ico_parts))
    register(ico, "Favicon multirresolución con arte óptico real en 16 px", "any", sizes=[16, 32, 48])

    for size in (16, 32, 48, 64, 96, 128):
        markup = favicon_micro if size == 16 else original
        save_png(f"extension-{size}", markup, size, size, "Ícono PNG genérico de extensión Firefox/Chromium; alias histórico del estado encendido", "any", state_scope="extension_global", state="enabled")

    # Toolbar/popup state must describe global enablement, never per-site support.
    off = disabled_extension(original)
    off_micro = disabled_extension(micro)
    assert geometry_signature(original) == geometry_signature(off)
    assert geometry_signature(micro) == geometry_signature(off_micro)
    for state, full, small, meaning in (
        ("on", original, micro, "enabled"),
        ("off", off, off_micro, "disabled"),
    ):
        role = f"Estado {state.upper()} de toolbar/popup: habilitación GLOBAL de la extensión; no indica activación ni compatibilidad de un sitio"
        metadata = {"state_scope": "extension_global", "state": meaning, "brand_variant": False, "original_geometry": True}
        save_svg(f"extension-{state}", full, role, "any", **metadata)
        save_svg(f"extension-{state}-16", small, role + "; geometría óptica de 16 px", "any", **metadata)
        for size in (16, 32, 48, 96, 128):
            save_png(f"extension-{state}-{size}", small if size == 16 else full, size, size, role, "any", **metadata)
    for size in (16, 32, 48, 96, 128):
        with Image.open(ASSETS / f"extension-on-{size}.png") as on_image, Image.open(ASSETS / f"extension-off-{size}.png") as off_image:
            assert on_image.size == off_image.size == (size, size)
            assert on_image.mode == off_image.mode == "RGBA"
            assert on_image.getchannel("A").tobytes() == off_image.getchannel("A").tobytes()
            assert on_image.getchannel("A").getextrema() == (0, 255)
            assert on_image.tobytes() != off_image.tobytes()

    # Full-bleed square: the operating system supplies its own corner mask.
    full_bleed = svg(128, 128, '<rect width="128" height="128" fill="#15151D"/>' + nested(original, 0, 0, 128, strip_tile=True))
    save_svg("app-icon-fullbleed", full_bleed, "Maestro opaco cuadrado sin esquinas precortadas", "opaque")
    save_png("apple-touch-icon", full_bleed, 180, 180, "Apple Home Screen Web Clip", "opaque", opaque=True)
    for size in (192, 512):
        save_png(f"pwa-{size}", full_bleed, size, size, "Ícono instalable de app; purpose any", "opaque", opaque=True, manifest_purpose="any")

    # Keep every colored symbol pixel within the central 80% diameter safe circle.
    mask_symbol = svg(512, 512, nested(original, 22, 22, 468, strip_tile=True))
    maskable = svg(512, 512, '<rect width="512" height="512" fill="#15151D"/>' + nested(original, 22, 22, 468, strip_tile=True))
    save_svg("pwa-maskable", maskable, "Maestro adaptativo con fondo opaco y zona segura circular", "opaque")
    mask_png = save_png("pwa-maskable-512", maskable, 512, 512, "Ícono instalable adaptativo; purpose maskable", "opaque", opaque=True, manifest_purpose="maskable")
    mark_im = Image.open(io.BytesIO(resvg_py.svg_to_bytes(svg_string=mask_symbol, width=512, height=512))).convert("RGBA")
    alpha = mark_im.getchannel("A")
    max_radius = max(
        math.hypot(x + 0.5 - 256, y + 0.5 - 256)
        for y in range(512) for x in range(512) if alpha.getpixel((x, y)) > 0
    )
    assert max_radius < 204.8, f"Maskable symbol exceeds safe circle: {max_radius}"

    contest = svg(1000, 1000, '<rect width="1000" height="1000" fill="#15151D"/>' + nested(original, 0, 0, 1000, strip_tile=True))
    contest_path = save_png("project-logo-1000", contest, 1000, 1000, "Logo para ficha del concurso; 1000 × 1000 y menos de 500 KB", "opaque", opaque=True)
    assert contest_path.stat().st_size < 500_000

    avatar = svg(1024, 1024, '<rect width="1024" height="1024" fill="#15151D"/>' + nested(original, 44, 44, 936, strip_tile=True))
    avatar_role = "Avatar con fondo opaco y símbolo protegido ante recorte circular"
    save_svg("avatar-1024", avatar, avatar_role, "opaque", circular_crop_safe=True)
    save_png("avatar-1024", avatar, 1024, 1024, avatar_role, "opaque", opaque=True, circular_crop_safe=True)
    avatar_alpha = Image.open(io.BytesIO(resvg_py.svg_to_bytes(svg_string=mask_symbol, width=1024, height=1024))).convert("RGBA").getchannel("A")
    avatar_max_radius = max(
        math.hypot(x + 0.5 - 512, y + 0.5 - 512)
        for y in range(1024) for x in range(1024) if avatar_alpha.getpixel((x, y)) > 0
    )
    assert avatar_max_radius < 409.6

    # Social sharing card: one brand signature, a domain, and generous empty space.
    signature, _ = wordmark(88, WHITE)
    domain, _ = text_paths("chameleonmode.app", 24, 400, "#ADAEBB")
    social_content = '<rect width="1200" height="630" fill="#0B0B10"/>'
    social_content += nested(original, 116, 219, 160)
    social_content += f'<g transform="translate(320 318)">{signature}</g>'
    social_content += f'<g transform="translate(320 376)">{domain}</g>'
    social = svg(1200, 630, social_content, "chameleon mode — chameleonmode.app")
    social_role = "Tarjeta social de marca para enlaces y presentaciones; firma única y dominio, sin slogan"
    save_svg("social-card-1200x630", social, social_role, "opaque", copy="chameleon mode", domain="chameleonmode.app")
    save_png("social-card-1200x630", social, 1200, 630, social_role, "opaque", opaque=True, copy="chameleon mode", domain="chameleonmode.app")

    # Structural and delivery validation, recorded with the assets.
    for path in ASSETS.glob("*.svg"):
        root = ET.parse(path).getroot()
        forbidden = {"text", "image", "script", "foreignObject", "style", "filter"}
        assert not any(e.tag.split("}")[-1] in forbidden for e in root.iter()), path
        assert "font-family" not in path.read_text()
        assert not any("href" in key for e in root.iter() for key in e.attrib), path
    for path in ASSETS.glob("*.png"):
        with Image.open(path) as im:
            im.verify()
    for name, dimensions in (("social-card-1200x630", (1200, 630)), ("avatar-1024", (1024, 1024))):
        with Image.open(ASSETS / f"{name}.png") as im:
            assert im.size == dimensions and im.mode == "RGB", name
    for name in ("symbol-color-512", "symbol-mono-ink-512", "symbol-mono-white-512", "logo-horizontal-on-light"):
        with Image.open(ASSETS / f"{name}.png") as im:
            assert im.convert("RGBA").getchannel("A").getextrema() == (0, 255), name
    with Image.open(ASSETS / "favicon.ico") as im:
        assert im.ico.sizes() == {(16, 16), (32, 32), (48, 48)}
        for size in (16, 32, 48):
            im.ico.getimage((size, size)).load()

    manifest = {
        "brand": "chameleon mode",
        "domain": "chameleonmode.app",
        "version": "1.1",
        "color_space": "sRGB",
        "source_symbol": "sources/logo.svg",
        "source_masters": [
            {"file": str(path.relative_to(BASE)), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
            for path in sorted(SOURCE.glob("*.svg"))
        ],
        "symbol_policy": "La geometría y el orden del espectro originales se conservan. Los íconos instalables solo adaptan fondo y escala.",
        "extension_states": {"scope": "global_enablement", "on": "Espectro original: extensión habilitada globalmente", "off": "Símbolo neutro #A7A7B5 sobre baldosa original: extensión deshabilitada globalmente", "off_color": STATE_OFF, "site_support_semantics": False, "brand_replacement": False, "geometry": "Maestros originales intactos, incluidos el ajuste óptico a 16 px, la baldosa y el ojo; sin filtros ni reducción de opacidad"},
        "wordmark": {"family": "Inter", "optical_size": 32, "chameleon_weight": 600, "mode_weight": 400, "mode_scale": 0.72, "baseline": "shared", "word_gap_em": 0.28, "tracking_em": -0.018, "outlined": True},
        "svg_policy": "Geometría vectorial; sin imágenes raster incrustadas, sin texto vivo ni fuentes externas.",
        "transparency_note": "Los lockups PNG tienen alfa real. La baldosa del símbolo color es parte de la marca; la transparencia queda fuera de ella. Apple/PWA/concurso/avatar/tarjeta social son opacos.",
        "print_note": "SVG es el maestro escalable. Para imprenta, acordar perfil CMYK y prueba de color con proveedor; no se promete equivalencia directa del espectro RGB.",
        "validation": {"svg_vector_only": True, "png_decode": True, "transparent_lockups": True, "ico_embedded_sizes": [16,32,48], "extension_state_sizes": [16,32,48,96,128], "extension_states_geometry_identical": True, "extension_states_alpha_identical": True, "extension_states_distinct_colors": True, "maskable_safe_circle_radius_px": 204.8, "maskable_max_symbol_radius_px": round(max_radius, 3), "maskable_opaque": True, "avatar_circular_crop_safe": True, "avatar_max_symbol_radius_px": round(avatar_max_radius, 3), "avatar_safe_circle_radius_px": 409.6, "social_card_size": [1200, 630], "social_card_opaque": True, "contest_under_500kb": True},
        "sources": [
            "https://rsms.me/inter/", "https://github.com/rsms/inter/blob/master/LICENSE.txt",
            "https://github.com/JetBrains/JetBrainsMono", "https://openfontlicense.org/ofl-faq/",
            "https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Define_app_icons",
            "https://web.dev/articles/add-manifest",
            "https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html",
            "https://developer.chrome.com/docs/extensions/reference/manifest/icons",
        ],
        "assets": ENTRIES,
    }
    (BASE / "manifest-assets.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"assets": len(ENTRIES), "maskable_max_symbol_radius_px": max_radius, "contest_bytes": contest_path.stat().st_size}, indent=2))


if __name__ == "__main__":
    main()
