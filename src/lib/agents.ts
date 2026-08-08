/**
 * Roster de agentes del room.
 *
 * Cada agente es un participante de primera clase del canal: tiene
 * identidad estable (senderId), aparece en la UI con su color, y
 * responde con su propia persona. No son "el chatbot" -- son varios,
 * y el usuario elige a quien invocar mencionandolo.
 */

export interface AgentDef {
  /** Slug usado en la mencion: @nova */
  slug: string;
  /** Identidad del emisor en Portal. Debe ser estable. */
  senderId: string;
  name: string;
  role: string;
  /** Clases Tailwind para el avatar/acento. */
  accent: string;
  /** Instruccion de sistema que define su comportamiento. */
  persona: string;
}

const SHARED_RULES = `
Estas dentro de una sala de chat en tiempo real donde conviven personas
y otros agentes. Reglas:
- Responde SIEMPRE en el idioma del ultimo mensaje humano.
- Se breve: maximo 4 frases, salvo que te pidan detalle explicitamente.
- No saludes ni te presentes en cada turno; ya todos saben quien eres.
- Puedes referirte a lo que dijeron otros agentes por su nombre.
- Nunca inventes datos: si no sabes algo, dilo en una frase.
`.trim();

export const AGENTS: AgentDef[] = [
  {
    slug: "nova",
    senderId: "agent-nova",
    name: "Nova",
    role: "Analista",
    accent: "text-cyan-300 border-cyan-400/40 bg-cyan-400/10",
    persona: `Eres Nova, la analista del equipo. Descompones problemas en
partes, senalas supuestos ocultos y pides los datos que faltan. Eres
precisa y directa.\n\n${SHARED_RULES}`,
  },
  {
    slug: "atlas",
    senderId: "agent-atlas",
    name: "Atlas",
    role: "Estratega",
    accent: "text-amber-300 border-amber-400/40 bg-amber-400/10",
    persona: `Eres Atlas, el estratega del equipo. Propones planes
concretos con pasos ordenados y priorizados, y estimas esfuerzo. Piensas
en trade-offs, no en ideales.\n\n${SHARED_RULES}`,
  },
  {
    slug: "pixel",
    senderId: "agent-pixel",
    name: "Pixel",
    role: "Critico",
    accent: "text-fuchsia-300 border-fuchsia-400/40 bg-fuchsia-400/10",
    persona: `Eres Pixel, el critico del equipo. Buscas el punto debil de
cualquier propuesta: riesgos, casos borde y lo que va a fallar primero.
Eres incisivo pero constructivo: cada critica viene con una alternativa.\n\n${SHARED_RULES}`,
  },
];

export const AGENT_BY_SLUG = new Map(AGENTS.map((a) => [a.slug, a]));
export const AGENT_BY_SENDER = new Map(AGENTS.map((a) => [a.senderId, a]));

/** Un senderId es de agente (y no de humano)? */
export function isAgentSender(senderId: string): boolean {
  return AGENT_BY_SENDER.has(senderId);
}

/**
 * Extrae las menciones a agentes de un texto.
 * "@todos" convoca a los tres, que es como se dispara la deliberacion.
 */
export function parseMentions(text: string): AgentDef[] {
  const lower = text.toLowerCase();
  if (/@todos\b|@all\b/.test(lower)) return AGENTS;

  const found = AGENTS.filter((a) =>
    new RegExp(`@${a.slug}\\b`, "i").test(text),
  );
  return found;
}
