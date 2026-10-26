const memoryBuckets = new Map();

setInterval(() => {
  if (memoryBuckets.size === 0) return;
  const now = Date.now();
  for (const [key, bucket] of memoryBuckets) {
    if (bucket.resetTime <= now) {
      memoryBuckets.delete(key);
    }
  }
}, 60000).unref();

/**
 * High-performance Rate Limiter for Next.js 16 proxy.js, Route Handlers, and AI endpoints.
 */
class RateLimit {
  /**
   * Evaluates request rate limits.
   * @param {Request|Object} request
   * @param {Object} [options={}]
   * @returns {{exceeded: boolean, count: number, remaining: number, resetTime: number, response?: Response}}
   */
  static check(request, options = {}) {
    const windowMs = options.windowMs ?? 60000;
    const max = options.max ?? 60;
    const message = options.message ?? "Too many requests, please try again later.";
    const statusCode = options.statusCode ?? 429;

    let clientIp = null;
    if (typeof options.keyGenerator === "function") {
      clientIp = options.keyGenerator(request);
    } else {
      if (typeof request?.headers?.get === "function") {
        const forwarded = request.headers.get("x-forwarded-for");
        if (forwarded) {
          clientIp = forwarded.split(",")[0].trim();
        } else {
          clientIp = request.headers.get("x-real-ip");
        }
      }
      if (!clientIp && request?.ip) {
        clientIp = request.ip;
      }
    }
    clientIp = clientIp || "127.0.0.1";

    const key = `rl:${clientIp}`;
    const now = Date.now();

    let bucket = memoryBuckets.get(key);
    if (!bucket || bucket.resetTime <= now) {
      bucket = { count: 1, resetTime: now + windowMs };
      memoryBuckets.set(key, bucket);
    } else {
      bucket.count += 1;
    }

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
    const { key, limitPerMinute = 6, limitPerDay = 30 } = params;
    const now = Date.now();

    const minKey = `ai:min:${key}`;
    const dayKey = `ai:day:${key}`;

    let minBucket = memoryBuckets.get(minKey);
    if (!minBucket || minBucket.resetTime <= now) {
      minBucket = { count: 1, resetTime: now + 60000 };
      memoryBuckets.set(minKey, minBucket);
    } else {
      minBucket.count += 1;
    }

    if (minBucket.count > limitPerMinute) {
      const retryAfter = Math.ceil((minBucket.resetTime - now) / 1000);
      return {
        exceeded: true,
        type: "minute",
        message: "Estás realizando consultas muy rápido. Por favor, espera un momento para continuar.",
        retryAfter,
      };
    }

    let dayBucket = memoryBuckets.get(dayKey);
    if (!dayBucket || dayBucket.resetTime <= now) {
      dayBucket = { count: 1, resetTime: now + 86400000 };
      memoryBuckets.set(dayKey, dayBucket);
    } else {
      dayBucket.count += 1;
    }

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
