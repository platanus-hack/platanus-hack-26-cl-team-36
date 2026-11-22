// Modelo de la franja de goals de la hoja (nucleo/marco-tanda.js). Puro: no toca document ni window, así node:test lo
// importa. Trabaja sobre la tarjeta del Overview de la revisión (GET /api/tarjetas/<revision>): un goal por celda, con
// el mismo medidor que la tarjeta (overview/tarjetas.js), y la celda elegida es la del goal de la tanda abierta.

import { partesDeTanda } from "../nucleo/almacen.js";
import { estadoDeTarjeta, medidorDeGoal } from "../overview/tarjetas.js";

/**
 * → { sitio, host, url, estado, goals: [{ n, goal, instruccion, tanda, tramos, texto, tono, elegido, elegible }],
 *     indice } | null. null si no hay tarjeta, si tiene menos de dos goals o si la tanda abierta no es de ninguno de
 * sus goals (entonces la hoja se queda como sin revisión). `elegible`: el goal tiene tanda (se puede abrir).
 */
export function modeloDeFranja(tarjeta, tandaId) {
  const lista = tarjeta?.goals ?? [];
  if (lista.length < 2) return null;
  const goals = lista.map((goal, i) => ({ ...medidorDeGoal(goal), n: i + 1 }));
  const objetivo = partesDeTanda(tandaId)?.objetivo ?? null;
  let indice = goals.findIndex((goal) => goal.tanda === tandaId);
  if (indice === -1 && objetivo) indice = goals.findIndex((goal) => goal.goal === objetivo);
  if (indice === -1) return null;
  return {
    sitio: tarjeta.sitio || tarjeta.host || "",
    host: tarjeta.host ?? null,
    url: tarjeta.url ?? null,
    estado: estadoDeTarjeta(tarjeta.estado),
    goals: goals.map((goal, i) => ({ ...goal, elegido: i === indice, elegible: !!goal.tanda })),
    indice,
  };
}

/**
 * El goal elegible anterior (`paso` -1) o siguiente (+1) al elegido, dando la vuelta; null si no hay otro elegible.
 * → el goal del modelo
 */
export function vecinoDe(modelo, paso) {
  const total = modelo?.goals?.length ?? 0;
  for (let salto = 1; salto < total; salto += 1) {
    const goal = modelo.goals[(modelo.indice + paso * salto + total * salto) % total];
    if (goal.elegible) return goal;
  }
  return null;
}
