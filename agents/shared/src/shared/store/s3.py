"""Backend S3: las mismas claves bajo un bucket y un prefijo opcional."""

import shutil
import tempfile
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from shared.store.backend import Backend, workdir_files
from shared.store.keys import RunKey

CONTENT_TYPES = {
    ".json": "application/json",
    ".md": "text/markdown; charset=utf-8",
    ".png": "image/png",
    ".webm": "video/webm",
}
# S3 expira por etiqueta y no por extensión: infra/app/corridas.tf borra los objetos con esta.
VIDEO_TAGGING = "tipo=video"
_TAKEN = {"PreconditionFailed", "ConditionalRequestConflict"}
_MISSING = {"404", "NoSuchKey", "NotFound"}


class MissingBoto3(RuntimeError):
    """El extra `s3` de shared no está instalado."""


def content_type(key: str) -> str:
    return CONTENT_TYPES.get(Path(key).suffix, "application/octet-stream")


def object_args(key: str) -> dict[str, str]:
    """Tipo de contenido y, si es un video, la etiqueta que lo hace expirar."""
    kind = content_type(key)
    return {"ContentType": kind, "Tagging": VIDEO_TAGGING} if kind.startswith("video/") else {"ContentType": kind}


def _error_code(error: Exception) -> str:
    return str(getattr(error, "response", {}).get("Error", {}).get("Code", ""))


class S3Backend(Backend):
    def __init__(self, bucket: str, prefix: str = "", client: Any | None = None) -> None:
        self.bucket = bucket
        self.prefix = f"{prefix.strip('/')}/" if prefix.strip("/") else ""
        self._client = client
        self._workdirs: dict[RunKey, Path] = {}

    @property
    def client(self) -> Any:
        # Se crea al primer uso: credenciales y región salen de la cadena estándar de AWS.
        if self._client is None:
            try:
                import boto3
            except ModuleNotFoundError:
                raise MissingBoto3("un almacén s3:// necesita boto3: instala el extra shared[s3]") from None
            self._client = boto3.client("s3")
        return self._client

    def workdir(self, run: RunKey) -> Path:
        if run not in self._workdirs:
            self._workdirs[run] = Path(tempfile.mkdtemp(prefix=f"{run.run_id}-"))
        return self._workdirs[run]

    def publish(self, run: RunKey, workdir: Path) -> None:
        """Sube la carpeta de trabajo y la borra; es temporal, la corrida queda en S3."""
        for path, key in workdir_files(run, workdir):
            self.client.upload_file(str(path), self.bucket, self.prefix + key, ExtraArgs=object_args(key))
        shutil.rmtree(workdir)
        self._workdirs.pop(run, None)

    def _put(self, key: str, data: bytes, **extra: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=self.prefix + key, Body=data, **object_args(key), **extra)

    def _create(self, key: str, data: bytes) -> bool:
        try:
            self._put(key, data, IfNoneMatch="*")
        except self.client.exceptions.ClientError as error:
            if _error_code(error) in _TAKEN:
                return False
            raise
        return True

    def _get(self, key: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=self.prefix + key)
        return bytes(response["Body"].read())

    def _exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=self.prefix + key)
        except self.client.exceptions.ClientError as error:
            if _error_code(error) in _MISSING:
                return False
            raise
        return True

    def _children(self, folder: str) -> Iterable[str]:
        base = f"{self.prefix}{folder}/"
        request: dict[str, str] = {"Bucket": self.bucket, "Prefix": base, "Delimiter": "/"}
        names: list[str] = []
        while True:
            page = self.client.list_objects_v2(**request)
            names += [entry["Prefix"][len(base):].rstrip("/") for entry in page.get("CommonPrefixes", [])]
            if not page.get("IsTruncated"):
                return names
            request["ContinuationToken"] = page["NextContinuationToken"]
