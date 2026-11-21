# Contratos

Lo único rígido del proyecto. Las palabras DEBE, NO DEBE y DEBERÍA se usan en sentido estricto. Los ejemplos fijan
nombres y formas; los tipos exactos viven en los esquemas que entrega el PR B1. Identificadores en español sin tildes
ni eñes; JSON en `snake_case`; todo objeto guardado lleva `version_esquema`.

**Lo que este documento deja abierto a propósito.** Listas y umbrales que se fijan con pruebas en el PR que los
implementa: las propiedades CSS permitidas, las tolerancias de las puertas, el umbral de "asimétrico", el léxico de
salida completo y cuántas cargas fallidas vuelven `desactualizada` una composición. Quien los fije los deja escritos
en el esquema o en sus pruebas.

## 1. Vocabulario

| Término | Definición |
|---|---|
| **Sitio** | Host de la página, con puerto si no es el estándar. |
| **Patrón de ruta** | Primer segmento de la ruta más `/*` si hay más; `*` significa todo el sitio. |
| **Huella** | Identificador estable de un elemento: rol, nombre accesible y un selector de respaldo. |
| **Capa** | Lista de operaciones sobre un sitio. Inmutable. De tipo `optimizacion` o `soul`. |
| **Composición** | Lista ordenada de capas de optimización sobre un origen. Vacía es el **control**. Inmutable. |
| **Soul** | Preferencias de la persona, legibles y editables. |
| **Capa de soul** | Capa generada desde la soul para un sitio. Se aplica encima de la composición; no forma parte de ella. |
| **Misión** | Lo que se intenta en un sitio: descripción, criterio de éxito, hitos, antiobjetivos. |
| **Hito** | Etapa de una misión, definida por un predicado evaluable por código. |
| **Antiobjetivo** | Misión contraria que no debe empeorar (salir, rechazar, quitar un extra). |
| **Persona** | Perfil de conducta de un agente. La **persona-soul** navega como el usuario. |
| **Corrida** | Un intento de una misión por una persona sobre una composición. |
| **Lote** | Conjunto de corridas lanzadas juntas, con un presupuesto. |
| **Traza** | Registro paso a paso de una corrida. |
| **Grafo de navegación** | Agregado de trazas: hitos, transiciones y conteos. |
| **Medición** | Comparación de una composición contra una base (por defecto, el control) para una misión. |

## 2. Composición

1. El orden de aplicación DEBE ser: origen → capas de la composición → capa de soul.
2. Una capa `soul` solo DEBE cambiar presentación: estilo, y ocultar elementos no protegidos. Una capa
   `optimizacion` puede además cambiar estructura y etiquetas con las operaciones de §4.
3. Las puertas (§5) DEBEN evaluarse sobre el resultado completo, con la capa de soul puesta si la hay.
4. Toda medición DEBE referirse a una composición concreta. Lo medido sin soul NO DEBE presentarse como medido con
   soul.
5. Si una operación no encuentra su elemento, queda `rota`; nunca se adivina el objetivo. Una capa `optimizacion`
   con una operación `rota` DEBE retirarse entera, porque se midió entera. Una capa `soul` se aplica operación a
   operación.
6. El mismo motor DEBE producir el mismo resultado en la extensión y en el enjambre.
7. Cuando una operación de soul y una de optimización tocan la misma propiedad del mismo elemento, gana la de soul y
   el motor DEBE informarlo.

## 3. Huella

```json
{ "rol": "button", "nombre": "Ir a pagar", "css": "#checkout", "indice_entre_iguales": 0 }
```

- Resolver: primero `rol` + `nombre`. Si hay varios candidatos, `css` desempata entre ellos; si no hay ninguno, se
  busca por `css`. Si al final no queda exactamente uno, no resuelve.
- `indice_entre_iguales` es informativo. NO DEBE usarse para desempatar.
- Si una capa cambia el nombre de un elemento, la resolución DEBE seguir usando el nombre original.
- Hay una sola implementación de calcular y resolver, dentro del motor. La misma entrega la lista de elementos
  interactivos visibles que usan la observación del agente y la generación de capas.

## 4. Capa

