"""El `tema.json` del kit: las vistas de `features.vista` que monta la extensión, validadas contra un esquema.

El esquema es un subconjunto de JSON Schema (type, properties, required, additionalProperties, pattern, maxLength,
minLength, items, minItems, maxItems, maxProperties, propertyNames, minimum, maximum, enum, anyOf) que valida
`_errores`. Solo admite los componentes `atajo`, `lanzador` y `buscador`, enlaces relativos del mismo sitio y nada que cargue
recursos (sin `imagen`). Lo que no valida se descarta con su razón: un item malo deja la vista sin ese item, una vista
mala no entra. `sanearTema` (`extension/src/background/tema-remoto.js`) es su espejo exacto: mismos esquemas,
patrones y topes. Si cambian aquí, cambian allá (lo vigila `tests/test_contrato.py`).
"""

import re

COMPONENTES = ("atajo", "lanzador", "buscador")
MAX_VISTAS = 6
MAX_PALABRAS = 12

_TEXTO_CORTO = {"type": "string", "maxLength": 160}
# El español es obligatorio; el inglés, solo si alguien lo tradujo: sin él, la extensión muestra el español.
TEXTO = {"type": "object", "properties": {"es": _TEXTO_CORTO, "en": _TEXTO_CORTO}, "required": ["es"],
         "additionalProperties": False}
# Una ruta del mismo sitio: empieza con una sola `/` (no `//host` ni `/\host`), sin barras invertidas, espacios ni
# controles (el parser de URLs borra tabs y saltos: `/\t/host` quedaría `//host`). Los espacios van explícitos y no
# como `\s`, que no es el mismo conjunto en Python y en JS.
RUTA = {"type": "string", "maxLength": 200,
        "pattern": r"^/(?![/\\])[^\\\x00-\x20\x7f-\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$"}
SELECTOR = {"type": "string", "minLength": 1, "maxLength": 200}
ID = {"type": "string", "pattern": r"^[a-z][a-z0-9-]{0,39}$"}
_NOMBRE_PARAMETRO = {"type": "string", "pattern": r"^[A-Za-z0-9_.\[\]-]{1,40}$"}
_VALOR = {"type": "string", "maxLength": 100}


def _textos(claves: tuple[str, ...]) -> dict:
    por_idioma = {"type": "object", "properties": {c: _TEXTO_CORTO for c in claves}, "additionalProperties": False}
    return {"type": "object", "properties": {"es": por_idioma, "en": por_idioma}, "additionalProperties": False}


ITEM = {
    "atajo": {
        "type": "object",
        "properties": {
            "nombre": _NOMBRE_PARAMETRO,
            "etiqueta": TEXTO,
            "opciones": SELECTOR,
            "valores": {"type": "array", "minItems": 1, "maxItems": 60, "items": {
                "type": "object", "properties": {"valor": _VALOR, "texto": TEXTO}, "required": ["valor", "texto"],
                "additionalProperties": False}},
            "valor": _VALOR,
            "requerido": {"type": "boolean"},
        },
        "required": ["nombre", "etiqueta"],
        "anyOf": [{"required": ["opciones"]}, {"required": ["valores"]}],
        "additionalProperties": False,
    },
    "lanzador": {
        "type": "object",
        "properties": {"titulo": TEXTO, "detalle": TEXTO, "insignia": TEXTO, "enlace": RUTA},
        "required": ["titulo", "enlace"],
        "additionalProperties": False,
    },
}
ITEM["buscador"] = {
    "type": "object",
    "properties": {
        "titulo": TEXTO, "detalle": TEXTO, "grupo": TEXTO, "enlace": RUTA,
        "palabras": {"type": "object", "properties": {
            idioma: {"type": "array", "maxItems": MAX_PALABRAS, "items": _TEXTO_CORTO} for idioma in ("es", "en")},
            "additionalProperties": False},
    },
    "required": ["titulo", "enlace"],
    "additionalProperties": False,
}
# El buscador abarca el catálogo del sitio, no solo lo destacado.
MAX_ITEMS = {"atajo": 8, "lanzador": 12, "buscador": 40}

OPCIONES = {
    "atajo": {
        "type": "object",
        "properties": {
            "destino": RUTA,
            "fijos": {"type": "object", "maxProperties": 6, "propertyNames": _NOMBRE_PARAMETRO,
                      "additionalProperties": _VALOR},
            "invertir": {"type": "array", "minItems": 2, "maxItems": 2, "items": _NOMBRE_PARAMETRO},
            "textos": _textos(("titulo", "subtitulo", "boton", "invertir", "elegir")),
        },
        "required": ["destino"],
        "additionalProperties": False,
    },
    "lanzador": {
        "type": "object",
        "properties": {"max": {"type": "integer", "minimum": 1, "maximum": 12},
                       "textos": _textos(("titulo", "subtitulo"))},
        "additionalProperties": False,
    },
}
OPCIONES["buscador"] = {
    "type": "object",
    "properties": {
        "max": {"type": "integer", "minimum": 1, "maximum": 12},
        "sugeridas": {"type": "integer", "minimum": 1, "maximum": MAX_ITEMS["buscador"]},
        "agrupar": {"type": "boolean"},
        "teclas": {"type": "boolean"},
        "textos": _textos(("boton", "titulo", "campo", "sugerencias", "sin-resultados", "sin-resultados-ayuda",
                           "cerrar", "mover", "abrir", "atajo", "atajo-mac")),
    },
    "additionalProperties": False,
}


