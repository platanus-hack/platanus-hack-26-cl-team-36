"""Spike: ¿8 exploradores (4 lugares × 2 niveles de conocimiento) encuentran más caminos que los 4 de siempre?

Qué mide: para cada tarea, las tandas con `conjunto_exploradores = "base"` (A, 4 exploradores sin nivel) y con
`"conocimiento"` (B, 8 = 4 lugares × `sin_contexto` / `conoce_tema`), las N más nuevas de cada una (N = --reps).
Por tanda: éxitos (en total, por nivel y por lugar), páginas distintas, caminos distintos hasta una página de
respuesta, pasos, tiempo y segundos por acción de cada explorador, cortes por límite, errores, escrituras rechazadas
y costo equivalente de los usuarios (sin el juez). Con dos tandas de A, compara además B con «A×2» (la unión de dos
tandas de A: 8 exploradores sin nivel), para separar el efecto de los niveles del de tener el doble de exploradores.

Definiciones:
- Página: la URL normalizada como en el evaluador (`normalize_url`), sin la consulta (`?s=…`), del mismo sitio que
  la URL inicial. Así dos búsquedas con palabras distintas son la misma página de resultados.
- Página de respuesta: donde terminó un intento con éxito, en cualquier tanda de la tarea.
- Camino: la secuencia de páginas desde la inicial hasta una página de respuesta, sin vueltas. Al volver a una página
  del camino actual, el camino se corta ahí; un salto (`volver_a_nodo` o Atrás) retoma el camino con que se llegó a
  esa página la primera vez; un clic que llega a una página ya vista por otro lado es un camino nuevo.

Cómo se ejecuta (desde la raíz del repo; usa solo la biblioteca estándar y route_tree.py del evaluador). Busca las
tandas en toda la carpeta de corridas, también en archivo/:

    python3 .spikes/2026-11-21-exploradores-conocimiento.py [--runs agents/.runs] [--reps 2] [--json salida.json]

Las tandas se corren antes con el evaluador, una a la vez, por ejemplo:

    cd agents/app/web_evaluator
    uv run main.py --task <id> --exploradores base --model claude-haiku-5-5 --effort medium --record-video
    uv run main.py --task <id> --exploradores conocimiento --model claude-haiku-5-5 --effort medium --record-video
"""

import argparse
import json
import statistics
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ / "agents" / "app" / "web_evaluator"))

from route_tree import normalize_url, registrable_domain

LUGARES = ("menu", "buscador", "pie", "contenido")
NIVELES = ("sin_contexto", "conoce_tema")
LUGAR_DE_LA_BASE = {"explorador": "menu", "explorador_buscador": "buscador", "explorador_pie": "pie",
                    "explorador_contenido": "contenido"}
INTERRUMPIDO = {"refusal", "api_error", "no_response", "internal_error"}


def pagina(url: str) -> str:
    partes = urlsplit(normalize_url(url))
    return urlunsplit((partes.scheme, partes.netloc, partes.path, "", partes.fragment))


def lugar_de(perfil: str) -> str:
    return LUGAR_DE_LA_BASE.get(perfil) or perfil.split("_")[1]


def resultado(run: dict) -> str:
    if run.get("end_reason") in INTERRUMPIDO or not run.get("start"):
        return "interrupted"
    return (run.get("verdict") or {}).get("outcome") or "?"


def leer_tandas(runs_dir: Path, reps: int) -> dict[str, dict[str, list[dict]]]:
    """tarea -> conjunto -> sus `reps` tandas más nuevas, de la más vieja a la más nueva."""
    tandas: dict[str, dict[str, list[dict]]] = {}
    for arbol in sorted(runs_dir.rglob("route_tree.json"), key=lambda ruta: ruta.parent.name):
        meta = json.loads(arbol.read_text(encoding="utf-8"))
        conjunto = meta.get("conjunto_exploradores")
        if conjunto not in ("base", "conocimiento") or not meta.get("task_id"):
            continue
        runs = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(arbol.parent.glob("*/run.json"))]
        if not any(run.get("start") for run in runs):
            continue  # ningún explorador cargó la página inicial (sitio caído o bloqueado): no es una medición
        tandas.setdefault(meta["task_id"], {}).setdefault(conjunto, []).append(
            {"carpeta": arbol.parent, "meta": meta, "runs": runs}
        )
    return {
        tarea: {conjunto: lista[-reps:] for conjunto, lista in por_conjunto.items()}
        for tarea, por_conjunto in tandas.items()
    }


