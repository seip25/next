# @seip/nextjs

> Production-ready toolkit for **Next.js (App Router, Server Actions, Route Handlers, proxy.js)** and **Nextron / Electron Desktop Apps**. Designed for self-hosted VPS deployments (PM2 + Nginx) and native desktop software.

---

## 🚀 Características Principales

- **Database Singleton con HMR**: Soporte para SQLite (`node:sqlite` nativo en Node 22+ o `better-sqlite3`), PostgreSQL (`pg`) y MySQL (`mysql2`). Mantiene un singleton global (`globalThis.__seip_next_db_instance`) para evitar saturar conexiones o bloquear SQLite durante el Fast Refresh de Next.js.
- **Modo Desktop / Electron Inteligente**: En aplicaciones de escritorio empaquetadas con Electron / Nextron, almacena automáticamente la base de datos SQLite y archivos subidos en `userDataDir` (`app.getPath("userData")`) para evitar errores `EROFS` dentro del empaquetado `.asar`. Copia la base de datos inicial automáticamente en el primer inicio.
- **Modelos ORM con Revalidación de Caché**: `BaseModel` ligero con esquemas declarativos, soft deletes, timestamps, relaciones (`belongsTo`, `oneMany`) y llamadas automáticas a `revalidateTag(model.table)` al crear, editar o eliminar registros.
- **Auth para `proxy.js` (Next.js 16)**: Cifrado nativo AES-256-GCM + firma HMAC-SHA256 con `node:crypto`. Manejo de sesiones y redirecciones automáticas en `proxy.js` (rutas protegidas a `/login`, usuarios autenticados a `/dashboard`).
- **Módulo de IA con Anti-Fuga de Tokens (`IA`)**:
  - **Cache Hit Exacto**: Consultas repetidas responden al instante desde memoria o base de datos sin consumir tokens ni dinero.
  - **Rate Limiting Multi-Nivel**: Cuotas por minuto y por día por IP o usuario.
  - **Soporte Multi-Proveedor**: DeepSeek, OpenAI, Claude/Anthropic y Google Gemini mediante `fetch` nativo sin requerir SDKs obligatorios.
- **Validaciones Nativas con i18n**: Soporte multilingüe (`es`, `en`, `pt`, `br`, `fr`), reglas declarativas y sanitización XSS automática para Server Actions y `FormData`.
- **Subida de Archivos Nativa**: Sin dependencias pesadas para Next.js Server Actions y Route Handlers (`save(file)`), con fallback opcional para `multer`.
- **SEO Inteligente con Exclusión de Rutas Protegidas**: Generador de `sitemap.xml` y `robots.txt` que filtra y bloquea automáticamente rutas privadas (`/dashboard`, `/admin`, `/api/`, etc.).
- **Suite CLI Completa**:
  - `make:model <Name>`: Autodetecta `src/models/`, `app/models/` o `models/`.
  - `make:migration` y `migrate`: Comparador automático de esquemas de modelos contra la BD real, con `Up`, `Down`, lotes y transacciones.
  - `make:ecosystem`: Genera `ecosystem.config.cjs` para PM2 en VPS usando `.env`.
  - `nginx:conf`: Genera configuración de Nginx para VPS con SSL Certbot, compresión Gzip, límite de 100M y caché inmutable de assets.
  - `make:desktop`: Scaffold para Nextron / Electron con empaquetado para Windows (NSIS y Portable), macOS y Linux.

---

## 📦 Instalación

```bash
npm install @seip/nextjs
```

*Opcionales según tu base de datos o necesidades* (son `peerDependencies` opcionales:
no se instalan solos, instala solo lo que uses):
```bash
npm install better-sqlite3 # Si usas SQLite en Node < 22.18
npm install pg             # Si usas PostgreSQL
npm install mysql2         # Si usas MySQL / MariaDB
npm install ws             # Si usas el servidor WebSocket independiente
npm install multer         # Si usas Upload.disk() / Upload.storage()
npm install bcrypt         # Solo si necesitas verificar hashes bcrypt existentes
```

