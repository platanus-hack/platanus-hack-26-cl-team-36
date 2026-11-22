import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  azarConSemilla,
  colorCiclico,
  estadoDelAnillo3D,
  estadoEn3D,
  ONDAS_3D,
  PAUSA_ENTRE_ONDAS_3D,
  POR_ONDA_3D,
  planEn3D,
  radioDelFrente,
  BORRADO_3D,
  COLORES_PLATANO,
  ONDAS,
  PAUSA_ENTRE_ONDAS,
  POR_ONDA,
  planDeLaExplosion,
  quietoDelPlatano,
  puntosEnLaVentana,
  vueloDelPlatano,
} from "../portada/platanos.js";

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), "utf8");
const plan = (opciones = {}) => planDeLaExplosion({ alcance: 1000, azar: azarConSemilla(26), ...opciones });

test("los colores de los plátanos son paradas del degradado del símbolo de la marca", () => {
  const simbolo = leer("../../docs/marca/chameleonmode-v1/assets/symbol-color.svg").toUpperCase();
  for (const color of COLORES_PLATANO) assert.ok(simbolo.includes(color), color);
});

test("la explosión: ondas de plátanos, cada una un anillo de un color, más lejos y más tarde que la anterior", () => {
  const { platanos, anillos } = plan();
  assert.equal(platanos.length, ONDAS * POR_ONDA);
  assert.equal(anillos.length, ONDAS);
  // La primera onda es lima (la cola del camaleón) y la última rosada (la punta).
  assert.equal(anillos[0].color, COLORES_PLATANO[0]);
  assert.equal(anillos.at(-1).color, COLORES_PLATANO.at(-1));
  for (let onda = 1; onda < ONDAS; onda++) {
    assert.ok(anillos[onda].radio > anillos[onda - 1].radio, "cada onda llega más lejos");
    assert.equal(anillos[onda].retraso - anillos[onda - 1].retraso, PAUSA_ENTRE_ONDAS);
  }
  // La última onda llega al alcance pedido.
  assert.equal(anillos.at(-1).radio, 1000);
  for (const platano of platanos) {
    const anillo = anillos[platano.onda];
    assert.equal(platano.color, anillo.color);
    assert.ok(platano.retraso >= anillo.retraso && platano.retraso <= anillo.retraso + 60);
  }
});