def secuencia(run: dict, dominio: str | None) -> list[tuple[str, bool]]:
    """(página, llegó con un salto) por cada cambio de página del intento, empezando por la inicial."""
    if not run.get("start"):
        return []
    paginas = [(pagina(run["start"]["url"]), False)]
    for paso in run["steps"]:
        url = paso["url"]
        if url.startswith("chrome-error://") or registrable_domain(url) != dominio:
            continue
        actual = pagina(url)
        if actual == paginas[-1][0]:
            continue
        salto = paso["action"] == "volver_a_nodo" or "went_back" in paso.get("signals", [])
        paginas.append((actual, salto))
    return paginas


def caminos(run: dict, dominio: str | None, respuestas: set[str]) -> set[tuple[str, ...]]:
    encontrados: set[tuple[str, ...]] = set()
    seq = secuencia(run, dominio)
    if not seq:
        return encontrados
    camino = [seq[0][0]]
    primera_vez = {seq[0][0]: list(camino)}
    for actual, salto in seq[1:]:
        if actual in camino:
            camino = camino[: camino.index(actual) + 1]
        elif salto and actual in primera_vez:
            camino = list(primera_vez[actual])
        else:
            camino = camino + [actual]
            primera_vez.setdefault(actual, list(camino))
        if actual in respuestas:
            encontrados.add(tuple(camino))
    return encontrados


def resumir(tanda: dict, respuestas: set[str], dominio: str | None) -> dict[str, dict]:
    """perfil -> lo medido en su intento."""
    por_perfil = {}
    for run in tanda["runs"]:
        pasos = len(run["steps"])
        por_perfil[run["profile"]] = {
            "nivel": run.get("conocimiento"),
            "lugar": lugar_de(run["profile"]),
            "resultado": resultado(run),
            "fin": run.get("end_reason"),
            "pasos": pasos,
            "segundos": run.get("duration_s", 0.0),
            "s_por_accion": round(run["duration_s"] / pasos, 1) if pasos else None,
            "paginas": {p for p, _ in secuencia(run, dominio)},
            "caminos": caminos(run, dominio, respuestas),
            "rechazos": len(run.get("terminos_rechazados") or []),
            "costo_usd": (run.get("token_usage") or {}).get("equivalent_cost_usd") or 0.0,
        }
    return por_perfil


def union(intentos, clave: str, filtro=lambda d: True) -> set:
    return set().union(*(d[clave] for d in intentos if filtro(d)))


def media(valores) -> float:
    valores = list(valores)
    return statistics.mean(valores) if valores else 0.0


def medir(tandas: dict, reps: int) -> dict:
    medicion = {}
    for tarea, por_conjunto in sorted(tandas.items()):
        if set(por_conjunto) != {"base", "conocimiento"}:
            continue
        todas = por_conjunto["base"] + por_conjunto["conocimiento"]
        dominio = registrable_domain(todas[0]["meta"]["url"])
        respuestas = {
            pagina(run["steps"][-1]["url"] if run["steps"] else run["start"]["url"])
            for tanda in todas for run in tanda["runs"] if resultado(run) == "success"
        }
        a = [resumir(t, respuestas, dominio) for t in por_conjunto["base"]]
        b = [resumir(t, respuestas, dominio) for t in por_conjunto["conocimiento"]]
        m = {"tandas": {"A": [t["carpeta"].name for t in por_conjunto["base"]],
                        "B": [t["carpeta"].name for t in por_conjunto["conocimiento"]]},
             "A": a, "B": b}
        for clave in ("paginas", "caminos"):
            por_a = [union(x.values(), clave) for x in a]
            por_b = [union(x.values(), clave) for x in b]
            a_doble = set().union(*por_a) if len(por_a) >= 2 else None
            sin = lambda d: d["nivel"] == "sin_contexto"
            con = lambda d: d["nivel"] == "conoce_tema"
            m[clave] = {
                "A": media(len(s) for s in por_a),
                "B": media(len(s) for s in por_b),
                "B_menos_A": media(len(sb - sa) for sb, sa in zip(por_b, por_a)),
                "A_x2": len(a_doble) if a_doble is not None else None,
                "B_menos_A_x2": media(len(sb - a_doble) for sb in por_b) if a_doble is not None else None,
                "A_x2_menos_B": media(len(a_doble - sb) for sb in por_b) if a_doble is not None else None,
                "solo_sin_contexto": media(len(union(x.values(), clave, sin) - union(x.values(), clave, con)) for x in b),
                "solo_conoce_tema": media(len(union(x.values(), clave, con) - union(x.values(), clave, sin)) for x in b),
                "B_repeticiones": [len(s) for s in por_b],
            }
        # Lo que cada explorador de B aporta y ningún otro de su tanda tiene (media de las tandas de B).
        m["unicos_en_B"] = {
            perfil: {
                clave: media(
                    len(x[perfil][clave] - union((d for p, d in x.items() if p != perfil), clave))
                    for x in b if perfil in x
                )
                for clave in ("paginas", "caminos")
            }
            for perfil in sorted({p for x in b for p in x})
        }
        medicion[tarea] = m
    return medicion


