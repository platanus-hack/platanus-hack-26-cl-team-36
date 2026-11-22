# Chameleon

**Los sitios web están hechos para el promedio. Chameleon los adapta para que cualquiera logre lo que vino a hacer.**

Dar de baja la fibra, pedir un certificado en el SII, encontrar el horario de una sucursal: tareas simples que en
muchos sitios se vuelven un laberinto. El dueño del sitio rara vez lo arregla, y quien lo sufre no puede hacer nada.

## Qué hace

Chameleon es una extensión de Firefox que cambia el diseño de un sitio sin tocar el original: aplica un **tema**
encima de la página, en tu navegador. Un tema puede cambiar el estilo o reemplazar una sección completa por una
interfaz nueva, y un botón te devuelve la página original cuando quieras.

## Cómo decide qué cambiar

Detrás de la extensión hay agentes de IA que estudian cada sitio antes de tocarlo:

1. **Catalogador.** Recorre el sitio y lista lo que la gente viene a hacer en él, por ejemplo "dar de baja la fibra
   en wom.cl".
2. **Guía.** Para cada objetivo, encuentra y verifica la ruta más corta para lograrlo.
3. **Visitante.** Lanza usuarios sintéticos con distintos perfiles (primera vez, apurado, desde el celular,
   exploradores que conocen más o menos el tema) que intentan el objetivo viendo **solo capturas de pantalla**, como
   una persona. Un juez, no el propio agente, decide si lo lograron.
4. **Resumen.** Compara cada intento con la ruta de la Guía y marca dónde se desvían, se demoran o se rinden.
5. **Tema.** Con esa evidencia se genera el diseño nuevo de la página.

## Multiplayer

Cuando visitas una página que todavía no tiene tema, la extensión pide una revisión: los agentes la estudian en la
nube y el tema que resulta queda disponible para todos los que usan Chameleon. Cada visita mejora el sitio para la
persona siguiente.

## Backoffice

Un visor de lo que hicieron los agentes: una telaraña con el camino de cada usuario sintético y el punto donde se
separó de la ruta, el replay paso a paso con capturas y video, y los perfiles a los que más les cuesta.

## Cómo está hecho

- **Extensión** de Firefox (Manifest V3), firmada por Mozilla. El servidor solo le envía datos (CSS y
  configuración), nunca código.
- **Agentes** en Python con Claude y Playwright: Claude Code en local y Claude en Amazon Bedrock en la nube.
- **AWS:** la API en Lambda, el Visitante en AgentCore Runtime, las corridas en S3 y las revisiones en DynamoDB.
