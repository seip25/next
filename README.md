# @seip/nextjs

> Toolkit listo para producción para **Next.js 16 (App Router, Server Actions, Route Handlers, `proxy.js`)**
> y **apps de escritorio con Electron**. Pensado para despliegues propios (VPS con PM2 + Nginx) y
> software de escritorio, con cero dependencias obligatorias.

```bash
npm install @seip/nextjs
```

| Módulo | Para qué sirve | Import |
| --- | --- | --- |
| [`Database`](#-base-de-datos) | SQLite (nativo), PostgreSQL y MySQL con singleton, transacciones y paginación | `@seip/nextjs/database` |
| [`Model`](#-modelos-orm) | ORM liviano: esquema, CRUD, relaciones, soft delete, hash automático y revalidación de caché | `@seip/nextjs/model` |
| [Migraciones y seeds](#-migraciones-y-seeds) | Diff automático de modelos contra la BD, `up`/`down`, lotes y seeds | CLI |
| [`Auth`](#-autenticación) | Sesiones cifradas (AES-256-GCM + HMAC), guard para `proxy.js`, login/logout, revocación | `@seip/nextjs/auth` |
| [`Hash`](#-hash-de-contraseñas) | `scrypt` nativo (con soporte para hashes `bcrypt` existentes) | `@seip/nextjs/hash` |
| [`RateLimit`](#-rate-limit) | Límite de requests por IP real (detrás de nginx) | `@seip/nextjs/ratelimit` |
| [`Validator`](#-validación) | Validación declarativa con i18n, anti mass-assignment y XSS | `@seip/nextjs/validate` |
| [`Upload`](#-subida-de-archivos) | Subida segura para Server Actions / Route Handlers | `@seip/nextjs/upload` |
| [`TableQuery`](#-tablequery-listados-con-búsqueda-filtros-y-orden) | Búsqueda, filtros, orden y paginación del lado del servidor sin SQL injection | `@seip/nextjs/table` |
| [UI (`make:ui`)](#-ui-componentes-con-tailwind-v4) | Componentes Tailwind v4 copiados a `src/ui`: DataTable, Toast, Modal, Drawer… | CLI |
| [`IA`](#-ia-con-anti-fuga-de-tokens) | DeepSeek, OpenAI, Claude y Gemini con caché y cuotas | `@seip/nextjs/ia` |
| [`Seo`](#-seo-sitemap-y-robots) | `sitemap.xml` y `robots.txt` que excluyen rutas privadas | `@seip/nextjs/seo` |
| [`WebSocketManager`](#-websocket) | Servidor WebSocket con salas y auth (worker de PM2) | `@seip/nextjs/ws` |
| [`Config`](#-config-y-modo-desktop) | Rutas de la app y datos de usuario (VPS / Electron) | `@seip/nextjs/config` |
| [Deploy VPS](#-despliegue-en-vps-pm2--nginx) | `ecosystem.config.cjs` y config de Nginx + Certbot | CLI |
| [Desktop](#-aplicación-de-escritorio-electron) | Instaladores para Windows, macOS y Linux | CLI |

---

## Índice

- [Requisitos](#-requisitos)
- [Instalación](#-instalación)
- [Variables de entorno](#-variables-de-entorno)
- [Base de datos](#-base-de-datos)
- [Modelos (ORM)](#-modelos-orm)
- [Migraciones y seeds](#-migraciones-y-seeds)
- [Autenticación](#-autenticación)
- [Hash de contraseñas](#-hash-de-contraseñas)
- [Rate limit](#-rate-limit)
- [Validación](#-validación)
- [Subida de archivos](#-subida-de-archivos)
- [TableQuery](#-tablequery-listados-con-búsqueda-filtros-y-orden)
- [UI: componentes con Tailwind v4](#-ui-componentes-con-tailwind-v4)
- [IA](#-ia-con-anti-fuga-de-tokens)
- [SEO](#-seo-sitemap-y-robots)
- [WebSocket](#-websocket)
- [Config y modo desktop](#-config-y-modo-desktop)
- [CLI](#-cli)
- [Despliegue en VPS](#-despliegue-en-vps-pm2--nginx)
- [Aplicación de escritorio](#-aplicación-de-escritorio-electron)
- [Next.js 16: compatibilidad y solución de problemas](#-nextjs-16-compatibilidad-y-solución-de-problemas)
- [Novedades 0.0.4](#-novedades-004)

---

## ✅ Requisitos

| | Versión | Notas |
| --- | --- | --- |
| Node.js | **22.13+** (recomendado 22 LTS o 24) | `node:sqlite` nativo sin flags. Con Node < 22.13 instala `better-sqlite3`. |
| Next.js | **16.x** (probado con 16.4.6, Turbopack) | También funciona con 15.x. Usa la versión parcheada más reciente. |
| React | 19 | La que trae Next 16. |
| Tailwind CSS | **v4** | Solo si usas los componentes de `make:ui`. |
| Electron | **35+** (el scaffold usa 45) | Solo para desktop. Necesario para tener `node:sqlite`. |

> Mantén Next.js actualizado dentro de la línea 16.x: las versiones nuevas incluyen parches de
> seguridad. Este paquete no fija la versión de Next (no es dependencia), así que actualizar
> Next no requiere actualizar `@seip/nextjs`.

---

## 📦 Instalación

```bash
npm install @seip/nextjs
```

Dependencias **opcionales** (son `peerDependencies` opcionales: instala solo lo que uses):

```bash
npm install pg               # PostgreSQL
npm install mysql2           # MySQL / MariaDB
npm install better-sqlite3   # SQLite en Node < 22.13 (en Node 22.13+ se usa node:sqlite nativo)
npm install ws               # Servidor WebSocket
npm install multer           # Solo para Upload.disk() / Upload.storage() (Express)
npm install bcrypt           # Solo para verificar hashes bcrypt existentes
```

Lo que **no** necesita nada extra: SQLite (Node 22.13+), hash `scrypt`, Auth, RateLimit,
Validator, Upload con Server Actions, IA (usa `fetch`), SEO y los componentes UI.

### Next.js 16 y Turbopack: no hace falta configurar nada

Desde la 0.0.4 los paquetes opcionales se cargan en tiempo de ejecución sin que Turbopack intente
resolverlos al compilar. El build funciona aunque `bcrypt`, `pg`, `mysql2`, `multer`, `ws` o
`better-sqlite3` **no** estén instalados.

> **Si vienes de la 0.0.3:** quita `serverExternalPackages: ["@seip/nextjs"]` de tu `next.config`.
> Con el paquete como externo, `next/headers` no comparte el contexto de la request y
> `Auth.login()` no puede escribir la cookie. También puedes quitar el `cookieStore: await cookies()`
> que pasabas para esquivar eso (dejarlo no rompe nada) y la normalización manual de filas de SQLite.

### `output: "standalone"` con un driver opcional

Como el import de los opcionales es dinámico, Next.js no los detecta al armar `.next/standalone` y
no los copia. Si usas `pg`, `mysql2`, `bcrypt`, etc. con `output: "standalone"` (VPS con standalone
o Desktop), impórtalo tú y regístralo **una vez**:

```javascript
// src/lib/db.js
import pg from "pg";                              // Next lo detecta y lo copia a standalone
import { registerModule } from "@seip/nextjs";

registerModule("pg", pg);
// MySQL:  import * as mysql from "mysql2/promise"; registerModule("mysql2/promise", mysql);
// bcrypt: import bcrypt from "bcrypt";             registerModule("bcrypt", bcrypt);
```

`registerModule` acepta: `pg`, `mysql2/promise`, `better-sqlite3`, `bcrypt`, `multer`, `ws`.
Importa ese archivo desde donde uses la base de datos (o desde `instrumentation.js`).

### Imports por subruta

En `proxy.js` importa por subruta (`@seip/nextjs/auth`, `@seip/nextjs/ratelimit`): así no se
cargan módulos que no usas. Los drivers de base de datos se cargan recién en la primera consulta.

```javascript
import { Auth } from "@seip/nextjs/auth";        // solo Auth
import { db } from "@seip/nextjs/database";      // solo la BD
import { Model, Auth, Validator } from "@seip/nextjs"; // todo junto (Server Actions, rutas)
```

---

## 🔧 Variables de entorno

El CLI carga `.env`, `.env.local`, `.env.$NODE_ENV` y `.env.$NODE_ENV.local` con la misma
prioridad que Next.js, así que `migrate` usa la misma base que tu app.

```bash
# .env
APP_NAME=mi-app
APP_URL=https://midominio.com
JWT_SECRET=una-cadena-aleatoria-de-al-menos-32-caracteres   # openssl rand -hex 32

# Base de datos (elige una)
DB_TYPE=sqlite                    # sqlite | postgres | mysql (alias: pg, postgresql, mariadb)
DB_FILE=database/app.db           # SQLite
# DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mi_db
# DATABASE_URL=mysql://user:pass@127.0.0.1:3306/mi_db
# DATABASE_URL=sqlite://database/app.db?busy_timeout=5000&journal_mode=WAL&synchronous=NORMAL
```

| Variable | Usado por | Descripción |
| --- | --- | --- |
| `JWT_SECRET` | Auth, WS | **Obligatoria** para Auth. Mínimo 32 caracteres en producción. No hay valor por defecto. |
| `DB_TYPE` | Database | `sqlite` (por defecto), `postgres`, `mysql`. Se deduce de `DATABASE_URL` si falta. |
| `DATABASE_URL` | Database | URL de conexión. Para SQLite acepta `busy_timeout`, `journal_mode`, `synchronous`. |
| `DB_FILE` | Database | Archivo SQLite (por defecto `database/app.db`, relativo a `APP_DIR` o a userData en desktop). |
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | Database | Alternativa a `DATABASE_URL` para Postgres/MySQL. |
| `APP_NAME` / `TITLE` | Config, Desktop | Nombre de la app (carpeta de datos en desktop, PM2). |
| `APP_URL` | Seo, Config | URL pública para sitemap/robots. |
| `APP_DIR` | Config | Raíz del proyecto (con standalone, para que la BD y uploads no queden en `.next`). |
| `USER_DATA_PATH` | Config | Carpeta escribible para BD/uploads/logs (desktop la define sola). |
| `DESKTOP_MODE` | Config | `true` activa el modo desktop (cookies sin `Secure`, datos en userData). |
| `AUTH_REVOCATION_FILE` | Auth | Archivo de sesiones revocadas. `false` = solo memoria. |
| `TRUSTED_PROXIES` | RateLimit | Cantidad de proxies delante de Next (nginx = 1, por defecto). |
| `DEEPSEEK_API_KEY` `OPENAI_API_KEY` `ANTHROPIC_API_KEY` `GEMINI_API_KEY` | IA | Claves de cada proveedor. |
| `DEEPSEEK_MODEL` `OPENAI_MODEL` `ANTHROPIC_MODEL` `GEMINI_MODEL` | IA | Modelo por defecto de cada proveedor. |
| `AI_TIMEOUT_MS` | IA | Timeout por llamada (30000 por defecto). |
| `WS_PORT` `WS_HOST` `WS_ALLOWED_ORIGINS` | WebSocket | Puerto, host y orígenes permitidos. |

---

## 🗄️ Base de datos

`db` es un **singleton** guardado en `globalThis`: el Fast Refresh de Next no abre conexiones nuevas
ni bloquea SQLite. Se inicializa solo en la primera consulta.

```javascript
import { db } from "@seip/nextjs/database";

// SELECT → array de objetos planos (seguros para pasar a Client Components)
const users = await db.query("SELECT id, name FROM users WHERE role = ?", ["admin"]);

// Una sola fila (o null)
const user = await db.query("SELECT * FROM users WHERE id = ?", [id], { return_row: true });
// atajo: await db.query(sql, params, "return_row")

// INSERT → id insertado · UPDATE/DELETE → filas afectadas
const newId = await db.query("INSERT INTO users (name, email) VALUES (?, ?)", ["Ana", "ana@x.com"]);
const changed = await db.query("UPDATE users SET name = ? WHERE id = ?", ["Ana M.", newId]);
```

- Usa siempre `?` como placeholder, también en Postgres (se convierte a `$1, $2…`).
- Los parámetros se normalizan por dialecto: `undefined → null`, booleanos → `1/0` en SQLite/MySQL,
  `Date` → ISO en SQLite, objetos/arrays → JSON.
- Si la consulta falla, se lanza el error y se loguea (usa `{ silent: true }` para no loguear).

### Paginación

```javascript
const { data, total, page, limit, totalPages } = await db.paginate(
  "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC",
  [userId],
  { page: 2, limit: 20, maxLimit: 100 } // maxLimit evita ?limit=1000000
);
```

Para listados con búsqueda, filtros y orden que vienen de la URL, usa [`TableQuery`](#-tablequery-listados-con-búsqueda-filtros-y-orden).

### Transacciones

Dentro del callback, tanto `tx.query()` como `db.query()` (y los modelos) corren en la transacción,
sobre la misma conexión. Si el callback lanza un error se hace `ROLLBACK`. Las transacciones
anidadas usan `SAVEPOINT`. En SQLite, las consultas de otras requests esperan a que la transacción
termine en vez de quedar incluidas en ella.

```javascript
await db.transaction(async (tx) => {
  const orderId = await tx.query("INSERT INTO orders (user_id, total) VALUES (?, ?)", [userId, total]);
  for (const item of items) {
    await tx.query("INSERT INTO order_items (order_id, product_id, qty) VALUES (?, ?, ?)", [orderId, item.id, item.qty]);
    const changed = await tx.query("UPDATE stock SET qty = qty - ? WHERE product_id = ? AND qty >= ?", [item.qty, item.id, item.qty]);
    if (changed === 0) throw new Error("Sin stock"); // → ROLLBACK de todo
  }
  return orderId;
});
```

### Varias bases de datos

```javascript
import { Database } from "@seip/nextjs/database";

export const analytics = new Database(10, 0, { DB_TYPE: "sqlite", DB_FILE: "database/analytics.db" });
// new Database(connectionLimit, queueLimit, config)
```

### Drivers

| `DB_TYPE` | Driver | Instalación |
| --- | --- | --- |
| `sqlite` | `node:sqlite` (Node 22.13+) → si no existe, `better-sqlite3` | nada / `npm i better-sqlite3` |
| `postgres` | `pg` (pool) | `npm i pg` |
| `mysql` | `mysql2/promise` (pool) | `npm i mysql2` |

SQLite se abre en modo WAL con `busy_timeout=5000` y `synchronous=NORMAL` (configurable por
`DATABASE_URL`). Node imprime un `ExperimentalWarning` de SQLite: es informativo.

En scripts propios, cierra las conexiones al terminar: `await Database.closeAll()`.

---

## 🧩 Modelos (ORM)

```bash
npx seip make:model Post   # crea src/models/post.js (o app/models, models)
```

```javascript
// src/models/user.js
import { Model } from "@seip/nextjs/model";

export default class User extends Model {
  static table = "users";
  static primaryKey = "id";
  static timestamps = true;   // created_at / updated_at automáticos
  static softDelete = true;   // delete() marca deleted_at en vez de borrar

  static schema = {
    id: { type: "int", primary: true, auto: true },
    name: { type: "string", length: 150, required: true, min: 2 },
    email: { type: "string", required: true, unique: true, email: true },
    password: { type: "string", hash: true, hidden: true, min: 8, password: true },
    role: { type: "string", default: "user", in: ["user", "admin"] },
    settings: { type: "json", nullable: true },
    active: { type: "boolean", default: true },
  };
}
```

```javascript
// src/models/post.js
import { Model } from "@seip/nextjs/model";

export default class Post extends Model {
  static table = "posts";
  static schema = {
    id: { type: "uuid", primary: true, auto: true },        // UUID generado al crear
    user_id: { type: "int", references: "users", onDelete: "CASCADE" },
    title: { type: "string", required: true, max: 200 },
    body: { type: "text" },
    published_at: { type: "datetime", nullable: true },
  };
}
```

**Tipos de columna:** `int`/`integer`, `bigint`, `float`/`double`/`decimal`, `string` (con `length`),
`text`, `boolean`/`bool`, `date`/`datetime`/`timestamp`, `json`, `uuid`.

**Opciones de columna:** `primary`, `auto`, `required`, `nullable`, `unique`, `length`, `default`,
`hash` (se hashea con scrypt al crear/actualizar), `hidden` (no se devuelve salvo `withHidden`),
`references` + `onDelete`, y cualquier regla de [`Validator`](#-validación) (`email`, `min`, `max`, `in`…),
que `Model.validator()` usa automáticamente.

### CRUD

```javascript
import User from "@/models/user";

const id = await User.create({ name: "Ana", email: "ana@x.com", password: "Secreta123" });
const user = await User.find(id);                          // por primary key
const admin = await User.first({ role: "admin" });         // primera coincidencia
const n = await User.update(id, { name: "Ana María" });    // filas afectadas
await User.delete(id);                                     // soft delete (softDelete = true)
await User.restore(id);                                    // deshace el soft delete
await User.delete(id, { force: true });                    // borrado real

const exists = await User.exists({ email: "ana@x.com" });
const total = await User.count({ active: true });
const u = await User.firstOrCreate({ email: "bob@x.com" }, { name: "Bob" });
const s = await User.updateOrCreate({ email: "bob@x.com" }, { name: "Roberto" });
```

### Consultas: `where`, orden, límites

```javascript
const users = await User.all({
  where: {
    role: "admin",                       // =
    id: [1, 2, 3],                       // IN
    age: { $gte: 18, $lt: 65 },          // >=, <
    email: { $like: "%@empresa.com" },   // LIKE
    deleted_at: null,                    // IS NULL
    status: { $in: ["a", "b"] },         // $in / $nin
    phone: { $notNull: true },           // IS NOT NULL ($null para IS NULL)
    name: { $ne: "test" },               // !=
  },
  order: "created_at DESC, name ASC",     // o ["created_at DESC", "name"]
  limit: 20,
  offset: 40,
  withDeleted: false,                     // incluir soft-deleted
  withHidden: false,                      // incluir columnas hidden
});

const page = await User.paginate({ page: 1, limit: 20, where: { role: "user" }, order: "name" });
```

Las columnas se validan como identificadores y los valores van como parámetros. Una condición con
`undefined` o un operador desconocido **lanza error** (en vez de ignorarse y convertir un `DELETE`
filtrado en uno masivo). `delete()`/`update()` sin condiciones también lanzan error.

### Relaciones

```javascript
// Usuario con sus posts (posts.user_id se detecta por `references` o por convención <singular>_id)
const user = await User.find(1, { oneMany: Post });          // user.posts = [...]
const posts = await Post.all({ belongsTo: User });           // post.user = {...}
const full = await User.find(1, { oneMany: [Post, Comment] });

// Borrado en cascada (en una transacción)
await User.delete(1, { cascade: [Post, Comment] });
```

### Caché de Next.js

Cada `create`, `update`, `delete` y `restore` llama a `revalidateTag(Model.table)`. Si cacheas
lecturas con ese tag, se invalidan solas:

```javascript
// Next 16 con cacheComponents: true
import { cacheTag } from "next/cache";
import User from "@/models/user";

export async function getUsers() {
  "use cache";
  cacheTag(User.getCacheTag()); // "users"
  return User.all({ order: "name" });
}
```

### Uso en una Server Action

```javascript
// src/app/register/actions.js
"use server";
import { redirect } from "next/navigation";
import { Auth } from "@seip/nextjs/auth";
import User from "@/models/user";

export async function register(prevState, formData) {
  const result = await User.validator("create", "es").validate(formData);
  if (!result.success) return { errors: result.errors, values: result.raw };

  if (await User.exists({ email: result.data.email })) {
    return { errors: [{ field: "email", message: "Ese email ya está registrado" }] };
  }

  // result.data solo trae campos del schema: un "role" inyectado en el form se descarta.
  const id = await User.create(result.data); // el password se hashea solo
  await Auth.login({ id, role: "user" });
  redirect("/dashboard");
}
```

---

## 🔁 Migraciones y seeds

```bash
npx seip make:migration          # compara src/models con la BD y genera database/migrations/<fecha>_<nombre>.sql
npx seip make:migration add_role # con nombre
npx seip migrate                 # ejecuta pendientes (en transacción, por lotes)
npx seip migrate:status          # historial (incluye migraciones huérfanas)
npx seip migrate:rollback        # revierte el último lote (exige sección Down)

npx seip make:seed users         # crea database/seeds/users.sql
npx seip seed                    # ejecuta seeds pendientes (con tracking)
npx seip seed --force            # re-ejecuta todos
```

Una migración SQL tiene secciones `Up` y `Down`:

```sql
-- Up
CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title VARCHAR(200) NOT NULL);

-- Down
DROP TABLE posts;
```

Migraciones en JS (`.js`/`.mjs`), ejecutadas en la misma transacción:

```javascript
// database/migrations/20260101_backfill_slugs.mjs
export async function up(tx) {
  const posts = await tx.query("SELECT id, title FROM posts");
  for (const p of posts) {
    await tx.query("UPDATE posts SET slug = ? WHERE id = ?", [p.title.toLowerCase().replace(/\W+/g, "-"), p.id]);
  }
}
export async function down(tx) {
  await tx.query("UPDATE posts SET slug = NULL");
}
```

Las tablas se crean respetando dependencias (`references`). El historial se guarda en `_seip_migrations`.

---

## 🔐 Autenticación

> **Requisito:** `JWT_SECRET` (mínimo 32 caracteres en producción). No existe secreto por defecto:
> sin él, `Auth` lanza error al firmar y devuelve `null` al verificar. Es intencional.

El token es un JWT firmado con HMAC-SHA256 cuyo contenido va **cifrado** con AES-256-GCM: el
cliente no puede leer ni modificar el payload. Cada sesión tiene un `_sessionId` que se puede revocar.

### 1. Proteger rutas en `proxy.js`

```javascript
// src/proxy.js (Next 16; en Next 15 se llama middleware.js)
import { Auth } from "@seip/nextjs/auth";
import { RateLimit } from "@seip/nextjs/ratelimit";

export async function proxy(request) {
  const rl = RateLimit.check(request, { max: 100, windowMs: 60_000 });
  if (rl.exceeded) return rl.response;

  return (
    (await Auth.handleProxy(request, {
      protectedRoutes: ["/dashboard", "/admin/*", "/api/private/*"],
      guestOnlyRoutes: ["/login", "/register"],
      redirectToLogin: "/login",          // agrega ?from=<ruta original>
      redirectToDashboard: "/dashboard",
    })) ?? undefined
  );
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

- `"/admin"` protege `/admin` y todo lo que cuelga de ahí; `"/admin/*"` es equivalente; `"/"` solo la home.
- Para rutas `/api/*` protegidas responde `401` JSON en vez de redirigir.
- El token se lee de la cookie `auth` o de `Authorization: Bearer <token>`.

### 2. Login y logout (Server Actions)

```javascript
// src/app/login/actions.js
"use server";
import { redirect } from "next/navigation";
import { Auth } from "@seip/nextjs/auth";
import { Hash } from "@seip/nextjs/hash";
import { RateLimit } from "@seip/nextjs/ratelimit";
import { headers } from "next/headers";
import User from "@/models/user";

export async function login(prevState, formData) {
  const rl = RateLimit.check({ headers: await headers() }, { max: 5, windowMs: 60_000, prefix: "login" });
  if (rl.exceeded) return { error: "Demasiados intentos, espera un minuto." };

  const user = await User.first({ email: formData.get("email") }, { withHidden: true });
  if (!user || !(await Hash.verify(formData.get("password"), user.password))) {
    return { error: "Credenciales inválidas" };
  }

  const { cookieSet } = await Auth.login({ id: user.id, role: user.role }, { expiresIn: "7d" });
  if (!cookieSet) return { error: "No se pudo iniciar sesión" };
  redirect(formData.get("from") || "/dashboard");
}

export async function logout() {
  await Auth.logout(); // revoca la sesión en el servidor y borra la cookie
  redirect("/login");
}
```

`Auth.login(data, options)`:

| Opción | Por defecto | |
| --- | --- | --- |
| `expiresIn` | `"7d"` | Segundos o `"15m"`, `"12h"`, `"7d"`, `"2w"`. Un formato inválido lanza error. |
| `cookieKey` | `"auth"` | Nombre de la cookie. |
| `cookieStore` | `cookies()` de `next/headers` | Pásalo solo si quieres usar otro store. |
| `secret` | `JWT_SECRET` | |

Devuelve `{ token, cookie, cookieSet }`. La cookie es `httpOnly`, `sameSite=lax` y `secure` en
producción (salvo en desktop, que corre en `http://127.0.0.1`).

> `cookies().set()` solo funciona en **Server Actions y Route Handlers**. Si `login`/`logout` no
> pueden escribir la cookie (por ejemplo desde un Server Component), avisan con `console.warn` y
> `login()` devuelve `cookieSet: false`; `logout()` devuelve `false`.

### 3. Usuario actual

```javascript
// Server Component, Server Action o Route Handler
import { Auth } from "@seip/nextjs/auth";

const user = await Auth.user();          // lee cookie o Bearer de la request actual; null si no hay sesión
const user2 = await Auth.user(request);  // pasando el Request (Route Handler)
```

```javascript
// src/app/api/me/route.js — sirve para navegador (cookie) y apps/API (Bearer)
import { Auth } from "@seip/nextjs/auth";

export async function GET() {
  const user = await Auth.user();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ user });
}
```

Para clientes de API (apps móviles, scripts), devuelve el `token` de `Auth.login()` en el body y
envíalo como `Authorization: Bearer <token>`.

### 4. Roles

```javascript
// src/lib/guards.js
import { forbidden, redirect } from "next/navigation";
import { Auth } from "@seip/nextjs/auth";

export async function requireRole(role) {
  const user = await Auth.user();
  if (!user) redirect("/login");
  if (user.role !== role) forbidden(); // Next 16 (authInterrupts) o lanza tu propio error
  return user;
}
```

### Revocación de sesiones

`Auth.logout()` y `Auth.revoke(token)` invalidan el `_sessionId` aunque alguien conserve la cookie.
La lista se comparte entre `proxy.js` y las rutas, y en producción se guarda en
`database/.revoked-sessions.json` para sobrevivir a `pm2 restart`
(`AUTH_REVOCATION_FILE=<ruta>` para cambiarla, `AUTH_REVOCATION_FILE=false` para solo memoria).

API de bajo nivel: `Auth.generateToken(payload, secret, expiresIn)`, `Auth.verifyToken(token)`,
`Auth.encrypt(obj)` / `Auth.decrypt(str)`.

---

## 🔑 Hash de contraseñas

```javascript
import { Hash } from "@seip/nextjs/hash";

const hash = await Hash.make("Secreta123");          // $scrypt$N=16384,r=8,p=1$<salt>$<hash>
const ok = await Hash.verify("Secreta123", hash);     // comparación en tiempo constante

if (ok && Hash.needsRehash(user.password)) {          // migra hashes viejos (o bcrypt) a scrypt
  await User.update(user.id, { password: "Secreta123" });
}

await Hash.make("x", { driver: "bcrypt", rounds: 12 }); // requiere npm i bcrypt
```

`Hash.verify` reconoce hashes `bcrypt` (`$2a$`, `$2b$`, `$2y$`) si `bcrypt` está instalado, útil
para migrar usuarios desde Laravel u otros sistemas.

---

## 🚦 Rate limit

```javascript
import { RateLimit } from "@seip/nextjs/ratelimit";

// Route Handler
export async function POST(request) {
  const rl = RateLimit.check(request, { max: 10, windowMs: 60_000, prefix: "contacto" });
  if (rl.exceeded) return rl.response; // 429 con Retry-After
  // rl.remaining, rl.resetTime
}

// Server Action (no hay Request: pasa los headers)
import { headers } from "next/headers";
const rl = RateLimit.check({ headers: await headers() }, { max: 5, windowMs: 60_000, prefix: "login" });

// Por usuario en vez de por IP
RateLimit.check(request, { max: 100, keyGenerator: () => `user:${user.id}` });
```

- La IP se obtiene de `X-Real-IP` o de la entrada de `X-Forwarded-For` agregada por tu proxy de
  confianza; la primera entrada (que el cliente puede falsificar) no se usa. Con más de un proxy
  delante (Cloudflare + nginx) usa `TRUSTED_PROXIES=2`.
- Limitadores distintos no comparten contador; ponles `prefix`.
- Es en memoria por proceso: correcto con PM2 en 1 instancia (lo que genera `make:ecosystem`).
  En cluster, cada instancia cuenta por separado.

---

## ✔️ Validación

```javascript
import { Validator } from "@seip/nextjs/validate";

const v = new Validator(
  {
    name: { required: true, min: 2, max: 100, xss: true },
    email: { required: true, email: true },
    age: { number: true, min: 18, max: 120 },     // con number, min/max son valores
    role: { in: ["user", "admin"] },
    website: { url: true },
    birthday: { date: true },                      // ISO 8601
    password: { required: true, password: true },  // mayúscula, minúscula y número, 6+
    username: { alphanumeric: true, pattern: /^[a-z0-9_]+$/i },
    terms: { required: true, equals: "on", messages: { equals: "Debes aceptar los términos" } },
  },
  "es" // es | en | pt | br | fr
);

const result = await v.validate(formData); // FormData, objeto plano o Request (JSON / form)
// result.success, result.errors = [{ field, message }], result.message = [mensajes]
// result.data = solo campos declarados (anti mass-assignment), result.raw = input completo
```

**Reglas:** `required`, `min`, `max`, `email`, `number`, `alpha`, `alphanumeric`, `boolean`, `date`,
`url`, `in`, `equals`, `password`, `pattern`, `xss` (escapa HTML), y `messages` para personalizar.

Formulario completo con `useActionState` y los componentes UI:

```jsx
// src/app/register/form.jsx
"use client";
import { useActionState } from "react";
import { Input, Button, Alert, errorFor } from "@/ui";
import { register } from "./actions";

export function RegisterForm() {
  const [state, action, pending] = useActionState(register, null);
  return (
    <form action={action} className="space-y-4">
      {state?.errors?.length > 0 && <Alert tone="danger" title="Revisa los datos" />}
      <Input name="name" label="Nombre" defaultValue={state?.values?.name} error={errorFor(state?.errors, "name")} />
      <Input name="email" type="email" label="Email" defaultValue={state?.values?.email} error={errorFor(state?.errors, "email")} />
      <Input name="password" type="password" label="Contraseña" error={errorFor(state?.errors, "password")} />
      <Button type="submit" loading={pending} block>Crear cuenta</Button>
    </form>
  );
}
```

`escapeXss(str)` y `Validator.sanitizeObject(obj)` están disponibles para sanitizar a mano.

---

## 📁 Subida de archivos

> **Seguridad:** el destino se valida contra path traversal (carpetas solo con `a-z0-9_-`), el
> nombre guardado es un UUID y la extensión se deriva del MIME type. Extensiones ejecutables
> (`.html`, `.svg`, `.js`, `.php`…) se rechazan salvo `allowDangerousExtensions: true`.

```javascript
// Server Action
"use server";
import { Upload } from "@seip/nextjs/upload";

export async function uploadAvatar(formData) {
  try {
    const file = await Upload.save(formData.get("avatar"), {
      folder: "avatars",                       // public/avatars (o userData/avatars en desktop)
      maxSize: 2 * 1024 * 1024,
      allowedTypes: ["image/png", "image/jpeg", "image/webp"],
    });
    return { success: true, url: file.url };   // { filename, url, path, size, mimeType }
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// Varios archivos
const saved = await Promise.all(formData.getAll("files").map((f) => Upload.save(f, { folder: "docs" })));
```

Con el componente [`FileUpload`](#fileupload) (drag & drop, previews) el form envía los archivos
tal cual a la Server Action.

> **Importante:** `next start` solo sirve lo que había en `public/` al hacer el build, así que lo
> subido en runtime da 404 si nadie más lo sirve. La config de `nginx:conf` ya lo sirve. Sin nginx
> (o en desktop), agrega esta ruta:
>
> ```javascript
> // src/app/uploads/[...path]/route.js
> import { Upload } from "@seip/nextjs/upload";
> export async function GET(req, { params }) {
>   return Upload.serve((await params).path, { folder: "uploads" });
> }
> ```
>
> Los Server Actions rechazan bodies de más de 1 MB por defecto: sube
> `experimental.serverActions.bodySizeLimit` en `next.config` (por ejemplo `"10mb"`) o usa un
> Route Handler.

Con Express/otro servidor Node: `Upload.disk({ folder, maxSize, allowedTypes })` devuelve un
middleware de `multer` con las mismas protecciones.

---

## 📊 TableQuery: listados con búsqueda, filtros y orden

`TableQuery` lee de la URL `?q=&page=&limit=&sort=&dir=&f_<columna>=` y arma la consulta. Los
nombres de columna salen **siempre de tus listas permitidas**, nunca de la URL, y los valores van
como parámetros: no hay SQL injection aunque el usuario edite la URL. Es la contraparte de
servidor del componente [`DataTable`](#datatable) en `mode="url"`, pero sirve para cualquier listado.

```javascript
// src/app/admin/users/page.js (Server Component)
import { TableQuery } from "@seip/nextjs/table";
import User from "@/models/user";
import { UsersTable } from "./users-table";

export default async function UsersPage({ searchParams }) {
  const query = TableQuery.parse(await searchParams, {
    sortable: ["name", "email", "created_at"],
    filterable: ["role", "active"],
    defaultSort: "created_at",
    defaultDir: "desc",
    defaultLimit: 25,
    maxLimit: 100,
  });

  const result = await TableQuery.paginate(User, query, {
    searchable: ["name", "email"],   // búsqueda con OR entre estas columnas
    filterable: ["role", "active"],
  });
  // result = { data, total, page, limit, totalPages, query }

  return <UsersTable data={result.data} total={result.total} query={query} />;
}
```

- Con un **Model**: usa su tabla y conexión, excluye soft-deleted y quita columnas `hidden`.
- Con un **nombre de tabla**: `TableQuery.paginate("orders", query, { db, searchable: [...] })`.
- Condición fija: `{ where: { sql: "tenant_id = ?", params: [tenantId] } }`.
- Columnas: `{ select: "id, name, email" }`.
- La búsqueda es insensible a mayúsculas (ILIKE en Postgres) y los `%`/`_` que escriba el usuario
  se tratan como texto.
- `TableQuery.build(query, options)` devuelve `{ sql, params }` si quieres ejecutar la consulta tú.

---

## 🎨 UI: componentes con Tailwind v4

Suite de componentes que se **copian a tu proyecto** (estilo shadcn): los archivos son tuyos y los
editas como quieras. Sin dependencias: React 19 + Tailwind CSS v4. Accesibles (teclado, ARIA,
`<dialog>` nativo), responsive y con modo oscuro.

```bash
npx seip make:ui                        # todos los componentes en src/ui (o ui/ si no hay src/)
npx seip make:ui datatable toast modal  # solo algunos (copia sus dependencias)
npx seip make:ui --list                 # lista con descripción
npx seip make:ui --dir=components/ui    # otra carpeta
npx seip make:ui button --force         # reemplaza archivos existentes (si no, no los toca)
```

El comando:
1. Copia los componentes + `theme.css` + `utils.js` y genera `index.js` para importar todo junto.
2. Agrega `@import "../ui/theme.css";` a tu `globals.css` (detrás de `@import "tailwindcss";`).
3. Crea `postcss.config.mjs` con `@tailwindcss/postcss` si no existe, y avisa si falta Tailwind v4.

### Puesta en marcha

```bash
npm install -D tailwindcss @tailwindcss/postcss   # si no lo tienes (create-next-app ya lo trae)
npx seip make:ui
```

```css
/* src/app/globals.css */
@import "tailwindcss";
@import "../ui/theme.css";
```

```jsx
// src/app/layout.js
import "./globals.css";
import { UIProvider } from "@/ui/provider";

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>
        <UIProvider>{children}</UIProvider> {/* toasts, snackbar y confirm */}
      </body>
    </html>
  );
}
```

```jsx
import { Button, Input, DataTable } from "@/ui";      // barrel
import { Button } from "@/ui/button";                 // o archivo por archivo
```

El alias `@/*` viene en `create-next-app`. Si no lo tienes, usa rutas relativas o agrega en
`jsconfig.json`/`tsconfig.json`: `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`.

### Componentes

| Componente | Archivo | Tipo | Incluye |
| --- | --- | --- | --- |
| [Button](#button) | `button.jsx` | server | `Button`, `buttonClasses()` |
| [Input / Textarea / Field](#input-textarea-select-checkbox-switch) | `input.jsx` | server | label, hint, error, íconos |
| [Select](#input-textarea-select-checkbox-switch) | `select.jsx` | server | `<select>` nativo con estilo |
| [Checkbox / Radio / Switch](#input-textarea-select-checkbox-switch) | `checkbox.jsx` | server | |
| [Card](#card-statcard-badge-alert) | `card.jsx` | server | `Card`, `CardHeader`, `CardBody`, `CardFooter`, `StatCard` |
| [Badge](#card-statcard-badge-alert) | `badge.jsx` | server | 6 tonos, `dot` |
| [Alert](#card-statcard-badge-alert) | `alert.jsx` | server | banner inline |
| [EmptyState](#emptystate-skeleton-spinner) | `empty-state.jsx` | server | |
| [Skeleton / Spinner](#emptystate-skeleton-spinner) | `skeleton.jsx`, `spinner.jsx` | server | para `loading.js` |
| [Tooltip](#tooltip-y-accordion) | `tooltip.jsx` | server | solo CSS |
| [Accordion](#tooltip-y-accordion) | `accordion.jsx` | server | `<details>` nativo, sin JS |
| [Toast / Snackbar](#toast-y-snackbar) | `toast.jsx` | client | `useToast`, `useSnackbar`, `toast()` global, `toast.promise` |
| [Modal / Confirm](#modal-y-confirm) | `modal.jsx` | client | `Modal`, `useDisclosure`, `useConfirm` |
| [Drawer](#drawer) | `drawer.jsx` | client | izquierda, derecha, arriba, bottom sheet |
| [Tabs](#tabs-y-dropdown) | `tabs.jsx` | client | navegación con flechas |
| [Dropdown](#tabs-y-dropdown) | `dropdown.jsx` | client | menú de acciones |
| [Pagination](#pagination) | `pagination.jsx` | client | callbacks o links |
| [DataTable](#datatable) | `datatable.jsx` | client | búsqueda, filtros, orden, paginación, selección, CSV, cards en móvil |
| [Carousel](#carousel) | `carousel.jsx` | client | scroll-snap, swipe, autoplay, dots |
| [FileUpload](#fileupload) | `file-upload.jsx` | client | drag & drop, previews, validación |
| UIProvider | `provider.jsx` | client | Toast + Confirm |

**server** = sin hooks de estado: se pueden usar directo en Server Components y en
`<form action={serverAction}>`. **client** = llevan `"use client"`.

### Tema y modo oscuro

Todos los colores salen de variables en `theme.css`. Cambia la marca en un solo lugar:

```css
:root {
  --ui-primary: #0ea5e9;      /* color principal */
  --ui-primary-fg: #ffffff;   /* texto sobre el principal */
  --ui-radius: 0.375rem;      /* bordes */
}
.dark { --ui-primary: #38bdf8; }
```

Tokens disponibles como utilidades de Tailwind: `bg-surface`, `bg-surface-2`, `text-fg`,
`text-muted`, `border-border`, `bg-primary`, `text-primary-fg`, `text-danger`, `bg-success`,
`text-warning`, `text-info`, `ring-ring`, `rounded-ui` (con opacidad: `bg-primary/10`).

El modo oscuro sigue al sistema operativo. Para forzarlo: `<html className="dark">` o
`<html className="light">`, y la variante `dark:` de Tailwind funciona con la clase `.dark`.

`cn()` (en `utils.js`) une clases. Si quieres que las clases que pasas por `className` pisen a las
del componente cuando chocan (`px-4` vs `px-2`), instala `tailwind-merge` y devuelve `twMerge(...)`
desde `cn`.

### Button

```jsx
import Link from "next/link";
import { Button, buttonClasses } from "@/ui";

<Button>Guardar</Button>
<Button variant="outline" size="sm" leftIcon={<PlusIcon />}>Nuevo</Button>
<Button variant="danger" loading={pending}>Eliminar</Button>     {/* spinner + deshabilitado */}
<Button type="submit" block>Enviar</Button>                       {/* ancho completo */}
<Button size="icon" variant="ghost" aria-label="Cerrar">✕</Button>

{/* Links con estilo de botón (también en Server Components) */}
<Link href="/nuevo" className={buttonClasses({ variant: "secondary" })}>Crear</Link>
```

Variantes: `primary`, `secondary`, `outline`, `ghost`, `danger`, `success`, `link`.
Tamaños: `xs`, `sm`, `md`, `lg`, `icon`, `icon-sm`.

### Input, Textarea, Select, Checkbox, Switch

```jsx
import { Input, Textarea, Select, Checkbox, Radio, Switch, errorFor } from "@/ui";

<Input name="email" type="email" label="Email" required hint="No lo compartimos"
       error={errorFor(state?.errors, "email")} leftIcon={<MailIcon />} />
<Input name="q" size="sm" placeholder="Buscar…" />
<Textarea name="bio" label="Biografía" rows={5} />
<Select name="country" label="País" placeholder="Elegí uno"
        options={["Argentina", "Uruguay", { value: "cl", label: "Chile" }]} />
<Checkbox name="terms" label="Acepto los términos" description="Leé las condiciones" />
<Radio name="plan" value="pro" label="Pro" description="$10/mes" />
<Switch name="notifications" label="Notificaciones" defaultChecked />
```

- `error` acepta un string. `errorFor(errors, field)` lo saca del array de `Validator`
  (`[{ field, message }]`) o de un objeto `{ email: "..." }`.
- Con `error`, el control queda con `aria-invalid` y el mensaje enlazado por `aria-describedby`.
- `Field` envuelve cualquier control propio con label/hint/error.
- Todos aceptan `ref` y cualquier prop nativa (`defaultValue`, `onChange`, `disabled`…).

### Card, StatCard, Badge, Alert

```jsx
import { Card, CardHeader, CardBody, CardFooter, StatCard, Badge, Alert, Button } from "@/ui";

<Card>
  <CardHeader title="Pedido #1024" description="Hace 2 horas" action={<Badge tone="success" dot>Pagado</Badge>} />
  <CardBody>…</CardBody>
  <CardFooter><Button variant="outline">Ver detalle</Button></CardFooter>
</Card>

<div className="grid gap-4 sm:grid-cols-3">
  <StatCard label="Ventas" value="$12.400" delta="+8% vs mes anterior" trend="up" />
  <StatCard label="Reembolsos" value="$320" delta="-2%" trend="down" />
</div>

<Badge tone="warning">Pendiente</Badge>   {/* neutral | primary | success | warning | danger | info */}
<Alert tone="danger" title="No se pudo guardar">{state.message}</Alert>
```

### EmptyState, Skeleton, Spinner

```jsx
// src/app/dashboard/loading.js
import { Skeleton, SkeletonText } from "@/ui";
export default function Loading() {
  return <div className="space-y-4 p-6"><Skeleton className="h-8 w-1/3" /><SkeletonText lines={4} /></div>;
}

<EmptyState icon={<InboxIcon />} title="Sin pedidos" description="Cuando lleguen, aparecerán aquí."
            action={<Button>Crear pedido</Button>} />
<Spinner size="lg" />
```

### Tooltip y Accordion

```jsx
<Tooltip content="Eliminar" side="bottom"><Button size="icon" aria-label="Eliminar">🗑</Button></Tooltip>

{/* Mismo `name` = solo uno abierto a la vez */}
<Accordion name="faq" items={[
  { title: "¿Hacen envíos?", content: "Sí, a todo el país.", defaultOpen: true },
  { title: "¿Medios de pago?", content: "Tarjeta y transferencia." },
]} />
```

### Toast y Snackbar

```jsx
"use client";
import { useToast, useSnackbar } from "@/ui";

const toast = useToast();
toast("Mensaje simple");
toast.success("Guardado", { description: "Los cambios se aplicaron." });
toast.error("No se pudo guardar");
toast.warning("Tu sesión vence pronto", { duration: 8000 });
toast.info("Hay una nueva versión", { action: { label: "Recargar", onClick: () => location.reload() } });

// Estado de una promesa (loading → success / error en el mismo toast)
await toast.promise(saveOrder(data), {
  loading: "Guardando…",
  success: (order) => `Pedido #${order.id} creado`,
  error: (err) => err.message,
});

// Resultado de una Server Action: { success, message } o { errors } de Validator
toast.fromResult(await updateProfile(formData), "Perfil actualizado");

// Snackbar: un solo mensaje abajo, con acción (típico "Deshacer")
const snackbar = useSnackbar();
snackbar.show("Mensaje archivado", { action: { label: "Deshacer", onClick: unarchive }, duration: 6000 });
```

Fuera de componentes (cualquier módulo de cliente): `import { toast } from "@/ui/toast"; toast.success("Hola")`.
`<UIProvider toastPosition="top-center" toastDuration={5000}>` cambia posición
(`top-right`, `top-left`, `top-center`, `bottom-right`, `bottom-left`, `bottom-center`) y duración.
Los toasts se pausan al pasar el mouse.

### Modal y Confirm

```jsx
"use client";
import { Modal, Button, useDisclosure, useConfirm, useToast } from "@/ui";

export function EditUser({ user }) {
  const modal = useDisclosure();               // { open, onOpen, close, toggle }
  const confirm = useConfirm();
  const toast = useToast();

  async function remove() {
    const ok = await confirm({
      title: "¿Eliminar usuario?",
      description: "Esta acción no se puede deshacer.",
      confirmText: "Eliminar",
      danger: true,
    });
    if (ok) toast.fromResult(await deleteUser(user.id), "Usuario eliminado");
  }

  return (
    <>
      <Button onClick={modal.onOpen}>Editar</Button>
      <Button variant="danger" onClick={remove}>Eliminar</Button>
      <Modal
        open={modal.open}
        onClose={modal.close}
        title="Editar usuario"
        description={user.email}
        size="md"                                  // sm | md | lg | xl | full
        footer={<><Button variant="outline" onClick={modal.close}>Cancelar</Button><Button form="edit-user" type="submit">Guardar</Button></>}
      >
        <form id="edit-user" action={updateUser}>…</form>
      </Modal>
    </>
  );
}
```

Usa `<dialog>` nativo: foco atrapado, `Esc` para cerrar, clic en el fondo para cerrar
(`dismissible={false}` lo desactiva) y bloqueo del scroll de la página.

### Drawer

```jsx
<Drawer open={open} onClose={() => setOpen(false)} side="right" title="Filtros"
        footer={<Button onClick={apply}>Aplicar</Button>}>
  …
</Drawer>
{/* side: "right" | "left" | "top" | "bottom" (bottom sheet en móvil) */}
```

### Tabs y Dropdown

```jsx
<Tabs
  variant="underline"                // o "pills"
  defaultValue="perfil"              // o controlado: value + onChange
  tabs={[
    { id: "perfil", label: "Perfil", content: <Perfil /> },
    { id: "pagos", label: "Pagos", content: <Pagos />, badge: <Badge>3</Badge> },
    { id: "api", label: "API", disabled: true },
  ]}
/>

<Dropdown
  trigger={<Button variant="ghost" size="icon" aria-label="Acciones">⋯</Button>}
  align="end"
  items={[
    { type: "label", label: "Usuario" },
    { label: "Ver", href: `/users/${id}` },
    { label: "Editar", onClick: edit, shortcut: "E" },
    { type: "separator" },
    { label: "Eliminar", danger: true, onClick: remove },
  ]}
/>
```

### Pagination

```jsx
<Pagination page={page} totalPages={20} onPageChange={setPage} />
<Pagination page={page} totalPages={20} href={(p) => `?page=${p}`} />  {/* links: SEO y sin JS */}
<Pagination page={page} totalPages={20} onPageChange={setPage} compact /> {/* "3 / 20" */}
```

### DataTable

Tabla responsive: en escritorio es un `<table>` y en móvil cada fila se muestra como tarjeta
(sin scroll horizontal). Búsqueda con debounce, filtros por columna, orden, paginación, tamaño de
página, selección con acciones masivas, exportación CSV (compatible con Excel), skeleton de carga y
estado vacío.

**Modo cliente** (todos los datos en memoria; ideal hasta unos pocos miles de filas):

```jsx
"use client";
import { DataTable, Badge, Button, Dropdown } from "@/ui";

export function ProductsTable({ products }) {
  return (
    <DataTable
      data={products}
      rowKey="id"
      pageSize={25}
      pageSizeOptions={[10, 25, 50]}
      selectable
      bulkActions={(rows, clear) => (
        <Button size="xs" variant="danger" onClick={async () => { await removeMany(rows.map((r) => r.id)); clear(); }}>
          Eliminar {rows.length}
        </Button>
      )}
      exportable="productos"                 // botón "Exportar CSV" → productos.csv
      actions={<Button size="sm">Nuevo</Button>}
      onRowClick={(row) => router.push(`/products/${row.id}`)}
      columns={[
        { key: "name", header: "Producto", sortable: true, primary: true },        // primary = título de la tarjeta en móvil
        { key: "category", header: "Categoría", filter: { type: "select", options: "auto" } },
        { key: "sku", header: "SKU", filter: { type: "text" }, hideOnMobile: true },
        { key: "price", header: "Precio", sortable: true, align: "right",
          render: (row) => `$${row.price.toFixed(2)}`, exportValue: (row) => row.price },
        { key: "stock", header: "Estado",
          accessor: (row) => (row.stock > 0 ? "En stock" : "Agotado"),                   // valor calculado (busca/filtra/ordena por él)
          filter: { type: "select", options: ["En stock", "Agotado"] },
          render: (row, value) => <Badge tone={row.stock > 0 ? "success" : "danger"} dot>{value}</Badge> },
        { key: "actions", header: "", searchable: false, export: false,
          render: (row) => <Dropdown trigger={<Button size="icon-sm" variant="ghost">⋯</Button>} items={[{ label: "Editar", href: `/products/${row.id}/edit` }]} /> },
      ]}
    />
  );
}
```

**Modo URL** (datos paginados en el servidor; para tablas grandes). El estado vive en la URL,
así que los links se pueden compartir, el botón "atrás" funciona y la primera carga viene
renderizada del servidor. Del lado del servidor se usa [`TableQuery`](#-tablequery-listados-con-búsqueda-filtros-y-orden):

```jsx
// src/app/admin/users/users-table.jsx
"use client";
import { DataTable, Badge } from "@/ui";

export function UsersTable({ data, total, query }) {
  return (
    <DataTable
      mode="url"
      data={data}
      total={total}
      query={query}            // estado inicial (de TableQuery.parse)
      columns={[
        { key: "name", header: "Nombre", sortable: true, primary: true },
        { key: "email", header: "Email", sortable: true },
        { key: "role", header: "Rol", filter: { type: "select", options: ["admin", "user"] },
          render: (r) => <Badge tone={r.role === "admin" ? "primary" : "neutral"}>{r.role}</Badge> },
        { key: "created_at", header: "Alta", sortable: true, render: (r) => new Date(r.created_at).toLocaleDateString("es") },
      ]}
    />
  );
}
```

La página (Server Component) es el ejemplo de la sección TableQuery. Las columnas `sortable` y
con `filter` de la tabla deben estar en `sortable`/`filterable` de `TableQuery.parse`.

**Modo server** (controlado, para traer datos desde una API o Server Action):

```jsx
const [state, setState] = useState({ data: [], total: 0, loading: true });
<DataTable
  mode="server"
  data={state.data}
  total={state.total}
  loading={state.loading}
  onQueryChange={async (q) => {          // { page, limit, search, sort, dir, filters }
    setState((s) => ({ ...s, loading: true }));
    const res = await fetch(`/api/orders?${new URLSearchParams({ page: q.page, limit: q.limit, q: q.search })}`).then((r) => r.json());
    setState({ data: res.data, total: res.total, loading: false });
  }}
  columns={columns}
/>
```

Otras props: `dense`, `striped`, `stickyHeader`, `caption`, `emptyState={<EmptyState …/>}`,
`onSelectionChange(rows)`, `searchable={false}` y `labels` para traducir textos:

```jsx
<DataTable labels={{ search: "Search…", all: "All", showing: (a, b, t) => `${a}–${b} of ${t}`, empty: "No results" }} … />
```

### Carousel

```jsx
<Carousel autoPlay={5000} loop slideClassName="basis-full sm:basis-1/2 lg:basis-1/3" gap="gap-4">
  {products.map((p) => <ProductCard key={p.id} product={p} />)}
</Carousel>
```

Usa scroll-snap nativo: swipe en táctil, trackpad, flechas del teclado, botones y puntos. El
autoplay se pausa al pasar el mouse o con foco. Props: `showArrows`, `showDots`, `label`.

### FileUpload

```jsx
<form action={uploadDocs}>
  <FileUpload
    name="files"
    label="Documentos"
    accept="image/*,.pdf"
    multiple
    maxFiles={5}
    maxSize={10 * 1024 * 1024}
    hint="PDF o imágenes, hasta 10 MB"
    error={errorFor(state?.errors, "files")}
    onFilesChange={(files) => console.log(files)}
  />
  <Button type="submit">Subir</Button>
</form>
```

Los archivos quedan en un `<input type="file" name="files">` real, así que la Server Action los
recibe con `formData.getAll("files")` y los guarda con [`Upload.save`](#-subida-de-archivos).
Las validaciones del componente son solo de UX: valida siempre en el servidor.

### Ejemplo: panel de administración

```jsx
// src/app/admin/page.js
import { StatCard, Card, CardHeader, CardBody } from "@/ui";
import { TableQuery } from "@seip/nextjs/table";
import Order from "@/models/order";
import { OrdersTable } from "./orders-table";

export default async function AdminPage({ searchParams }) {
  const query = TableQuery.parse(await searchParams, { sortable: ["created_at", "total"], filterable: ["status"], defaultSort: "created_at", defaultDir: "desc" });
  const [orders, pending] = await Promise.all([
    TableQuery.paginate(Order, query, { searchable: ["customer", "email"], filterable: ["status"] }),
    Order.count({ status: "pending" }),
  ]);
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Pedidos" value={orders.total} />
        <StatCard label="Pendientes" value={pending} trend={pending > 10 ? "down" : undefined} delta={pending > 10 ? "Revisar" : undefined} />
      </div>
      <Card>
        <CardHeader title="Pedidos" description="Busca por cliente o email" />
        <CardBody><OrdersTable data={orders.data} total={orders.total} query={query} /></CardBody>
      </Card>
    </main>
  );
}
```

---

## 🤖 IA con anti-fuga de tokens

```javascript
// src/app/api/chat/route.js
import { IA } from "@seip/nextjs/ia";

export async function POST(request) {
  const { message } = await request.json();

  const result = await IA.processChat({
    message,
    request,                     // la IP se obtiene de forma segura para las cuotas
    provider: "deepseek",        // "openai" | "claude" | "gemini"
    systemPrompt: "Eres el asistente de soporte de ACME. Responde breve y en español.",
    limitPerMinute: 6,
    limitPerDay: 30,
    cache: true,                 // misma pregunta → respuesta desde caché, sin gastar tokens
    maxMessageLength: 2000,      // más largo → 413
    options: { model: "deepseek-chat", max_tokens: 500, temperature: 0.3, timeoutMs: 20_000 },
    onLog: async ({ question, response, ip, cached, durationMs }) => {
      // await db.query("INSERT INTO chat_log ...")
    },
  });

  return Response.json(result.data, { status: result.statusCode });
  // 200 { response, cached } · 429 { error, retryAfter } · 400 / 413 { error }
  // Si el proveedor falla o no responde, devuelve 200 con options.defaultResponse (nunca expone el error).
}
```

- El mensaje del usuario va solo como mensaje `user`, nunca dentro del system prompt.
- La caché distingue proveedor, modelo y system prompt (`IA.cacheKey()`). Para compartirla entre
  procesos, pasa `cache: { get, set }` (por ejemplo sobre Redis o la base de datos).
- `systemPrompt` puede ser una función `async (pregunta) => string` para armarlo con datos (RAG simple).
- Llamadas directas: `IA.callDeepSeek(system, user, options)`, `callOpenAI`, `callClaude`, `callGemini`.

---

## 🔎 SEO: sitemap y robots

```javascript
// src/app/sitemap.js
import { Seo } from "@seip/nextjs/seo";
import Post from "@/models/post";

export default async function sitemap() {
  Seo.clear();
  Seo.discoverRoutes().forEach((r) => Seo.registerRoute(r)); // rutas estáticas de app/ (las privadas se descartan)
  Seo.registerRoute("/precios", ["es", "en"]);  // → /es/precios y /en/precios
  for (const p of await Post.all({ where: { published_at: { $notNull: true } } })) {
    Seo.registerRoute(`/blog/${p.slug}`);
  }
  return Seo.toNextSitemap();                   // usa APP_URL
}
```

```javascript
// src/app/robots.js
import { Seo } from "@seip/nextjs/seo";
export default function robots() {
  Seo.disallow(["/checkout", "/cuenta/*"]);     // se suman a /api, /dashboard, /admin, /login…
  return Seo.toNextRobots();
}
```

Sin Next (o para generar archivos estáticos): `npx seip make:seo` escribe `public/sitemap.xml` y
`public/robots.txt`.

---

## 🔌 WebSocket

```javascript
// server/ws.js  (make:ecosystem lo detecta y crea la app "<nombre>-ws" en PM2)
import { WebSocketManager } from "@seip/nextjs/ws";

const wsm = new WebSocketManager({
  port: Number(process.env.WS_PORT) || 3001,  // escucha en 127.0.0.1; nginx publica /ws
  auth: true,                                 // token en ?token=, Bearer o cookie "auth"
  allowedOrigins: ["https://midominio.com"],
});

wsm.onConnection((ws) => {
  ws.join(`user:${ws.user.id}`);
  ws.on("message", (raw) => { /* ... */ });
});

wsm.broadcast({ type: "notification", text: "Hola" }, "user:42"); // solo a esa sala
wsm.broadcast({ type: "deploy" });                                  // a todos
```

En el navegador: `new WebSocket("wss://midominio.com/ws")` (la cookie `auth` se envía sola en el
mismo dominio). Desde el CLI: `npx seip ws:start 3001 --auth`.

---

## ⚙️ Config y modo desktop

```javascript
import { Config } from "@seip/nextjs/config";

Config.appDir();       // raíz de la app (APP_DIR o cwd)
Config.userDataDir();  // carpeta escribible: cwd en VPS, userData en Electron
Config.isDesktop();    // true en Electron / DESKTOP_MODE=true
Config.props();        // { debug, desktop, title, appUrl, port, ... }
```

En desktop, la base SQLite, los uploads y las sesiones revocadas se guardan en `userDataDir`
(nunca dentro del `.asar`, que es de solo lectura). Si la base no existe en el primer arranque,
se copia la plantilla empaquetada.

---

## 💻 CLI

`npx seip <comando>` (también `npx seip-next` o `npx @seip/nextjs`).

```bash
# Modelos y migraciones
npx seip make:model User
npx seip make:migration [nombre] [--yes]
npx seip migrate
npx seip migrate:status
npx seip migrate:rollback

# Seeds
npx seip make:seed users
npx seip seed [--force]

# UI
npx seip make:ui [componentes...] [--list] [--dir=src/ui] [--force]

# SEO y WebSocket
npx seip make:seo
npx seip ws:start 3001 --auth

# VPS
npx seip make:ecosystem [--start]
npx seip nginx:conf midominio.com 3000 /var/www/proyecto
npx seip nginx:conf midominio.com --ssl [--www | --no-www] [--with-ws]

# Desktop
npx seip make:desktop
```

---

## 🚀 Despliegue en VPS (PM2 + Nginx)

```bash
# En el servidor (Ubuntu/Debian), con Node 22+ y PM2 instalados
git clone <repo> /var/www/proyecto && cd /var/www/proyecto
npm ci
cp .env.example .env && nano .env           # JWT_SECRET, DATABASE_URL, APP_URL…
npx seip migrate
npm run build

npx seip make:ecosystem --start              # genera ecosystem.config.cjs y arranca con PM2
pm2 save && pm2 startup

npx seip nginx:conf midominio.com 3000 /var/www/proyecto   # config HTTP + pasos de Certbot
sudo certbot --nginx -d midominio.com
npx seip nginx:conf midominio.com --ssl                    # config HTTPS final
```

- `ecosystem.config.cjs` lee `.env` cuando PM2 lo carga (no copia secretos al archivo). Tras editar
  `.env`: `pm2 reload ecosystem.config.cjs --update-env`.
- Next escucha en `127.0.0.1`: solo nginx es público.
- Con `output: "standalone"` se define `APP_DIR` con la raíz del proyecto, así la BD, los uploads y
  las sesiones revocadas no quedan dentro de `.next/standalone` (que se borra en cada build).
  Recuerda [`registerModule`](#output-standalone-con-un-driver-opcional) si usas `pg`/`mysql2`.
- La config de nginx incluye gzip, límite de 100 MB, caché inmutable de `/_next/static`, sirve
  `public/` (uploads incluidos) y opcionalmente `/ws`.

Actualizar: `git pull && npm ci && npx seip migrate && npm run build && pm2 reload all`.

---

## 🖥️ Aplicación de escritorio (Electron)

La app de escritorio ejecuta el servidor standalone de Next.js dentro de Electron y abre una
ventana apuntando a él. Toda tu app (Server Actions, Auth, SQLite) funciona igual que en la web.

1. `next.config.mjs`:
   ```javascript
   export default { output: "standalone" };
   ```
2. Genera el scaffold: `npx seip make:desktop` (crea `desktop/`).
3. Genera la plantilla de BD y compila la web: `npx seip migrate && npm run build`.
   `database/app.db` se empaqueta como plantilla y se copia a la carpeta de datos del usuario
   (`app.getPath("userData")`) en el primer arranque.
4. Construye el instalador:
   ```bash
   cd desktop
   npm install
   npm run build:win        # Windows Setup (.exe, NSIS)
   npm run build:portable   # Windows Portable (.exe autónomo)
   npm run build:mac        # macOS (.zip)
   npm run build:linux      # Linux (AppImage / tar.gz)
   npm run build:all        # todas las plataformas
   ```

Desarrollo:

```bash
npm run dev                  # en la raíz: Next en http://localhost:3000
cd desktop && npm run dev    # Electron abre DEV_URL (http://localhost:3000)
cd desktop && npm start      # prueba el servidor empaquetado sin generar instalador
```

Qué hace el scaffold (y por qué):
- **Electron + electron-builder directamente**, sin Nextron: la interfaz es el servidor standalone,
  no hace falta una carpeta `renderer/`.
- **Electron 45** (Node 22+): necesario para `node:sqlite`. Electron 34 trae Node 20 y la app se
  quedaba sin base de datos.
- El servidor corre en un `utilityProcess`, escucha **solo en `127.0.0.1`** (vía `HOSTNAME`, que
  es lo que lee el `server.js` de Next) en un puerto libre, y la ventana se abre cuando responde.
- Cada instalación genera su propio **`JWT_SECRET`** en userData (no viaja en el instalador).
- Una sola instancia a la vez; los links externos se abren en el navegador del sistema.
- `prepare-server` copia `.next/static` y `public/` al standalone y avisa si encuentra addons
  nativos que no funcionan con el ABI de Electron (`better-sqlite3`). Los defaults
  (`node:sqlite` + `scrypt`) no usan ninguno.

Para firmar los instaladores (recomendado en Windows y obligatorio para distribuir en macOS),
configura `build.win.certificateFile` / `build.mac.identity` en `desktop/package.json` según la
documentación de electron-builder.

---

## 🩺 Next.js 16: compatibilidad y solución de problemas

| Síntoma | Causa | Solución |
| --- | --- | --- |
| `Module not found: Can't resolve 'bcrypt'` (o `pg`, `mysql2`, `multer`) al compilar | 0.0.3 importaba los opcionales de forma estática | Actualiza a 0.0.4. Quita `serverExternalPackages: ["@seip/nextjs"]`. |
| `Classes or null prototypes are not supported` al prerenderizar | Filas de `node:sqlite` con prototipo nulo (0.0.3) | Actualiza a 0.0.4: las filas ya son objetos planos. |
| Login responde 200 pero no llega la cookie | El paquete estaba en `serverExternalPackages`, o se llamó `login()` desde un Server Component | Quita `serverExternalPackages`. Llama a `login()` desde una Server Action o Route Handler. Revisa el `console.warn` y `cookieSet`. |
| Request con `Authorization: Bearer` pasa el proxy pero la ruta da 401 | `Auth.user()` solo leía cookies (0.0.3) | Actualiza a 0.0.4. |
| En standalone: `'pg' package is not installed` | El driver no se copió a `.next/standalone` | Usa `registerModule("pg", pg)`. |
| `ExperimentalWarning: SQLite is an experimental feature` | Aviso de Node sobre `node:sqlite` | Informativo, no afecta. |
| Archivos subidos dan 404 | `next start` no sirve archivos nuevos de `public/` | Usa nginx o la ruta `Upload.serve`. |
| Server Action con archivos falla por tamaño | Límite de 1 MB | `experimental.serverActions.bodySizeLimit`. |
| `[AUTH ERROR] JWT_SECRET is not configured` | Falta la variable | Defínela (32+ caracteres en producción). |
| `useConfirm() requires <ConfirmProvider>` | Falta el provider | Envuelve el layout con `<UIProvider>`. |
| Los componentes UI se ven sin estilos | `theme.css` no importado o Tailwind v3 | `@import "tailwindcss"; @import "../ui/theme.css";` y Tailwind v4. |

Notas para Next 16:
- `proxy.js` reemplaza a `middleware.js` y corre en Node.js: `Auth.handleProxy` y `RateLimit`
  funcionan ahí sin cambios.
- `cookies()`, `headers()` y `searchParams` son asíncronos: usa `await searchParams` antes de
  `TableQuery.parse`.
- `revalidateTag(tag, "max")` se usa internamente (perfil requerido en Next 16).
- Turbopack es el bundler por defecto en `dev` y `build`: el paquete compila sin configuración.

---

## 🆕 Novedades 0.0.4

**Correcciones**
- El build con Turbopack ya no falla si `bcrypt`, `pg`, `mysql2`, `better-sqlite3`, `multer` o `ws`
  no están instalados. `serverExternalPackages` ya no es necesario (y conviene quitarlo).
- `node:sqlite` devuelve objetos planos: se pueden pasar a Client Components.
- `Auth.login`/`Auth.logout` avisan con `console.warn` cuando no pueden escribir la cookie;
  `login()` devuelve `cookieSet`.
- `Auth.user()` acepta `Authorization: Bearer`, igual que `handleProxy`.
- `make:desktop` reescrito: Electron 45 sin Nextron, `utilityProcess`, servidor solo en
  `127.0.0.1`, `JWT_SECRET` por instalación, plantilla de BD y espera real a que el servidor responda.

**Nuevo**
- `registerModule()` para usar drivers opcionales con `output: "standalone"`.
- `TableQuery` (`@seip/nextjs/table`): búsqueda, filtros, orden y paginación seguros desde la URL.
- `npx seip make:ui`: componentes con Tailwind v4 (DataTable, Toast, Snackbar, Modal, Confirm,
  Drawer, Tabs, Dropdown, Pagination, Carousel, FileUpload, Input, Select, Checkbox, Switch, Card,
  StatCard, Badge, Alert, Tooltip, Accordion, Skeleton, Spinner, EmptyState).

---

## 📄 Licencia

MIT © Seip25
