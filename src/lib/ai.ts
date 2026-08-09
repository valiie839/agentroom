/**
 * Capa adaptadora de LLM.
 *
 * El proveedor se elige con la variable LLM_PROVIDER (groq | gemini).
 * Ambos exponen la misma interfaz `streamChat`, que devuelve un
 * AsyncGenerator de deltas de texto. Cambiar de proveedor es cambiar
 * una linea del .env.local, sin tocar el resto del codigo.
 *
 * Solo se ejecuta en el servidor: lee las API keys de process.env.
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface StreamOptions {
  /** Sobrescribe el modelo por defecto del proveedor. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

type Provider = "groq" | "gemini";

const DEFAULT_MODELS: Record<Provider, string> = {
  // 70B versatil: buena calidad de razonamiento y soporta tool calls.
  // Para maxima velocidad en demo: "llama-3.1-8b-instant".
  groq: "llama-3.3-70b-versatile",
  gemini: "gemini-2.5-flash",
};

function resolveProvider(): Provider {
  const raw = (process.env.LLM_PROVIDER ?? "groq").trim().toLowerCase();
  if (raw !== "groq" && raw !== "gemini") {
    throw new Error(
      `LLM_PROVIDER invalido: "${raw}". Valores aceptados: groq | gemini.`,
    );
  }
  return raw;
}

function requireKey(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith("TODO")) {
    throw new Error(
      `Falta ${name} en .env.local (o quedo con el placeholder TODO).`,
    );
  }
  return value;
}

/**
 * Peticion con reintento ante limite de tasa.
 *
 * El plan gratuito de Groq permite 12.000 tokens por minuto. Tres agentes
 * deliberando mas un evento de la fuente pueden rozarlo en una rafaga, y
 * un 429 en mitad de una demo en vivo se ve como si el producto estuviera
 * roto. La espera que indica el proveedor suele ser de segundos, asi que
 * sale mucho mas barato aguantar que fallar.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  // Un solo reintento: con tres agentes en secuencia, esperar mas de una
  // vez por cada uno acercaba la peticion al corte de 60s de Vercel. Si el
  // reintento no basta, quien resuelve es la degradacion a otro modelo.
  attempts = 2,
): Promise<Response> {
  let last: Response | undefined;

  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, init);
    if (res.status !== 429) return res;

    last = res;
    if (i === attempts - 1) break;

    // El proveedor dice cuanto esperar; si no lo dice, se sube la espera
    // progresivamente. Se acota para no agotar el presupuesto de la funcion.
    const hinted = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(hinted) && hinted > 0
      ? Math.min(hinted * 1000, 8_000)
      : 1_000 * (i + 1);

    await new Promise((r) => setTimeout(r, waitMs));
  }

  return last!;
}

/**
 * Parsea un stream SSE y va emitiendo el campo `data:` de cada evento.
 * Groq y Gemini usan ambos SSE, asi que este lector sirve para los dos.
 */
async function* readSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Los eventos SSE se separan por linea en blanco. Procesamos por
      // lineas porque ambos proveedores mandan un `data:` por evento.
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        if (payload) yield payload;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function groqStream(
  model: string,
  messages: ChatMessage[],
  options: StreamOptions,
): Promise<Response> {
  return fetchWithRetry("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireKey("GROQ_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 500,
      stream: true,
    }),
    signal: options.signal,
  });
}

async function* streamGroq(
  messages: ChatMessage[],
  options: StreamOptions,
): AsyncGenerator<string> {
  const preferred = options.model ?? DEFAULT_MODELS.groq;

  let res = await groqStream(preferred, messages, options);

  // Los limites de Groq son por modelo. Si el grande esta saturado, el
  // pequeño casi nunca lo esta: se responde algo peor antes que no
  // responder nada. En una sala en vivo, el silencio es el peor resultado.
  if (res.status === 429 && preferred !== FAST_MODELS.groq) {
    res = await groqStream(FAST_MODELS.groq, messages, options);
  }

  if (!res.ok || !res.body) {
    throw new Error(`Groq respondio ${res.status}: ${await res.text()}`);
  }

  for await (const payload of readSSE(res.body)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue; // chunk partido a la mitad: lo ignoramos
    }
    const delta = (parsed as GroqChunk)?.choices?.[0]?.delta?.content;
    if (delta) yield delta;
  }
}

