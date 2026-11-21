"""Prueba de integración con el puente real: llama a Claude de verdad y consume el plan de quien la ejecuta.

Uso: python3 pruebas/e2e_real.py [--url URL ...] [--sugerencia TEXTO] [--capturas CARPETA] [--visible]

Arranca `puente/puente.py` en un puerto libre, abre un Firefox aparte (perfil temporal) con el
complemento instalado, guarda la sugerencia en el panel y carga la página de demostración y las
URL indicadas. Por cada página espera a que el puente responda, comprueba que el estilo cambió y
guarda una captura del antes y otra del después.
"""

from __future__ import annotations

import argparse
import base64
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path

from e2e import FIREFOX, ID_COMPLEMENTO, RAIZ, Informe, ManejadorDemo, Marionette, esperar, preparar_perfil, puerto_libre

SUGERENCIA = "modo oscuro, texto más grande y sin barra lateral"
ESPERA_GENERACION_S = 120

GUION_FIRMA = """
const estilo = (elemento) => {
  const calculado = getComputedStyle(elemento);
  return [calculado.backgroundColor, calculado.color, calculado.fontSize].join(" | ");
};
return estilo(document.documentElement) + " || " + estilo(document.body);
"""


class RegistroPuente:
    """Lee la salida de errores del puente y guarda sus líneas de registro."""

    def __init__(self, proceso: subprocess.Popen) -> None:
        self.lineas: list[str] = []
        threading.Thread(target=self._leer, args=(proceso,), daemon=True).start()

    def _leer(self, proceso: subprocess.Popen) -> None:
        assert proceso.stderr is not None
        for linea in proceso.stderr:
            self.lineas.append(linea.rstrip())

    def generaciones(self) -> list[str]:
        return [linea for linea in self.lineas if "POST /generaciones" in linea]


def guardar_captura(navegador: Marionette, destino: Path) -> None:
    imagen = navegador.enviar("WebDriver:TakeScreenshot", {"full": False})["value"]
    destino.write_bytes(base64.b64decode(imagen))


