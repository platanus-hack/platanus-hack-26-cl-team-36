# Interfaces que se adaptan al gusto de cada usuario: estado del arte y caminos sin explorar

*Investigación para la hackatón (tema "multiplayer"), 2026-11-20. Fuentes primarias cuando fue posible; lo no
verificado está marcado.*

## TL;DR

- **El contenido personalizado está resuelto; la forma no.** Netflix, Spotify, YouTube, Amazon e Instagram
  personalizan *qué* ves (ítems, carátulas, filas, orden de módulos), siempre dentro de un sistema de diseño fijo
  igual para todos. Netflix GenPage (jul-2026) ya arma la página completa con un modelo generativo por usuario, pero
  con componentes prediseñados.
- **La UI generativa existe, pero no recuerda a nadie.** Gemini dynamic view, MCP Apps, A2UI, Thesys, CopilotKit:
  generan interfaz *por consulta*, desde cero, sin un perfil de gusto visual que persista.
- **No encontramos ningún producto que aprenda el gusto visual o de layout de una persona en el tiempo.** Lo más
  cercano son preprints de 2025–2026 con 12–20 usuarios que personalizan UIs generadas a partir de elecciones
  pareadas.
- **Nadie adapta la interfaz al gusto de un *grupo*.** Spotify Blend e Instagram Blend mezclan contenido, no
  interfaz; el paper de Stanford sobre interfaces generativas pone "entornos colaborativos multiusuario" como trabajo
  futuro. Ese hueco calza exacto con el tema "multiplayer".
- **La lección histórica:** la adaptación que mueve cosas de lugar falla (menús personalizados de Office 2000,
  retirados en 2007). Funciona cuando el acierto es alto (≥70–80%), los cambios son poco frecuentes o no mueven
  elementos, y el usuario mantiene el control. Diseño implicado: **adaptar el estilo libremente, mantener estable la
  estructura, y mostrar el perfil para que se pueda editar.**

## 1. Una escala para ubicar lo existente

| Nivel | Qué cambia por usuario | Ejemplos |
|---|---|---|
| L0 | Nada: una UI optimizada para la población | Booking.com (~1.000 A/B tests simultáneos), Amazon multivariate bandits (+21% conversión) |
| L1 | Variante por segmento | Optimizely Opal, Dynamic Yield, Coframe (variantes generadas con IA, servidas por audiencia) |
| L2 | Contenido por usuario (ítems, carátulas, filas, orden de módulos) | Netflix, Spotify, YouTube, TikTok, Amazon, Instagram |
| L3 | Layout o estilo por usuario | Adobe Auto-Target (elige entre 4–6 variantes hechas a mano), Material You (paleta derivada del fondo de pantalla, por regla, no aprendida), extensiones tipo Dispel (el usuario lo pide a mano) |
| L4 | UI generada por usuario que **evoluciona con su gusto** | Nadie en producción. Solo investigación pequeña (Peng et al. 2026, CrowdGenUI) |

Y una dimensión que nadie cubre: **L4 para un grupo** (una interfaz compartida que negocia el gusto de varias
personas presentes).

## 2. Lo que ya se hizo

### 2.1 Investigación HCI clásica (1994–2010): qué funciona y qué no

- **Split menus** (Sears & Shneiderman 1994): los ítems más usados arriba, 17–58% más rápido; el layout cambió una
  sola vez. https://www.cs.umd.edu/~ben/papers/Sears1994Split.pdf
- **Menús adaptativos vs adaptables** (Findlater & McGrenere, CHI 2004): los estáticos fueron más rápidos que los
  adaptativos; la mayoría prefirió los *adaptables* (que el usuario configura).
  https://www.cs.ubc.ca/labs/edapt/papers/findlater2004.pdf
- **Office 2000 "Personalized Menus"**: ocultaban lo poco usado; desactivados por defecto en Office 2007 por
  impredecibles (incluso rompían el soporte telefónico: "es el séptimo ítem" / "yo tengo seis").
  https://learn.microsoft.com/en-us/archive/blogs/jensenh/the-end-of-personalized-menus
- **Precisión vs predictibilidad** (Gajos et al., CHI 2008): la precisión del modelo pesó más que la predictibilidad
  en rendimiento y uso. https://kgajos.seas.harvard.edu/papers/kgajos-chi08-predictability.pdf
- **Adaptación efímera** (Findlater et al., CHI 2009, mejor paper): lo predicho aparece al instante y el resto se
  desvanece hacia adentro; nada se mueve. Ganó con ~79% de acierto y casi no costó con acierto bajo.
  https://www.cs.ubc.ca/labs/edapt/papers/findlater2009.pdf
