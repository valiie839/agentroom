/**
 * POST /api/agent
 *
 * Corre uno o mas agentes contra el room y va publicando su progreso en
 * el canal de Portal conforme sucede. El navegador que dispara esto NO
 * recibe la respuesta por HTTP: la ve llegar por el websocket de Portal,
 * igual que todos los demas participantes. Esa es justamente la gracia
 * -- el agente le habla al room, no al que lo invoco.
 *
 * Corre en el servidor para que el agente siga vivo aunque quien lo
 * invoco cierre la pestana.
 */

import { streamChat, type ChatMessage } from "@/lib/ai";
import { publishMessage } from "@/lib/portal-server";
import { AGENT_BY_SLUG, type AgentDef } from "@/lib/agents";
import { MSG } from "@/lib/room-types";

/** Vercel corta las funciones; el streaming necesita margen. */
export const maxDuration = 60;

/** Cada cuanto se vacia el buffer de tokens hacia Portal. */
const FLUSH_INTERVAL_MS = 120;
/** O antes, si ya se acumulo suficiente texto. */
const FLUSH_CHARS = 48;

interface AgentRequest {
  roomId: string;
  /** Slugs de los agentes a invocar, en orden. */
  agents: string[];
  /** Historial reciente del room, ya aplanado a texto. */
  history: ChatMessage[];
}

export async function POST(request: Request) {
  let body: AgentRequest;
  try {
    body = (await request.json()) as AgentRequest;
  } catch {
    return Response.json({ error: "JSON invalido" }, { status: 400 });
  }

  const { roomId, agents, history } = body;

  if (!roomId || !Array.isArray(agents) || agents.length === 0) {
    return Response.json(
      { error: "Se requieren roomId y al menos un agente" },
      { status: 400 },
    );
  }

  const resolved = agents
    .map((slug) => AGENT_BY_SLUG.get(slug))
    .filter((a): a is AgentDef => a !== undefined);

  if (resolved.length === 0) {
    return Response.json({ error: "Ningun agente valido" }, { status: 400 });
  }

  // Secuencial y no en paralelo: cada agente ve lo que dijo el anterior,
  // que es lo que convierte tres respuestas sueltas en una conversacion.
  const transcript: ChatMessage[] = [...(history ?? [])];
  const runIds: string[] = [];

  for (const agent of resolved) {
    const { runId, text } = await runAgent(roomId, agent, transcript);
    runIds.push(runId);
    if (text) {
      // Se anota como turno de USUARIO, no de assistant. Lo dijo otro
      // agente, no este, y ademas deja el ultimo turno del lado del
      // usuario: cerrar la conversacion con un mensaje de assistant hacia
      // que el modelo devolviera vacio de forma intermitente.
      transcript.push({
        role: "user",
        content: `${agent.name} (${agent.role}) respondio: ${text}`,
      });
    }
  }

  return Response.json({ ok: true, runIds });
}

/**
 * Ejecuta un agente: anuncia que esta pensando, transmite el texto en
 * fragmentos y publica la respuesta final consolidada.
 */
async function runAgent(
  roomId: string,
  agent: AgentDef,
  transcript: ChatMessage[],
): Promise<{ runId: string; text: string }> {
  const runId = crypto.randomUUID();

  await publishMessage({
    channelId: roomId,
    senderId: agent.senderId,
    type: MSG.AGENT_THINKING,
    content: { runId, agentSlug: agent.slug },
  });

  const messages: ChatMessage[] = [
    { role: "system", content: agent.persona },
    ...transcript,
  ];

  let full = "";
  let buffer = "";
  let lastFlush = Date.now();

  // Cola encadenada: las publicaciones salen en orden, pero el bucle que
  // lee del modelo no se bloquea esperando el round-trip de cada una.
  // Awaitear cada flush aqui dentro sumaba varios segundos por respuesta.
  let queue: Promise<unknown> = Promise.resolve();

  const flush = () => {
    if (!buffer) return;
    const delta = buffer;
    buffer = "";
    lastFlush = Date.now();
    queue = queue.then(() =>
      publishMessage({
        channelId: roomId,
        senderId: agent.senderId,
        type: MSG.AGENT_TOKEN,
        ephemeral: true,
        content: { runId, agentSlug: agent.slug, delta },
      }).catch(() => {
        // Un fragmento perdido no debe tumbar la respuesta completa:
        // el mensaje final consolidado llega igual.
      }),
    );
  };

  let failure: string | undefined;

  try {
    for await (const delta of streamChat(messages)) {
      full += delta;
      buffer += delta;

      // Un POST por token seria inviable (cientos de requests por respuesta).
      // Agrupamos por tiempo o por volumen, lo que ocurra primero: sigue
      // viendose como escritura fluida pero son ~8 publicaciones/segundo.
      if (
        buffer.length >= FLUSH_CHARS ||
        Date.now() - lastFlush >= FLUSH_INTERVAL_MS
      ) {
        flush();
      }
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  flush();
  // El definitivo solo puede publicarse cuando ya salieron los fragmentos,
  // o el cliente borraria el borrador antes de terminar de pintarlo.
  await queue;

  // Pase lo que pase se publica un mensaje final con ESTE runId. Es lo que
  // retira el borrador en los clientes: sin el, un fallo del modelo deja al
  // agente "escribiendo..." para siempre, que en vivo es peor que el error.
  const text =
    full.trim() ||
    (failure
      ? `[no pude responder: ${failure.slice(0, 140)}]`
      : "[me quede sin nada que decir]");

  await publishMessage({
    channelId: roomId,
    senderId: agent.senderId,
    type: MSG.AGENT_MESSAGE,
    content: { runId, agentSlug: agent.slug, text },
  });

  // El texto de fallo se muestra en la sala pero no entra al transcript:
  // el siguiente agente no debe razonar sobre el error del anterior.
  return { runId, text: failure ? "" : text };
}
