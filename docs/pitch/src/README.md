# Pitch de Chameleon

- **Presentar:** abre `chameleon-pitch.html` con doble clic (funciona offline). → / Espacio / clic avanza, ← retrocede, F pantalla completa. Si avanzas a mitad de una animación, la termina rápido y sigue.
- **Guion:** la slide «¿Ya hiciste tu declaración de renta?» es una pausa del narrador; el minuto parte en el clic siguiente.
- **Regenerar:** `node build.mjs` (desde `docs/pitch/`). Arma el HTML con `src/deck.html`, `src/deck.js`, las capturas de `sii/` y la marca de `../marca`; la primera vez baja three 0.160.0 y GSAP 3.13.0 a `pkgs/`.
- **Grabar el respaldo:** `node record.mjs 1920 1080` (necesita Playwright; usa la GPU con ANGLE Metal) → `respaldo.webm`.
- Los tiempos por slide del video van en el tercer argumento: `node record.mjs 1920 1080 2,4,13,4,13,12,8,8`.
