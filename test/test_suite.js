import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  Config,
  Hash,
  Validator,
  Auth,
  RateLimit,
  IA,
  Seo,
  Upload,
  Database,
  Model,
  escapeXss,
} from "../index.js";

test("Config: props and desktop detection", () => {
  const props = Config.props();
  assert.ok(props.port);
  assert.ok(props.appDir);
  assert.equal(typeof Config.isDesktop(), "boolean");
});

test("Hash: scrypt hashing and verification", async () => {
  const password = "SuperSecretPassword123!";
  const hash = await Hash.make(password);
  assert.ok(hash.startsWith("$scrypt$"));

  const isValid = await Hash.verify(password, hash);
  assert.equal(isValid, true);

  const isInvalid = await Hash.verify("WrongPassword", hash);
  assert.equal(isInvalid, false);

  assert.equal(Hash.needsRehash(hash), false);
});

test("Validator: validates rules and escapes XSS", async () => {
  const validator = new Validator({
    name: { required: true, min: 3, xss: true },
    email: { required: true, email: true },
    age: { number: true },
  }, "es");

  const invalid = await validator.validate({ name: "Jo", email: "invalid-email" });
  assert.equal(invalid.success, false);
  assert.equal(invalid.errors.length, 2);

  const valid = await validator.validate({
    name: "<b>Martin</b>",
    email: "martin@example.com",
    age: 28,
  });
  assert.equal(valid.success, true);
  assert.equal(valid.data.name, "&lt;b&gt;Martin&lt;&#x2F;b&gt;");
});

test("Auth: AES-256-GCM encrypted JWT and proxy handler", async () => {
  process.env.JWT_SECRET = "12345678901234567890123456789012";
  const userPayload = { id: 101, username: "seip", role: "admin" };

  const token = Auth.generateToken(userPayload, process.env.JWT_SECRET, "1h");
  assert.ok(token);

  const decoded = Auth.verifyToken(token, process.env.JWT_SECRET);
  assert.equal(decoded.id, 101);
  assert.equal(decoded.username, "seip");

  // Test handleProxy: unauthenticated on protected route
  const fakeReqUnauth = {
    url: "http://localhost:3000/dashboard",
    pathname: "/dashboard",
    cookies: { get: () => null },
    headers: { get: () => null },
  };
  const responseUnauth = await Auth.handleProxy(fakeReqUnauth, {
    protectedRoutes: ["/dashboard"],
    redirectToLogin: "/login",
  });
  assert.ok(responseUnauth);
  assert.equal(responseUnauth.status, 307);
  assert.ok(responseUnauth.headers.get("location").includes("/login"));

  // Test handleProxy: authenticated on guest-only route
  const fakeReqAuth = {
    url: "http://localhost:3000/login",
    pathname: "/login",
    cookies: { get: () => ({ value: token }) },
    headers: { get: () => null },
  };
  const responseGuest = await Auth.handleProxy(fakeReqAuth, {
    guestOnlyRoutes: ["/login"],
    redirectToDashboard: "/dashboard",
  });
  assert.ok(responseGuest);
  assert.equal(responseGuest.status, 307);
  assert.ok(responseGuest.headers.get("location").includes("/dashboard"));
});

test("RateLimit: web check and AI anti-token-leak limiter", () => {
  RateLimit.reset();

  const fakeReq = {
    headers: { get: () => "192.168.1.100" },
  };

  const res1 = RateLimit.check(fakeReq, { max: 2, windowMs: 10000 });
  assert.equal(res1.exceeded, false);

  const res2 = RateLimit.check(fakeReq, { max: 2, windowMs: 10000 });
  assert.equal(res2.exceeded, false);

  const res3 = RateLimit.check(fakeReq, { max: 2, windowMs: 10000 });
  assert.equal(res3.exceeded, true);
  assert.ok(res3.response);
  assert.equal(res3.response.status, 429);

  // AI limiter test
  RateLimit.reset();
  for (let i = 0; i < 3; i++) {
    const aiCheck = RateLimit.checkAI({ key: "user-123", limitPerMinute: 3 });
    assert.equal(aiCheck.exceeded, false);
  }
  const aiBlocked = RateLimit.checkAI({ key: "user-123", limitPerMinute: 3 });
  assert.equal(aiBlocked.exceeded, true);
  assert.equal(aiBlocked.type, "minute");
});

