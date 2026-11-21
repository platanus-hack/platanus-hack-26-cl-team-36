"""Arranca el prototipo con un solo comando y lo deja corriendo.

Uso: python3 prototipo/lanzar.py [--sugerencia "texto"]
     python3 prototipo/lanzar.py --estado
     python3 prototipo/lanzar.py --detener

Levanta, separados de esta terminal (siguen vivos al cerrarla):

1. el puente en 127.0.0.1:8765 (si ya responde uno ahí, se usa ese y no se toca);
2. la página de demostración en 127.0.0.1:8000 (u otro puerto libre si el 8000 está ocupado);
3. un Firefox aparte, con ventana y perfil propio, con `extension/` instalada como complemento
   temporal y la página de demostración abierta. No toca tu Firefox ni tu perfil.

Todo lo que genera (perfil, registros y `pids.json`) queda en `prototipo/.ejecucion/`.
Solo usa la biblioteca estándar y reutiliza el cliente de Marionette de `pruebas/e2e.py`.
"""

import argparse
import json
import os
import signal
import socket
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

RAIZ = Path(__file__).resolve().parent
sys.path.insert(0, str(RAIZ / "pruebas"))

from e2e import FIREFOX, ID_COMPLEMENTO, Marionette, esperar, preparar_perfil, puerto_libre  # noqa: E402

EXTENSION = RAIZ / "extension"
EJECUCION = RAIZ / ".ejecucion"
PERFIL = EJECUCION / "perfil"
REGISTROS = EJECUCION / "registros"
ARCHIVO_PIDS = EJECUCION / "pids.json"
ANFITRION = "127.0.0.1"
PUERTO_PUENTE = 8765
PUERTO_DEMO = 8000
URL_PUENTE = f"http://{ANFITRION}:{PUERTO_PUENTE}"
# El UUID fija el origen `moz-extension://…` del complemento: si cambiara entre arranques, el
# complemento no encontraría lo que guardó en `storage.local` (sugerencia y pieles).
UUID_EXTENSION = str(uuid.uuid5(uuid.NAMESPACE_DNS, ID_COMPLEMENTO))
URL_PANEL = f"moz-extension://{UUID_EXTENSION}/panel.html"
COMPONENTES = ("puente", "demo", "firefox")
# Texto que debe aparecer en la línea de órdenes de cada proceso para reconocerlo como nuestro.
MARCAS = {
    "puente": str(RAIZ / "puente" / "puente.py"),
    "demo": f"--directory {RAIZ / 'demo'}",
    "firefox": str(PERFIL),
}
ERRORES_MARIONETTE = (OSError, RuntimeError, TimeoutError)

GUION_COMPLEMENTO = """
const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
const idBoton = arguments[0].toLowerCase().replace(/[^a-z0-9_-]/g, "_") + "-browser-action";
return AddonManager.getAddonByID(arguments[0]).then((complemento) => complemento && {
  version: complemento.version,
  activo: complemento.isActive,
  temporal: complemento.temporarilyInstalled,
  zona_boton: CustomizableUI.getPlacementOfWidget(idBoton)?.area ?? null,
});
"""

Estado = dict[str, Any]


# --------------------------------------------------------------------------------------------------
# Estado guardado y procesos
# --------------------------------------------------------------------------------------------------


