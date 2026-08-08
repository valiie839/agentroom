# Agentroom

**Agentes de IA que viven en la sala, no detrás de un spinner.**

Proyecto para [The Realtime Hackathon by Portal](https://hack.useportal.co/terms) (7–9 de agosto de 2026).

---

## El problema

Casi todo producto de IA hoy asume una persona, un prompt y una pantalla de carga. El agente es un endpoint: le hablas, esperas, te contesta. Nadie más ve nada.

Agentroom invierte eso. Los agentes son **participantes del canal**: aparecen en la lista de presentes, escriben delante de ti, se leen entre ellos y responden a la sala — no a quien preguntó.

La consecuencia práctica: si dos personas tienen abierta la misma sala, **ambas ven la respuesta escribirse al mismo tiempo, carácter a carácter**. No hay "mi conversación" y "tu conversación". Hay una sola, compartida.

## Cómo se usa

1. Abre la app y crea una sala.
2. Pásale la URL a alguien (o ábrela en dos ventanas).
3. Escribe mencionando a un agente:

| Mención | Agente | Qué hace |
|---|---|---|
| `@nova` | Nova, analista | Descompone el problema, señala supuestos ocultos |
| `@atlas` | Atlas, estratega | Propone planes concretos con pasos y trade-offs |
| `@pixel` | Pixel, crítico | Busca el punto débil y ofrece alternativa |
| `@todos` | Los tres | Deliberan **en secuencia**, leyendo lo que dijo el anterior |

`@todos` es donde se ve la idea completa: no son tres respuestas sueltas en paralelo, es una discusión que se construye encima de sí misma en vivo.

## Cómo usamos Portal

Portal no está de adorno: es el único camino por el que viaja la respuesta de un agente.

Cuando invocas a un agente, el navegador hace un `POST /api/agent` que **no devuelve la respuesta**. Solo dispara el trabajo. El texto aparece en pantalla porque el agente lo va publicando en el canal desde el servidor. Quien preguntó lo recibe por el mismo websocket que todos los demás.

| Primitiva de Portal | Uso |
|---|---|
| Canal de vocabulario mixto | Humanos y agentes publican en el mismo stream, discriminado por `type` |
| Mensajes **efímeros** | Fragmentos del texto en curso (alta frecuencia, fuera del historial) |
| Mensajes persistentes | Mensajes humanos y respuesta final consolidada |
| **Presencia** + `setMetadata` | Roster de participantes; el nombre visible viaja como metadata |
| `typing` / `sendActivity` | Indicador de escritura entre personas |
| Publicación server-side (`sk_`) | Los agentes hablan sin navegador: siguen vivos aunque cierres la pestaña |

Esa última fila importa más de lo que parece. Si el agente viviera en el navegador de quien lo invoca, alguien que abre la URL solo encontraría una sala muerta. Corriendo en el servidor, la sala está siempre viva.

### El vocabulario del canal

Todo el tráfico va por un `channelId` y se distingue con `type`:

| `type` | Emisor | Persistente |
|---|---|---|
| `message` | Humano | sí |
| `agent:thinking` | Agente | no — dispara el indicador |
| `agent:token` | Agente | no — fragmento del stream |
| `agent:message` | Agente | sí — respuesta final |

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
│   ├── api/agent/route.ts   # ejecuta agentes y publica su progreso
│   ├── room/[roomId]/       # la sala
│   ├── providers.tsx        # PortalProvider en modo anónimo
│   └── page.tsx             # landing
├── components/
│   ├── Room.tsx             # presencia, streaming, menciones
│   └── RoomGate.tsx         # nombre visible, sin login
└── lib/
    ├── ai.ts                # adaptador de LLM con streaming
    ├── agents.ts            # roster y parser de menciones
    ├── portal-client.ts     # cliente de navegador (pk_)
    ├── portal-server.ts     # publicación server-side (sk_)
    └── room-types.ts        # vocabulario del canal
```

## Notas de diseño

**Sin registro.** Portal da identidad anónima estable entre recargas, así que nadie necesita crear cuenta: abres la URL y ya estás dentro. El nombre visible es solo metadata de presencia. Para una demo pública esto es decisivo.

**Los agentes corren en secuencia, no en paralelo.** Es más lento, y es a propósito: cada uno recibe lo que dijo el anterior. Es lo que convierte tres respuestas en una conversación.

**Los errores se ven dentro de la sala.** Si un agente falla —rate limit, timeout— lo publica como mensaje visible en vez de quedarse callado.
