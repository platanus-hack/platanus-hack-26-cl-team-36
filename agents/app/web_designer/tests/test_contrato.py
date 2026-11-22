"""Contrato con la extensión: lo que arma `tema_json.armar()` pasa por `sanearTema` (extension/src/background/
tema-remoto.js) sin rechazos y con las mismas vistas, y lo que uno descarta el otro también. Corre el JS con `node`;
sin `node` en el PATH se salta."""

import copy
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from disenador import tema_json
from test_kit import _vistas_derivadas

TEMA_REMOTO = Path(__file__).parents[4] / "extension" / "src" / "background" / "tema-remoto.js"
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="sin node no se puede correr tema-remoto.js")

_SANEAR = """
import { sanearTema } from %s;
let entrada = "";
for await (const parte of process.stdin) entrada += parte;
console.log(JSON.stringify(JSON.parse(entrada).map(sanearTema)));
"""


def sanear_en_js(temas: list) -> list[dict]:
    script = _SANEAR % json.dumps(TEMA_REMOTO.as_uri())
    salida = subprocess.run([NODE, "--input-type=module", "-e", script], input=json.dumps(temas), text=True,
                            capture_output=True, check=True, timeout=30)
    return json.loads(salida.stdout)


def _casos_limite() -> list[dict]:
    atajo, lanzador = _vistas_derivadas()
    atajo["datos"][0]["nombre"] = "q[inicio]"
    atajo["opciones"].pop("invertir")
    atajo["opciones"]["fijos"] = {f"k{i}": "x" for i in range(6)}
    atajo["opciones"]["destino"] = "/" + "a" * 199
    lanzador["rutas"] = ["/" + "b" * 199]
    lanzador["datos"][0]["titulo"] = {"es": "ñ" * 160, "en": "😀" * 160}
    return [atajo, lanzador]


@pytest.mark.parametrize("vistas", [_vistas_derivadas, _casos_limite], ids=["metro", "casos-limite"])
def test_lo_que_arma_el_improver_pasa_entero(vistas):
    tema, descartes = tema_json.armar("metro", vistas())
    assert descartes == [] and len(tema["features"]["vista"]) == 2
    [saneado] = sanear_en_js([tema])
    assert saneado == {"features": tema["features"], "rechazos": []}


def _mutaciones() -> list:
    return [
        lambda v: v[1]["datos"][0].update(enlace="//evil.com/x"),
        lambda v: v[1]["datos"][0].update(enlace="/a b"),
        lambda v: v[1]["datos"][0].update(enlace="/x\n"),
        lambda v: v[1]["datos"][0].update(imagen="/logo.png"),
        lambda v: v[1]["datos"][0].update(titulo={"es": "x" * 161, "en": "y"}),
        lambda v: v[0].update(id="planificar\n"),
        lambda v: v[0].update(componente="cartelera"),
        lambda v: v[0].update(items="li"),
        lambda v: v[0]["datos"][0].update(nombre="a b"),
        lambda v: v[0]["opciones"].update(destino="/" + "a" * 200),
        lambda v: v[0]["opciones"].update(fijos={f"k{i}": "x" for i in range(7)}),
        lambda v: v[0]["opciones"].update(invertir=["inicio", "otro"]),
        lambda v: v[1]["opciones"].update(max=13),
        lambda v: v[1].update(rutas=[]),
        lambda v: v.append(copy.deepcopy(v[1])),
    ]


def test_claves_como_proto_valen_igual_en_los_dos():
    atajo, lanzador = _vistas_derivadas()
    atajo["opciones"]["fijos"] = {"__proto__": "x", "constructor": "y"}
    tema, descartes = tema_json.armar("metro", [atajo, lanzador])
    assert descartes == [] and sanear_en_js([tema]) == [{"features": tema["features"], "rechazos": []}]


def test_lo_que_descarta_uno_lo_descarta_el_otro():
    casos = []
    for mutar in _mutaciones():
        vistas = _vistas_derivadas()
        mutar(vistas)
        casos.append(vistas)
    saneados = sanear_en_js([{"features": {"vista": vistas}} for vistas in casos])
    for vistas, saneado in zip(casos, saneados):
        tema, descartes = tema_json.armar("metro", copy.deepcopy(vistas))
        assert descartes and saneado["rechazos"], vistas
        assert saneado["features"].get("vista", []) == tema["features"]["vista"]
        assert len(saneado["rechazos"]) == len(descartes)
