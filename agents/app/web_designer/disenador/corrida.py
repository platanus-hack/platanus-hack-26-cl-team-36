"""Una corrida: por cada caso, N generaciones independientes; cada una se aplica, se mide y se juzga.

Carpeta de una generación (`rep-NN/`, o `<caso>/rep-NN/` si la corrida tiene varios casos):
antes.png, despues.png, antes-movil.png, despues-movil.png, mapa.json, respuesta.json, tema.css (saneado),
metricas.json, juicio.json, claude_code.log y, si al apagar el tema la página no vuelve a ser la original,
sin-mi-tema.png / sin-mi-tema-movil.png.
"""

import asyncio
import json
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import Browser, async_playwright

from browser import connect_browser
from disenador import config, juez, mapa, metricas, pagina
from disenador.css import analizar, sanear
from disenador.modelo import ESQUEMA_TEMA, ErrorDeModelo, Skill, mensaje_de_diseno, prompt_de_sistema


class TemaRechazado(Exception):
    """El navegador lee el CSS saneado distinto que el saneamiento: no se aplica."""
from recording import screen_change_ratio


@dataclass
class Caso:
    id: str
    url: str
    gustos: str
    tarea: str | None = None


@dataclass
class Opciones:
    skill: Skill | None
    modelo: str
    esfuerzo: str
    modelo_juez: str
    esfuerzo_juez: str
    repeticiones: int = 1
    css_dado: Path | None = None
    concurrencia: int = config.CONCURRENCIA


_ID_SEGURO = re.compile(r"[^A-Za-z0-9_.-]+")


def id_de_url(url: str) -> str:
    return _ID_SEGURO.sub("-", urlparse(url).hostname or "sitio").strip("-") or "sitio"


def leer_casos(ruta: Path) -> list[Caso]:
    """casos.json: una lista de {id, url, gustos, tarea?}. Los ids deben ser únicos y seguros como carpeta."""
    datos = json.loads(ruta.read_text(encoding="utf-8"))
    if not isinstance(datos, list) or not datos:
        raise ValueError("casos.json debe ser una lista no vacía de {id, url, gustos, tarea?}")
    casos = []
    for posicion, item in enumerate(datos, start=1):
        if not isinstance(item, dict) or not item.get("url") or not item.get("gustos"):
            raise ValueError(f"el caso {posicion} no tiene url y gustos")
        identificador = item.get("id") or id_de_url(item["url"])
        if _ID_SEGURO.search(identificador):
            raise ValueError(f"id de caso no válido como carpeta: {identificador!r}")
        casos.append(Caso(identificador, item["url"], item["gustos"], item.get("tarea")))
    repetidos = {c.id for c in casos if [d.id for d in casos].count(c.id) > 1}
    if repetidos:
        raise ValueError(f"ids de caso repetidos: {', '.join(sorted(repetidos))}")
    return casos


def _escribir_json(ruta: Path, datos) -> None:
    ruta.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")


@dataclass
class Preparado:
    mapa: dict
    captura: bytes


async def preparar(browser: Browser, caso: Caso) -> Preparado:
    """Lo que ve el modelo, igual para todas las repeticiones del caso: el mapa y la captura de escritorio."""
    contexto, page = await pagina.abrir(browser, caso.url, "escritorio")
    try:
        return Preparado(await mapa.construir_mapa(page), await pagina.capturar(page))
    finally:
        await contexto.close()


