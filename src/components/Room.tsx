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
import { DEFAULT_SOURCE, SOURCE_LIST, type SourceId } from "@/lib/feed";
import {
  MSG,
  channelIdFor,
  avatarColor,
  initialOf,
  TRANSIENT_TYPES,
  type AgentMessageContent,
  type AgentThinkingContent,
  type AgentTokenContent,
  type AgentToolContent,
  type FeedEventContent,
  type SynthesisContent,
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

/** Cada cuanto se le pregunta a la fuente en vivo si paso algo nuevo. */
const FEED_POLL_MS = 30_000;

export function Room({ roomId, me }: { roomId: string; me: PresenceMeta }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  /** Con la sala viva, los agentes deciden solos cuando intervenir. */
  const [liveRoom, setLiveRoom] = useState(true);
  /**
   * Que fuente del mundo real escucha la sala. "off" la desconecta.
   * Cambiarla en vivo es parte de la demostracion: la misma sala puede
   * estar mirando sismos, Wikipedia o Hacker News.
   */
  const [feedSource, setFeedSource] = useState<SourceId | "off">(
    DEFAULT_SOURCE,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * Bolso completo de metadata de presencia. Portal reemplaza el bag entero
   * en cada setMetadata, no lo fusiona, asi que siempre se manda completo.
   */
  const metaRef = useRef<Record<string, unknown>>({ ...me });
  const lastStatus = useRef<string>("");

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
    channelId: channelIdFor(roomId),
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

  /**
   * Solo un cliente sondea la fuente, o cada pestaña abierta anunciaria el
   * mismo sismo. Se elige por regla determinista -- el id mas bajo de la
   * sala -- para que todos coincidan sin negociar nada entre ellos.
   */
  const isFeedDriver = useMemo(() => {
    if (!identity || presence?.kind !== "detailed") return false;
    const ids = presence.participants.map((p) => p.id).sort();
    return ids[0] === identity.id;
  }, [presence, identity]);

  /**
   * La pizarra vigente. Se lee de `messages` y no de `visible` porque la
   * sintesis esta filtrada del hilo: vive en su panel, no como burbuja.
   * Cada version reemplaza a la anterior, asi que solo importa la ultima.
   */
  const synthesis = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === MSG.SYNTHESIS) {
        return messages[i].content as SynthesisContent;
      }
    }
    return undefined;
  }, [messages]);

  /** Historial aplanado, tal y como lo consumen los agentes. */
  const buildHistory = useCallback(
    () =>
      visible.slice(-16).map((m) => {
        if (m.type === MSG.AGENT_MESSAGE) {
          const c = m.content as AgentMessageContent;
          const agent = AGENT_BY_SLUG.get(c.agentSlug);
          return {
            role: "user" as const,
            content: `${agent?.name ?? c.agentSlug} (${agent?.role ?? "agente"}) respondio: ${c.text}`,
          };
        }
        if (m.type === MSG.FEED_EVENT) {
          const c = m.content as FeedEventContent;
          return {
            role: "user" as const,
            content: `[${c.source}] ${c.detail}`,
          };
        }
        const c = m.content as HumanContent;
        return { role: "user" as const, content: `${c.author}: ${c.text}` };
      }),
    [visible],
  );

  // La pizarra se reescribe cuando la conversacion ha avanzado lo bastante
  // como para que valga la pena, no en cada mensaje. Lo dispara el mismo
  // cliente que sondea la fuente, por la misma razon: uno solo.
  useEffect(() => {
    const covered = synthesis?.coverage ?? 0;
    if (!isFeedDriver || status !== "ready") return;
    if (visible.length < 3 || visible.length - covered < 3) return;

    // Espera a que amaine: si estan llegando mensajes, se destila al final
    // de la rafaga y no a mitad.
    const id = setTimeout(() => {
      void fetch("/api/synthesis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, history: buildHistory() }),
      }).catch(() => {
        // La sala funciona igual sin pizarra: se reintenta al siguiente.
      });
    }, 4_000);

    return () => clearTimeout(id);
  }, [visible.length, synthesis, isFeedDriver, status, roomId, buildHistory]);

  /** Eventos de la fuente ya presentes, para no repetirlos. */
  const knownEventIds = useMemo(
    () =>
      visible
        .filter((m) => m.type === MSG.FEED_EVENT)
        .map((m) => (m.content as FeedEventContent).eventId),
    [visible],
  );

  useEffect(() => {
    if (!isFeedDriver || feedSource === "off" || status !== "ready") return;

    let cancelled = false;
    const check = async () => {
      if (cancelled) return;
      try {
        await fetch("/api/feed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roomId,
            source: feedSource,
            knownIds: knownEventIdsRef.current,
          }),
        });
      } catch {
        // La sala no depende del feed: si falla, se reintenta al siguiente.
      }
    };

    // Se consulta pronto, para que quien entra vea señales de vida sin
    // esperar medio minuto -- pero no de inmediato: el historial del canal
    // llega poco despues de `ready`, y sondear antes de tenerlo hacia que
    // la sala volviera a anunciar un evento que ya estaba publicado.
    const first = setTimeout(check, 2_500);
    const id = setInterval(check, FEED_POLL_MS);

    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [isFeedDriver, feedSource, roomId, status]);

  // Los ids viajan por ref para que actualizarlos no reinicie el intervalo.
  const knownEventIdsRef = useRef<string[]>([]);
  useEffect(() => {
    knownEventIdsRef.current = knownEventIds;
  }, [knownEventIds]);

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
    // Solo en la transicion real a "ready": `setMetadata` cambia de
    // identidad en cada render, y sin el guardia el efecto se reejecutaria
    // constantemente reescribiendo el bag.
    if (status === "ready" && lastStatus.current !== "ready") {
      setMetadata(metaRef.current);
    }
    lastStatus.current = status;
  }, [status, setMetadata]);

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
            // Para que el servidor lo espeje al canal de espectadores.
            say: { text, author: me.name },
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
                  <span
                    className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold ${avatarColor(p.id)}`}
                  >
                    {initialOf(meta?.name)}
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
              Comparte esta URL para participar, o{" "}
              <a
                href={`/watch/${roomId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-400 underline underline-offset-2 hover:text-neutral-200"
              >
                el enlace de espectador
              </a>{" "}
              para que solo miren
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
            <select
              value={feedSource}
              onChange={(e) =>
                setFeedSource(e.target.value as SourceId | "off")
              }
              title="Que parte del mundo real escucha esta sala"
              className={`rounded-full border bg-transparent px-2 py-0.5 text-[11px] outline-none transition ${
                feedSource === "off"
                  ? "border-white/15 text-neutral-500"
                  : "border-orange-400/40 bg-orange-400/10 text-orange-300"
              }`}
            >
              <option value="off" className="bg-neutral-900 text-neutral-300">
                ○ sin fuente
              </option>
              {SOURCE_LIST.map((s) => (
                <option
                  key={s.id}
                  value={s.id}
                  className="bg-neutral-900 text-neutral-300"
                >
                  ● {s.label}
                </option>
              ))}
            </select>
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

        {synthesis && <Blackboard synthesis={synthesis} />}

        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} className="h-full space-y-3 overflow-y-auto p-4">
          {visible.length === 0 && (
            <p className="mt-10 text-center text-sm text-neutral-600">
              Sala vacía. Escribe con normalidad: alguien responderá.
            </p>
          )}

          {visible.map((m) => {
            if (m.type === MSG.AGENT_MESSAGE) {
              const c = m.content as AgentMessageContent;
              return (
                <AgentBubble key={m.id} slug={c.agentSlug} text={c.text} />
              );
            }

            if (m.type === MSG.FEED_EVENT) {
              const c = m.content as FeedEventContent;
              return <FeedCard key={m.id} event={c} />;
            }

            if (m.type === MSG.AGENT_TOOL) {
              const c = m.content as AgentToolContent;
              return <ToolCard key={m.id} call={c} />;
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

/**
 * La pizarra de la sala: lo que la conversacion ha dejado en claro.
 *
 * No es un mensaje, es estado compartido. Se queda fija arriba y cada
 * version reemplaza a la anterior, de modo que quien entra a mitad de una
 * conversacion larga no tiene que leerla entera.
 */
function Blackboard({ synthesis }: { synthesis: SynthesisContent }) {
  return (
    <div className="border-b border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-400" />
        Lo que sabemos hasta ahora
        <span className="font-normal normal-case tracking-normal text-neutral-600">
          · destilado de {synthesis.coverage} mensajes
        </span>
      </p>
      <ul className="space-y-0.5">
        {synthesis.points.map((p, i) => (
          <li key={i} className="flex gap-2 text-sm text-neutral-300">
            <span className="select-none text-neutral-600">—</span>
            <span>{p}</span>
          </li>
        ))}
      </ul>
      {synthesis.open && (
        <p className="mt-1.5 text-xs text-amber-300/70">
          Abierto: {synthesis.open}
        </p>
      )}
    </div>
  );
}

/**
 * Un hecho del mundo real entrando a la sala. Se muestra distinto a los
 * mensajes a proposito: no lo dijo nadie de los presentes, ocurrio.
 */
function FeedCard({ event }: { event: FeedEventContent }) {
  return (
    <div className="my-2 rounded-xl border border-orange-400/30 bg-orange-400/5 px-3 py-2">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-orange-300/80">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400" />
        En vivo · {event.source}
      </p>
      <p className="text-sm text-neutral-200">{event.detail}</p>
      {event.url && (
        <a
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-[11px] text-orange-300/70 underline-offset-2 hover:underline"
        >
          Ver en {event.source}
        </a>
      )}
    </div>
  );
}

/** De donde salio el dato, antes de que alguien saque conclusiones. */
function ToolCard({ call }: { call: AgentToolContent }) {
  const agent = AGENT_BY_SLUG.get(call.agentSlug);
  return (
    <p className="flex items-center gap-1.5 pl-1 font-mono text-[11px] text-neutral-500">
      <span className="text-neutral-600">⌁</span>
      {agent?.name ?? call.agentSlug} consultó{" "}
      <code className="text-neutral-400">{call.tool}</code>
      {call.detail && <span className="truncate">— {call.detail}</span>}
    </p>
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
