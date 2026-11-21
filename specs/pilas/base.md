# Pila Base

Dueño: todos, en la primera hora y media. Se fusiona a `main` antes de abrir cualquier otra pila.

Plantilla de propuesta, que usan todas las pilas:

```
## <ID> · <título en imperativo>
Depende de · Desbloquea · Prioridad (imprescindible | deseable | recortable)
Objetivo            resultado observable, 1–2 frases
Fuera de alcance
Contrato que toca   sección de contratos.md; ¿lo cambia?
Validaciones        lista: CUANDO/SI … EL SISTEMA DEBE … — cómo se comprueba
Decisiones abiertas lo que elige quien implementa
Estado del arte     en qué se apoya
```

---

## B1 · Vuelve ejecutables los contratos

Depende de: nada · Desbloquea: todas las pilas · Prioridad: imprescindible

**Objetivo.** Cada forma de [contratos.md](../contratos.md) existe como esquema importable, con datos de prueba
válidos e inválidos, y el repositorio tiene las comprobaciones que todo PR debe pasar.

**Fuera de alcance.** Cualquier lógica de producto.

**Contrato que toca.** Todos; no los cambia. Si al escribir el esquema aparece una ambigüedad, se corrige
`contratos.md` en este mismo PR.

**Validaciones**

- [ ] CUANDO se valida cada dato de prueba válido contra su esquema EL SISTEMA DEBE aceptarlo — prueba automática,
      salida pegada.
- [ ] CUANDO se valida un dato de prueba inválido (una capa con código, una misión con predicado vacío, una capa
      `soul` con `reetiquetar`) EL SISTEMA DEBE rechazarlo con un mensaje que nombre el campo — prueba automática.
- [ ] Existen datos de prueba para: una misión con antiobjetivo, 20 trazas de control con abandonos, su grafo, una
      capa de optimización, una capa de soul, una composición y una medición aceptada y otra rechazada.
- [ ] CUANDO se abre un PR EL SISTEMA DEBE ejecutar tipos, estilo y pruebas, y bloquear la fusión si fallan —
      captura de una ejecución en rojo y otra en verde.
- [ ] Un PR de prueba de dos capas se crea y se sincroniza con la herramienta de pilas elegida — enlace a los PRs.
- [ ] Hay un archivo de instrucciones para agentes con, y solo con, los comandos de construir, probar y validar.

**Decisiones abiertas.** Librería de esquemas, gestor de paquetes, estructura de carpetas, herramienta de pilas si
la nativa no está disponible.

**Estado del arte.** Contratos primero y cimientos en la capa inferior de la pila (guía de GitHub sobre PRs
apilados); la verdad en esquemas y pruebas, no en prosa (crítica de Fowler y Böckeler al desarrollo guiado por
specs); instrucciones para agentes cortas y con comandos (guía de Anthropic para Claude Code, AGENTS.md).

---

## B2 · Resuelve las incógnitas de plataforma

Depende de: B1 · Desbloquea: decisiones abiertas de S1, S2, E3, M4, X2 · Prioridad: imprescindible

**Objetivo.** Un informe corto en el repositorio con el resultado medido de cada incógnita que podría hundir la
construcción, y la decisión que se toma con cada una.

**Fuera de alcance.** Código que se vaya a conservar. Son pruebas de usar y tirar, de 15 minutos cada una.

**Contrato que toca.** Ninguno.

**Validaciones.** Cada línea se cierra con el comando usado, su salida y la decisión.

- [ ] CUANDO se invoca a la IA local sin herramientas y con salida estructurada EL SISTEMA DEBE devolver un objeto
      que cumple el esquema, sin haber podido usar ninguna herramienta — se anota qué opciones lo logran.
- [ ] CUANDO esa misma llamada incluye una imagen EL SISTEMA DEBE seguir devolviendo salida estructurada válida.
- [ ] CUANDO se lanzan 4 llamadas simultáneas de 10 pasos cada una, se anotan segundos por paso, tokens por paso y
      errores por límite de uso — con la sesión del plan y con clave de API.
- [ ] Con esas cifras se fija el proveedor y el modelo del enjambre y un tope de corridas para todo el evento.
- [ ] CUANDO el proceso de fondo de una extensión llama al servicio local EL SISTEMA DEBE responder sin pedir
      permisos inesperados a la persona — probado en los 4 equipos.
- [ ] CUANDO el automatizador inyecta un guion antes de la carga en una página con política de seguridad de
      contenido estricta EL SISTEMA DEBE poder leer el DOM y cambiar un estilo — se anota si hace falta alguna opción.
- [ ] CUANDO una página intenta una petición que no es de lectura hacia un tercero durante una corrida EL SISTEMA
      DEBE poder bloquearla.

**Decisiones abiertas.** Ninguna: este PR existe para cerrarlas.

**Estado del arte.** Una meta comprobable antes de construir (guía de Anthropic); decisiones registradas con
contexto, opciones y resultado (formato MADR).
