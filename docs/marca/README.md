# Marca Chameleon

## Sistema de marca Chameleon Mode

La propuesta de branding para **chameleonmode.app** está en [`chameleonmode-v1/`](chameleonmode-v1/README.md):
[guía visual](chameleonmode-v1/brandbook.pdf) y [logos e íconos para producción](chameleonmode-v1/manifest-assets.json).
Conserva estos originales y añade la firma «chameleon mode», con «mode» secundario, y los estados ON/OFF
integrados en la extensión.

## Símbolo original

Un camaleón enrollado: el cuerpo es la cola en espiral, la cabeza lleva casco y ojo torreta (pupila mirando hacia
adelante). El color recorre el cuerpo como el **espectro**: así se ve que la interfaz *se adapta*.

## Archivos

Los maestros están en [`chameleonmode-v1/sources/`](chameleonmode-v1/sources/); los PNG, en [`chameleonmode-v1/assets/`](chameleonmode-v1/assets/).

| Archivo | Uso |
|---|---|
| `logo.svg` | Maestro a color sobre baldosa oscura. De 32 px hacia arriba. |
| `logo-16.svg` | Versión de 16 px ajustada a la grilla (cola en gancho, ojo de 1 píxel). Solo para 16 px. |
| `logo-mono-tinta.svg` | Una tinta `#1C1B22`, sin baldosa, para fondos claros. |
| `logo-mono-blanco.svg` | Una tinta `#FBFBFE`, sin baldosa, para fondos oscuros. |

Los íconos de la extensión están en `extension/src/icons/` (PNG 48/96/128 y los mono de la barra, `theme_icons`).
El generador (geometría y espectro) vive fuera del repo; si hace falta un tamaño nuevo, se exporta desde `chameleonmode-v1/sources/logo.svg`.

## Colores

- Espectro (cabeza → punta de la cola): `#B8FF5C` lima · `#2EE6C5` turquesa · `#4C8DFF` azul · `#8B5CF6` violeta · `#F472B6` magenta.
- Tinta `#0B0B10` · superficie `#15151D` · baldosa (degradé) `#1C1C27` → `#0F0F15`.
- Badge del botón: fondo `#2EE6C5` con texto `#0B0B10`.

## Reglas

- **Margen libre:** al menos 1/8 del ancho del logo por lado (16 px en un logo de 128).
- **Tamaño mínimo:** color 32 px (`logo.svg`); 16 px solo con `logo-16.svg` o los mono.
- **Sí:** usar la baldosa oscura con el logo a color; sobre fondos claros, la baldosa ya da el contraste.
- **No:** cambiar el orden del espectro, invertirlo (la cabeza siempre lima), agregarle sombras, contornos o filtros,
  estirarlo, rotarlo, ni poner el logo a color sin baldosa sobre fondo claro (el lima se pierde).
