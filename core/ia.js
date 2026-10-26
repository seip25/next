import { RateLimit } from "./ratelimit.js";

/**
 * In-memory cache with LRU eviction for AI responses (Anti-Token-Leak).
 */
class MemoryCache {
  constructor(maxSize = 2000) {
    this.maxSize = maxSize;
    this.store = new Map();
  }

  get(key) {
    if (!this.store.has(key)) return null;
    const value = this.store.get(key);
    // Refresh LRU position
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, value);
  }

  has(key) {
    return this.store.has(key);
  }

  clear() {
    this.store.clear();
  }
}

const defaultMemoryCache = new MemoryCache();

let openAiSdk = null;
try {
  const mod = await import("openai");
  openAiSdk = mod.default || mod.OpenAI || mod;
} catch {}

/**
 * Decoupled, high-performance AI orchestrator for Next.js and VPS.
 * Provides Anti-Token-Leak protection with in-memory caching and rate limits by default,
 * completely independent of any database.
 * Supports DeepSeek, OpenAI, Claude/Anthropic, and Google Gemini.
 */
class IA {
  static cache = defaultMemoryCache;

  /**
   * Resolves system prompt from custom string, function, or fallback.
   * Completely decoupled from database.
   * @param {string} userQuestion
   * @param {string|Function} [promptDef]
   * @returns {Promise<string>}
   */
  static async resolveSystemPrompt(userQuestion, promptDef = null) {
    if (typeof promptDef === "function") {
      return promptDef(userQuestion);
    }
    if (typeof promptDef === "string" && promptDef.trim().length > 0) {
      return `${promptDef}\n\nUsuario pregunta: ${userQuestion}`;
    }

    const year = new Date().getFullYear();
    return `Eres un asistente virtual profesional y servicial. El año actual es ${year}.\nReglas:\n1. Sé conciso, preciso y amable.\n2. Si no tienes certeza de un dato, invita al usuario a consultar con el equipo humano.\n\nUsuario pregunta: ${userQuestion}`;
  }

  /**
   * Alias for resolveSystemPrompt.
   * @param {string} userQuestion
   * @param {string|Function} [fallback]
   * @returns {Promise<string>}
   */
  static async getActiveSystemPrompt(userQuestion, fallback = null) {
    return this.resolveSystemPrompt(userQuestion, fallback);
  }

