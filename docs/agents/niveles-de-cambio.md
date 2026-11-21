# Niveles de cambio a una página: del estilo a una interfaz nueva

**Qué es este documento.** Una investigación, no una decisión. Responde cuán agresivo puede ser un cambio a una
página ajena: desde cambiar colores hasta poner piezas nuevas que se acoplan con la página original, o reemplazar su
interfaz entera. Para cada nivel dice qué existe en el estado del arte, qué tan factible es y qué tendríamos que
ajustar en nuestras piezas. Es para el equipo. Conviene haber leído [la propuesta](../index.md) y
[formas de datos](../formas-de-datos.md); los términos están en el [glosario](../glosario.md).

**No se limita al alcance de la hackatón.** Se evalúan todos los niveles, también los que hoy no caben, para tenerlos
en cuenta al diseñar el formato de parche y el motor. Fecha: 2026-11-21. Lo que viene de fuentes leídas solo en parte
está marcado.

## Resumen

- **Se puede ir mucho más allá del estilo.** El techo técnico en la web es reemplazar la interfaz completa de una
  página por otra, conservando lo que hace el sitio. Un estudio con 15 personas que usan lector de pantalla bajó el
  tiempo de una tarea de unos 130 a unos 25 segundos así.
- **El mejor equilibrio está en el nivel 3: componentes acoplados.** Una pieza nueva (un asistente por pasos, un
  resumen, un botón principal claro) se dibuja encima o al lado de la página. Lee sus datos de la página original y,
  cuando la persona actúa, pulsa o rellena los elementos originales. El sitio sigue funcionando por debajo; por eso
  se puede deshacer, explicar y medir con el mismo evaluador.
- **Regenerar la página entera hoy cuesta de 1 a 5 minutos y unos 220 000 tokens por página**, y el modelo puede
  perder contenido (en el estudio borró un enlace a una garantía). Sirve si se genera una vez, se guarda y se aplica
  después sin llamar a Claude.
- **La regla que sostiene todo: Claude elige y vincula piezas de un catálogo; no escribe código.** Es lo que hace
  ABRA (EMNLP 2026) y es lo que mantiene válida la medición y la comprobación de seguridad. Dejar que Claude escriba
  el código de un componente es posible, pero rompe esas dos garantías; está evaluado en la sección 4.
- **Lo que más hay que ajustar:** el formato de parche (un cambio nuevo, `add_component`), el localizador (pasa a
  ser crítico y debe volver a buscar cuando la página cambia), el motor de parches (dibujar componentes y reenviar
  acciones) y la comprobación de seguridad (un inventario de antes y después).

## 1. La escala

Cada nivel incluye lo que permiten los anteriores. El ejemplo de la última columna usa la tarea de la PR #6 de
presentar un reclamo en dt.gob.cl.

| Nivel | Qué cambia | Quién lo hace hoy | Ejemplo en el reclamo |
|---|---|---|---|
| **0. Estilo** | Color, tipografía, espaciado, ocultar con CSS | Nuestro prototipo; las Boosts de Arc | Texto más grande, fondo oscuro |
| **1. Parche de datos** | Estilo, ocultar y renombrar un elemento concreto | Nuestro plan (PR 1 a 3) | Renombrar "Continuar" a "Siguiente paso" |
| **2. Reordenar y resaltar** | Cambiar el orden, destacar, llevar la vista a un elemento | La investigación clásica (*split menus*) | Subir el botón de enviar y resaltarlo |
| **3. Componentes acoplados** | Piezas nuevas que leen y accionan la página original | Wildcard (MIT), Interface Quilt (Autodesk), ABRA (Megagon) | Un asistente de tres pasos que rellena el formulario original |
| **4. Vista alternativa** | La página se oculta y se ve otra interfaz armada con sus datos | Estudio de Mercari para lectores de pantalla; Google Disco | Una sola pantalla con lo que importa del trámite |
| **5. Entre páginas y sitios** | Una interfaz que junta varias páginas o varios sitios | Google Disco/GenTabs (solo lectura) | El reclamo y el seguimiento en una sola vista |

Hay además dos ejes que cruzan la escala:

- **Quién escribe la pieza:** un catálogo hecho por el equipo, o código que escribe Claude. Sección 4.
- **Cómo se toca la página:** por el DOM (lo nuestro) o por píxeles, mirando la pantalla y simulando clics (lo de
  Interface Quilt). En la web el DOM es mejor en todo. Los píxeles solo hacen falta donde no hay DOM útil: páginas
  que dibujan todo en un `canvas`, como Figma o Google Docs.

