import test from "node:test";
import assert from "node:assert/strict";
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
