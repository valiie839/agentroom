"use client";

/**
 * El room.
 *
 * Todo lo que se ve aqui llega por un unico canal de Portal. El canal es
 * de vocabulario mixto: humanos y agentes publican en el mismo stream y
 * se distinguen por `type` (ver room-types.ts).
 *
 * El detalle que hace la diferencia: cuando invocas a un agente, la
 * respuesta NO vuelve por el fetch. El fetch solo dispara el trabajo en
 * el servidor; el texto aparece porque el agente lo va publicando en el
 * canal. Por eso se escribe simultaneamente en todas las pantallas
 * conectadas, no solo en la de quien pregunto.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChannel } from "@portalsdk/react";
import { AGENTS, AGENT_BY_SLUG, parseMentions } from "@/lib/agents";
import {
  MSG,
  TRANSIENT_TYPES,
  type AgentMessageContent,
  type AgentThinkingContent,
  type AgentTokenContent,
  type HumanContent,
  type PresenceMeta,
  type RoomContent,
} from "@/lib/room-types";

/** Respuesta en curso, reconstruida a partir de los fragmentos. */
interface Draft {
  agentSlug: string;
  text: string;
  /** Ultima señal recibida; se usa para descartar borradores huerfanos. */
  updatedAt: number;
}

/**
 * Si un borrador deja de recibir señales por mas de este tiempo, se
 * descarta. Cubre el caso en que el mensaje final nunca llega (la funcion
 * del servidor murio, se corto la red): sin esto el agente se queda
 * "escribiendo..." indefinidamente, que en vivo es peor que un error.
 */
const DRAFT_TIMEOUT_MS = 25_000;

