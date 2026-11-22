"""Lectura del esquema de una página: enlaces por zona, formularios, botones y captcha."""

from playwright.async_api import Page

from shared.catalog.outline import Field, Form, Link, PageOutline
from shared.dom.visibility import HELPERS_JS

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
    fields: fieldsOf([...form.querySelectorAll(INPUTS)].filter(displayable)),
  }));
  const loose = [...document.querySelectorAll(INPUTS)].filter((input) => !input.form && displayable(input));
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
    // reCAPTCHA invisible no es una barrera.
    captcha: [...document.querySelectorAll('iframe[src]')].some((frame) => displayable(frame)
      && /recaptcha|hcaptcha|challenges\.cloudflare\.com/.test(frame.src) && !/size=invisible/.test(frame.src)),
  };
}"""


async def read_outline(page: Page, depth: int) -> PageOutline:
    raw = await page.evaluate(_PAGE_OUTLINE_JS)
    forms = [Form(f["method"], f["zone"], [Field(**item) for item in f["fields"]]) for f in raw["forms"]]
    return PageOutline(
        url=raw["url"], title=raw["title"], depth=depth, headings=raw["headings"],
        links=[Link(**link) for link in raw["links"]], forms=forms, buttons=raw["buttons"], captcha=raw["captcha"],
    )
