"""Etapa de mejora de una revisión: resume lo que midieron la Guía y el Visitante y genera un kit, una vez.

Lee del almacén las corridas de la misma `revision` (nunca "la última"): el catálogo (`goals.json`), la ruta de
escritorio de cada objetivo (`route.json`) y la tanda del Visitante (`comparison.json` y `<perfil>/run.json`). Escribe
`<host>/improver/<run>/` con `tema.css` (saneado), `tema.json` (los componentes del kit, validados), `atajos.json` (lo
que se derivó de las rutas, sin modelo), `diagnostico.json` (lo que recibió el modelo además del mapa) y `mejora.json`
(el resumen usado y lo que decidió el modelo).
"""

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from shared import store
from shared.browser.session import open_browser
from shared.catalog.files import read_catalog
from shared.nodes.urls import node_key

from disenador import atajos, config, mapa, motor, pagina, tema_json
from disenador.corrida import TemaRechazado
from disenador.css import sanear
from disenador.modelo import ESQUEMA_KIT, ESQUEMA_MOTOR, Skill, mensaje_de_diseno, prompt_de_sistema

# Lo que la Guía tuvo que sacar del camino (un modal, una encuesta, el aviso de cookies), según su historial.
_OBSTACULO = re.compile(r"\b(modal|popup|pop-up|encuesta|cookies?)\b|«(close|cerrar|×)»", re.I)
# Si el ancla de un componente no está en la página, la primera de estas que exista.
ANCLAS_DE_RESPALDO = ("main", "[role='main']", "body > :has(h1)")

_SELECTS = """() => [...document.querySelectorAll("select")].map((s) => ({
  selector: s.id ? "#" + CSS.escape(s.id) : s.name ? `select[name="${CSS.escape(s.name)}"]` : "",
  id: s.id, name: s.name,
  etiqueta: ((s.labels && s.labels[0] && s.labels[0].textContent) || s.getAttribute("aria-label") || "")
    .replace(/\\s+/g, " ").trim().slice(0, 40),
  valores: [...s.options].filter((o) => o.value && !o.disabled).map((o) => o.value).slice(0, 500),
  elegido: s.value,
})).filter((s) => s.selector && s.selector.length <= 200)"""

# El bloque original que reemplaza un atajo: el formulario de sus `<select>`, subiendo mientras los hermanos sean solo
# su título (nada interactivo ni texto largo). Sale como selector único anclado a un id; null si no hay uno seguro.
# `anclas`: las de todas las vistas de la página (la propia primero): si una queda dentro del bloque, ocultarlo se la
# llevaría. Los topes frenan un `<form>` que envuelve la página entera (ASP.NET WebForms) o un bloque desmedido.
BLOQUE_JS = """([selectores, anclas]) => {
  const MAX_CONTROLES_FUERA = 3, MAX_AREA = 0.6;
  const campos = selectores.map((s) => { try { return document.querySelector(s); } catch { return null; } });
  if (!campos.length || campos.some((c) => !c)) return null;
  let bloque = campos[0];
  while (bloque && !campos.every((c) => bloque.contains(c))) bloque = bloque.parentElement;
  if (!bloque) return null;
  const controles = "a[href], button, input, select, textarea, iframe, [role=button], [role=link]";
  const controlesFuera = (el) => [...el.querySelectorAll(controles)]
    .filter((c) => !campos.some((f) => f === c || f.contains(c) || c.contains(f))).length;
  const pagina = Math.min(innerWidth * innerHeight,
                          document.documentElement.scrollWidth * document.documentElement.scrollHeight);
  const cabe = (el) => {
    const r = el.getBoundingClientRect();
    return controlesFuera(el) <= MAX_CONTROLES_FUERA && r.width * r.height < MAX_AREA * pagina;
  };
  const form = bloque.closest("form");
  if (form && cabe(form)) bloque = form;
  const ajeno = "a[href], button, input, select, textarea, iframe, video, img, svg, [role=button], [role=link]";
  const otroContenido = (el) => el.matches(ajeno) || el.querySelector(ajeno) || el.textContent.trim().length > 140;
  while (bloque.parentElement && bloque.parentElement !== document.body
         && [...bloque.parentElement.children].every((c) => c === bloque || !otroContenido(c))) {
    bloque = bloque.parentElement;
  }
  if ([document.body, document.documentElement].includes(bloque) || bloque.parentElement === document.body
      || bloque.matches("main, [role=main]") || bloque.querySelector("main, [role=main]") || !cabe(bloque)) return null;
  for (const selector of anclas) {
    let ancla = null;
    try { ancla = selector ? document.querySelector(selector) : null; } catch { /* selector inválido */ }
    // Cada componente va antes de su ancla: si el ancla está dentro del bloque, ocultarlo se lo llevaría.
    if (ancla && ancla !== bloque && bloque.contains(ancla)) return null;
  }
  const valido = (id) => /^[A-Za-z][\\w-]*$/.test(id);
  const unico = (sel) => { try { const l = document.querySelectorAll(sel); return l.length === 1 && l[0] === bloque; }
                           catch { return false; } };
  if (bloque.id && valido(bloque.id) && unico("#" + bloque.id)) return "#" + bloque.id;
  // El elemento con id más alto dentro del bloque en el camino al primer campo (el formulario, si tiene id).
  let interno = campos[0];
  for (let el = campos[0]; el !== bloque; el = el.parentElement) if (el.id && valido(el.id)) interno = el;
  let profundidad = 0;
  for (let el = interno; el !== bloque; el = el.parentElement) profundidad++;
  if (!interno.id || !valido(interno.id)) return null;
  const relativo = `:has(> ${"* > ".repeat(profundidad - 1)}#${interno.id})`;
  let externo = bloque.parentElement;
  while (externo && !(externo.id && valido(externo.id))) externo = externo.parentElement;
  for (const sel of [externo ? `#${externo.id} ${relativo}` : null, relativo]) {
    if (sel && sel.length <= 200 && unico(sel)) return sel;
  }
  return null;
}"""


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
    historial = (route.get("exploration") or {}).get("history") or []
    return {"estado": route.get("status"), "pasos_minimos": (route.get("totals") or {}).get("min_steps"),
            "pasos": pasos[:config.MAX_PASOS_RUTA], "llega_a": atajos.llegada(route),
            "obstaculos": [_corto(h) for h in historial if isinstance(h, str) and _OBSTACULO.search(h)][:3]}


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
        # El mensaje del Visitante dice qué le pasó; la justificación del veredicto suele ser genérica.
        "por_que": _corto(intento.get("final_message") or veredicto.get("justification")) or None,
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