export function Room({ roomId, me }: { roomId: string; me: PresenceMeta }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  /** Con la sala viva, los agentes deciden solos cuando intervenir. */
  const [liveRoom, setLiveRoom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    send,
    presence,
    typing,
    sendTyping,
    setMetadata,
    status,
    me: identity,
  } = useChannel<RoomContent>({
    channelId: roomId,
    metadata: me as unknown as Record<string, unknown>,
    history: 80,
    onMessage: (msg) => {
      // Los fragmentos se acumulan por runId hasta que llega el mensaje
      // final. Asi la burbuja crece en vivo en todas las pantallas.
      if (msg.type === MSG.AGENT_TOKEN) {
        const c = msg.content as AgentTokenContent;
        setDrafts((prev) => ({
          ...prev,
          [c.runId]: {
            agentSlug: c.agentSlug,
            text: (prev[c.runId]?.text ?? "") + c.delta,
            updatedAt: Date.now(),
          },
        }));
        return;
      }

      if (msg.type === MSG.AGENT_THINKING) {
        const c = msg.content as AgentThinkingContent;
        setDrafts((prev) => ({
          ...prev,
          [c.runId]: {
            agentSlug: c.agentSlug,
            text: "",
            updatedAt: Date.now(),
          },
        }));
        return;
      }

      // El definitivo ya entra por `messages`: retiramos el borrador para
      // no mostrar el texto duplicado.
      if (msg.type === MSG.AGENT_MESSAGE) {
        const c = msg.content as AgentMessageContent;
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[c.runId];
          return next;
        });
      }
    },
  });

  /** Historial visible: sin los tipos de alta frecuencia. */
  const visible = useMemo(
    () => messages.filter((m) => !TRANSIENT_TYPES.includes(m.type)),
    [messages],
  );

  /** Nombres por id, unidos desde la presencia (el sender solo trae id). */
  const namesById = useMemo(() => {
    const map = new Map<string, PresenceMeta>();
    if (presence?.kind === "detailed") {
      for (const p of presence.participants) {
        const meta = p.metadata as unknown as PresenceMeta | undefined;
        if (meta?.name) map.set(p.id, meta);
      }
    }
    return map;
  }, [presence]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [visible.length, drafts]);

  // Reafirma el nombre en cuanto el canal queda listo, incluidas las
  // reconexiones. La metadata inicial se manda al montar, antes de que
  // exista socket; si esa primera propagacion se pierde, el resto de la
  // sala te ve como "conectando..." el resto de la sesion.
  useEffect(() => {
    if (status === "ready") setMetadata(me as unknown as Record<string, unknown>);
  }, [status, setMetadata, me]);

  // Barrido de borradores huerfanos (ver DRAFT_TIMEOUT_MS).
  useEffect(() => {
    const id = setInterval(() => {
      const cutoff = Date.now() - DRAFT_TIMEOUT_MS;
      setDrafts((prev) => {
        const live = Object.entries(prev).filter(
          ([, d]) => d.updatedAt >= cutoff,
        );
        return live.length === Object.keys(prev).length
          ? prev
          : Object.fromEntries(live);
      });
    }, 5_000);
    return () => clearInterval(id);
  }, []);

  const invoke = useCallback(
    async (text: string) => {
      const mentioned = parseMentions(text);

      // Sin mencion explicita, el servidor decide si alguien interviene.
      // Es lo que hace que no tengas que escribir "@nova" cada vez para
      // que la sala deje de estar muda.
      if (mentioned.length === 0 && !liveRoom) return;

      // Contexto reciente para que los agentes sepan de que se habla.
      // Todo el historial va como turnos de usuario, incluidas las
      // respuestas de otros agentes: para quien va a responder ahora son
      // contexto ajeno, no cosas que dijo el mismo.
      const history = visible.slice(-12).map((m) => {
        if (m.type === MSG.AGENT_MESSAGE) {
          const c = m.content as AgentMessageContent;
          const agent = AGENT_BY_SLUG.get(c.agentSlug);
          return {
            role: "user" as const,
            content: `${agent?.name ?? c.agentSlug} (${agent?.role ?? "agente"}) respondio: ${c.text}`,
          };
        }
        const c = m.content as HumanContent;
        return { role: "user" as const, content: `${c.author}: ${c.text}` };
      });
      history.push({ role: "user", content: `${me.name}: ${text}` });

      setBusy(true);
      try {
        await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId,
            agents: mentioned.map((a) => a.slug),
            history,
            auto: mentioned.length === 0,
          }),
        });
      } finally {
        setBusy(false);
      }
    },
    [visible, roomId, me.name, liveRoom],
  );

  const submit = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    await send({ content: { text, author: me.name }, type: MSG.HUMAN });
    void invoke(text);
  }, [input, send, me.name, invoke]);

  // Se listan TODOS los participantes conectados, tengan metadata o no.
  // Filtrar por metadata escondia a quien acababa de entrar y todavia no
  // habia propagado su nombre, dejando el panel en desacuerdo entre
  // pantallas: una veia dos personas y la otra solo a si misma.
  const humans = presence?.kind === "detailed" ? presence.participants : [];
  const activeAgents = new Set(Object.values(drafts).map((d) => d.agentSlug));

  return (
    <div className="flex h-full min-h-0 flex-1">
      {/* --- Panel de participantes --- */}
      <aside className="hidden w-60 shrink-0 flex-col gap-6 border-r border-white/10 p-4 md:flex">
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Personas · {presence?.count ?? humans.length}
          </h2>
          <ul className="space-y-1">
            {humans.map((p) => {
              const meta = namesById.get(p.id);
              return (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-white/10 text-xs">
                    {meta?.avatar ?? "·"}
                  </span>
                  <span className="truncate text-neutral-300">
                    {meta?.name ?? "conectando…"}
                    {p.id === identity?.id && (
                      <span className="text-neutral-500"> (tú)</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
            Agentes · {AGENTS.length}
          </h2>
          <ul className="space-y-1">
            {AGENTS.map((a) => (
              <li
                key={a.slug}
                className={`flex items-center gap-2 rounded border px-2 py-1 text-sm transition ${
                  activeAgents.has(a.slug)
                    ? a.accent
                    : "border-transparent text-neutral-400"
                }`}
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-white/10 text-xs">
                  {a.name[0]}
                </span>
                <span className="truncate">
                  {a.name}
                  <span className="ml-1 text-[11px] text-neutral-500">
                    {activeAgents.has(a.slug) ? "escribiendo…" : a.role}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-auto text-[11px] leading-relaxed text-neutral-600">
          {liveRoom ? (
            <>
              Escribe con normalidad y responderá quien corresponda —o nadie,
              si no hace falta. Menciona a uno para forzarlo, o{" "}
              <code className="text-neutral-400">@todos</code> para que
              delibere el equipo completo.
            </>
          ) : (
            <>
              Menciona <code className="text-neutral-400">@nova</code>,{" "}
              <code className="text-neutral-400">@atlas</code> o{" "}
              <code className="text-neutral-400">@pixel</code>. Usa{" "}
              <code className="text-neutral-400">@todos</code> para que
              delibere el equipo completo.
            </>
          )}
        </p>
      </aside>

      {/* --- Conversacion --- */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium">#{roomId}</h1>
            <p className="text-xs text-neutral-500">
              Comparte esta URL para que otra persona entre al mismo room
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setLiveRoom((v) => !v)}
              title={
                liveRoom
                  ? "Los agentes deciden solos cuándo intervenir"
                  : "Los agentes solo responden si los mencionas"
              }
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                liveRoom
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                  : "border-white/15 text-neutral-500"
              }`}
            >
              {liveRoom ? "● sala viva" : "○ solo menciones"}
            </button>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                status === "ready"
                  ? "bg-emerald-400/10 text-emerald-300"
                  : "bg-amber-400/10 text-amber-300"
              }`}
            >
              {status}
            </span>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {visible.length === 0 && (
            <p className="mt-10 text-center text-sm text-neutral-600">
              Sala vacía. Escribe algo mencionando a un agente.
            </p>
          )}

          {visible.map((m) => {
            if (m.type === MSG.AGENT_MESSAGE) {
              const c = m.content as AgentMessageContent;
              return (
                <AgentBubble key={m.id} slug={c.agentSlug} text={c.text} />
              );
            }
            const c = m.content as HumanContent;
            const mine = m.sender.id === identity?.id;
            return (
              <div key={m.id} className={mine ? "text-right" : ""}>
                <p className="mb-0.5 text-[11px] text-neutral-500">
                  {c.author ?? namesById.get(m.sender.id)?.name ?? "anónimo"}
                </p>
                <div
                  className={`inline-block max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                    mine ? "bg-indigo-500/20" : "bg-white/5"
                  }`}
                >
                  {c.text}
                </div>
              </div>
            );
          })}

          {/* Respuestas en vuelo: crecen fragmento a fragmento */}
          {Object.entries(drafts).map(([runId, d]) => (
            <AgentBubble
              key={runId}
              slug={d.agentSlug}
              text={d.text}
              streaming
            />
          ))}

          {typing.filter((id) => id !== identity?.id).length > 0 && (
            <p className="text-xs text-neutral-500">
              {typing
                .filter((id) => id !== identity?.id)
                .map((id) => namesById.get(id)?.name ?? "alguien")
                .join(", ")}{" "}
              está escribiendo…
            </p>
          )}
        </div>

        <div className="border-t border-white/10 p-3">
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                sendTyping();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder={
                liveRoom
                  ? "Escribe con normalidad: el agente adecuado responderá solo"
                  : "Menciona @nova, @atlas, @pixel o @todos"
              }
              className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-neutral-600 focus:border-white/25"
            />
            <button
              onClick={() => void submit()}
              disabled={!input.trim() || busy}
              className="rounded-lg bg-indigo-500 px-4 text-sm font-medium disabled:opacity-40"
            >
              Enviar
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function AgentBubble({
  slug,
  text,
  streaming,
}: {
  slug: string;
  text: string;
  streaming?: boolean;
}) {
  const agent = AGENT_BY_SLUG.get(slug);
  return (
    <div>
      <p className="mb-0.5 text-[11px] text-neutral-500">
        {agent?.name ?? slug} · {agent?.role}
      </p>
      <div
        className={`inline-block max-w-[80%] rounded-2xl border px-3 py-2 text-sm ${
          agent?.accent ?? "border-white/10 bg-white/5"
        }`}
      >
        {text}
        {streaming && (
          <span className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-current" />
        )}
      </div>
    </div>
  );
}
