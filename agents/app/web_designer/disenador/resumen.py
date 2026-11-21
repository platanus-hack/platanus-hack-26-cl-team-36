"""resumen.json y reporte.md de una corrida, y la comparación de dos corridas (por ejemplo, dos versiones de un skill)."""

import json
import statistics
from pathlib import Path

# (clave, etiqueta, dirección): 1 = más es mejor, -1 = menos es mejor, 0 = informativa.
METRICAS = [
    ("promedio_juez", "Juez: promedio 1–5", 1),
    ("estetica", "Juez: estética", 1),
    ("ajuste_a_gustos", "Juez: ajuste a gustos (confianza baja)", 1),
    ("legibilidad", "Juez: legibilidad", 1),
    ("jerarquia_y_foco_en_tarea", "Juez: jerarquía y foco", 1),
    ("integridad", "Juez: integridad (confianza baja)", 1),
    ("veredicto_mejor", "Veredicto «mejor» (proporción)", 1),
    ("par_prefiere_tema", "Par: prefiere el tema, consistente (proporción)", 1),
    ("par_consistente", "Par: mismo resultado en ambos órdenes (proporción)", 1),
    ("contraste_falla_antes", "Contraste AA: falla antes (proporción de textos)", 0),
    ("contraste_falla_despues", "Contraste AA: falla después", -1),
    ("contraste_falla_movil_despues", "Contraste AA: falla después, móvil", -1),
    ("perdidos", "Interactivos perdidos (escritorio + móvil)", -1),
    ("ocultos", "Elementos ocultados", -1),
    ("desborde_movil_despues", "Desborde horizontal en móvil (proporción)", -1),
    ("sin_mi_tema_identica", "Sin mi-tema queda idéntica (proporción)", 1),
    ("violaciones", "Selectores fuera de html.mi-tema", -1),
    ("rechazos", "Rechazos del saneamiento", -1),
    ("riesgos", "Riesgos (filter, *, transiciones de layout, fixed)", -1),
    ("fijos_agregados", "Elementos fixed/sticky agregados", -1),
    ("letra_mediana_despues", "Letra mediana después (px)", 0),
    ("bytes_css", "Tamaño del CSS (bytes)", 0),
    ("reglas", "Reglas", 0),
    ("segundos_modelo", "Segundos del modelo", -1),
    ("costo_usd", "Costo equivalente (USD)", -1),
]


def _derivadas(fila: dict) -> dict:
    """Las métricas booleanas como 0/1, para promediarlas como proporciones."""
    extra = {}
    if "veredicto" in fila:
        extra["veredicto_mejor"] = 1.0 if fila["veredicto"] == "mejor" else 0.0
    if fila.get("par_preferido"):
        extra["par_prefiere_tema"] = 1.0 if fila["par_preferido"] == "despues" else 0.0
    for clave in ("par_consistente", "desborde_movil_despues", "sin_mi_tema_identica"):
        if isinstance(fila.get(clave), bool):
            extra[clave] = 1.0 if fila[clave] else 0.0
    return {**fila, **extra}


def agregar(filas: list[dict]) -> dict:
    """Promedios de las métricas sobre las generaciones sin error, más conteos de veredictos y errores."""
    buenas = [_derivadas(f) for f in filas if "error" not in f]
    promedios = {}
    for clave, _, _ in METRICAS:
        valores = [f[clave] for f in buenas if isinstance(f.get(clave), (int, float)) and not isinstance(f.get(clave), bool)]
        promedios[clave] = round(statistics.fmean(valores), 4) if valores else None
    desvio = [f["promedio_juez"] for f in buenas if isinstance(f.get("promedio_juez"), (int, float))]
    return {
        "generaciones": len(filas),
        "errores": len(filas) - len(buenas),
        "errores_juez": sum(1 for f in buenas if "error_juez" in f),
        "promedios": promedios,
        "desvio_promedio_juez": round(statistics.pstdev(desvio), 3) if len(desvio) > 1 else None,
        "veredictos": {v: sum(1 for f in buenas if f.get("veredicto") == v) for v in ("mejor", "igual", "peor")},
        "par": {p: sum(1 for f in buenas if f.get("par_preferido") == p)
                for p in ("despues", "antes", "empate", "inconsistente")},
    }


