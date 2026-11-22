"""Registro de pasos. Lee el DOM solo para el log; nada de esto vuelve al modelo."""

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import Page

from visitor import config

_ELEMENT_AT_POINT_JS = r"""
([x, y]) => {
  const hit = document.elementFromPoint(x, y);
  if (!hit) return null;
  const target = hit.closest('a, button, input, select, textarea, label, summary, [role=button], [role=link], [role=menuitem], [role=tab], [role=option], [onclick]') || hit;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const type = target.getAttribute('type');
  const image = target.querySelector ? target.querySelector('img[alt]') : null;
  const text = clean(target.innerText)
    || clean(target.getAttribute('aria-label'))
    || clean(target.getAttribute('title'))
    || clean(target.getAttribute('alt'))
    || clean(target.getAttribute('placeholder'))
    || (type !== 'password' ? clean(target.value) : '')
    || clean(image ? image.alt : '');
  return {
    tag: target.tagName.toLowerCase(),
    text: text || null,
    role: target.getAttribute('role'),
    href: target.getAttribute('href'),
    type: type,
    id: target.id || null,
  };
}
"""

_VISIBLE_ERROR_JS = r"""
() => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const isVisible = (el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
  };
  const selectors = '[role=alert], .error, .errors, .alert-danger, .alert-error, .invalid-feedback, .error-message, .form-error, .has-error';
  for (const el of document.querySelectorAll(selectors)) {
    if (isVisible(el)) {
      const text = clean(el.innerText);
      if (text) return text;
    }
  }
  const pattern = /(\b404\b|\b500\b|no encontrad|not found|p[aá]gina no existe|algo sali[oó] mal|something went wrong|ha ocurrido un error|ocurri[oó] un error|error inesperado|acceso denegado|access denied)/i;
  if (pattern.test(document.title)) return clean(document.title);
  const heading = document.querySelector('h1');
  if (heading && isVisible(heading) && pattern.test(heading.innerText)) return clean(heading.innerText);
  return null;
}
"""


async def element_at(page: Page, x: int, y: int) -> dict | None:
    try:
        return await page.evaluate(_ELEMENT_AT_POINT_JS, [x, y])
    except PlaywrightError:
        return None


async def visible_error(page: Page) -> str | None:
    try:
        return await page.evaluate(_VISIBLE_ERROR_JS)
    except PlaywrightError:
        return None


def has_no_effect(url_before: str, url_after: str, change_ratio: float) -> bool:
    return url_before == url_after and change_ratio < config.NO_EFFECT_THRESHOLD


@dataclass
class Step:
    number: int
    action: str                 # miembro del toolset: left_click, type, key, scroll...
    action_input: dict          # parámetros que pidió el modelo
    description: str            # "clic en (412, 230)", "atrás", "escribir «...»"
    coordinates: list[int] | None
    expectation: str
    element: dict | None        # lo que había bajo el clic (solo para el log)
    url_before: str
    title_before: str
    url: str
    title: str
    screenshot_before: str
    screenshot: str
    seconds_since_start: float  # = settled_s; se mantiene con este nombre para el árbol y reportes anteriores
    duration_s: float           # desde el fin del paso anterior: decisión del modelo + ejecución
    screen_change: float
    signals: list[str] = field(default_factory=list)
    error_detail: str | None = None
    events: list[str] = field(default_factory=list)
    # Trazabilidad: tres momentos del paso, en segundos desde el inicio del intento y en hora local ISO 8601.
    decided_s: float | None = None  # el modelo devolvió el turno que pidió esta acción
    executed_s: float = 0.0         # justo antes de ejecutar el clic, la tecla o el scroll
    settled_s: float = 0.0          # la página terminó de reaccionar y se tomó la captura
    decided_at: str = ""
    executed_at: str = ""
    settled_at: str = ""


@dataclass
class Run:
    """Un intento de un usuario sintético: sus pasos, cómo terminó y el veredicto del juez."""

    profile: str
    profile_name: str
    viewport: str
    model: str
    start_url: str
    instruction: str
    engine: str = ""
    started_at: str = ""                            # hora local ISO 8601 del segundo 0 del intento
    start: dict = field(default_factory=dict)       # url, title, screenshot
    steps: list[Step] = field(default_factory=list)
    # done | blocked | gave_up | step_limit | time_limit | refusal | api_error | no_response | internal_error
    end_reason: str = ""
    final_message: str = ""
    duration_s: float = 0.0
    turns: int = 0
    screenshots_requested: int = 0
    incidents: list[str] = field(default_factory=list)
    token_usage: dict = field(default_factory=dict)
    final_screenshot: str = ""
    videos: list[str] = field(default_factory=list)  # con --record-video: video.webm y uno más por pestaña nueva
    video_offset_s: float = 0.0                     # segundo del video en que empieza el intento (carga inicial)
    verdict: dict = field(default_factory=dict)     # outcome, justification y, si aplica, model_verdict
    # Exploradores con nivel de conocimiento (conocimiento.py): el nivel, si `sin_contexto` leyó la tarea con palabras
    # de todos los días (False = la tarea no traía esa versión y leyó la original) y los términos oficiales que intentó
    # escribir antes de verlos en el sitio (el harness no los dejó).
    conocimiento: str | None = None
    tarea_coloquial: bool | None = None
    terminos_rechazados: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    def save(self, run_dir: Path) -> None:
        (run_dir / "run.json").write_text(json.dumps(self.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