- **Trade-off eficiencia vs descubrimiento** (Findlater & Gajos, AI Magazine 2009): adaptar a lo que ya usas esconde
  el resto de las funciones. https://kgajos.seas.harvard.edu/papers/AIMag09-AUIs.pdf
- **SUPPLE / SUPPLE++** (Gajos, Wobbrock & Weld): genera la UI completa por optimización según las capacidades
  motoras de cada persona; usuarios con discapacidad motora 26,4% más rápidos. La variante ARNAULD aprendía
  preferencias con comparaciones pareadas. https://www.eecs.harvard.edu/~kgajos/research/supple/
- **Preferencias estéticas** (Reinecke, CHI 2013/2014; MOCCA): colorido y complejidad visual explican ~la mitad del
  atractivo a primera vista, y las preferencias varían por país, edad y educación; MOCCA adaptaba la UI a la cultura.
  https://kgajos.seas.harvard.edu/papers/reinecke14visual.pdf

**Reglas que deja esta época:** mover elementos cuesta; la adaptación paga desde ~70–80% de acierto; adaptar poco o
sin mover (electiva / efímera) es lo que mejor funciona; la gente prefiere tener el control.

### 2.2 Adaptación computacional (2018–2025)

- **Todi et al., RL basado en modelos** (CHI 2021): planifica *secuencias* de adaptaciones con MCTS y modelos
  predictivos de búsqueda visual; solo adapta si espera beneficio neto. Mejora modesta (2162 ms vs 2283 ms) y escala
  hasta ~20 ítems de menú. https://arxiv.org/abs/2103.06807
- **MARLUI** (TOCHI 2024): un agente-usuario simulado y un agente-interfaz entrenados juntos, sin datos reales.
  https://arxiv.org/abs/2209.12660
- **Optimización bayesiana preferencial** (Koyama, Sequential Gallery; Meta-PO, UIST 2025): encuentra los
  parámetros visuales preferidos con elecciones "uno de varios"; Meta-PO aprende entre usuarios.
  https://www.koyama.xyz/project/sequential_gallery/

### 2.3 Era LLM (2023–2026)

- **Google Generative UI** (nov-2025): Gemini 3 escribe una página interactiva por prompt; preferida sobre markdown
  82,8% de las veces, cerca de páginas hechas por expertos, pero tarda 1–2 minutos y "a la medida" significa *del
  prompt*, no del usuario. https://research.google/blog/generative-ui-a-rich-custom-visual-interactive-user-experience-for-any-prompt/
- **Stanford, "Generative Interfaces for Language Models"** (ACL Findings 2026): gana 84% contra chat en benchmark,
  pero solo 50,8% con usuarios reales en sus propias consultas; trabajo futuro explícito: entornos multiusuario.
  https://arxiv.org/abs/2508.19227
- **Malleable UIs** (Cao et al., CHI 2025) y **DynaVis** (CHI 2024): el usuario reforma la UI generada con lenguaje
  o manipulación directa. https://arxiv.org/abs/2503.04084
- **Lo más cercano a nuestra idea:**
  - **DesignPref** (Peng, Bigham & Wu, nov-2025): 20 diseñadores, 12k comparaciones; acuerdo muy bajo (α=0,25).
    Modelos por persona superan al voto mayoritario con 20× menos datos. **El gusto es individual.**
    https://arxiv.org/abs/2511.20513
  - **Efficient Personalization of Generative UIs** (Peng et al., 2026): un usuario nuevo se modela como mezcla de
    usuarios anteriores a partir de pocas elecciones pareadas (filtrado colaborativo de gusto UI, offline, 12
    usuarios). Superó a las preferencias *escritas* por los propios usuarios. https://arxiv.org/abs/2604.09876
  - **CrowdGenUI**: 720 preferencias de 50 usuarios guían la generación de widgets en un dominio.
    https://arxiv.org/abs/2411.03477
  - **Alves et al.** (CHI 2026): la gente quiere *sugerencias* de personalización visual respaldadas por sus datos,
    no adaptación silenciosa. https://arxiv.org/abs/2603.19196
  - **Bernstein, "The Interface of Theseus"** (UIST Visions 2026): interfaces desechables generadas al momento;
    plantea un "interface.md" como guía. https://arxiv.org/abs/2609.06770

### 2.4 Industria