test("Seo: intelligent route filtering excludes protected routes", () => {
  Seo.clear();

  Seo.registerRoute("/");
  Seo.registerRoute("/servicios");
  Seo.registerRoute("/contacto");

  // Attempt to register protected / sensitive routes
  Seo.registerRoute("/dashboard");
  Seo.registerRoute("/admin/users");
  Seo.registerRoute("/api/chat");
  Seo.registerRoute("/login");

  const routes = Seo.getRoutes();
  assert.ok(routes.includes("/"));
  assert.ok(routes.includes("/servicios"));
  assert.ok(routes.includes("/contacto"));
  assert.ok(!routes.includes("/dashboard"));
  assert.ok(!routes.includes("/admin/users"));
  assert.ok(!routes.includes("/api/chat"));
  assert.ok(!routes.includes("/login"));

  const robots = Seo.generateRobots("https://project.com");
  assert.ok(robots.includes("Disallow: /dashboard/"));
  assert.ok(robots.includes("Disallow: /admin/"));
  assert.ok(robots.includes("Disallow: /api/"));
  assert.ok(robots.includes("Sitemap: https://project.com/sitemap.xml"));

  const sitemap = Seo.generateSitemap("https://project.com");
  assert.ok(sitemap.includes("<loc>https://project.com/</loc>"));
  assert.ok(!sitemap.includes("/dashboard"));
});