def armar(filas: list[dict], meta: dict) -> dict:
    casos = list(dict.fromkeys(f["caso"] for f in filas))
    return {
        **meta,
        "global": agregar(filas),
        "por_caso": {caso: agregar([f for f in filas if f["caso"] == caso]) for caso in casos},
        "filas": filas,
    }


def formato(valor) -> str:
    if valor is None:
        return "—"
    if isinstance(valor, bool):
        return "sí" if valor else "no"
    if isinstance(valor, float):
        return f"{valor:.3f}".rstrip("0").rstrip(".") if abs(valor) < 100 else f"{valor:.0f}"
    return str(valor)


def _celda(texto) -> str:
    return formato(texto).replace("|", "\\|").replace("\n", " ")


def reporte(resumen: dict) -> str:
    skill = resumen.get("skill")
    lineas = [
        "# Reporte del diseñador",
        "",
        f"- **Fecha:** {resumen['fecha']}",
        f"- **Skill:** " + (f"`{skill['nombre']}` (`{skill['ruta']}`, sha256 `{skill['sha256']}`)" if skill
                            else "ninguno (línea base: solo el contrato de salida)"),
        f"- **Modelo:** `{resumen['modelo']}` (esfuerzo {resumen['esfuerzo']}); **juez:** `{resumen['modelo_juez']}`",
        f"- **Repeticiones por caso:** {resumen['repeticiones']}",
    ]
    if resumen.get("css_dado"):
        lineas.append(f"- **CSS evaluado (sin generar):** `{resumen['css_dado']}`")
    total = resumen["global"]
    lineas += [
        "",
        "## Global",
        "",
        f"{total['generaciones']} generaciones, {total['errores']} con error, {total['errores_juez']} sin juicio. "
        f"Veredictos: {total['veredictos']['mejor']} mejor, {total['veredictos']['igual']} igual, "
        f"{total['veredictos']['peor']} peor. Comparación de a pares: {total['par']['despues']} prefieren el tema, "
        f"{total['par']['antes']} la original, {total['par']['empate']} empate, {total['par']['inconsistente']} "
        "cambian con el orden. Desvío del promedio del juez entre generaciones: "
        f"{formato(total['desvio_promedio_juez'])}.",
        "",
        "| Métrica | Valor |",
        "|---|---|",
    ]
    lineas += [f"| {etiqueta} | {formato(total['promedios'][clave])} |" for clave, etiqueta, _ in METRICAS]
    lineas += [
        "",
        "## Por caso",
        "",
        "| Caso | Generaciones | Juez | Veredictos (m/i/p) | Par prefiere tema | Contraste antes → después | Perdidos | Violaciones | Rechazos |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for caso, datos in resumen["por_caso"].items():
        p, v = datos["promedios"], datos["veredictos"]
        lineas.append(
            f"| {caso} | {datos['generaciones']} ({datos['errores']} error) | {formato(p['promedio_juez'])} | "
            f"{v['mejor']}/{v['igual']}/{v['peor']} | {formato(p['par_prefiere_tema'])} | "
            f"{formato(p['contraste_falla_antes'])} → {formato(p['contraste_falla_despues'])} | "
            f"{formato(p['perdidos'])} | {formato(p['violaciones'])} | {formato(p['rechazos'])} |"
        )
    lineas += [
        "",
        "## Generaciones",
        "",
        "| Caso | Rep | Juez | E/A/L/J/I | Veredicto | Par | Contraste antes → después | Perdidos | Ocultos | Violaciones | Rechazos | Sin mi-tema idéntica | Captura |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for fila in resumen["filas"]:
        carpeta = fila.get("carpeta")
        if "error" in fila:
            lineas.append(f"| {fila['caso']} | {fila['rep']} | error: {_celda(fila['error'])} |||||||||||")
            continue
        puntajes = "/".join(formato(fila.get(d)) for d in
                            ("estetica", "ajuste_a_gustos", "legibilidad", "jerarquia_y_foco_en_tarea", "integridad"))
        lineas.append(
            f"| {fila['caso']} | {fila['rep']} | {formato(fila.get('promedio_juez'))} | {puntajes} | "
            f"{formato(fila.get('veredicto'))} | {formato(fila.get('par_preferido'))} | "
            f"{formato(fila.get('contraste_falla_antes'))} → {formato(fila.get('contraste_falla_despues'))} | "
            f"{formato(fila.get('perdidos'))} | {formato(fila.get('ocultos'))} | {formato(fila.get('violaciones'))} | "
            f"{formato(fila.get('rechazos'))} | {formato(fila.get('sin_mi_tema_identica'))} | "
            f"[despues.png]({carpeta}/despues.png) |"
        )
    problemas = [f for f in resumen["filas"] if f.get("principal_problema")]
    if problemas:
        lineas += ["", "## Principal problema según el juez", ""]
        lineas += [f"- **{f['caso']} rep {f['rep']}:** {f['principal_problema']}" for f in problemas]
    errores_juez = [f for f in resumen["filas"] if f.get("error_juez")]
    if errores_juez:
        lineas += ["", "## Errores del juez", ""]
        lineas += [f"- **{f['caso']} rep {f['rep']}:** {f['error_juez']}" for f in errores_juez]
    lineas.append("")
    return "\n".join(lineas)


def escribir(salida: Path, filas: list[dict], meta: dict) -> dict:
    resumen = armar(filas, meta)
    (salida / "resumen.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=2), encoding="utf-8")
    (salida / "reporte.md").write_text(reporte(resumen), encoding="utf-8")
    return resumen


def _etiqueta_corrida(resumen: dict) -> str:
    skill = resumen.get("skill")
    return f"{skill['nombre']}@{skill['sha256']}" if skill else "sin skill"


def comparar(a: dict, b: dict) -> str:
    """Tabla de diferencias B − A de los promedios globales y, si comparten casos, del juez por caso."""
    lineas = [
        f"A: {_etiqueta_corrida(a)} · {a['modelo']} · {a['fecha']} · {a['global']['generaciones']} generaciones",
        f"B: {_etiqueta_corrida(b)} · {b['modelo']} · {b['fecha']} · {b['global']['generaciones']} generaciones",
        "",
        "| Métrica | A | B | B − A | |",
        "|---|---|---|---|---|",
    ]
    for clave, etiqueta, direccion in METRICAS:
        va, vb = a["global"]["promedios"].get(clave), b["global"]["promedios"].get(clave)
        delta = vb - va if isinstance(va, (int, float)) and isinstance(vb, (int, float)) else None
        juicio = ""
        if delta and direccion:
            juicio = "mejora" if delta * direccion > 0 else "empeora"
        lineas.append(f"| {etiqueta} | {formato(va)} | {formato(vb)} | "
                      f"{'' if delta is None else ('+' if delta > 0 else '') + formato(round(delta, 4))} | {juicio} |")
    comunes = [caso for caso in a["por_caso"] if caso in b["por_caso"]]
    if comunes:
        lineas += ["", "| Caso | Juez A | Juez B | Contraste después A | Contraste después B |", "|---|---|---|---|---|"]
        for caso in comunes:
            pa, pb = a["por_caso"][caso]["promedios"], b["por_caso"][caso]["promedios"]
            lineas.append(f"| {caso} | {formato(pa['promedio_juez'])} | {formato(pb['promedio_juez'])} | "
                          f"{formato(pa['contraste_falla_despues'])} | {formato(pb['contraste_falla_despues'])} |")
    return "\n".join(lineas)
