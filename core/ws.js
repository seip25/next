import http from "node:http";
import { randomUUID } from "node:crypto";
import Auth from "./auth.js";

let WebSocketServer = null;
let WebSocket = null;

try {
  const wsModule = await import("ws");
  WebSocketServer = wsModule.WebSocketServer || wsModule.default?.WebSocketServer;
  WebSocket = wsModule.WebSocket || wsModule.default?.WebSocket;
} catch {}

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
   * @param {boolean} [options.auth=false]
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
    this.maxPayload = options.maxPayload || 1024 * 1024;
    this.instanceId = randomUUID();
    this.rooms = new Map();
    this.clients = new Set();
    this.connectionHandler = null;

    if (options.server) {
      this.server = options.server;
      this.wss = new WebSocketServer({
        noServer: true,
        maxPayload: this.maxPayload,
      });
      this._setupUpgrade();
    } else {
      const port = options.port || parseInt(process.env.WS_PORT || "3001", 10);
      this.server = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("WebSocket Server Running");
      });
      this.wss = new WebSocketServer({
        server: this.server,
        path: this.path,
        maxPayload: this.maxPayload,
      });
      this.server.listen(port, () => {
        console.log(`[WS] Standalone WebSocket server running on port ${port} (path: ${this.path})`);
      });
    }

    this._setupConnections();
    this._setupHeartbeat();
  }

  _setupUpgrade() {
    this.server.on("upgrade", async (request, socket, head) => {
      try {
        const urlObj = new URL(request.url, `http://${request.headers.host || "localhost"}`);
        if (urlObj.pathname !== this.path) return;

        if (this.requireAuth) {
          const token =
            urlObj.searchParams.get("token") || request.headers.authorization?.split(" ")[1];
          const user = token ? Auth.verifyToken(token) : null;
          if (!user) {
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
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
   * Broadcasts message to all clients or a specific room.
   * @param {any} data
   * @param {string} [room=null]
   */
  broadcast(data, room = null) {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    const targetSockets = room && this.rooms.has(room) ? this.rooms.get(room) : this.clients;

    targetSockets.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
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