def nombre_de_archivo(url: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", url.lower().split("://", 1)[-1]).strip("-")[:60]


def configurar(navegador: Marionette, informe: Informe, url_panel: str, base_puente: str, sugerencia: str) -> None:
    navegador.navegar_con_privilegios(url_panel)
    esperar(lambda: navegador.ejecutar("return document.getElementById('url-puente') !== null && document.getElementById('url-puente').value !== ''"), 15)
    navegador.ejecutar(
        "document.getElementById('url-puente').value = arguments[0];"
        "document.getElementById('guardar-url-puente').click();",
        base_puente,
    )
    estado = esperar(
        lambda: (texto := navegador.ejecutar("return document.getElementById('estado-puente').textContent")).startswith("Puente: listo") and texto,
        15,
    )
    informe.comprobar("el panel ve el puente real (GET /salud)", bool(estado), estado)
    navegador.ejecutar(
        "document.getElementById('sugerencia').value = arguments[0];"
        "document.getElementById('guardar').click();",
        sugerencia,
    )
    guardado = esperar(lambda: navegador.ejecutar("return document.getElementById('aviso').textContent") == "Guardado.", 10)
    informe.comprobar("el panel guarda la sugerencia", bool(guardado))


def probar_pagina(navegador: Marionette, informe: Informe, registro: RegistroPuente, url: str, capturas: Path) -> None:
    previas = len(registro.generaciones())
    inicio = time.monotonic()
    navegador.navegar(url)
    firma_original = navegador.ejecutar(GUION_FIRMA)
    base = nombre_de_archivo(url)
    guardar_captura(navegador, capturas / f"{base}-1-antes.png")

    respuesta = esperar(lambda: len(registro.generaciones()) > previas and registro.generaciones()[-1], ESPERA_GENERACION_S, 0.25)
    if not informe.comprobar(f"{url}: el puente respondió", bool(respuesta) and "estado=200" in str(respuesta), respuesta or "sin respuesta"):
        return
    cambio = esperar(lambda: navegador.ejecutar(GUION_FIRMA) != firma_original, 5)
    tardanza = time.monotonic() - inicio
    informe.comprobar(f"{url}: el estilo de la página cambió", bool(cambio), f"{tardanza:.1f} s · antes {firma_original} · después {navegador.ejecutar(GUION_FIRMA)}")
    guardar_captura(navegador, capturas / f"{base}-2-despues.png")

    previas = len(registro.generaciones())
    inicio = time.monotonic()
    navegador.enviar("WebDriver:Refresh")
    desde_cache = esperar(lambda: navegador.ejecutar(GUION_FIRMA) != firma_original, 5)
    informe.comprobar(
        f"{url}: al recargar se aplica desde la caché, sin llamar al puente",
        bool(desde_cache) and len(registro.generaciones()) == previas,
        f"{time.monotonic() - inicio:.2f} s",
    )


def main() -> int:
    analizador = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    analizador.add_argument("--url", action="append", default=[], help="página real que también se prueba (se puede repetir)")
    analizador.add_argument("--sugerencia", default=SUGERENCIA)
    analizador.add_argument("--capturas", type=Path, default=None, help="carpeta donde se guardan las capturas")
    analizador.add_argument("--visible", action="store_true", help="abre Firefox con ventana (sin -headless)")
    opciones = analizador.parse_args()

    capturas = opciones.capturas or Path(tempfile.mkdtemp(prefix="pieles-capturas-"))
    capturas.mkdir(parents=True, exist_ok=True)
    informe = Informe()
    perfil = Path(tempfile.mkdtemp(prefix="pieles-e2e-real-"))
    puerto_puente = puerto_libre()
    puente = subprocess.Popen(
        [sys.executable, str(RAIZ / "puente" / "puente.py")],
        env={**os.environ, "PUENTE_PUERTO": str(puerto_puente)},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    registro = RegistroPuente(puente)
    demo = ThreadingHTTPServer(("127.0.0.1", puerto_libre()), partial(ManejadorDemo, directory=str(RAIZ)))
    demo.daemon_threads = True
    threading.Thread(target=demo.serve_forever, daemon=True).start()
    base_puente = f"http://127.0.0.1:{puerto_puente}"
    base_demo = f"http://127.0.0.1:{demo.server_address[1]}"
    puerto_marionette = puerto_libre()
    uuid_extension = str(uuid.uuid4())
    preparar_perfil(perfil, puerto_marionette, uuid_extension)

    orden = [FIREFOX, "-no-remote", "-marionette", "-profile", str(perfil)]
    if not opciones.visible:
        orden.insert(1, "-headless")
    firefox = subprocess.Popen(orden, env={**os.environ, "MOZ_REMOTE_ALLOW_SYSTEM_ACCESS": "1"}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    navegador = None
    try:
        navegador = Marionette(puerto_marionette)
        navegador.enviar("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {"pageLoadStrategy": "normal"}}})
        print(f"demo {base_demo} · puente real {base_puente} · capturas en {capturas}", flush=True)
        instalado = navegador.enviar("Addon:Install", {"path": str((RAIZ / "extension").resolve()), "temporary": True})
        informe.comprobar("complemento temporal instalado", instalado.get("value") == ID_COMPLEMENTO)
        configurar(navegador, informe, f"moz-extension://{uuid_extension}/panel.html", base_puente, opciones.sugerencia)
        for url in [f"{base_demo}/demo/index.html", *opciones.url]:
            probar_pagina(navegador, informe, registro, url, capturas)
    except Exception as error:  # noqa: BLE001 - se informa y se limpia igual
        informe.comprobar("la prueba terminó sin errores inesperados", False, f"{type(error).__name__}: {error}")
    finally:
        if navegador is not None:
            navegador.cerrar()
        for proceso in (firefox, puente):
            proceso.terminate()
            try:
                proceso.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proceso.kill()
                proceso.wait(timeout=10)
        demo.shutdown()
        demo.server_close()
        shutil.rmtree(perfil, ignore_errors=True)

    print("\nRegistro del puente:")
    for linea in registro.lineas:
        print(f"  {linea}")
    print(f"\n{informe.total - informe.fallos} de {informe.total} comprobaciones pasaron.", flush=True)
    return 1 if informe.fallos else 0


if __name__ == "__main__":
    sys.exit(main())
