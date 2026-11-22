"""Escritura de una migración en el almacén, como una corrida más."""

import shutil

from legacy_runs.scan import Migration
from shared import store
from shared.store.manifest import MANIFEST


def existing_status(backend: store.Backend, migration: Migration) -> store.Status | None:
    """El estado de la corrida que ya ocupa el id de esta migración, o None si está libre."""
    if not backend.exists(migration.run.file(MANIFEST)):
        return None
    return store.read_manifest(backend, migration.run).status


def migrate(backend: store.Backend, migration: Migration) -> store.RunKey:
    """Copia los archivos a una corrida nueva con los instantes de la antigua; la fuente no se toca."""
    run = store.start_run(backend, migration.prefix, model=migration.model, clock=lambda: migration.started)
    for file in migration.files:
        target = run.workdir / file.profile / file.name if file.profile else run.workdir / file.name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file.path, target)
    store.finish_run(backend, run, migration.status, clock=lambda: migration.finished)
    return run.key
