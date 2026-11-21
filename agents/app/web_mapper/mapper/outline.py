"""Esquema de una página para descubrir objetivos: enlaces por zona, formularios y señales de barrera."""

import re
from dataclasses import dataclass, field

from playwright.async_api import Page

from mapper.page_view import HELPERS_JS

_PAGE_OUTLINE_JS = "() => {" + HELPERS_JS + r"""
  const zoneOf = (el) => el.closest('header, nav, [role=banner], [role=navigation]') ? 'nav'
    : (el.closest('footer, [role=contentinfo]') ? 'footer' : 'main');
  const labelOf = (input) => clean((input.labels && input.labels[0] && input.labels[0].innerText)
    || input.getAttribute('aria-label') || input.getAttribute('placeholder') || input.name);
  const fieldsOf = (inputs) => inputs.map((input) => ({
    label: labelOf(input),
    type: (input.getAttribute('type') || input.tagName).toLowerCase(),
    autocomplete: (input.getAttribute('autocomplete') || '').toLowerCase(),
  }));
  const INPUTS = 'input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea';
  const forms = [...document.forms].map((form) => ({
    method: (form.getAttribute('method') || 'get').toLowerCase(),
    zone: zoneOf(form),
    fields: fieldsOf([...form.querySelectorAll(INPUTS)]),
  }));
  const loose = [...document.querySelectorAll(INPUTS)].filter((input) => !input.form);
  if (loose.length) forms.push({method: null, zone: 'main', fields: fieldsOf(loose)});
  return {
    url: location.href,
    title: document.title.trim(),
    headings: [...document.querySelectorAll('h1, h2, h3')].filter(displayable)
      .map((h) => clean(h.innerText, 100)).filter(Boolean).slice(0, 30),
    links: [...document.querySelectorAll('a[href]')].map((a) => ({
      text: clean(a.innerText) || clean(a.getAttribute('aria-label')) || clean(a.getAttribute('title')),
      href: a.href,
      zone: zoneOf(a),
      visible: displayable(a),
      top: Math.round(a.getBoundingClientRect().top + scrollY),
    })).filter((link) => link.text && link.href.startsWith('http')),
    forms: forms.filter((form) => form.fields.length),
    buttons: [...new Set([...document.querySelectorAll('button, [role=button]')].filter((b) => !b.closest('form'))
      .map((b) => clean(b.innerText) || clean(b.getAttribute('aria-label'))).filter(Boolean))].slice(0, 30),
    // El sello de reCAPTCHA invisible no le pide nada a la persona.
    captcha: [...document.querySelectorAll('iframe[src]')].some((frame) => displayable(frame)
      && /recaptcha|hcaptcha|challenges\.cloudflare\.com/.test(frame.src) && !/size=invisible/.test(frame.src)),
  };
}"""

_LOGIN_AUTOCOMPLETE = {"username", "current-password", "one-time-code"}
_PERSONAL_AUTOCOMPLETE = re.compile(
    r"^(name|given-name|family-name|additional-name|email|tel(-.*)?|street-address|address-line\d|address-level\d"
    r"|postal-code|country(-name)?|bday(-.*)?|cc-.*)$"
)
# Muchos formularios no declaran autocomplete: la etiqueta o el name delatan el dato ("rut_cliente", "telefono").
_PERSONAL_LABEL = re.compile(
    r"(?<![a-z])(rut|nombre|apellido|tel[eé]fono|celular|correo|e-?mail|direcci[oó]n)(?![a-z])", re.IGNORECASE
)


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
    gates: list[str] = field(default_factory=list)


def gate_signals(forms: list[Form], captcha: bool) -> list[str]:
    """Barreras de la página según sus formularios de contenido; los del encabezado y el pie se repiten en todo el sitio."""
    fields = [item for form in forms if form.zone == "main" for item in form.fields]
    gates = []
    if any(item.type == "password" or item.autocomplete in _LOGIN_AUTOCOMPLETE for item in fields):
        gates.append("login")
    if any(_PERSONAL_AUTOCOMPLETE.match(item.autocomplete) or _PERSONAL_LABEL.search(item.label) for item in fields):
        gates.append("personal_data")
    if captcha:
        gates.append("bot_check")
    return gates


async def read_outline(page: Page, depth: int) -> PageOutline:
    raw = await page.evaluate(_PAGE_OUTLINE_JS)
    forms = [Form(f["method"], f["zone"], [Field(**item) for item in f["fields"]]) for f in raw["forms"]]
    return PageOutline(
        url=raw["url"], title=raw["title"], depth=depth, headings=raw["headings"],
        links=[Link(**link) for link in raw["links"]], forms=forms, buttons=raw["buttons"], captcha=raw["captcha"],
        gates=gate_signals(forms, raw["captcha"]),
    )