## 2. Cada nivel en detalle

### Nivel 0 · Estilo

**Cómo funciona.** Una hoja CSS inyectada con origen de usuario. Funcionaba en el prototipo y
funciona en la extensión actual (`scripting.insertCSS`, [background/index.js](../../extension/src/background/index.js)).

**Factibilidad.** Alta. Instantáneo al volver a un sitio. Con CSS también se puede ocultar y reordenar dentro de un
mismo contenedor (`order`, rejilla), pero no crear elementos ni moverlos a otro contenedor.

**Límite.** Lo que aprendimos: Claude escribe la hoja sin ver el resultado y a veces rompe la página. Es la razón de
pasar a parches.

### Nivel 1 · Parche de datos

**Cómo funciona.** Lo que describe [formas de datos](../formas-de-datos.md): `set_style`, `hide` y `relabel` sobre
elementos señalados por un localizador.

**Factibilidad.** Alta. Es el plan actual. Se valida, se deshace y se mide.

**Límite.** No cambia la forma de la interacción: si un trámite tiene seis pantallas confusas, sigue teniendo seis.

### Nivel 2 · Reordenar y resaltar

**Cómo funciona.** Cambios nuevos: `move` (llevar un elemento a otro lugar), `emphasize` (darle peso visual) y
`scroll_to` (llevar la vista). [Formas de datos](../formas-de-datos.md) ya los deja "para después".

**Factibilidad.** Media, por un problema técnico concreto: **mover nodos que controla el framework del sitio puede
romper la página.** React, Vue y parecidos llevan su propio registro de qué nodo está dónde; si un nodo cambia de
padre, el siguiente render puede devolverlo a su lugar, duplicarlo o fallar. Hay tres salidas, de más a menos
segura:

1. Reordenar con CSS dentro del mismo contenedor (`order`, `grid-area`). No toca el DOM.
2. Ocultar el original y mostrar una copia en el lugar nuevo que, al pulsarse, pulsa el original. Esto ya es el
   nivel 3 en pequeño.
3. Mover el nodo de verdad, solo en páginas sin framework, comprobado por el motor.

**Lo que dice la investigación.** Mover cosas de lugar es lo que peor resultó en la historia de las interfaces
adaptativas: los menús personalizados de Office 2000 se retiraron en 2007 por impredecibles. Funciona si el cambio
ocurre pocas veces, se anuncia y la persona lo controla. Está en [la investigación previa](../investigacion-ui-adaptativa.md).

### Nivel 3 · Componentes acoplados

**Qué es.** Una pieza nueva que no existe en el sitio, dibujada por la extensión, que está **acoplada** con la
página original de tres formas:

- **Lee** de ella: textos, valores, opciones, mensajes de error.
- **Actúa** sobre ella: cuando la persona pulsa o escribe en la pieza, el motor pulsa o rellena el elemento
  original.
- **Se mantiene sincronizada**: si la página cambia (aparece un error, se carga la etapa siguiente), la pieza se
  actualiza.

Los elementos originales que la pieza reemplaza se ocultan, pero siguen en la página y siguen siendo los que hacen
el trabajo.

**Ejemplo.** El formulario de reclamo tiene 18 campos en una sola columna, con nombres técnicos. El parche agrega
un asistente de tres pasos ("Tus datos", "Tu empleador", "Qué pasó"), con nombres claros y el error de cada campo
al lado. Cada campo del asistente está vinculado a un campo del formulario original. El botón "Enviar" del asistente
pulsa el botón original. Si el sitio responde con un error, el asistente lo lee y lo muestra.

**Estado del arte.**

- **Interface Quilt** (Autodesk Research, arXiv, 1-nov-2026). Es lo más parecido. Construye "parches de interfaz"
  sobre aplicaciones de escritorio (PowerPoint, Slack, Overleaf, Fusion, Affinity) sin código fuente ni API: un
  agente explora la aplicación y un agente programador escribe el parche más una **vinculación en JSON** que dice
  qué control original acciona cada pieza. Trabaja con píxeles: reconoce los controles en la imagen y simula clics y
  teclas. Construir un parche toma "decenas de minutos". No tiene estudio con usuarios. Se rompe si la ventana
  cambia de tamaño. *(De este paper solo se leyó textual la primera parte; el resto viene de un resumen.)*
