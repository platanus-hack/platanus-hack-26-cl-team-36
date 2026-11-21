"""Backend de disco: la clave es la ruta relativa a la raíz."""

from collections.abc import Iterable
from pathlib import Path

from shared.store.backend import Backend, workdir_files
from shared.store.keys import RunKey, RunPrefix


class LocalBackend(Backend):
    def __init__(self, root: Path) -> None:
        self.root = root

    def workdir(self, run: RunKey) -> Path:
        path = self.root / str(run)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def publish(self, run: RunKey, workdir: Path) -> None:
        # La carpeta de trabajo ya es la de la corrida: solo se valida, igual que en S3.
        if workdir.resolve() != (self.root / str(run)).resolve():
            raise ValueError(f"{workdir} no es la carpeta de la corrida {run}")
        workdir_files(run, workdir)

    def _put(self, key: str, data: bytes) -> None:
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def _create(self, key: str, data: bytes) -> bool:
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with path.open("xb") as file:
                file.write(data)
        except FileExistsError:
            return False
        return True

    def _get(self, key: str) -> bytes:
        return (self.root / key).read_bytes()

    def _exists(self, key: str) -> bool:
        return (self.root / key).is_file()

    def _children(self, prefix: RunPrefix) -> Iterable[str]:
        folder = self.root / str(prefix)
        return [path.name for path in folder.iterdir() if path.is_dir()] if folder.is_dir() else []
