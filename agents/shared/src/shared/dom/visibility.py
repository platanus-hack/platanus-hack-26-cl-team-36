"""Funciones de JavaScript que deciden qué se puede mostrar: se anteponen al código que se evalúa en la página."""

HELPERS_JS = r"""
const clean = (s, n = 80) => (s || '').replace(/\s+/g, ' ').trim().slice(0, n);
// Un contenedor con scroll no oculta lo que tiene: desde él se sigue con su propia caja.
const clippedByAncestor = (el, box) => {
  if (getComputedStyle(el).position === 'fixed') return false;
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/auto|scroll/.test(style.overflowX + style.overflowY)) {
      box = node.getBoundingClientRect();
      continue;
    }
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
// Como innerText, pero sin el texto que no se puede mostrar: oculto, sin tamaño o recortado por un ancestro.
const visibleText = (root) => {
  const shown = new Map(), blocks = new Map();
  const isShown = (el) => { if (!shown.has(el)) shown.set(el, displayable(el)); return shown.get(el); };
  const blockOf = (el) => {
    if (!blocks.has(el)) {
      let node = el;
      while (node !== root && node.parentElement && /^inline/.test(getComputedStyle(node).display)) node = node.parentElement;
      blocks.set(el, node);
    }
    return blocks.get(el);
  };
  const parts = [];
  let previous = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement, text = node.textContent.replace(/\s+/g, ' ');
    if (!el || !text.trim() || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName) || !isShown(el)) continue;
    const block = blockOf(el);
    parts.push((previous && block !== previous ? '\n' : '') + text);
    previous = block;
  }
  return parts.join('').replace(/ *\n */g, '\n').trim();
};
const centerInViewport = (el) => {
  const box = el.getBoundingClientRect();
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  return x >= 0 && x < innerWidth && y >= 0 && y < innerHeight;
};
"""
