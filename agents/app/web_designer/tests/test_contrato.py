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
from test_kit import kit_derivado

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
    atajo, lanzador, buscador = kit_derivado()
    atajo["datos"][0]["nombre"] = "q[inicio]"
    atajo["opciones"].pop("invertir")
    atajo["opciones"]["fijos"] = {f"k{i}": "x" for i in range(6)}
    atajo["opciones"]["destino"] = "/" + "a" * 199
    lanzador["rutas"] = ["/" + "b" * 199]
    lanzador["datos"][0]["titulo"] = {"es": "ñ" * 160, "en": "😀" * 160}
    buscador["datos"] = [{**buscador["datos"][0], "enlace": f"/t{i}", "grupo": {"es": "Viaje", "en": "Trip"},
                          "palabras": {"es": [f"p{j}" for j in range(tema_json.MAX_PALABRAS)], "en": []}}
                         for i in range(tema_json.MAX_ITEMS["buscador"])]
    buscador["opciones"].update(sugeridas=40, agrupar=True, teclas=True)
    return [atajo, lanzador, buscador]


@pytest.mark.parametrize("vistas", [kit_derivado, _casos_limite], ids=["metro", "casos-limite"])
def test_lo_que_arma_el_improver_pasa_entero(vistas):
    tema, descartes = tema_json.armar("metro", vistas())
    assert descartes == [] and [v["componente"] for v in tema["features"]["vista"]] == ["atajo", "lanzador", "buscador"]
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
        lambda v: v[2]["datos"][0].update(palabras={"es": ["p"] * (tema_json.MAX_PALABRAS + 1)}),
        lambda v: v[2]["datos"][0].update(palabras=["ruta"]),
        lambda v: v[2]["datos"].extend([v[2]["datos"][0]] * tema_json.MAX_ITEMS["buscador"]),
        lambda v: v[2]["opciones"].update(teclas="si"),
        lambda v: v[2]["opciones"].update(textos={"es": {"subtitulo": "x"}}),
    ]


def test_claves_como_proto_valen_igual_en_los_dos():
    atajo, lanzador, _ = kit_derivado()
    atajo["opciones"]["fijos"] = {"__proto__": "x", "constructor": "y"}
    tema, descartes = tema_json.armar("metro", [atajo, lanzador])
    assert descartes == [] and sanear_en_js([tema]) == [{"features": tema["features"], "rechazos": []}]


def test_lo_que_descarta_uno_lo_descarta_el_otro():
    casos = []
    for mutar in _mutaciones():
        vistas = kit_derivado()
        mutar(vistas)
        casos.append(vistas)
    saneados = sanear_en_js([{"features": {"vista": vistas}} for vistas in casos])
    for vistas, saneado in zip(casos, saneados):
        tema, descartes = tema_json.armar("metro", copy.deepcopy(vistas))
        assert descartes and saneado["rechazos"], vistas
        assert saneado["features"].get("vista", []) == tema["features"]["vista"]
        assert len(saneado["rechazos"]) == len(descartes)