def _exitos(intentos, filtro=lambda d: True) -> str:
    elegidos = [d for d in intentos if filtro(d)]
    return f"{sum(d['resultado'] == 'success' for d in elegidos)}/{len(elegidos)}"


def _mediana(valores) -> str:
    valores = [v for v in valores if v is not None]
    return f"{statistics.median(valores):.0f}" if valores else "—"


def _num(valor) -> str:
    if valor is None:
        return "—"
    return f"{valor:.0f}" if float(valor).is_integer() else f"{valor:.1f}"


def intentos(medicion: dict, conjunto: str, tarea: str | None = None) -> list[dict]:
    return [d for t, m in medicion.items() if tarea in (None, t) for tanda in m[conjunto] for d in tanda.values()]


def tablas(medicion: dict) -> str:
    lineas = [
        "## Por tarea (páginas y caminos: media por tanda)", "",
        ("| Tarea | Tandas A/B | Éxitos A | Éxitos B | B sin contexto | B conoce tema | Páginas A | Páginas B"
        " | Páginas A×2 | B no en A×2 | A×2 no en B | Caminos A | Caminos B | Caminos A×2 | B no en A×2"
        " | s/acción A | s/acción B | Rechazos B |"),
        "|---|" + "---|" * 17,
    ]
    for tarea, m in medicion.items():
        a, b = intentos(medicion, "A", tarea), intentos(medicion, "B", tarea)
        p, c = m["paginas"], m["caminos"]
        lineas.append(
            f"| {tarea} | {len(m['A'])}/{len(m['B'])} | {_exitos(a)} | {_exitos(b)} | "
            f"{_exitos(b, lambda d: d['nivel'] == 'sin_contexto')} | {_exitos(b, lambda d: d['nivel'] == 'conoce_tema')} | "
            f"{_num(p['A'])} | {_num(p['B'])} | {_num(p['A_x2'])} | {_num(p['B_menos_A_x2'])} | "
            f"{_num(p['A_x2_menos_B'])} | {_num(c['A'])} | {_num(c['B'])} | {_num(c['A_x2'])} | "
            f"{_num(c['B_menos_A_x2'])} | {_mediana(d['s_por_accion'] for d in a)} | "
            f"{_mediana(d['s_por_accion'] for d in b)} | {sum(d['rechazos'] for d in b)} |"
        )

    todos_a, todos_b = intentos(medicion, "A"), intentos(medicion, "B")
    suma = lambda grupo, campo: sum(m[grupo][campo] or 0 for m in medicion.values())
    tandas_a = sum(len(m["A"]) for m in medicion.values())
    tandas_b = sum(len(m["B"]) for m in medicion.values())
    lineas += [
        "", "## Total", "",
        "| | A (4 exploradores) | B (8 exploradores con nivel) | A×2 (8 sin nivel: dos tandas de A) |",
        "|---|---|---|---|",
        f"| Tareas · tandas | {len(medicion)} · {tandas_a} | {len(medicion)} · {tandas_b} | |",
        f"| Éxitos | {_exitos(todos_a)} | {_exitos(todos_b)} | |",
        (f"| Páginas distintas (suma por tarea, media por tanda) | {_num(suma('paginas', 'A'))} | "
        f"{_num(suma('paginas', 'B'))} | {_num(suma('paginas', 'A_x2'))} |"),
        (f"| Páginas que el otro grupo no vio (vs A×2) | | {_num(suma('paginas', 'B_menos_A_x2'))} | "
        f"{_num(suma('paginas', 'A_x2_menos_B'))} |"),
        (f"| Caminos distintos a la respuesta (suma, media por tanda) | {_num(suma('caminos', 'A'))} | "
        f"{_num(suma('caminos', 'B'))} | {_num(suma('caminos', 'A_x2'))} |"),
        (f"| Caminos que el otro grupo no hizo (vs A×2) | | {_num(suma('caminos', 'B_menos_A_x2'))} | "
        f"{_num(suma('caminos', 'A_x2_menos_B'))} |"),
        (f"| Pasos por explorador (mediana) | {_mediana(d['pasos'] for d in todos_a)} | "
        f"{_mediana(d['pasos'] for d in todos_b)} | |"),
        (f"| Segundos por explorador (mediana) | {_mediana(d['segundos'] for d in todos_a)} | "
        f"{_mediana(d['segundos'] for d in todos_b)} | |"),
        (f"| Segundos por acción (mediana) | {_mediana(d['s_por_accion'] for d in todos_a)} | "
        f"{_mediana(d['s_por_accion'] for d in todos_b)} | |"),
        (f"| Cortes por límite | {sum(d['fin'] in ('time_limit', 'step_limit') for d in todos_a)} | "
        f"{sum(d['fin'] in ('time_limit', 'step_limit') for d in todos_b)} | |"),
        (f"| Errores (interrumpidos) | {sum(d['resultado'] == 'interrupted' for d in todos_a)} | "
        f"{sum(d['resultado'] == 'interrupted' for d in todos_b)} | |"),
        f"| Escrituras rechazadas (sin contexto) | | {sum(d['rechazos'] for d in todos_b)} | |",
        (f"| Costo equivalente de los usuarios, por tanda (USD, media) | "
        f"{sum(d['costo_usd'] for d in todos_a) / max(tandas_a, 1):.3f} | "
        f"{sum(d['costo_usd'] for d in todos_b) / max(tandas_b, 1):.3f} | |"),
    ]

    lineas += ["", "## Éxitos por lugar de partida y nivel (todas las tandas)", "",
               "| Lugar | A | B sin contexto | B conoce tema |", "|---|---|---|---|"]
    for lugar in LUGARES:
        lineas.append(
            f"| {lugar} | {_exitos(todos_a, lambda d, lu=lugar: d['lugar'] == lu)} | "
            f"{_exitos(todos_b, lambda d, lu=lugar: d['lugar'] == lu and d['nivel'] == 'sin_contexto')} | "
            f"{_exitos(todos_b, lambda d, lu=lugar: d['lugar'] == lu and d['nivel'] == 'conoce_tema')} |"
        )
    lineas.append(f"| total | {_exitos(todos_a)} | {_exitos(todos_b, lambda d: d['nivel'] == 'sin_contexto')} | "
                  f"{_exitos(todos_b, lambda d: d['nivel'] == 'conoce_tema')} |")

    lineas += ["", "## Dentro de B: qué aporta cada nivel (media por tanda)", "",
               ("| Tarea | Páginas B por tanda | Páginas solo sin contexto | Páginas solo conoce tema"
               " | Caminos solo sin contexto | Caminos solo conoce tema |"), "|---|---|---|---|---|---|"]
    for tarea, m in medicion.items():
        lineas.append(f"| {tarea} | {' / '.join(map(str, m['paginas']['B_repeticiones']))} | "
                      f"{_num(m['paginas']['solo_sin_contexto'])} | {_num(m['paginas']['solo_conoce_tema'])} | "
                      f"{_num(m['caminos']['solo_sin_contexto'])} | {_num(m['caminos']['solo_conoce_tema'])} |")

    lineas += ["", "## Dentro de B: lo que solo encontró cada explorador (suma de las tareas, media por tanda)", "",
               "| Explorador | Páginas únicas | Caminos únicos | Éxitos |", "|---|---|---|---|"]
    for perfil in sorted({p for m in medicion.values() for p in m["unicos_en_B"]}):
        paginas = sum(m["unicos_en_B"].get(perfil, {}).get("paginas", 0) for m in medicion.values())
        cams = sum(m["unicos_en_B"].get(perfil, {}).get("caminos", 0) for m in medicion.values())
        exitos = _exitos([d for m in medicion.values() for x in m["B"] for p, d in x.items() if p == perfil])
        lineas.append(f"| {perfil} | {_num(paginas)} | {_num(cams)} | {exitos} |")
    return "\n".join(lineas)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--runs", type=Path, default=RAIZ / "agents" / ".runs")
    parser.add_argument("--reps", type=int, default=2, help="cuántas tandas (las más nuevas) de cada conjunto")
    parser.add_argument("--json", type=Path, default=None, help="guarda la medición completa en este archivo")
    args = parser.parse_args()
    medicion = medir(leer_tandas(args.runs, args.reps), args.reps)
    if not medicion:
        sys.exit(f"no hay tareas con tandas base y conocimiento en {args.runs}")
    print(tablas(medicion))
    if args.json:
        args.json.write_text(json.dumps(medicion, ensure_ascii=False, indent=2, default=sorted), encoding="utf-8")


if __name__ == "__main__":
    main()
