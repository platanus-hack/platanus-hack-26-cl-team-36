# Misiones en sitios chilenos reales

Tres misiones validadas, sin sesión iniciada, para que el enjambre las intente y para mostrar el antes y el después
en la demo. Cada una es un caso donde una persona real se pierde, y cada una tiene una ruta que **sí** llega a la meta,
comprobada con clics.

| Misión | Sitio | Pasos | Por qué sirve |
|---|---|---|---|
| `wom-baja-fibra`: encuentra cómo dar de baja tu Internet Fibra | wom.cl | 5 | Patrón oscuro: hay más de 7 enlaces para contratar y ninguno para darse de baja. Un popup de promoción tapa la portada. La baja está al final de una lista de unos 69 enlaces y ofrece planes antes de dar los canales. |
| `sii-exencion-contribuciones`: tienes 67 años, ¿hasta cuándo pides la exención de contribuciones? | sii.cl | 3 | Jerga y trampas: el único enlace visible con «contribuciones» es «Pagar contribuciones». El banner bueno rota en un carrusel de 5 vistas. Es noticia esta semana: el plazo es el 31-dic-2026. |
| `dt-reclamo-despido`: te despidieron mal, llega al trámite para reclamar | dt.gob.cl | 3 | Hay un popup al entrar y 28 trámites en la lista. «Ratificación de un finiquito» aparece antes que el trámite correcto. |

Las rutas, los criterios de éxito y las trampas están en [misiones.json](misiones.json). Las misiones terminan donde
empieza la sesión o el efecto real: un artículo de ayuda, una página de requisitos o la ficha del trámite.

## Validar

```bash
cd misiones && npm install
node validar.mjs                      # las tres
node validar.mjs wom-baja-fibra       # una
node validar.mjs --visible            # con ventana
```

Usa el Chrome instalado (Playwright, canal `chrome`) con un user-agent de navegador normal. Deja una captura por paso
en `misiones/capturas/<id>/`, fuera de git. Sale con código 1 si alguna misión falla.

Resultado del 21-nov-2026:

```
wom-baja-fibra               ✅ ÉXITO en 5 pasos (url ok · texto «Llamando al 103» ok)
sii-exencion-contribuciones  ✅ ÉXITO en 3 pasos (url ok · texto «31 de diciembre de 2026» ok)
dt-reclamo-despido           ✅ ÉXITO en 3 pasos (url ok · texto «Ingreso de Reclamo por Despido» ok)
```

**Los sitios cambian.** La promo de WOM y el carrusel del SII son de esta semana. Corre `validar.mjs` antes de la
demo, y si una misión falla, mira su captura antes de tocar el JSON.

## Lo que aprendimos al recorrerlas

- **Los popups bloquean primero.** En WOM y en la Dirección del Trabajo el primer intento automático se quedó pegado
  en el popup, igual que le pasaría a una persona. Por eso `cerrar_popups` es un paso explícito: el grafo puede
  mostrarlo como fricción.
- **Hay que pulsar solo elementos visibles.** Los tres sitios repiten los enlaces en menús ocultos (versión móvil,
  megamenús). Si el agente pulsa el primero que coincide con el nombre, se queda esperando.
- **Hay que esperar a que la página cargue.** La página de requisitos del SII se arma con JavaScript (SvelteKit). Su
  HTML inicial trae casi nada.

## Descartados, y por qué

| Sitio | Motivo |
|---|---|
| Registro Civil | Muro anti-bot (F5) con CAPTCHA de imagen. |
| FONASA, TGR, ChileAtiende | Responden 403 al navegador sin interfaz por defecto. ChileAtiende además está bien diseñado. |
| Comisaría Virtual | 28 tarjetas con jerga penal (HURTO SIMPLE, ROBO POR SORPRESA). Es buena misión, pero bloquea al navegador sin interfaz: pendiente de validar con este user-agent. |
| Movistar, Smart Fit, Entel | Las páginas de ayuda responden 403 o son SPA. |
| Enel, Aguas Andinas | Imperva/Incapsula («Pardon Our Interruption»). |
| Bancos, Sky | Muestran una página de error a los bots o son SPA con 0 enlaces en el HTML. |
| Conservador de Bienes Raíces | Ya es moderno y tiene modo oscuro propio: el antes y el después no se notarían. |

Otros candidatos sin validar: MINVU (subsidios con nombre de decreto, DS1/DS49), CGE (el teléfono de emergencia
solo aparece en el pie), JetSMART (el precio del equipaje va de $12.900 a $34.000 según cuándo lo compres).

## Cifras para el pitch

Según los agentes de investigación, estas cifras se revisaron en su fuente original, salvo la marcada.

- El **94,7%** de 228 páginas, de 74 sitios chilenos, tiene barreras de accesibilidad detectables. El problema más
  común es el contraste, en el 82,9% de las páginas.
  [Árbol Digital, 2025](https://arboldigital.cl/blog/primera-radiografia-de-la-accesibilidad-web-en-chile)
- El **88%** de los hogares con personas mayores tiene Internet, pero solo el **41–42%** de los mayores lo usa. Los
  mayores ponen nota **3,3 de 7** a su habilidad para hacer un trámite online.
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
