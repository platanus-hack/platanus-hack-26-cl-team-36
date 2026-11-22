"""Esquema de un sitio: enlaces por zona, formularios y botones de cada página."""

from dataclasses import dataclass, field


@dataclass
class Link:
    text: str
    href: str
    zone: str        # nav | main | footer
    visible: bool
    top: int         # px desde el inicio del documento


@dataclass
class Field:
    label: str
    type: str
    autocomplete: str


@dataclass
class Form:
    method: str | None   # None: campos sueltos, fuera de un <form>
    zone: str
    fields: list[Field]


@dataclass
class PageOutline:
    url: str
    title: str
    depth: int
    headings: list[str]
    links: list[Link]
    forms: list[Form]
    buttons: list[str]
    captcha: bool
    gates: list[str] = field(default_factory=list)   # señales de barrera de sus formularios


@dataclass
class SiteOutline:
    start_url: str
    host: str
    viewport: str
    pages: list[PageOutline]
    failures: list[str]      # URLs que no cargaron, con el motivo
