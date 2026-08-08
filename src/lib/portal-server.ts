/**
 * Cliente server-side de Portal (control plane).
 *
 * IMPORTANTE: este modulo NUNCA debe importarse desde un componente
 * cliente. Usa la secret key (sk_), y Portal rechaza con 403 cualquier
 * request que llegue con header `Origin` -- es decir, cualquier fetch
 * hecho desde el navegador. Solo route handlers / server actions.
 */

import "server-only";

const CONTROL_PLANE = "https://api.useportal.co";

function secretKey(): string {
  const value = process.env.PORTAL_SECRET_KEY?.trim();
  if (!value || value.startsWith("TODO")) {
    throw new Error("Falta PORTAL_SECRET_KEY en .env.local.");
  }
  return value;
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${CONTROL_PLANE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    // Portal devuelve { code, reason? } y repite el code en x-portal-error.
    const code = res.headers.get("x-portal-error") ?? String(res.status);
    const detail = await res.text().catch(() => "");
    throw new Error(`Portal ${path} fallo [${code}]: ${detail}`);
  }

  return (await res.json()) as T;
}

export interface PublishResult {
  id: string;
  seq: number;
  timestamp: number;
}

export interface PublishInput {
  channelId: string;
  /** Identidad del emisor. Para los agentes usamos "agent:<slug>". */
  senderId: string;
  content: Record<string, unknown>;
  /** Discrimina el tipo de trafico dentro del canal (ver AGENT_EVENT). */
  type?: string;
  ephemeral?: boolean;
}

/**
 * Publica un mensaje en un canal a nombre de un emisor arbitrario.
 * Es lo que permite que un agente hable en el room sin tener navegador.
 */
export function publishMessage({
  channelId,
  senderId,
  content,
  type,
  ephemeral,
}: PublishInput): Promise<PublishResult> {
  return call<PublishResult>(
    `/v1/channels/${encodeURIComponent(channelId)}/messages`,
    { senderId, content, ...(type && { type }), ...(ephemeral && { ephemeral }) },
  );
}

/**
 * Tipos de evento que emiten los agentes. Al ir en `type`, el cliente
 * puede renderizar cada uno distinto y descartar el ruido del historial.
 */
export const AGENT_EVENT = {
  /** Trozo de texto del stream en curso (alta frecuencia). */
  TOKEN: "agent:token",
  /** El agente empezo a pensar: dispara el typing indicator. */
  THINKING: "agent:thinking",
  /** Invocacion de herramienta, con su estado. */
  TOOL: "agent:tool",
  /** Respuesta final consolidada: esto si queda en el historial. */
  MESSAGE: "agent:message",
} as const;

export type AgentEvent = (typeof AGENT_EVENT)[keyof typeof AGENT_EVENT];
