"""Prueba de punta a punta del prototipo, sin Node ni dependencias externas.

Uso: python3 pruebas/e2e.py [--larga] [--visible]

Levanta la página de demostración y el puente falso en puertos libres, abre un Firefox aparte
(perfil temporal, sin tocar el perfil ni el Firefox del usuario), instala `extension/` como
complemento temporal por Marionette y comprueba que la piel se genera, se sanea, se inyecta y
se reutiliza desde la caché. Con `--larga` añade una generación de 45 s, más larga que los 30 s
de inactividad tras los que Firefox descarga el script de fondo.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

from puente_falso import COLOR_CABECERA, COLOR_FONDO, ServidorPuente

RAIZ = Path(__file__).resolve().parent.parent
FIREFOX = "/Applications/Firefox.app/Contents/MacOS/firefox"
ID_COMPLEMENTO = "pieles-prototipo@grupo36.hackathon"
SUGERENCIA = "modo oscuro, texto más grande y sin barra lateral"
TEXTOS_PRIVADOS = ["zarzamora", "gaceta", "valor-secreto", "enlace-secreto", "alt-secreto", "consulta-secreta", "leer más"]


class ManejadorDemo(SimpleHTTPRequestHandler):
    """Sirve `extension/` y `pruebas/` tal cual; cualquier otra ruta devuelve la página de demostración."""

    def log_message(self, formato: str, *argumentos: object) -> None:  # noqa: D102
        return

    def translate_path(self, path: str) -> str:  # noqa: D102
        ruta = path.split("?", 1)[0].split("#", 1)[0]
        if ruta.startswith(("/extension/", "/pruebas/")):
            return super().translate_path(path)
        return str(RAIZ / "demo" / "index.html")


class Marionette:
    """Cliente mínimo del protocolo Marionette (JSON con prefijo de longitud sobre TCP)."""

    def __init__(self, puerto: int, espera_s: float = 60.0) -> None:
        limite = time.monotonic() + espera_s
        while True:
            try:
                self.conexion = socket.create_connection(("127.0.0.1", puerto), timeout=5)
                break
            except OSError:
                if time.monotonic() > limite:
                    raise TimeoutError("Firefox no abrió el puerto de Marionette.") from None
                time.sleep(0.3)
        self.conexion.settimeout(120)
        self.pendiente = b""
        self.contador = 0
        self._leer()  # saludo del servidor

    def _leer(self) -> Any:
        while b":" not in self.pendiente:
            self.pendiente += self._recibir()
        largo, _, resto = self.pendiente.partition(b":")
        while len(resto) < int(largo):
            resto += self._recibir()
        self.pendiente = resto[int(largo) :]
        return json.loads(resto[: int(largo)])

    def _recibir(self) -> bytes:
        datos = self.conexion.recv(65536)
        if not datos:
            raise ConnectionError("Firefox cerró la conexión de Marionette.")
        return datos

    def enviar(self, comando: str, parametros: dict | None = None) -> Any:
        self.contador += 1
        mensaje = json.dumps([0, self.contador, comando, parametros or {}]).encode()
        self.conexion.sendall(str(len(mensaje)).encode() + b":" + mensaje)
        _, _, error, resultado = self._leer()
        if error:
            raise RuntimeError(f"{comando}: {error.get('error')}: {error.get('message')}")
        return resultado

    def ejecutar(self, guion: str, *argumentos: Any) -> Any:
        """Ejecuta JavaScript en la página actual y devuelve su valor (espera las promesas)."""
        return self.enviar("WebDriver:ExecuteScript", {"script": guion, "args": list(argumentos)})["value"]

    def navegar(self, url: str) -> None:
        self.enviar("WebDriver:Navigate", {"url": url})

    def ejecutar_en_navegador(self, guion: str, *argumentos: Any) -> Any:
        """Ejecuta JavaScript con privilegios en la ventana del navegador (requiere `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`)."""
        self.enviar("Marionette:SetContext", {"value": "chrome"})
        try:
            return self.ejecutar(guion, *argumentos)
        finally:
            self.enviar("Marionette:SetContext", {"value": "content"})

    def cambiar_a(self, pestana: str) -> None:
        self.enviar("WebDriver:SwitchToWindow", {"handle": pestana, "focus": False})

    def navegar_con_privilegios(self, url: str) -> None:
        """Carga en la pestaña actual una URL que `WebDriver:Navigate` no admite (`moz-extension://`).

        Lo hace desde el contexto del navegador (requiere `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`).
        """
        self.ejecutar_en_navegador(
            "const principal = Services.scriptSecurityManager.getSystemPrincipal();"
            "gBrowser.selectedBrowser.fixupAndLoadURIString(arguments[0], { triggeringPrincipal: principal });",
            url,
        )

    def cerrar(self) -> None:
        self.conexion.close()


class Informe:
    """Lleva la cuenta de las comprobaciones y las imprime."""

    def __init__(self) -> None:
        self.fallos = 0
        self.total = 0

    def comprobar(self, nombre: str, ok: bool, detalle: object = "") -> bool:
        self.total += 1
        if not ok:
            self.fallos += 1
        sufijo = f"  [{detalle}]" if detalle != "" else ""
        print(f"{'PASA ' if ok else 'FALLA'} {nombre}{sufijo}", flush=True)
        return ok


def puerto_libre() -> int:
    with socket.socket() as enchufe:
        enchufe.bind(("127.0.0.1", 0))
        return enchufe.getsockname()[1]


def esperar(condicion: Callable[[], Any], espera_s: float, pausa_s: float = 0.1) -> Any:
    """Repite `condicion` hasta que devuelva algo verdadero o se acabe el tiempo."""
    limite = time.monotonic() + espera_s
    while True:
        valor = condicion()
        if valor or time.monotonic() > limite:
            return valor
        time.sleep(pausa_s)


def preparar_perfil(carpeta: Path, puerto_marionette: int, uuid_extension: str) -> None:
    preferencias = {
        "extensions.webextensions.uuids": json.dumps({ID_COMPLEMENTO: uuid_extension}),
        "marionette.port": puerto_marionette,
        "browser.shell.checkDefaultBrowser": False,
        "browser.startup.page": 0,
        "browser.startup.homepage_override.mstone": "ignore",
        "startup.homepage_welcome_url": "about:blank",
        "startup.homepage_welcome_url.additional": "",
        "browser.aboutwelcome.enabled": False,
        "browser.sessionstore.resume_from_crash": False,
        "browser.tabs.warnOnClose": False,
        "datareporting.policy.dataSubmissionEnabled": False,
        "datareporting.healthreport.uploadEnabled": False,
        "toolkit.telemetry.reportingpolicy.firstRun": False,
        "app.update.auto": False,
        "app.update.disabledForTesting": True,
        "app.normandy.enabled": False,
        "network.captive-portal-service.enabled": False,
        "network.connectivity-service.enabled": False,
        "browser.safebrowsing.malware.enabled": False,
        "browser.safebrowsing.phishing.enabled": False,
        "extensions.update.enabled": False,
        "extensions.getAddons.cache.enabled": False,
        "ui.systemUsesDarkTheme": 0,
    }
    lineas = [f"user_pref({json.dumps(nombre)}, {json.dumps(valor)});" for nombre, valor in preferencias.items()]
    (carpeta / "user.js").write_text("\n".join(lineas) + "\n", encoding="utf-8")


GUION_ESTILOS = """
const estilo = (selector, propiedad) => getComputedStyle(document.querySelector(selector)).getPropertyValue(propiedad);
return {
  fondo: estilo("body", "background-color"),
  cabecera_color: estilo(".cabecera", "color"),
  cabecera_imagen: estilo(".cabecera", "background-image"),
  tarjeta_imagen: estilo(".tarjeta", "background-image"),
  barra_lateral: estilo(".barra-lateral", "display"),
  parrafo: estilo(".nota p", "font-size"),
};
"""


def leer_estilos(navegador: Marionette) -> dict:
    return navegador.ejecutar(GUION_ESTILOS)


def esperar_fondo(navegador: Marionette, color: str, espera_s: float) -> tuple[bool, float]:
    """Espera a que el fondo de `body` sea `color`. Devuelve si lo logró y cuánto tardó."""
    inicio = time.monotonic()
    logrado = esperar(lambda: navegador.ejecutar("return getComputedStyle(document.body).backgroundColor") == color, espera_s)
    return bool(logrado), time.monotonic() - inicio


def probar_unitarias(navegador: Marionette, informe: Informe, base_demo: str) -> None:
    navegador.navegar(f"{base_demo}/pruebas/unitarias.html")
    resultados = esperar(lambda: navegador.ejecutar("return window.resultados || null"), 10)
    if not informe.comprobar("unitarias: la página de pruebas cargó", bool(resultados)):
        return
    for resultado in resultados:
        informe.comprobar(f"unitaria: {resultado['nombre']}", resultado["ok"], resultado["detalle"])


def configurar_panel(navegador: Marionette, informe: Informe, url_panel: str, base_puente: str) -> None:
    """Abre el panel como una pestaña normal, apunta la extensión al puente falso y guarda la sugerencia."""
    navegador.navegar_con_privilegios(url_panel)
    cargado = esperar(lambda: navegador.ejecutar("return location.href === arguments[0] && document.getElementById('estado-pagina') !== null", url_panel), 15)
    if not informe.comprobar("panel: se abre como pestaña", bool(cargado), navegador.ejecutar("return location.href")):
        return
    esperar(lambda: navegador.ejecutar("return document.getElementById('url-puente').value !== ''"), 10)
    navegador.ejecutar(
        "document.getElementById('url-puente').value = arguments[0];"
        "document.getElementById('guardar-url-puente').click();",
        base_puente,
    )
    aviso = esperar(lambda: navegador.ejecutar("return document.getElementById('aviso').textContent"), 10)
    informe.comprobar("panel: guarda la URL del puente", aviso == "URL del puente guardada.", aviso)
    puente = esperar(
        lambda: (texto := navegador.ejecutar("return document.getElementById('estado-puente').textContent")).startswith("Puente: listo") and texto,
        10,
    )
    informe.comprobar("panel: muestra el estado del puente (GET /salud)", bool(puente), puente)
    navegador.ejecutar(
        "document.getElementById('sugerencia').value = arguments[0];"
        "document.getElementById('guardar').click();",
        SUGERENCIA,
    )
    aviso = esperar(lambda: navegador.ejecutar("return document.getElementById('aviso').textContent") == "Guardado.", 10)
    informe.comprobar("panel: guarda la sugerencia", bool(aviso))
    marcado = navegador.ejecutar("return document.getElementById('adaptar-todos').checked")
    informe.comprobar("panel: «Adaptar todos los sitios» queda encendido", marcado is True)


def probar_generacion(navegador: Marionette, informe: Informe, puente: ServidorPuente, base_demo: str) -> None:
    estado = puente.estado
    navegador.navegar(f"{base_demo}/demo/index.html?consulta-secreta=1#fragmento")
    logrado, tardanza = esperar_fondo(navegador, COLOR_FONDO, 20)
    informe.comprobar("primera carga: el fondo de body pasa a ser el de la piel", logrado, f"{tardanza:.1f} s")
    estilos = leer_estilos(navegador)
    informe.comprobar("primera carga: se aplican las demás reglas", estilos["cabecera_color"] == COLOR_CABECERA and estilos["barra_lateral"] == "none" and estilos["parrafo"] == "20px", estilos)
    informe.comprobar("saneador: no se aplicó nada con url()", estilos["cabecera_imagen"] == "none" and estilos["tarjeta_imagen"] == "none", estilos)
    informe.comprobar("saneador: no se pidió ningún recurso externo", estado.rastreos == [], estado.rastreos)
    informe.comprobar("puente: recibió un solo POST /generaciones", len(estado.solicitudes) == 1, len(estado.solicitudes))
    if not estado.solicitudes:
        return

    solicitud = estado.solicitudes[0]
    campos = {"id_solicitud", "sitio", "patron_ruta", "mapa_pagina", "sugerencia", "preferencias", "piel_actual"}
    informe.comprobar("solicitud: trae los campos del contrato", set(solicitud) == campos, sorted(solicitud))
    informe.comprobar("solicitud: sitio, patron_ruta y sugerencia", (solicitud["sitio"], solicitud["patron_ruta"], solicitud["sugerencia"]) == ("127.0.0.1", "/demo/*", SUGERENCIA), (solicitud["sitio"], solicitud["patron_ruta"]))
    informe.comprobar("solicitud: Origin es moz-extension://", str(estado.origenes[0]).startswith("moz-extension://"), estado.origenes[0])
    mapa = solicitud["mapa_pagina"]
    print("----- mapa_pagina enviado -----\n" + mapa + "\n-------------------------------", flush=True)
    primera = mapa.split("\n", 1)[0]
    informe.comprobar("mapa: primera línea con sitio, patron_ruta, ventana y esquema", primera.startswith("sitio: 127.0.0.1 · patron_ruta: /demo/* · ventana: ") and " · esquema: " in primera, primera)
    informe.comprobar("mapa: describe la estructura (ids, clases, hermanos agrupados)", all(trozo in mapa for trozo in ["header#cabecera.cabecera", "aside#barra-lateral.barra-lateral", "article.tarjeta ×6", "p ×"]))
    filtrados = [texto for texto in TEXTOS_PRIVADOS if texto in mapa.lower()]
    informe.comprobar("mapa: sin texto de la página, valores de atributos ni consulta de la URL", filtrados == [], filtrados)
    informe.comprobar("mapa: no pasa de 12 000 caracteres", len(mapa) <= 12_000, len(mapa))

    navegador.enviar("WebDriver:Refresh")
    logrado, tardanza = esperar_fondo(navegador, COLOR_FONDO, 5)
    informe.comprobar("recarga: la piel guardada se aplica", logrado, f"{tardanza:.2f} s")
    time.sleep(1)
    informe.comprobar("recarga: sin un segundo POST /generaciones", len(estado.solicitudes) == 1, len(estado.solicitudes))

    # Cambio de ruta sin recargar (aplicación de una sola página): otro patrón, otra piel.
    navegador.ejecutar("history.pushState({}, '', '/otra/seccion')")
    quitada = esperar(lambda: navegador.ejecutar("return getComputedStyle(document.body).backgroundColor") != COLOR_FONDO, 2, 0.02)
    informe.comprobar("pushState a otro patrón: se quita la piel anterior", bool(quitada))
    logrado, tardanza = esperar_fondo(navegador, COLOR_FONDO, 20)
    informe.comprobar("pushState a otro patrón: se genera y aplica otra piel", logrado and len(estado.solicitudes) == 2 and estado.solicitudes[-1]["patron_ruta"] == "/otra/*", f"{tardanza:.1f} s, {len(estado.solicitudes)} POST")
    navegador.ejecutar("history.pushState({}, '', '/otra/pagina-dos')")
    time.sleep(1.5)
    sigue = navegador.ejecutar("return getComputedStyle(document.body).backgroundColor") == COLOR_FONDO
    informe.comprobar("pushState dentro del mismo patrón: no cambia nada", sigue and len(estado.solicitudes) == 2, len(estado.solicitudes))


GUION_ID_PESTANA = """
const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
return ExtensionParent.apiManager.global.tabTracker.getId(gBrowser.selectedTab);
"""

GUION_ABRIR_PESTANA = """
const principal = Services.scriptSecurityManager.getSystemPrincipal();
gBrowser.addTab(arguments[0], { triggeringPrincipal: principal });
"""

GUION_INSIGNIA = """
const idBoton = arguments[0].toLowerCase().replace(/[^a-z0-9_-]/g, "_") + "-browser-action";
const boton = document.getElementById(idBoton) ?? CustomizableUI.getWidget(idBoton)?.forWindow(window)?.node;
if (!boton) return null;
const conInsignia = boton.hasAttribute("badge") ? boton : boton.querySelector("[badge]");
return conInsignia ? conInsignia.getAttribute("badge") : "";
"""


def probar_panel(navegador: Marionette, informe: Informe, puente: ServidorPuente, url_panel: str) -> None:
    """Maneja el panel, abierto en otra pestaña con `?pestana=<id>`, sobre la pestaña de demostración."""
    estado = puente.estado
    pestana_demo = navegador.enviar("WebDriver:GetWindowHandle")["value"]
    id_demo = navegador.ejecutar_en_navegador(GUION_ID_PESTANA)
    insignia = navegador.ejecutar_en_navegador(GUION_INSIGNIA, ID_COMPLEMENTO)
    informe.comprobar("insignia: ✓ con la piel aplicada", insignia == "✓", repr(insignia))
    navegador.ejecutar_en_navegador(GUION_ABRIR_PESTANA, f"{url_panel}?pestana={id_demo}")
    pestana_panel = esperar(lambda: [p for p in navegador.enviar("WebDriver:GetWindowHandles") if p != pestana_demo], 10)[0]

    def texto(id_elemento: str) -> str:
        return navegador.ejecutar("return document.getElementById(arguments[0])?.textContent ?? ''", id_elemento)

    def pulsar(id_elemento: str) -> None:
        navegador.ejecutar("document.getElementById(arguments[0]).click()", id_elemento)

    def fondo_demo() -> str:
        navegador.cambiar_a(pestana_demo)
        try:
            return navegador.ejecutar("return getComputedStyle(document.body).backgroundColor")
        finally:
            navegador.cambiar_a(pestana_panel)

    navegador.cambiar_a(pestana_panel)
    aplicada = esperar(lambda: texto("estado-pagina") == "Piel aplicada: Piel de prueba", 10)
    informe.comprobar("panel: muestra la piel aplicada, su explicación y cuánto tardó", bool(aplicada) and texto("detalle-pagina").startswith("Puse el fondo") and texto("pie-pagina") == "Tardó 2 s · puente-falso", [texto("estado-pagina"), texto("detalle-pagina"), texto("pie-pagina")])

    pulsar("alternar")
    esperar(lambda: texto("estado-pagina") == "Viendo el original", 5)
    informe.comprobar("Ver original: quita la piel sin recargar", fondo_demo() != COLOR_FONDO and texto("alternar") == "Volver a aplicar", texto("estado-pagina"))
    pulsar("alternar")
    esperar(lambda: texto("estado-pagina").startswith("Piel aplicada"), 5)
    informe.comprobar("Volver a aplicar: la piel vuelve", fondo_demo() == COLOR_FONDO, texto("estado-pagina"))

    anteriores = len(estado.solicitudes)
    pulsar("regenerar")
    generando = esperar(lambda: texto("estado-pagina").startswith("Generando…") and texto("estado-pagina"), 3, 0.05)
    navegador.cambiar_a(pestana_demo)
    insignia = navegador.ejecutar_en_navegador(GUION_INSIGNIA, ID_COMPLEMENTO)
    navegador.cambiar_a(pestana_panel)
    informe.comprobar("Regenerar: el panel muestra «Generando…» y la insignia «…»", bool(generando) and insignia == "…", [generando, insignia])
    esperar(lambda: texto("estado-pagina").startswith("Piel aplicada"), 15)
    informe.comprobar("Regenerar: ignora la caché (otro POST) y vuelve a aplicar", len(estado.solicitudes) == anteriores + 1 and fondo_demo() == COLOR_FONDO, len(estado.solicitudes) - anteriores)

    pulsar("adaptar-sitio")
    esperar(lambda: texto("detalle-pagina") == "Este sitio está apagado.", 5)
    informe.comprobar("Adaptar este sitio (apagar): quita la piel", fondo_demo() != COLOR_FONDO, [texto("estado-pagina"), texto("detalle-pagina")])
    pulsar("adaptar-sitio")
    esperar(lambda: texto("estado-pagina").startswith("Piel aplicada"), 5)
    informe.comprobar("Adaptar este sitio (encender): vuelve la piel guardada, sin otro POST", fondo_demo() == COLOR_FONDO and len(estado.solicitudes) == anteriores + 1, len(estado.solicitudes) - anteriores)

    pulsar("borrar-pieles")
    esperar(lambda: texto("aviso") == "Pieles borradas.", 5)
    informe.comprobar("Borrar pieles guardadas: quita la piel y vacía la caché", fondo_demo() != COLOR_FONDO and texto("borrar-pieles") == "Borrar pieles guardadas (0)", texto("borrar-pieles"))

    # Error del puente: el panel muestra su `mensaje` y la insignia pasa a «!».
    estado.error_siguiente = {"error": "claude_fallo", "mensaje": "Claude no respondió a tiempo."}
    pulsar("regenerar")
    esperar(lambda: texto("estado-pagina") == "Error", 10)
    navegador.cambiar_a(pestana_demo)
    insignia = navegador.ejecutar_en_navegador(GUION_INSIGNIA, ID_COMPLEMENTO)
    navegador.cambiar_a(pestana_panel)
    informe.comprobar("error del puente: el panel muestra el mensaje y la insignia «!»", texto("detalle-pagina") == "Claude no respondió a tiempo." and insignia == "!", [texto("estado-pagina"), texto("detalle-pagina"), insignia])
    # Se cierra el panel: abierto, sus consultas cada segundo mantendrían vivo el script de fondo.
    navegador.enviar("WebDriver:CloseWindow")
    navegador.cambiar_a(pestana_demo)


def probar_generacion_larga(navegador: Marionette, informe: Informe, puente: ServidorPuente, base_demo: str) -> None:
    """Una generación de 45 s: más que los 30 s de inactividad del script de fondo."""
    estado = puente.estado
    anteriores = len(estado.solicitudes)
    estado.demora_s = 45
    navegador.navegar(f"{base_demo}/lenta/pagina")
    logrado, tardanza = esperar_fondo(navegador, COLOR_FONDO, 90)
    estado.demora_s = 2
    informe.comprobar("generación de 45 s: la piel llega y se aplica", logrado, f"{tardanza:.1f} s")
    informe.comprobar("generación de 45 s: un solo POST", len(estado.solicitudes) == anteriores + 1, len(estado.solicitudes) - anteriores)
    print(f"      consultas GET /generaciones/<id> durante la espera: {len(estado.consultas)}", flush=True)


def main() -> int:
    analizador = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    analizador.add_argument("--larga", action="store_true", help="añade una generación de 45 s")
    analizador.add_argument("--visible", action="store_true", help="abre Firefox con ventana (sin -headless)")
    analizador.add_argument("--extension", type=Path, default=RAIZ / "extension", help="carpeta del complemento que se instala")
    opciones = analizador.parse_args()

    informe = Informe()
    perfil = Path(tempfile.mkdtemp(prefix="pieles-e2e-"))
    puente = ServidorPuente(puerto_libre())
    demo = ThreadingHTTPServer(("127.0.0.1", puerto_libre()), partial(ManejadorDemo, directory=str(RAIZ)))
    demo.daemon_threads = True
    for servidor in (puente, demo):
        threading.Thread(target=servidor.serve_forever, daemon=True).start()
    base_puente = f"http://127.0.0.1:{puente.server_address[1]}"
    base_demo = f"http://127.0.0.1:{demo.server_address[1]}"
    puerto_marionette = puerto_libre()
    uuid_extension = str(uuid.uuid4())
    preparar_perfil(perfil, puerto_marionette, uuid_extension)

    orden = [FIREFOX, "-no-remote", "-marionette", "-profile", str(perfil)]
    if not opciones.visible:
        orden.insert(1, "-headless")
    # Abrir `moz-extension://…` por Marionette exige acceso al contexto del navegador.
    entorno = {**os.environ, "MOZ_REMOTE_ALLOW_SYSTEM_ACCESS": "1"}
    firefox = subprocess.Popen(orden, env=entorno, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    navegador = None
    try:
        navegador = Marionette(puerto_marionette)
        sesion = navegador.enviar("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {"pageLoadStrategy": "normal"}}})
        print(f"Firefox {sesion['capabilities'].get('browserVersion')} · demo {base_demo} · puente falso {base_puente}", flush=True)
        probar_unitarias(navegador, informe, base_demo)
        instalado = navegador.enviar("Addon:Install", {"path": str(opciones.extension.resolve()), "temporary": True})
        informe.comprobar("complemento temporal instalado", instalado.get("value") == ID_COMPLEMENTO, instalado.get("value"))
        configurar_panel(navegador, informe, f"moz-extension://{uuid_extension}/panel.html", base_puente)
        probar_generacion(navegador, informe, puente, base_demo)
        probar_panel(navegador, informe, puente, f"moz-extension://{uuid_extension}/panel.html")
        if opciones.larga:
            probar_generacion_larga(navegador, informe, puente, base_demo)
    except Exception as error:  # noqa: BLE001 - se informa y se limpia igual
        informe.comprobar("la prueba terminó sin errores inesperados", False, f"{type(error).__name__}: {error}")
    finally:
        if navegador is not None:
            navegador.cerrar()
        firefox.terminate()
        try:
            firefox.wait(timeout=10)
        except subprocess.TimeoutExpired:
            firefox.kill()
            firefox.wait(timeout=10)
        for servidor in (puente, demo):
            servidor.shutdown()
            servidor.server_close()
        shutil.rmtree(perfil, ignore_errors=True)

    print(f"\n{informe.total - informe.fallos} de {informe.total} comprobaciones pasaron.", flush=True)
    return 1 if informe.fallos else 0


if __name__ == "__main__":
    sys.exit(main())
