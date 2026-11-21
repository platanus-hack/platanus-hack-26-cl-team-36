// 05 Perfiles: la huella radial de un perfil, cinco ejes de 0 a 100 y el promedio en gris.

import { svg } from "./dom.js";

export const EJES = [
  { clave: "exito", nombre: "éxito" },
  { clave: "eficiencia", nombre: "eficiencia" },
  { clave: "adherencia", nombre: "adherencia" },
  { clave: "sinTropiezos", nombre: "sin tropiezos" },
  { clave: "recuperacion", nombre: "recuperación" },
];

const C = { x: 110, y: 112 };
const R = 80;

function punto(i, valor) {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / EJES.length;
  const r = (R * Math.max(0, Math.min(100, valor ?? 0))) / 100;
  return [C.x + r * Math.cos(a), C.y + r * Math.sin(a)];
}

const poligono = (valores) => valores.map((v, i) => punto(i, v).map((n) => n.toFixed(1)).join(",")).join(" ");

export function dibujarHuella(nombre, metricas, promedio, color) {
  const valores = EJES.map((eje) => metricas[eje.clave]);
  const descripcion = EJES.map((eje, i) => `${eje.nombre} ${valores[i] ?? "sin dato"}`).join(", ");
  const etiquetas = EJES.map((eje, i) => {
    const [x, y] = punto(i, 122);
    const ancla = Math.abs(x - C.x) < 4 ? "middle" : x > C.x ? "start" : "end";
    return svg("text", { x, y: y + 4, "text-anchor": ancla, texto: eje.nombre });
  });
  return svg(
    "svg",
    { role: "img", "aria-label": `Huella de ${nombre}: ${descripcion}`, width: 300, height: 230, viewBox: "-60 0 340 230" },
    svg("polygon", { points: poligono(EJES.map(() => 100)), fill: "none", stroke: "#2C2C31" }),
    svg("polygon", { points: poligono(EJES.map(() => 50)), fill: "none", stroke: "#232327" }),
    svg(
      "g",
      { stroke: "#232327" },
      EJES.map((_, i) => {
        const [x, y] = punto(i, 100);
        return svg("line", { x1: C.x, y1: C.y, x2: x, y2: y });
      }),
    ),
    svg("polygon", { points: poligono(EJES.map((eje) => promedio[eje.clave])), fill: "none", stroke: "#8C8C94", "stroke-dasharray": "3 4" }),
    svg("polygon", { class: "dato", points: poligono(valores), fill: color, "fill-opacity": 0.18, stroke: color, "stroke-width": 2 }),
    svg("g", { "font-family": "JetBrains Mono, monospace", "font-size": 10, fill: "#A0A0A8" }, etiquetas),
  );
}
