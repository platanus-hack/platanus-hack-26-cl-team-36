# Backoffice

Visor de solo lectura de las corridas del Visitante en el almacén (`agents/.runs/`). Parte de
[la especificación del backoffice](../.specs/backoffice-v0.md): muestra cada tanda (los intentos de los perfiles
sobre una misma tarea) y responde qué pasó, por dónde fueron y dónde se separaron de la ruta. No gatilla nada ni
llama a Claude. Sin build ni dependencias: Node 22 o superior, `node:http` y módulos ES en el navegador.

## Cómo se usa

```bash
just local backoffice        # o: npm run backoffice, desde la raíz (dentro de backoffice/, npm run dev reinicia el servidor al guardar)
```

Abre <http://localhost:4848>. Para tener algo que ver, primero hay que correr el Visitante, por ejemplo
`just local visit-tasks wom` o `just local visit <url> "<tarea>"`; la tanda aparece al recargar.

| Variable | Por defecto | Qué cambia |
|---|---|---|
| `PORT` | `4848` | Puerto del servidor. Escucha solo en `127.0.0.1`. |
| `BACKOFFICE_CORRIDAS` | `agents/.runs` | Carpeta de las corridas (relativa a donde se lanza el proceso). |
| `BACKOFFICE_FUENTE` | `archivos` | De dónde se leen las corridas. Hoy solo existe `archivos`; otro valor hace fallar el arranque. |
| `BACKOFFICE_HOSTS` | (vacío) | Valores extra aceptados en la cabecera `Host` (con puerto, p. ej. `otro.host:8080`), separados por coma. Por defecto solo `localhost`, `127.0.0.1` y `[::1]`. |

Solo tema oscuro. La tipografía (Inter, JetBrains Mono) viene de Google Fonts.

## Pantallas

**Corridas** (`#/`) lista las tandas, más nuevas primero y agrupadas por día. Cada fila abre la tanda y ya dice su
hallazgo. Búsqueda, filtros, sitio, orden y lista/grilla quedan en la URL.

Una tanda (`#/t/<host>/visitor/<objetivo>/<corrida>/<pestaña>`) tiene un marco común (migas, tanda anterior/siguiente, instrucción,
veredicto) y cuatro pestañas:

| Pestaña | Qué pregunta responde | De dónde sale |
|---|---|---|
| **Resumen** (por defecto) | ¿Llegaron a la respuesta y qué hay que mirar? Abre con el titular y los hallazgos (desvíos, demoras, tropiezos, errores), cada uno con enlace al paso exacto en Replay y Telaraña; luego la ruta, los intentos y el criterio del juez. | `route_tree.json`, cada `<perfil>/run.json` y `criteria.json`, derivados en `lib/` |
| **Telaraña** | ¿Por dónde fueron? Un grafo dirigido de izquierda a derecha: el inicio a la izquierda, la meta (el final de la ruta y las páginas donde alguien encontró la respuesta) a la derecha y las demás páginas en columnas según los pasos desde el inicio, ordenadas para cruzarse lo menos posible y repartidas encima y debajo de la ruta recomendada, que es una fila recta; los tramos son rectas (casi rectas si saltan columnas). Las vueltas atrás y los pasos laterales son arcos bajos, tenues y de un tono neutro, que se encienden al pasar el puntero o elegir una página. Grosor = intentos, color = cómo terminaron. Filtro por perfil (atenúa, no saca), panel por página, marcas donde alguien se trabó, modo historia (un intento recorriendo el mapa) y vista 3D. | `nodes`, `branches` y `recommended_route` de `route_tree.json`, unidos en páginas |
| **Replay** | ¿Qué hizo un intento, paso a paso? A la izquierda los pasos (número, acción y descripción corta) con un selector de intento, al centro la captura del paso, a la derecha su análisis en palabras simples (señales, qué esperaba, qué pasó, dónde quedó y la nota del juez) y abajo una línea de tiempo que se puede reproducir. | `<perfil>/run.json` y `step_NN.png` |
| **Perfiles** | ¿A qué perfil le cuesta más? Resultado por intento, hasta qué hito de la ruta llega cada perfil, métricas por columna y la tabla de intentos ordenable. Toda marca abre el Replay en el paso que corresponde. | `perfiles` y `intentos` de la tanda derivada |

Inventario y Propuestas no existen todavía: el menú solo las anuncia en "Próximamente", junto con cómo gatillar
recorridos desde la terminal.

## Cómo leer las cifras

- **Errores de la herramienta.** Un intento que terminó por `internal_error`, `api_error`, `no_response` o
  `refusal`, sin veredicto del juez o sin página de inicio no es comportamiento del usuario: se marca como error, se
  ve en la lista y en Replay, y queda **fuera** de las cifras, métricas de perfil, hallazgos y quiebres.
