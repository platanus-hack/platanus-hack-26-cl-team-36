"""Página local de prueba y un Claude guionizado: las pruebas no llaman a Claude ni salen a internet."""

import pytest

from disenador.juez import ESQUEMA_PAR, ESQUEMA_PUNTAJES
from disenador.modelo import ESQUEMA_TEMA, Respuesta

PAGINA = """<!doctype html><meta charset="utf-8"><title>Prueba</title>
<style>
  :root { --color-fondo: #ffffff; --color-marca: #0a58ca; --espacio: 8px; }
  body { margin: 0; font: 16px sans-serif; background: var(--color-fondo); color: #222; }
  header.cabecera { background: #f2f2f2; padding: 12px; }
  .tenue { color: #bbb; }
  .cta { background: var(--color-marca); color: #fff; border: 0; padding: 8px; }
</style>
<header class="cabecera" role="banner"><nav id="menu"><a href="#a">Inicio</a> <a href="#b">Ayuda</a></nav></header>
<main id="contenido">
  <h1>Título principal</h1>
  <p>Texto normal con buen contraste para leer sin problemas.</p>
  <p class="tenue">Texto tenue que no cumple el contraste mínimo.</p>
  <button class="cta" id="pagar">Pagar cuenta</button>
  <button id="secundario">Ver más</button>
  <input placeholder="Buscar">
</main>
<footer><p>Pie de página</p></footer>
"""

# Oscuro, con letra más grande; oculta el botón secundario y deja una regla fuera de ámbito.
CSS_GUION = """html.mi-tema { --color-fondo: #111 !important; color-scheme: dark; }
html.mi-tema body { background: #111 !important; color: #eee !important; font-size: 18px !important; }
html.mi-tema header.cabecera { background: #1b1b1b !important; }
html.mi-tema .tenue { color: #ccc !important; }
html.mi-tema #secundario { display: none !important; }
footer p { color: #999 !important; }
html.mi-tema .cta { background-image: url(https://ejemplo.invalid/x.png); }"""


class ClaudeGuion:
    """Responde según el esquema pedido y guarda cada llamada."""

    def __init__(self, css: str = CSS_GUION):
        self.css = css
        self.llamadas: list[dict] = []

    async def pedir(self, sistema, esquema, partes, log):
        self.llamadas.append({"sistema": sistema, "esquema": esquema, "partes": partes})
        if esquema is ESQUEMA_TEMA:
            datos = {"css": self.css, "resumen": "Tema oscuro de prueba.", "decisiones": ["oscuro", "letra 18 px"]}
        elif esquema is ESQUEMA_PUNTAJES:
            datos = {}
            for d in ("estetica", "ajuste_a_gustos", "legibilidad", "jerarquia_y_foco_en_tarea", "integridad"):
                datos.update({f"{d}_puntaje": 4, f"{d}_razon": "bien"})
            datos.update(veredicto="mejor", principal_problema="ninguno")
        elif esquema is ESQUEMA_PAR:
            # Siempre elige la imagen que va segunda: sesgo de posición puro, debe salir inconsistente.
            datos = {"preferido": "B", "razon": "la segunda"}
        else:
            raise AssertionError("esquema inesperado")
        return Respuesta(datos, {"input_tokens": 10, "output_tokens": 5, "cache_read_input_tokens": 0}, 0.001, 0.1)


@pytest.fixture
def sitio(tmp_path):
    carpeta = tmp_path / "sitio"
    carpeta.mkdir()
    (carpeta / "index.html").write_text(PAGINA, encoding="utf-8")
    return carpeta / "index.html"
