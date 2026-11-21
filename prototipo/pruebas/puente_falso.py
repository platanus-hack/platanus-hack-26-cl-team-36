"""Puente falso para las pruebas: cumple el contrato HTTP del puente local sin llamar a Claude.

Uso: python3 puente_falso.py <puerto> [demora_en_segundos]

Responde cada generación tras una demora con un CSS fijo y reconocible, que incluye lo que el
saneador de la extensión debe quitar (un `@import` y declaraciones con `url(...)`). Las `url(...)`
apuntan a este mismo servidor (`/rastreo/...`): si alguna se llegara a cargar, queda contada.
"""

from __future__ import annotations

import json
import sys
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

COLOR_FONDO = "rgb(1, 2, 3)"
COLOR_CABECERA = "rgb(4, 5, 6)"
MODELO = "puente-falso"


def css_de_prueba(base: str) -> str:
    """CSS fijo: 9 reglas, de las que el saneador debe eliminar 2 (22 %, bajo el límite del 30 %)."""
    return "\n".join(
        [
            f'@import url("{base}/rastreo/importado.css");',
            f"body {{ background: {COLOR_FONDO}; color: rgb(250, 250, 250); }}",
            f'.cabecera {{ color: {COLOR_CABECERA}; background-image: url("{base}/rastreo/cabecera.png"); }}',
            f'.tarjeta {{ background-image: url("{base}/rastreo/tarjeta.png"); }}',
            ".barra-lateral { display: none; }",
            ".nota p { font-size: 20px; }",
            ".pie { border-top: 3px solid rgb(7, 8, 9); }",
            ".menu a { text-decoration: underline; }",
            "h1 { letter-spacing: 1px; }",
        ]
    )


@dataclass
class EstadoPuente:
    """Lo que el puente falso recuerda, para que las pruebas lo consulten."""

    demora_s: float = 2.0
    solicitudes: list[dict] = field(default_factory=list)
    origenes: list[str | None] = field(default_factory=list)
    consultas: list[str] = field(default_factory=list)
    rastreos: list[str] = field(default_factory=list)
    resultados: dict[str, dict | None] = field(default_factory=dict)
    error_siguiente: dict | None = None  # Si se pone, el próximo POST responde 502 con este cuerpo.
    candado: threading.Lock = field(default_factory=threading.Lock)


class ManejadorPuente(BaseHTTPRequestHandler):
    """Atiende `/salud`, `/generaciones` y `/generaciones/<id_solicitud>`."""

    server: "ServidorPuente"
    protocol_version = "HTTP/1.1"

    def log_message(self, formato: str, *argumentos: object) -> None:  # noqa: D102
        return

    def _responder(self, codigo: int, cuerpo: dict) -> None:
        datos = json.dumps(cuerpo, ensure_ascii=False).encode()
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def _origen_rechazado(self) -> bool:
        origen = self.headers.get("Origin")
        if origen is not None and origen.startswith(("http://", "https://")):
            self._responder(403, {"error": "origen_no_permitido", "mensaje": "Origen no permitido."})
            return True
        return False

    def do_GET(self) -> None:  # noqa: N802
        estado = self.server.estado
        if self.path.startswith("/rastreo/"):
            estado.rastreos.append(self.path)
            self._responder(404, {"error": "rastreo", "mensaje": "Esto no se debería haber pedido."})
            return
        if self._origen_rechazado():
            return
        if self.path == "/salud":
            self._responder(200, {"ok": True, "version": "0.1", "modelo": MODELO, "claude": "listo"})
            return
        if self.path.startswith("/generaciones/"):
            id_solicitud = self.path.removeprefix("/generaciones/")
            estado.consultas.append(id_solicitud)
            with estado.candado:
                conocido = id_solicitud in estado.resultados
                resultado = estado.resultados.get(id_solicitud)
            if not conocido:
                self._responder(404, {"error": "desconocida", "mensaje": "No existe esa generación."})
            elif resultado is None:
                self._responder(202, {"estado": "en_curso"})
            else:
                self._responder(200, resultado)
            return
        self._responder(404, {"error": "no_encontrado", "mensaje": "Ruta desconocida."})

    def do_POST(self) -> None:  # noqa: N802
        estado = self.server.estado
        if self._origen_rechazado():
            return
        if self.path != "/generaciones":
            self._responder(404, {"error": "no_encontrado", "mensaje": "Ruta desconocida."})
            return
        largo = int(self.headers.get("Content-Length", "0"))
        try:
            solicitud = json.loads(self.rfile.read(largo))
            id_solicitud = solicitud["id_solicitud"]
        except (ValueError, KeyError, TypeError):
            self._responder(400, {"error": "solicitud_invalida", "mensaje": "La solicitud no es válida."})
            return
        inicio = time.monotonic()
        with estado.candado:
            estado.solicitudes.append(solicitud)
            estado.origenes.append(self.headers.get("Origin"))
            fallo, estado.error_siguiente = estado.error_siguiente, None
        if fallo is not None:
            self._responder(502, fallo)
            return
        with estado.candado:
            estado.resultados[id_solicitud] = None
        time.sleep(estado.demora_s)
        puerto = self.server.server_address[1]
        resultado = {
            "id_solicitud": id_solicitud,
            "nombre": "Piel de prueba",
            "descripcion": "Fondo casi negro, fijo y reconocible.",
            "css": css_de_prueba(f"http://127.0.0.1:{puerto}"),
            "explicacion": "Puse el fondo de prueba para comprobar que la piel se aplica.",
            "preferencias_detectadas": [{"texto": "Prefiere modo oscuro", "alcance": "global"}],
            "duracion_ms": round((time.monotonic() - inicio) * 1000),
            "modelo": MODELO,
        }
        with estado.candado:
            estado.resultados[id_solicitud] = resultado
        try:
            self._responder(200, resultado)
        except OSError:
            pass  # El cliente cortó la conexión: el resultado queda disponible por GET.


class ServidorPuente(ThreadingHTTPServer):
    """Servidor HTTP del puente falso, con su estado a la vista."""

    daemon_threads = True

    def __init__(self, puerto: int, demora_s: float = 2.0) -> None:
        super().__init__(("127.0.0.1", puerto), ManejadorPuente)
        self.estado = EstadoPuente(demora_s=demora_s)

    def handle_error(self, request: object, client_address: object) -> None:  # noqa: D102
        # Que el cliente corte la conexión es parte de lo que se prueba: no es un error del puente.
        if not isinstance(sys.exception(), ConnectionError):
            super().handle_error(request, client_address)


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Uso: python3 puente_falso.py <puerto> [demora_en_segundos]")
    demora = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
    servidor = ServidorPuente(int(sys.argv[1]), demora)
    print(f"Puente falso en http://127.0.0.1:{servidor.server_address[1]} (demora {demora} s)")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        servidor.server_close()


if __name__ == "__main__":
    main()
