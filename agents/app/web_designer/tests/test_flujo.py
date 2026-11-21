"""Una corrida completa con un modelo y un juez guionizados sobre la página local."""

import asyncio
import json
import math

from conftest import CSS_GUION, ClaudeGuion
from disenador import resumen
from disenador.corrida import Caso, Opciones, correr, leer_casos
from disenador.modelo import CONTRATO


def _opciones(**extra) -> Opciones:
    return Opciones(skill=None, modelo="guion", esfuerzo="medium", modelo_juez="guion", esfuerzo_juez="medium",
                    **extra)


def test_corrida_completa(sitio, tmp_path):
    salida = tmp_path / "corrida"
    disenador, juez = ClaudeGuion(), ClaudeGuion()
    caso = Caso("prueba", sitio.as_uri(), "Modo oscuro, letra más grande", "Pagar la cuenta")
    filas = asyncio.run(correr([caso], _opciones(repeticiones=2, concurrencia=2), salida, disenador, juez))

    assert [f["rep"] for f in filas] == [1, 2] and not any("error" in f for f in filas)
    carpeta = salida / "rep-01"
    for archivo in ("antes.png", "despues.png", "antes-movil.png", "despues-movil.png", "mapa.json", "tema.css",
                    "respuesta.json", "metricas.json", "juicio.json"):
        assert (carpeta / archivo).is_file(), archivo

    # El modelo recibió el contrato, los gustos, la tarea, el mapa y la captura.
    llamada = disenador.llamadas[0]
    assert CONTRATO in llamada["sistema"]
    texto, captura = llamada["partes"]
    assert "Modo oscuro" in texto and "Pagar la cuenta" in texto and "--color-marca" in texto
    assert captura.startswith(b"\x89PNG")

    tema = (carpeta / "tema.css").read_text(encoding="utf-8")
    assert "url(" not in tema and "html.mi-tema footer p" in tema
    metricas = json.loads((carpeta / "metricas.json").read_text(encoding="utf-8"))
    assert metricas["css"]["fuera_de_mi_tema"] == [{"selector": "footer p", "corregido": "html.mi-tema footer p"}]
    assert [r["motivo"] for r in metricas["css"]["rechazos"]] == ["url("]
    fila = filas[0]
    assert fila["perdidos"] == 2   # "Ver más", en escritorio y en móvil
    assert fila["contraste_falla_antes"] > 0 and fila["contraste_falla_despues"] == 0
    assert fila["sin_mi_tema_identica"] is True
    assert fila["violaciones"] == 1 and fila["rechazos"] == 1

    # Juez: 3 llamadas por generación (puntajes y dos órdenes del par); el guion siempre elige la segunda.
    assert len(juez.llamadas) == 6
    juicio = json.loads((carpeta / "juicio.json").read_text(encoding="utf-8"))
    assert juicio["promedio"] == 4 and juicio["veredicto"] == "mejor"
    assert juicio["dimensiones"]["estetica"]["confianza"] == "alta"
    assert juicio["par"]["antes_como_A"]["elige"] == "despues" and juicio["par"]["despues_como_A"]["elige"] == "antes"
    assert juicio["par"]["consistente"] is False and juicio["par"]["preferido"] == "inconsistente"

    meta = {"fecha": "2026-11-21_12-00-00", "skill": None, "modelo": "guion", "esfuerzo": "medium",
            "modelo_juez": "guion", "esfuerzo_juez": "medium", "repeticiones": 2, "casos": [vars(caso)]}
    datos = resumen.escribir(salida, filas, meta)
    assert datos["global"]["promedios"]["promedio_juez"] == 4
    assert datos["global"]["promedios"]["par_prefiere_tema"] == 0
    assert datos["global"]["par"]["inconsistente"] == 2
    reporte = (salida / "reporte.md").read_text(encoding="utf-8")
    assert "línea base" in reporte and "[despues.png](rep-01/despues.png)" in reporte

    otro = json.loads(json.dumps(datos))
    otro["skill"] = {"nombre": "disenar-tema", "sha256": "abc", "ruta": "x"}
    otro["global"]["promedios"]["promedio_juez"] = 4.5
    tabla = resumen.comparar(datos, otro)
    assert "| Juez: promedio 1–5 | 4 | 4.5 | +0.5 | mejora |" in tabla


def test_solo_evaluar_y_errores(sitio, tmp_path):
    css = tmp_path / "dado.css"
    css.write_text(CSS_GUION, encoding="utf-8")
    disenador, juez = ClaudeGuion(), ClaudeGuion()
    casos = [Caso("bien", sitio.as_uri(), "oscuro"), Caso("caido", "http://127.0.0.1:9/", "oscuro")]
    filas = asyncio.run(correr(casos, _opciones(css_dado=css), tmp_path / "salida", disenador, juez))
    assert disenador.llamadas == []
    assert "error" not in filas[0] and (tmp_path / "salida" / "bien" / "rep-01" / "tema.css").is_file()
    assert filas[1]["caso"] == "caido" and "no se pudo abrir" in filas[1]["error"]
    respuesta = json.loads((tmp_path / "salida" / "bien" / "rep-01" / "respuesta.json").read_text(encoding="utf-8"))
    assert respuesta["origen"] == str(css)