> **Tip:** importa por subruta (`@seip/nextjs/auth`, `@seip/nextjs/ratelimit`,
> `@seip/nextjs/database`…) en `proxy.js`: así no se cargan módulos que no usas.
> Los drivers de base de datos se cargan de forma diferida en la primera consulta.

---

## 🛠️ Ejemplos de Uso

### 1. Modelos y Base de Datos en Server Actions

```javascript
// src/models/user.js
import { Model } from "@seip/nextjs";

export default class User extends Model {
  static table = "users";
  static primaryKey = "id";
  static timestamps = true;

  static schema = {
    id: { type: "int", primary: true, auto: true },
    name: { type: "string", length: 150, required: true },
    email: { type: "string", required: true, unique: true },
    password: { type: "string", hash: true, hidden: true },
    role: { type: "string", default: "user" },
  };
}
```

```javascript
// src/app/actions/user.js
"use server";
import { User } from "@/models/user";

export async function register(formData) {
  const validator = User.validator("create", "es");
  const result = await validator.validate(formData);
  if (!result.success) return { errors: result.errors };

  // result.data solo contiene campos del schema (un campo "role" inyectado se descarta;
  // el input completo queda en result.raw). El password se hashea automáticamente con scrypt.
  const userId = await User.create(result.data);
  return { success: true, userId };
}
```

**Transacciones:** dentro del callback, tanto `tx.query()` como `db.query()` corren en la
transacción (misma conexión). En SQLite, las consultas de otras requests esperan a que la
transacción termine en vez de quedar incluidas en ella. Las llamadas anidadas usan `SAVEPOINT`.

```javascript
import { db } from "@seip/nextjs/database";

await db.transaction(async (tx) => {
  const orderId = await tx.query("INSERT INTO orders (user_id) VALUES (?)", [userId]);
  await tx.query("UPDATE stock SET qty = qty - 1 WHERE product_id = ?", [productId]);
});
```

---

### 2. Autenticación en `proxy.js` (Next.js 16)

> **Requisito:** define `JWT_SECRET` (mínimo 32 caracteres en producción). No existe
> secreto por defecto: sin `JWT_SECRET`, `Auth` lanza un error al firmar y rechaza
> (devuelve `null`) al verificar. Es intencional para evitar tokens forjables.

```javascript
// proxy.js (o middleware.js)
import { Auth } from "@seip/nextjs/auth";
import { RateLimit } from "@seip/nextjs/ratelimit";

export async function proxy(request) {
  // 1. Rate Limit (IP real vía X-Real-IP de nginx; X-Forwarded-For del cliente no se usa)
  const rl = RateLimit.check(request, { max: 100, windowMs: 60000 });
  if (rl.exceeded) return rl.response;

  // 2. Auth Guard
  return Auth.handleProxy(request, {
    protectedRoutes: ["/dashboard", "/admin/*", "/profile"],
    guestOnlyRoutes: ["/login", "/register"],
    redirectToLogin: "/login",
    redirectToDashboard: "/dashboard",
  });
}
```

- El token se lee de la cookie `auth` o de `Authorization: Bearer <token>` (clientes de API).
- `Auth.logout()` revoca la sesión en el servidor. La lista de sesiones revocadas se comparte
  entre `proxy.js` y las rutas, y en producción se guarda en
  `database/.revoked-sessions.json` para sobrevivir a `pm2 restart`
  (`AUTH_REVOCATION_FILE=<ruta>` para cambiarla, `AUTH_REVOCATION_FILE=false` para solo memoria).
- Limitadores distintos no comparten contador; usa `prefix` para nombrarlos:
  `RateLimit.check(request, { max: 5, windowMs: 60000, prefix: "login" })`.

---

### 3. Asistente de IA con Anti-Fuga de Tokens (`IA`)