async def evaluar(browser: Browser, url: str, css: str, carpeta: Path) -> tuple[dict, dict, dict]:
    """Aplica el tema en escritorio y móvil: capturas, medidas antes/después y la prueba de apagarlo."""
    medidas, sin_clase, capturas = {}, {}, {}
    for viewport, sufijo in (("escritorio", ""), ("movil", "-movil")):
        contexto, page = await pagina.abrir(browser, url, viewport)
        try:
            antes = await pagina.capturar(page)
            medida_antes = await metricas.medir(page, "antes")
            referencia = await pagina.capturar(page)  # cuánto cambia la página sola, sin tocarla
            # Lo que la página pierde sola (carruseles, re-renders) con la misma espera que tendrá el tema.
            await pagina.esperar(page, config.ESPERA_TEMA_S)
            medida_ruido = await metricas.medir(page, "ruido")
            await pagina.aplicar_tema(page, css)
            despues = await pagina.capturar(page)
            medida_despues = await metricas.medir(page, "despues")
            await pagina.poner_clase(page, False)
            apagada = await pagina.capturar(page)
            # La original en este mismo momento, sin el <style>: los widgets que el sitio carga tarde (chats,
            # encuestas) aparecen también aquí y no cuentan como efecto del tema apagado.
            await pagina.quitar_tema(page)
            original_ahora = await pagina.capturar(page)
        finally:
            await contexto.close()
        diferencia = min(screen_change_ratio(antes, apagada), screen_change_ratio(original_ahora, apagada))
        ruido = screen_change_ratio(antes, referencia)
        identica = diferencia <= ruido + config.UMBRAL_IDENTICA
        sin_clase[viewport] = {"diferencia": round(diferencia, 4), "ruido_base": round(ruido, 4), "identica": identica}
        (carpeta / f"antes{sufijo}.png").write_bytes(antes)
        (carpeta / f"despues{sufijo}.png").write_bytes(despues)
        if not identica:
            (carpeta / f"sin-mi-tema{sufijo}.png").write_bytes(apagada)
        medidas[viewport] = {"antes": medida_antes, "ruido": medida_ruido, "despues": medida_despues}
        capturas[f"antes{sufijo}"], capturas[f"despues{sufijo}"] = antes, despues
    return medidas, sin_clase, capturas


async def _generar(caso: Caso, preparado: Preparado, opciones: Opciones, disenador, log: Path) -> dict:
    if opciones.css_dado:
        return {"css": opciones.css_dado.read_text(encoding="utf-8"), "resumen": "CSS dado con --solo-evaluar.",
                "decisiones": [], "origen": str(opciones.css_dado)}
    texto = mensaje_de_diseno(caso.url, caso.gustos, caso.tarea, mapa.como_texto(preparado.mapa), config.ESCRITORIO)
    respuesta = await disenador.pedir(prompt_de_sistema(opciones.skill), ESQUEMA_TEMA, [texto, preparado.captura], log)
    return {**respuesta.datos, "modelo": opciones.modelo, "esfuerzo": opciones.esfuerzo, "uso": respuesta.uso,
            "costo_usd": respuesta.costo_usd, "segundos": respuesta.segundos}


