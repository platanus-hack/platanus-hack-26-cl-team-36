"""Región de AWS del entorno; el proyecto vive en us-east-2."""

import os


def region() -> str:
    return os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-2"