```javascript
// app/api/chat/route.js
import { IA } from "@seip/nextjs";

export async function POST(req) {
  const { message } = await req.json();

  // Caching y Rate Limiting en memoria por defecto (cero ataduras a base de datos)
  const result = await IA.processChat({
    message,
    request: req, // la IP se obtiene de forma segura (RateLimit.getClientIp)
    provider: "deepseek", // o "openai", "claude", "gemini"
    systemPrompt: "Eres un asistente experto y servicial.",
    limitPerMinute: 6,
    limitPerDay: 30,
    // Opcional: Hook para persistir si tu app tiene base de datos o analytics
    onLog: async ({ question, response, ip, cached }) => {
      // await db.query("INSERT INTO history_chat ...") si lo deseas
    },
  });

  return Response.json(result.data, { status: result.statusCode });
}
```

- El mensaje del usuario va solo como mensaje `user`, nunca dentro del system prompt.
- La caché distingue proveedor, modelo y system prompt (`IA.cacheKey()`), y los mensajes de
  más de `maxMessageLength` (2000 por defecto) se rechazan con 413.
- Cada llamada tiene timeout (`options.timeoutMs`, 30s por defecto). Modelos por defecto
  configurables con `DEEPSEEK_MODEL`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`.

---

### 4. Subida de Archivos Nativa

> **Seguridad:** el destino se valida contra path traversal (carpetas solo con
> `a-z0-9_-`), el nombre guardado es un UUID y la extensión se deriva del MIME type.
> Extensiones ejecutables (`.html`, `.svg`, `.js`, `.php`, …) se rechazan por defecto;
> solo se permiten con `allowDangerousExtensions: true` bajo tu responsabilidad.

```javascript
// app/api/upload/route.js
import { Upload } from "@seip/nextjs";

export async function POST(req) {
  const formData = await req.formData();
  const file = formData.get("file");

  const uploaded = await Upload.save(file, {
    folder: "documents",
    maxSize: 10 * 1024 * 1024, // 10MB
    allowedTypes: ["image/png", "image/jpeg", "application/pdf"],
  });

  return Response.json({ url: uploaded.url, filename: uploaded.filename });
}
```

> **Importante:** `next start` solo sirve los archivos que había en `public/` al momento
> del build, así que lo subido en runtime da 404 si nadie más lo sirve. La config de
> `nginx:conf` ya lo sirve desde `public/`. Sin nginx, agrega esta ruta:
>
> ```javascript
> // app/uploads/[...path]/route.js
> import { Upload } from "@seip/nextjs/upload";
> export async function GET(req, { params }) {
>   return Upload.serve((await params).path, { folder: "uploads" });
> }
> ```
>
> Los Server Actions rechazan bodies de más de 1MB por defecto: sube
> `experimental.serverActions.bodySizeLimit` en `next.config.js` (por ejemplo `"10mb"`)
> o usa un Route Handler como el de arriba.

---

### 5. SEO Inteligente (Sitemap y Robots)

```javascript
// app/sitemap.js
import { Seo } from "@seip/nextjs";

export default function sitemap() {
  Seo.registerRoute("/");
  Seo.registerRoute("/servicios");
  Seo.registerRoute("/contacto");

  // Las rutas en Auth / /api / /dashboard se excluyen automáticamente
  return Seo.toNextSitemap();
}
```

```javascript
// app/robots.js
import { Seo } from "@seip/nextjs";

export default function robots() {
  return Seo.toNextRobots();
}
```

---

### 6. WebSocket (worker de PM2)

```javascript
// server/ws.js  (make:ecosystem lo detecta y crea la app "<nombre>-ws")
import { WebSocketManager } from "@seip/nextjs/ws";

const wsm = new WebSocketManager({
  port: Number(process.env.WS_PORT) || 3001, // escucha en 127.0.0.1; nginx publica /ws
  auth: true,                                // token en ?token=, Bearer o cookie "auth"
  allowedOrigins: ["https://midominio.com"],
});

