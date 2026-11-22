# Investigación y decisiones

Investigación realizada por tres agentes: identidad visual, producto y producción de activos. Fecha de consulta: 21 de noviembre de 2026. Referencias de primera parte; las decisiones de Chameleon Mode son una síntesis propia, no una reproducción de estas marcas.

## Identidad y producto

1. [Linear: Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh), 12 marzo 2026. Sidebar atenuado, menos íconos y separadores, grises más cálidos. Adoptamos calma y jerarquía; no su acento ni su identidad.
2. [Linear: Brand](https://linear.app/brand). Consistencia entre marca y producto; no usamos sus activos.
3. [Vercel: Geist](https://vercel.com/geist/introduction), [color](https://vercel.com/geist/colors) y [tipografía](https://vercel.com/geist/typography). Roles consistentes para superficie, interacción, borde y texto. Referencia para roles de color y tipografía de la guía.
4. [Raycast: Press kit](https://www.raycast.com/press). Diferencia símbolo, wordmark e ícono de app. Adoptamos versiones por contexto.
5. [Raycast: The New Raycast](https://www.raycast.com/blog/the-new-raycast), mayo 2026. Búsqueda, atajos y superficies coherentes. Priorizamos familiaridad y rapidez.
6. [Resend: Rebranding Resend](https://resend.com/blog/rebranding-resend) y [Brand](https://resend.com/brand). Relación entre símbolo, tipografía y expresión de producto. No adoptamos cromo, vidrio ni serif como fórmula de elegancia.
7. [Supabase: Brand](https://supabase.com/brand). Kit práctico con SVG, PNG y monocromos. Adoptamos nomenclatura por fondo, formato y función.
8. [PostHog: Brand assets](https://posthog.com/handbook/brand/assets). Un animal reconocible puede coexistir con una herramienta profesional. Adoptamos una firma cercana y usos diferenciados, sin multiplicar mascotas en la interfaz.
9. [Stripe: Components](https://docs.stripe.com/stripe-apps/components). Patrones funcionales para listas, detalles y estados. Referencia de producto; sin cambios de interfaz en esta entrega.
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

Mantener exacto el camaleón y su espectro. Wordmark en Inter, con «mode» secundario; versiones para fondos claros y oscuros, monocromos y formatos por destino. Las exportaciones proceden del SVG original. Portada y tarjeta social reducidas a marca y dominio.

La integración en el producto se limita a los iconos de la barra y el nombre del manifest. El popup y sus animaciones se conservan. Las referencias generales de producto anteriores son contexto de investigación, no cambios de interfaz incluidos en esta entrega.

## Iconos de la extensión

- [Firefox / MDN: setIcon](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/action/setIcon): permite elegir recursos por tamaño. Se usan PNG de 16 y 32 px y se actualizan con la preferencia global de encendido.
- [Firefox / MDN: Toolbar button](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/user_interface/Toolbar_button): iconos de la barra y su contexto. Las variantes ON/OFF representan habilitación, no el tema claro/oscuro del navegador; la baldosa mantiene legibilidad en ambos.
- [Dark Reader: ayuda](https://darkreader.org/help/en/): distingue activación global, controles por sitio y páginas restringidas. El icono de Chameleon refleja exclusivamente el encendido global existente.

La versión apagada conserva geometría y ojo con relleno neutro. Se conserva el badge ON y el badge vacío al apagar. El camaleón animado del popup sigue usando su implementación original.
