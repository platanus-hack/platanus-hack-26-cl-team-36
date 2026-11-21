# Spikes

**Qué es esta carpeta.** Aquí van los spikes del proyecto: sus scripts y sus informes. Qué spikes hay que hacer y
por qué está en [el plan](../docs/plan.md).

Hechos hasta ahora:

| Fecha | Pregunta | Informe |
|---|---|---|
| 2026-11-21 | ¿Hasta qué nivel de cambio se puede modificar wom.cl sin romperlo? | [alcance-cambios-wom](2026-11-21-alcance-cambios-wom.md) |
| 2026-11-21 | ¿8 exploradores con dos niveles de conocimiento encuentran más caminos que los 4 de siempre? | [exploradores-conocimiento](2026-11-21-exploradores-conocimiento.md) |

Los tres spikes del plan todavía no se han hecho.

## Qué es un spike

Una prueba corta para contestar una pregunta cuya respuesta cambia lo que vamos a construir. No es código que se
conserve.

Cada spike deja dos archivos en esta carpeta, con el mismo nombre:

- `<fecha>-<tema>.py`: un script que cualquiera pueda volver a correr. Al principio dice qué mide y cómo se ejecuta.
- `<fecha>-<tema>.md`: el informe.

## Cómo se escribe el informe

```
# Spike: <la pregunta> (<fecha>)

Qué versión del código se usó, en qué computador y qué se consultó.

## Respuesta corta
La conclusión en un párrafo. Qué quedó demostrado y qué no.

## Evidencia
Los comandos, sus salidas y las tablas. Cada afirmación dice si está demostrada o si es una suposición.

## Qué decidimos
La decisión que se toma con esto, y lo que queda sin resolver.
```

Reglas:

- La respuesta va primero.
- La regla para decidir se escribe antes de medir.
- Lo demostrado se separa de lo supuesto.
- Cada número dice sobre cuántos casos se calculó, cuándo y en qué computador.
- Un informe no se reescribe. Si la conclusión cambia, se agrega otro que enlaza al anterior.
- Lo que la documentación necesite de un spike se copia a `docs/` como conclusión, con su fecha.