- **ABRA** (Megagon Labs, EMNLP 2026, demostración). Separa un **vocabulario fijo de vistas** (grafo, tabla, texto,
  visualización) de las **vinculaciones** de cada tarea. El agente no dibuja: crea, lee y actualiza vistas y dispara
  acciones con llamadas estructuradas (`create_canvas`, `update_canvas`, `fire_action`). Con modelos grandes, la
  vinculación de elementos fue del 100 % y las acciones de 92 % a 100 %. El modelo chico confundió actualizar con
  accionar (66,7 % en `fire_action`). No tiene estudio con usuarios.
- **Wildcard** (Litt y Jackson, MIT, 2020). Muestra los datos de una página como una tabla editable y lleva los
  cambios de vuelta a la página. Su límite declarado: alguien tiene que escribir un adaptador por sitio. En nuestro
  caso, ese adaptador es la vinculación que escribe Claude.

**Factibilidad.** Media-alta. Todas las piezas técnicas existen; el riesgo está en cuatro puntos, cada uno con
salida:

| Punto | Problema | Salida |
|---|---|---|
| Encontrar los elementos | Un campo sin nombre, dos botones iguales | El localizador por rol y nombre, con `css` para desempatar. Si no encuentra exactamente uno, el componente no se aplica. |
| Escribir en un campo | En React, asignar `input.value` no avisa al framework y el valor se pierde | Asignar con el *setter* nativo del prototipo de `HTMLInputElement` y disparar los eventos `input` y `change`. Es una técnica conocida, pero hay que probarla en los sitios reales. |
| Mantenerse sincronizado | El sitio vuelve a dibujar y la pieza queda apuntando a nodos que ya no existen | Un `MutationObserver` que vuelve a localizar. Si un elemento vinculado desaparece y no se encuentra otro, la pieza se retira y queda la página original. |
| Que el sitio no rompa la pieza | Los estilos del sitio la deforman, o el framework borra lo insertado | Dibujarla dentro de un `Shadow DOM` (un subárbol con estilos aislados) y colgarla de un contenedor propio, fuera de la raíz del framework. |

**Por qué es el mejor equilibrio.** Da el salto grande en experiencia (cambia la forma de la interacción, no solo el
aspecto) y conserva lo que hace al sistema confiable: el sitio original sigue siendo quien valida y envía; "ver
original" es quitar la pieza; y el evaluador mide la misma pieza que ve la persona.

### Nivel 4 · Vista alternativa

**Qué es.** La página original se oculta entera. La persona ve otra interfaz, armada con los datos de la página.
Las acciones siguen reenviándose al original, como en el nivel 3, pero la vista es completamente nueva.

**Estado del arte.**

- **Mercari y lectores de pantalla** (Yu, Ryskeldiev y otros; arXiv 2502.18701, ASSETS 2025, y su síntesis de 2026,
  arXiv 2604.25455). Una extensión de Chrome manda el HTML de la página, en trozos, a GPT-4o y reemplaza el DOM con
  la versión regenerada. Con 15 personas que usan lector de pantalla:
  - Valoración media: 5,0 la regenerada, 4,57 una versión que solo reordenaba etiquetas, 3,14 la original. 13 de 15
    prefirieron la regenerada.
  - Tiempo mediano de la tarea: cerca de 130 segundos en la original, cerca de 25 en la regenerada.
  - Costo: **"de 1 a 5 minutos por página" y "unos 220 000 tokens por sesión"**, entre US$0,50 y US$2,20 por página.
  - Fallo de contenido: en una prueba el modelo **borró un enlace a una garantía extendida**. Por eso solo inyectaban
    la versión nueva si su contenido era al menos 90 % similar al original (similitud media: 96,3 %).
  - Confianza: la gente prefirió la versión regenerada **"solo después de que se le dijo que era generada"**.
  - Los autores la llaman prueba de concepto. Un sitio, muestra chica. *(La parte central del paper de 2025 viene de
    un resumen.)*
- **Google Disco / GenTabs** (Google Labs, dic-2025). Un navegador experimental que arma pequeñas aplicaciones a
  partir de las pestañas abiertas, con Gemini 3. Las piezas generadas enlazan a sus fuentes, pero no accionan los
  sitios: son vistas nuevas, de lectura.

**Factibilidad.** Técnicamente posible hoy. Lo que la frena:

