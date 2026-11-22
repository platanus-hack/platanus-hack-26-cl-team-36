"""Backend de disco: la clave es la ruta relativa a la raíz."""

import os
import tempfile
from collections.abc import Iterable
from pathlib import Path

from shared.store.backend import Backend, workdir_files
from shared.store.keys import RunKey


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

    def _publish_file(self, key: str, path: Path) -> None:
        target = self.root / key
        if path.resolve() == target.resolve():
            return
        if path.is_file():
            self._put(key, path.read_bytes())
        else:
            target.unlink(missing_ok=True)

    def _put(self, key: str, data: bytes) -> None:
        temporary = self._temporary(key, data)
        os.replace(temporary, self.root / key)

    def _create(self, key: str, data: bytes) -> bool:
        # Un enlace duro falla si la clave ya existe: el archivo aparece completo o no aparece.
        temporary = self._temporary(key, data)
        try:
            os.link(temporary, self.root / key)
        except FileExistsError:
            return False
        finally:
            temporary.unlink()
        return True

    def _temporary(self, key: str, data: bytes) -> Path:
        """`data` en un archivo oculto junto a la clave, para reemplazarla de una vez."""
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        with os.fdopen(descriptor, "wb") as file:
            file.write(data)
        return Path(name)

    def _get(self, key: str) -> bytes:
        return (self.root / key).read_bytes()

    def _exists(self, key: str) -> bool:
        return (self.root / key).is_file()

    def _children(self, folder: str) -> Iterable[str]:
        path = self.root / folder
        return [child.name for child in path.iterdir() if child.is_dir()] if path.is_dir() else []