test("cada onda reparte sus plátanos alrededor de todo el logo, no hacia un solo lado", () => {
  const { platanos } = plan();
  for (let onda = 0; onda < ONDAS; onda++) {
    const cuadrantes = new Set(
      platanos
        .filter((platano) => platano.onda === onda)
        .map((platano) => Math.floor((((platano.angulo % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2))),
    );
    assert.equal(cuadrantes.size, 4, `onda ${onda}`);
  }
});

// Una ventana de 1200 × 800 con el origen abajo a la derecha (como «Platanus Hack 26» en el pie), medido desde el
// centro de la ventana y con y hacia abajo.
const VENTANA = { ancho: 1200, alto: 800, origen: { x: 420, y: 370 } };

/** Cuántos puntos caen en cada celda de una grilla de 4 × 4 sobre la ventana (los que se salen no cuentan). */
function porCelda(puntos, { ancho, alto } = VENTANA) {
  const cuentas = Array(16).fill(0);
  for (const { x, y } of puntos) {
    const [col, fila] = [Math.floor(((x + ancho / 2) / ancho) * 4), Math.floor(((y + alto / 2) / alto) * 4)];
    if (col >= 0 && col < 4 && fila >= 0 && fila < 4) cuentas[fila * 4 + col]++;
  }
  return cuentas;
}

test("los destinos se reparten parejo por toda la ventana y van del más cercano al origen al más lejano", () => {
  const puntos = puntosEnLaVentana(720, VENTANA, azarConSemilla(26));
  assert.equal(puntos.length, 720);
  // Un margen de 4 % por lado deja que algunos lleguen justo al borde.
  for (const { x, y } of puntos) assert.ok(Math.abs(x) <= 600 * 1.08 + 1e-9 && Math.abs(y) <= 400 * 1.08 + 1e-9);
  // Parejo: cada dieciseisavo de la ventana recibe cerca de 1/16 de los plátanos, también arriba a la derecha.
  for (const cuenta of porCelda(puntos)) assert.ok(cuenta > 30 && cuenta < 60, `${cuenta}`);
  // En orden de distancia (con algo de azar): el primer décimo está cerca del origen y el último, lejos.
  const media = (lista) => lista.reduce((suma, punto) => suma + punto.lejos, 0) / lista.length;
  assert.ok(media(puntos.slice(0, 72)) < media(puntos.slice(-72)) / 3);
});

test("en 2D, con la ventana, cada onda va un poco más lejos y entre todas cubren la pantalla entera", () => {
  const { platanos, anillos } = plan({ ventana: VENTANA });
  assert.equal(platanos.length, ONDAS * POR_ONDA);
  for (let onda = 1; onda < ONDAS; onda++) assert.ok(anillos[onda].radio > anillos[onda - 1].radio);
  const destinos = platanos.map((p) => ({
    x: VENTANA.origen.x + Math.cos(p.angulo) * p.distancia,
    y: VENTANA.origen.y + Math.sin(p.angulo) * p.distancia,
  }));
  // Con 60 plátanos, cada cuarto de la ventana (2 × 2) recibe los suyos, arriba a la derecha incluido.
  const cuartos = [0, 0, 0, 0];
  for (const { x, y } of destinos) cuartos[(y < 0 ? 0 : 2) + (x < 0 ? 0 : 1)]++;
  for (const cuarto of cuartos) assert.ok(cuarto >= 10, `${cuartos}`);
});

test("en 3D, con la ventana, los plátanos terminan a la vista y repartidos por toda la pantalla, corregidos por la perspectiva", () => {
  // En unidades del mundo, como en la portada: con la cámara a 12, un píxel mide ~0,0125 y la perspectiva pesa (los que
  // se acercan a quien mira se verían hasta 1,5 veces más lejos del centro).
  const [camara, porPixel] = [12, 0.0125];
  const ventana = {
    ancho: VENTANA.ancho * porPixel,
    alto: VENTANA.alto * porPixel,
    origen: { x: VENTANA.origen.x * porPixel, y: VENTANA.origen.y * porPixel },
    camara,
  };
  const plan3d = planEn3D({ tamano: 44 * porPixel, ventana, azar: azarConSemilla(26) });
  // Dónde se ve cada plátano al final de su vida: su posición en el mundo proyectada sobre el plano del origen.
  const enPantalla = plan3d.platanos.map((p) => {
    const fin = estadoEn3D({ ...p, vida: 1000, retraso: 0 }, 999.999);
    const proyectar = camara / (camara - fin.z);
    return { x: (ventana.origen.x + fin.x) * proyectar, y: (ventana.origen.y + fin.y) * proyectar };
  });
  const cuentas = porCelda(enPantalla, ventana);
  const total = cuentas.reduce((a, b) => a + b, 0);
  // Todos menos los del margen de 4 % por lado (~1/1,08² quedan dentro).
  assert.ok(total > plan3d.platanos.length * 0.82, `a la vista: ${total}`);
  for (const cuenta of cuentas) assert.ok(cuenta > 25, `${cuentas}`);
  // La columna de la derecha (donde está el origen) recibe su cuarto, no casi nada.
  const derecha = [3, 7, 11, 15].reduce((suma, i) => suma + cuentas[i], 0);
  assert.ok(derecha > total / 5, `derecha: ${derecha} de ${total}`);
});

test("con la misma semilla la explosión es la misma; con otra, cambia", () => {
  assert.deepEqual(plan(), plan());
  assert.notDeepEqual(plan(), plan({ azar: azarConSemilla(27) }));
});

test("sin alcance (o con uno ridículo) los plátanos igual salen a una distancia que se ve", () => {
  for (const alcance of [undefined, 0, -5, "nada"]) {
    assert.equal(planDeLaExplosion({ alcance, azar: azarConSemilla(1) }).anillos.at(-1).radio, 120);
  }
});

test("el vuelo: sale del logo, ondula a lo ancho, termina en su distancia y desvanecido", () => {
  const platano = { ...plan().platanos[3], angulo: 0, distancia: 500, amplitud: 20, fase: 0, vueltas: 2, giro: 360 };
  const cuadros = vueloDelPlatano(platano, 24);
  assert.equal(cuadros.length, 25);
  assert.equal(cuadros[0].offset, 0);
  assert.equal(cuadros.at(-1).offset, 1);
  const posicion = (cuadro) => cuadro.transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/).slice(1).map(Number);
  assert.deepEqual(posicion(cuadros[0]), [0, 0]);
  assert.deepEqual(posicion(cuadros.at(-1)), [500, 0]);
  assert.equal(cuadros[0].opacity, 0);
  assert.equal(cuadros.at(-1).opacity, 0);
  // Hacia la derecha (ángulo 0), la ondulación va en y: hacia ambos lados del camino.
  const lados = cuadros.map((cuadro) => posicion(cuadro)[1]);
  assert.ok(Math.max(...lados) > 3 && Math.min(...lados) < -3, "ondula de lado a lado");
  // Siempre avanza hacia afuera.
  const avances = cuadros.map((cuadro) => posicion(cuadro)[0]);
  assert.ok(avances.every((x, i) => i === 0 || x >= avances[i - 1]));
});

test("con prefers-reduced-motion el plátano no viaja ni gira: aparece y se desvanece en su lugar", () => {
  const cuadros = quietoDelPlatano(plan().platanos[0]);
  assert.equal(new Set(cuadros.map((cuadro) => cuadro.transform)).size, 1);
  assert.doesNotMatch(cuadros[0].transform, /rotate/);
  assert.deepEqual(cuadros.map((cuadro) => cuadro.opacity), [0, 1, 0]);
});

test("en la portada, «Platanus Hack 26» del pie es el botón del huevo de pascua; el logo de la barra es solo el logo", () => {
  const html = leer("../portada/index.html");
  assert.match(
    html,
    /<p><span data-i18n="pie\.antes">chameleonmode\.app · Made at<\/span> <button type="button" class="huevo" aria-label="Platanus Hack 26: [^"]+" data-i18n-aria-label="huevo">Platanus Hack 26<\/button><span data-i18n="pie\.despues">, Santiago<\/span><\/p>/,
  );
  assert.match(html, /<a class="marca" href="\/"[^>]*><img src="\/logo\.svg"[^>]*><\/a>\s*<nav/);
  assert.doesNotMatch(html, /marca-simbolo|marca-con-huevo/);
  assert.match(html, /<script type="module" src="\/huevo-de-pascua\.js"><\/script>/);
  const entrada = leer("../portada/huevo-de-pascua.js");
  assert.match(entrada, /document\.querySelector\("\.huevo"\)/);
  assert.match(entrada, /cobrarVida\(boton\);\s*lanzarPlatanos\(boton\);/);
  assert.match(entrada, /precargarPlatanos\(\)/);
  assert.match(entrada, /prefers-reduced-motion: reduce/);
  const css = leer("../portada/estilos.css");
  // Con aspecto de texto (hereda la letra y el color del pie), y sin JavaScript es solo texto.
  assert.match(css, /\.huevo \{[^}]*border: 0;[^}]*background: none;[^}]*color: inherit; font: inherit;/);
  assert.match(css, /\.sin-js \.huevo \{ cursor: text; pointer-events: none; \}/);
  assert.match(css, /\.platanos-lienzo \{[^}]*position: fixed;[^}]*pointer-events: none;/);
  assert.doesNotMatch(css, /marca-simbolo|marca-con-huevo/);
  // Sin estilos en línea ni dependencias de afuera: la política de seguridad solo admite lo propio.
  for (const archivo of ["platanos.js", "platanos-3d.js", "huevo-de-pascua.js"]) {
    const fuente = leer(`../portada/${archivo}`);
    assert.doesNotMatch(fuente, /innerHTML|setAttribute\("style"|from "https?:/, archivo);
  }
  // Holograma: sombreadores propios, una malla de aristas sin diagonales, y la ola descarta lo que ya pasó.
  const tresD = leer("../portada/platanos-3d.js");
  assert.match(tresD, /ShaderMaterial/);
  assert.match(tresD, /aVuelta/);
  assert.match(tresD, /if \(borrado\(detras\)\) discard;/);
  // three.js, el mismo que sirve el backoffice desde public/vendor (versión exacta), y solo se carga al usarlo.
  assert.match(tresD, /from "\/backoffice\/vendor\/three@0\.160\.0\/three\.module\.js"/);
  assert.ok(existsSync(new URL("../public/vendor/three@0.160.0/three.module.js", import.meta.url)));
  const platanos = leer("../portada/platanos.js");
  assert.match(platanos, /import\("\.\/platanos-3d\.js"\)/);
  assert.doesNotMatch(platanos, /^import .*three/m);
  assert.match(platanos, /prefers-reduced-motion: reduce/);
});