- **Costo y latencia**, si se regenera en cada visita. La salida es generar **una plantilla** por sitio y patrón de
  ruta (qué datos extraer y con qué componentes del catálogo mostrarlos), guardarla y aplicarla después sin llamar a
  Claude. Así cuesta lo mismo que una piel del prototipo en la segunda visita.
- **Pérdida de contenido.** Todo lo que no se ve en la vista nueva no existe para la persona. Hace falta un
  inventario: cada enlace, botón, precio y texto legal de la original tiene que estar en la vista nueva o quedar
  accesible con "ver original".
- **Fragilidad.** Si el sitio cambia su estructura, la plantilla deja de encontrar los datos. Hay que detectarlo y
  volver a la original, nunca mostrar una vista a medias.
- **Medición.** Como cambia todo, el experimento importa más: una vista nueva puede ser más bonita y peor para la
  tarea. Los agentes la recorren igual que la original.

### Nivel 5 · Entre páginas y sitios

**Qué es.** Una interfaz que junta el trabajo de varias páginas o varios sitios: llenar el reclamo y consultar su
estado en una sola vista, o comparar el mismo dato en tres sitios.

**Factibilidad.** Baja para acciones, media para lectura. Leer de varias páginas se puede (es lo que hace Disco).
Accionar varias páginas a la vez exige mantener pestañas o marcos abiertos en segundo plano, manejar sesiones y
respetar que cada sitio tiene su propio origen. Choca con dos reglas del plan: sin sesión iniciada y sin
consecuencias reales. Queda como dirección, no como objetivo.

## 3. Cómo se acopla una pieza con la página

Esto vale para los niveles 3 y 4.

**Lecturas.** Cada dato que muestra la pieza viene de un elemento original, señalado con un localizador. Lo que se
lee es texto o valor, nunca HTML: se trata como dato, no como instrucción (es la regla del plan para todo lo que
viene de una página). Los precios, números y textos legales se muestran tal cual, sin pasar por Claude.

**Acciones.** Solo las que ya existen en la página: pulsar, escribir, elegir una opción, marcar una casilla. La
pieza nunca envía una petición de red por su cuenta. Si el sitio no ofrece una acción, la pieza tampoco.

**Sincronización.** El motor observa la página. Cuando cambia, vuelve a leer los datos vinculados y a comprobar que
cada elemento sigue existiendo. Si un vínculo se rompe, la pieza se retira entera y se muestra la original: igual
que un parche de optimización, se aplica completa o no se aplica.

**Navegación.** Un trámite de varias pantallas tiene un parche por pantalla (por patrón de ruta o por etapa de la
tarea). Lo que la persona escribió en una pantalla ya está en la página original, así que la pieza no necesita
guardar estado propio entre pantallas.

**Lo que no se puede acoplar:**

- Marcos de otro origen: pagos, captchas, mapas incrustados. La extensión no puede leerlos ni accionarlos desde la
  página. Se dejan visibles tal cual.
- `Shadow DOM` cerrado de los componentes del propio sitio: no se puede entrar.
- Páginas dibujadas en un `canvas`: no hay elementos que leer. Solo se podría con píxeles, como Interface Quilt.

## 4. Quién escribe la pieza: catálogo o código generado

| | Catálogo del equipo | Código que escribe Claude |
|---|---|---|
| Qué escribe Claude | Datos: qué componente, dónde, vinculado a qué | El componente entero, en JavaScript |
| Libertad de diseño | La del catálogo | Total |
| Comprobación de seguridad | Posible: el motor sabe qué hace cada componente | Casi imposible: habría que analizar código arbitrario |
| Medición | Válida: los agentes miden lo mismo que ve la persona | Débil: el mismo parche puede comportarse distinto en cada ejecución |
| Accesibilidad | Se diseña una vez, bien | Depende de cada generación |
| Riesgo | Bajo | Alto: el código corre con los permisos de la extensión, junto a datos de la página |
| Estado del arte | ABRA, A2UI de Google, json-render | Interface Quilt, Google Generative UI |

Sobre la accesibilidad del código generado: un estudio de 2026 (Calò y otros, CHI EA) encontró 541 fallas de
accesibilidad semántica en 300 interfaces generadas por modelos de lenguaje. *(Solo se leyó el resumen de la
búsqueda.)*

**Recomendación: catálogo.** Si el catálogo se queda corto, se agrega un componente al catálogo; no se abre la puerta
al código libre. Una vía intermedia, para más adelante: Claude propone un componente nuevo como código, una persona
del equipo lo revisa y, si sirve, entra al catálogo.

