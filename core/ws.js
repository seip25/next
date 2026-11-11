import http from "node:http";
import { randomUUID } from "node:crypto";
import Auth from "./auth.js";
import { importOptional } from "./util/optional.js";

let WebSocketServer = null;
let WebSocket = null;

const wsModule = await importOptional("ws");
if (wsModule) {
  WebSocketServer = wsModule.WebSocketServer || wsModule.default?.WebSocketServer;
  WebSocket = wsModule.WebSocket || wsModule.default?.WebSocket;
}

/**
 * Standalone or embedded WebSocket Server Manager for VPS PM2 deployments and Electron.
 */
class WebSocketManager {
  /**
   * Initializes the WebSocket manager on a dedicated port or attaches to an HTTP server.
   * @param {Object} [options={}]
   * @param {number} [options.port=3001]
   * @param {import('http').Server} [options.server]
   * @param {string} [options.path="/ws"]
   * @param {string} [options.host="127.0.0.1"] - Bind address in standalone mode (nginx proxies /ws).
   * @param {boolean} [options.auth=false] - Require a valid Auth token (query ?token=, Bearer header or cookie).
   * @param {string} [options.cookieKey="auth"]
   * @param {string[]|string} [options.allowedOrigins] - Allowed Origin headers (or WS_ALLOWED_ORIGINS, comma separated).
   * @param {number} [options.maxPayload=1048576]
   */
  constructor(options = {}) {
    if (!WebSocketServer || !WebSocket) {
      console.error(
        "[WS ERROR] 'ws' package is not installed. Install it with: npm install ws"
      );
      throw new Error("[WS ERROR] 'ws' package is required for WebSocketManager.");
    }

    this.path = options.path || "/ws";
    this.requireAuth = options.auth ?? false;
    this.cookieKey = options.cookieKey || "auth";
    this.secret = options.secret;
    this.allowedOrigins = Array.isArray(options.allowedOrigins)
      ? options.allowedOrigins
      : String(options.allowedOrigins ?? process.env.WS_ALLOWED_ORIGINS ?? "")
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean);
    this.maxPayload = options.maxPayload || 1024 * 1024;
    this.instanceId = randomUUID();
    this.rooms = new Map();
    this.clients = new Set();
    this.connectionHandler = null;

    // Both modes use noServer + our own upgrade handler, so authentication and the
    // Origin check apply equally to standalone (ws:start / PM2 worker) and embedded servers.
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: this.maxPayload,
    });

    this._ownsServer = !options.server;
    if (options.server) {
      this.server = options.server;
    } else {
      const port = options.port || parseInt(process.env.WS_PORT || "3001", 10);
      const host = options.host || process.env.WS_HOST || "127.0.0.1";
      this.server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("WebSocket Server Running");
      });
      this.server.listen(port, host, () => {
        console.log(`[WS] Standalone WebSocket server running on ${host}:${port} (path: ${this.path})`);
      });
    }

    this._setupUpgrade();
    this._setupConnections();
    this._setupHeartbeat();
  }

  /**
   * Extracts the auth token from ?token=, "Authorization: Bearer" or the auth cookie.
   * @param {import('http').IncomingMessage} request
   * @param {URL} urlObj
   * @returns {string|null}
   */
  _extractToken(request, urlObj) {
    const fromQuery = urlObj.searchParams.get("token");
    if (fromQuery) return fromQuery;
    const authHeader = request.headers.authorization || "";
    if (/^Bearer\s+/i.test(authHeader)) return authHeader.replace(/^Bearer\s+/i, "").trim();
    const cookieHeader = request.headers.cookie || "";
    for (const part of cookieHeader.split(";")) {
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      if (part.slice(0, idx).trim() === this.cookieKey) {
        try {
          return decodeURIComponent(part.slice(idx + 1).trim());
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  _reject(socket, status, text) {
    try {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    } catch {}
    socket.destroy();
  }

  _setupUpgrade() {
    this.server.on("upgrade", (request, socket, head) => {
      try {
        const urlObj = new URL(request.url, `http://${request.headers.host || "localhost"}`);
        // Other paths (e.g. Next.js HMR) belong to other upgrade listeners.
        if (urlObj.pathname !== this.path) {
          if (this._ownsServer) socket.destroy();
          return;
        }

        if (this.allowedOrigins.length > 0) {
          const origin = request.headers.origin;
          if (!origin || !this.allowedOrigins.includes(origin)) {
            return this._reject(socket, 403, "Forbidden");
          }
        }

        if (this.requireAuth) {
          const token = this._extractToken(request, urlObj);
          const user = token ? Auth.verifyToken(token, this.secret) : null;
          if (!user) {
            return this._reject(socket, 401, "Unauthorized");
          }
          request.user = user;
        }

        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit("connection", ws, request);
        });
      } catch {
        socket.destroy();
      }
    });
  }

  _setupConnections() {
    this.wss.on("connection", (ws, req) => {
      ws.isAlive = true;
      ws.user = req?.user || null;
      ws.rooms = new Set();
      this.clients.add(ws);

      ws.on("pong", () => {
        ws.isAlive = true;
      });

      ws.on("close", () => {
        this.clients.delete(ws);
        ws.rooms.forEach((room) => this.leave(room, ws));
      });

      ws.on("error", () => {
        this.clients.delete(ws);
        ws.rooms.forEach((room) => this.leave(room, ws));
      });

      ws.join = (room) => this.join(room, ws);
      ws.leave = (room) => this.leave(room, ws);
      ws.sendJSON = (data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(data));
        }
      };

      if (this.connectionHandler) {
        this.connectionHandler(ws, req);
      }
    });
  }

  onConnection(handler) {
    this.connectionHandler = handler;
  }

  join(room, ws) {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    this.rooms.get(room).add(ws);
    ws.rooms.add(room);
  }

  leave(room, ws) {
    if (this.rooms.has(room)) {
      this.rooms.get(room).delete(ws);
      if (this.rooms.get(room).size === 0) {
        this.rooms.delete(room);
      }
    }
    ws.rooms.delete(room);
  }

  /**
   * Broadcasts a message to every client, or only to the members of `room`.
   * A room with no members receives nothing (it never falls back to everyone).
   * @param {any} data
   * @param {string} [room=null]
   * @returns {number} Number of clients the message was sent to.
   */
  broadcast(data, room = null) {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    let targetSockets;
    if (room === null || room === undefined) {
      targetSockets = this.clients;
    } else {
      targetSockets = this.rooms.get(room);
      if (!targetSockets) return 0;
    }

    let sent = 0;
    targetSockets.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
        sent++;
      }
    });
    return sent;
  }

  _setupHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          this.clients.delete(ws);
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
    this.heartbeatInterval.unref();
  }

  close() {
    clearInterval(this.heartbeatInterval);
    if (this.wss) this.wss.close();
    if (this.server && typeof this.server.close === "function") {
      this.server.close();
    }
  }
}

export { WebSocketManager };
export default WebSocketManager;
