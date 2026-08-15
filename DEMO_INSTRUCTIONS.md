# El video de demostración

**▶ https://youtu.be/5t1rnFfLTnw** · 1920×1080 · 82 s

Todo lo que aparece es real y ocurrió durante la grabación: el sismo es un evento verdadero del feed del USGS, con enlace a su ficha oficial, y las respuestas de los agentes se generaron en ese momento. No hay nada guionizado ni pregrabado dentro de la aplicación.

## Qué se ve

| Tiempo | En pantalla |
|---|---|
| 0:00 | La portada. *Hoy un agente de IA es un endpoint: preguntas, esperas solo frente a un spinner.* |
| 0:07 | Dos salas lado a lado — misma URL, identidades distintas |
| 0:15 | Entra un sismo real del USGS. Pixel lo analiza, Atlas lo cita y añade su ángulo |
| 0:24 | Se escribe *"¿esto debería preocuparnos?"* **sin mencionar a nadie**; responden dos agentes y el texto aparece en ambas ventanas a la vez |
| 0:47 | Se escribe *"hola"* y **no responde ningún agente** |
| 0:57 | La pizarra "Lo que sabemos hasta ahora", idéntica en las dos ventanas |
| 1:04 | Vista de espectador, sobre el canal broadcast |
| 1:15 | Cierre con la URL |

## Cómo se produjo

Sin capturar pantalla a mano: un navegador dirigido por Playwright monta las dos salas como iframes de una misma página y se graba a sí mismo. Los scripts (`record.mjs`, `narrar.ps1`, `montar.sh`) quedaron fuera del repositorio por no ser parte del producto, pero las decisiones que explican el resultado sí vale la pena dejarlas escritas.

**Una sola grabación, no dos.** Las dos salas son iframes de la misma página. Si se grabaran por separado y se juntaran después, cualquier deriva entre los dos archivos destruiría justo lo que el video quiere demostrar: que las dos pantallas se actualizan a la vez.

**Identidades por URL.** Dos iframes comparten el `localStorage` del navegador, así que no pueden tener nombres distintos por esa vía. De ahí el parámetro `?name=`, que además sirve para compartir enlaces ya con nombre.

**Respaldo si el mundo no colabora.** El guion espera a que entre un hecho real; si en 22 segundos no llega ninguno, dispara uno de la fuente `Ensayo` para que la toma no dependa de que la tierra tiemble en el momento justo. En la grabación publicada **no hizo falta**.

## Un hallazgo de la grabación

El navegador de Playwright emula tema claro por defecto, y así se descubrió que la aplicación se veía con **texto claro sobre fondo blanco** para cualquiera con el sistema en tema claro: el `globals.css` de la plantilla fijaba el fondo en blanco con una regla que gana sobre las utilidades de Tailwind. Corregido — la sala es oscura para todos.