Un catálogo inicial razonable:

| Componente | Para qué |
|---|---|
| `stepper` | Partir un formulario largo en pasos |
| `primary_action` | Una acción principal clara, con su nombre y su estado |
| `summary` | Un resumen de lo que hay en la página o de lo que se va a enviar |
| `compact_form` | Los campos que importan, con nombres claros y su error al lado |
| `simple_list` | Una lista o tabla con solo las columnas útiles |
| `shortcuts` | Accesos a los destinos más usados de un sitio |

## 5. Riesgos que cruzan todos los niveles

| Riesgo | Desde qué nivel pesa | Cómo se maneja |
|---|---|---|
| **Fragilidad ante cambios del sitio.** No encontramos estudios que midan cuánto dura una modificación así. | 1, y crece con cada nivel | Localizador por rol y nombre, no por clases; si algo no se encuentra, se vuelve a la original. Volver a validar antes de mostrar (la PR #6 ya lo pide). |
| **El framework del sitio pelea con los cambios.** Modificar el DOM antes de que el framework termine de cargar puede romper la página. | 2 | No mover nodos ajenos; insertar después de la carga, en un contenedor propio. |
| **Restricciones del sitio.** Algunos sitios activan *Trusted Types*, que bloquea asignar HTML como texto. | 3 | Construir los componentes con las funciones del DOM, no con `innerHTML`. Los scripts de contenido de la extensión no quedan bloqueados por la política de seguridad de la página; un `<script>` insertado en la página sí. |
| **Perder contenido o una salida.** El caso de la garantía borrada. | 3 | Inventario de antes y después en la comprobación de seguridad (sección 6). |
| **Parecer el sitio y no serlo.** Una vista nueva puede llevar a alguien a creer que el sitio dice algo que no dice, o servir de patrón oscuro. | 3 | Las piezas se ven como del producto, no como del sitio. Precios y texto legal, tal cual. Explicación visible de qué cambió y "ver original" a un clic. |
| **Confianza.** En el estudio de Mercari la preferencia apareció solo al decir que era generada. | 3 | Decirlo siempre. Es una ventaja, no algo que esconder. |
| **Impredecibilidad.** La lección de Office 2000. | 2 | Los cambios estructurales los acepta la persona, no cambian solos de una visita a otra, y se pueden congelar. |
| **Condiciones de uso de cada sitio.** | Todos, en especial la evaluación | Revisarlas antes de lanzar agentes (el plan ya lo pide). |

## 6. Qué tendríamos que ajustar

### Formato de parche

Un cambio nuevo, `add_component`, que sigue siendo datos y no código:

```json
{
  "op": "add_component",
  "component": "stepper",
  "anchor": { "role": "main", "name": "" },
  "replaces": [ { "role": "form", "name": "Formulario de reclamo" } ],
  "steps": [
    {
      "title": "Tus datos",
      "fields": [
        { "label": "Tu RUT", "element": { "role": "textbox", "name": "Rut trabajador" } },
        { "label": "Tu correo", "element": { "role": "textbox", "name": "Email" } }
      ]
    }
  ],
  "reads": {
    "error": { "element": { "role": "alert", "name": "" }, "value": "text" }
  },
  "actions": {
    "submit": { "do": "click", "element": { "role": "button", "name": "Enviar", "css": "#btnEnviar" } }
  }
}
```

- `replaces` son los elementos originales que se ocultan mientras el componente está activo.
- `reads` y `actions` solo usan localizadores; `do` admite `click`, `type`, `select` y `check`, las mismas acciones
  que ya tienen los agentes.
- Las reglas de [formas de datos](../formas-de-datos.md) siguen valiendo: primero se localiza todo y después se aplica;
  un parche de optimización se aplica entero o no se aplica; el `id` sale de los cambios.
- Para el nivel 4, un cambio `replace_view` con la misma forma, cuyo `replaces` es el contenido principal entero.

### Piezas

| Pieza | Nivel 2 | Nivel 3 | Nivel 4 |
|---|---|---|---|
| **Localizador** | Igual | **Crítico.** Volver a localizar cuando la página cambia; informar qué vínculo se rompió. | Igual que el 3, con muchos más vínculos. |
| **Motor de parches** | `move`, `emphasize`, `scroll_to`, con las reglas del nivel 2 | Dibujar componentes del catálogo en un `Shadow DOM`; reenviar acciones (con el *setter* nativo para campos de React); observar y retirar si algo se rompe. | Lo mismo, más ocultar la página completa. |
| **Catálogo de componentes** | No hace falta | Nuevo. Accesible por diseño, probado a mano. | Más componentes, para armar páginas completas. |
| **Comprobación de seguridad** | Que nada protegido quede fuera de la vista | **Inventario de antes y después**: cada elemento protegido y cada paso de la tarea sigue alcanzable, en la original o mediante un componente que hace lo mismo. Un componente nunca reemplaza un elemento protegido sin ofrecer la misma acción. | Lo mismo, más un control de contenido: lo que no está en la vista nueva queda listado y accesible. |
| **Evaluador** | Igual | Los agentes actúan sobre los componentes. El localizador debe encontrarlos por rol y nombre, igual que a los elementos del sitio. | Igual. |
| **Optimizador** | Puede proponer reordenar | Puede proponer componentes del catálogo a partir del grafo de navegación ("en la etapa 2 abandonan: un `stepper`"). | Puede proponer una vista. Su costo justifica medirla antes de mostrarla. |
| **Soul** | Igual | Los componentes leen la soul para su estilo (texto grande, colores apagados). Un parche de soul no agrega componentes: solo cambia la presentación. | Igual. |
| **Puente y Claude** | Igual | Una generación por sitio y patrón de ruta, guardada. Claude recibe el catálogo en el prompt (conviene el *prompt caching*). | Generación cara (minutos). Se hace una vez y se guarda. |
| **Extensión** | Explicar qué se movió | Mostrar qué piezas se agregaron y qué reemplazan; "ver original" quita las piezas. | Lo mismo, a un clic. |

## 7. Factibilidad resumida

| Nivel | Esfuerzo | Costo por visita | Fragilidad | Se puede medir | Veredicto |
|---|---|---|---|---|---|
| 0. Estilo | Hecho | Cero (caché) | Baja | Sí | Ya existe |
| 1. Parche de datos | Bajo | Cero (caché) | Baja | Sí | El plan actual |
| 2. Reordenar y resaltar | Bajo a medio | Cero (caché) | Media (frameworks) | Sí | Siguiente paso natural |
| 3. Componentes acoplados | Medio: catálogo, motor, reenvío de acciones | Cero (caché); una generación por sitio y ruta | Media | Sí | **El que más mejora la experiencia sin perder garantías** |
| 4. Vista alternativa | Alto | Cero si se guarda; de 1 a 5 min y unos 220 000 tokens si se regenera | Alta | Sí, y hace más falta | Posible con plantillas guardadas e inventario |
| 5. Entre páginas y sitios | Muy alto | Alto | Muy alta | Difícil | Dirección, no objetivo |
| Código generado por Claude | Bajo de hacer, alto de asegurar | Variable | Alta | No de forma confiable | No, salvo que entre al catálogo tras revisión |

## 8. Lo que no sabemos y cómo averiguarlo

Tres spikes posibles, en el formato de [.spikes/README.md](../../.spikes/README.md):

1. **Reenvío de acciones en sitios reales.** ¿Un componente puede rellenar y enviar los formularios de las tareas
   de la PR #6, incluido alguno hecho con React? Se decide de antemano: sirve si en las tres tareas el sitio acepta
   los valores escritos desde el componente y muestra sus errores en él.
2. **Claude vincula componentes del catálogo.** Con el catálogo de la sección 4 y la estructura de la página en
   texto, ¿Claude produce un `add_component` cuyos localizadores encuentran exactamente un elemento cada uno? El
   umbral del spike 1 del plan sirve aquí: 4 de 5.
3. **Costo de una vista alternativa.** ¿Cuánto tarda y cuántos tokens gasta Claude en producir una plantilla de
   nivel 4 para una página real, y el inventario detecta lo que se pierde? Comparar con los 1 a 5 minutos de Mercari.

Preguntas que ningún spike contesta:

- Si lo que mejora para un agente mejora para una persona. Con componentes nuevos la distancia puede ser mayor: un
  agente no se confunde por una interfaz que no reconoce, y una persona sí.
- Cuánto dura un parche antes de que el sitio cambie. No hay estudios; habría que medirlo en el tiempo.

## 9. Lo que mostró el spike de alcance en wom.cl (2026-11-21)

Un [spike](../../.spikes/2026-11-21-alcance-cambios-wom.md) aplicó parches de los niveles 1 a 5 sobre wom.cl para la
tarea de dar de baja Internet Fibra. Los escribió Claude a mano, haciendo de optimizador. Las rutas son guiones fijos,
una ejecución por nivel; no hay intentos de agentes.

**Lo que confirma.** Se llegó al nivel 5 sin romper la página. Una ruta escrita a mano pasó de 7 acciones en el sitio
original a 4 con los niveles 1 y 2, a 1 con el nivel 3 y a 0 con el nivel 5. El nivel 4 no ahorró acciones respecto
del 3 y escondió 45 enlaces. Coincide con la sección 7: el nivel 3 es el mejor equilibrio.

**Lo que corrige o agrega a este documento:**

| Sección | Qué dice | Qué mostró el spike |
|---|---|---|
| 2, nivel 1 | `hide` oculta un elemento | Con una regla CSS, dos elementos siguieron visibles: las clases de Bootstrap del sitio llevan `!important` y ganan. El programa los dio por ocultos. |
| 2, nivel 1 | — | Ocultar un popup deja la página sin scroll. Hay que pulsar su cierre: hace falta un cambio `press`, que no se puede deshacer. |
| 3 y 6 | `reads` lee un elemento | Hizo falta leer una lista. Mal acotada, trajo 11 elementos en vez de 3 y nada lo detectó. El parche debe declarar cuántos espera. |
| 3 | Un parche se aplica entero o no se aplica | El popup sale una vez por sesión y «Ayuda» aparece dos veces en celular. Hace falta marcar cambios opcionales y aplicar «entero o nada» por grupo. |
| 2 y 5 | El localizador usa rol y nombre | Alcanzó para 8 de 9 controles y textos. Los 11 contenedores solo se encontraron por `css`. |
| 3 | La pieza nunca envía una petición | El nivel 5 leyó otra página del mismo sitio, sin credenciales, y funcionó. Es lo que más ahorra. Queda como decisión del equipo. |
| 5 y 6 | Inventario de antes y después | Sirvió: detectó canales de contacto y controles de accesibilidad escondidos. Comparando por texto, contó un renombre como pérdida. |

**Lo que el spike no cubre.** wom.cl usa jQuery y Bootstrap, sin React: no prueba los riesgos de la sección 2 sobre
frameworks ni el reenvío a formularios. Corrió en Chromium y en la página, no en Firefox ni como script de contenido.
Los spikes 1 y 2 de la sección 8 siguen pendientes.

## Fuentes

Leídas (al menos en parte):

- Qiu, Vermeulen, Zindulka, Fitzmaurice y Anderson. *Interface Quilt: Modifying Applications with Computer Use
  Agents and Generative UI.* Autodesk Research, 2026. <https://arxiv.org/abs/2611.01891> *(primera parte textual,
  resto por resumen)*
