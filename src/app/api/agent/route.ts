/**
 * POST /api/agent
 *
 * Hace hablar a uno o varios agentes en la sala. El navegador que dispara
 * esto NO recibe la respuesta por HTTP: la ve llegar por el websocket de
 * Portal, igual que todos los demas participantes. Esa es la gracia -- el
 * agente le habla al room, no a quien lo invoco.
 *
 * Corre en el servidor para que el agente siga vivo aunque quien lo
 * invoco cierre la pestaña.
 */

import type { ChatMessage } from "@/lib/ai";
import { AGENT_BY_SLUG, type AgentDef } from "@/lib/agents";
import { pickInterjector, pickResponder } from "@/lib/router";
import { runAgent } from "@/lib/run-agent";
import { publishMessage } from "@/lib/portal-server";
import { MSG, watchChannelIdFor } from "@/lib/room-types";

/** Vercel corta las funciones; el streaming necesita margen. */
export const maxDuration = 60;

interface AgentRequest {
  roomId: string;
  /** Slugs de los agentes a invocar, en orden. Vacio en modo automatico. */
  agents: string[];
  /** Historial reciente del room, ya aplanado a texto. */
  history: ChatMessage[];
  /**
   * Sala viva: nadie fue mencionado, asi que el servidor decide si algun
   * agente deberia intervenir -- incluida la opcion de que ninguno lo haga.
   */
  auto?: boolean;
  /**
   * El mensaje humano que disparo esta llamada. El cliente ya lo publico
   * en el canal de la sala; aqui se espeja al canal de espectadores, que
   * el navegador no toca. Sin esto la audiencia veria a los agentes
   * responder a preguntas que nunca vio.
   */
  say?: { text: string; author: string };
}

export async function POST(request: Request) {
  let body: AgentRequest;
  try {
    body = (await request.json()) as AgentRequest;
  } catch {
    return Response.json({ error: "JSON invalido" }, { status: 400 });
  }

  const { roomId, agents, history, auto } = body;

  if (!roomId) {
    return Response.json({ error: "Falta roomId" }, { status: 400 });
  }

  const transcript: ChatMessage[] = [...(history ?? [])];
  const runIds: string[] = [];

  // Espejo del mensaje humano hacia la audiencia. No se espera: si falla,
  // la sala no debe notarlo.
  if (body.say?.text) {
    void publishMessage({
      channelId: watchChannelIdFor(roomId),
      senderId: "mirror-human",
      type: MSG.HUMAN,
      content: { text: body.say.text, author: body.say.author },
    }).catch(() => {});
  }

  /** Ejecuta un agente y deja su respuesta en el transcript compartido. */
  const speak = async (agent: AgentDef) => {
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
  };

  const resolved = (agents ?? [])
    .map((slug) => AGENT_BY_SLUG.get(slug))
    .filter((a): a is AgentDef => a !== undefined);

  // --- Camino 1: alguien fue mencionado explicitamente ---
  if (resolved.length > 0) {
    // Secuencial y no en paralelo: cada agente ve lo que dijo el anterior,
    // que es lo que convierte tres respuestas sueltas en una conversacion.
    for (const agent of resolved) await speak(agent);
    return Response.json({ ok: true, runIds });
  }

  // --- Camino 2: sala viva, nadie fue mencionado ---
  if (!auto) {
    return Response.json({ error: "Ningun agente valido" }, { status: 400 });
  }

  const responder = await pickResponder(transcript);
  if (!responder) {
    // Que nadie conteste es una respuesta valida: evita la sala donde
    // alguien salta ante cada "hola" y todo suena artificial.
    return Response.json({ ok: true, runIds, skipped: true });
  }

  await speak(responder);

  // Como mucho una interrupcion por mensaje humano: sin ese tope, los
  // agentes se responderian entre ellos indefinidamente.
  const interjector = await pickInterjector(transcript, responder);
  if (interjector) await speak(interjector);

  return Response.json({ ok: true, runIds });
}
