"""Ids del layout anterior: las tareas de `agents/tasks/<id>.json` y las carpetas que no son corridas."""

# Id de la tarea en `agents/tasks/<id>.json` → su objetivo en `agents/tasks/<host>/<goal>.json`.
OLD_TASK_GOALS = {
    "bn-socio-prestamo-domicilio": "socio-prestamo-domicilio",
    "dt-reclamo-despido": "reclamo-despido",
    "ine-fecha-ipc-noviembre": "fecha-ipc-noviembre",
    "metro-tarifa-sabado": "tarifa-sabado",
    "sernac-retracto-compra-online": "retracto-compra-online",
    "sii-exencion-contribuciones": "exencion-contribuciones",
    "uchile-arancel-medicina": "arancel-medicina",
    "wom-baja-fibra": "baja-fibra",
}

NOT_RUNS = {
    "aws": "reportes de just aws explore: solo report.md, sin la tanda",
    "diseno": "corridas del diseñador web, que no van al almacén",
    "archivo": "corridas archivadas a mano",
}