def _objetivo(backend: store.Backend, url: str, revision: str, goal) -> tuple[dict, list[store.RunKey], dict | None]:
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
        "entrada": goal.entry,
        "ruta": _ruta(route),
        "visitas": visitas,
        "tasa_llegada": round(sum(medidas) / len(medidas), 2) if medidas else None,
    }, entradas, route if isinstance(route, dict) else None


@dataclass
class Revision:
    resumen: dict
    entradas: list[store.RunKey]
    goals: list
    """Los objetivos del catálogo que se intentan, en su orden."""
    rutas: dict[str, dict]
    """La `route.json` de escritorio de cada objetivo que la tiene."""
    catalogo: list = field(default_factory=list)
    """Todos los objetivos del catálogo, también los que no se intentan (los de nivel resumen agrupan a los demás)."""


def leer_revision(backend: store.Backend, url: str, revision: str) -> Revision:
    """Lo medido en la revisión: el resumen compacto, las corridas que leyó, el catálogo y las rutas de la Guía."""
    corrida = store.revision_run(backend, store.cataloger(url), revision)
    goals, catalogo = [], []
    if corrida:
        try:
            _, catalogo, _ = read_catalog(backend, corrida)
            goals = [g for g in catalogo if g.exclusion is None]
        except (OSError, ValueError, KeyError, TypeError):
            goals, catalogo = [], []
    objetivos, entradas, rutas = [], [corrida] if corrida else [], {}
    for goal in goals:
        objetivo, leidas, route = _objetivo(backend, url, revision, goal)
        objetivos.append((objetivo, bool(leidas)))
        entradas += leidas
        if route:
            rutas[goal.id] = route
    # El conductor corre solo algunos objetivos: los demás no aportan nada al modelo.
    medidos = [o for o, con_corridas in objetivos if con_corridas]
    resumen = {"revision": revision, "url": url,
               "objetivos": medidos or [o for o, _ in objetivos][:config.MAX_GOALS_SIN_CORRIDAS]}
    return Revision(resumen, entradas, goals, rutas, catalogo)


def resumir(backend: store.Backend, url: str, revision: str) -> tuple[dict, list[store.RunKey]]:
    """El resumen compacto de lo medido en la revisión y las corridas que leyó."""
    leida = leer_revision(backend, url, revision)
    return leida.resumen, leida.entradas


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


async def _selects(page) -> list[atajos.SelectDePagina]:
    return [atajos.SelectDePagina(**{**s, "valores": tuple(s["valores"])}) for s in await page.evaluate(_SELECTS)]


async def _existe(page, selector: str) -> bool:
    try:
        return await page.evaluate("(s) => document.querySelector(s) !== null", selector)
    except Exception:  # un selector que el navegador no entiende
        return False