def leer_estado() -> Estado:
    try:
        return json.loads(ARCHIVO_PIDS.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def guardar_estado(estado: Estado) -> None:
    ARCHIVO_PIDS.write_text(json.dumps(estado, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def orden_de(pid: int) -> str:
    """Línea de órdenes del proceso `pid`, o vacío si ya no existe."""
    resultado = subprocess.run(["ps", "-ww", "-o", "command=", "-p", str(pid)], capture_output=True, text=True, check=False)
    return resultado.stdout.strip()


def pid_de(estado: Estado, nombre: str) -> int | None:
    pid = estado.get(nombre, {}).get("pid")
    return pid if isinstance(pid, int) else None


def es_nuestro(estado: Estado, nombre: str) -> bool:
    """El PID guardado sigue vivo y sigue siendo el proceso que arrancamos (no un PID reutilizado)."""
    pid = pid_de(estado, nombre)
    return pid is not None and MARCAS[nombre] in orden_de(pid)


def corre(estado: Estado, nombre: str) -> bool:
    if nombre == "puente" and estado.get("puente", {}).get("ajeno"):
        return salud_del_puente() is not None
    return es_nuestro(estado, nombre)


def iniciar(orden: list[str], nombre: str, entorno: dict[str, str] | None = None) -> int:
    """Arranca un proceso en su propia sesión, con la salida en `registros/<nombre>.log`."""
    with (REGISTROS / f"{nombre}.log").open("ab") as registro:
        proceso = subprocess.Popen(
            orden,
            stdin=subprocess.DEVNULL,
            stdout=registro,
            stderr=subprocess.STDOUT,
            env=entorno,
            cwd=RAIZ,
            start_new_session=True,
        )
    return proceso.pid


def terminar(estado: Estado, nombre: str, espera_s: float = 10) -> bool:
    """Pide al proceso que termine (SIGTERM) y, si no lo hace a tiempo, lo mata (SIGKILL)."""
    pid = pid_de(estado, nombre)
    for senal in (signal.SIGTERM, signal.SIGKILL):
        if pid is None or not es_nuestro(estado, nombre):
            return True
        try:
            # Cada proceso se arrancó como líder de su grupo: la señal llega también a sus hijos.
            if os.getpgid(pid) == pid:
                os.killpg(pid, senal)
            else:
                os.kill(pid, senal)
        except ProcessLookupError:
            return True
        if esperar(lambda: not es_nuestro(estado, nombre), espera_s):
            return True
    return False


# --------------------------------------------------------------------------------------------------
# Puente y página de demostración
# --------------------------------------------------------------------------------------------------


def pedir(url: str, espera_s: float = 2) -> bytes | None:
    """GET sin pasar por ningún proxy; `None` si no hay respuesta correcta."""
    abridor = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with abridor.open(url, timeout=espera_s) as respuesta:
            return respuesta.read()
    except (urllib.error.URLError, OSError):
        return None


def salud_del_puente() -> dict | None:
    cuerpo = pedir(f"{URL_PUENTE}/salud")
    try:
        salud = json.loads(cuerpo) if cuerpo else None
    except json.JSONDecodeError:
        return None
    return salud if isinstance(salud, dict) and salud.get("ok") is True else None


def puerto_disponible(puerto: int) -> bool:
    with socket.socket() as enchufe:
        # Como los servidores que se arrancan: un puerto recién soltado (TIME_WAIT) cuenta como libre.
        enchufe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            enchufe.bind((ANFITRION, puerto))
        except OSError:
            return False
    return True


def arrancar_puente(estado: Estado) -> None:
    if salud_del_puente() is not None:
        print(f"Puente: ya había uno respondiendo en {URL_PUENTE}; se usa ese y no se toca.")
        estado["puente"] = {"pid": None, "puerto": PUERTO_PUENTE, "ajeno": True}
        guardar_estado(estado)
        return
    if not puerto_disponible(PUERTO_PUENTE):
        raise RuntimeError(f"El puerto {PUERTO_PUENTE} está ocupado por algo que no es el puente.")
    entorno = {**os.environ, "PUENTE_PUERTO": str(PUERTO_PUENTE)}
    pid = iniciar([sys.executable, str(RAIZ / "puente" / "puente.py")], "puente", entorno)
    estado["puente"] = {"pid": pid, "puerto": PUERTO_PUENTE}
    guardar_estado(estado)
    if not esperar(salud_del_puente, 15, 0.2):
        raise RuntimeError(f"El puente no respondió en {URL_PUENTE}/salud. Mira {REGISTROS / 'puente.log'}.")


def arrancar_demo(estado: Estado) -> None:
    puerto = PUERTO_DEMO if puerto_disponible(PUERTO_DEMO) else puerto_libre()
    url = f"http://{ANFITRION}:{puerto}/"
    orden = [sys.executable, "-m", "http.server", str(puerto), "--bind", ANFITRION, "--directory", str(RAIZ / "demo")]
    estado["demo"] = {"pid": iniciar(orden, "demo"), "puerto": puerto}
    estado["url_demo"] = url
    guardar_estado(estado)
    if not esperar(lambda: pedir(url) is not None, 10, 0.2):
        raise RuntimeError(f"La página de demostración no respondió en {url}. Mira {REGISTROS / 'demo.log'}.")


# --------------------------------------------------------------------------------------------------
# Firefox
# --------------------------------------------------------------------------------------------------


def abrir_sesion(puerto_marionette: int, espera_s: float) -> Marionette:
    navegador = Marionette(puerto_marionette, espera_s)
    try:
        navegador.enviar("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {"pageLoadStrategy": "normal"}}})
    except BaseException:
        navegador.cerrar()
        raise
    return navegador


def cerrar_sesion(navegador: Marionette) -> None:
    """Suelta Firefox sin cerrarlo: el complemento y las pestañas quedan como están."""
    try:
        navegador.enviar("WebDriver:DeleteSession")
    except ERRORES_MARIONETTE:
        pass
    navegador.cerrar()


def sugerencia_en_panel(navegador: Marionette, nueva: str | None) -> str:
    """Abre el panel en la pestaña actual, guarda `nueva` si viene, y devuelve la sugerencia que queda."""
    navegador.navegar_con_privilegios(URL_PANEL)
    cargado = esperar(
        lambda: navegador.ejecutar("return location.href === arguments[0] && document.getElementById('url-puente')?.value !== ''", URL_PANEL),
        15,
    )
    if not cargado:
        raise RuntimeError("El panel del complemento no cargó.")
    if nueva is not None:
        navegador.ejecutar("document.getElementById('sugerencia').value = arguments[0]; document.getElementById('guardar').click();", nueva)
        if not esperar(lambda: navegador.ejecutar("return document.getElementById('aviso').textContent") == "Guardado.", 10):
            raise RuntimeError("El panel no confirmó que guardó la sugerencia.")
    return navegador.ejecutar("return document.getElementById('sugerencia').value")


def arrancar_firefox(estado: Estado, sugerencia: str | None) -> None:
    if not Path(FIREFOX).exists():
        raise RuntimeError(f"No se encontró Firefox en {FIREFOX}.")
    puerto_marionette = puerto_libre()
    PERFIL.mkdir(parents=True, exist_ok=True)
    preparar_perfil(PERFIL, puerto_marionette, UUID_EXTENSION)
    # Abrir `moz-extension://…` y consultar la barra por Marionette exige acceso al contexto del navegador.
    entorno = {**os.environ, "MOZ_REMOTE_ALLOW_SYSTEM_ACCESS": "1"}
    pid = iniciar([FIREFOX, "-no-remote", "-marionette", "-profile", str(PERFIL)], "firefox", entorno)
    estado["firefox"] = {"pid": pid, "puerto_marionette": puerto_marionette}
    estado["perfil"] = str(PERFIL)
    guardar_estado(estado)

    navegador = abrir_sesion(puerto_marionette, 60)
    try:
        instalado = navegador.enviar("Addon:Install", {"path": str(EXTENSION), "temporary": True}).get("value")
        if instalado != ID_COMPLEMENTO:
            raise RuntimeError(f"Firefox instaló un complemento inesperado: {instalado!r}.")
        guardada = sugerencia_en_panel(navegador, sugerencia)
        navegador.navegar(estado["url_demo"])
        complemento = navegador.ejecutar_en_navegador(GUION_COMPLEMENTO, ID_COMPLEMENTO)
    finally:
        cerrar_sesion(navegador)
    print(f"Complemento: {describir_complemento(complemento)}")
    if guardada:
        print(f"Sugerencia guardada: «{guardada}»")
    else:
        print("Sin sugerencia todavía: pulsa el botón del complemento en la barra, escríbela y pulsa «Guardar y aplicar».")


def consultar_complemento(estado: Estado) -> dict | None:
    """Pregunta al Firefox que arrancamos si el complemento sigue instalado y dónde está su botón."""
    navegador = abrir_sesion(estado["firefox"]["puerto_marionette"], 3)
    try:
        return navegador.ejecutar_en_navegador(GUION_COMPLEMENTO, ID_COMPLEMENTO)
    finally:
        cerrar_sesion(navegador)


def describir_complemento(complemento: dict | None) -> str:
    if not complemento:
        return "NO está instalado"
    zona = complemento["zona_boton"]
    boton = "botón en la barra de herramientas" if zona == "nav-bar" else f"botón fuera de la barra (zona: {zona})"
    return f"instalado, versión {complemento['version']}, {'activo' if complemento['activo'] else 'INACTIVO'}, {boton}"


def cerrar_firefox(estado: Estado) -> bool:
    """Cierra el Firefox que arrancamos: primero con una salida limpia por Marionette; si no, con señales."""
    if not es_nuestro(estado, "firefox"):
        return True
    try:
        navegador = abrir_sesion(estado["firefox"]["puerto_marionette"], 3)
        try:
            navegador.enviar("Marionette:Quit", {"flags": ["eForceQuit"]})
        finally:
            navegador.cerrar()
    except ERRORES_MARIONETTE:
        pass
    if esperar(lambda: not es_nuestro(estado, "firefox"), 15):
        return True
    return terminar(estado, "firefox")


# --------------------------------------------------------------------------------------------------
# Órdenes
# --------------------------------------------------------------------------------------------------


def imprimir_estado(estado: Estado) -> bool:
    """Imprime qué está corriendo. Devuelve si los tres componentes lo están."""
    if not estado:
        print("El prototipo no está corriendo (no hay pids.json).")
        return False
    vivos = {nombre: corre(estado, nombre) for nombre in COMPONENTES}

    def linea(nombre: str, detalle: str) -> None:
        pid = pid_de(estado, nombre)
        marca = "corriendo" if vivos[nombre] else "DETENIDO"
        print(f"{nombre:<8} {marca:<10} PID {pid if pid is not None else '(ajeno)':<8} {detalle}")

    salud = salud_del_puente() if vivos["puente"] else None
    claude = json.dumps(salud.get("claude"), ensure_ascii=False) if salud else "sin respuesta"
    linea("puente", f"{URL_PUENTE}/salud · modelo {salud.get('modelo') if salud else '?'} · claude: {claude}")
    linea("demo", estado.get("url_demo", ""))
    detalle_firefox = f"Marionette en el puerto {estado.get('firefox', {}).get('puerto_marionette')}"
    if vivos["firefox"]:
        try:
            detalle_firefox += f" · complemento: {describir_complemento(consultar_complemento(estado))}"
        except ERRORES_MARIONETTE as error:
            detalle_firefox += f" · no se pudo consultar el complemento ({error})"
    linea("firefox", detalle_firefox)
    print(f"Perfil:    {estado.get('perfil', PERFIL)}")
    print(f"Registros: {REGISTROS}")
    return all(vivos.values())


def arrancar(sugerencia: str | None) -> int:
    REGISTROS.mkdir(parents=True, exist_ok=True)
    estado = leer_estado()
    vivos = {nombre: corre(estado, nombre) for nombre in COMPONENTES}
    if all(vivos.values()):
        print("El prototipo ya está corriendo; no se arranca nada.")
        if sugerencia is not None:
            print("La sugerencia no se cambió: escríbela en el panel del complemento, o detén y vuelve a lanzar.")
        imprimir_estado(estado)
        return 0
    try:
        if not vivos["puente"]:
            arrancar_puente(estado)
        if not vivos["demo"]:
            arrancar_demo(estado)
        if not vivos["firefox"]:
            arrancar_firefox(estado, sugerencia)
        elif sugerencia is not None:
            print("Firefox ya estaba abierto: la sugerencia no se cambió; escríbela en el panel del complemento.")
    except (*ERRORES_MARIONETTE, KeyError) as error:
        print(f"No se pudo arrancar el prototipo: {error}", file=sys.stderr)
        print("Lo que alcanzó a arrancar sigue anotado: revísalo con --estado o deténlo con --detener.", file=sys.stderr)
        return 1
    print()
    imprimir_estado(estado)
    print(f"\nListo. Página de demostración: {estado['url_demo']}  ·  Para detenerlo: python3 {sys.argv[0]} --detener")
    return 0


def detener() -> int:
    estado = leer_estado()
    if not estado:
        print("No hay nada que detener (no hay pids.json).")
        return 0
    pendientes = []
    if "firefox" in estado and not cerrar_firefox(estado):
        pendientes.append("firefox")
    for nombre in ("demo", "puente"):
        if estado.get(nombre, {}).get("ajeno"):
            print(f"{nombre}: no lo arrancó este lanzador; se deja corriendo.")
        elif not terminar(estado, nombre):
            pendientes.append(nombre)
    if pendientes:
        print(f"No se pudo detener: {', '.join(pendientes)}. Se conserva {ARCHIVO_PIDS}.", file=sys.stderr)
        return 1
    ARCHIVO_PIDS.unlink(missing_ok=True)
    print("Prototipo detenido.")
    return 0


def principal() -> int:
    analizador = argparse.ArgumentParser(
        description="Arranca el prototipo (puente, página de demostración y un Firefox aparte con el complemento) y lo deja corriendo.",
    )
    analizador.add_argument("--sugerencia", metavar="TEXTO", help="deja escrita la sugerencia en el complemento (si no, se escribe en su panel)")
    modo = analizador.add_mutually_exclusive_group()
    modo.add_argument("--estado", action="store_true", help="muestra qué está corriendo y no arranca nada")
    modo.add_argument("--detener", action="store_true", help="detiene lo que arrancó este lanzador")
    opciones = analizador.parse_args()

    if opciones.detener:
        return detener()
    if opciones.estado:
        return 0 if imprimir_estado(leer_estado()) else 1
    return arrancar(opciones.sugerencia)


if __name__ == "__main__":
    sys.exit(principal())
