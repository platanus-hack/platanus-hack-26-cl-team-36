"""Etapa de mejora de una revisión: resume lo que midieron la Guía y el Visitante y genera un tema, una vez.

Lee del almacén las corridas de la misma `revision` (nunca "la última"): el catálogo (`goals.json`), la ruta de
escritorio de cada objetivo (`route.json`) y la tanda del Visitante (`comparison.json` y `<perfil>/run.json`). Escribe
`<host>/improver/<run>/` con `tema.css` (saneado) y `mejora.json` (el resumen usado y lo que decidió el modelo).
"""

import json
from pathlib import Path

from shared import store
from shared.browser.session import open_browser
from shared.catalog.files import read_catalog
from shared.nodes.urls import node_key

from disenador import config, mapa, pagina
from disenador.corrida import Caso, TemaRechazado, preparar
from disenador.css import sanear
from disenador.modelo import ESQUEMA_TEMA, Skill, mensaje_de_diseno, prompt_de_sistema


class TemaVacio(Exception):
    """El CSS quedó vacío tras sanearlo."""


def _leer(backend: store.Backend, clave: str):
    """El JSON de `clave`, o None si no está o no se puede leer: las etapas pueden haber fallado a medias."""
    try:
        return backend.read_json(clave) if backend.exists(clave) else None
    except (OSError, ValueError):
        return None


def _corto(texto, limite: int = config.MAX_TEXTO) -> str:
    texto = " ".join(str(texto or "").split())
    return texto if len(texto) <= limite else texto[:limite - 1] + "…"


def _lugar(url: str | None, titulo: str | None) -> str | None:
    return _corto(f"«{titulo or ''}» {url or ''}".strip()) if url or titulo else None


def _ruta(route: dict | None) -> dict | None:
    if not isinstance(route, dict):
        return None
    pasos = [f"{_corto(p.get('label'), 80)} → {_lugar(p.get('url_after'), p.get('title_after'))}"
             for p in route.get("steps") or [] if isinstance(p, dict)]
    return {"estado": route.get("status"), "pasos_minimos": (route.get("totals") or {}).get("min_steps"),
            "pasos": pasos[:config.MAX_PASOS_RUTA]}


def _desvio(intento: dict, nodos_ruta: list[str]) -> str | None:
    """La primera página del intento que no está en la ruta, con la acción que llevó a ella."""
    if not nodos_ruta:
        return None
    for paso in intento.get("steps") or []:
        try:
            nodo = node_key(paso["url"], paso.get("title") or "")
        except (KeyError, TypeError, ValueError):
            continue
        if nodo not in nodos_ruta:
            return _corto(f"{paso.get('description') or paso.get('action') or ''} → "
                          f"{_lugar(paso.get('url'), paso.get('title'))}")
    return None


def _visita(intento: dict, fila: dict, nodos_ruta: list[str]) -> dict:
    veredicto = intento.get("verdict") or {}
    resultado = veredicto.get("outcome")
    # El Visitante nuevo mide el éxito como "llegó a la página final de la ruta"; el anterior, con el veredicto.
    llego = fila.get("reached_final_node")
    if llego is None and resultado and resultado != "interrupted":
        llego = resultado == "success"
    pasos = intento.get("steps") or []
    ultimo = pasos[-1] if pasos else intento.get("start") or {}
    return {
        "perfil": intento.get("profile") or fila.get("profile"),
        "llego": llego,
        "resultado": resultado,
        "pasos": len(pasos),
        "fin": intento.get("end_reason") or None,
        "se_detuvo_en": _lugar(ultimo.get("url"), ultimo.get("title")),
        "se_desvio_en": None if llego else _desvio(intento, nodos_ruta),
        "por_que": _corto(veredicto.get("justification") or intento.get("final_message")) or None,
    }


def _visitas(backend: store.Backend, tanda: store.RunKey, nodos_ruta: list[str]) -> list[dict]:
    comparacion = _leer(backend, tanda.file("comparison.json")) or {}
    filas = {f.get("profile"): f for f in comparacion.get("runs") or [] if isinstance(f, dict)}
    visitas = []
    try:
        perfiles = backend.list_profiles(tanda)
    except (OSError, ValueError):
        perfiles = []
    for perfil in perfiles:
        try:
            intento = _leer(backend, tanda.file("run.json", perfil))
        except ValueError:  # una carpeta que no es de perfil
            continue
        if isinstance(intento, dict):
            visitas.append(_visita(intento, filas.get(intento.get("profile") or perfil, {}), nodos_ruta))
    return visitas[:config.MAX_VISITAS]