def diagnostico(resumen: dict, kit: dict) -> dict:
    """Lo que el modelo recibe además del mapa: por qué no llegaron, qué sortearon y los componentes propuestos."""
    mensajes, obstaculos = [], []
    for objetivo in resumen["objetivos"]:
        mensajes += [{"objetivo": objetivo["id"], "perfil": v["perfil"], "llego": v["llego"], "mensaje": v["por_que"]}
                     for v in objetivo["visitas"] if v["por_que"]]
        obstaculos += [{"objetivo": objetivo["id"], "paso": paso}
                       for paso in (objetivo["ruta"] or {}).get("obstaculos") or []]
    componentes = [a["vista"] for a in kit["atajos"]] + [v for v in (kit["lanzador"], kit["buscador"]) if v]
    return {"viewport": config.REVISION, "mensajes_visitante": mensajes, "obstaculos": obstaculos,
            "componentes": componentes, "sin_atajo": kit["descartes"]}


async def _vistas(page, url: str, componentes: list[dict], propuestas) -> list[dict]:
    """Los componentes con la microcopia del modelo y un ancla que existe en la página abierta (si van en ella)."""
    por_id = {p.get("id"): p for p in propuestas or [] if isinstance(p, dict)}
    tareas = tema_json.tareas_propuestas(propuestas)
    en_pagina = atajos.ruta_de(url)
    vistas = []
    for vista in componentes:
        propuesta = dict(por_id.get(vista["id"]) or {})
        contenedor = ""
        if any(atajos.misma_ruta(en_pagina, ruta) for ruta in vista["rutas"]):
            for candidato in (str(propuesta.get("contenedor") or "").strip()[:200], vista["contenedor"],
                              *ANCLAS_DE_RESPALDO):
                if candidato and await _existe(page, candidato):
                    contenedor = candidato
                    break
        vistas.append(tema_json.con_propuesta(vista, {**propuesta, "contenedor": contenedor}, tareas))
    return vistas


async def _ocultar(page, url: str, vistas: list[dict]) -> list[tuple[str, str]]:
    """`(vista, selector)` del bloque original que reemplaza cada atajo dibujado en esta página."""
    en_pagina = atajos.ruta_de(url)
    # Como `features/vista.js`: sin `rutas`, la vista va en todas las páginas.
    aqui = [v for v in vistas if v["contenedor"]
            and (not v.get("rutas") or any(atajos.misma_ruta(en_pagina, r) for r in v["rutas"]))]
    pares = []
    for vista in aqui:
        campos = [c["opciones"] for c in vista["datos"] if c.get("opciones")]
        if vista["componente"] != "atajo" or not campos:
            continue
        anclas = [vista["contenedor"], *(v["contenedor"] for v in aqui if v is not vista)]
        try:
            selector = await page.evaluate(BLOQUE_JS, [campos, anclas])
        except Exception:  # un selector que el navegador no entiende
            selector = None
        if selector:
            pares.append((vista["id"], selector))
    return pares


def _pedido(datos: dict) -> dict:
    """La elección del modelo. La semilla queda entera y ≥ 1 aunque llegue como texto o decimal ("3.7" o 3.7 → 3);
    lo que no es un número finito, 1."""
    try:
        semilla = max(1, int(float(datos.get("semilla") or 1)))
    except (TypeError, ValueError, OverflowError):
        semilla = 1
    ajustes = datos.get("ajustes") if isinstance(datos.get("ajustes"), dict) else {}
    return {"direccion": str(datos.get("direccion") or "auto"), "semilla": semilla, "ajustes": ajustes,
            "motivo": datos.get("motivo")}


def _componer(sitio: motor.Sitio, pedido: dict, vistas: list[dict], ocultar: list[tuple[str, str]]) -> motor.Tema:
    ids = {c: [v["id"] for v in vistas if v["componente"] == c] for c in motor.COMPONENTES_KIT}
    tema = motor.componer(sitio, pedido["direccion"], pedido["semilla"], pedido["ajustes"], ids, ocultar)
    if not tema.ok:
        problema = (tema.informe["saneador"]["rechazos"] or tema.informe["contraste"]["fallas"])[0]
        raise motor.ErrorDeComposicion(f"el tema compuesto no pasa la verificación: {problema}")
    return tema