```json
{
  "version_esquema": 1,
  "id": "c-3f9a1c0b77de",
  "sitio": "tienda.localhost:4173",
  "patron_ruta": "/carrito",
  "tipo": "optimizacion",
  "origen": "optimizador | manual | soul",
  "nombre": "Botón de pago inequívoco",
  "hipotesis": "Dos botones dicen 'Continuar'; la mayoría abandona en el carrito.",
  "hito_objetivo": "carrito",
  "ops": [
    { "op": "reetiquetar", "objetivo": { "rol": "button", "nombre": "Continuar" }, "valor": "Ir a pagar" },
    { "op": "css", "objetivo": { "rol": "button", "nombre": "Continuar" }, "props": { "background-color": "#0b5" } }
  ]
}
```

| Operación | `optimizacion` | `soul` | Regla |
|---|---|---|---|
| `css` | sí | sí | Solo propiedades de presentación de una lista permitida. NO DEBE cargar recursos externos ni usar propiedades que oculten, desplacen o desactiven elementos. |
| `ocultar` | sí | sí | NO DEBE aplicarse a elementos protegidos ni de hito, ni a un contenedor que los incluya. |
| `resaltar` | sí | no | NO DEBE ser asimétrico entre opciones protegidas. |
| `mover_antes` | sí | no | NO DEBE mover elementos protegidos. |
| `reetiquetar` | sí | no | NO DEBE aplicarse si el nombre original contiene moneda, número o un término legal o de salida. El valor nuevo NO DEBE contener moneda, número, urgencia ni promesas. |
| `llevar_a` | sí | no | Solo desplazamiento y foco. NO DEBE hacer clic. |

- Una capa NO DEBE contener código ejecutable.
- En una capa `soul`, el objetivo de un `css` puede ser un grupo en vez de una huella:
  `{ "grupo": "enlaces | parrafos | titulos | campos | botones", "dentro_de": <huella o null> }`. El grupo excluye
  siempre a los protegidos. `ocultar` NO admite grupos. `hipotesis` y `hito_objetivo` son nulos.
- El `id` es `c-` más un resumen de `sitio`, `patron_ruta`, `tipo` y `ops`. Dos capas con las mismas operaciones son
  la misma capa, aunque cambie su nombre o su hipótesis.

## 5. Elementos protegidos y puertas

**Protegidos** (calculados por código, no declarados por el modelo): opciones de un grupo de selección; botones
hermanos de un diálogo; casillas de términos o consentimiento; elementos cuyo nombre pertenece al léxico de salida
("no, gracias", "cancelar", "rechazar", "quitar", "volver", "cerrar sesión" y equivalentes); precios y texto legal,
sean o no interactivos.

**Elementos de hito**: las huellas nombradas en los predicados de la misión y las acciones que, en el grafo del
control, llevan de un hito al siguiente (`accion_huella` de las transiciones con éxito).

**Puertas.** Tras aplicar todo, cada elemento protegido o de hito DEBE seguir visible, clicable, con contraste de
texto no menor que el menor entre 4,5:1 y el que tenía en el origen, y con área no menor que la original. Si una
puerta falla por la composición, la composición NO DEBE quedar aplicada. Si falla por la capa de soul, se retira la
capa de soul y la composición queda.

## 6. Composición guardada

```json
{ "version_esquema": 1, "id": "k-91be02aa41c3", "sitio": "tienda.localhost:4173",
  "capas": ["c-3f9a1c0b77de"], "firma_origen": "…", "estado": "vigente | desactualizada" }
```

- Contiene solo capas `optimizacion`. Así una medición vale para cualquier persona y la soul nunca viaja con ella.
- El `id` es `k-` más un resumen del sitio y de la lista ordenada de capas. El control es la composición con
  `capas: []`; su `id` se deriva igual. `estado` es el único campo que cambia.
- Una composición vale para todo el sitio; el motor aplica en cada ruta las capas cuyo patrón coincide.
- `firma_origen` la calcula el motor. Si cambia, solo DEBE avisar. Una operación `rota` o una puerta fallida,
  repetida en cargas sucesivas, vuelve la composición `desactualizada` y deja de aplicarse.

**Informe de aplicación**, que el motor devuelve en cada carga, igual en la extensión y en el enjambre:

```json
{ "composicion_id": "k-…", "capa_soul_id": "c-… | null", "aplicadas": [], "rotas": [], "pisadas_por_soul": [],
  "puertas": { "pasa": true, "fallos": [] }, "firma_coincide": true }
```