def esquema_vista(componente: str) -> dict:
    return {
        "type": "object",
        "properties": {
            "id": ID,
            "rutas": {"type": "array", "minItems": 1, "maxItems": 10, "items": RUTA},
            "contenedor": SELECTOR,
            "reemplazar": {"type": "boolean"},
            "componente": {"enum": list(COMPONENTES)},
            "datos": {"type": "array", "minItems": 1, "maxItems": MAX_ITEMS[componente], "items": ITEM[componente]},
            "opciones": OPCIONES[componente],
        },
        "required": ["id", "contenedor", "componente", "datos", "opciones"],
        "additionalProperties": False,
    }


_TIPOS = {"object": dict, "array": list, "string": str, "boolean": bool, "integer": int}


def _errores(valor, esquema: dict, ruta: str = "$") -> list[str]:
    """Los errores de `valor` contra `esquema`, con la ruta JSON de cada uno; vacío si valida."""
    if "enum" in esquema and valor not in esquema["enum"]:
        return [f"{ruta}: {valor!r} no está entre {esquema['enum']}"]
    tipo = esquema.get("type")
    if tipo and (not isinstance(valor, _TIPOS[tipo]) or (tipo == "integer" and isinstance(valor, bool))):
        return [f"{ruta}: se esperaba {tipo}"]
    errores = []
    if isinstance(valor, str):
        if len(valor) > esquema.get("maxLength", len(valor)) or len(valor) < esquema.get("minLength", 0):
            errores.append(f"{ruta}: largo {len(valor)} fuera de rango")
        if "pattern" in esquema and not re.fullmatch(esquema["pattern"], valor):
            errores.append(f"{ruta}: {valor[:60]!r} no cumple {esquema['pattern']}")
    if isinstance(valor, int) and not isinstance(valor, bool):
        if not esquema.get("minimum", valor) <= valor <= esquema.get("maximum", valor):
            errores.append(f"{ruta}: {valor} fuera de rango")
    if isinstance(valor, list):
        if not esquema.get("minItems", 0) <= len(valor) <= esquema.get("maxItems", len(valor)):
            errores.append(f"{ruta}: {len(valor)} elementos fuera de rango")
        for i, item in enumerate(valor):
            errores += _errores(item, esquema.get("items", {}), f"{ruta}[{i}]")
    if isinstance(valor, dict):
        propiedades = esquema.get("properties", {})
        extra = esquema.get("additionalProperties", True)
        errores += [f"{ruta}: falta {clave}" for clave in esquema.get("required", []) if clave not in valor]
        if len(valor) > esquema.get("maxProperties", len(valor)):
            errores.append(f"{ruta}: demasiadas claves")
        for clave, sub in valor.items():
            if "propertyNames" in esquema:
                errores += _errores(clave, esquema["propertyNames"], f"{ruta}.{clave}")
            if clave in propiedades:
                errores += _errores(sub, propiedades[clave], f"{ruta}.{clave}")
            elif extra is False:
                errores.append(f"{ruta}: clave no permitida {clave!r}")
            elif isinstance(extra, dict):
                errores += _errores(sub, extra, f"{ruta}.{clave}")
    if "anyOf" in esquema and all(_errores(valor, alternativa, ruta) for alternativa in esquema["anyOf"]):
        errores.append(f"{ruta}: no cumple ninguna alternativa")
    return errores


def validar_vista(vista) -> tuple[dict | None, list[str]]:
    """La vista con solo sus items válidos, o None; y las razones de lo descartado."""
    componente = vista.get("componente") if isinstance(vista, dict) else None
    if componente not in COMPONENTES:
        return None, [f"componente no permitido: {componente!r}"]
    vista = dict(vista)
    descartes = []
    if isinstance(vista.get("datos"), list):
        datos = []
        for i, item in enumerate(vista["datos"]):
            errores = _errores(item, ITEM[componente], f"datos[{i}]")
            if errores:
                descartes.append(f"vista {vista.get('id')!r}, item descartado: {errores[0]}")
            else:
                datos.append(item)
        vista["datos"] = datos
    errores = _errores(vista, esquema_vista(componente))
    if componente == "atajo" and not errores:
        nombres = {campo["nombre"] for campo in vista["datos"]}
        errores = [f"$.opciones.invertir: {n!r} no es un campo" for n in vista["opciones"].get("invertir", [])
                   if n not in nombres]
    if errores:
        return None, descartes + [f"vista {vista.get('id')!r} descartada: {errores[0]}"]
    return vista, descartes


