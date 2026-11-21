"""summary.md: totales del sitio, una fila por objetivo evaluado y los que quedaron sin evaluar."""


def _cell(value) -> str:
    return "—" if value is None or value == "" else str(value).replace("|", "\\|").replace("\n", " ")


def _row_line(row: dict) -> str:
    guide = f"{row['min_steps']} ({row['routes_tried']} rutas)" if row["min_steps"] is not None else row["route_status"]
    runs = "; ".join(f"{run['profile']}: {run['outcome']}, {run['steps']} pasos" for run in row["runs"])
    efficiency = "; ".join(f"{run['efficiency']:.2f}" for run in row["runs"] if run["efficiency"] is not None)
    fewer = row["fewer"] + (f" (propuesta {row['proposal']})" if row["proposal"] else "") if row["fewer"] else None
    cells = [f"`{row['id']}` {row['description']}", row["level"], row["intent"], row["prominence"], row["complexity"],
             guide, runs, efficiency, fewer, f"[reporte]({row['report']})" if row["report"] else None]
    return "| " + " | ".join(_cell(cell) for cell in cells) + " |"


def summary_markdown(host: str, rows: list[dict], total: dict) -> str:
    rate = f"{total['successes']}/{total['runs']}" + (f" ({total['success_rate']:.0%})" if total["runs"] else "")
    spl = f"{total['spl']:.2f}" if total["spl"] is not None else "—"
    lines = [
        f"# Resumen de {host}",
        "",
        f"- Objetivos: {total['goals']} · con ruta: {total['mapped']} · verificadas: {total['verified']}"
        f" · evaluados: {total['evaluated']}",
        f"- Intentos con éxito: {rate} · SPL: {spl}",
        f"- Intentos con menos pasos que la referencia: {total['beat_reference']} · propuestas: {total['proposals']}",
        "",
        "| Objetivo | Nivel | Intención | Prominencia | Complejidad | Guía (pasos mínimos) | Visitante | Eficiencia"
        " | Menos pasos | Reporte |",
        "|---|---|---|---|---|---|---|---|---|---|",
        *(_row_line(row) for row in rows if row["not_run"] is None),
    ]
    skipped = [row for row in rows if row["not_run"]]
    if skipped:
        lines += ["", "## Sin evaluar", "", "| Objetivo | Motivo |", "|---|---|",
                  *(f"| `{row['id']}` {_cell(row['description'])} | {row['not_run']} |" for row in skipped)]
    return "\n".join(lines) + "\n"