test("las letras de «Platanus Hack 26» recorren el degradado del logo, cada una desde un color distinto", async () => {
  const { coloresDeLaLetra } = await import("../portada/huevo-de-pascua.js");
  const n = 16;
  for (let i = 0; i < n; i++) {
    const colores = coloresDeLaLetra(i, n);
    assert.equal(colores.length, COLORES_PLATANO.length);
    assert.deepEqual([...colores].sort(), [...COLORES_PLATANO].sort(), "todos los colores del logo");
  }
  assert.equal(coloresDeLaLetra(0, n)[0], COLORES_PLATANO[0]);
  assert.notEqual(coloresDeLaLetra(0, n)[0], coloresDeLaLetra(n / 2, n)[0], "la ola avanza por el degradado");
});

test("en 3D: muchos más plátanos, en ondas que salen una tras otra y llegan cada vez más lejos", () => {
  const plan3d = planEn3D({ alcance: 20, tamano: 0.4, azar: azarConSemilla(26) });
  assert.equal(plan3d.platanos.length, ONDAS_3D * POR_ONDA_3D);
  assert.ok(plan3d.platanos.length >= 500, "cientos de plátanos");
  assert.equal(plan3d.anillos.length, ONDAS_3D);
  for (let onda = 1; onda < ONDAS_3D; onda++) {
    assert.ok(plan3d.anillos[onda].radio > plan3d.anillos[onda - 1].radio);
    assert.equal(plan3d.anillos[onda].retraso - plan3d.anillos[onda - 1].retraso, PAUSA_ENTRE_ONDAS_3D);
  }
  // La última onda pasa de la esquina más lejana (el alcance) y sus plátanos más lejanos también.
  assert.ok(Math.abs(plan3d.anillos.at(-1).radio - 24) < 1e-9);
  assert.ok(Math.max(...plan3d.platanos.map((p) => p.distancia)) > 20, "algunos llegan al otro lado");
  // La explosión dura hasta que terminó el último plátano y pasó la ola que borra.
  const fin = Math.max(...plan3d.platanos.map((p) => p.retraso + p.vida), BORRADO_3D.inicio + BORRADO_3D.duracion);
  assert.ok(plan3d.duracion >= fin && plan3d.duracion - fin < 100);
  assert.deepEqual(plan3d.borrado, BORRADO_3D);
  // Cada eje de giro es unitario y la mayoría sale hacia quien mira.
  for (const p of plan3d.platanos) assert.ok(Math.abs(Math.hypot(...p.eje) - 1) < 1e-9);
  const haciaAdelante = plan3d.platanos.filter((p) => p.elevacion > 0).length;
  assert.ok(haciaAdelante > plan3d.platanos.length / 2);
  assert.deepEqual(planEn3D({ alcance: 20, azar: azarConSemilla(26) }), planEn3D({ alcance: 20, azar: azarConSemilla(26) }));
});

