"""Lectura del catálogo en el almacén: goals.json y outline.json de una corrida del Catalogador."""

from shared import store
from shared.catalog.goal import Goal, fill_evaluation
from shared.catalog.outline import Field, Form, Link, PageOutline, SiteOutline


def read_catalog(backend: store.Backend, run: store.RunKey) -> tuple[dict, list[Goal], list[str]]:
    """Meta, objetivos y correcciones; `instruction` y `exclusion` se recalculan con las reglas actuales."""
    data = backend.read_json(run.file("goals.json"))
    fields = Goal.__dataclass_fields__
    goals = [Goal(**{key: value for key, value in raw.items() if key in fields}) for raw in data.pop("goals")]
    for goal in goals:
        fill_evaluation(goal)
    return data, goals, data.pop("issues")


def read_outline(backend: store.Backend, run: store.RunKey) -> SiteOutline:
    data = backend.read_json(run.file("outline.json"))
    pages = [
        PageOutline(**{**page, "links": [Link(**link) for link in page["links"]],
                       "forms": [Form(form["method"], form["zone"], [Field(**item) for item in form["fields"]])
                                 for form in page["forms"]]})
        for page in data["pages"]
    ]
    return SiteOutline(**{**data, "pages": pages})