wsm.onConnection((ws) => {
  ws.join(`user:${ws.user.id}`);
});

// Solo llega a los miembros de la sala (si no hay nadie conectado, no se envía a nadie)
wsm.broadcast({ type: "notification" }, "user:42");
```

---

## 💻 Comandos del CLI (`npx @seip/nextjs`)

El CLI carga `.env`, `.env.local`, `.env.$NODE_ENV` y `.env.$NODE_ENV.local` con la misma
prioridad que Next.js (las variables ya definidas en el entorno ganan), así que `migrate`
usa la misma base de datos que tu app.

```bash
# Modelos y Migraciones
npx @seip/nextjs make:model User        # Crea modelo en src/models o app/models
npx @seip/nextjs make:migration         # Genera migración comparando modelos con la BD
npx @seip/nextjs migrate                # Ejecuta migraciones pendientes
npx @seip/nextjs migrate:status         # Muestra el historial de migraciones (incluye huérfanas)
npx @seip/nextjs migrate:rollback       # Revierte el último lote (exige sección Down)

# Seeds (con tracking: no se re-ejecutan por accidente)
npx @seip/nextjs make:seed users        # Crea database/seeds/users.sql
npx @seip/nextjs seed                   # Ejecuta solo seeds pendientes
npx @seip/nextjs seed --force           # Re-ejecuta todos los seeds

# SEO y WebSocket
npx @seip/nextjs make:seo               # Genera public/sitemap.xml y robots.txt
npx @seip/nextjs ws:start 3001 --auth   # Servidor WebSocket independiente (--auth exige token)

# Despliegue en VPS
npx @seip/nextjs make:ecosystem         # Genera ecosystem.config.cjs para PM2
npx @seip/nextjs make:ecosystem --start # Genera y arranca con PM2 (exit code != 0 si falla)
npx @seip/nextjs nginx:conf midominio.com 3000 /var/www/proyecto # Config HTTP + pasos de Certbot
npx @seip/nextjs nginx:conf midominio.com --ssl  # Config HTTPS final (con el certificado ya emitido)
                                                 # --www / --no-www / --with-ws

# Aplicación de Escritorio (Desktop)
npx @seip/nextjs make:desktop           # Genera scaffold de Nextron / Electron
```

**Despliegue con PM2 (1 instancia):** `ecosystem.config.cjs` lee `.env` cuando PM2 lo carga
(no copia secretos al archivo; tras editar `.env` usa `pm2 reload ecosystem.config.cjs --update-env`).
Next.js escucha en `127.0.0.1` (solo nginx es público). Con `output: "standalone"` se define
`APP_DIR` con la raíz del proyecto, así la base SQLite, los uploads y las sesiones revocadas
no quedan dentro de `.next/standalone` (que se borra en cada build).

**Migraciones JS:** además de `.sql`, el runner ejecuta `.js`/`.mjs` que exporten
`async up(tx)` (y opcionalmente `down(tx)`), ejecutadas dentro de la misma transacción
y registradas en `_seip_migrations` como cualquier otra migración.

---

## 🖥️ Compilación de Versión de Escritorio (Desktop)

1. En tu `next.config.js`:
   ```javascript
   export default {
     output: "standalone",
   };
   ```
2. Ejecuta `npx @seip/next make:desktop`.
3. Compila el servidor web: `npm run build`.
4. Ve a la carpeta generada y construye el instalador:
   ```bash
   cd desktop
   npm install
   npm run build:win        # Windows Setup (.exe)
   npm run build:portable   # Windows Portable (.exe autónomo)
   npm run build:mac        # macOS (.zip)
   npm run build:linux      # Linux (AppImage / tar.gz)
   npm run build:all        # Todas las plataformas
   ```

---

## 📄 Licencia

MIT © Seip25
