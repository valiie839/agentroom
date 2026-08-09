# Video de demostración

Dos versiones del mismo montaje, ambas **1920×1080** y por debajo del límite de 1 min 30 s:

| Archivo | Duración | Peso | Audio |
|---|---|---|---|
| [`agentroom-demo.mp4`](agentroom-demo.mp4) | 81.5 s | 8.9 MB | Narración en español |
| [`agentroom-demo-mudo.mp4`](agentroom-demo-mudo.mp4) | 82.4 s | 8.6 MB | Sin audio |

Los subtítulos van **grabados en la imagen** en las dos, así que la versión muda se entiende igual sin sonido.

**Cuál usar:** la narración se generó con la voz SAPI de Windows (Microsoft Sabina, es-MX), que es inteligible pero suena sintética. Si vas a locutar tú, usa la versión muda como base.

## Qué se ve

Todo lo que aparece es real y ocurrió durante la grabación: el sismo es un evento verdadero del feed del USGS, y las respuestas de los agentes se generaron en ese momento. No hay nada guionizado ni pregrabado dentro de la aplicación.

| Tiempo | En pantalla | Narración |
|---|---|---|
| 0:00 | Portada | Hoy un agente de IA es un endpoint: preguntas, esperas solo frente a un spinner. |
| 0:07 | Dos salas lado a lado, misma URL, identidades distintas | Aquí son participantes: dos personas y tres agentes en la misma sala. |
| 0:15 | Entra un sismo real del USGS. Pixel lo analiza, Atlas lo cita y añade su ángulo | Nadie ha escrito nada. Acaba de entrar un sismo real del USGS, y ya lo están discutiendo. |
| 0:24 | Se escribe *"¿esto debería preocuparnos?"* sin mencionar a nadie; responden dos agentes y el texto aparece en ambas ventanas a la vez | Escribo sin mencionar a nadie. Responde el agente que corresponde, y otro le contesta citándolo. |
| 0:47 | Se escribe *"hola"* y no responde ningún agente | Y cuando no hace falta, no responde nadie. |
| 0:57 | La pizarra "Lo que sabemos hasta ahora", idéntica en las dos ventanas | Mientras tanto, un agente destila la conversación en una pizarra que todos ven cambiar a la vez. |
| 1:04 | Vista de espectador, en el canal broadcast | Y una audiencia puede mirar sin entrar: otro canal de Portal, presencia agregada, solo lectura. |
| 1:15 | Cierre con la URL | Personas, agentes y datos en vivo en un mismo canal de Portal. |

## Falta subirlo

El formulario pide una **URL**, no un archivo. Sube el `.mp4` a YouTube (puede ser *no listado*), Loom o Drive con enlace público, y pega ese enlace en el campo **Recorded demo**.

## Cómo se produjo

Sin capturar pantalla a mano: un navegador dirigido por Playwright monta las dos salas en una única página y se graba a sí mismo.

```bash
cd demo
npm install
node record.mjs                    # graba salida/crudo.webm
powershell ./narrar.ps1            # genera las líneas de voz
bash montar.sh                     # produce los dos .mp4
```

Tres decisiones que explican el resultado:

**Una sola grabación, no dos.** Las dos salas son iframes de la misma página. Si se grabaran por separado y se juntaran después, cualquier deriva entre los dos archivos destruiría justo lo que el video quiere demostrar: que las dos pantallas se actualizan a la vez.

**Identidades por URL.** Dos iframes comparten el `localStorage` del navegador, así que no pueden tener nombres distintos por esa vía. De ahí el parámetro `?name=`, que además sirve para compartir enlaces ya con nombre.

**Respaldo si el mundo no colabora.** El guion espera a que entre un hecho real; si en 22 segundos no llega ninguno, dispara uno de la fuente `Ensayo` para que la toma no dependa de que la tierra tiemble en el momento justo. En la grabación entregada **no hizo falta**: el sismo es real.

Para regrabar, `record.mjs` acepta `DEMO_BASE` (otra URL), `DEMO_ROOM` (otra sala) y `DEMO_CHROME` (ruta a un Chromium concreto).

## Un hallazgo de la grabación

El navegador de Playwright emula tema claro por defecto, y así se descubrió que la aplicación se veía con **texto claro sobre fondo blanco** para cualquiera que tuviera el sistema en tema claro: el `globals.css` de la plantilla fijaba el fondo en blanco con una regla que gana sobre las utilidades de Tailwind. Está corregido — la sala es oscura para todos.
