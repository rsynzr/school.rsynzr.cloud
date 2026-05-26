const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const DEFAULT_RATE_LIMIT_REQUESTS = 30;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;
const MAX_MESSAGES = 40;
const MAX_CONTENT_LENGTH = 8000;
const MAX_TOTAL_CONTENT_LENGTH = 24000;
const rateLimitStore = new Map();

export default {
  async fetch(request, env) {
    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/chat") {
      return jsonResponse({ error: "Endpoint tidak ditemukan." }, 404, corsHeaders);
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method tidak diizinkan." }, 405, {
        ...corsHeaders,
        Allow: "POST, OPTIONS"
      });
    }

    const limitResult = checkRateLimit(request, env);
    if (!limitResult.allowed) {
      return jsonResponse({ error: "Terlalu banyak request. Coba lagi sebentar lagi." }, 429, {
        ...corsHeaders,
        "Retry-After": String(limitResult.retryAfter)
      });
    }

    if (!env.GROQ_API_KEY) {
      console.error("Missing GROQ_API_KEY secret.");
      return jsonResponse({ error: "Konfigurasi server belum lengkap." }, 500, corsHeaders);
    }

    try {
      const payload = await readJsonBody(request);
      const parsed = validatePayload(payload, env);

      const groqResponse = await fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: env.GROQ_MODEL || DEFAULT_MODEL,
          messages: parsed.messages,
          temperature: parsed.temperature,
          max_completion_tokens: getPositiveInteger(env.MAX_OUTPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS)
        })
      });

      const groqPayload = await groqResponse.json().catch(() => null);

      if (!groqResponse.ok) {
        console.error("Groq API error", groqResponse.status, sanitizeForLog(groqPayload));
        return jsonResponse({ error: mapGroqError(groqResponse.status) }, mapStatus(groqResponse.status), corsHeaders);
      }

      const reply = groqPayload?.choices?.[0]?.message?.content;
      if (typeof reply !== "string" || !reply.trim()) {
        console.error("Groq returned an empty response.");
        return jsonResponse({ error: "AI mengirim respons kosong." }, 502, corsHeaders);
      }

      return jsonResponse({
        reply: reply.trim(),
        model: groqPayload.model || env.GROQ_MODEL || DEFAULT_MODEL,
        usage: groqPayload.usage || null
      }, 200, corsHeaders);
    } catch (error) {
      if (error instanceof ClientError) {
        return jsonResponse({ error: error.message }, error.status, corsHeaders);
      }

      console.error("Unhandled worker error", error);
      return jsonResponse({ error: "Server sedang bermasalah. Coba lagi nanti." }, 500, corsHeaders);
    }
  }
};

class ClientError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ClientError";
    this.status = status;
  }
}

async function readJsonBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ClientError("Content-Type harus application/json.", 415);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 120000) {
    throw new ClientError("Request terlalu besar.", 413);
  }

  try {
    return await request.json();
  } catch (_error) {
    throw new ClientError("Body JSON tidak valid.", 400);
  }
}

function validatePayload(payload, env) {
  if (!payload || typeof payload !== "object") {
    throw new ClientError("Body request tidak valid.", 400);
  }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    throw new ClientError("messages[] wajib diisi.", 400);
  }

  const messages = [];
  const systemPrompt = sanitizeContent(payload.system || env.DEFAULT_SYSTEM_PROMPT || "");
  if (systemPrompt) {
    messages.push({
      role: "system",
      content: systemPrompt.slice(0, 2000)
    });
  }

  let totalLength = systemPrompt.length;
  const chatMessages = payload.messages.slice(-MAX_MESSAGES);

  for (const item of chatMessages) {
    if (!item || typeof item !== "object") {
      throw new ClientError("Format message tidak valid.", 400);
    }

    if (item.role !== "user" && item.role !== "assistant") {
      throw new ClientError("Role message hanya boleh user atau assistant.", 400);
    }

    const content = sanitizeContent(item.content);
    if (!content) {
      continue;
    }

    if (content.length > MAX_CONTENT_LENGTH) {
      throw new ClientError("Salah satu message terlalu panjang.", 413);
    }

    totalLength += content.length;
    if (totalLength > MAX_TOTAL_CONTENT_LENGTH) {
      throw new ClientError("Total percakapan terlalu panjang.", 413);
    }

    messages.push({
      role: item.role,
      content
    });
  }

  if (!messages.some((message) => message.role === "user")) {
    throw new ClientError("Minimal harus ada satu message user.", 400);
  }

  return {
    messages,
    temperature: clampNumber(payload.temperature, DEFAULT_TEMPERATURE, 0, 2)
  };
}

function sanitizeContent(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

function checkRateLimit(request, env) {
  const now = Date.now();
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const maxRequests = getPositiveInteger(env.RATE_LIMIT_REQUESTS, DEFAULT_RATE_LIMIT_REQUESTS);
  const windowMs = getPositiveInteger(env.RATE_LIMIT_WINDOW_SECONDS, DEFAULT_RATE_LIMIT_WINDOW_SECONDS) * 1000;
  const record = rateLimitStore.get(ip);

  if (!record || record.resetAt <= now) {
    rateLimitStore.set(ip, {
      count: 1,
      resetAt: now + windowMs
    });
    cleanupRateLimitStore(now);
    return { allowed: true, retryAfter: 0 };
  }

  if (record.count >= maxRequests) {
    return {
      allowed: false,
      retryAfter: Math.ceil((record.resetAt - now) / 1000)
    };
  }

  record.count += 1;
  return { allowed: true, retryAfter: 0 };
}

function cleanupRateLimitStore(now) {
  if (rateLimitStore.size < 2000) return;

  for (const [key, value] of rateLimitStore.entries()) {
    if (value.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
}

function buildCorsHeaders(request, env) {
  const requestOrigin = request.headers.get("Origin") || "";
  const allowedOrigins = String(env.ALLOWED_ORIGIN || "*")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const allowAny = allowedOrigins.includes("*") || allowedOrigins.length === 0;
  const origin = allowAny
    ? "*"
    : allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : allowedOrigins[0];

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8"
  };
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers
  });
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function getPositiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return fallback;
  return number;
}

function mapGroqError(status) {
  if (status === 401 || status === 403) return "Server tidak bisa mengakses layanan AI.";
  if (status === 429) return "Layanan AI sedang sibuk. Coba lagi sebentar lagi.";
  if (status >= 500) return "Layanan AI sedang bermasalah.";
  return "Request ke layanan AI ditolak.";
}

function mapStatus(status) {
  if (status === 429) return 429;
  if (status === 401 || status === 403) return 502;
  if (status >= 500) return 502;
  return 400;
}

function sanitizeForLog(value) {
  if (!value || typeof value !== "object") return null;
  return {
    error: value.error?.message || value.error || null
  };
}
