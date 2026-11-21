# Spikes

Esta carpeta guarda lo que tiene fecha: planes, mediciones y pruebas. La carpeta [`docs/`](../docs/index.md) explica
qué es el producto y sus piezas; no lleva fechas ni planes.

## Qué es un spike

Una prueba corta para contestar una pregunta cuya respuesta cambia lo que vamos a construir. No es código que se
conserve.

Cada spike deja dos cosas:

1. **Un informe** en `.spikes/<fecha>-<tema>.md`.
2. **Un script de un solo archivo** en `spikes/<tema>.py`, que cualquiera pueda volver a correr. Al principio dice
   qué mide y cómo se ejecuta.

## Cómo se escribe el informe

```
# Spike: <la pregunta> (<fecha>)

Qué versión del código se usó, en qué equipo y qué se consultó.

## Respuesta corta
La conclusión en un párrafo. Qué quedó demostrado y qué no.

## Evidencia
Los comandos, sus salidas y las tablas. Cada afirmación dice si está demostrada o si es una suposición.

## Qué decidimos
La decisión que se toma con esto, y lo que queda sin resolver.
```

Reglas:

- La respuesta va primero.
- Lo demostrado se separa de lo supuesto.
- Cada número dice sobre cuántos casos se calculó, cuándo y en qué equipo.
- Un informe no se reescribe. Si la conclusión cambia, se agrega otro que enlaza al anterior.
- Lo que la documentación necesite de un spike se copia a `docs/` como conclusión, con su fecha.

## Índice

| Fecha | Documento | Qué es |
|---|---|---|
| 2026-11-21 | [Qué hay que averiguar y qué hay que construir](2026-11-21-plan.md) | Plan |