async def generacion(browser, caso: Caso, preparado: Preparado, rep: int, carpeta: Path, opciones: Opciones,
                     disenador, cliente_juez, raiz: Path) -> dict:
    carpeta.mkdir(parents=True, exist_ok=True)
    fila: dict = {"caso": caso.id, "rep": rep, "carpeta": str(carpeta.relative_to(raiz))}
    log = carpeta / "claude_code.log"
    _escribir_json(carpeta / "mapa.json", preparado.mapa)
    try:
        respuesta = await _generar(caso, preparado, opciones, disenador, log)
        _escribir_json(carpeta / "respuesta.json", respuesta)
        fila["costo_usd"] = respuesta.get("costo_usd", 0.0)
        fila["segundos_modelo"] = respuesta.get("segundos")
        saneado = sanear(respuesta["css"])
        (carpeta / "tema.css").write_text(saneado.css, encoding="utf-8")
        analisis = analizar(saneado)
        # Última palabra del navegador: si su parser ve algo fuera de ámbito o que carga recursos, no se aplica.
        analisis["violaciones_navegador"] = violaciones = await pagina.verificar_css(browser, saneado.css)
        if violaciones:
            fila["violaciones_navegador"] = len(violaciones)
            _escribir_json(carpeta / "metricas.json", {"css": analisis, "violaciones": violaciones,
                                                       "fila": {"violaciones_navegador": len(violaciones)}})
            raise TemaRechazado(f"el navegador lee el CSS saneado distinto que el saneamiento ({len(violaciones)}"
                                f" violación(es); la primera: {violaciones[0]['motivo']})")
        medidas, sin_clase, capturas = await evaluar(browser, caso.url, saneado.css, carpeta)
        resultado = metricas.combinar(medidas, analisis, sin_clase)
        _escribir_json(carpeta / "metricas.json", resultado)
        fila.update(resultado["fila"])
    except Exception as error:  # una generación fallida no detiene las demás
        fila["error"] = f"{type(error).__name__}: {error}"[:300]
        print(f"[{caso.id} rep {rep}] error: {fila['error']}", flush=True)
        return fila
    try:
        juicio = await juez.juzgar(cliente_juez, caso.url, caso.gustos, caso.tarea, capturas, log)
    except (ErrorDeModelo, KeyError) as error:
        fila["error_juez"] = f"{type(error).__name__}: {error}"[:300]
        print(f"[{caso.id} rep {rep}] el juez falló: {fila['error_juez']}", flush=True)
        return fila
    _escribir_json(carpeta / "juicio.json", juicio)
    fila.update({d: juicio["dimensiones"][d]["puntaje"] for d in juez.DIMENSIONES})
    fila.update(
        promedio_juez=juicio["promedio"],
        veredicto=juicio["veredicto"],
        par_preferido=juicio["par"]["preferido"],
        par_consistente=juicio["par"]["consistente"],
        principal_problema=juicio["principal_problema"],
        costo_usd=round(fila.get("costo_usd", 0.0) + juicio["costo_usd"], 4),
    )
    print(f"[{caso.id} rep {rep}] juez {juicio['promedio']} ({juicio['veredicto']}; par: {juicio['par']['preferido']})"
          f" · contraste {fila['contraste_falla_antes']} → {fila['contraste_falla_despues']} · perdidos {fila['perdidos']}"
          f" · violaciones {fila['violaciones']}", flush=True)
    return fila


async def correr(casos: list[Caso], opciones: Opciones, salida: Path, disenador, cliente_juez,
                 cdp_url: str | None = None) -> list[dict]:
    """Corre todas las generaciones y devuelve una fila por generación (ver `metricas.combinar` y el juez)."""
    salida.mkdir(parents=True, exist_ok=True)
    semaforo = asyncio.Semaphore(max(1, opciones.concurrencia))

    async def limitada(*args) -> dict:
        async with semaforo:
            return await generacion(*args)

    async with async_playwright() as playwright:
        browser = await connect_browser(playwright, cdp_url)
        try:
            pendientes, filas = [], []
            for caso in casos:
                carpeta_caso = salida if len(casos) == 1 else salida / caso.id
                try:
                    preparado = await preparar(browser, caso)
                except Exception as error:
                    mensaje = f"no se pudo abrir la página: {type(error).__name__}: {error}"[:300]
                    print(f"[{caso.id}] {mensaje}", flush=True)
                    filas += [{"caso": caso.id, "rep": rep, "error": mensaje} for rep in range(1, opciones.repeticiones + 1)]
                    continue
                print(f"[{caso.id}] mapa listo: {len(mapa.como_texto(preparado.mapa))} caracteres", flush=True)
                for rep in range(1, opciones.repeticiones + 1):
                    pendientes.append(limitada(browser, caso, preparado, rep, carpeta_caso / f"rep-{rep:02d}", opciones,
                                               disenador, cliente_juez, salida))
            filas += await asyncio.gather(*pendientes)
        finally:
            await browser.close()
    return sorted(filas, key=lambda fila: ([c.id for c in casos].index(fila["caso"]), fila["rep"]))
