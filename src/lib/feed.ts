/**
 * Las fuentes de datos en vivo de la sala.
 *
 * Son el tercer tipo de participante, junto a las personas y los agentes:
 * algo que ocurre en el mundo real y entra al canal sin que nadie lo pida.
 * Cuando llega un evento, los agentes reaccionan a un hecho, no a una
 * pregunta -- que es la diferencia entre un chat con IA y una sala donde
 * esta pasando algo.
 *
 * Cada fuente es una entrada del registro de abajo. Anadir una cuarta es
 * escribir una funcion que devuelva `FeedEvent[]`: nada mas del sistema
 * sabe de donde salen los hechos.
 *
 * Las tres son publicas, sin clave y sin cuota.
 */

export type SourceId = "usgs" | "wikipedia" | "hackernews";

export interface FeedEvent {
  /** Id estable de la fuente. Es la clave para no publicar duplicados. */
  id: string;
  /** Frase lista para leer, y tambien lo que se le pasa al agente. */
  detail: string;
  url: string;
  /** Epoch en milisegundos. */
  time: number;
}

export interface FeedSource {
  id: SourceId;
  /** Como se muestra en el interruptor de la sala. */
  label: string;
  /** Que clase de hechos trae, para el prompt del agente. */
  kind: string;
  /** Nombre a citar en la tarjeta del evento. */
  attribution: string;
  fetchLatest(limit: number): Promise<FeedEvent[]>;
}

async function getJson<T>(url: string, headers?: HeadersInit): Promise<T> {
  const res = await fetch(url, {
    // Sin esto Next cachearia la respuesta y la sala se quedaria mirando
    // el mismo hecho durante horas.
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} respondio ${res.status}`);
  return (await res.json()) as T;
}

// --------------------------------------------------------------------
// Sismos (USGS)
// --------------------------------------------------------------------

interface UsgsFeature {
  id?: string;
  properties?: {
    mag?: number | null;
    place?: string | null;
    time?: number | null;
    url?: string | null;
  };
}

const MIN_MAGNITUDE = 2.5;

async function loadUsgs(window: "hour" | "day", limit: number) {
  const data = await getJson<{ features?: UsgsFeature[] }>(
    `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_${window}.geojson`,
  );

  return (data.features ?? [])
    .flatMap((f) => {
      const p = f.properties;
      if (!f.id || !p?.time) return [];
      const mag = typeof p.mag === "number" ? p.mag : null;
      if (mag !== null && mag < MIN_MAGNITUDE) return [];

      // El USGS entrega la magnitud con toda su precision de calculo
      // (2.57421660423279); a un lector solo le sirve una decimal.
      const magnitude =
        mag === null ? "magnitud desconocida" : `magnitud ${mag.toFixed(1)}`;
      const when = new Date(p.time).toISOString().slice(11, 16);

      return [
        {
          id: f.id,
          detail: `Sismo de ${magnitude} en ${p.place ?? "ubicacion desconocida"}, registrado a las ${when} UTC.`,
          url: p.url ?? "",
          time: p.time,
        },
      ];
    })
    .sort((a, b) => b.time - a.time)
    .slice(0, limit);
}

const usgs: FeedSource = {
  id: "usgs",
  label: "Sismos",
  kind: "actividad sismica registrada por el USGS",
  attribution: "USGS",
  async fetchLatest(limit) {
    const recent = await loadUsgs("hour", limit);
    // La ultima hora puede no traer nada por encima del umbral; se amplia
    // la ventana antes que devolver una sala vacia.
    return recent.length > 0 ? recent : loadUsgs("day", limit);
  },
};

// --------------------------------------------------------------------
// Wikipedia en vivo
// --------------------------------------------------------------------

interface WikiChange {
  rcid?: number;
  title?: string;
  user?: string;
  timestamp?: string;
  comment?: string;
  newlen?: number;
  oldlen?: number;
}

const wikipedia: FeedSource = {
  id: "wikipedia",
  label: "Wikipedia",
  kind: "ediciones que ocurren ahora mismo en Wikipedia en espanol",
  attribution: "Wikipedia",
  async fetchLatest(limit) {
    const data = await getJson<{ query?: { recentchanges?: WikiChange[] } }>(
      "https://es.wikipedia.org/w/api.php?action=query&list=recentchanges" +
        "&rcprop=title|timestamp|comment|user|sizes|ids&rcnamespace=0" +
        "&rcshow=!bot&rctype=edit|new&rclimit=20&format=json&origin=*",
      // Wikipedia pide identificarse; sin esto puede limitar la peticion.
      { "User-Agent": "agentroom/1.0 (hackathon project)" },
    );

    return (data.query?.recentchanges ?? [])
      .flatMap((c) => {
        if (!c.rcid || !c.title || !c.timestamp) return [];

        const delta = (c.newlen ?? 0) - (c.oldlen ?? 0);
        const magnitud =
          delta > 0 ? `+${delta} caracteres` : `${delta} caracteres`;
        const motivo = c.comment?.trim();

        return [
          {
            id: `wiki-${c.rcid}`,
            detail:
              `Alguien acaba de editar "${c.title}" en Wikipedia (${magnitud})` +
              (motivo ? `. Resumen del cambio: "${motivo.slice(0, 160)}"` : "."),
            url: `https://es.wikipedia.org/wiki/${encodeURIComponent(c.title)}`,
            time: Date.parse(c.timestamp),
          },
        ];
      })
      .sort((a, b) => b.time - a.time)
      .slice(0, limit);
  },
};

// --------------------------------------------------------------------
// Hacker News
// --------------------------------------------------------------------

interface HnHit {
  objectID?: string;
  title?: string;
  url?: string | null;
  author?: string;
  points?: number | null;
  created_at_i?: number;
}

const hackernews: FeedSource = {
  id: "hackernews",
  label: "Hacker News",
  kind: "historias recien publicadas en Hacker News",
  attribution: "Hacker News",
  async fetchLatest(limit) {
    const data = await getJson<{ hits?: HnHit[] }>(
      "https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=20",
    );

    return (data.hits ?? [])
      .flatMap((h) => {
        if (!h.objectID || !h.title || !h.created_at_i) return [];
        return [
          {
            id: `hn-${h.objectID}`,
            // "Compartida por" y no "publicada por": quien la envia a HN
            // rara vez es su autor, y los agentes lo confundian, atribuyendo
            // el proyecto entero a quien solo pego un enlace.
            detail: `Alguien acaba de compartir en Hacker News la historia "${h.title}"${
              h.author ? ` (enviada por el usuario ${h.author})` : ""
            }.`,
            url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
            time: h.created_at_i * 1000,
          },
        ];
      })
      .sort((a, b) => b.time - a.time)
      .slice(0, limit);
  },
};

// --------------------------------------------------------------------

export const SOURCES: Record<SourceId, FeedSource> = {
  usgs,
  wikipedia,
  hackernews,
};

export const SOURCE_LIST = Object.values(SOURCES);

export const DEFAULT_SOURCE: SourceId = "usgs";

/** Resuelve un id que viene del cliente, con respaldo seguro. */
export function resolveSource(id: string | undefined): FeedSource {
  return SOURCES[(id ?? "") as SourceId] ?? SOURCES[DEFAULT_SOURCE];
}
