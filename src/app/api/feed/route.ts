/**
 * POST /api/feed
 *
 * Trae la fuente en vivo a la sala. El cliente manda que fuente mira y
 * los ids que ya vio; el servidor consulta, publica el hecho mas reciente
 * que sea nuevo, y hace que un agente lo comente.
 *
 * El resultado en pantalla es que la sala se mueve sola: aparece algo del
 * mundo real y alguien opina sobre ello, sin que nadie haya escrito nada.
 * Es la diferencia entre un chat con IA y una sala donde esta pasando algo.
 *
 * Por que el cliente lleva la iniciativa: en serverless no hay proceso que
 * vigile un feed de forma continua, y el cron de Vercel en plan gratuito
 * no baja del dia. Que sondee quien esta mirando es ademas lo razonable --
 * si no hay nadie en la sala, no hay nada que anunciar.
 */

import { resolveSource } from "@/lib/feed";
import { publishMessage } from "@/lib/portal-server";
import { AGENTS, AGENT_BY_SLUG } from "@/lib/agents";
import { pickInterjector } from "@/lib/router";
import { publishToolCall, runAgent } from "@/lib/run-agent";
import { MSG, channelIdFor } from "@/lib/room-types";

export const maxDuration = 60;

/** Quien comenta los hechos de la fuente. Es su rol: leer los datos. */
const ANALYST = AGENT_BY_SLUG.get("nova") ?? AGENTS[0];

interface FeedRequest {
  roomId: string;
  /** Que fuente mira esta sala. */
  source?: string;
  /** Ids de hechos ya presentes en la sala, para no repetirlos. */
  knownIds?: string[];
}

export async function POST(request: Request) {
  let body: FeedRequest;
  try {
    body = (await request.json()) as FeedRequest;
  } catch {
    return Response.json({ error: "JSON invalido" }, { status: 400 });
  }

  const { roomId, knownIds = [] } = body;
  if (!roomId) {
    return Response.json({ error: "Falta roomId" }, { status: 400 });
  }

  const source = resolveSource(body.source);

  let events;
  try {
    events = await source.fetchLatest(5);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: detail }, { status: 502 });
  }

  const known = new Set(knownIds);
  const fresh = events.find((e) => !known.has(e.id));

  if (!fresh) {
    return Response.json({ ok: true, skipped: true });
  }

  const channelId = channelIdFor(roomId);

  // 1. El hecho entra a la sala como participante propio, con su fuente
  //    citada. No lo dice un agente: lo dice el mundo.
  await publishMessage({
    channelId,
    senderId: `feed-${source.id}`,
    type: MSG.FEED_EVENT,
    content: {
      eventId: fresh.id,
      source: source.attribution,
      title: fresh.detail,
      detail: fresh.detail,
      url: fresh.url,
      time: fresh.time,
    },
  });

  // 2. La consulta que trajo el dato se muestra antes de la conclusion,
  //    para que se vea de donde salio en vez de aparecer de la nada.
  await publishToolCall(
    roomId,
    ANALYST,
    `${source.id}.ultimos_eventos`,
    `${events.length} ${events.length === 1 ? "hecho" : "hechos"} recientes de ${source.attribution}`,
  ).catch(() => {});

  // 3. Y alguien lo comenta.
  const transcript = [
    {
      role: "user" as const,
      content: `Acaba de entrar este hecho a la sala desde ${source.attribution} (${source.kind}):

${fresh.detail}

Comentalo en una o dos frases: que implica y si merece atencion. No
saludes, no repitas el hecho tal cual, no inventes datos que no esten
arriba.`,
    },
  ];

  const { runId, text } = await runAgent(roomId, ANALYST, transcript);

  // 4. Y si otro agente tiene algo que objetar, se mete. Esto convierte
  //    "un agente opina sobre un dato" en "la sala discute un hecho real",
  //    que es lo que hace que parezca una conversacion y no una alerta.
  if (text) {
    transcript.push({
      role: "user" as const,
      content: `${ANALYST.name} (${ANALYST.role}) respondio: ${text}`,
    });

    const interjector = await pickInterjector(transcript, ANALYST, {
      eager: true,
    });

    if (interjector) {
      // Sin esta instruccion el segundo agente parafraseaba al primero y
      // asentia. Una segunda voz que repite no aporta nada: lo que hace
      // interesante la sala es que cada uno mire el hecho desde su rol.
      transcript.push({
        role: "user",
        content: `${interjector.name}, di lo tuyo. No repitas ni resumas lo
que dijo ${ANALYST.name}: aporta el angulo de tu papel (${interjector.role}).
Si discrepas, dilo directamente. Una o dos frases.`,
      });
      await runAgent(roomId, interjector, transcript);
    }
  }

  return Response.json({ ok: true, eventId: fresh.id, runId });
}
