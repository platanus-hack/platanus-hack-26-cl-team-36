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

## Cómo usarlo

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
- **Distinto de `specs/MVP.md`:** el puente es Python con `claude -p` en vez de Node con el Agent SDK; el complemento
  no usa WXT; no hay token de emparejamiento (el puente solo acepta peticiones con origen `moz-extension://`).
