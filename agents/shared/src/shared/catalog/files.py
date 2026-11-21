"""Lectura de los archivos del catálogo: goals.json y outline.json."""

import json
from pathlib import Path

from shared.catalog.goal import Goal, fill_evaluation
from shared.catalog.outline import Field, Form, Link, PageOutline, SiteOutline


def read_catalog(path: Path) -> tuple[dict, list[Goal], list[str]]:
    """Meta, objetivos y correcciones de un goals.json; `instruction` y `exclusion` se recalculan con las reglas actuales."""
    data = json.loads(path.read_text(encoding="utf-8"))
    fields = Goal.__dataclass_fields__
    goals = [Goal(**{key: value for key, value in raw.items() if key in fields}) for raw in data.pop("goals")]
    for goal in goals:
        fill_evaluation(goal)
    return data, goals, data.pop("issues")


def read_outline(path: Path) -> SiteOutline:
    data = json.loads(path.read_text(encoding="utf-8"))
    pages = [
        PageOutline(**{**page, "links": [Link(**link) for link in page["links"]],
                       "forms": [Form(form["method"], form["zone"], [Field(**item) for item in form["fields"]])
                                 for form in page["forms"]]})
        for page in data["pages"]
    ]
    return SiteOutline(**{**data, "pages": pages})