def armar(nombre: str, vistas: list[dict]) -> tuple[dict, list[str]]:
    """El tema.json con las vistas válidas (sin ids repetidos, hasta `MAX_VISTAS`) y por qué se descartó lo demás."""
    validas, descartes, ids = [], [], set()
    for vista in vistas:
        limpia, razones = validar_vista(vista)
        descartes += razones
        if limpia is None:
            continue
        if limpia["id"] in ids or len(validas) >= MAX_VISTAS:
            descartes.append(f"vista {limpia['id']!r} descartada: repetida o sobre el máximo de {MAX_VISTAS}")
            continue
        ids.add(limpia["id"])
        validas.append(limpia)
    return {"nombre": nombre[:80], "features": {"vista": validas}}, descartes


def _limpio(texto) -> str:
    return " ".join(str(texto or "").split())[:_TEXTO_CORTO["maxLength"]]


def _par(es, en) -> dict | None:
    """El texto por idioma, o None sin español; sin inglés, solo el español (nunca una copia)."""
    es, en = _limpio(es), _limpio(en)
    return ({"es": es, "en": en} if en else {"es": es}) if es else None


MAX_TAREAS_PROPUESTAS = 40


def tareas_propuestas(propuestas) -> dict[str, dict]:
    """Las tareas que escribió el modelo, por `enlace`, de todos los componentes: una tarea del lanzador que también
    está en el buscador se escribe una vez."""
    tareas: dict[str, dict] = {}
    for propuesta in propuestas or []:
        lista = propuesta.get("tareas") if isinstance(propuesta, dict) else None
        for tarea in (lista if isinstance(lista, list) else [])[:MAX_TAREAS_PROPUESTAS]:
            if isinstance(tarea, dict) and isinstance(tarea.get("enlace"), str):
                tareas.setdefault(tarea["enlace"], tarea)
    return tareas


def _sin_ingles(texto) -> bool:
    return isinstance(texto, dict) and (not texto.get("en") or texto.get("en") == texto.get("es"))


def sin_traduccion(vistas: list[dict]) -> list[dict]:
    """Los textos que quedaron sin inglés o con el español copiado (el modelo no los tradujo)."""
    faltan = []
    for vista in vistas:
        textos = (vista.get("opciones") or {}).get("textos") or {}
        if copiados := sorted(c for c, t in (textos.get("es") or {}).items() if (textos.get("en") or {}).get(c, t) == t):
            faltan.append({"vista": vista.get("id"), "item": "textos", "textos": copiados})
        for item in vista.get("datos") or []:
            claves = ("etiqueta",) if vista.get("componente") == "atajo" else ("titulo", "detalle")
            textos = [c for c in claves if _sin_ingles(item.get(c))]
            if textos:
                faltan.append({"vista": vista.get("id"), "item": item.get("enlace") or item.get("nombre"),
                               "textos": textos})
    return faltan


def con_propuesta(vista: dict, propuesta: dict | None, tareas: dict[str, dict] | None = None) -> dict:
    """La vista con la microcopia y el ancla que propuso el modelo; lo vacío o desconocido deja lo derivado.
    `tareas`: las de todos los componentes por enlace (`tareas_propuestas`); sin ellas, solo las de `propuesta`."""
    if not isinstance(propuesta, dict):
        propuesta = {}
    vista = {**vista, "opciones": dict(vista["opciones"]), "datos": [dict(item) for item in vista["datos"]]}
    if str(propuesta.get("contenedor") or "").strip():
        vista["contenedor"] = propuesta["contenedor"].strip()
    claves = {"atajo": ("titulo", "subtitulo", "boton"), "buscador": ("titulo", "boton")}.get(vista["componente"],
                                                                                         ("titulo", "subtitulo"))
    entrada = propuesta.get("textos") if isinstance(propuesta.get("textos"), dict) else {}
    textos = {}
    for idioma in ("es", "en"):
        por_idioma = entrada.get(idioma) if isinstance(entrada.get(idioma), dict) else {}
        elegidos = {c: _limpio(por_idioma.get(c)) for c in claves}
        if elegidos := {c: t for c, t in elegidos.items() if t}:
            textos[idioma] = elegidos
    if textos:
        vista["opciones"]["textos"] = textos
    if vista["componente"] == "atajo":
        etiquetas = {e.get("nombre"): _par(e.get("es"), e.get("en"))
                     for e in propuesta.get("etiquetas") or [] if isinstance(e, dict)}
        for campo in vista["datos"]:
            campo["etiqueta"] = etiquetas.get(campo["nombre"]) or campo["etiqueta"]
    else:
        tareas = tareas_propuestas([propuesta]) if tareas is None else tareas
        for item in vista["datos"]:
            tarea = tareas.get(item["enlace"]) or {}
            item["titulo"] = _par(tarea.get("titulo_es"), tarea.get("titulo_en")) or item["titulo"]
            if detalle := _par(tarea.get("detalle_es"), tarea.get("detalle_en")):
                item["detalle"] = detalle
    return vista
