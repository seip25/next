/**
 * Buckets live on globalThis so every Next.js module instance (proxy.js bundle,
 * route handlers, server actions) in the same process shares the same counters.
 */
const state = (globalThis.__seip_next_ratelimit ??= { buckets: new Map(), timer: null });
const memoryBuckets = state.buckets;

/** Hard cap on tracked keys so a flood of distinct keys cannot exhaust memory. */
const DEFAULT_MAX_KEYS = 50000;

if (!state.timer) {
  state.timer = setInterval(() => {
    if (memoryBuckets.size === 0) return;
    const now = Date.now();
    for (const [key, bucket] of memoryBuckets) {
      if (bucket.resetTime <= now) {
        memoryBuckets.delete(key);
      }
    }
  }, 60000);
  state.timer.unref?.();
}

function getBucket(key, windowMs, now, maxKeys) {
  let bucket = memoryBuckets.get(key);
  if (!bucket || bucket.resetTime <= now) {
    if (!bucket && memoryBuckets.size >= maxKeys) {
      // Evict the oldest entry (Map keeps insertion order).
      const oldest = memoryBuckets.keys().next().value;
      if (oldest !== undefined) memoryBuckets.delete(oldest);
    }
    if (bucket) memoryBuckets.delete(key); // re-insert at the end (fresh window)
    bucket = { count: 1, resetTime: now + windowMs };
    memoryBuckets.set(key, bucket);
  } else {
    bucket.count += 1;
  }
  return bucket;
}

function isIp(value) {
  return typeof value === "string" && /^[0-9a-fA-F:.]{2,45}$/.test(value);
}

/**
 * High-performance Rate Limiter for Next.js 16 proxy.js, Route Handlers, and AI endpoints.
 */
class RateLimit {
  /**
   * Resolves the real client IP behind a reverse proxy.
   *
   * `X-Forwarded-For` is a list the client can pre-fill: nginx's `$proxy_add_x_forwarded_for`
   * APPENDS the real address, so the first entry is attacker-controlled. Resolution order:
   *  1. `X-Real-IP` (set by nginx to `$remote_addr`, overwrites anything the client sent)
   *  2. the entry of `X-Forwarded-For` added by your `trustedProxies` hops (default: 1 = last entry)
   *  3. `request.ip`
   * @param {Request|Object} request
   * @param {Object} [options={}]
   * @param {number} [options.trustedProxies=1] Reverse proxies in front of Next.js (nginx = 1).
   * @returns {string|null}
   */
  static getClientIp(request, options = {}) {
    const trustedProxies = Math.max(1, parseInt(options.trustedProxies ?? process.env.TRUSTED_PROXIES ?? 1, 10) || 1);
    const headers = request?.headers;
    const get = (name) => (typeof headers?.get === "function" ? headers.get(name) : headers?.[name]) || null;

    const realIp = String(get("x-real-ip") || "").trim();
    if (isIp(realIp)) return realIp;

    const forwarded = get("x-forwarded-for");
    if (forwarded) {
      const hops = String(forwarded)
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      const candidate = hops[Math.max(0, hops.length - trustedProxies)];
      if (isIp(candidate)) return candidate;
    }

    if (isIp(request?.ip)) return request.ip;
    return null;
  }

  /**
   * Evaluates request rate limits.
   * Buckets are scoped by `prefix` (default derived from max/windowMs), so a strict
   * login limiter and a general API limiter never share a counter.
   * @param {Request|Object} request
   * @param {Object} [options={}]
   * @returns {{exceeded: boolean, count: number, remaining: number, resetTime: number, response?: Response}}
   */
  static check(request, options = {}) {
    const windowMs = options.windowMs ?? 60000;
    const max = options.max ?? 60;
    const message = options.message ?? "Too many requests, please try again later.";
    const statusCode = options.statusCode ?? 429;
    const prefix = options.prefix ?? `${max}:${windowMs}`;
    const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;

    let clientKey = null;
    if (typeof options.keyGenerator === "function") {
      clientKey = options.keyGenerator(request);
    } else {
      clientKey = this.getClientIp(request, options);
    }
    clientKey = clientKey || "unknown";

    const key = `rl:${prefix}:${clientKey}`;
    const now = Date.now();
    const bucket = getBucket(key, windowMs, now, maxKeys);

    const count = bucket.count;
    const remaining = Math.max(0, max - count);
    const resetSeconds = Math.ceil((bucket.resetTime - now) / 1000);
    const exceeded = count > max;

    const headers = {
      "X-RateLimit-Limit": String(max),
      "X-RateLimit-Remaining": String(remaining),
      "X-RateLimit-Reset": String(Math.ceil(bucket.resetTime / 1000)),
      "Content-Type": "application/json",
    };

    let response = null;
    if (exceeded) {
      headers["Retry-After"] = String(Math.max(1, resetSeconds));
      response = new Response(JSON.stringify({ error: message, retryAfter: resetSeconds }), {
        status: statusCode,
        headers,
      });
    }

    return {
      exceeded,
      count,
      remaining,
      resetTime: bucket.resetTime,
      response,
    };
  }

  /**
   * Specialized Rate Limiter for AI consultations (Anti-fuga de tokens).
   * Supports both minute-level and daily quotas.
   * @param {Object} params
   * @param {string} params.key - Identifier (IP or User ID)
   * @param {number} [params.limitPerMinute=6]
   * @param {number} [params.limitPerDay=30]
   * @returns {{exceeded: boolean, type?: "minute"|"day", message?: string, retryAfter?: number}}
   */
  static checkAI(params) {
    const { key, limitPerMinute = 6, limitPerDay = 30, maxKeys = DEFAULT_MAX_KEYS } = params;
    const now = Date.now();

    const minBucket = getBucket(`ai:min:${key}`, 60000, now, maxKeys);
    if (minBucket.count > limitPerMinute) {
      const retryAfter = Math.ceil((minBucket.resetTime - now) / 1000);
      return {
        exceeded: true,
        type: "minute",
        message: "Estás realizando consultas muy rápido. Por favor, espera un momento para continuar.",
        retryAfter,
      };
    }

    const dayBucket = getBucket(`ai:day:${key}`, 86400000, now, maxKeys);
    if (dayBucket.count > limitPerDay) {
      const retryAfter = Math.ceil((dayBucket.resetTime - now) / 1000);
      return {
        exceeded: true,
        type: "day",
        message:
          "Has alcanzado el límite diario de consultas. Por favor contáctanos para atención personalizada.",
        retryAfter,
      };
    }

    return { exceeded: false };
  }

  static reset() {
    memoryBuckets.clear();
  }
}

export { RateLimit };
export default RateLimit;