## 7. Misión

```json
{
  "version_esquema": 1, "id": "comprar-un-producto", "sitio": "tienda.localhost:4173",
  "url_inicio": "http://tienda.localhost:4173/",
  "descripcion": "Compra una taza y llega a la confirmación.",
  "criterio_exito": { "ruta_regex": "^/confirmacion" },
  "hitos": [ { "id": "catalogo", "orden": 0, "predicado": { "ruta_regex": "^/$" } },
             { "id": "carrito", "orden": 2, "predicado": { "ruta_regex": "^/carrito" } } ],
  "antiobjetivos": [ { "id": "sin-seguro", "descripcion": "Compra la taza sin el seguro añadido.",
                       "criterio_exito": { "huella_visible": { "rol": "status", "nombre": "Sin seguro" } } } ],
  "max_pasos": 20, "efectos": "ninguno | reversibles | reales", "aprobada_en": "2026-11-21T12:00:00Z"
}
```

- Un predicado combina `ruta_regex`, `huella_visible` y `texto_regex`; NO DEBE estar vacío.
- Éxito e hitos DEBEN evaluarse por código, nunca por lo que diga el agente. Si ningún predicado se cumple, el hito
  es `_fuera`.
- Con `efectos: "reales"`, el paso irreversible NO DEBE ejecutarse: el criterio de éxito se corta antes.
- Sin `aprobada_en`, puesto por una persona, NO DEBE lanzarse un lote.

## 8. Traza

JSONL: una cabecera, N pasos y un cierre por corrida.

```json
{"tipo":"corrida","id":"r-…","lote_id":"l-…","mision_id":"comprar-un-producto","antiobjetivo_id":null,"composicion_id":"k-…","capa_soul_id":null,"persona_id":"impaciente","replica":3,"origen":"agente|humano","modelo_id":"…","observacion":"hibrida|sin_captura"}
{"tipo":"paso","corrida_id":"r-…","idx":0,"hito":"catalogo","accion":{"tipo":"click|escribir|elegir|scroll|volver|listo|rendirse","huella":{}},"razon":"…","captura":"…","ms":2100}
{"tipo":"fin","corrida_id":"r-…","resultado":"exito|abandono|tope|error","causa_fallo":"agente|interfaz|null","n_pasos":9,"hito_final":"carrito"}
```

- La observación híbrida DEBE numerar solo elementos visibles y no tapados.
- `tope` cuenta como abandono en el hito donde ocurrió. `error` NO DEBE contar en las tasas.
- Una traza humana NO DEBE guardar lo que la persona escribe ni llevar capturas.

**Persona**

```json
{ "id": "impaciente", "descripcion": "Abandona si no ve progreso en tres pasos.", "grupo": "optimiza | reservado | soul", "parametros": {} }
```

Las personas del grupo `reservado` NO DEBEN usarse para proponer capas; solo para validar.

## 9. Grafo de navegación

```json
{ "version_esquema": 1, "mision_id": "…", "composicion_id": "k-…", "origen": "agente | humano", "n_corridas": 40,
  "hitos": [ { "id": "carrito", "visitas": 31, "abandonos": 17, "abandonos_interfaz": 14, "pasos_medianos": 4 } ],
  "transiciones": [ { "desde": "carrito", "hacia": "datos", "accion_huella": {}, "n": 14, "n_exito": 12 } ],
  "elementos_por_hito": { "carrito": [ { "rol": "button", "nombre": "Continuar" } ] },
  "ejemplos_fallo": [ { "corrida_id": "r-…", "hito": "carrito", "razones": ["…"], "captura": "…" } ] }
```

- Se calcula desde las trazas y NO DEBE editarse a mano.
- Los nodos son hitos, para que el control y cualquier composición sean comparables aunque una capa cambie
  etiquetas. Admite ciclos y transiciones de un hito a sí mismo. Hay una transición por cada terna distinta de
  origen, destino y acción.
- Los recorridos de agentes y los humanos van en grafos separados; NO DEBEN sumarse.

## 10. Medición