test("en 3D cada plátano sale del logo, ondula en hélice, se acerca o se aleja y se encoge al final", () => {
  const base = planEn3D({ alcance: 20, tamano: 0.4, azar: azarConSemilla(3) }).platanos[0];
  const platano = { ...base, retraso: 100, vida: 2000, angulo: 0, elevacion: 0.5, caida: 0 };
  assert.equal(estadoEn3D(platano, 50), null, "todavía no sale");
  assert.equal(estadoEn3D(platano, 2101), null, "ya terminó");
  const inicio = estadoEn3D(platano, 100);
  assert.deepEqual([inicio.x, inicio.y, inicio.escala], [0, 0, 0]);
  const fin = estadoEn3D(platano, 2100);
  assert.ok(Math.abs(fin.x - platano.distancia) < 1e-9, "llega a su distancia en el plano");
  // No se desvanece por el camino (lo borra la ola): a 90 % de su vida sigue de su tamaño.
  assert.equal(estadoEn3D(platano, 100 + 2000 * 0.9).escala, platano.escala);
  assert.ok(Math.abs(fin.z - Math.sin(0.5) * platano.profundidad) < 1e-9, "y a su profundidad, hacia quien mira");
  assert.equal(fin.escala, 0);
  // A mitad de camino ondula a ambos lados del camino (en y, porque va hacia la derecha).
  const lados = Array.from({ length: 40 }, (_, i) => estadoEn3D(platano, 100 + i * 25).y);
  assert.ok(Math.max(...lados) > 0.01 && Math.min(...lados) < -0.01);
  // Gira sobre sí mismo.
  assert.notEqual(estadoEn3D(platano, 1100).angulo, 0);
  const anillo = planEn3D({ alcance: 20, azar: azarConSemilla(3) }).anillos[2];
  assert.equal(estadoDelAnillo3D(anillo, anillo.retraso - 1), null);
  assert.ok(estadoDelAnillo3D(anillo, anillo.retraso + 600).radio < anillo.radio);
});

