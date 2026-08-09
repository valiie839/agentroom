/**
 * Vocabulario del canal.
 *
 * El room es un canal de "vocabulario mixto": todo el trafico viaja por
 * el mismo channelId y se discrimina con el campo `type` de Portal.
 * Este archivo es la unica fuente de verdad de esos tipos, compartida
 * entre el agente (servidor) y la UI (cliente).
 */

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

/** Metadata de presencia que publica cada cliente. */
export interface PresenceMeta {
  name: string;
  /** Emoji o inicial para el avatar. */
  avatar: string;
}
