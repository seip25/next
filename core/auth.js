import {
  createHmac,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Config from "./config.js";

/**
 * Revoked session ids (id -> expiry ms). Stored on globalThis because Next.js may
 * evaluate this module several times (proxy.js bundle, route handlers, server actions):
 * a module-level Map would let a session revoked in a Server Action still pass proxy.js.
 */
const revocationState = (globalThis.__seip_next_revoked_sessions ??= {
  map: new Map(),
  loadedFrom: null,
  mtimeMs: 0,
});
const revokedSessions = revocationState.map;

/**
 * File used to persist revocations across restarts (pm2 restart / deploy).
 * - AUTH_REVOCATION_FILE=<path> → that file
 * - AUTH_REVOCATION_FILE=false  → memory only
 * - default: <userDataDir>/database/.revoked-sessions.json in production, memory-only otherwise.
 * @returns {string|null}
 */
function revocationFile() {
  const configured = process.env.AUTH_REVOCATION_FILE;
  if (configured === "false" || configured === "0") return null;
  if (configured) return path.resolve(Config.userDataDir(), configured);
  if (process.env.NODE_ENV !== "production") return null;
  return path.join(Config.userDataDir(), "database", ".revoked-sessions.json");
}

function pruneRevoked(now = Date.now()) {
  for (const [id, exp] of revokedSessions) {
    if (exp <= now) revokedSessions.delete(id);
  }
}

/** Reloads revocations written by another module instance/process when the file changed. */
function syncRevocationsFromDisk() {
  const file = revocationFile();
  if (!file) return;
  try {
    const stat = fs.statSync(file);
    if (revocationState.loadedFrom === file && stat.mtimeMs === revocationState.mtimeMs) return;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const now = Date.now();
    for (const [id, exp] of Object.entries(data || {})) {
      if (typeof exp === "number" && exp > now) revokedSessions.set(id, exp);
    }
    revocationState.loadedFrom = file;
    revocationState.mtimeMs = stat.mtimeMs;
  } catch {
    // Missing or unreadable file: keep the in-memory state.
  }
}

function persistRevocations() {
  const file = revocationFile();
  if (!file) return;
  try {
    pruneRevoked();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(revokedSessions)), { mode: 0o600 });
    fs.renameSync(tmp, file);
    revocationState.loadedFrom = file;
    revocationState.mtimeMs = fs.statSync(file).mtimeMs;
  } catch (err) {
    console.error("[AUTH ERROR] Could not persist revoked sessions:", err.message);
  }
}

if (!revocationState.timer) {
  revocationState.timer = setInterval(() => {
    if (revokedSessions.size > 0) pruneRevoked();
  }, 300000);
  revocationState.timer.unref?.();
}

const MIN_SECRET_LENGTH = 32;
let warnedMissingSecret = false;

/**
 * Resolves the signing/encryption secret.
 * There is deliberately no fallback: signing tokens with a public default
 * would allow anyone to forge sessions. Misconfiguration must fail loudly.
 * @param {string} [secret] Explicit secret (takes precedence over JWT_SECRET).
 * @returns {string}
 * @throws {Error} When no secret is configured or it is too short in production.
 */
function resolveSecret(secret) {
  const resolved = secret || process.env.JWT_SECRET;
  if (typeof resolved !== "string" || resolved.trim().length === 0) {
    throw new Error(
      "[AUTH ERROR] JWT_SECRET is not configured. Set the JWT_SECRET environment variable " +
        "(or pass the secret explicitly). Tokens are never signed with a public default."
    );
  }
  if (process.env.NODE_ENV === "production" && resolved.trim().length < MIN_SECRET_LENGTH) {
    throw new Error(
      `[AUTH ERROR] JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production.`
    );
  }
  return resolved;
}

function getAesKey(secret) {
  return createHash("sha256").update(resolveSecret(secret)).digest();
}

/**
 * Reads the `exp` claim (seconds) from a signed token body without verifying it.
 * Only used to size the in-memory revocation entry; verification happens first.
 * @param {string} token
 * @returns {number|null} Expiry in milliseconds.
 */
