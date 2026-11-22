# Investigación y decisiones

Investigación realizada por tres agentes: identidad visual, producto y producción de activos. Fecha de consulta: 21 de noviembre de 2026. Referencias de primera parte; las decisiones de Chameleon Mode son una síntesis propia, no una reproducción de estas marcas.

## Identidad y producto

1. [Linear: Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh), 12 marzo 2026. Sidebar atenuado, menos íconos y separadores, grises más cálidos. Adoptamos calma y jerarquía; no su acento ni su identidad.
2. [Linear: Brand](https://linear.app/brand). Consistencia entre marca y producto; no usamos sus activos.
3. [Vercel: Geist](https://vercel.com/geist/introduction), [color](https://vercel.com/geist/colors) y [tipografía](https://vercel.com/geist/typography). Roles consistentes para superficie, interacción, borde y texto. Adoptamos tokens semánticos y cifras tabulares; no la grilla como adorno.
4. [Raycast: Press kit](https://www.raycast.com/press). Diferencia símbolo, wordmark e ícono de app. Adoptamos versiones por contexto.
5. [Raycast: The New Raycast](https://www.raycast.com/blog/the-new-raycast), mayo 2026. Búsqueda, atajos y superficies coherentes. Priorizamos familiaridad y rapidez.
6. [Resend: Rebranding Resend](https://resend.com/blog/rebranding-resend) y [Brand](https://resend.com/brand). Relación entre símbolo, tipografía y expresión de producto. No adoptamos cromo, vidrio ni serif como fórmula de elegancia.
7. [Supabase: Brand](https://supabase.com/brand). Kit práctico con SVG, PNG y monocromos. Adoptamos nomenclatura por fondo, formato y función.
8. [PostHog: Brand assets](https://posthog.com/handbook/brand/assets). Un animal reconocible puede coexistir con una herramienta profesional. Adoptamos una firma cercana y usos diferenciados, sin multiplicar mascotas en la interfaz.
9. [Stripe: Components](https://docs.stripe.com/stripe-apps/components). Patrones funcionales para listas, detalles y estados. Adoptamos lista para comparar, detalle para investigar.
10. [Stripe: Designing accessible color systems](https://stripe.com/blog/accessible-color-systems), 2019. Referencia metodológica sobre contraste y percepción, no una tendencia nueva de 2026. Verificamos pares reales y acompañamos color con etiquetas.

## Formatos y fuentes

- [MDN: Define your app icons](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Define_app_icons). Tamaños, propósitos y zonas seguras.
- [web.dev: Add a web app manifest](https://web.dev/articles/add-manifest). Recursos habituales 192 y 512; el manifiesto debe integrarse según la aplicación real.
- [Apple: Configuring Web Applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html). Iconos touch para pantalla de inicio.
- [Chrome: Manifest icons](https://developer.chrome.com/docs/extensions/reference/manifest/icons). PNG para extensiones; no dar SVG como icono de manifiesto de Chrome.
- [Inter](https://rsms.me/inter/) y [licencia](https://github.com/rsms/inter/blob/master/LICENSE.txt). Fuente para marca e interfaz, con copia local de OFL.
- [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) y [licencia](https://github.com/JetBrains/JetBrainsMono/blob/master/OFL.txt). Fuente para datos e identificadores.
- [SIL OFL: FAQ](https://openfontlicense.org/ofl-faq/). Uso de fuentes y redistribución de sus archivos con licencia.

## Resultado de la síntesis

Mantener exacto el camaleón y su espectro. Wordmark sobrio en Inter, sistema carbón/blanco suave y turquesa funcional. Las exportaciones de producción proceden del SVG original. La portada se reduce a marca y dominio. El popup integra estos activos y separa la habilitación global de la disponibilidad del tema.


## Investigación aplicada a la extensión

- [Dark Reader: ayuda](https://darkreader.org/help/en/): distingue On/Off global, control por sitio y páginas restringidas. Decisión: estado global separado de disponibilidad; no inventar un control por sitio.
- [uBlock Origin: popup](https://github.com/gorhill/uBlock/wiki/Quick-guide%3A-popup-user-interface): acción principal y opciones progresivas. Su interruptor es por sitio; el nuestro es global y lo declara explícitamente. La opinión queda plegada; idioma y efectos permanecen como controles secundarios al pie.
- [Firefox / MDN: Toolbar button](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/user_interface/Toolbar_button): popup transitorio e iconos por contexto. Decisión: panel breve sin introducción promocional. Las variantes ON/OFF representan habilitación, no el tema claro/oscuro del navegador; la baldosa mantiene legibilidad en ambos.
- [Chrome: Action](https://developer.chrome.com/docs/extensions/reference/api/action): badges breves y tooltip accesible. Decisión: ON/OFF y título localizado. La implementación usa exclusivamente las APIs `browser.*` de Firefox.
- [Firefox / MDN: setIcon](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/action/setIcon) y [setTitle](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/action/setTitle): recursos por tamaño y título global; sin `tabId` para que coincida con la preferencia global.
- [Bitwarden: 2026 design update](https://bitwarden.com/blog/2026-design-update/), 19 noviembre 2026: lenguaje familiar, navegación y espaciado. Decisión: etiquetas directas y una sola acción principal.

ON no confirma que se haya aplicado un tema: el popup muestra disponibilidad separadamente. La versión OFF cambia sólo el relleno funcional a neutro; la marca de cabecera no cambia. Estas decisiones son una síntesis propia, no una afirmación de que todas las referencias implementen el mismo sistema.