async function* streamGemini(
  messages: ChatMessage[],
  options: StreamOptions,
): AsyncGenerator<string> {
  const model = options.model ?? DEFAULT_MODELS.gemini;

  // Gemini separa el system prompt del historial y usa "model"
  // en lugar de "assistant" como rol del modelo.
  const system = messages.filter((m) => m.role === "system");
  const turns = messages.filter((m) => m.role !== "system");

  const res = await fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": requireKey("GEMINI_API_KEY"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: turns.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        ...(system.length > 0 && {
          systemInstruction: {
            parts: system.map((m) => ({ text: m.content })),
          },
        }),
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.maxTokens ?? 500,
          // Gemini 2.5 gasta tokens "pensando" antes de responder y se comia
          // el presupuesto entero: la respuesta llegaba vacia con MAX_TOKENS.
          // Aqui no hace falta razonar en silencio, hace falta conversar.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: options.signal,
    },
  );

  if (!res.ok || !res.body) {
    throw new Error(`Gemini respondio ${res.status}: ${await res.text()}`);
  }

  for await (const payload of readSSE(res.body)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    const parts = (parsed as GeminiChunk)?.candidates?.[0]?.content?.parts;
    for (const part of parts ?? []) {
      if (part.text) yield part.text;
    }
  }
}

/**
 * Punto de entrada unico. Emite deltas de texto conforme llegan.
 *
 *   for await (const delta of streamChat(messages)) { ... }
 */
export function streamChat(
  messages: ChatMessage[],
  options: StreamOptions = {},
): AsyncGenerator<string> {
  return resolveProvider() === "gemini"
    ? streamGemini(messages, options)
    : streamGroq(messages, options);
}

/** Nombre del modelo en uso, para mostrarlo en la UI del room. */
export function activeModel(): string {
  const provider = resolveProvider();
  return DEFAULT_MODELS[provider];
}

/**
 * Modelo pequeño y rápido para decisiones internas (enrutado), donde solo
 * se esperan unas pocas palabras y la latencia importa más que la calidad.
 */
const FAST_MODELS: Record<Provider, string> = {
  groq: "llama-3.1-8b-instant",
  gemini: "gemini-2.5-flash-lite",
};

/**
 * Una respuesta corta, sin streaming. Se usa para el enrutado: decidir qué
 * agente debe hablar no es algo que el usuario vea escribirse, así que no
 * tiene sentido pagar el coste de transmitirlo.
 */
export async function completeFast(
  messages: ChatMessage[],
  maxTokens = 12,
  /**
   * Usa el modelo grande en lugar del pequeño. Para enrutar basta el
   * pequeño -- son dos palabras -- pero para destilar una conversacion no:
   * el 8B extraia frases literales del hilo en vez de reunirlas en una
   * conclusion, que es justo lo que hace inutil una pizarra.
   */
  useMainModel = false,
): Promise<string> {
  const provider = resolveProvider();
  const models = useMainModel ? DEFAULT_MODELS : FAST_MODELS;

  if (provider === "gemini") {
    const system = messages.filter((m) => m.role === "system");
    const turns = messages.filter((m) => m.role !== "system");
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${models.gemini}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": requireKey("GEMINI_API_KEY"),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: turns.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
          ...(system.length > 0 && {
            systemInstruction: { parts: system.map((m) => ({ text: m.content })) },
          }),
          generationConfig: { temperature: 0, maxOutputTokens: maxTokens , thinkingConfig: { thinkingBudget: 0 } },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini respondio ${res.status}`);
    const data = (await res.json()) as GeminiChunk;
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  }

  const call = (model: string) =>
    fetchWithRetry("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireKey("GROQ_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        max_tokens: maxTokens,
      }),
    });

  let res = await call(models.groq);

  // Misma degradacion que en el streaming: los limites son por modelo, asi
  // que ante saturacion se sirve con el pequeño en vez de fallar.
  if (res.status === 429 && models.groq !== FAST_MODELS.groq) {
    res = await call(FAST_MODELS.groq);
  }

  if (!res.ok) throw new Error(`Groq respondio ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

// --- Formas minimas de las respuestas, solo lo que consumimos ---

interface GroqChunk {
  choices?: Array<{ delta?: { content?: string } }>;
}

interface GeminiChunk {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}
