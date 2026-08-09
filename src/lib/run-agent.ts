/**
 * El motor de un turno de agente.
 *
 * Anuncia que esta pensando, transmite el texto en fragmentos conforme lo
 * genera el modelo, y publica al final una respuesta consolidada. Todo
 * sale por el canal de Portal: quien pregunto lo recibe por el mismo
 * websocket que el resto de la sala, no como respuesta a su peticion.
 *
 * Vive aparte de la ruta porque lo usan dos disparadores distintos: una
 * persona escribiendo, y un evento de la fuente en vivo.
 */

import "server-only";
import { streamChat, type ChatMessage } from "@/lib/ai";
import { publishMessage } from "@/lib/portal-server";
import type { AgentDef } from "@/lib/agents";
import { MSG } from "@/lib/room-types";

/** Cada cuanto se vacia el buffer de tokens hacia Portal. */
const FLUSH_INTERVAL_MS = 120;
/** O antes, si ya se acumulo suficiente texto. */
const FLUSH_CHARS = 48;

export interface AgentTurn {
  runId: string;
  /** Vacio si el turno fallo: el error se muestra pero no alimenta al siguiente. */
  text: string;
}

export async function runAgent(
  roomId: string,
  agent: AgentDef,
  transcript: ChatMessage[],
): Promise<AgentTurn> {
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

/**
 * Publica una tarjeta de uso de herramienta. Se emite antes de que el
 * agente hable, para que se vea de donde saco el dato en lugar de que la
 * conclusion aparezca de la nada.
 */
export function publishToolCall(
  roomId: string,
  agent: AgentDef,
  tool: string,
  detail: string,
  status: "running" | "done" | "error" = "done",
) {
  return publishMessage({
    channelId: roomId,
    senderId: agent.senderId,
    type: MSG.AGENT_TOOL,
    content: { runId: crypto.randomUUID(), agentSlug: agent.slug, tool, status, detail },
  });
}