def test_leer_casos(tmp_path):
    ruta = tmp_path / "casos.json"
    ruta.write_text(json.dumps([{"url": "https://www.ejemplo.cl/x", "gustos": "a"},
                                {"id": "otro", "url": "https://b.cl", "gustos": "b", "tarea": "t"}]), encoding="utf-8")
    casos = leer_casos(ruta)
    assert [c.id for c in casos] == ["www.ejemplo.cl", "otro"] and casos[1].tarea == "t"


def test_juez_reintenta_y_tolera_un_orden_fallido(tmp_path):
    from disenador import juez
    from disenador.juez import ESQUEMA_PAR, ESQUEMA_PUNTAJES
    from disenador.modelo import ErrorDeModelo

    class JuezFragil(ClaudeGuion):
        """Los puntajes fallan una vez (se reintentan); el segundo orden del par falla siempre."""

        def __init__(self):
            super().__init__()
            self.fallos_de_puntaje = 1

        async def pedir(self, sistema, esquema, partes, log):
            if esquema is ESQUEMA_PUNTAJES and self.fallos_de_puntaje:
                self.fallos_de_puntaje -= 1
                raise ErrorDeModelo("error_max_structured_output_retries")
            if esquema is ESQUEMA_PAR and partes[2] == b"despues":
                raise ErrorDeModelo("error_max_structured_output_retries")
            return await super().pedir(sistema, esquema, partes, log)

    capturas = {"antes": b"antes", "despues": b"despues"}
    juicio = asyncio.run(juez.juzgar(JuezFragil(), "https://x.cl", "oscuro", None, capturas, tmp_path / "log"))
    assert juicio["promedio"] == 4
    assert juicio["par"]["antes_como_A"]["elige"] == "despues" and juicio["par"]["despues_como_A"] is None
    assert juicio["par"]["consistente"] is None and juicio["par"]["preferido"] is None
    assert len(juicio["par"]["errores"]) == 1


def test_tema_rechazado_por_el_navegador(sitio, tmp_path, monkeypatch):
    """Si el saneamiento dejara pasar algo que Chromium lee fuera de ámbito, el tema no se aplica y queda anotado."""
    from disenador import corrida
    from disenador.css import Saneado

    monkeypatch.setattr(corrida, "sanear", lambda css: Saneado(css, [], [], []))  # un saneamiento que falla
    css = tmp_path / "dado.css"
    css.write_text("body { color: red }\nhtml.mi-tema a { color: blue }", encoding="utf-8")
    filas = asyncio.run(correr([Caso("rechazo", sitio.as_uri(), "oscuro")], _opciones(css_dado=css),
                               tmp_path / "salida", ClaudeGuion(), ClaudeGuion()))
    fila = filas[0]
    assert "TemaRechazado" in fila["error"] and fila["violaciones_navegador"] == 1
    carpeta = tmp_path / "salida" / "rep-01"
    metricas = json.loads((carpeta / "metricas.json").read_text(encoding="utf-8"))
    assert metricas["violaciones"][0]["motivo"] == "selector fuera de html.mi-tema: body"
    assert not (carpeta / "despues.png").exists()   # no se aplicó
    # El CSS rechazado queda para revisarlo, pero nunca como tema.css (el que se le pasa al evaluador con --css).
    assert not (carpeta / "tema.css").exists() and (carpeta / "tema-rechazado.css").is_file()


def test_modelo_colgado_falla_sin_detener_la_corrida(sitio, tmp_path, monkeypatch):
    """Un `claude` que nunca responde se mata al vencer el plazo; la generación queda con error y la corrida sigue."""
    from disenador import modelo

    procesos = []

    class Entrada:
        def write(self, datos):
            pass

        async def drain(self):
            pass

    class ProcesoColgado:
        def __init__(self):
            self.stdin, self.matado, self.cerrado = Entrada(), False, False
            self.process = self

        def kill(self):
            self.matado = True

        @classmethod
        async def open(cls, *args):
            procesos.append(cls())
            return procesos[-1]

        async def wait_for_result(self, timeout_s=None):
            self.timeout_pedido = timeout_s
            await asyncio.sleep(3600)

        async def close(self):
            self.cerrado = True

    monkeypatch.setattr(modelo, "ClaudeCodeProcess", ProcesoColgado)
    disenador = modelo.ClaudeCode("haiku", "medium", tmp_path, timeout_s=0.2)
    casos = [Caso("colgado", sitio.as_uri(), "oscuro")]
    filas = asyncio.run(correr(casos, _opciones(repeticiones=2, concurrencia=2), tmp_path / "salida", disenador,
                               ClaudeGuion()))
    assert [f["rep"] for f in filas] == [1, 2]
    assert all("ErrorDeModelo" in f["error"] and "no respondió en 0.2 s" in f["error"] for f in filas)
    assert len(procesos) == 2 and all(p.matado and p.cerrado for p in procesos)
    # El único tope es el del diseñador: `wait_for_result` no corta antes con el del evaluador (180 s).
    assert all(p.timeout_pedido == math.inf for p in procesos)
