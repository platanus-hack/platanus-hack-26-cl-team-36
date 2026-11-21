"""Vista del DOM que recibe el modelo: encabezados, elementos interactivos con ref y texto visible."""

from dataclasses import dataclass
from urllib.parse import urlsplit

from playwright.async_api import ElementHandle, Page

from mapper import config

_HELPERS_JS = r"""
const clean = (s, n = 80) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const clippedByAncestor = (el, box) => {
  if (getComputedStyle(el).position === 'fixed') return false;
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    const clipsX = /hidden|clip/.test(style.overflowX), clipsY = /hidden|clip/.test(style.overflowY);
    if (!clipsX && !clipsY) continue;
    const clip = node.getBoundingClientRect();
    if (clipsX && (box.right <= clip.left || box.left >= clip.right)) return true;
    if (clipsY && (box.bottom <= clip.top || box.top >= clip.bottom)) return true;
  }
  return false;
};
const displayable = (el) => {
  const box = el.getBoundingClientRect();
  if (box.width <= 1 || box.height <= 1) return false;
  if (!el.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) return false;
  const left = box.left + scrollX, width = document.documentElement.scrollWidth;
  if (left + box.width <= 0 || left >= width || box.bottom + scrollY <= 0) return false;
  return !clippedByAncestor(el, box);
};
const centerInViewport = (el) => {
  const box = el.getBoundingClientRect();
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  return x >= 0 && x < innerWidth && y >= 0 && y < innerHeight;
};
"""

_SNAPSHOT_JS = "(maxElements) => {" + _HELPERS_JS + r"""
  const SELECTOR = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [onclick], '
    + '[aria-expanded], [aria-haspopup], [role=button], [role=link], [role=menuitem], [role=tab], [role=option], '
    + '[role=checkbox], [role=radio], [role=switch], [role=combobox], [role=textbox], [role=searchbox], [role=treeitem]';
  const INPUT_ROLES = {button: 'button', submit: 'button', reset: 'button', image: 'button', checkbox: 'checkbox',
    radio: 'radio', search: 'searchbox', range: 'slider'};
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(' ')[0];
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'select') return el.multiple ? 'listbox' : 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') return INPUT_ROLES[(el.type || 'text').toLowerCase()] || 'textbox';
    return null;
  };
  const nameOf = (el) => {
    const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map((id) => document.getElementById(id)).filter(Boolean).map((n) => n.innerText).join(' ');
    const label = el.labels && el.labels.length ? el.labels[0].innerText : '';
    const image = el.querySelector ? el.querySelector('img[alt], svg[aria-label]') : null;
    const isButtonInput = el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type);
    return clean(labelledBy) || clean(el.getAttribute('aria-label')) || clean(label) || clean(el.innerText)
      || clean(el.getAttribute('title')) || clean(el.getAttribute('alt')) || clean(el.getAttribute('placeholder'))
      || (isButtonInput ? clean(el.value) : '')
      || clean(image ? (image.getAttribute('alt') || image.getAttribute('aria-label')) : '');
  };
  const nodes = [...document.querySelectorAll(SELECTOR)].filter((el) => !el.closest('[inert]'));
  const elements = nodes.filter((el) => !(el.parentElement && el.parentElement.closest('a[href], button')));
  elements.sort((a, b) => displayable(b) - displayable(a));
  const kept = elements.slice(0, maxElements);
  window.__mapperElements = kept;
  const refOf = (el) => { const i = kept.indexOf(el); return i < 0 ? null : 'e' + i; };
  const revealerOf = (el) => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (node.tagName === 'DETAILS' && !node.open) return refOf(node.querySelector(':scope > summary'));
      if (node.id) {
        const control = document.querySelector('[aria-controls~="' + CSS.escape(node.id) + '"]');
        if (control) return refOf(control);
      }
    }
    return null;
  };
  const headings = [...document.querySelectorAll('h1, h2, h3, [role=heading]')]
    .filter(displayable).map((h) => (h.tagName.match(/^H\d$/) ? h.tagName.toLowerCase() : 'h') + ' ' + clean(h.innerText, 100))
    .filter((h) => h.length > 3).slice(0, 40);
  // Posición en innerText del primer texto que se ve desde el borde superior del viewport.
  const textOffset = (text) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const rendered = {};
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const snippet = clean(node.textContent, 40);
      if (snippet.length < 3) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const box = range.getBoundingClientRect();
      if (box.height <= 0) continue;
      rendered[snippet] = (rendered[snippet] || 0) + 1;
      if (box.bottom <= 0) continue;
      let index = -1;
      for (let seen = 0; seen < rendered[snippet]; seen++) {
        index = text.indexOf(snippet, index + 1);
        if (index < 0) break;
      }
      // Un nodo largo que empieza sobre la pantalla: se estima cuánto de él ya quedó arriba.
      if (index >= 0) return index + (box.top < 0 ? Math.floor(clean(node.textContent, 1e9).length * -box.top / box.height) : 0);
    }
    return 0;
  };
  const text = document.body ? document.body.innerText : '';
  return {
    url: location.href,
    title: document.title,
    scrollY: Math.round(scrollY),
    pageHeight: document.documentElement.scrollHeight,
    headings,
    text,
    textOffset: textOffset(text),
    total: elements.length,
    elements: kept.map((el, i) => {
      const visible = displayable(el);
      return {
        ref: 'e' + i,
        tag: el.tagName.toLowerCase(),
        role: roleOf(el),
        name: nameOf(el),
        text: clean(el.innerText),
        href: el.tagName === 'A' ? el.href : null,
        value: el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'password') || el.tagName === 'TEXTAREA'
          ? clean(el.value, 60) : null,
        expanded: el.hasAttribute('aria-expanded') ? el.getAttribute('aria-expanded') === 'true'
          : (el.tagName === 'SUMMARY' ? el.parentElement.open : null),
        disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
        visible: visible,
        inViewport: visible && centerInViewport(el),
        revealedBy: visible ? null : revealerOf(el),
      };
    }),
  };
}"""


