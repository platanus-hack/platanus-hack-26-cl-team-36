"""Doble en memoria de las llamadas de boto3 que usa S3Backend."""

import io
from types import SimpleNamespace
from typing import Any


class ClientError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class FakeS3:
    exceptions = SimpleNamespace(ClientError=ClientError)

    def __init__(self, page_size: int = 2) -> None:
        self.objects: dict[tuple[str, str], tuple[bytes, str]] = {}
        self.page_size = page_size

    def put_object(self, Bucket: str, Key: str, Body: bytes, ContentType: str, IfNoneMatch: str | None = None) -> None:
        if IfNoneMatch == "*" and (Bucket, Key) in self.objects:
            raise ClientError("PreconditionFailed")
        self.objects[(Bucket, Key)] = (Body, ContentType)

    def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:
        if (Bucket, Key) not in self.objects:
            raise ClientError("NoSuchKey")
        return {"Body": io.BytesIO(self.objects[(Bucket, Key)][0])}

    def head_object(self, Bucket: str, Key: str) -> dict[str, Any]:
        if (Bucket, Key) not in self.objects:
            raise ClientError("404")
        return {}

    def list_objects_v2(
        self, Bucket: str, Prefix: str, Delimiter: str, ContinuationToken: str | None = None
    ) -> dict[str, Any]:
        prefixes = sorted({
            Prefix + key[len(Prefix):].split(Delimiter)[0] + Delimiter
            for bucket, key in self.objects
            if bucket == Bucket and key.startswith(Prefix) and Delimiter in key[len(Prefix):]
        })
        start = int(ContinuationToken or 0)
        page = prefixes[start:start + self.page_size]
        truncated = start + self.page_size < len(prefixes)
        response: dict[str, Any] = {"CommonPrefixes": [{"Prefix": p} for p in page], "IsTruncated": truncated}
        if truncated:
            response["NextContinuationToken"] = str(start + self.page_size)
        return response
