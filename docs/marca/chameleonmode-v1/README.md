# Chameleon Mode · Marca y extensión

Sistema de marca para **chameleonmode.app**. La geometría y el orden cromático del camaleón se conservan. **chameleon** usa Inter 600; **mode**, Inter 400 al 72% del tamaño, sobre la misma línea base. La portada y la tarjeta social muestran únicamente marca y dominio.

## Entrega

- [Brandbook PDF](brandbook.pdf) y [fuente editable](brandbook.html): siete páginas con identidad, color, formatos y estados de la extensión.
- [Assets](assets/) e [inventario](manifest-assets.json): 70 archivos con dimensiones, uso, transparencia y SHA-256.
- `previews/extension-*.png`: capturas del popup implementado con respuestas de página simuladas, sin backend ni votos reales.
- `sources/`: cuatro maestros originales. `fonts/`: Inter y JetBrains Mono con sus licencias OFL.
- [Referencias](references.md): investigación y decisiones concretas.

## Reglas de marca

El símbolo a color conserva la baldosa oscura. La cabeza es lima y el color recorre el cuerpo hacia turquesa, azul, violeta y magenta. No deformar, rotar, invertir el espectro, cambiar el ojo ni añadir sombras, contornos o filtros. Los monocromos de marca son tinta y blanco, sin baldosa.

Margen libre mínimo: 1/8 del ancho del símbolo alrededor del conjunto. Tamaños mínimos propuestos: símbolo color 32 px, firma horizontal 180 px, apilada 140 px. A 16 px se usa el maestro óptico específico, no una reducción del dibujo grande.

Las firmas `on-light` llevan texto oscuro; `on-dark`, texto blanco. Ambas conservan el símbolo original. SVG es el maestro escalable; los PNG transparentes son alternativas para presentaciones y herramientas sin SVG. Las letras están convertidas en trazos y no requieren fuentes instaladas.

## Estados de la extensión

La marca de la cabecera permanece igual. Los archivos `extension-on*` y `extension-off*` pertenecen al control funcional:

- **ON / Encendido:** camaleón original a color, con texto ON. Indica que Chameleon está habilitado globalmente.
- **OFF / Apagado:** geometría y ojo intactos; relleno neutro `#A7A7B5`, sin filtros, sobre la baldosa original. Se acompaña de OFF, de modo que el estado no depende sólo del color.
- **Encendido con tema disponible:** el estado contextual indica disponibilidad; no equivale a una comprobación de aplicación.
- **Encendido sin tema / página no disponible:** el control continúa ON, y la línea de contexto explica la situación de la pestaña.

El interruptor afecta a todos los sitios compatibles. No existe una preferencia por sitio. El tooltip de la barra se traduce al español o inglés y expresa el estado global. El background restaura icono, título y badge desde storage al arrancar y sigue los cambios de estado e idioma.

El popup tiene una sola acción principal arriba. La opinión queda plegada; idioma y efectos permanecen como controles secundarios al pie. Se conservan votos, privacidad, idioma, efectos de la página y la cola de clics. La simplificación retira del popup las capas decorativas, la mirada animada y la transición de letras; la preferencia de efectos de la página sigue funcionando.

## Color y tipografía

Carbón `#0B0B10`, superficie `#15151D`, elevación `#1C1C27`, blanco suave `#F5F5F7`. Turquesa `#2EE6C5` para acción sobre oscuro, con texto carbón; verde profundo `#007866` para acción sobre claro, con texto blanco. Inter para marca y controles. JetBrains Mono para datos o identificadores.

Espectro original: lima `#B8FF5C`, turquesa `#2EE6C5`, azul `#4C8DFF`, violeta `#8B5CF6`, magenta `#F472B6`. Se reserva para el símbolo. Los mensajes describen estado y disponibilidad con términos directos.

## Integración reproducible

La extensión consume recursos locales del kit. `extension/scripts/sincronizar-marca.js` copia wordmark, estados ON/OFF, Inter y su licencia, los iconos del manifest y el logo del proyecto. `brand:check` compara los bytes para detectar divergencias.

```sh
npm --prefix extension run brand:sync
npm --prefix extension run check
```

Para regenerar los maestros y exportaciones:

```sh
python3 scripts/export-logos.py
```

El exportador declara sus dependencias y usa exclusivamente `sources/` y `fonts/` dentro de este kit. Para renderizar capturas y PDF, instalar Playwright con Chromium y ejecutar `node scripts/render-brandbook.cjs`. El render usa el popup real desde el repositorio y una API `browser` simulada; necesita la estructura del repositorio, a diferencia del exportador de logos.

## Destinos

- Favicon: SVG óptico y ICO con 16, 32 y 48 px.
- Extensión: PNG ON/OFF 16, 32, 48, 96 y 128 px; SVG para el control del popup.
- Apple touch: PNG opaco 180 px.
- PWA: 192 y 512 px; maskable 512 px con zona segura circular propia.
- Avatar: 1024 px, protegido para recorte circular.
- Tarjeta social: 1200×630 px, marca y dominio.
- Logo del proyecto: 1000×1000 px, menos de 500 KB.

Recursos RGB/sRGB para digital. Para impresión, entregar el SVG y acordar perfil de color y prueba con el proveedor. Los iconos PWA son recursos gráficos; por sí solos no configuran una aplicación instalable.