- Kim y Kim. *ABRA: Agent-Bound UI for Human-Agent Communication beyond Chat with Reusable Views.* EMNLP 2026
  System Demonstrations. <https://arxiv.org/abs/2610.30780>
- Ryskeldiev. *Generative UI as an Accessibility Bridge: Lessons from C2C E-Commerce.* 2026.
  <https://arxiv.org/abs/2604.25455>
- Yu, Ryskeldiev, Tsutsui, Gillingham y Wang. *LLM-Driven Optimization of HTML Structure to Support Screen Reader
  Navigation.* 2025. <https://arxiv.org/abs/2502.18701> *(parte central por resumen)*

Solo por resultados de búsqueda:

- Litt y Jackson. *Wildcard: Spreadsheet-Driven Customization of Web Applications.* MIT, 2020.
  <https://www.geoffreylitt.com/wildcard/salon2020/>
- Ink & Switch. *Malleable software.* <https://www.inkandswitch.com/essay/malleable-software/>
- Google Labs. *GenTabs en Disco.* Dic-2025. <https://blog.google/technology/google-labs/gentabs-gemini-3/>
- Calò y otros. Fallas de accesibilidad semántica en interfaces generadas por modelos de lenguaje. CHI EA 2026.
- *Generative UI: LLMs are Effective UI Generators.* 2026. <https://arxiv.org/abs/2604.09577>

Ver también [la investigación previa](../investigacion-ui-adaptativa.md), con la historia de las interfaces
adaptativas y los protocolos de UI generativa (MCP Apps, A2UI).
