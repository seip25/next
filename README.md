# @seip/next

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
npm install @seip/next
```

*Opcionales según tu base de datos o necesidades:*
```bash
npm install better-sqlite3 # Si usas SQLite en Node < 22.18
npm install pg             # Si usas PostgreSQL
npm install mysql2         # Si usas MySQL / MariaDB
npm install ws             # Si usas el servidor WebSocket independiente
```

---

## 🛠️ Ejemplos de Uso

### 1. Modelos y Base de Datos en Server Actions

```javascript
// src/models/user.js
import { Model } from "@seip/next";

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

  // El password se hashea automáticamente con scrypt
  const userId = await User.create(result.data);
  return { success: true, userId };
}
```

---

### 2. Autenticación en `proxy.js` (Next.js 16)

```javascript
// proxy.js (o middleware.js)
import { Auth, RateLimit } from "@seip/next";

export async function proxy(request) {
  // 1. Rate Limit
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

---

### 3. Asistente de IA con Anti-Fuga de Tokens (`IA`)

```javascript
// app/api/chat/route.js
import { IA } from "@seip/next";

export async function POST(req) {
  const { message } = await req.json();
  const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";

  // Caching y Rate Limiting en memoria por defecto (cero ataduras a base de datos)
  const result = await IA.processChat({
    message,
    ip,
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

---

### 4. Subida de Archivos Nativa

```javascript
// app/api/upload/route.js
import { Upload } from "@seip/next";

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

---

### 5. SEO Inteligente (Sitemap y Robots)

```javascript
// app/sitemap.js
import { Seo } from "@seip/next";

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
import { Seo } from "@seip/next";

export default function robots() {
  return Seo.toNextRobots();
}
```

---

## 💻 Comandos del CLI (`npx @seip/next`)

```bash
# Modelos y Migraciones
npx @seip/next make:model User        # Crea modelo en src/models o app/models
npx @seip/next make:migration         # Genera migración comparando modelos con la BD
npx @seip/next migrate                # Ejecuta migraciones pendientes
npx @seip/next migrate:status         # Muestra el historial de migraciones
npx @seip/next migrate:rollback       # Revierte el último lote

# Despliegue en VPS
npx @seip/next make:ecosystem         # Genera ecosystem.config.cjs para PM2
npx @seip/next nginx:conf midominio.com 3000 /var/www/proyecto # Configura Nginx y Certbot

# Aplicación de Escritorio (Desktop)
npx @seip/next make:desktop           # Genera scaffold de Nextron / Electron
```

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