- **Netflix:** carátula por usuario con bandits contextuales (desde ~2017); **GenPage** (jul-2026) genera la home
  completa en un solo paso con un modelo y RL. Sigue usando el mismo sistema de diseño para todos.
  https://infoq.com/news/2026/07/netflix-llm-homepage-generation
- **Usuarios que dirigen el recomendador con lenguaje (2025–2026):** Spotify Taste Profile (editable), YouTube
  Custom Feeds, Instagram "Your Algorithm", sliders de TikTok. Muestran y dejan editar el modelo del usuario, **solo
  para contenido.** https://newsroom.spotify.com/2026-09-23/taste-profile-shape-home-feed/
- **CRO con IA:** Coframe (US$35M, "living internet"), Optimizely Opal: la IA genera variantes de layout y copy, pero
  se optimizan para la población o por audiencia, medidas en conversión. https://www.coframe.com/
- **Protocolos de UI generativa:** MCP Apps (ene-2026, Anthropic + OpenAI + MCP-UI), Google A2UI (JSON declarativo
  renderizado con componentes propios), AG-UI/CopilotKit, Thesys C1, Vercel json-render. Todos por consulta.
- **Intentos que no prosperaron:** ChatGPT Pulse (tarjetas personalizadas diarias, retirado jun-2026); Arc y sus
  Boosts (restyling por sitio, cierra el 2026-12-22); los menús de Office 2000.

## 3. Caminos sin explorar

Ordenados de más a menos fuerte para la hackatón (novedad × encaje con "multiplayer" × demostrable en 30 h).

1. **UI de sala que negocia el gusto del grupo.** La superficie compartida se calcula a partir de los vectores de
   gusto de los presentes, con un selector en vivo de estrategia de agregación de los recomendadores grupales:
   promedio, *least misery* (manda el menos satisfecho), *most pleasure*. Los recomendadores grupales llevan 25 años
   aplicándose a ítems (MusicFX elegía la música del gimnasio según quién estaba presente, 1998), nunca a la
   interfaz. Demo: 4 laptops, cambiar la estrategia y ver la UI transformarse.
2. **"Ver con sus ojos".** Clic en el avatar de un colaborador y ves los mismos datos renderizados con *su* UI
   adaptada. La presencia multiplayer de hoy comparte cursores y viewports, no perspectivas. Demo barata (cambio de
   variables CSS + estado de presencia).
3. **Aprender el gusto de la *forma* desde señales implícitas.** Toda la investigación actual usa elecciones pareadas
   explícitas o prompts; nadie alimenta un generador de UI con permanencia, scroll, hover, deshacer o ignorar un
   componente. Recomendación práctica: arrancar con "esto o aquello" (limpio, rápido, y es interacción de demo) y
   sumar señales implícitas como refinamiento.
4. **Filtrado colaborativo de gusto de UI y arranque en frío por vecino.** Un usuario nuevo parte con la UI de su
   vecino de gusto más cercano en la sala, y el grafo de vecinos se visualiza. Solo existe como patentes y un estudio
   offline de 12 personas.
5. **Evolución colectiva de temas (tipo Picbreeder).** La audiencia vota "esto o aquello" sobre variantes de UI desde
   el celular (QR), las ganadoras se ramifican, se muestra el árbol genealógico y un ranking Elo. La evolución
   interactiva colaborativa se hizo con imágenes, no con interfaces vivas. Es el momento más "multiplayer" posible
   en el pitch: los jueces juegan.
6. **"UI Blend" con porcentaje de compatibilidad.** Dos a cuatro personas obtienen una interfaz mezclada y un
   "taste match" compartible (como Spotify Blend, pero de interfaz). Trivial una vez que existen los vectores; la
   tarjeta compartible es el gancho viral.
7. **Pasaporte de gusto portable y editable.** El gusto se exporta como JSON en formato Design Tokens (W3C DTCG,
   primera versión estable 2025.10) que dos mini-apps distintas consumen; la UI de una sala se negocia con los
   pasaportes de los presentes. Ningún estándar portable de gusto de UI existe; Spotify e Instagram ya validaron que
   la gente quiere *ver y editar* su perfil, solo que para contenido.
8. **Piso de accesibilidad en co-presencia.** Si entra alguien con baja visión o que necesita menos movimiento, los
   mínimos de la superficie compartida suben (least misery usado como restricción de accesibilidad), mientras cada
   panel personal conserva su propia densidad. Combina diseño basado en capacidades (SUPPLE) con agregación grupal;
   buena historia ética.
