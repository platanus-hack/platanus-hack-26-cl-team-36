# Backoffice v0

Visor de solo lectura de las corridas del evaluador (`agents/.runs/`). Es la v0 de
[la especificación del backoffice](../.specs/backoffice-v0.md): dibuja las pantallas 01 Corridas, 03 Telaraña,
04 Replay y 05 Perfiles del Claude Design. No gatilla nada ni llama a Claude.

## Cómo se usa

```bash
just local backoffice        # o: npm run backoffice, desde la raíz
```

Abre <http://localhost:4848>. Sin dependencias: solo Node 22 o superior. Para tener algo que ver, primero hay que
correr el evaluador, por ejemplo `just local validate wom` o `just local explore <url> "<tarea>"`; la corrida aparece
al recargar.

| Variable | Por defecto | Qué cambia |
|---|---|---|
| `PORT` | `4848` | Puerto del servidor. Escucha solo en `127.0.0.1`. |
| `BACKOFFICE_CORRIDAS` | `agents/.runs` | Carpeta de las corridas. |

## Pantallas

| Pantalla | Qué muestra | De dónde sale |
|---|---|---|
| **01 Corridas** | Una tarjeta por tanda con la captura de inicio, el sitio, intentos y éxito. Búsqueda y filtro por sitio. El formulario para gatillar se ve, deshabilitado. | `route_tree.json` y el `start.screenshot` del primer `run.json` |
| **03 Telaraña** | El inicio al centro y un anillo por paso. La **ruta recomendada** es el eje hacia la derecha; las demás rutas salen como ramas. Grosor = intentos, color = cómo terminaron. Filtro por perfil, clic en una página para ver quién pasó por ella, y dónde se separa cada intento de la ruta. | `nodes`, `branches` y `recommended_route` de `route_tree.json` |
| **04 Replay** | Un intento paso a paso: la captura con el punto del clic (o la de después, o el video si existe), la acción, lo que esperaba, lo que pasó y qué hacía la ruta recomendada desde esa página. Cierra con el criterio y el veredicto del juez. Flechas ← → para avanzar. | `<perfil>/run.json`, `step_NN.png`, `video.webm` y `criteria.json` |
| **05 Perfiles** | Por perfil y tramo de la ruta recomendada, qué parte sigue en el camino y dónde se separa. Una huella radial por perfil y la tabla con las cifras. | `run.json` de cada perfil y `route_tree.json` |

Inventario (02) y Propuestas (06) aparecen en el menú pero deshabilitadas: las etapas que las alimentan no existen.

## Decisiones de la v0

- **Ruta recomendada, no happy path.** Mientras no exista el agente que lee el DOM (etapa 03), el eje es
  `recommended_route`, la ruta de menor costo entre las que hicieron los usuarios. Se rotula así en todas partes.
- **Estado de un paso.** El evaluador guarda la expectativa pero no la compara con el resultado. Un paso es
  *sin efecto* si trae `no_effect`, *no cumplido* con `went_back` o `visible_error`, y *sin evaluar* en el resto.
- **Métricas de perfil.** Éxito: intentos logrados según el juez. Eficiencia: pasos de la ruta recomendada sobre
  pasos reales, en los intentos logrados. Adherencia: intentos que siguen la ruta completa. Sin tropiezos: pasos que no
  son *no cumplido* ni *sin efecto* (reemplaza a "expectativas cumplidas" del diseño hasta que el juez evalúe cada paso).
  Recuperación: intentos desviados que vuelven a la ruta.
- **Telaraña plana en SVG.** La especificación pide que se vea y se mueva como una escena de three.js; la v0 es la
  versión plana que la especificación acepta como primer paso, con cámara básica (arrastrar, Ctrl o ⌘ + rueda para
  acercar, viaje animado al elegir una página) y partículas en las ramas. Los datos (`/api/tandas/<id>`) ya traen lo
  que necesita la versión 3D.
- **Un nodo = URL normalizada + título**, igual que `route_tree.py`. `lib/url.js` replica `normalize_url` para ubicar
  cada paso en su nodo y elegir la captura de cada página.

## Seguridad

Las corridas muestran páginas de terceros y a veces datos de quien corrió la prueba. Por eso el servidor escucha solo
en `127.0.0.1`, sirve únicamente `step_NN.png` y `video.webm` de tandas que existen (no `run.json` ni rutas fuera de
la carpeta), manda una política de seguridad estricta, y la página arma todo con nodos de texto: nada de lo que viene
de una corrida se interpreta como HTML.

## Estructura

```
backoffice/
├── servidor.js        ← node:http: la página, /api/tandas, /api/tandas/<tarea>/<fecha-hora> y /archivos/…
├── lib/
│   ├── tandas.js      ← lee agents/.runs/
│   ├── derivar.js     ← lógica pura: anillos, estados, KPIs, métricas por perfil
│   └── url.js         ← normalize_url de route_tree.py, en JavaScript
├── public/            ← la página: app.js (pantallas y rutas), telarana.js, huella.js, dom.js, estilos.css
└── test/              ← node:test, con una tanda sintética en fixtures/
```

`npm test` (o `npm run check` desde la raíz) corre las pruebas. El `route_tree.json` del fixture lo generó
`build_route_tree` del evaluador; si cambia su formato, hay que regenerarlo.