```json
{ "version_esquema": 1, "mision_id": "…", "base_id": "k-…", "composicion_id": "k-…",
  "con_soul": false, "capa_soul_id": null,
  "objetivo": { "n_base": 40, "exito_base": 0.30, "n_comp": 24, "exito_comp": 0.75, "ic95_diferencia": [0.20, 0.66] },
  "antiobjetivos": [ { "id": "sin-seguro", "n": 12, "exito_base": 0.83, "exito_comp": 0.75, "ic95_diferencia": [-0.39, 0.24], "rechaza": false } ],
  "control_aa": { "ic95_diferencia": [-0.22, 0.26], "valido": true },
  "placebo": { "ic95_diferencia": [-0.20, 0.25], "valido": true },
  "veredicto": "aceptada | rechazada | no_concluyente" }
```

- `base_id` es por defecto el control. Puede ser otra composición para medir la mejora marginal de una capa.
  `con_soul: true` exige `capa_soul_id`; esa medición es personal y NO DEBE exportarse.
- `control_aa`: la base partida en dos mitades y comparada consigo misma. Es válido si su intervalo contiene 0.
  `placebo` es opcional: una capa sin efecto esperado, válida si su intervalo contiene 0.
- Un antiobjetivo **rechaza** si el límite superior del intervalo de su diferencia es menor que 0.
- `aceptada`: el límite inferior del intervalo del objetivo es mayor que 0, ningún antiobjetivo rechaza y
  `control_aa` es válido.
- `rechazada`: algún antiobjetivo rechaza, o el límite superior del intervalo del objetivo es menor que 0.
- `no_concluyente`: cualquier otro caso, incluido un `control_aa` o un `placebo` no válido.
- Toda cifra mostrada a una persona DEBE ir con su N y su intervalo. Una medición aceptada es evidencia sobre
  agentes, y DEBE presentarse así.

## 11. Soul

```json
{ "version_esquema": 1,
  "preferencias": [ { "id": "p-01", "texto": "Prefiere fondos oscuros y texto grande", "alcance": "global | sitio", "sitio": null, "fuente": "dicha | inferida" } ],
  "tokens": { "esquema": "oscuro", "densidad": "comoda", "tamano_texto": "grande", "movimiento": "reducido" },
  "persona_evaluadora": "Lee poco; abandona si hay más de dos pasos sin progreso visible." }
```

- La soul, sus capas, las trazas humanas y las capturas NO DEBEN salir del equipo de la persona. Única excepción: lo
  necesario para generar una capa o para correr la persona-soul puede enviarse al proveedor de IA que la persona
  configuró, y eso DEBE decírsele antes del primer envío.
- La persona DEBE poder ver, corregir y borrar su soul. `tokens` y `persona_evaluadora` se derivan de las
  preferencias y la persona puede corregirlos.
- Una capa de soul guardada caduca cuando cambia la soul.
- La persona-soul DEBE aplicar los `tokens` por código en el navegador del agente, no solo como texto en el prompt.

## 12. Almacén local

```
<raiz>/
  soul/            la soul, sus capas por sitio, sus registros
  sitios/<sitio>/  misiones/ · capas/ · composiciones/ · lotes/ · corridas/ · grafos/ · mediciones/ · activa.json
```

```json
{ "version_esquema": 1, "composicion_id": "k-…", "forzada": false, "capa_soul_id": "c-… | null", "soul_activa": true }
```

- Capas y composiciones son inmutables. `activa.json` dice qué composición aplica la extensión y qué capa de soul va
  encima.
- Las capas de soul viven bajo `soul/`, nunca bajo `sitios/`. Lo que está bajo `sitios/` se puede exportar, salvo
  trazas humanas, capturas y mediciones con soul.
- Una composición DEBERÍA pasar a activa solo con una medición `aceptada` y la aprobación de una persona; forzarla
  DEBE quedar marcado en `forzada`.
- Lo importado de otra persona DEBE quedar marcado como ajeno y no medido aquí.
- La extensión NO DEBE leer el disco: pide al servicio local y guarda una copia.
- Una sola biblioteca escribe en el almacén; todas las pilas guardan y leen por ella.

## 13. Servicio local

- Es un solo proceso. Escucha solo en la máquina de la persona y DEBE exigir un secreto de emparejamiento.
- NO DEBE aceptar peticiones que no vengan de la extensión emparejada; en particular, las originadas por una página
  web.
- Lo que llega de una página (estructura, nombres, texto) DEBE tratarse como datos, nunca como instrucciones.
- Cada pila añade sus rutas a ese proceso; ninguna levanta un segundo servicio.
