# Tareas en sitios chilenos para la validación con agentes

Propuesta para la pregunta abierta 6 de [.specs/MVP.md](../.specs/MVP.md): *¿qué tareas se usan en la validación con
agentes, y en qué sitio?* Son tres tareas en sitios reales donde una persona se pierde. Las tres se completan **sin
sesión iniciada** y se comprobaron con clics el 21-nov-2026. Nada de esto es código todavía.

## Las tres tareas

Cada tarea tiene la forma de la sección 9 del MVP: `{ sitio, url_inicial, instruccion, respuesta_esperada }`.

### 1. WOM: dar de baja Internet Fibra

| | |
|---|---|
| `sitio` | `www.wom.cl` |
| `url_inicial` | <https://www.wom.cl/> |
| `instruccion` | "Encuentra cómo dar de baja tu servicio de Internet Fibra." |
| `respuesta_esperada` | Llamar al **103** desde una línea WOM, o al **22 337 7600**. |

**Por qué sirve.** Es un patrón oscuro:
- La portada tiene más de 7 enlaces para contratar Fibra y ninguno para darse de baja.
- Al entrar, un popup de promoción ("Pórtate con planes desde $8.990") y el aviso de cookies tapan la página.
- El artículo de baja está al final de una lista de unos 69 enlaces.
- Antes de dar los canales, el artículo ofrece planes: "siempre tenemos los mejores planes para ti".
- Contratar se hace online; darse de baja, solo por teléfono o WhatsApp.

**Ruta comprobada (5 pasos):**
1. Cerrar el popup.
2. Pasar el cursor por **Ayuda**.
3. Clic en **Ir al Centro de Ayuda**.
4. Clic en **Internet Fibra**.
5. Clic en **¿Dónde puedo dar de baja mi servicio de Internet Fibra?**, al final de la lista.

La tarea termina en el artículo. No se llama ni se escribe a nadie.

### 2. SII: exención de contribuciones para mayores de 65 años

| | |
|---|---|
| `sitio` | `www.sii.cl` |
| `url_inicial` | <https://www.sii.cl/> (redirige a `homer.sii.cl`) |
| `instruccion` | "Tienes 67 años: encuentra hasta cuándo puedes pedir la exención de contribuciones de tu vivienda principal." |
| `respuesta_esperada` | Hasta el **31 de diciembre de 2026**. |

**Por qué sirve.** Es noticia esta semana, el público lo reconoce y tiene trampas:
- El único enlace visible con "contribuciones" en la portada es **Pagar contribuciones**, que lleva a pagar.
- El banner de la exención es una de las 5 vistas de un carrusel que cambia solo, cada pocos segundos.
- "Beneficio persona mayor" y "Exención contribuciones vivienda principal" conviven y se confunden.
- El enlace del menú con el nombre exacto de la exención lleva directo al formulario, que pide sesión.
- La ruta que funciona pasa por un menú de unos 108 enlaces con jerga (F22, DTE, ROL, avalúo).

**Ruta comprobada (3 pasos):**
1. **Servicios online**.
2. **Avalúos y contribuciones de bienes raíces**.
3. **requisitos para la exención**.

La tarea termina en la página de requisitos. La solicitud pide sesión y queda fuera.

### 3. Dirección del Trabajo: reclamo por despido

| | |
|---|---|
| `sitio` | `www.dt.gob.cl` |
| `url_inicial` | <https://www.dt.gob.cl/portal/1626/w3-channel.html> |
| `instruccion` | "Te despidieron y crees que fue injustificado: llega al trámite para reclamar ante la Inspección del Trabajo." |
| `respuesta_esperada` | La ficha **Ingreso de Reclamo por Despido** (`w3-article-125086.html`). |

**Por qué sirve:**
- Al entrar, un popup ("DT Alerta") tapa la página.
- La portada no dice "despido" ni "finiquito".
- La página de trabajadores lista 28 trámites.
- **Ratificación de un finiquito** aparece antes que el trámite correcto, y es fácil caer ahí.

**Ruta comprobada (3 pasos):**
1. Cerrar el popup.
2. **Ir a Trámites y servicios para trabajadores**.
3. **Ingreso de Reclamo por Despido**.

La tarea termina en la ficha. Ingresar el reclamo pide ClaveÚnica y queda fuera.

## Cómo se comprobaron

