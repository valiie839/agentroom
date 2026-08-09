/**
 * Enrutado de la sala viva.
 *
 * Sin esto, los agentes solo hablan si los mencionas por nombre: si te
 * olvidas del "@", la sala se queda muda y la ilusion de que son
 * participantes se rompe. Aqui se decide, en una llamada corta a un
 * modelo pequeño, quien deberia responder -- o si nadie deberia hacerlo.
 *
 * Esa ultima opcion importa tanto como las otras: una sala donde alguien
 * contesta absolutamente todo es tan artificial como una muda.
 */

import "server-only";
import { completeFast, type ChatMessage } from "@/lib/ai";
import { AGENTS, AGENT_BY_SLUG, type AgentDef } from "@/lib/agents";

const ROSTER = AGENTS.map((a) => `- ${a.slug}: ${a.role}. ${a.name}.`).join("\n");

const NADIE = "nadie";

/**
 * Elige que agente deberia responder al ultimo mensaje, o ninguno.
 * Devuelve `undefined` cuando la sala no necesita intervencion.
 */
export async function pickResponder(
  transcript: ChatMessage[],
): Promise<AgentDef | undefined> {
  const recent = transcript.slice(-6);

  const decision = await completeFast([
    {
      role: "system",
      content: `Eres el moderador silencioso de una sala de chat donde conviven
personas y estos agentes:

${ROSTER}

Dado el ultimo mensaje, responde UNICAMENTE con el slug del agente mas
adecuado para intervenir, o con "${NADIE}".

Responde "${NADIE}" si el mensaje es un saludo, una despedida, un
agradecimiento, una charla entre personas que no pide opinion, o algo que
no aporta nada responder. Ante la duda, prefiere "${NADIE}".

No expliques nada. Una sola palabra.`,
    },
    ...recent,
  ]);

  return matchSlug(decision);
}

/**
 * Decide si OTRO agente deberia meterse despues de que uno ya respondio.
 * Es lo que hace que la sala parezca viva: no contestan por turnos
 * ordenados, se interrumpen cuando tienen algo que objetar.
 *
 * Deliberadamente conservador: solo interviene ante desacuerdo real, y
 * como maximo uno por mensaje humano (el llamador no vuelve a invocarlo).
 */
export async function pickInterjector(
  transcript: ChatMessage[],
  alreadySpoke: AgentDef,
  /**
   * Sesga hacia intervenir. Se usa cuando lo que se comenta es un hecho
   * recien llegado de la fuente en vivo: ahi una segunda lectura casi
   * siempre aporta, mientras que en una conversacion entre personas
   * interrumpir de mas se siente invasivo.
   */
  options: { eager?: boolean } = {},
): Promise<AgentDef | undefined> {
  const candidates = AGENTS.filter((a) => a.slug !== alreadySpoke.slug);
  const roster = candidates.map((a) => `- ${a.slug}: ${a.role}`).join("\n");

  const sesgo = options.eager
    ? `Elige al que aporte el angulo mas util sobre lo que se acaba de
decir. Responde "${NADIE}" solo si de verdad no queda nada que anadir.`
    : `Responde con el slug de uno SOLO si tiene una objecion sustantiva o
un angulo que cambia la conversacion. Si la respuesta de
${alreadySpoke.name} ya cubre el tema, responde "${NADIE}".

Prefiere "${NADIE}": interrumpir sin motivo es ruido.`;

  const decision = await completeFast([
    {
      role: "system",
      content: `${alreadySpoke.name} acaba de responder en una sala de chat.
Quedan estos agentes que podrian intervenir:

${roster}

${sesgo}

Una sola palabra, sin explicaciones.`,
    },
    ...transcript.slice(-4),
  ]);

  const picked = matchSlug(decision);
  return picked?.slug === alreadySpoke.slug ? undefined : picked;
}

/** El modelo pequeño a veces adorna la respuesta; se busca el slug dentro. */
function matchSlug(raw: string): AgentDef | undefined {
  const clean = raw.toLowerCase().replace(/[^a-z]/g, " ");
  if (new RegExp(`\\b${NADIE}\\b`).test(clean)) return undefined;
  for (const agent of AGENTS) {
    if (new RegExp(`\\b${agent.slug}\\b`).test(clean)) {
      return AGENT_BY_SLUG.get(agent.slug);
    }
  }
  return undefined;
}
