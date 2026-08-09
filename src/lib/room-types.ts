/**
 * Vocabulario del canal.
 *
 * El room es un canal de "vocabulario mixto": todo el trafico viaja por
 * el mismo channelId y se discrimina con el campo `type` de Portal.
 * Este archivo es la unica fuente de verdad de esos tipos, compartida
 * entre el agente (servidor) y la UI (cliente).
 */

/**
 * La sala abierta.
 *
 * Un id fijo y conocido, para que quien llega no aterrice en una sala
 * vacia. Portal conserva el historial del canal, asi que la conversacion
 * anterior sigue ahi y la fuente en vivo empieza a publicar en cuanto
 * alguien entra: se llega a algo que ya esta pasando, no a un formulario.
 */
export const PUBLIC_ROOM = "plaza";

/**
 * Id del canal de Portal para una sala.
 *
 * El prefijo no es decorativo: permite que `portal.config.ts` gobierne
 * todas las salas con una sola plantilla `"room-*"`, en vez de tener que
 * enumerar ids que se crean sobre la marcha.
 */
export function channelIdFor(roomId: string): string {
  return `room-${roomId}`;
}

export const MSG = {
  /** Mensaje de una persona. Persistente, va al historial. */
  HUMAN: "message",
  /** El agente empezo a trabajar. Alimenta el typing indicator. */
  AGENT_THINKING: "agent:thinking",
  /** Trozo del stream en curso. Alta frecuencia, se descarta del historial. */
  AGENT_TOKEN: "agent:token",
  /** Uso de herramienta con su estado. */
  AGENT_TOOL: "agent:tool",
  /** Respuesta final consolidada. Esto si queda en el historial. */
  AGENT_MESSAGE: "agent:message",
  /**
   * Algo que ocurrio en el mundo y entro a la sala sin que nadie lo pidiera.
   * Es el tercer participante del canal, junto a personas y agentes.
   */
  FEED_EVENT: "feed:event",
} as const;

export type MsgType = (typeof MSG)[keyof typeof MSG];

/** Tipos que NO deben renderizarse como burbujas del historial. */
export const TRANSIENT_TYPES: string[] = [
  MSG.AGENT_THINKING,
  MSG.AGENT_TOKEN,
];

export interface HumanContent {
  text: string;
  /** Nombre visible. En canales estandar el display se une app-side. */
  author: string;
}

export interface AgentThinkingContent {
  runId: string;
  agentSlug: string;
}

export interface AgentTokenContent {
  runId: string;
  agentSlug: string;
  /** Fragmento incremental de texto. */
  delta: string;
}

export interface AgentToolContent {
  runId: string;
  agentSlug: string;
  tool: string;
  status: "running" | "done" | "error";
  detail?: string;
}

export interface AgentMessageContent {
  runId: string;
  agentSlug: string;
  text: string;
}

export interface FeedEventContent {
  /** Id de la fuente. Sirve para no publicar dos veces el mismo hecho. */
  eventId: string;
  source: string;
  title: string;
  detail: string;
  url: string;
  time: number;
}

/** Union de todo lo que puede viajar por el canal. */
export type RoomContent =
  | HumanContent
  | AgentThinkingContent
  | AgentTokenContent
  | AgentToolContent
  | AgentMessageContent
  | FeedEventContent;

/**
 * Metadata de presencia que publica cada cliente.
 *
 * Solo texto ASCII a proposito. Se probo con emoji como avatar y volvia
 * corrompido del transporte de metadata ("🐙" llegaba como "ð"), asi que
 * el avatar se deriva del nombre en el cliente en vez de viajar.
 */
export interface PresenceMeta {
  name: string;
}

/** Color estable por participante, derivado de su id. */
export function avatarColor(id: string): string {
  const palette = [
    "bg-sky-500/25 text-sky-200",
    "bg-emerald-500/25 text-emerald-200",
    "bg-violet-500/25 text-violet-200",
    "bg-rose-500/25 text-rose-200",
    "bg-teal-500/25 text-teal-200",
    "bg-amber-500/25 text-amber-200",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

/** Inicial visible de un nombre, sin depender de emoji. */
export function initialOf(name: string | undefined): string {
  return (name?.trim()[0] ?? "?").toUpperCase();
}
