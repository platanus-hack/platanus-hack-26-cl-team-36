"""Comparación de capturas de pantalla."""

import io

from PIL import Image, ImageChops


def screen_change_ratio(png_before: bytes, png_after: bytes) -> float:
    """Fracción de píxeles que cambiaron entre dos capturas (0 = idénticas)."""
    before = Image.open(io.BytesIO(png_before)).convert("L")
    after = Image.open(io.BytesIO(png_after)).convert("L")
    if before.size != after.size:
        return 1.0
    size = (max(1, before.width // 4), max(1, before.height // 4))
    difference = ImageChops.difference(before.resize(size), after.resize(size)).point(lambda p: 255 if p > 24 else 0)
    return difference.histogram()[255] / (size[0] * size[1])