def _objetivo(backend: store.Backend, url: str, revision: str, goal) -> tuple[dict, list[store.RunKey]]:
    entradas = []
    route = None
    corrida_guia = store.revision_run(backend, store.guide(url, goal.id, "desktop"), revision)
    if corrida_guia:
        entradas.append(corrida_guia)
        route = _leer(backend, corrida_guia.file("route.json"))
    tanda = store.revision_run(backend, store.visitor(url, goal.id), revision)
    nodos_ruta = route.get("nodes") or [] if isinstance(route, dict) else []
    visitas = _visitas(backend, tanda, nodos_ruta) if tanda else []
    if tanda:
        entradas.append(tanda)
    medidas = [v["llego"] for v in visitas if v["llego"] is not None]
    return {
        "id": goal.id,
        "descripcion": _corto(goal.description),
        "ruta": _ruta(route),
        "visitas": visitas,
        "tasa_llegada": round(sum(medidas) / len(medidas), 2) if medidas else None,
    }, entradas


def resumir(backend: store.Backend, url: str, revision: str) -> tuple[dict, list[store.RunKey]]:
    """El resumen compacto de lo medido en la revisión y las corridas que leyó."""
    corrida = store.revision_run(backend, store.cataloger(url), revision)
    goals = []
    if corrida:
        try:
            _, catalogo, _ = read_catalog(backend, corrida)
            goals = [g for g in catalogo if g.exclusion is None]
        except (OSError, ValueError, KeyError, TypeError):
            goals = []
    objetivos, entradas = [], [corrida] if corrida else []
    for goal in goals:
        objetivo, leidas = _objetivo(backend, url, revision, goal)
        objetivos.append((objetivo, bool(leidas)))
        entradas += leidas
    # El conductor corre solo algunos objetivos: los demás no aportan nada al modelo.
    medidos = [o for o, con_corridas in objetivos if con_corridas]
    return {"revision": revision, "url": url,
            "objetivos": medidos or [o for o, _ in objetivos][:config.MAX_GOALS_SIN_CORRIDAS]}, entradas


def peor_objetivo(resumen: dict) -> dict | None:
    """El de menor tasa de llegada; sin visitas medidas, uno sin ruta antes que uno con ruta."""
    def gravedad(objetivo: dict) -> tuple:
        tasa = objetivo["tasa_llegada"]
        if tasa is not None:
            return (0, tasa)
        return (1, 0 if objetivo["ruta"] is None or objetivo["ruta"]["estado"] != "verified" else 1)

    return min(resumen["objetivos"], key=gravedad, default=None)


def _escribir_json(ruta: Path, datos) -> None:
    ruta.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")


async def mejorar(backend: store.Backend, url: str, revision: str, skill: Skill | None, disenador, modelo: str,
                  cdp_url: str | None = None) -> store.Manifest:
    """Una corrida de improver: `succeeded` con un `tema.css` no vacío; si no, `failed` y lanza."""
    resumen, entradas = resumir(backend, url, revision)
    peor = peor_objetivo(resumen)
    with store.running(backend, store.improver(url), model=modelo, inputs=entradas, revision=revision) as run:
        salida = {"resumen": resumen, "tarea": peor and {"id": peor["id"], "descripcion": peor["descripcion"]},
                  "gustos": config.GUSTOS_MEJORA}
        try:
            async with open_browser(cdp_url) as browser:
                preparado = await preparar(browser, Caso("mejora", url, config.GUSTOS_MEJORA))
                texto = mensaje_de_diseno(url, config.GUSTOS_MEJORA, peor and peor["descripcion"],
                                          mapa.como_texto(preparado.mapa), config.ESCRITORIO,
                                          json.dumps(resumen["objetivos"], ensure_ascii=False))
                respuesta = await disenador.pedir(prompt_de_sistema(skill), ESQUEMA_TEMA, [texto, preparado.captura],
                                                  run.workdir / "claude_code.log")
                salida.update(modelo=modelo, resumen_tema=respuesta.datos.get("resumen"),
                              decisiones=respuesta.datos.get("decisiones"), costo_usd=respuesta.costo_usd)
                saneado = sanear(respuesta.datos.get("css") or "")
                salida["rechazos"] = saneado.rechazos
                if not saneado.css.strip():
                    raise TemaVacio("el CSS quedó vacío tras sanearlo")
                violaciones = await pagina.verificar_css(browser, saneado.css)
                if violaciones:
                    salida["violaciones_navegador"] = violaciones
                    raise TemaRechazado(f"el navegador rechazó el CSS saneado: {violaciones[0]['motivo']}")
            (run.workdir / "tema.css").write_text(saneado.css, encoding="utf-8")
        except Exception as error:
            salida["error"] = f"{type(error).__name__}: {error}"[:300]
            raise
        finally:
            _escribir_json(run.workdir / "mejora.json", salida)
    return store.read_manifest(backend, run.key)
