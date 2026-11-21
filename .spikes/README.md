# Spikes

Aquí va todo lo fechado: planes, mediciones y experimentos. `docs/` describe componentes y su estado; no lleva
fechas ni planes.

## Qué es un spike

Una pregunta concreta cuya respuesta cambia lo que se construye, contestada con evidencia en poco tiempo. No es
código que se conserve.

Cada spike deja dos cosas:

1. **Un informe** en `.spikes/<fecha>-<tema>.md`.
2. **Un script de un solo archivo** en `spikes/<tema>.py` (o `.js`), que cualquiera pueda volver a correr. Su
   docstring dice qué mide y cómo se ejecuta.

## Forma del informe

```
# Spike: <la pregunta> (<fecha>)

Corte del código, entorno y qué se consultó.

## Respuesta corta
La conclusión en un párrafo. Qué está demostrado y qué no.

## Evidencia
Comandos, salidas, tablas. Cada afirmación dice si está **demostrada** o es **inferencia**.

## Qué decide
La decisión que se toma con esto, y qué queda abierto.
```

Reglas:

- La respuesta va primero.
- Se separa lo demostrado de lo inferido.
- Las cifras llevan su N, su fecha y su entorno.
- Un informe no se reescribe. Si cambia la conclusión, se agrega otro que enlaza al anterior.
- Lo que la documentación necesita de un spike se copia a `docs/` como conclusión, con su fecha.

## Forma de un plan

Una feature que toca varios componentes empieza con un plan en esta carpeta: estado verificado de partida, decisiones,
invariantes, spikes pendientes, PRs con un criterio de aceptación cada uno, y fuera de alcance.

## Índice

| Fecha | Documento | Tipo |
|---|---|---|
| 2026-11-21 | [Plan: del prototipo al bucle de optimización](2026-11-21-plan-bucle-de-optimizacion.md) | Plan |