test("IA: cache hit, custom systemPrompt and decoupled onLog hook", async () => {
  IA.cache.clear();

  const userQuestion = "Cual es el horario de atencion?";
  const answer = "Atendemos de lunes a viernes de 9 a 18 hs.";

  // Pre-populate in-memory cache
  const year = new Date().getFullYear();
  IA.cache.set(`${year}-${userQuestion.toLowerCase()}`, answer);

  let loggedItem = null;

  const result = await IA.processChat({
    message: userQuestion,
    ip: "10.0.0.1",
    systemPrompt: "Eres un bot de prueba.",
    onLog: async (entry) => {
      loggedItem = entry;
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.data.response, answer);
  assert.equal(result.data.cached, true);
  assert.ok(loggedItem);
  assert.equal(loggedItem.question, userQuestion);
  assert.equal(loggedItem.cached, true);
});

test("Database & Model: in-memory SQLite, DDL, and CRUD", async () => {
  const db = new Database(1, 0, { DB_TYPE: "sqlite", DB_FILE: ":memory:" });
  const initialized = await db.init();
  assert.equal(initialized, true);

  class Product extends Model {
    static table = "products";
    static schema = {
      id: { type: "int", primary: true, auto: true },
      title: { type: "string", length: 100, required: true },
      price: { type: "float", default: 0.0 },
      secret_code: { type: "string", hash: true, hidden: true },
    };
  }

  Product.setDatabase(db);

  const ddl = Product.toDDL("sqlite");
  assert.ok(ddl.includes("CREATE TABLE IF NOT EXISTS products"));

  await db.query(ddl);

  // Test Create
  const id = await Product.create({
    title: "Laptop Pro",
    price: 1299.99,
    secret_code: "1234",
  });
  assert.ok(id);

  // Test Find
  const item = await Product.find(id);
  assert.equal(item.title, "Laptop Pro");
  assert.equal(item.price, 1299.99);
  assert.equal(item.secret_code, undefined); // hidden field

  // Test Update
  const updatedCount = await Product.update(id, { price: 1199.99 });
  assert.equal(updatedCount, 1);

  const updatedItem = await Product.find(id);
  assert.equal(updatedItem.price, 1199.99);

  // Test Count and Exists
  const count = await Product.count();
  assert.equal(count, 1);
  const exists = await Product.exists({ title: "Laptop Pro" });
  assert.equal(exists, true);

  await db.close();
});

test("Security: Auth refuses to sign without JWT_SECRET", () => {
  const original = process.env.JWT_SECRET;
  const originalError = console.error;
  delete process.env.JWT_SECRET;
  console.error = () => {};
  try {
    assert.throws(() => Auth.generateToken({ id: 1 }), /JWT_SECRET is not configured/);
    assert.throws(() => Auth.encrypt({ id: 1 }), /JWT_SECRET is not configured/);
    assert.equal(Auth.verifyToken("a.b.c"), null);
  } finally {
    console.error = originalError;
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  }
});

test("Security: uploads reject path traversal and dangerous extensions", async () => {
  assert.throws(() => Upload.getDestination("../evil"), /Invalid upload folder/);
  assert.throws(() => Upload.getDestination("/etc"), /Invalid upload folder/);
  assert.throws(() => Upload.getDestination("a/../../b"), /Invalid upload folder/);

  const fakeHtml = {
    name: "evil.html",
    type: "text/html",
    size: 4,
    arrayBuffer: async () => new ArrayBuffer(4),
  };
  await assert.rejects(
    Upload.save(fakeHtml, { folder: "test-uploads" }),
    /not allowed for security reasons/
  );

  const tmpDir = path.join(process.cwd(), "tmp-upload-test");
  Config.setUserDataDir(tmpDir);
  try {
    const fakePng = {
      name: "photo.html",
      type: "image/png",
      size: 4,
      arrayBuffer: async () => new ArrayBuffer(4),
    };
    const saved = await Upload.save(fakePng, { folder: "test-uploads" });
    assert.ok(saved.filename.endsWith(".png"), "extension must come from the MIME type");
    assert.equal(saved.url, `/test-uploads/${saved.filename}`);
    assert.ok(fs.existsSync(saved.path));
    assert.throws(() => Upload.url("../x", "test-uploads"), /Invalid filename/);
  } finally {
    Config.setUserDataDir(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(path.join(process.cwd(), "public", "test-uploads"), {
      recursive: true,
      force: true,
    });
  }
});

test("Security: validator rejects dangerous URL schemes", async () => {
  const validator = new Validator({ u: { url: true } });
  for (const bad of [
    "javascript:alert(1)",
    "data:text/html,x",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ]) {
    const result = await validator.validate({ u: bad });
    assert.equal(result.success, false, `${bad} must be rejected`);
  }
  const ok = await validator.validate({ u: "https://example.com/a?b=1" });
  assert.equal(ok.success, true);
});

test("Model: refuses unsafe conditions instead of dropping them", async () => {
  const db = new Database(1, 0, { DB_TYPE: "sqlite", DB_FILE: ":memory:" });
  await db.init();

  class Doc extends Model {
    static table = "docs";
    static schema = {
      id: { type: "int", primary: true, auto: true },
      title: { type: "string" },
    };
  }
  Doc.setDatabase(db);

  try {
    await db.query(Doc.toDDL("sqlite"));

    await assert.rejects(Doc.update({}, { title: "x" }), /without WHERE conditions/);
    await assert.rejects(Doc.delete({}), /without WHERE conditions/);
    await assert.rejects(Doc.all({ where: { title: {} } }), /Empty condition object/);
    await assert.rejects(Doc.all({ where: { title: { $gtt: "x" } } }), /Unsupported condition operator/);
    await assert.rejects(Doc.all({ where: { title: { $in: "x" } } }), /requires an array/);

    const id = await Doc.create({ title: "Hola" });
    assert.ok(id);

    // A Date condition must filter (params normalized to ISO), not be dropped.
    const byDate = await Doc.all({ where: { title: new Date() } });
    assert.equal(byDate.length, 0);

    const found = await Doc.find({ title: "Hola" });
    assert.equal(found.title, "Hola");
  } finally {
    Doc.setDatabase(null);
    await db.close();
  }
});

test("Database: INSERT with literal 'returning' returns the real id", async () => {
  const db = new Database(1, 0, { DB_TYPE: "sqlite", DB_FILE: ":memory:" });
  await db.init();
  try {
    await db.query("CREATE TABLE logs (id INTEGER PRIMARY KEY AUTOINCREMENT, msg TEXT)");

    const id = await db.query("INSERT INTO logs (msg) VALUES ('returning home')");
    assert.equal(typeof id, "number");
    assert.ok(id > 0);

    const rows = await db.query("SELECT COUNT(*) as c FROM logs", [], { return_row: true });
    assert.equal(rows.c, 1);

    const id2 = await db.query("INSERT INTO logs (msg) VALUES ('plain')");
    assert.equal(id2, id + 1);
  } finally {
    await db.close();
  }
});

test("Database: DB_TYPE aliases normalized and programmatic config wins", async () => {
  const db = new Database(1, 0, {
    DB_TYPE: "pg",
    host: "10.0.0.1",
    user: "app",
    password: "secret",
    database: "db1",
    port: 6543,
  });
  try {
    assert.equal(db.type, "postgres");
    assert.equal(db.config.host, "10.0.0.1");
    assert.equal(db.config.user, "app");
    assert.equal(db.config.password, "secret");
    assert.equal(db.config.database, "db1");
    assert.equal(db.config.port, 6543);
  } finally {
    await db.close();
  }
});

test("Auth: logout revokes the session server-side", async () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "x".repeat(40);
  try {
    let stored = null;
    const cookieStore = {
      set: async (options) => {
        stored = options;
      },
      get: async () => stored,
    };

    const { token } = await Auth.login({ id: 7, role: "user" }, { cookieStore });
    assert.ok(Auth.verifyToken(token));

    await Auth.logout({ cookieStore });
    assert.equal(Auth.verifyToken(token), null);
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  }
});

test("Auth: malformed cookie does not crash handleProxy", async () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "y".repeat(40);
  try {
    const response = await Auth.handleProxy(
      {
        url: "http://localhost:3000/dashboard",
        pathname: "/dashboard",
        headers: { get: (header) => (header === "cookie" ? "auth=%zz" : null) },
      },
      { protectedRoutes: ["/dashboard"] }
    );
    assert.ok(response);
    assert.equal(response.status, 307);
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  }
});

test("Database: nested transactions use savepoints", async () => {
  const db = new Database(1, 0, { DB_TYPE: "sqlite", DB_FILE: ":memory:" });
  await db.init();
  try {
    await db.query("CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");

    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO items (name) VALUES (?)", ["outer"]);
      await db.transaction(async (tx2) => {
        await tx2.query("INSERT INTO items (name) VALUES (?)", ["inner"]);
      });
    });

    let rows = await db.query("SELECT name FROM items ORDER BY id");
    assert.deepEqual(rows.map((r) => r.name), ["outer", "inner"]);

    // An inner failure must roll back only the inner work.
    await db.transaction(async (tx) => {
      await tx.query("INSERT INTO items (name) VALUES (?)", ["outer2"]);
      await db
        .transaction(async () => {
          throw new Error("boom");
        })
        .catch(() => {});
    });

    rows = await db.query("SELECT name FROM items ORDER BY id");
    assert.deepEqual(rows.map((r) => r.name), ["outer", "inner", "outer2"]);
  } finally {
    await db.close();
  }
});

test("Database: concurrent SQLite transactions are serialized", async () => {
  const db = new Database(1, 0, { DB_TYPE: "sqlite", DB_FILE: ":memory:" });
  await db.init();
  try {
    await db.query("CREATE TABLE counter (id INTEGER PRIMARY KEY AUTOINCREMENT, v TEXT)");

    const results = await Promise.all([
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO counter (v) VALUES (?)", ["a"]);
        return "a";
      }),
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO counter (v) VALUES (?)", ["b"]);
        return "b";
      }),
    ]);
    assert.deepEqual(results, ["a", "b"]);

    const rows = await db.query("SELECT COUNT(*) as n FROM counter", [], { return_row: true });
    assert.equal(rows.n, 2);
  } finally {
    await db.close();
  }
});