- Con Playwright y el Chrome instalado, sin ventana y con un user-agent de navegador normal.
- En cada paso se pulsó el enlace por su rol y su nombre visible, se esperó a que cargara la página y se tomó una
  captura.
- La tarea se dio por cumplida si la URL final y el texto de la respuesta esperada coincidían.
- Las tres se cumplieron.

Lo que aprendimos y conviene llevar al agente cuando se construya:

- **Los popups bloquean primero.** En WOM y en la Dirección del Trabajo el primer intento se quedó pegado en el
  popup, igual que le pasaría a una persona. Es una fricción que el recorrido debería registrar.
- **Hay que pulsar solo elementos visibles.** Los tres sitios repiten sus enlaces en menús ocultos (versión móvil,
  megamenús). Si se pulsa el primero que coincide con el nombre, el clic no llega.
- **Hay que esperar a que la página cargue.** La página de requisitos del SII se arma con JavaScript. Su HTML inicial
  trae casi nada.
- **Los sitios cambian.** La promo de WOM y el carrusel del SII son de esta semana. Hay que volver a comprobar las
  rutas justo antes de la demo.

## Sitios descartados

| Sitio | Motivo |
|---|---|
| Registro Civil | Muro anti-bot (F5) con CAPTCHA de imagen. |
| FONASA, TGR, ChileAtiende | Responden 403 al navegador sin interfaz por defecto. ChileAtiende además está bien diseñado. |
| Comisaría Virtual | Buena tarea de jerga: 28 tarjetas en mayúsculas, como HURTO SIMPLE y ROBO POR SORPRESA. Bloquea al navegador sin interfaz por defecto; falta probarla con un user-agent normal. |
| Movistar, Smart Fit, Entel | Las páginas de ayuda responden 403 o se arman enteras con JavaScript. |
| Enel, Aguas Andinas | Bloqueo de Imperva ("Pardon Our Interruption"). |
| Bancos, Sky | Muestran una página de error a los bots o no traen enlaces en el HTML. |
| Conservador de Bienes Raíces | Ya es moderno y tiene modo oscuro propio: el antes y el después no se notarían. |

**Otros candidatos sin comprobar:**
- MINVU: los subsidios se nombran por decreto (DS1, DS49).
- CGE: el teléfono de emergencia solo aparece en el pie de página.
- JetSMART: el equipaje de mano cuesta de $12.900 a $34.000 según cuándo se compre.

## Cifras para el pitch

Según la investigación, estas cifras se revisaron en su fuente original, salvo la marcada.

- El **94,7%** de 228 páginas, de 74 sitios chilenos, tiene barreras de accesibilidad detectables. El problema más
  común es el contraste, en el 82,9% de las páginas.
  [Árbol Digital, 2025](https://arboldigital.cl/blog/primera-radiografia-de-la-accesibilidad-web-en-chile)
- El **88%** de los hogares con personas mayores tiene Internet, pero solo el **41–42%** de los mayores lo usa.
  Además, los mayores ponen nota **3,3 de 7** a su habilidad para hacer un trámite online.
  [Observatorio del Envejecimiento UC, 2024](https://observatorioenvejecimiento.uc.cl/wp-content/uploads/2024/06/Poblacion-mayor-%C2%BFHacia-la-superacion-de-la-brecha-digital.pdf)
- Solo el **69%** de las personas puso nota 6 o 7 a la facilidad de su trámite con el Estado.
  [MESU 2025](https://satisfaccion.gob.cl/informacion-de-interes/noticias/medicion-de-satisfaccion-usuaria-mesu-2025-69-de-las-personas-evaluo-con-nota-6)
- El **64%** de 107 tiendas online usaba al menos un patrón oscuro.
  [SERNAC, 2021](https://www.sernac.cl/portal/604/w3-article-62982.html)
- Por la Ley 21.180, todos los trámites del Estado deben ser digitales a fines de 2027.
  [digital.gob.cl](https://digital.gob.cl/transformacion-digital/ley-de-transformacion-digital/) (solo se comprobó
  en el resumen del buscador).

**Cuidado con lo legal:** no hay una ley general en Chile que obligue a facilitar la baja de cualquier servicio. Para
telecomunicaciones, el SERNAC indica que darse de baja no puede ser más difícil que contratar; falta confirmar el
texto de esa regla antes de citarla.