- **Páginas fusionadas.** Dos nodos del `route_tree.json` son la misma página si tienen la misma URL sin la consulta
  (`?s=…`) y el mismo título no vacío. El panel de la página lista las variantes de URL unidas. Los nodos sin
  título nunca se unen.
- **Ruta recomendada, no happy path.** El eje es `recommended_route`, la ruta de menor costo entre las que hicieron
  los intentos, y se rotula así en todas partes. El happy path con DOM es de una etapa que aún no existe. Si nadie llegó,
  el eje es el camino más transitado.
- **Llegar no basta.** Si todos llegan pero alguno se demora, tropieza o da más pasos que la ruta, el titular lo dice
  ("Los 3 llegan a la respuesta, pero Apurado tarda 12 pasos (la ruta: 5).") y se marca como dificultad, no como
  éxito limpio. Los pasos en una página cuentan todas las acciones hechas ahí, incluida la que sale: la misma unidad
  que los pasos de un tramo de la ruta.
- **n chico.** Las tasas se muestran como conteo (`2/3`); el porcentaje solo aparece con más de 5 casos. "No aplica"
  es `null` y se dibuja "—" con la razón en un globo: nunca es 0 (por ejemplo, recuperación cuando nadie se desvió).
- **Estado de un paso: estimado.** El juez no evalúa cada paso. *Coincide* es "no" si el paso trae `no_effect`,
  `went_back` o `visible_error`; "sí" si cambió la página o al menos el 5 % de la captura; si no, "incierto".

## Idiomas (es / en)

Español por defecto e inglés. El idioma se elige en el menú lateral o con `idioma=en` en el hash de la URL (`#/?idioma=en`), y se guarda en
`localStorage`. Los datos de la corrida (títulos de páginas, expectativas del agente, justificaciones, criterios)
nunca se traducen.

- Cada texto de la interfaz pasa por `t("<sección>.<clave>", vars)`. Hay un diccionario por sección y por idioma:
  `public/i18n/{es,en}/<sección>.js` (`comun`, `datos` y uno por pantalla). Un valor es un texto con `{variables}` o
  una función `(vars, { plural, fmt }) => texto`.
- `lib/` no arma frases: entrega `{ clave, vars }` y `public/datos/textos.js` las convierte en texto.
- Para agregar una clave: ponerla en `es/<sección>.js` **y** en `en/<sección>.js`, con el mismo árbol.
  `test/diccionarios.test.js` falla si los árboles difieren, si una función devuelve vacío para n = 0, 1, 2 o si una
  pantalla tiene texto visible escrito a mano. Si una función necesita vars que no son números, la sección exporta
  `ejemplos`.

## Teclado

`?` muestra la hoja con los atajos activos en la vista actual. ⌘ en Mac, Ctrl en el resto.

| Dónde | Teclas |
|---|---|
| Siempre | `⌘K` paleta de comandos · `?` atajos · `g c` ir a Corridas · `/` paleta (en Corridas, el buscador) |
| Corridas | `j` `k` fila siguiente / anterior · `v` lista ↔ grilla |
| Tanda | `1`–`4` Resumen, Telaraña, Replay, Perfiles · `[` `]` tanda anterior / siguiente · `c` copiar enlace |
| Resumen | `j` `k` hallazgo siguiente / anterior |
| Telaraña | `+` `-` zoom · `0` ajustar · `p` `Shift+P` perfil · `h` historia (con ella: `Espacio`, `←` `→`) · `v` vista 3D · `Esc` cerrar |
| Replay | `←` `→` paso · `Inicio` `Fin` primer / último paso · `Espacio` reproducir / pausar · `↑` `↓` en la lista de pasos |
| Perfiles | `j` `k` fila · `Enter` abrir en Replay |

## Fuente de corridas

Todo lo que se lee de las corridas pasa por una interfaz chica, `Fuente`, documentada en `lib/fuente.js`:
`descripcion`, `listarIds()`, `listarPerfiles(id)`, `leerJson(id, relativa)`, `existe(id, relativa)` y
`abrirArchivo(id, relativa, rango)`. La única implementación es `lib/fuentes/archivos.js`. La validación (nombres
seguros, ids que la fuente listó, solo capturas y video) vive en `lib/tandas.js`, así que una fuente nunca recibe una
ruta sin validar. `derivar.js` y las pantallas no saben de dónde vienen los datos.

Una fuente S3 (no construida) necesitaría:

- Listar con `ListObjectsV2` y `Delimiter: "/"` (tareas, tandas con `route_tree.json`, perfiles) y leer con
  `GetObject`; `abrirArchivo` con `Range: bytes=a-b` (S3 responde 206 y `ContentRange`, que calza con `rango`).
