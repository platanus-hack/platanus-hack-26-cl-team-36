# Referencias para posibles adiciones

Proyectos externos que podrían sumarse al producto más adelante. Nada de esto está en el MVP ni se ha probado: cada
entrada dice qué es, para qué nos serviría y qué habría que comprobar antes de usarlo.

## SUM: mapas de atención visual predichos

- **Repositorio:** <https://github.com/Arhosseini77/SUM> (licencia MIT, Python y PyTorch).
- **Qué es:** un modelo que, a partir de una imagen, predice dónde se fija la mirada de las personas y lo entrega
  como mapa de calor. Se publicó en WACV 2025 ("SUM: Saliency Unification through Mamba for Visual Attention
  Modeling"). Tiene cuatro modos según el tipo de imagen; uno de ellos es para **interfaces de usuario** y otro para
  imágenes de comercio electrónico.
- **Para qué nos serviría:**
  - **Mapa de calor sin esperar a nadie.** La validación con agentes (.specs/MVP.md, sección 9)
    genera mapas de calor a partir de los clics de varios agentes. SUM daría un mapa de atención con una sola
    captura de pantalla, en segundos: el antes y el después de una piel se podrían comparar al instante.
  - **Una señal para Claude.** Hoy Claude escribe el CSS sin ver el resultado. El mapa de atención de la página
    original, o de la página ya con la piel, podría entrar en la generación o en una ronda de ajuste: "la atención
    se va a la barra lateral y no al contenido".
  - **Complemento, no reemplazo.** SUM predice a dónde se mira; los recorridos dicen qué se hace. Son señales
    distintas y se pueden contrastar.
- **Qué habría que comprobar antes:**
  - Las instrucciones instalan PyTorch para CUDA (tarjetas NVIDIA). No sabemos si corre en un Mac ni cuánto tarda
    sin esa tarjeta.
  - Los pesos del modelo se descargan aparte (un archivo en Google Drive, o `safe-models/SUM` en Hugging Face).
  - Si la predicción es fiable en páginas web completas y en modo oscuro: el modo de interfaces se entrenó con
    capturas de interfaces, no con nuestras pieles.
  - Dónde correría: en el equipo del usuario pesa demasiado; lo razonable sería un servicio aparte o la herramienta
    de validación.
