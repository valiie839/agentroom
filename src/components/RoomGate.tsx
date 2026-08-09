"use client";

/**
 * Pide un nombre visible antes de entrar al room.
 *
 * Portal ya da identidad anonima estable, asi que esto no es login: es
 * solo el nombre que veran los demas. Se guarda en localStorage para no
 * volver a preguntarlo, y viaja como metadata de presencia.
 */

import { useEffect, useState } from "react";
import { Room } from "@/components/Room";
import type { PresenceMeta } from "@/lib/room-types";

const STORAGE_KEY = "agentroom:me";

export function RoomGate({ roomId }: { roomId: string }) {
  const [me, setMe] = useState<PresenceMeta | null>(null);
  const [name, setName] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Un ?name= en la URL entra directo, sin preguntar y sin tocar lo
    // guardado. Sirve para compartir un enlace ya con nombre, y permite
    // tener dos salas con identidades distintas en una misma pantalla
    // (dos iframes comparten el localStorage del navegador, no la URL).
    const fromUrl = new URLSearchParams(window.location.search).get("name");
    if (fromUrl?.trim()) {
      setMe({ name: fromUrl.trim().slice(0, 24) });
      setReady(true);
      return;
    }

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setMe(JSON.parse(saved) as PresenceMeta);
      } catch {
        /* dato corrupto: se vuelve a preguntar */
      }
    }
    setReady(true);
  }, []);

  if (!ready) return null;

  if (!me) {
    const join = () => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const meta: PresenceMeta = { name: trimmed.slice(0, 24) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
      setMe(meta);
    };

    return (
      <div className="grid flex-1 place-items-center p-6">
        <div className="w-full max-w-sm space-y-3">
          <h1 className="text-lg font-medium">Entrar a #{roomId}</h1>
          <p className="text-sm text-neutral-500">
            ¿Cómo quieres que te vean los demás?
          </p>
          <div className="flex gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && join()}
              placeholder="Tu nombre"
              className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/25"
            />
            <button
              onClick={join}
              disabled={!name.trim()}
              className="rounded-lg bg-indigo-500 px-4 text-sm font-medium disabled:opacity-40"
            >
              Entrar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <Room roomId={roomId} me={me} />;
}
