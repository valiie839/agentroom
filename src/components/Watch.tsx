"use client";

/**
 * La sala vista desde fuera.
 *
 * Escucha el canal espejo, que es de tipo broadcast: presencia agregada
 * (solo el numero de espectadores) y sin derecho a publicar. Una audiencia
 * no necesita saber quien mas esta mirando, y el roster detallado de la
 * sala se volveria ilegible con unas pocas decenas de personas.
 *
 * Aqui no hay caja de texto. Es deliberado: mirar y participar son cosas
 * distintas, y esta pagina existe para lo primero.
 */

import { useEffect, useMemo, useRef } from "react";
import { useChannel } from "@portalsdk/react";
import { AGENT_BY_SLUG } from "@/lib/agents";
import {
  MSG,
  TRANSIENT_TYPES,
  watchChannelIdFor,
  type AgentMessageContent,
  type AgentToolContent,
  type FeedEventContent,
  type HumanContent,
  type RoomContent,
  type SynthesisContent,
} from "@/lib/room-types";

export function Watch({ roomId }: { roomId: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, presence, status } = useChannel<RoomContent>({
    channelId: watchChannelIdFor(roomId),
    history: 60,
  });

  const visible = useMemo(
    () => messages.filter((m) => !TRANSIENT_TYPES.includes(m.type)),
    [messages],
  );

  const synthesis = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === MSG.SYNTHESIS) {
        return messages[i].content as SynthesisContent;
      }
    }
    return undefined;
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [visible.length]);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-medium">
            Mirando #{roomId}
          </h1>
          <p className="text-xs text-neutral-500">
            Solo lectura · la conversación ocurre en la sala
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px]">
          <span className="rounded-full border border-white/15 px-2 py-0.5 text-neutral-400">
            {presence?.count ?? 0} mirando
          </span>
          <span
            className={`rounded-full px-2 py-0.5 ${
              status === "ready"
                ? "bg-emerald-400/10 text-emerald-300"
                : "bg-amber-400/10 text-amber-300"
            }`}
          >
            {status}
          </span>
        </div>
      </header>

      {synthesis && (
        <div className="border-b border-white/10 bg-white/[0.03] px-4 py-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Lo que sabemos hasta ahora
          </p>
          <ul className="space-y-0.5">
            {synthesis.points.map((p, i) => (
              <li key={i} className="flex gap-2 text-sm text-neutral-300">
                <span className="select-none text-neutral-600">—</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {visible.length === 0 && (
          <p className="mt-10 text-center text-sm text-neutral-600">
            Todavía no ha pasado nada en esta sala.
          </p>
        )}

        {visible.map((m) => {
          if (m.type === MSG.AGENT_MESSAGE) {
            const c = m.content as AgentMessageContent;
            const agent = AGENT_BY_SLUG.get(c.agentSlug);
            return (
              <div key={m.id}>
                <p className="mb-0.5 text-[11px] text-neutral-500">
                  {agent?.name ?? c.agentSlug} · {agent?.role}
                </p>
                <div
                  className={`inline-block max-w-[85%] rounded-2xl border px-3 py-2 text-sm ${
                    agent?.accent ?? "border-white/10 bg-white/5"
                  }`}
                >
                  {c.text}
                </div>
              </div>
            );
          }

          if (m.type === MSG.FEED_EVENT) {
            const c = m.content as FeedEventContent;
            return (
              <div
                key={m.id}
                className="rounded-xl border border-orange-400/30 bg-orange-400/5 px-3 py-2"
              >
                <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-orange-300/80">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400" />
                  En vivo · {c.source}
                </p>
                <p className="text-sm text-neutral-200">{c.detail}</p>
              </div>
            );
          }

          if (m.type === MSG.AGENT_TOOL) {
            const c = m.content as AgentToolContent;
            const agent = AGENT_BY_SLUG.get(c.agentSlug);
            return (
              <p
                key={m.id}
                className="flex items-center gap-1.5 pl-1 font-mono text-[11px] text-neutral-500"
              >
                <span className="text-neutral-600">⌁</span>
                {agent?.name ?? c.agentSlug} consultó{" "}
                <code className="text-neutral-400">{c.tool}</code>
              </p>
            );
          }

          const c = m.content as HumanContent;
          return (
            <div key={m.id} className="text-right">
              <p className="mb-0.5 text-[11px] text-neutral-500">
                {c.author ?? "anónimo"}
              </p>
              <div className="inline-block max-w-[85%] rounded-2xl bg-white/5 px-3 py-2 text-sm">
                {c.text}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