  /**
   * Calls DeepSeek AI API using standard native fetch (zero dependencies),
   * with fallback to OpenAI SDK if installed.
   * @param {string} systemPrompt
   * @param {string} userMessage
   * @param {Object} [options={}]
   * @returns {Promise<string>}
   */
  static async callDeepSeek(systemPrompt, userMessage, options = {}) {
    const rawKey = options.apiKey || process.env.DEEPSEEK_API_KEY || "";
    const apiKey = rawKey.trim().replace(/^["']|["']$/g, "");

    if (!apiKey || apiKey === "default") {
      return options.defaultResponse || "Gracias por tu consulta. Por favor comunícate directamente con nuestro equipo.";
    }

    const endpoint = options.endpoint || "https://api.deepseek.com/chat/completions";
    const models = options.models || [options.model || "deepseek-chat", "deepseek-flash"];

    for (const model of models) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
            stream: false,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.max_tokens ?? 1024,
          }),
        });

        if (response.ok) {
          const json = await response.json();
          const content = json?.choices?.[0]?.message?.content;
          if (content) return content.trim();
        } else {
          const errText = await response.text();
          console.warn(`[AI WARN] DeepSeek model ${model} status ${response.status}:`, errText);
        }
      } catch (err) {
        console.warn(`[AI WARN] DeepSeek model ${model} error:`, err.message);
      }
    }

    return "";
  }

  /**
   * Calls OpenAI Chat Completions API using native fetch.
   * @param {string} systemPrompt
   * @param {string} userMessage
   * @param {Object} [options={}]
   * @returns {Promise<string>}
   */
  static async callOpenAI(systemPrompt, userMessage, options = {}) {
    const rawKey = options.apiKey || process.env.OPENAI_API_KEY || "";
    const apiKey = rawKey.trim().replace(/^["']|["']$/g, "");
    if (!apiKey) return "";

    const endpoint = options.endpoint || "https://api.openai.com/v1/chat/completions";
    const model = options.model || "gpt-4o-mini";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          stream: false,
          temperature: options.temperature ?? 0.7,
        }),
      });

      if (response.ok) {
        const json = await response.json();
        return json?.choices?.[0]?.message?.content?.trim() || "";
      }
    } catch (err) {
      console.warn("[AI ERROR] OpenAI call failed:", err.message);
    }
    return "";
  }

  /**
   * Calls Anthropic / Claude Messages API.
   * @param {string} systemPrompt
   * @param {string} userMessage
   * @param {Object} [options={}]
   * @returns {Promise<string>}
   */
  static async callClaude(systemPrompt, userMessage, options = {}) {
    const rawKey = options.apiKey || process.env.ANTHROPIC_API_KEY || "";
    const apiKey = rawKey.trim().replace(/^["']|["']$/g, "");
    if (!apiKey) return "";

    const endpoint = options.endpoint || "https://api.anthropic.com/v1/messages";
    const model = options.model || "claude-3-5-haiku-latest";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: options.max_tokens ?? 1024,
          system: systemPrompt,
          messages: [{ role: "user", content: userMessage }],
        }),
      });

      if (response.ok) {
        const json = await response.json();
        return json?.content?.[0]?.text?.trim() || "";
      }
    } catch (err) {
      console.warn("[AI ERROR] Claude call failed:", err.message);
    }
    return "";
  }

  /**
   * Calls Google Gemini Generative Language API.
   * @param {string} systemPrompt
   * @param {string} userMessage
   * @param {Object} [options={}]
   * @returns {Promise<string>}
   */
  static async callGemini(systemPrompt, userMessage, options = {}) {
    const rawKey = options.apiKey || process.env.GEMINI_API_KEY || "";
    const apiKey = rawKey.trim().replace(/^["']|["']$/g, "");
    if (!apiKey) return "";

    const model = options.model || "gemini-1.5-flash";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: `${systemPrompt}\n\n${userMessage}` }],
            },
          ],
        }),
      });

      if (response.ok) {
        const json = await response.json();
        return json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      }
    } catch (err) {
      console.warn("[AI ERROR] Gemini call failed:", err.message);
    }
    return "";
  }

  /**
   * Processes AI chat with Anti-Token-Leak caching and rate limiting.
   * Completely independent of database by default.
   *
   * @param {Object} params
   * @param {string} params.message - The user's input question
   * @param {string} [params.ip="127.0.0.1"] - Client IP address for rate limiting
   * @param {string} [params.userAgent=""] - Client User-Agent
   * @param {"deepseek"|"openai"|"claude"|"gemini"} [params.provider="deepseek"] - AI provider
   * @param {string|Function} [params.systemPrompt] - Custom prompt string or generator function
   * @param {boolean|Object} [params.cache=true] - Enable in-memory cache, or pass custom { get, set }
   * @param {boolean} [params.rateLimit=true] - Enable rate limiting
   * @param {number} [params.limitPerMinute=6] - Max requests per minute
   * @param {number} [params.limitPerDay=30] - Max requests per day
   * @param {Function} [params.onLog] - Optional hook: async ({ question, response, ip, userAgent, cached, durationMs }) => {}
   * @param {Object} [params.options] - Provider-specific options
   * @returns {Promise<{data: {response?: string, error?: string, cached?: boolean, retryAfter?: number}, statusCode: number}>}
   */
  static async processChat(params) {
    const {
      message,
      ip = "127.0.0.1",
      userAgent = "",
      provider = "deepseek",
      systemPrompt = null,
      cache = true,
      rateLimit = true,
      limitPerMinute = 6,
      limitPerDay = 30,
      onLog = null,
      options = {},
    } = typeof params === "string" ? { message: params } : params;

    const startTime = Date.now();
    const normalizedMessage = (message || "").trim();
    if (!normalizedMessage) {
      return { data: { error: "El mensaje no puede estar vacío." }, statusCode: 400 };
    }

    const year = new Date().getFullYear();
    const cacheKey = `${year}-${normalizedMessage.toLowerCase()}`;

    const cacheStore = typeof cache === "object" && cache !== null ? cache : (cache ? defaultMemoryCache : null);

    // 1. In-memory Anti-Token-Leak Cache Hit
    if (cacheStore) {
      const cachedResponse = await cacheStore.get(cacheKey);
      if (cachedResponse) {
        if (typeof onLog === "function") {
          try {
            await onLog({
              question: normalizedMessage,
              response: cachedResponse,
              ip,
              userAgent,
              cached: true,
              durationMs: Date.now() - startTime,
            });
          } catch {}
        }
        return { data: { response: cachedResponse, cached: true }, statusCode: 200 };
      }
    }

    // 2. In-memory Rate Limiting
    if (rateLimit) {
      const rateCheck = RateLimit.checkAI({
        key: ip,
        limitPerMinute,
        limitPerDay,
      });

      if (rateCheck.exceeded) {
        if (typeof onLog === "function") {
          try {
            await onLog({
              question: normalizedMessage,
              response: `[BLOQUEADO] ${rateCheck.message}`,
              ip,
              userAgent,
              cached: false,
              blocked: true,
              durationMs: Date.now() - startTime,
            });
          } catch {}
        }
        return {
          data: { error: rateCheck.message, retryAfter: rateCheck.retryAfter },
          statusCode: 429,
        };
      }
    }

    // 3. Resolve System Prompt (pure in-memory or custom function)
    const sysPrompt = await this.resolveSystemPrompt(normalizedMessage, systemPrompt);

    // 4. Call Remote Provider
    let aiResponse = "";
    if (provider === "openai") {
      aiResponse = await this.callOpenAI(sysPrompt, normalizedMessage, options);
    } else if (provider === "claude" || provider === "anthropic") {
      aiResponse = await this.callClaude(sysPrompt, normalizedMessage, options);
    } else if (provider === "gemini") {
      aiResponse = await this.callGemini(sysPrompt, normalizedMessage, options);
    } else {
      aiResponse = await this.callDeepSeek(sysPrompt, normalizedMessage, options);
    }

    // 5. Store Cache and Invoke onLog hook
    if (aiResponse) {
      if (cacheStore) {
        await cacheStore.set(cacheKey, aiResponse);
      }
      if (typeof onLog === "function") {
        try {
          await onLog({
            question: normalizedMessage,
            response: aiResponse,
            ip,
            userAgent,
            cached: false,
            durationMs: Date.now() - startTime,
          });
        } catch {}
      }
      return { data: { response: aiResponse, cached: false }, statusCode: 200 };
    }

    const defaultResp =
      options.defaultResponse ||
      "No pudimos procesar tu respuesta en este momento. Por favor contáctanos directamente para atención personalizada.";

    if (typeof onLog === "function") {
      try {
        await onLog({
          question: normalizedMessage,
          response: defaultResp,
          ip,
          userAgent,
          cached: false,
          durationMs: Date.now() - startTime,
        });
      } catch {}
    }

    return { data: { response: defaultResp, cached: false }, statusCode: 200 };
  }

  /**
   * Alias for processChat.
   */
  static async chat(params) {
    return this.processChat(params);
  }
}

export { IA };
export default IA;