function tokenExpiryMs(token) {
  try {
    const body = JSON.parse(Buffer.from(token.split(".")[1] || "", "base64url").toString("utf8"));
    return typeof body.exp === "number" ? body.exp * 1000 : null;
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseDuration(duration) {
  if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) return Math.floor(duration);
  const match = String(duration).trim().match(/^(\d+)\s*([smhdw])$/i);
  if (!match) {
    // A silent fallback would turn "30 days" or "1y" into a 1-day session without notice.
    throw new Error(
      `[AUTH ERROR] Invalid expiresIn '${duration}'. Use seconds (number) or a string like "15m", "12h", "7d", "2w".`
    );
  }
  const val = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const factors = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  return val * factors[unit];
}

/**
 * Authentication and JWT management for Next.js 16 proxy.js,
 * Server Actions, Route Handlers, and Electron Desktop.
 */
class Auth {
  static encrypt(payload, secret = process.env.JWT_SECRET) {
    if (payload === undefined) {
      throw new Error("[AUTH ERROR] Cannot encrypt an undefined payload.");
    }
    const resolvedSecret = resolveSecret(secret);
    const iv = randomBytes(12);
    const key = getAesKey(resolvedSecret);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    let encrypted = cipher.update(JSON.stringify(payload), "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag().toString("hex");
    return `${iv.toString("hex")}:${tag}:${encrypted}`;
  }

  static decrypt(data, secret = process.env.JWT_SECRET) {
    if (!data || typeof data !== "string" || data.length > 16384) return null;
    try {
      const resolvedSecret = resolveSecret(secret);
      const [ivHex, tagHex, encryptedHex] = data.split(":");
      if (!ivHex || !tagHex || !encryptedHex) return null;

      const iv = Buffer.from(ivHex, "hex");
      const tag = Buffer.from(tagHex, "hex");
      const key = getAesKey(resolvedSecret);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(encryptedHex, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return JSON.parse(decrypted);
    } catch {
      return null;
    }
  }

  static generateToken(payload, secret = process.env.JWT_SECRET, expiresIn = "7d") {
    const resolvedSecret = resolveSecret(secret);
    const encrypted = this.encrypt(payload, resolvedSecret);
    const now = Math.floor(Date.now() / 1000);
    const ttl = parseDuration(expiresIn);

    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ data: encrypted, iat: now, exp: now + ttl })).toString("base64url");

    const signature = createHmac("sha256", resolvedSecret)
      .update(`${header}.${body}`)
      .digest("base64url");

    return `${header}.${body}.${signature}`;
  }

  static verifyToken(token, secret = process.env.JWT_SECRET) {
    if (!token || typeof token !== "string" || token.length > 8192) return null;

    // Fail closed: without a secret there is no way to verify a token.
    // Log once per process instead of crashing every request.
    let resolvedSecret;
    try {
      resolvedSecret = resolveSecret(secret);
    } catch (err) {
      if (!warnedMissingSecret) {
        warnedMissingSecret = true;
        console.error(err.message);
      }
      return null;
    }

    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const [header, body, signature] = parts;

      const expected = createHmac("sha256", resolvedSecret)
        .update(`${header}.${body}`)
        .digest("base64url");

      const sigBuf = Buffer.from(signature);
      const expBuf = Buffer.from(expected);
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

      const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (!decoded || !decoded.data) return null;
      if (Math.floor(Date.now() / 1000) >= decoded.exp) return null;

      const payload = this.decrypt(decoded.data, resolvedSecret);
      if (payload && payload._sessionId) {
        syncRevocationsFromDisk();
        if (revokedSessions.has(payload._sessionId)) return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Helper for Next.js 16 proxy.js / proxy(request).
   * Validates authentication and handles automatic redirects for protected and guest routes.
   * @param {Request|Object} request - NextRequest or standard Web Request
   * @param {Object} options
   * @param {string[]} [options.protectedRoutes=[]]
   * @param {string[]} [options.guestOnlyRoutes=[]]
   * @param {string} [options.redirectToLogin="/login"]
   * @param {string} [options.redirectToDashboard="/dashboard"]
   * @param {string} [options.cookieKey="auth"]
   * @param {string} [options.secret]
   * @returns {Promise<Response|null>} Redirection Response or null to proceed.
   */
  static async handleProxy(request, options = {}) {
    const {
      protectedRoutes = [],
      guestOnlyRoutes = [],
      redirectToLogin = "/login",
      redirectToDashboard = "/dashboard",
      cookieKey = "auth",
      secret = process.env.JWT_SECRET,
    } = options;

    let pathname = "/";
    let url = null;
    try {
      url = new URL(request.url);
      pathname = url.pathname;
    } catch {
      pathname = request.pathname || "/";
    }

    // Extract token from Cookie or Authorization header
    let token = null;
    if (request.cookies?.get) {
      token = request.cookies.get(cookieKey)?.value || null;
    } else if (typeof request.headers?.get === "function") {
      const cookieHeader = request.headers.get("cookie") || "";
      const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escapeRegExp(cookieKey)}=([^;]+)`));
      if (match) {
        try {
          token = decodeURIComponent(match[1]);
        } catch {
          token = null; // Malformed percent-encoding must not crash the proxy.
        }
      }
    }
    // API clients send "Authorization: Bearer <token>" (also with NextRequest, which always has .cookies).
    if (!token && typeof request.headers?.get === "function") {
      const authHeader = request.headers.get("authorization");
      if (authHeader && /^Bearer\s+/i.test(authHeader)) {
        token = authHeader.replace(/^Bearer\s+/i, "").trim() || null;
      }
    }

    function matchesRoute(targetPath, pattern) {
      if (!pattern || typeof pattern !== "string") return false;
      if (pattern.endsWith("*")) {
        const base = pattern.slice(0, -1).replace(/\/+$/, "");
        if (!base) return true;
        return targetPath === base || targetPath.startsWith(`${base}/`);
      }
      const clean = pattern.replace(/\/+$/, "") || "/";
      if (clean === "/") return targetPath === "/";
      return targetPath === clean || targetPath.startsWith(`${clean}/`);
    }

    const user = token ? this.verifyToken(token, secret) : null;
    const isProtected = protectedRoutes.some((route) => matchesRoute(pathname, route));
    const isGuestOnly = guestOnlyRoutes.some((route) => matchesRoute(pathname, route));

    const isApi = pathname.startsWith("/api/");

    if (isProtected && !user) {
      if (isApi) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      const targetUrl = new URL(redirectToLogin, request.url);
      targetUrl.searchParams.set("from", pathname);
      return Response.redirect(targetUrl.toString(), 307);
    }

    if (isGuestOnly && user) {
      const targetUrl = new URL(redirectToDashboard, request.url);
      return Response.redirect(targetUrl.toString(), 307);
    }

    return null;
  }

  /**
   * Retrieves current authenticated user in Server Actions or Route Handlers.
   * Compatible with next/headers cookies() or Request.
   * @param {Object} [cookiesOrRequest]
   * @param {string} [cookieKey="auth"]
   * @returns {Promise<Object|null>}
   */
  static async user(cookiesOrRequest = null, cookieKey = "auth") {
    let token = null;

    if (cookiesOrRequest) {
      if (typeof cookiesOrRequest.get === "function") {
        const item = await cookiesOrRequest.get(cookieKey);
        token = item?.value || (typeof item === "string" ? item : null);
      } else if (cookiesOrRequest.headers?.get) {
        const cookieHeader = cookiesOrRequest.headers.get("cookie") || "";
        const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escapeRegExp(cookieKey)}=([^;]+)`));
        if (match) {
          try {
            token = decodeURIComponent(match[1]);
          } catch {
            token = null;
          }
        }
        if (!token) {
          const auth = cookiesOrRequest.headers.get("authorization");
          if (auth && auth.startsWith("Bearer ")) token = auth.slice(7).trim();
        }
      }
    } else {
      try {
        const { cookies } = await import("next/headers");
        const cookieStore = await cookies();
        token = cookieStore.get(cookieKey)?.value;
      } catch {
        // Fallback when outside next/headers request context
      }
    }

    return token ? this.verifyToken(token) : null;
  }

  /**
   * Logs in a user by returning JWT token and cookie options.
   * Automatically sets cookie if cookieStore is provided.
   * @param {Object} data - Payload to store
   * @param {Object} [options={}]
   * @returns {Promise<{token: string, cookie: Object}>}
   */
  static async login(data, options = {}) {
    const {
      expiresIn = "7d",
      cookieKey = "auth",
      cookieStore = null,
      secret = process.env.JWT_SECRET,
    } = options;

    const sessionId = randomUUID();
    const token = this.generateToken({ ...data, _sessionId: sessionId }, secret, expiresIn);
    const ttlSeconds = parseDuration(expiresIn);

    const isProd = process.env.NODE_ENV === "production" && !Config.isDesktop();
    const cookieOptions = {
      name: cookieKey,
      value: token,
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: ttlSeconds,
    };

    if (cookieStore && typeof cookieStore.set === "function") {
      await cookieStore.set(cookieOptions);
    } else {
      try {
        const { cookies } = await import("next/headers");
        const store = await cookies();
        store.set(cookieOptions);
      } catch {}
    }

    return { token, cookie: cookieOptions };
  }

  /**
   * Revokes a signed token server-side (in-memory) until it expires.
   * A revoked `_sessionId` makes `verifyToken` return null even if the cookie
   * is still presented (e.g. stolen token after logout).
   * @param {string} token
   * @returns {boolean} true when the session was revoked.
   */
  static revoke(token) {
    const payload = this.verifyToken(token);
    if (!payload || !payload._sessionId) return false;
    const expMs = tokenExpiryMs(token) || Date.now() + 7 * 24 * 3600 * 1000;
    syncRevocationsFromDisk();
    revokedSessions.set(payload._sessionId, expMs);
    persistRevocations();
    return true;
  }

  /**
   * Logs out user and revokes session.
   * @param {Object} [options={}]
   * @returns {Promise<boolean>}
   */
  static async logout(options = {}) {
    const { cookieKey = "auth", cookieStore = null } = options;

    // Best effort: revoke the session server-side before deleting the cookie.
    try {
      let token = null;
      if (cookieStore && typeof cookieStore.get === "function") {
        const item = await cookieStore.get(cookieKey);
        token = item?.value || (typeof item === "string" ? item : null);
      } else {
        const { cookies } = await import("next/headers");
        const store = await cookies();
        token = store.get(cookieKey)?.value;
      }
      if (token) this.revoke(token);
    } catch {
      // Cookie store unavailable: still clear the cookie below.
    }

    const cookieOptions = {
      name: cookieKey,
      value: "",
      path: "/",
      maxAge: 0,
    };

    if (cookieStore && typeof cookieStore.set === "function") {
      await cookieStore.set(cookieOptions);
    } else {
      try {
        const { cookies } = await import("next/headers");
        const store = await cookies();
        store.set(cookieOptions);
      } catch {}
    }

    return true;
  }
}

export { Auth };
export default Auth;
