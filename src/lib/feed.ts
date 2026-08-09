/**
 * La fuente de datos en vivo de la sala.
 *
 * Es el tercer tipo de participante, junto a las personas y los agentes:
 * algo que ocurre en el mundo real y entra al canal sin que nadie lo pida.
 * Cuando llega un evento, los agentes reaccionan a un hecho, no a una
 * pregunta -- que es la diferencia entre un chat con IA y una sala que
 * esta pasando algo.
 *
 * Se usa el feed publico del USGS: sin clave, sin cuota y con eventos lo
 * bastante espaciados como para no ahogar la conversacion.
 *
 * Toda la dependencia de la fuente vive en este archivo. Cambiarla por
 * otra (Wikipedia, mercados, vuelos) es reimplementar `fetchLatestEvents`.
 */

const USGS_HOUR =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson";

/**
 * Respaldo. La ventana horaria suele traer uno o ningun evento relevante,
 * y una sala que abre en silencio no demuestra nada. Con la ventana diaria
 * siempre hay material, aunque sea de hace unas horas.
 */
const USGS_DAY =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

export interface FeedEvent {
  /** Id estable de la fuente. Es la clave para no publicar duplicados. */
  id: string;
  /** Titular legible, tal cual lo entrega la fuente. */
  title: string;
  magnitude: number | null;
  place: string;
  /** Epoch en milisegundos. */
  time: number;
  url: string;
}

interface UsgsFeature {
  id?: string;
  properties?: {
    title?: string;
    mag?: number | null;
    place?: string | null;
    time?: number | null;
    url?: string | null;
  };
}

/**
 * Ultimos eventos de la fuente, del mas reciente al mas antiguo.
 *
 * `minMagnitude` filtra el ruido: el feed horario trae muchos microsismos
 * que no le interesan a nadie, y una sala que comenta cada 0.8 en la
 * escala es tan inutil como una muda.
 */
export async function fetchLatestEvents(
  minMagnitude = 2.5,
  limit = 5,
): Promise<FeedEvent[]> {
  const recent = await load(USGS_HOUR, minMagnitude, limit);
  if (recent.length > 0) return recent;

  // La ultima hora puede no traer nada por encima del umbral; se amplia la
  // ventana antes que devolver una sala vacia.
  return load(USGS_DAY, minMagnitude, limit);
}

async function load(
  url: string,
  minMagnitude: number,
  limit: number,
): Promise<FeedEvent[]> {
  const res = await fetch(url, {
    // Sin esto Next cachearia la respuesta y la sala se quedaria mirando
    // el mismo sismo durante horas.
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`USGS respondio ${res.status}`);
  }

  const data = (await res.json()) as { features?: UsgsFeature[] };

  return (data.features ?? [])
    .flatMap((f) => {
      const p = f.properties;
      if (!f.id || !p?.time) return [];
      const magnitude = typeof p.mag === "number" ? p.mag : null;
      if (magnitude !== null && magnitude < minMagnitude) return [];
      return [
        {
          id: f.id,
          title: p.title ?? "Evento sismico",
          magnitude,
          place: p.place ?? "ubicacion desconocida",
          time: p.time,
          url: p.url ?? "",
        },
      ];
    })
    .sort((a, b) => b.time - a.time)
    .slice(0, limit);
}

/** Redaccion compacta del evento para el prompt de los agentes. */
export function describeEvent(event: FeedEvent): string {
  const magnitude =
    event.magnitude === null ? "magnitud desconocida" : `magnitud ${event.magnitude}`;
  const when = new Date(event.time).toISOString().slice(11, 16);
  return `Sismo de ${magnitude} en ${event.place}, registrado a las ${when} UTC.`;
}