test("la ola que borra sale del logo cuando los plátanos ya se repartieron y llega hasta el final", () => {
  const borrado = { inicio: 1000, duracion: 2000 };
  assert.equal(radioDelFrente(999, borrado, 500), null, "todavía no sale");
  assert.equal(radioDelFrente(1000, borrado, 500), 0, "sale desde el logo");
  assert.equal(radioDelFrente(2000, borrado, 500), 250, "a mitad de tiempo, a mitad de camino");
  assert.equal(radioDelFrente(3000, borrado, 500), 500);
  assert.equal(radioDelFrente(9000, borrado, 500), 500, "y se queda pasada la esquina");
  const radios = Array.from({ length: 21 }, (_, i) => radioDelFrente(1000 + i * 100, borrado, 500));
  assert.ok(radios.every((r, i) => i === 0 || r >= radios[i - 1]), "nunca retrocede");
  // Sale cuando la primera onda ya se repartió, y la explosión dura hasta que pasa.
  assert.ok(BORRADO_3D.inicio > 1000);
});

test("los plátanos cambian de color recorriendo el degradado del logo, y vuelven al lima", () => {
  const hex = (rgb) => "#" + rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, "0").toUpperCase()).join("");
  COLORES_PLATANO.forEach((color, i) => assert.equal(hex(colorCiclico(i / COLORES_PLATANO.length)), color));
  assert.equal(hex(colorCiclico(1)), COLORES_PLATANO[0]);
  assert.equal(hex(colorCiclico(-1 / COLORES_PLATANO.length)), COLORES_PLATANO.at(-1));
  // Entre dos paradas, un color intermedio.
  const medio = colorCiclico(0.5 / COLORES_PLATANO.length);
  const [a, b] = [colorCiclico(0), colorCiclico(1 / COLORES_PLATANO.length)];
  medio.forEach((c, k) => assert.ok(c >= Math.min(a[k], b[k]) - 1e-9 && c <= Math.max(a[k], b[k]) + 1e-9));
});

test("los módulos del huevo de pascua no tienen errores de sintaxis (sus sombreadores incluidos)", () => {
  // node --check solo analiza: el import absoluto de three.js resuelve en el navegador, no aquí.
  for (const archivo of ["platanos.js", "platanos-3d.js", "huevo-de-pascua.js"]) {
    execFileSync(process.execPath, ["--check", fileURLToPath(new URL(`../portada/${archivo}`, import.meta.url))]);
  }
});
