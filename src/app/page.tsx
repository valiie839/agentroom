"use client";

import { useRouter } from "next/navigation";
import { AGENTS } from "@/lib/agents";

/** Ids cortos y legibles para compartir por chat durante la demo. */
function newRoomId(): string {
  const words = ["orbita", "faro", "delta", "prisma", "cobalto", "eco"];
  const word = words[Math.floor(Math.random() * words.length)];
  return `${word}-${Math.random().toString(36).slice(2, 6)}`;
}

export default function Home() {
  const router = useRouter();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 p-6">
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-indigo-400">
          The Realtime Hackathon · Portal
        </p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Agentes de IA que viven en la sala
        </h1>
        <p className="text-neutral-400">
          Hoy un agente es un endpoint que te devuelve texto después de un
          spinner. Aquí son participantes: aparecen en la lista, escriben
          delante de ti y se leen entre ellos. Todo lo que dicen llega a
          cada pantalla conectada al mismo tiempo.
        </p>
      </div>

      <ul className="grid gap-2 sm:grid-cols-3">
        {AGENTS.map((a) => (
          <li key={a.slug} className={`rounded-xl border p-3 ${a.accent}`}>
            <p className="text-sm font-medium">{a.name}</p>
            <p className="text-xs opacity-70">{a.role}</p>
            <p className="mt-1 text-[11px] opacity-60">@{a.slug}</p>
          </li>
        ))}
      </ul>

      <div className="space-y-3">
        <button
          onClick={() => router.push(`/room/${newRoomId()}`)}
          className="w-full rounded-xl bg-indigo-500 px-4 py-3 text-sm font-medium transition hover:bg-indigo-400"
        >
          Crear una sala
        </button>
        <p className="text-center text-xs text-neutral-600">
          Ábrela en dos ventanas —o pásale la URL a alguien— y verás la misma
          conversación construirse en vivo en ambas.
        </p>
      </div>
    </main>
  );
}
