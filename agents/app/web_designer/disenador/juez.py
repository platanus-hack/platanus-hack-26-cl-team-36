"""El juez: puntúa el tema por dimensiones y lo compara de a pares con la original, en los dos órdenes.

Las rúbricas están en `rubrica_juez.md` (puntajes) y `rubrica_par.md` (comparación) para poder afinarlas sin tocar
código. Los jueces visuales son más confiables comparando de a pares que puntuando en absoluto, y tienen sesgo de
posición: por eso la comparación se hace dos veces, con A y B invertidos, y se informa si coinciden.
"""

import asyncio
from pathlib import Path

from disenador import config
from disenador.modelo import ErrorDeModelo

DIMENSIONES = ["estetica", "ajuste_a_gustos", "legibilidad", "jerarquia_y_foco_en_tarea", "integridad"]
# Según la investigación de diseño (benchmarks de jueces visuales), estética, legibilidad y jerarquía son las
# dimensiones en que más se puede confiar; las de facilidad de uso y ajuste, menos.
CONFIANZA = {
    "estetica": "alta",
    "legibilidad": "alta",
    "jerarquia_y_foco_en_tarea": "alta",
    "ajuste_a_gustos": "baja",
    "integridad": "baja",
}

# Plano a propósito: con objetos anidados ({puntaje, razon}) el modelo a veces arma mal la salida estructurada.
ESQUEMA_PUNTAJES = {
    "type": "object",
    "properties": {
        **{
            clave: esquema
            for dimension in DIMENSIONES
            for clave, esquema in (
                (f"{dimension}_puntaje", {"type": "integer", "enum": [1, 2, 3, 4, 5]}),
                (f"{dimension}_razon", {"type": "string"}),
            )
        },
        "veredicto": {"type": "string", "enum": ["mejor", "igual", "peor"]},
        "principal_problema": {"type": "string"},
    },
    "required": [*(f"{d}_{c}" for d in DIMENSIONES for c in ("puntaje", "razon")), "veredicto", "principal_problema"],
    "additionalProperties": False,
}
ESQUEMA_PAR = {
    "type": "object",
    "properties": {"preferido": {"type": "string", "enum": ["A", "B", "empate"]}, "razon": {"type": "string"}},
    "required": ["preferido", "razon"],
    "additionalProperties": False,
}


def _contexto(url: str, gustos: str, tarea: str | None) -> str:
    return f"URL: {url}\nGustos del usuario: {gustos}\nTarea del usuario en el sitio: {tarea or '(no la indicó)'}\n"


async def _puntajes(cliente, url, gustos, tarea, capturas: dict[str, bytes], log: Path) -> tuple[dict, object]:
    partes: list = [_contexto(url, gustos, tarea), "Escritorio, original (antes):", capturas["antes"],
                    "Escritorio, con el tema (después):", capturas["despues"]]
    if capturas.get("despues-movil"):
        partes += ["Móvil, con el tema (después):", capturas["despues-movil"]]
    respuesta = await cliente.pedir(config.RUBRICA_JUEZ.read_text(encoding="utf-8"), ESQUEMA_PUNTAJES, partes, log)
    return respuesta.datos, respuesta


async def _par(cliente, url, gustos, tarea, primera: bytes, segunda: bytes, log: Path) -> tuple[dict, object]:
    partes = [_contexto(url, gustos, tarea), "Versión A:", primera, "Versión B:", segunda]
    respuesta = await cliente.pedir(config.RUBRICA_PAR.read_text(encoding="utf-8"), ESQUEMA_PAR, partes, log)
    return respuesta.datos, respuesta


def _quien(preferido: str, a: str, b: str) -> str:
    return {"A": a, "B": b}.get(preferido, "empate")


async def _con_reintento(llamada, intentos: int = 2):
    """Repite una llamada que falló por la salida estructurada; devuelve el resultado o la última excepción."""
    for intento in range(intentos):
        try:
            return await llamada()
        except ErrorDeModelo as error:
            if intento == intentos - 1:
                return error


async def juzgar(cliente, url: str, gustos: str, tarea: str | None, capturas: dict[str, bytes], log: Path) -> dict:
    """juicio.json. `capturas`: "antes", "despues" y, si hay, "despues-movil" (PNG de escritorio y móvil).

    Las tres llamadas (puntajes y los dos órdenes del par) van en paralelo y cada una se reintenta una vez. Si
    fallan los puntajes, lanza ErrorDeModelo; si falla un orden del par, el par queda sin preferido.
    """
    resultados = await asyncio.gather(
        _con_reintento(lambda: _puntajes(cliente, url, gustos, tarea, capturas, log)),
        _con_reintento(lambda: _par(cliente, url, gustos, tarea, capturas["antes"], capturas["despues"], log)),
        _con_reintento(lambda: _par(cliente, url, gustos, tarea, capturas["despues"], capturas["antes"], log)),
    )
    if isinstance(resultados[0], Exception):
        raise resultados[0]
    puntajes, _ = resultados[0]
    ordenes, errores = [], []
    for resultado, (a, b) in zip(resultados[1:], (("antes", "despues"), ("despues", "antes"))):
        if isinstance(resultado, Exception):
            errores.append(str(resultado)[:200])
            ordenes.append(None)
        else:
            datos = resultado[0]
            ordenes.append({**datos, "A": a, "B": b, "elige": _quien(datos["preferido"], a, b)})
    completo = all(ordenes)
    consistente = completo and ordenes[0]["elige"] == ordenes[1]["elige"]
    costo = sum(r[1].costo_usd for r in resultados if not isinstance(r, Exception))
    return {
        "dimensiones": {
            d: {"puntaje": puntajes[f"{d}_puntaje"], "razon": puntajes[f"{d}_razon"], "confianza": CONFIANZA[d]}
            for d in DIMENSIONES
        },
        "promedio": round(sum(puntajes[f"{d}_puntaje"] for d in DIMENSIONES) / len(DIMENSIONES), 2),
        "veredicto": puntajes["veredicto"],
        "principal_problema": puntajes["principal_problema"],
        "par": {
            "antes_como_A": ordenes[0],
            "despues_como_A": ordenes[1],
            "consistente": consistente if completo else None,
            "preferido": (ordenes[0]["elige"] if consistente else "inconsistente") if completo else None,
            **({"errores": errores} if errores else {}),
        },
        "costo_usd": round(costo, 4),
    }
