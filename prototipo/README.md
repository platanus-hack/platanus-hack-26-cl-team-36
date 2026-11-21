# Prototipo: Firefox conectado a Claude Code

Primera validación de la idea. Cada vez que cargas una página, la extensión le pide a tu Claude una **piel** (una
hoja CSS) que la adapte a la instrucción que escribiste, y la aplica. La segunda vez que visitas ese sitio, la piel
sale de la caché y se aplica al instante.

```
Firefox (complemento temporal)  ──HTTP 127.0.0.1:8765──►  puente.py  ──►  claude -p (tu plan de Claude)
```

No usa Node ni tiene paso de compilación: el complemento son archivos JavaScript sueltos y el puente es un solo
archivo de Python sin dependencias.

## Requisitos

- Firefox (probado con la versión 160).
- Python 3.
- Claude Code instalado y con la sesión iniciada (`claude` en la terminal).

## Arranque con un solo comando

```bash
python3 prototipo/lanzar.py
```

Deja corriendo, separados de la terminal, el puente (puerto 8765), la página de demostración
(`http://127.0.0.1:8000/`, u otro puerto si ese está ocupado) y un Firefox aparte, con ventana y perfil propio, con el
complemento ya instalado, su botón en la barra y la página de demostración abierta. No toca tu Firefox. Falta solo el
paso 3 de más abajo: escribir la sugerencia en el panel.

| Orden | Qué hace |
|---|---|
| `lanzar.py --sugerencia "modo oscuro y texto más grande"` | Arranca y deja escrita la sugerencia, sin pasar por el panel. |
| `lanzar.py --estado` | Muestra qué está corriendo, con sus PID y puertos, y si el complemento sigue instalado. |
| `lanzar.py --detener` | Detiene lo que arrancó el lanzador (y nada más). |

- Lanzarlo dos veces no duplica nada: si todo corre, muestra el estado; si cerraste la ventana de Firefox, solo
  vuelve a abrir lo que falta.
- El perfil, los registros (`registros/puente.log`, `demo.log`, `firefox.log`) y `pids.json` quedan en
  `prototipo/.ejecucion/`, fuera de git.
- **La sugerencia y las pieles guardadas sobreviven** a `--detener` y a reiniciar ese Firefox: el complemento es
  temporal y el lanzador lo reinstala en cada arranque, pero el perfil se conserva. Para empezar de cero, detén el
  prototipo y borra `prototipo/.ejecucion/perfil/`.
- La barra de direcciones de ese Firefox sale rayada y con un icono de robot porque el lanzador lo maneja por
  Marionette, cuyo puerto queda abierto en `127.0.0.1` mientras ese Firefox siga abierto.

## Cómo usarlo

Los pasos a mano, sin el lanzador:

1. Arranca el puente y déjalo corriendo:

   ```bash
   python3 prototipo/puente/puente.py
   ```

2. En Firefox abre `about:debugging#/runtime/this-firefox`, pulsa **Cargar complemento temporal…** y elige
   `prototipo/extension/manifest.json`. Hay que repetirlo cada vez que se reinicia Firefox.
3. Pulsa el botón del complemento en la barra, escribe cómo quieres ver las páginas ("modo oscuro, texto más grande
   y sin barra lateral") y pulsa **Guardar y aplicar**.
4. Navega. En un sitio nuevo la piel tarda unos 7 a 10 segundos; el botón muestra `…` mientras se genera, `✓` cuando
   está aplicada y `!` si hubo un error.

En el panel también están **Ver original**, **Regenerar**, el interruptor **Adaptar este sitio** para apagar un sitio
y **Borrar pieles guardadas**.

Para probar sin salir a internet hay una página de demostración:

```bash
python3 -m http.server 8000 --directory prototipo/demo
```

## Qué sale de tu equipo

Con **Adaptar todos los sitios** encendido, por cada sitio nuevo que cargas se envía a Claude, con tu plan, un mapa
de la página: etiquetas, `id`, clases, tamaños y colores. **No se envía** el texto de la página, los valores de los
atributos, el contenido de los formularios ni la consulta de la URL. Apaga el interruptor, o el del sitio, donde no
quieras que ocurra.

El CSS que devuelve Claude pasa siempre por el saneador antes de inyectarse: se eliminan `@import`, `@font-face`,
`url()` e `image-set()`, y `content` solo admite valores vacíos.

## Configuración del puente

| Variable | Por defecto | Qué hace |
|---|---|---|
| `PUENTE_PUERTO` | `8765` | Puerto en `127.0.0.1`. Si lo cambias, ajústalo en el panel: **Avanzado → URL del puente local**. |
| `PUENTE_MODELO` | `claude-sonnet-5-5` | Modelo. En las mediciones, Haiku resultó más lento que Sonnet. |
| `PUENTE_ESFUERZO` | `low` | Esfuerzo de razonamiento que se pasa a `claude`. |
| `PUENTE_TIEMPO_MAXIMO_S` | `120` | Tiempo máximo por generación. |

## Pruebas

```bash
python3 prototipo/pruebas/e2e.py          # con un puente falso; no llama a Claude (unos 15 s)
python3 prototipo/pruebas/e2e_real.py     # con el puente real; llama a Claude y consume tu plan
```

Las dos abren un Firefox aparte, sin ventana y con un perfil temporal; no tocan tu Firefox. `e2e_real.py` acepta
`--url` (se puede repetir) para probar sitios reales y `--capturas CARPETA` para guardar el antes y el después.

Resultado del 21-nov-2026 con `e2e_real.py`: la página de demostración, un artículo de Wikipedia y la portada de
Hacker News quedaron adaptados en 6,6 s, 9,7 s y 8,7 s, y al recargar la piel se aplicó desde la caché.

## Límites conocidos

- **Calidad de la piel:** Claude escribe el CSS sin ver el resultado. En las pruebas dejó sin oscurecer un panel
  lateral de Wikipedia y, al ocultar la barra lateral de la página de demostración, las tarjetas quedaron estrechas.
  El mapa de página todavía no dice qué contenedores son rejillas.
- **Una instrucción global** y una piel por sitio y patrón de ruta. Cambiar la instrucción regenera en la siguiente
  visita.
- **Fuera de este prototipo:** valoraciones, preferencias recordadas, recorridos, servidor central y recomendaciones.
- **Distinto de `.specs/MVP.md`:** el puente es Python con `claude -p` en vez de Node con el Agent SDK; el complemento
  no usa WXT; no hay token de emparejamiento (el puente solo acepta peticiones con origen `moz-extension://`).