async def mejorar(backend: store.Backend, url: str, revision: str, skill: Skill | None, disenador, modelo: str,
                  cdp_url: str | None = None, modo: str = config.MODO_TEMA) -> store.Manifest:
    """Una corrida de improver: `succeeded` con un `tema.css` no vacío; si no, `failed` y lanza.

    En modo `motor` el modelo elige dirección, semilla y ajustes y el CSS lo compone `motor`; si la composición falla,
    se le pide el CSS libre (el modo `libre`) y queda anotado en `informe.json`."""
    leida = leer_revision(backend, url, revision)
    resumen = leida.resumen
    peor = peor_objetivo(resumen)
    with store.running(backend, store.improver(url), model=modelo, inputs=leida.entradas, revision=revision) as run:
        salida = {"resumen": resumen, "tarea": peor and {"id": peor["id"], "descripcion": peor["descripcion"]},
                  "gustos": config.GUSTOS_MEJORA, "modo": modo}
        informe: dict = {"modo": modo}
        try:
            async with open_browser(cdp_url) as browser:
                contexto, page = await pagina.abrir(browser, url, "revision")
                try:
                    datos_mapa, captura = await mapa.construir_mapa(page), await pagina.capturar(page)
                    tasas = {o["id"]: o["tasa_llegada"] for o in resumen["objetivos"]}
                    kit = atajos.derivar(leida.goals, leida.rutas, await _selects(page), url, tasas, leida.catalogo)
                    _escribir_json(run.workdir / "atajos.json", kit)
                    diag = diagnostico(resumen, kit)
                    _escribir_json(run.workdir / "diagnostico.json", diag)
                    texto = mensaje_de_diseno(url, config.GUSTOS_MEJORA, peor and peor["descripcion"],
                                              mapa.como_texto(datos_mapa), config.REVISION,
                                              json.dumps(resumen["objetivos"], ensure_ascii=False),
                                              json.dumps(diag, ensure_ascii=False))
                    partes, log = [texto, captura], run.workdir / "claude_code.log"
                    con_motor = modo == "motor"
                    respuesta = await disenador.pedir(prompt_de_sistema(skill, kit=True, con_motor=con_motor),
                                                      ESQUEMA_MOTOR if con_motor else ESQUEMA_KIT, partes, log)
                    # Con la página abierta: el ancla que propone el modelo solo vale si existe.
                    vistas = await _vistas(page, url, diag["componentes"], respuesta.datos.get("componentes"))
                    ocultar = await _ocultar(page, url, vistas)
                finally:
                    await contexto.close()
                costo = respuesta.costo_usd
                informe["ocultar"] = [{"vista": v, "selector": s} for v, s in ocultar]
                informe["sin_traduccion"] = tema_json.sin_traduccion(vistas)
                css = None
                if con_motor:
                    pedido = _pedido(respuesta.datos)
                    salida.update(pedido=pedido, resumen_tema=pedido["motivo"])
                    try:
                        compuesto = _componer(motor.rasgos_del_sitio(store.normalize_host(url), datos_mapa), pedido,
                                              vistas, ocultar)
                        css = compuesto.css
                        informe.update(compuesto.informe, modo="motor", pedido=pedido)
                    except Exception as error:
                        informe.update(modo="libre", pedido=pedido,
                                       respaldo=f"el motor falló: {type(error).__name__}: {error}"[:300])
                        respuesta = await disenador.pedir(prompt_de_sistema(skill, kit=True), ESQUEMA_KIT, partes,
                                                          log)
                        costo += respuesta.costo_usd
                if css is None:
                    salida.update(resumen_tema=respuesta.datos.get("resumen"),
                                  decisiones=respuesta.datos.get("decisiones"))
                    libre = sanear(respuesta.datos.get("css") or "")
                    salida["rechazos"] = libre.rechazos
                    if not libre.css.strip():
                        raise TemaVacio("el CSS quedó vacío tras sanearlo")
                    css = "\n\n".join([libre.css, *(motor.regla_de_ocultar(v, s) for v, s in ocultar)])
                salida.update(modelo=modelo, costo_usd=costo)
                saneado = sanear(css)
                salida.setdefault("rechazos", saneado.rechazos)
                violaciones = await pagina.verificar_css(browser, saneado.css)
                if violaciones:
                    salida["violaciones_navegador"] = violaciones
                    raise TemaRechazado(f"el navegador rechazó el CSS saneado: {violaciones[0]['motivo']}")
            tema, descartes = tema_json.armar(f"{store.normalize_host(url)} — kit de la revisión {revision}", vistas)
            salida["kit"] = {"vistas": [v["id"] for v in tema["features"]["vista"]], "descartes": descartes}
            (run.workdir / "tema.css").write_text(saneado.css, encoding="utf-8")
            _escribir_json(run.workdir / "tema.json", tema)
        except Exception as error:
            salida["error"] = f"{type(error).__name__}: {error}"[:300]
            raise
        finally:
            _escribir_json(run.workdir / "mejora.json", salida)
            _escribir_json(run.workdir / "informe.json", informe)
    return store.read_manifest(backend, run.key)