9. **"AI Director" de grupo.** Como el director de Left 4 Dead, que dosifica la tensión del juego, pero para la UI
   compartida: baja la densidad cuando la sala se agita y la sube cuando está ociosa. Más difícil de demostrar (hay
   que guionar las señales).
10. **UI generativa estable en el tiempo.** Toda la UI generativa regenera desde cero; nadie combina las garantías
    clásicas (anclas fijas, cambios efímeros, umbral de acierto) con generación por LLM ni estudia la deriva semana a
    semana. Interesante, pero difícil de mostrar en 30 h.

## 4. Riesgos y cómo convertirlos en parte del producto

- **Impredecibilidad** (la lección de Office): adaptar tokens de estilo (densidad, color, radio, tipografía,
  movimiento) libremente; cambios estructurales poco frecuentes, anunciados y reversibles.
- **Desconfianza / manipulación** (DSA art. 25 sobre dark patterns en la UE): consentimiento explícito, panel "¿por
  qué mi UI se ve así?", botones congelar y restablecer. Esto además es diferenciador en el pitch.
- **Burbuja de interfaz** (todos convergen o cada uno queda aislado, y se esconden funciones): reservar exploración
  (Thompson sampling la da gratis) y algo de serendipia.
- **Señales ruidosas**: el dwell time tiene outliers y sesgos; por eso partir con elecciones explícitas.
- **Privacidad**: el tracking de comportamiento es perfilamiento (RGPD; en Chile, Ley 21.719 art. 8 bis, con entrada
  en vigencia en discusión de postergación). Para la demo: opt-in, datos locales o efímeros, nada de datos personales.

## 5. Stack mínimo sugerido (30 h)

- **Frontend:** Next.js o Vite + React, Tailwind/shadcn, con todo el aspecto controlado por **variables CSS
  generadas desde ~10 tokens de diseño** (densidad, contraste, radio, matiz/temperatura, serif vs sans, movimiento,
  profundidad de información, lista/grilla/tarjetas). Cambios instantáneos, baratos, y no rompen el layout.
- **Multiplayer:** Liveblocks (presencia + storage) o Yjs; el vector de gusto de cada usuario vive en la presencia,
  y la sala calcula el agregado. Alternativas: Supabase Realtime, Convex, PartyKit/partyserver.
- **Motor de gusto (TypeScript plano, sin infra de ML):** vector interpretable, Thompson sampling Beta por opción,
  Elo/Bradley-Terry para votos pareados, funciones de agregación (media, mínimo, máximo).
- **LLM:** nunca por interacción (la UI generativa completa tarda minutos). Usarlo offline o de vez en cuando para
  generar una biblioteca de variantes (temas con nombre, specs de layout en JSON validados contra un catálogo de
  componentes con Zod, json-render o A2UI), cacheadas por vector cuantizado; en runtime, el mapeo señal → variante es
  determinístico. Prompt caching para el catálogo. Medir latencia el primer día.

## 6. Cómo repartir 4 Macs con Claude Max

- **Un repo en GitHub desde la hora 0** y un `CLAUDE.md` en el repo con las decisiones, los contratos entre módulos
  y el vocabulario, para que las 4 máquinas (y todas sus sesiones) trabajen con el mismo contexto.
- **Un dueño por módulo, contratos definidos primero** (tipos TypeScript del vector de gusto, del estado de sala y del
  catálogo de componentes), para que nadie bloquee a nadie:
  1. motor de gusto + agregación,
  2. realtime (sala, presencia, sincronización),
  3. renderer (tokens → CSS, catálogo de componentes, variantes generadas por LLM),
  4. app de demo, diseño (Fable) y pitch.
- **Varias sesiones por máquina en worktrees separados**, PRs chicos y merge frecuente a `main`, con deploy
  continuo (Vercel u otro) desde temprano para que la demo siempre esté viva.
- Dejar las máquinas trabajando de noche en tareas con criterio de "listo" claro y tests, no en decisiones de diseño.

## Fuentes no verificadas o incompletas

- Post original de Netflix GenPage (403; se usó InfoQ); alcance visual real de su "layout".
- Cifras de proveedores (Coframe, Dynamic Yield, Optimizely) solo de fuentes propias.
- Textos completos de varios preprints 2025–2026 (solo abstracts); aceptación en CHI 2026 de Peng et al.
- Límites del plan gratuito de Liveblocks y estado 2026 de PartyKit.
- Fecha final de entrada en vigencia de la Ley 21.719.
