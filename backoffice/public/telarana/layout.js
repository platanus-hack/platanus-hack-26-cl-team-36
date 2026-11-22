// Telaraña radial: el inicio al centro, un anillo por paso desde el inicio y la ruta recomendada como un rayo hacia
// la derecha (ángulo 0). Cada página recibe su anillo y su ángulo al aparecer y no los cambia después, así una
// página nueva nunca mueve las que ya están. Puro: node:test lo importa.

export const PASO = 150; // px entre anillos
export const ESPACIO = 104; // px mínimos entre dos páginas del mismo anillo
export const LIMITE = Math.PI * 0.94; // las páginas no cruzan el eje de atrás del inicio

export const radio = (anillo) => Math.max(0, anillo) * PASO;
export const acotar = (v, a, b) => Math.max(a, Math.min(b, v));
const salida3 = (t) => 1 - Math.pow(1 - t, 3);
const suave = (t) => t * t * (3 - 2 * t);

/**
 * El primer ángulo libre desde `deseado`, en pasos de sep/4, a sep o más de los ocupados. Con `dir` busca hacia un
 * solo lado; con `lado`, hacia los dos sin cruzar el eje de la ruta.
 */
export function hueco(deseado, ocupados, sep, dir = 0, lado = 0) {
  for (let k = 0; k <= 200; k++) {
    const salto = (k * sep) / 4;
    for (const a of dir ? [deseado + dir * salto] : [deseado + lado * salto, deseado - lado * salto]) {
      if (Math.abs(a) > LIMITE || (lado && k < 120 && a * lado < sep * 0.5)) continue;
      if (ocupados.every((o) => Math.abs(o - a) >= sep * 0.999)) return a;
    }
  }
  return deseado;
}

/**
 * Anillo y ángulo de una página fuera de la ruta descubierta desde `desde`: el anillo siguiente, del mismo lado del
 * eje que su origen (las que salen del eje se reparten alternando lados por anillo).
 * @param {Iterable<{ term: string | null, anillo: number, ang: number }>} nodos
 * @param {Map<number, number>} lados   cuántas salieron del eje en cada anillo (se actualiza)
 */
export function ubicarFuera(nodos, lados, desde) {
  const anillo = desde.term ? 1 : desde.anillo + 1;
  const sep = ESPACIO / radio(anillo);
  const ocupados = [];
  for (const n of nodos) if (!n.term && n.anillo === anillo) ocupados.push(n.ang);
  let lado = Math.abs(desde.ang) > 1e-6 ? Math.sign(desde.ang) : 0;
  if (!lado) {
    const cuenta = lados.get(anillo) ?? 0;
    lados.set(anillo, cuenta + 1);
    lado = cuenta % 2 ? 1 : -1;
  }
  const deseado = Math.abs(desde.ang) > 1e-6 ? desde.ang : lado * sep;
  return { anillo, ang: hueco(deseado, ocupados, sep, 0, lado) };
}

/** Ángulo de un final en el anillo exterior: el logrado sobre el eje; los demás cerca de donde se terminó. */
export function ubicarFinal(nodos, anilloFinal, exito, desde) {
  if (exito) return 0;
  const sep = ESPACIO / radio(anilloFinal);
  let deseado = acotar(desde?.ang ?? 0, -0.5, 0.5);
  if (deseado > -sep / 2) deseado = Math.max(deseado, 2.5 * sep);
  const ocupados = [];
  for (const n of nodos) if (n.term) ocupados.push(n.ang);
  return hueco(deseado, ocupados, sep, 1);
}

/** "av" avanza un anillo o más, "ret" vuelve, "mismo" queda en el anillo y "final" llega a un final. */
export function formaDeTramo(a, b, atras) {
  if (b.term) return "final";
  if (atras || b.anillo < a.anillo) return "ret";
  return b.anillo === a.anillo ? "mismo" : "av";
}

/** Cuánto se abre la curva de una vuelta atrás; las vueltas de un mismo lado se abren cada vez más. */
export function ladeoDeVuelta(vueltas, a, b) {
  const medio = (a.ang + b.ang) / 2;
  const lado = Math.abs(medio) > 1e-6 ? Math.sign(medio) : -1;
  const k = Math.min(3, vueltas[lado]++);
  return lado * Math.min(0.6, (0.55 * PASO) / Math.max(radio(a.anillo), radio(b.anillo), PASO)) * (1 + 0.3 * k);
}

/**
 * Punto `t` (0…1) de un tramo en polares: radio y ángulo se interpolan entre A y B ({ r, a, anillo } en el cuadro
 * actual). Escribe en `fuera` para no crear objetos por cuadro.
 */
export function puntoDeTramo(A, B, forma, ladeo, t, fuera) {
  const ta = A.r < 1 ? B.a : A.a;
  const tb = B.r < 1 ? ta : B.a;
  const d = tb - ta;
  const seno = Math.sin(Math.PI * t);
  let r = A.r + (B.r - A.r) * t;
  let an;
  if (forma === "ret") {
    r += PASO * (A.anillo === B.anillo ? 0.5 : 0.22) * seno;
    an = ta + d * t + ladeo * seno;
  } else if (forma === "mismo") {
    r += PASO * 0.3 * seno;
    an = ta + d * t;
  } else an = ta + d * (forma === "final" ? salida3(t) : suave(t));
  fuera.x = r * Math.cos(an);
  fuera.y = r * Math.sin(an);
  return fuera;
}

/** Cuántos segmentos necesita un tramo para verse curvo sin gastar vértices de más. */
export function segmentosDeTramo(A, B, forma) {
  const largo = Math.abs(B.a - A.a) * Math.max(A.r, B.r) + Math.abs(B.r - A.r) + (forma === "av" || forma === "final" ? 0 : PASO);
  return acotar(Math.ceil(largo / 7), 6, 160);
}
