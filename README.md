# Agentroom

**Agentes de IA que viven en la sala, no detrás de un spinner.**

Proyecto para [The Realtime Hackathon by Portal](https://hack.useportal.co/terms) (7–9 de agosto de 2026).

---

## El problema

Casi todo producto de IA hoy asume una persona, un prompt y una pantalla de carga. El agente es un endpoint: le hablas, esperas, te contesta. Nadie más ve nada.

Agentroom invierte eso. Los agentes son **participantes del canal**: aparecen en la lista de presentes, escriben delante de ti, se leen entre ellos y responden a la sala — no a quien preguntó.

La consecuencia práctica: si dos personas tienen abierta la misma sala, **ambas ven la respuesta escribirse al mismo tiempo, carácter a carácter**. No hay "mi conversación" y "tu conversación". Hay una sola, compartida.

## Los tres tipos de participante

Una sala contiene a la vez **personas**, **agentes** y una **fuente de datos en vivo**. Los tres publican en el mismo canal de Portal.

| Participante | Qué aporta |
|---|---|
| Nova, analista | Descompone el problema y señala supuestos ocultos |
| Atlas, estratega | Propone planes con pasos y trade-offs |
| Pixel, crítico | Busca el punto débil y ofrece alternativa |
| Feed USGS | Sismos reales, conforme ocurren |

## Cómo se usa

Abre una sala, pásale la URL a alguien (o ábrela en dos ventanas) y **escribe con normalidad**.

**No hace falta mencionar a nadie.** Un modelo pequeño decide quién debería intervenir según lo que dijiste — y tiene "nadie" como opción de primera clase: a un "hola" o un "gracias" no responde ninguno. Una sala donde alguien contesta absolutamente todo es tan artificial como una muda.

Cuando alguien responde, se evalúa si **otro agente tiene una objeción sustantiva**. Si la tiene, interrumpe. Es lo que hace que la sala se sienta viva en vez de por turnos.

Puedes seguir forzando a uno con `@nova`, `@atlas` o `@pixel`, y `@todos` los pone a deliberar en secuencia, cada uno leyendo lo que dijo el anterior.

Y sin que nadie escriba nada, **entra un sismo real**: la sala muestra el hecho, la consulta que lo trajo, y el análisis de Nova.

## Cómo usamos Portal

Portal no está de adorno: es el único camino por el que viaja la respuesta de un agente.

Cuando invocas a un agente, el navegador hace un `POST /api/agent` que **no devuelve la respuesta**. Solo dispara el trabajo. El texto aparece en pantalla porque el agente lo va publicando en el canal desde el servidor. Quien preguntó lo recibe por el mismo websocket que todos los demás.

| Primitiva de Portal | Uso |
|---|---|
| Canal de vocabulario mixto | Personas, agentes y la fuente en vivo publican en el mismo stream, discriminado por `type` |
| Mensajes persistentes | Mensajes humanos, respuesta final, eventos de la fuente |
| Fragmentos de streaming | El texto en curso, agrupado cada ~120 ms, filtrado del historial al renderizar |
| **Presencia** + `setMetadata` | Roster de participantes; el nombre visible viaja como metadata |
| `typing` / `sendActivity` | Indicador de escritura entre personas |
| Publicación server-side (`sk_`) | Agentes y fuente hablan sin navegador: la sala sigue viva aunque cierres la pestaña |

### Dos modos de canal: sala y audiencia

Una sala y una audiencia no se comportan igual, y Portal tiene un modo para cada una.

La sala (`room-*`) es **standard**: presencia detallada, se ve quién está uno por uno. Eso deja de tener sentido pasadas unas decenas de personas — el roster se vuelve ilegible y cada entrada y salida se propaga a todos.

El espejo (`watch-*`) es **broadcast**: presencia agregada, solo el número de espectadores, y publicación denegada en la propia autorización. `/watch/[sala]` no tiene caja de texto: mirar y participar son cosas distintas.

Todo lo que publica el servidor va a los dos canales. El mensaje humano lo espeja `/api/agent`, porque el navegador publica directo en la sala y nunca toca el canal de espectadores. Cuesta una publicación extra por evento; a cambio la audiencia puede crecer sin degradar la sala.

### La pizarra: estado compartido, no mensajes

Arriba de la sala hay un panel con **lo que sabemos hasta ahora**, que un agente reescribe conforme avanza la conversación y que todos ven cambiar a la vez.

No es un mensaje más. Viaja por el canal como `room:synthesis`, se filtra del hilo, y **cada versión reemplaza a la anterior** en vez de acumularse. Es lo que separa una sala de trabajo de un chat: entrar a mitad de una conversación larga no obliga a leerla entera.

La diferencia entre extraer y destilar se nota. Dado un hilo donde alguien dice que su build tarda 9 minutos y otro agente objeta que nadie ha medido cuánto de eso es compilación real, la pizarra escribe:

> El proyecto de Carlos tarda 9 minutos en compilar, pero no se sabe cuánto tiempo se debe a la compilación real.

Ninguna frase del hilo dice eso: reúne dos mensajes en una conclusión. Conseguirlo exigió el modelo grande — el pequeño copiaba frases literales, que es justo lo que hace inútil una pizarra.

### Configuración de canal desplegada

[`portal.config.ts`](portal.config.ts) se despliega con `portal deploy` y gobierna todas las salas con una plantilla `room-*` — necesario porque las salas se crean cuando alguien abre la URL, así que sus ids no existen de antemano.

Lo que hace, y por qué:

**`authz`** concede `publish` y niega `sendDirect`. Los mensajes dirigidos no encajan en la premisa: en esta sala, todo lo que pasa lo ve la sala entera.

**Middleware `onPublish` que impide suplantar a un agente.** La clave publicable está a la vista de cualquiera que abra las herramientas de desarrollo. Sin esta comprobación, alguien podría publicar un `agent:message` firmado como `agent-nova` y poner palabras en boca de un agente — indistinguible de una respuesta real para el resto de la sala. La frontera es el emisor: agentes y fuente publican desde el servidor con la clave secreta y llevan ids reservados (`agent-*`, `feed-*`), que una sesión de navegador nunca puede tener.

**Middleware que rechaza mensajes humanos vacíos o de más de 2.000 caracteres**, para que una burbuja vacía no ensucie el historial de todos.

### Resistencia ante el límite de tasa

El plan gratuito de Groq da 12.000 tokens por minuto **por modelo**, y una ráfaga de tres agentes deliberando lo roza. Un 429 en mitad de una demo se ve como un producto roto.

Las llamadas reintentan respetando `retry-after`, y si el modelo grande sigue saturado, el turno se sirve con `llama-3.1-8b-instant`. La respuesta es algo peor; en una sala en vivo, el silencio es el peor resultado posible.

### Dos caminos que no funcionaron

Vale la pena dejarlos escritos, por si le ahorran tiempo a alguien.

**Mensajes efímeros desde el cliente.** `send({ ephemeral: true })` resuelve sin error, pero el mensaje no llega a los demás participantes ni vuelve al propio emisor. Los únicos efímeros que sí se reparten son los publicados desde el servidor — y esos llegan con `seq`, es decir, persistidos. Por eso el streaming filtra por `type` al renderizar en lugar de apoyarse en la no-persistencia.

**Cursores en vivo.** Se intentaron las dos vías que documenta Portal: efímeros (por lo anterior) y metadata de presencia. La metadata propaga en el snapshot inicial de conexión, pero las actualizaciones posteriores no alcanzan a quienes ya estaban conectados. Se retiró la funcionalidad en vez de dejarla a medias.

Esa última fila importa más de lo que parece. Si el agente viviera en el navegador de quien lo invoca, alguien que abre la URL solo encontraría una sala muerta. Corriendo en el servidor, la sala está siempre viva.

### El vocabulario del canal

Todo el tráfico va por un `channelId` y se distingue con `type`:

| `type` | Emisor | Rol |
|---|---|---|
| `message` | Humano | lo que escribe una persona |
| `agent:thinking` | Agente | dispara el indicador de escritura |
| `agent:token` | Agente | fragmento del stream, fuera del historial |
| `agent:message` | Agente | respuesta final consolidada |
| `agent:tool` | Agente | de dónde sacó el dato |
| `feed:event` | Fuente en vivo | un hecho del mundo real |

Que `feed:event` viaje por el mismo canal, con su propio `senderId`, es deliberado: la fuente no es un servicio que la app consulta, es **un participante más de la sala**.

El cliente acumula los `agent:token` por `runId` para reconstruir la burbuja en vuelo, y la descarta cuando llega el `agent:message` definitivo.

## Rendimiento

Medido en local con Groq (`llama-3.3-70b-versatile`):

| Momento | Tiempo |
|---|---|
| Burbuja del agente aparece | 209 ms |
| Primer texto visible | 1.4 s |
| Respuesta completa (406 chars) | 3.8 s |

Los fragmentos se agrupan cada ~120 ms o 48 caracteres antes de publicarse: un POST por token serían cientos de peticiones por respuesta. Las publicaciones salen por una cola encadenada, de modo que mantienen el orden sin bloquear la lectura del modelo.

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript + Tailwind
- **Portal** (`@portalsdk/core`, `@portalsdk/react`) para todo el tiempo real
- **Groq** o **Google Gemini** para la inferencia, intercambiables con una variable de entorno

## Correrlo en local

```bash
npm install
cp .env.example .env.local   # y rellena las claves
npm run dev
```

| Variable | Dónde se obtiene |
|---|---|
| `NEXT_PUBLIC_PORTAL_PUBLISHABLE_KEY` | [app.useportal.co](https://app.useportal.co) → Settings → Api Keys → **Public** |
| `PORTAL_SECRET_KEY` | Mismo sitio → **Secret** |
| `LLM_PROVIDER` | `groq` o `gemini` |
| `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |

La clave secreta de Portal solo se usa en el servidor: `src/lib/portal-server.ts` importa `server-only`, así que el build falla si alguna vez se cuela en un componente cliente. Portal además rechaza con 403 cualquier petición con cabecera `Origin`, de modo que la clave no puede usarse desde el navegador ni por accidente.

## Estructura

```
src/
├── app/
│   ├── api/agent/route.ts   # quién habla: mención explícita o enrutado
│   ├── api/feed/route.ts    # trae la fuente en vivo a la sala
│   ├── room/[roomId]/       # la sala
│   ├── providers.tsx        # PortalProvider en modo anónimo
│   └── page.tsx             # landing
├── components/
│   ├── Room.tsx             # presencia, streaming, feed, menciones
│   └── RoomGate.tsx         # nombre visible, sin login
└── lib/
    ├── ai.ts                # adaptador de LLM (streaming + decisiones)
    ├── agents.ts            # roster y parser de menciones
    ├── router.ts            # decide quién interviene, o si nadie
    ├── run-agent.ts         # el motor de un turno de agente
    ├── feed.ts              # la fuente en vivo (aislada aquí)
    ├── portal-client.ts     # cliente de navegador (pk_)
    ├── portal-server.ts     # publicación server-side (sk_)
    └── room-types.ts        # vocabulario del canal
```

## Notas de diseño

**Sin registro.** Portal da identidad anónima estable entre recargas, así que nadie necesita crear cuenta: abres la URL y ya estás dentro. El nombre visible es solo metadata de presencia. Para una demo pública esto es decisivo.

**Los agentes corren en secuencia, no en paralelo.** Es más lento, y es a propósito: cada uno recibe lo que dijo el anterior. Es lo que convierte tres respuestas en una conversación.

**"Nadie" es una respuesta válida del enrutador.** Costó más ajustarlo que hacer que respondieran: el instinto es que el producto luzca contestando siempre, pero una sala que salta ante cada saludo se siente falsa en diez segundos.

**Las respuestas de otros agentes se anotan como turnos de usuario**, no de assistant. Con rol assistant, la conversación terminaba en un turno del modelo y Groq devolvía vacío de forma intermitente: Nova funcionaba siempre —iba primera— y Atlas y Pixel respondían en blanco.

**Un solo cliente sondea la fuente**, elegido por el id más bajo de la sala. Es una regla determinista que todos evalúan igual sin coordinarse; con cada pestaña sondeando, el mismo sismo se anunciaría varias veces.

**Los errores se ven dentro de la sala.** Si un agente falla —rate limit, timeout— lo publica como mensaje visible en vez de quedarse callado.
