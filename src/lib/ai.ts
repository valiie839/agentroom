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

async function* streamGroq(
  messages: ChatMessage[],
  options: StreamOptions,
): AsyncGenerator<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireKey("GROQ_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model ?? DEFAULT_MODELS.groq,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 1024,
      stream: true,
    }),
    signal: options.signal,
  });

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

  const res = await fetch(
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
          maxOutputTokens: options.maxTokens ?? 1024,
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

// --- Formas minimas de las respuestas, solo lo que consumimos ---

interface GroqChunk {
  choices?: Array<{ delta?: { content?: string } }>;
}

interface GeminiChunk {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}
