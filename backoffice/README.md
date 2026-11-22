# Backoffice

Visor de solo lectura de los agentes y sus corridas en el almacén (`agents/.runs/`). Parte de
[la especificación del backoffice](../.specs/backoffice-v0.md): el inicio (Overview) muestra cuántos agentes
corrieron por rol y cómo les fue, y las revisiones con la página revisada; cada tanda (los intentos de los perfiles
sobre una misma tarea) responde qué pasó, por dónde fueron y dónde se separaron de la ruta. No gatilla nada ni llama a
Claude. Sin build: Node 22 o superior, `node:http` y módulos ES en el navegador; el SDK de AWS solo para leer de AWS.

## Cómo se usa

```bash
just local backoffice        # o: npm run backoffice, desde la raíz (dentro de backoffice/, npm run dev reinicia el servidor al guardar)
```

Abre <http://localhost:4848/backoffice/>. Para tener algo que ver, primero hay que correr el Visitante, por ejemplo
`just local visit-tasks wom` o `just local visit <url> "<tarea>"`; la tanda aparece al recargar.

| Variable | Por defecto | Qué cambia |
|---|---|---|
| `PORT` | `4848` | Puerto del servidor. |
| `BACKOFFICE_ESCUCHA` | `127.0.0.1` | Dirección en la que escucha. `0.0.0.0` lo abre a la red: solo en el contenedor de AWS. |
| `BACKOFFICE_CORRIDAS` | `agents/.runs` | Carpeta de las corridas (relativa a donde se lanza el proceso). |
| `BACKOFFICE_FUENTE` | `archivos` | De dónde se leen las corridas: `archivos` o `s3` (ver "Contra AWS"); otro valor hace fallar el arranque. |
| `BACKOFFICE_ALMACEN` | (vacío) | Con `s3`: el almacén, `s3://<bucket>/<prefijo>` (el bucket es `chameleon-almacen-<account_id>`). |
| `BACKOFFICE_TABLA` | `chameleon-revisiones` | Con `s3`: la tabla DynamoDB de las revisiones. |
| `AWS_PROFILE`, `AWS_REGION` | región `us-east-2` | Con `s3`: credenciales por la cadena estándar de AWS. |
| `BACKOFFICE_HOSTS` | (vacío) | Valores extra aceptados en la cabecera `Host` (con puerto, p. ej. `otro.host:8080`), separados por coma. Por defecto solo `localhost`, `127.0.0.1` y `[::1]`. En AWS, el dominio (`chameleonmode.app`). |

Solo tema oscuro, con la paleta de la marca ([`docs/marca/chameleonmode-v1`](../docs/marca/chameleonmode-v1/README.md)):
todos los colores son tokens de `public/estilos/tokens.css` (el turquesa es lo interactivo y lo en vivo, nunca
"logrado"; los resultados tienen sus `--resultado-*`). La tipografía (Inter, JetBrains Mono) viene de Google Fonts.

### Con datos de prueba (mucho volumen, solo local)

```bash
npm --prefix backoffice run mock:generar    # backoffice/.mock/: ~270 tandas y ~90 revisiones en ~10 s (-- --escala 3 para más)
npm --prefix backoffice run mock            # http://localhost:4849/backoffice/, se reinicia al cambiar el servidor
```

Para trabajar el diseño con muchas tandas y con todas las pantallas, incluida **Revisiones**, sin AWS ni Claude.
`mock/generar.py` inventa 12 sitios `.test` con sus páginas y simula intentos de los perfiles reales del Visitante
(recorrido único de escritorio y móvil, los 4 u 8 exploradores, y los perfiles antiguos), con éxitos, fracasos,
abandonos, errores de la herramienta, desvíos, vueltas atrás y búsquedas. `route_tree.json` sale del mismo
`build_route_tree` del Visitante y las capturas son wireframes donde cada clic cae sobre lo que se cliqueó. Las
revisiones (en cola, en curso, una atascada, terminadas y fallidas) quedan en `.mock/revisiones.json`; el Diseñador
de cada una deja `tema.css`, `mejora.json` y capturas antes/después de las páginas de la ruta (pestaña Propuesta), y
`mock/servir.js` las sirve en memoria al mismo servidor, en vez de leer la tabla, con el reloj fijo en el momento en
que se generaron (`generado`): así el Overview ve en curso lo que estaba en curso. No hay video. Con `--semilla` se
repiten los mismos datos, y `BACKOFFICE_MOCK_LATENCIA_MS=400` demora la lectura de las revisiones para ver los
estados de carga.