@dataclass
class Element:
    ref: str
    tag: str
    role: str | None
    name: str
    text: str
    href: str | None
    value: str | None
    expanded: bool | None
    disabled: bool
    visible: bool           # se puede mostrar ahora: tiene tamaño y no está oculto por CSS
    in_viewport: bool       # su centro está dentro del viewport
    revealed_by: str | None  # ref del control que lo muestra, si está oculto y se sabe cuál es

    def same_host_href(self, page_url: str) -> str | None:
        """El href si apunta al mismo sitio; los enlaces externos no se le muestran al modelo."""
        if not self.href:
            return None
        return self.href if urlsplit(self.href).hostname == urlsplit(page_url).hostname else None


@dataclass
class PageView:
    url: str
    title: str
    scroll_y: int
    page_height: int
    headings: list[str]
    elements: list[Element]
    total_elements: int     # antes del tope de config.MAX_ELEMENTS
    text: str               # texto visible completo (innerText del body)
    text_offset: int        # dónde empieza en `text` lo que está en pantalla

    def element(self, ref: str) -> Element | None:
        return next((element for element in self.elements if element.ref == ref), None)


async def read_page_view(page: Page) -> PageView:
    """Toma la vista y deja los elementos en la página para resolver sus refs hasta la vista siguiente."""
    raw = await page.evaluate(_SNAPSHOT_JS, config.MAX_ELEMENTS)
    elements = [
        Element(
            ref=item["ref"], tag=item["tag"], role=item["role"], name=item["name"], text=item["text"],
            href=item["href"], value=item["value"], expanded=item["expanded"],
            disabled=item["disabled"], visible=item["visible"], in_viewport=item["inViewport"],
            revealed_by=item["revealedBy"],
        )
        for item in raw["elements"]
    ]
    return PageView(
        url=raw["url"], title=raw["title"].strip(), scroll_y=raw["scrollY"], page_height=raw["pageHeight"],
        headings=raw["headings"], elements=elements, total_elements=raw["total"], text=raw["text"],
        text_offset=raw["textOffset"],
    )


async def element_for_ref(page: Page, ref: str) -> ElementHandle | None:
    """El elemento de la última vista con esa ref, si sigue en el documento."""
    if not ref.startswith("e") or not ref[1:].isdigit():
        return None
    handle = await page.evaluate_handle(
        "(i) => { const el = (window.__mapperElements || [])[i]; return el && el.isConnected ? el : null; }",
        int(ref[1:]),
    )
    return handle.as_element()


async def display_state(handle: ElementHandle) -> tuple[bool, bool]:
    """Si el elemento se puede mostrar y si su centro está en el viewport."""
    visible, in_viewport = await handle.evaluate(
        f"(el) => {{ {_HELPERS_JS} const visible = displayable(el); return [visible, visible && centerInViewport(el)]; }}"
    )
    return visible, in_viewport


async def page_text(page: Page) -> str:
    return await page.evaluate("() => document.body ? document.body.innerText : ''")
