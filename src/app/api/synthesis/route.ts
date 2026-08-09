/**
 * POST /api/synthesis
 *
 * Reescribe "lo que sabemos hasta ahora": el estado compartido de la sala.
 *
 * No es un mensaje mas. Es una version que reemplaza a la anterior, y que
 * todos ven cambiar a la vez en su panel fijo. La conversacion sigue
 * siendo un hilo; esto es lo que el hilo ha dejado en claro.
 *
 * Es lo que convierte la sala en un espacio de trabajo en vez de un chat:
 * al entrar a mitad de una conversacion larga no hay que leerla entera,
 * porque alguien la ha ido destilando mientras ocurria.
 */

import { completeFast, type ChatMessage } from "@/lib/ai";
import { publishToRoom } from "@/lib/portal-server";
import { MSG, type SynthesisContent } from "@/lib/room-types";

export const maxDuration = 30;

/** Sin material suficiente, una sintesis solo inventaria. */
const MIN_MESSAGES = 3;

interface SynthesisRequest {
  roomId: string;
  /** Historial reciente de la sala, ya aplanado a texto. */
  history: ChatMessage[];
}

export async function POST(request: Request) {
  let body: SynthesisRequest;
  try {
    body = (await request.json()) as SynthesisRequest;
  } catch {
    return Response.json({ error: "JSON invalido" }, { status: 400 });
  }

  const { roomId, history = [] } = body;
  if (!roomId) {
    return Response.json({ error: "Falta roomId" }, { status: 400 });
  }
  if (history.length < MIN_MESSAGES) {
    return Response.json({ ok: true, skipped: "sin material suficiente" });
  }

  const raw = await completeFast(
    [
      {
        role: "system",
        content: `Mantienes la pizarra de una sala donde conversan personas
y agentes de IA, y donde ademas entran hechos de fuentes en vivo.

Tu trabajo es DESTILAR, no transcribir. Un punto de la pizarra reune
varios mensajes en una conclusion; copiar una frase del hilo tal cual no
sirve de nada, porque el hilo ya esta ahi arriba.

Reglas:
- Como mucho cuatro puntos, cada uno una frase corta y concreta.
- Reune lo que varios dijeron; no repitas a nadie palabra por palabra.
- Solo lo que ya se dijo. No completes, no supongas, no recomiendes.
- Escribe en el idioma de la conversacion.
- En "open", la pregunta concreta que quedo sin responder, redactada
  entera. Si no quedo ninguna, omite el campo por completo. Nunca
  escribas ahi palabras vacias como "abierto", "ninguno" o "n/a".

Ejemplo del NIVEL esperado, de un tema que no tiene nada que ver con esta
sala. Sirve para ver la forma, nunca para copiar su contenido. Dado un
hilo donde se discute la ruta de reparto de una panaderia:
{"points":["Repartir de madrugada evita el trafico pero obliga a doblar el turno de horno.","Nadie ha comprobado si los clientes aceptarian recibir el pedido antes de las siete."],"open":"Cuanto costaria el turno extra de horno"}

Responde SOLO con JSON valido, sin texto alrededor ni bloques de codigo.`,
      },
      ...history.slice(-20),
    ],
    400,
    true, // destilar exige el modelo grande
  );

  const parsed = parseSynthesis(raw);
  if (!parsed) {
    // Mejor no tocar la pizarra que dejarla con basura: la version
    // anterior sigue siendo valida.
    return Response.json({ ok: false, error: "respuesta no interpretable" });
  }

  const content: SynthesisContent = {
    points: parsed.points.slice(0, 4),
    ...(parsed.open ? { open: parsed.open } : {}),
    coverage: history.length,
  };

  await publishToRoom(roomId, {
    senderId: "agent-nova",
    type: MSG.SYNTHESIS,
    content: content as unknown as Record<string, unknown>,
  });

  return Response.json({ ok: true, points: content.points.length });
}

/**
 * El modelo a veces rellena "open" con la etiqueta en lugar del contenido
 * ("abierto", "ninguno"), y la pizarra mostraba "Abierto: abierto".
 */
function cleanOpen(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length < 8) return undefined;
  const vacias = /^(abierto|ninguno|ninguna|nada|n\/a|none|null|-)$/i;
  return vacias.test(text) ? undefined : text;
}

/**
 * Los modelos pequeños envuelven el JSON en ```json pese a pedirles que no,
 * o anteponen una linea de cortesia. Se extrae el primer objeto que haya.
 */
function parseSynthesis(
  raw: string,
): { points: string[]; open?: string } | undefined {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;

  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as {
      points?: unknown;
      open?: unknown;
    };
    const points = Array.isArray(obj.points)
      ? obj.points.filter((p): p is string => typeof p === "string" && !!p.trim())
      : [];
    if (points.length === 0) return undefined;

    return { points, open: cleanOpen(obj.open) };
  } catch {
    return undefined;
  }
}