### Contra AWS

```bash
npm --prefix backoffice install    # el SDK de AWS; la fuente local no lo necesita
BACKOFFICE_FUENTE=s3 BACKOFFICE_ALMACEN=s3://chameleon-almacen-<account_id> AWS_PROFILE=<perfil> npm run backoffice
```

Lee las corridas del bucket (mismo árbol que `agents/.runs/`) y suma lo que sale de la tabla de revisiones: la
sección Reviews del Overview, los agentes en cola y la pantalla **Revisiones** (`#/revisiones`), con el avance de cada
revisión por etapa y por goal y enlaces a lo que dejó cada corrida terminada. Sin tabla, el Overview muestra solo los
agentes. Solo lee: el perfil necesita `s3:ListBucket`, `s3:GetObject`, `dynamodb:Query` y `dynamodb:Scan`.

### En AWS: https://chameleonmode.app/backoffice/

Corre en ECS Fargate detrás de un balanceador, con la fuente `s3` sobre el almacén de los agentes y la tabla de
revisiones ([`infra/app/backoffice.tf`](../infra/app/backoffice.tf)). La imagen sale de `Dockerfile` y se despliega
sola al mergear a `main` un cambio de `backoffice/` (menos `test/`); los detalles están en
[la infraestructura](../infra/README.md#el-backoffice-en-chameleonmodeapp). **Es público, sin login:** todo lo que
se sube al almacén se puede ver ahí. El balanceador revisa la tarea con `GET /salud`, que responde `{ ok: true }`
con cualquier `Host` y no lee nada.

Las capturas y los videos (`archivos/`) pasan por el servidor, que los lee de S3. Como son de tandas que ya
terminaron, salen con `Cache-Control: private, max-age=31536000, immutable`: el navegador no los vuelve a pedir al
cambiar de paso o de intento. Lo demás (la API, la página) sale con `no-store`. Una tanda que ya apareció en la lista
no se vuelve a listar para servir sus archivos, y una captura entera es un solo `GetObject`.

### La raíz es una portada

El backoffice entero (la página, `api/`, `archivos/`, `resultados/` y `propuestas/`) vive bajo `/backoffice/`; `/backoffice` sin la barra
final redirige ahí, porque la página pide todo con rutas relativas. La raíz (`/`) sirve la portada de
[`portada/`](portada/): la marca y "Work in progress", sin enlaces al backoffice. Es lo que ve quien abre
https://chameleonmode.app, la URL de la entrega en `platanus-hack-project.jsonc`. No es un control de acceso: quien
conozca la ruta entra.

## Pantallas

La barra superior lleva la marca, la píldora "N running" (las revisiones en curso; lleva a la pestaña Live) y el
buscador ⌘K. No tiene navegación: a Corridas y Revisiones se llega con la paleta ⌘K, los atajos (`g o`, `g c`) y los
enlaces de cada pantalla.

**Overview** (`#/`, el inicio) tiene dos bloques. Arriba, los agentes: un solo total dividido por rol en el orden del
flujo (Cataloger → Guide → Visitors → Designer), con un cuadrito por corrida y el % de éxito de cada rol. Abajo, las
revisiones en tarjetas con la página revisada (captura de escritorio y teléfono; si el Diseñador terminó y dejó
capturas, la del después de su tema, y si no, la de inicio de un visitante), sus cuatro etapas (Catalog, Routes,
Visits, Theme), un medidor por goal y un cuadrito por agente; pestañas Recent (todas, también las en cola), Live (en
curso, detenidas y en cola), Delivered y Failed. Cada pestaña muestra páginas de 6 tarjetas, paginadas en el servidor
(`/api/overview?pestana=…&pagina=…`), con un paginador abajo (el rango que se ve y `‹ 1 … 4 5 6 … 11 ›`). Mientras
llega otra página, la grilla muestra tarjetas esqueleto. Si la página pedida ya no existe, el servidor da la última y la
URL se corrige. Otra pestaña empieza en su página 1, que ya llegó con la primera respuesta. Una tarjeta lleva directo
a Path map / Replay: la telaraña de su primer goal con tanda terminada (cada goal, a la suya); si la revisión todavía
no tiene una, la de la tanda de su captura (la más nueva del mismo host y ruta); solo si no hay ninguna, al avance de
la revisión.
Hay una tarjeta por página: la revisión vigente (la que apunta el ítem `URL#<url>` de la tabla), aunque esté en curso;
las que reemplazó un `force` no cuentan y la tarjeta enlaza a ellas ("2 previous reviews").
El filtro de dispositivo (All · Desktop · Mobile) cambia los visitantes, las capturas, los medidores y los cuadritos
de cada tarjeta. El dispositivo, la pestaña y la página quedan en la URL (`#/?dispositivo=mobile&pestana=failed&pagina=2`;
atrás vuelve a la página anterior); la página vuelve a pedir cada 5 s mientras la pestaña del navegador está visible.

**Corridas** (`#/corridas`; los enlaces viejos `#/?q=…` llevan aquí) lista las tandas, más nuevas primero y agrupadas
por día. Cada fila abre la tanda y dice solo qué tanda es y cómo le fue: tarea y sitio, cuántos llegan (con el
medidor), los errores de la herramienta si los hay y cuándo corrió. Búsqueda, filtros, sitio, orden y lista/grilla
quedan en la URL.

**Revisiones** (`#/revisiones`, con `?estado=live|done|failed` para filtrar) lista las revisiones vigentes y abre
el avance de cada una por etapa y por goal; `?estado=historial` lista las reemplazadas. `npm run historial` (con
`AWS_PROFILE`) imprime esas mismas en la terminal, las que se podrían archivar: solo lee, no archiva ni borra.

Una tanda (`#/t/<host>/visitor/<objetivo>/<corrida>/<pestaña>`) tiene una cabecera mínima, común a sus pestañas:
la tarea (con tanda anterior/siguiente y copiar enlace) y, debajo, sitio, fecha y cuántos llegan. Debajo, tres
pestañas (la primera es la de por defecto; los enlaces viejos a `/resumen` llevan a ella):

| Pestaña | Qué pregunta responde | De dónde sale |
|---|---|---|
| **Mapa de caminos** | ¿Por dónde fueron? Una telaraña: el inicio al centro, un anillo por paso y la ruta recomendada como eje recto; las demás rutas salen como ramas curvas (arriba las que vuelven o llegan, abajo las que fallan). Grosor = intentos, color = cómo terminaron (leyenda abajo); cada camino termina en su resultado (logrado, fallido, abandonado, error) y unas partículas lo recorren. Panel por página (quién pasó, adónde fue, cómo terminó, con enlace al paso en Replay) y marcas donde alguien se trabó. En pantallas más altas que anchas el eje apunta hacia abajo. | `nodes`, `branches` y `recommended_route` de `route_tree.json`, unidos en páginas |
| **Replay** | ¿Qué hizo un intento, paso a paso? A la izquierda los pasos (número, acción y descripción corta) con un selector de intento, al centro la captura del paso, a la derecha su análisis: el seguimiento de la ruta (la ruta de la Guía como lista vertical de páginas, con dónde está el usuario en ese paso y los desvíos agrupados bajo la página de la que salió), qué esperaba, dónde quedó y, al pie, el resultado del intento. Abajo una línea de tiempo que parte reproduciendo (salvo con movimiento reducido), con velocidad de 0,25× a 4× (1× es un 15 % más rápido que el ritmo original; queda guardada en el navegador). | `<perfil>/run.json`, `step_NN.png` y el `route.json` de la Guía que la tanda lista en los `inputs` de su `manifest.json` |
| **Propuesta** | ¿Qué propone el Diseñador y por qué? A la izquierda las páginas de la ruta (vistas) con dónde se quedaron los visitantes; al centro la página antes y después del tema con un divisor que se arrastra, escritorio o móvil, y las notas numeradas sobre la página; a la derecha la frase del Diseñador, la evidencia de los visitantes, cada cambio del tema con una muestra, la paleta y `tema.css`. Mientras el Diseñador diseña, la pestaña late y el después es un esqueleto. | la corrida del Diseñador (`<host>/improver/<corrida>/`) que lista la tanda en sus `inputs`: `tema.css`, `mejora.json` y sus capturas `vistas/*.png` |

### Qué lee la pestaña Propuesta del Diseñador

`GET /backoffice/api/propuestas/<host>/visitor/<objetivo>/<corrida>` busca la corrida del Diseñador más nueva cuyo
`manifest.json` lista la tanda en `inputs` y devuelve su estado (`ninguna`, `running`, `succeeded` o `failed`). De
`tema.css` saca lo que cambia (letra en % sobre el cuerpo, interlineado sin unidad, enlaces subrayados, alto mínimo
de botones y enlaces) y la paleta (fondo, texto y acento, con las variables resueltas). De `mejora.json` usa
`resumen_tema`, `decisiones`, `tarea` y `error`, como los escribe `agents/app/web_designer/disenador/mejora.py`, y,
si están, las capturas antes/después:

```json
"vistas": [{
  "url": "https://www.sitio.cl/soporte/dar-de-baja",
  "titulo": "Dar de baja - Sitio",
  "capturas": { "desktop": { "antes": "vistas/03-desktop-antes.png", "despues": "vistas/03-desktop-despues.png" },
                "mobile":  { "antes": "vistas/03-mobile-antes.png",  "despues": "vistas/03-mobile-despues.png" } },
  "marcas": [{ "tipo": "siguiente", "dispositivo": "desktop", "caja": [0.03, 0.37, 0.33, 0.59] }]
}]
```

Las rutas son relativas a la corrida y solo se sirven `vistas/*.png` (`GET /backoffice/propuestas/<corrida>/vistas/…`).
`marcas` ubica cada nota sobre la captura del después, en fracciones de la imagen: `siguiente` (el enlace al paso
siguiente de la ruta), `texto` (un bloque de texto) y `objetivos` (un botón). Hoy el Diseñador real no deja
`vistas`: sin ellas, el antes es la captura del visitante al llegar a cada página y el después dice que no hay
captura. Los datos de prueba (`mock/generar.py`) sí las dejan, para ver la pestaña completa.

### Animaciones del Replay

Cada paso pasa de su captura de antes (`screenshot_before`) a la de después (`screenshot`) mostrando la acción, sobre
la imagen y a su escala (las coordenadas vienen en px del `viewport` de `run.json`):

| Acción | Cómo se ve |
|---|---|
| clic, doble clic | el cursor viaja en curva desde el punto anterior, con una estela, y deja una onda (dos si es doble) y una marca fija |
| desplazar | la página corre como una tira en la dirección del scroll; una pastilla con la flecha queda donde estaba el mouse |
| escribir | el texto aparece letra a letra en una etiqueta junto al último clic de esa página (o abajo, si no hay) |
| tecla | un distintivo con la tecla (`⏎ Enter`, `Inicio`…) que se pulsa |
| cambio de URL | la página nueva entra desde la derecha sobre la anterior, que se oscurece, con el rótulo `→ sitio/ruta` |
| «volver a» y atrás | la página entra desde la izquierda, con el rótulo ámbar `↩ Volver a «…»` |

Reproducir anima cada paso entero y lo deja quieto 0,7 s; elegir un paso a mano (lista, barra, flechas) lo anima en
versión corta. Con `prefers-reduced-motion` no se mueve nada: se ve la captura final con la marca, el texto o la tecla.
El plan de cada paso es puro (`public/replay/animacion.js`, con pruebas) y `public/replay/escena.js` lo dibuja con
la Web Animations API. Sin three.js: todo es 2D sobre una captura, y CSS/WAAPI lo hace en la GPU con texto nítido
del DOM, sin agregar una dependencia más pesada que todo el front.

## Cómo leer las cifras

- **Errores de la herramienta.** Un intento que terminó por `internal_error`, `api_error`, `no_response` o
  `refusal`, sin veredicto del juez o sin página de inicio no es comportamiento del usuario: se marca como error, se
  ve en la lista y en Replay, y queda **fuera** de las cifras, métricas de perfil, hallazgos y quiebres.
- **Páginas fusionadas.** Dos nodos del `route_tree.json` son la misma página si tienen la misma URL sin la consulta
  (`?s=…`) y el mismo título no vacío. El panel de la página lista las variantes de URL unidas. Los nodos sin
  título nunca se unen.
- **Ruta recomendada, no happy path.** El eje es `recommended_route`, la ruta de menor costo entre las que hicieron
  los intentos, y se rotula así en todas partes. Si nadie llegó, el eje es el camino más transitado.
- **Llegar no basta.** Si todos llegan pero alguno se demora, tropieza o da más pasos que la ruta, el titular lo dice
  ("Los 3 llegan a la respuesta, pero Apurado tarda 12 pasos (la ruta: 5).") y se marca como dificultad, no como
  éxito limpio. Los pasos en una página cuentan todas las acciones hechas ahí, incluida la que sale: la misma unidad
  que los pasos de un tramo de la ruta.
- **n chico.** Las tasas se muestran como conteo (`2/3`); el porcentaje solo aparece con más de 5 casos. "No aplica"
  es `null` y se dibuja "—" con la razón en un globo: nunca es 0 (por ejemplo, recuperación cuando nadie se desvió).
- **Estado de un paso: estimado.** El juez no evalúa cada paso. *Coincide* es "no" si el paso trae `no_effect`,
  `went_back` o `visible_error`; "sí" si cambió la página o al menos el 5 % de la captura; si no, "incierto".

### Las cifras del Overview

- **Un agente es una corrida; un visitante, un intento.** Cataloger, Guide y Designer (la etapa `improver`) cuentan
  un `manifest.json` por corrida (`succeeded` logrado, `failed` fallido, `running` en curso); Visitors cuenta un
  `run.json` por intento, clasificado igual que en las tandas (logrado, fallido, abandonó, sin medir, error de la
  herramienta). El total es la suma de las filas que se ven.
- **% de éxito:** visitantes, logrados / (logrados + fallidos + abandonó); los demás, logrados / (logrados + fallidos).
  Verde desde 70 %, naranja desde 60 %, rojo bajo eso. Con 5 casos medidos o menos va el conteo (`x/y`), como en todo
  el backoffice; sin casos, "—".
- **Dispositivo:** sale del `viewport` del run.json (ancho < 700 px es móvil, el resto escritorio), nunca del nombre
  del perfil. Un intento en curso (solo `trace.json`, sin viewport) es móvil si su perfil es `mobile`. Con un filtro
  cambian los visitantes y lo de las tarjetas; Cataloger, Guide y Designer no, porque sirven a los dos.
- **En cola** (contorno, sin contar en las cifras): los agentes que todavía no parten en revisiones que corren. Un
  Visitante en cola es un solo cuadrito, sin dispositivo, porque todavía no se sabe cuántos intentos hará.
- **Detenida:** una revisión `running` sin cambios en 30 min (`UMBRAL_DETENIDA_MS`, `lib/tarjeta.js`). Su motivo dice
  hace cuánto; una fallida dice si fue por límite de AgentCore (429), el catalogador, la Guía o el diseñador.
- **La hora de referencia es la del servidor:** `/api/resumen` y `/api/overview` traen `ahora`, y "detenida",
  "12 min" y "5 hr ago" se calculan contra ese valor, no contra el reloj del navegador (`reloj` de `crearServidor`;
  el servidor de los datos de prueba lo fija en el momento en que se generaron).
- **Capturas:** la página de inicio (`step_00.png`) de un intento de escritorio y uno móvil de la revisión; si todavía
  no tiene visitantes, de la tanda más nueva del mismo host y ruta; si no hay, un bloque con el color de marca (el
  píxel (4, 4) de la captura, o uno derivado del host). El nombre del sitio sale del título de su página de inicio.

## Idiomas (es / en)

Inglés por defecto y español. No hay selector en la barra: el idioma se cambia con la acción de la paleta ⌘K o con
`idioma=` en el hash de la URL (`#/?idioma=es`), y se guarda en `localStorage` (`backoffice:idioma:v2`; lo que guardó
el selector ES | EN de antes ya no se lee). Los datos de la corrida (títulos de páginas, instrucciones de los goals,
expectativas del agente, justificaciones, criterios) nunca se traducen.

La página pide que el navegador no la traduzca (`translate="no"` y `<meta name="google" content="notranslate">`):
el traductor de Chrome (que se ofrece solo a quien tiene el navegador en español) traduce lo que hay al cargar y no
lo que la vista vuelve a dibujar (el Overview se refresca cada 5 s), y deja la interfaz en spanglish.

- Cada texto de la interfaz pasa por `t("<sección>.<clave>", vars)`. Hay un diccionario por sección y por idioma:
  `public/i18n/{es,en}/<sección>.js` (`comun`, `datos` y uno por pantalla). Un valor es un texto con `{variables}` o
  una función `(vars, { plural, fmt }) => texto`.
- `lib/` no arma frases: entrega `{ clave, vars }` y `public/datos/textos.js` las convierte en texto.
- Para agregar una clave: ponerla en `es/<sección>.js` **y** en `en/<sección>.js`, con el mismo árbol.
  `test/diccionarios.test.js` falla si los árboles difieren, si una función devuelve vacío para n = 0, 1, 2 o si una
  pantalla tiene texto visible escrito a mano. Si una función necesita vars que no son números, la sección exporta
  `ejemplos`.

## Teclado

`?` muestra la hoja con los atajos que funcionan en la vista abierta: la arma con lo que está registrado en ese
momento (`gruposDeLaHoja` en `public/nucleo/atajos.js`), así nunca anuncia una tecla que no existe. ⌘ en Mac, Ctrl en
el resto.

| Dónde | Teclas |
|---|---|
| Siempre | `⌘K` paleta de comandos · `?` atajos · `g o` ir al Overview · `g c` ir a Corridas · `/` paleta (en Corridas, el buscador) |
| Overview | `←` `→` `Inicio` `Fin` en las fichas de dispositivo y en las pestañas de revisiones |
| Corridas | `j` `k` fila siguiente / anterior · `v` lista ↔ grilla |
| Tanda | `1` `2` `3` Mapa de caminos, Replay, Propuesta · `[` `]` tanda anterior / siguiente · `c` copiar enlace |
| Mapa de caminos | `+` `-` acercar / alejar · `0` ajustar · `Esc` cerrar (con el foco en el mapa, las flechas lo mueven) |
| Replay | `←` `→` paso · `Inicio` `Fin` primer / último paso · `Espacio` reproducir / pausar · `,` `.` más lento / más rápido · `↑` `↓` en la lista de pasos |

## Fuente de corridas

Todo lo que se lee de las corridas pasa por una interfaz chica, `Fuente`, documentada en `lib/fuente.js`:
`descripcion`, `listarIds()` (las tandas del Visitante terminadas), `listarCorridas()` (las corridas de los cuatro
agentes, terminadas o no, para el Overview), `listarPerfiles(id)`, `leerJson(id, relativa)`, `leerTexto(id, relativa)`
(el `tema.css` del diseñador), `existe(id, relativa)` y `abrirArchivo(id, relativa, rango)`. La implementan `lib/fuentes/archivos.js` y `lib/fuentes/s3.js`. La validación
(nombres seguros, ids que la fuente listó, solo capturas y video) vive en `lib/tandas.js`, así que una fuente nunca
recibe una ruta sin validar. `derivar.js` y las pantallas no saben de dónde vienen los datos.

La de S3 lista con `ListObjectsV2` y `Delimiter: "/"`, pasa capturas y video por el servidor (el bucket sigue
privado y vale la CSP) y guarda en memoria lo leído de corridas cerradas. Recibe el cliente del SDK (`lib/aws.js`),
así las pruebas usan clientes falsos (`test/aws-falso.js`). Antes de desplegarlo fuera de `127.0.0.1`, autenticación
delante.

## Estructura

```
backoffice/
├── servidor.js          ← node:http: la página, /api/tandas, /api/tandas/<host>/visitor/<objetivo>/<corrida>,
│                          /api/resumen, /api/overview, /api/revisiones, /api/propuestas/…, /archivos/… y
│                          /propuestas/… (la lista completa, en su cabecera)
├── lib/                 ← lado del servidor, lógica pura salvo la fuente
│   ├── tandas.js        ← lista y lee tandas a través de la fuente; valida todo lo que llega de afuera
│   ├── fuente.js        ← la interfaz Fuente y crearFuente(); fuentes/archivos.js (node:fs), fuentes/s3.js y
│   │                      fuentes/corridas.js (el recorrido de las corridas de todos los agentes, común a las dos)
│   ├── revisiones.js    ← lee la tabla de revisiones y deriva el avance por etapa y goal; aws.js carga el SDK
│   ├── panel.js         ← arma /api/resumen y /api/overview: lee el almacén (indice.js) y la tabla, con caché de lo
│   │                      cerrado y una sola lectura compartida por pedidos que llegan juntos
│   ├── indice.js        ← el índice del almacén: corridas por rol y estado, intentos con resultado y dispositivo
│   ├── overview.js      ← cifras del resumen, cuentas, pestañas y su paginado (puro)
│   ├── tarjeta.js       ← una tarjeta: detenida, etapas, agentes, goals, motivo, capturas (puro)
│   ├── clasificar.js    ← dispositivo por viewport y estado de un intento o de un manifest (puro)
│   ├── sitio.js         ← host, ruta, nombre del sitio y acento del tema (puro)
│   ├── propuestas.js    ← la propuesta del Diseñador para una tanda: tema.css → cambios y paleta, mejora.json, vistas
│   ├── derivar.js       ← de route_tree.json + run.json + criteria.json a la tanda que dibujan las pantallas
│   ├── paginas.js       ← une nodos en páginas y les da un título corto
│   ├── hallazgos.js     ← hallazgos y titulares (clave + vars)
│   └── url.js           ← normalize_url de shared.nodes.urls, en JavaScript
├── public/
│   ├── index.html, app.js   ← arranque: idioma, barra superior, paleta, atajos globales, enrutador
│   ├── marca/           ← el logo y el símbolo de la marca (copias de docs/marca)
│   ├── nucleo/          ← enrutador por hash, barra superior, marco de la tanda, atajos, paleta ⌘K, i18n, formatos,
│   │                      estados, íconos
│   ├── pantallas/       ← una por vista: overview, corridas, revisiones, telarana, replay, propuesta
│   ├── overview/        ← piezas del Overview: las puras (agentes, tarjetas, tiempo, marca, textos) y las que arman
│   │                      DOM (dom-*.js; capturas.js guarda los <img> para no volver a pedirlos al refrescar)
│   ├── corridas/ telarana/ replay/ propuesta/   ← piezas de cada pantalla (las puras se prueban con node:test)
│   ├── datos/           ← textos.js convierte { clave, vars } de la API en texto; nombres.js, el nivel de cada perfil
│   ├── i18n/{es,en}/    ← diccionarios por sección
│   └── estilos/         ← tokens, base y componentes compartidos; un .css por pantalla, prefijado con .p-<id>
└── test/                ← node:test, con dos tandas sintéticas en fixtures/corridas/
```

Contrato de una pantalla: `public/pantallas/<id>.js` exporta por defecto `{ titulo(ctx), cargar?(ctx),
montar(contenedor, ctx, datos), actualizar?(ctx), desmontar?() }`. El enrutador carga su diccionario y, si la
pantalla trae sus propios datos (el Overview, Revisiones y la Propuesta), llama a `cargar(ctx)` antes de la
transición y le pasa el resultado a `montar`. Si la carga tarda más de 150 ms, muestra el esqueleto de esa vista, con
su geometría (`esqueleto()` en `public/nucleo/estados.js`), y lo deja al menos 300 ms. `montar` no espera la red: la
transición congela la página mientras corre. Si la pantalla se remonta sola (Reintentar), `montar` recibe `datos`
undefined, pone su esqueleto y pide los datos ella. Si solo cambian los parámetros de la URL llama a
`actualizar(ctx)`, y si esta devuelve `false` vuelve a montar la pestaña. Al salir llama a `desmontar()`, y los
atajos registrados con `ctx.atajos.registrar` se quitan solos. Todo el estado de la vista vive en el hash, así que
cualquier vista se puede compartir copiando el enlace.

## Seguridad

Las corridas muestran páginas de terceros y a veces datos de quien corrió la prueba. Por eso:

- El servidor escucha solo en `127.0.0.1` (salvo con `BACKOFFICE_ESCUCHA`, en AWS) y solo acepta `GET` y `HEAD`.
- La copia de AWS es pública por decisión del equipo (2026-11-21): lo que está en el almacén lo ve cualquiera.
- Rechaza (403) toda petición cuya cabecera `Host` no sea `localhost`, `127.0.0.1` o `[::1]` en su puerto, para que
  una página maliciosa no pueda leer las corridas con DNS rebinding (`BACKOFFICE_HOSTS` agrega excepciones).
- De un perfil sirve únicamente `step_NN.png` y `video.webm` (con rangos de bytes, para el video), y solo de tandas
  que la fuente listó: ni `run.json` ni rutas fuera de la carpeta. De una corrida del Diseñador sirve solo
  `vistas/*.png` (y `tema.css` como texto, por `resultados/`). De `public/` sirve solo
  `.html/.js/.css/.svg/.woff2` con nombres en minúscula.
- Manda una política de seguridad estricta (`script-src 'self'`, sin `unsafe-inline`; solo Google Fonts como
  origen externo), `nosniff`, `no-referrer` y `frame-ancestors 'none'`.
- La página arma todo con nodos de texto: nada de lo que viene de una corrida se interpreta como HTML.

## Pruebas

`npm test` (aquí) o `npm run check` (desde la raíz, con el resto del repo). Prueban la derivación, las páginas
fusionadas, los hallazgos, la fuente (incluida una fuente falsa en memoria), el servidor, los módulos puros de las
pantallas y los diccionarios.

Las cifras del Overview tienen dos pruebas de aceptación: `test/aceptacion.test.js` arma en memoria un almacén y una
tabla con las cifras de referencia (1,286 agentes: 82 · 213 · 922 · 69; móvil 214) y `test/aceptacion-mock.test.js`
las verifica sobre los datos de prueba de `backoffice/.mock` (se salta si esa carpeta no está, como en CI).

Las tandas de `test/fixtures/corridas/demo.cl/visitor/tarea-demo/` son sintéticas, con la forma de `agents/.runs/`; la
fuente solo lista las corridas cuyo `manifest.json` dice `succeeded`, y el fixture trae una fallida y una en curso. El
layout que lee el backoffice está en `public/nucleo/almacen.js`. Sus
`route_tree.json` los generó `build_route_tree` del Visitante (`agents/app/visitor/visitor/route_tree.py`) a partir de
los `run.json`; si cambia el formato del evaluador, hay que regenerarlos igual.
