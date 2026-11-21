"""Rutas candidatas de una tarea y la instrucción que pide una más corta que la mejor conocida."""

from dataclasses import dataclass

from route_tree import node_key

from mapper.explore import Exploration
from mapper.replay import Verification
from mapper.route import Step, totals


@dataclass
class Candidate:
    """Una exploración y, si terminó con respuesta, su verificación."""

    exploration: Exploration
    verification: Verification | None
    cost_usd: float

    @property
    def status(self) -> str:
        if self.verification is None:
            return "not_found"
        return "verified" if self.verification.verified else "unverified"

    @property
    def steps(self) -> list[Step]:
        return self.verification.route if self.verification else []

    @property
    def start(self) -> tuple[str, str, bytes]:
        """URL, título y captura del inicio: los de la repetición si verificó."""
        source = self.verification.replay if self.status == "verified" else self.exploration
        return source.start_url, source.start_title, source.start_screenshot

    @property
    def quote_scrolls(self) -> int:
        replay = self.verification.replay if self.verification else None
        return int(bool(replay and replay.quote_found and not replay.quote_on_screen))

    @property
    def totals(self) -> dict:
        start_url, start_title, _ = self.start
        return totals(self.steps, node_key(start_url, start_title), self.quote_scrolls)

    def beats(self, other: "Candidate") -> bool:
        """Verificada y con menos pasos mínimos; a igualdad, con menos acciones."""
        if self.status != "verified":
            return False
        if other.status != "verified":
            return True
        mine, theirs = self.totals, other.totals
        return (mine["min_steps"], mine["actions"]) < (theirs["min_steps"], theirs["actions"])


def shorter_instruction(instruction: str, best: Candidate) -> str:
    steps = [f"{number}. {step.label} → «{step.title_after}»" for number, step in enumerate(best.steps, 1)]
    return "\n".join([
        instruction,
        "",
        f"Ya hay una ruta verificada de {best.totals['min_steps']} pasos mínimos (cada acción, más un scroll por"
        " elemento fuera de pantalla):",
        *steps,
        "Busca una ruta estrictamente más corta desde la página inicial. Mira en la captura lo que más destaca"
        " (banners, botones grandes de la portada), no solo los nombres de los enlaces: un enlace con un nombre"
        " genérico como «Ver más» puede ser el atajo. La respuesta puede estar en otra página que la de esa ruta."
        " Si no hay una más corta, termina con give_up.",
    ])


def search_record(candidates: list[Candidate], chosen: Candidate) -> dict:
    return {
        "tried": len(candidates),
        "chosen": candidates.index(chosen) + 1,
        "routes": [
            {
                "status": candidate.status,
                "min_steps": candidate.totals["min_steps"] if candidate.status == "verified" else None,
                "actions": len(candidate.steps),
                "cost_usd": round(candidate.cost_usd, 4),
            }
            for candidate in candidates
        ],
    }