- Pasar imágenes y video por el servidor, no con URLs prefirmadas: así se mantienen la CSP y la lista de archivos
  permitidos, y el bucket sigue privado.
- Caché en memoria de la tanda derivada (las tandas no cambian una vez escritas), porque `/api/tandas` deriva todas.
- Credenciales por la cadena estándar de AWS, `BACKOFFICE_FUENTE=s3` más bucket, prefijo y región, y registrarla en
  `crearFuente`. Usar el SDK de AWS rompe "sin dependencias": es decisión del equipo.
- Antes de desplegarlo fuera de `127.0.0.1`, autenticación delante.

## Estructura

```
backoffice/
├── servidor.js          ← node:http: la página, /api/tandas, /api/tandas/<host>/visitor/<objetivo>/<corrida> y /archivos/…
├── lib/                 ← lado del servidor, lógica pura salvo la fuente
│   ├── tandas.js        ← lista y lee tandas a través de la fuente; valida todo lo que llega de afuera
│   ├── fuente.js        ← la interfaz Fuente y crearFuente(); fuentes/archivos.js la implementa con node:fs
│   ├── derivar.js       ← de route_tree.json + run.json + criteria.json a la tanda que dibujan las pantallas
│   ├── paginas.js       ← une nodos en páginas y les da un título corto
│   ├── hallazgos.js     ← hallazgos y titulares (clave + vars)
│   └── url.js           ← normalize_url de shared.nodes.urls, en JavaScript
├── public/
│   ├── index.html, app.js   ← arranque: idioma, menú, paleta, atajos globales, enrutador
│   ├── nucleo/          ← enrutador por hash, marco de la tanda, atajos, paleta ⌘K, i18n, formatos, estados, íconos
│   ├── pantallas/       ← una por vista: corridas, resumen, telarana, replay, perfiles
│   ├── corridas/ telarana/ replay/ perfiles/   ← piezas de cada pantalla (las puras se prueban con node:test)
│   ├── datos/textos.js  ← convierte { clave, vars } de la API en texto
│   ├── i18n/{es,en}/    ← diccionarios por sección
│   └── estilos/         ← tokens, base y componentes compartidos; un .css por pantalla, prefijado con .p-<id>
└── test/                ← node:test, con dos tandas sintéticas en fixtures/corridas/
```

Contrato de una pantalla: `public/pantallas/<id>.js` exporta por defecto `{ titulo(ctx), montar(contenedor, ctx),
actualizar?(ctx), desmontar?() }`. El enrutador carga su diccionario antes de `montar`. Si solo cambian los
parámetros de la URL llama a `actualizar(ctx)`, y si esta devuelve `false` vuelve a montar la pestaña. Al salir llama
a `desmontar()`, y los atajos registrados con `ctx.atajos.registrar` se quitan solos. Todo el estado de la vista
vive en el hash, así que cualquier vista se puede compartir copiando el enlace.

## Seguridad

Las corridas muestran páginas de terceros y a veces datos de quien corrió la prueba. Por eso:

- El servidor escucha solo en `127.0.0.1` y solo acepta `GET` y `HEAD`.
- Rechaza (403) toda petición cuya cabecera `Host` no sea `localhost`, `127.0.0.1` o `[::1]` en su puerto, para que
  una página maliciosa no pueda leer las corridas con DNS rebinding (`BACKOFFICE_HOSTS` agrega excepciones).
- De un perfil sirve únicamente `step_NN.png` y `video.webm` (con rangos de bytes, para el video), y solo de tandas
  que la fuente listó: ni `run.json` ni rutas fuera de la carpeta. De `public/` sirve solo
  `.html/.js/.css/.svg/.woff2` con nombres en minúscula.
- Manda una política de seguridad estricta (`script-src 'self'`, sin `unsafe-inline`; solo Google Fonts como
  origen externo), `nosniff`, `no-referrer` y `frame-ancestors 'none'`.
- La página arma todo con nodos de texto: nada de lo que viene de una corrida se interpreta como HTML.

## Pruebas

`npm test` (aquí) o `npm run check` (desde la raíz, con el resto del repo). Prueban la derivación, las páginas
fusionadas, los hallazgos, la fuente (incluida una fuente falsa en memoria), el servidor, los módulos puros de las
pantallas y los diccionarios.

Las tandas de `test/fixtures/corridas/demo.cl/visitor/tarea-demo/` son sintéticas, con la forma de `agents/.runs/`; la
fuente solo lista las corridas cuyo `manifest.json` dice `succeeded`, y el fixture trae una fallida y una en curso. El
layout que lee el backoffice está en `public/nucleo/almacen.js`. Sus
`route_tree.json` los generó `build_route_tree` del Visitante (`agents/app/visitor/visitor/route_tree.py`) a partir de
los `run.json`; si cambia el formato del evaluador, hay que regenerarlos igual.
