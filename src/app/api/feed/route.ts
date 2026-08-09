/**
 * POST /api/feed
 *
 * Trae la fuente en vivo a la sala. El cliente manda los ids de eventos
 * que ya vio; el servidor consulta la fuente, publica el mas reciente que
 * sea nuevo, y hace que un agente lo comente.
 *
 * El resultado en pantalla es que la sala se mueve sola: aparece un hecho
 * del mundo real y alguien opina sobre el, sin que nadie haya escrito
 * nada. Es la diferencia entre un chat con IA y una sala donde esta
 * pasando algo.
 *
 * Por que el cliente lleva la iniciativa: en serverless no hay proceso
 * que vigile un feed de forma continua, y el cron de Vercel en plan
 * gratuito no baja del dia. Que sondee quien esta mirando es ademas lo
 * razonable -- si no hay nadie en la sala, no hay nada que anunciar.
 */

import { describeEvent, fetchLatestEvents } from "@/lib/feed";
import { publishMessage } from "@/lib/portal-server";
import { AGENTS, AGENT_BY_SLUG } from "@/lib/agents";
import { publishToolCall, runAgent } from "@/lib/run-agent";
import { MSG, channelIdFor } from "@/lib/room-types";

export const maxDuration = 60;

/** Quien comenta los eventos de la fuente. Es su rol: leer los datos. */
const ANALYST = AGENT_BY_SLUG.get("nova") ?? AGENTS[0];

interface FeedRequest {
  roomId: string;
  /** Ids de eventos ya presentes en la sala, para no repetirlos. */
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

  let events;
  try {
    events = await fetchLatestEvents();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: detail }, { status: 502 });
  }

  const known = new Set(knownIds);
  const fresh = events.find((e) => !known.has(e.id));

  if (!fresh) {
    return Response.json({ ok: true, skipped: true });
  }

  // 1. El hecho entra a la sala como participante propio, con su fuente
  //    citada. No lo dice un agente: lo dice el mundo.
  await publishMessage({
    channelId: channelIdFor(roomId),
    senderId: "feed-usgs",
    type: MSG.FEED_EVENT,
    content: {
      eventId: fresh.id,
      source: "USGS",
      title: fresh.title,
      detail: describeEvent(fresh),
      url: fresh.url,
      time: fresh.time,
    },
  });

  // 2. La consulta que trajo el dato se muestra antes de la conclusion,
  //    para que se vea de donde salio en vez de aparecer de la nada.
  await publishToolCall(
    roomId,
    ANALYST,
    "usgs.sismos_ultima_hora",
    `${events.length} ${events.length === 1 ? "evento" : "eventos"} sobre magnitud 2.5; el más reciente en ${fresh.place}`,
  ).catch(() => {});

  // 3. Y alguien lo comenta.
  const { runId } = await runAgent(roomId, ANALYST, [
    {
      role: "user",
      content: `Acaba de entrar este dato a la sala desde el feed sismico del USGS:

${describeEvent(fresh)}

Comentalo en una o dos frases: que implica y si merece atencion. No
saludes, no repitas el dato tal cual, no inventes cifras que no esten
arriba.`,
    },
  ]);

  return Response.json({ ok: true, eventId: fresh.id, runId });
}
