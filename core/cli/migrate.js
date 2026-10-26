import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import readline from "node:readline/promises";
import colors from "../util/colors.js";
import { Database, database, DB_TYPE } from "../database.js";
import { detectModelsDir } from "./model.js";

async function promptConfirm(question, defaultYes = true) {
  if (!process.stdin.isTTY) return defaultYes;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(colors.cyan(question));
    const trimmed = answer.trim().toLowerCase();
    if (!trimmed) return defaultYes;
    return ["y", "yes", "s", "si", "true", "1"].includes(trimmed);
  } finally {
    rl.close();
  }
}

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const mins = pad(now.getMinutes());
  const secs = pad(now.getSeconds());
  return `${year}${month}${day}_${hours}${mins}${secs}`;
}

export function splitSqlStatements(sqlText) {
  const statements = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inComment = false;

  for (let i = 0; i < sqlText.length; i++) {
    const char = sqlText[i];
    const nextChar = sqlText[i + 1];

    if (inComment) {
      if (char === "\n" || char === "\r") inComment = false;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && char === "-" && nextChar === "-") {
      inComment = true;
      i++;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && nextChar === "'") {
        current += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      if (inDoubleQuote && nextChar === '"') {
        current += '""';
        i++;
        continue;
      }
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }

    if (char === ";" && !inSingleQuote && !inDoubleQuote) {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = "";
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) statements.push(trimmed);
  return statements;
}

export async function inspectDatabaseSchema(db, tableName) {
  try {
    if (db.type === "sqlite") {
      const rows = (await db.query(`PRAGMA table_info("${tableName}")`)) || [];
      if (!Array.isArray(rows) || rows.length === 0) return { exists: false, columns: [] };
      return { exists: true, columns: rows.map((r) => r.name) };
    }
    if (db.type === "mysql") {
      const rows = (await db.query(`SHOW COLUMNS FROM \`${tableName}\``)) || [];
      if (!Array.isArray(rows) || rows.length === 0) return { exists: false, columns: [] };
      return { exists: true, columns: rows.map((r) => r.Field) };
    }
    if (db.type === "postgres") {
      const rows =
        (await db.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ?",
          [tableName]
        )) || [];
      if (!Array.isArray(rows) || rows.length === 0) return { exists: false, columns: [] };
      return { exists: true, columns: rows.map((r) => r.column_name) };
    }
  } catch {
    return { exists: false, columns: [] };
  }
  return { exists: false, columns: [] };
}

export async function loadAllModels() {
  const modelsDir = detectModelsDir();
  if (!fs.existsSync(modelsDir)) return [];

  const files = fs
    .readdirSync(modelsDir)
    .filter((f) => (f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".ts")) && !f.endsWith(".d.ts"));

  const loaded = [];
  for (const file of files) {
    const modelPath = path.join(modelsDir, file);
    try {
      const mod = await import(pathToFileURL(modelPath).href);
      const ModelClass = mod.default || mod[Object.keys(mod)[0]];
      if (ModelClass && typeof ModelClass.toDDL === "function" && ModelClass.table) {
        loaded.push({
          name: ModelClass.name || path.basename(file, path.extname(file)),
          ModelClass,
        });
      }
    } catch (err) {
      console.warn(colors.yellow(`[WARN] Could not load model ${file}: ${err.message}`));
    }
  }

  return loaded;
}

export async function detectModelDiffs(db, models) {
  const missingTables = [];
  const missingColumns = [];

  for (const { ModelClass } of models) {
    const tableName = ModelClass.table;
    const { exists, columns } = await inspectDatabaseSchema(db, tableName);

    if (!exists) {
      missingTables.push({
        ModelClass,
        ddl: ModelClass.toDDL(db.type),
      });
      continue;
    }

    const existingSet = new Set(columns.map((c) => c.toLowerCase()));
    const schema = ModelClass.schema || {};

    for (const [col, def] of Object.entries(schema)) {
      if (!existingSet.has(col.toLowerCase())) {
        missingColumns.push({
          table: tableName,
          col,
          def,
          sql: ModelClass.columnToSQL(col, def, db.type),
        });
      }
    }

    if (ModelClass.timestamps) {
      if (!existingSet.has("created_at") && !schema.created_at) {
        const sql =
          db.type === "mysql"
            ? "created_at DATETIME DEFAULT CURRENT_TIMESTAMP"
            : "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP";
        missingColumns.push({ table: tableName, col: "created_at", def: {}, sql });
      }
      if (!existingSet.has("updated_at") && !schema.updated_at) {
        const sql =
          db.type === "mysql"
            ? "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
            : "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP";
        missingColumns.push({ table: tableName, col: "updated_at", def: {}, sql });
      }
    }

    if (ModelClass.softDelete && !existingSet.has("deleted_at") && !schema.deleted_at) {
      const sql = db.type === "mysql" ? "deleted_at DATETIME NULL" : "deleted_at TIMESTAMP NULL";
      missingColumns.push({ table: tableName, col: "deleted_at", def: {}, sql });
    }
  }

  return { missingTables, missingColumns };
}

export async function ensureMigrationsTable(db) {
  let ddl = "";
  if (db.type === "postgres") {
    ddl = `CREATE TABLE IF NOT EXISTS _seip_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      batch INT NOT NULL,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;
  } else if (db.type === "mysql") {
    ddl = `CREATE TABLE IF NOT EXISTS _seip_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      batch INT NOT NULL,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;
  } else {
    ddl = `CREATE TABLE IF NOT EXISTS _seip_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      batch INTEGER NOT NULL,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`;
  }
  await db.query(ddl);
}

export async function makeMigration(name, modelName = null, autoRun = false) {
  const migrationsDir = path.resolve(process.cwd(), "database/migrations");
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  const db = database;
  await db.init();

  const targetModels = await loadAllModels();
  const { missingTables, missingColumns } = await detectModelDiffs(db, targetModels);
  const hasDiffs = missingTables.length > 0 || missingColumns.length > 0;

  const cleanName = name ? name.toLowerCase().replace(/[^a-z0-9_]/g, "_") : "";

  if (!hasDiffs && !cleanName) {
    console.log(colors.green("[INFO] All models are already synchronized with the database."));
    return;
  }

  if (hasDiffs) {
    const upBlocks = [];
    const downBlocks = [];

    console.log(colors.cyan("\n[INFO] Detected database schema changes:"));
    for (const { ModelClass, ddl } of missingTables) {
      console.log(colors.green(`  + CREATE TABLE: ${ModelClass.table}`));
      upBlocks.push(ddl);
      downBlocks.unshift(`DROP TABLE IF EXISTS ${ModelClass.table};`);
    }

    for (const { table, col, sql } of missingColumns) {
      console.log(colors.green(`  + ADD COLUMN:   ${table}.${col}`));
      upBlocks.push(`ALTER TABLE ${table} ADD COLUMN ${sql};`);
      downBlocks.unshift(`ALTER TABLE ${table} DROP COLUMN ${col};`);
    }

    const migrationTitle = cleanName || "auto_migration";
    const filename = `${getTimestamp()}_${migrationTitle}.sql`;
    const filePath = path.join(migrationsDir, filename);

    const template = `-- =============================================================\n-- Migration: ${migrationTitle}\n-- Driver: ${db.type}\n-- Created: ${new Date().toISOString()}\n-- =============================================================\n\n-- Up\n${upBlocks.join("\n\n")}\n\n-- Down\n${downBlocks.join("\n")}\n`;

    fs.writeFileSync(filePath, template, "utf-8");
    console.log(colors.bold.green(`\n[OK] Migration created: database/migrations/${filename}\n`));

    const shouldRun = autoRun || (await promptConfirm("? Do you want to execute pending migrations now? (Y/n): ", true));
    if (shouldRun) {
      await runMigrations(false);
    }
    return;
  }

  const filename = `${getTimestamp()}_${cleanName || "custom_migration"}.sql`;
  const filePath = path.join(migrationsDir, filename);
  const template = `-- =============================================================\n-- Migration: ${cleanName}\n-- Driver: ${db.type}\n-- Created: ${new Date().toISOString()}\n-- =============================================================\n\n-- Up\n\n-- Down\n`;

  fs.writeFileSync(filePath, template, "utf-8");
  console.log(colors.green(`[OK] Migration file created: database/migrations/${filename}`));
}

export async function runMigrations(exitOnFinish = true) {
  const migrationsDir = path.resolve(process.cwd(), "database/migrations");
  if (!fs.existsSync(migrationsDir)) {
    fs.mkdirSync(migrationsDir, { recursive: true });
  }

  const db = database;
  await db.init();
  await ensureMigrationsTable(db);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") || f.endsWith(".js") || f.endsWith(".mjs"))
    .sort();

  if (files.length === 0) {
    console.log(colors.yellow("[INFO] No migration files found in 'database/migrations'."));
    if (exitOnFinish) process.exit(0);
    return;
  }

  const appliedRows = (await db.query("SELECT name, batch FROM _seip_migrations ORDER BY id ASC")) || [];
  const appliedSet = new Set(appliedRows.map((r) => r.name));

  const maxBatchRow = await db.query("SELECT MAX(batch) as max_batch FROM _seip_migrations", [], { return_row: true });
  const currentBatch = ((maxBatchRow && maxBatchRow.max_batch) || 0) + 1;

  const pending = files.filter((f) => !appliedSet.has(f));

  if (pending.length === 0) {
    console.log(colors.green("[INFO] Database is up to date. No pending migrations."));
    if (exitOnFinish) process.exit(0);
    return;
  }

  console.log(colors.cyan(`[INFO] Running ${pending.length} pending migration(s) (Batch #${currentBatch})...\n`));

  for (const file of pending) {
    const filePath = path.join(migrationsDir, file);
    try {
      if (file.endsWith(".sql")) {
        const fullContent = fs.readFileSync(filePath, "utf-8");
        const upSection = fullContent.split(/--\s*Down/i)[0] || fullContent;
        const statements = splitSqlStatements(upSection);

        await db.transaction(async (tx) => {
          for (const stmt of statements) {
            await tx.query(stmt);
          }
          await tx.query(
            "INSERT INTO _seip_migrations (name, batch) VALUES (?, ?)",
            [file, currentBatch]
          );
        });
      }
      console.log(colors.green(`  [MIGRATED] ${file}`));
    } catch (err) {
      console.error(colors.red(`  [FAILED]   ${file}: ${err.message}`));
      if (exitOnFinish) process.exit(1);
      return;
    }
  }

  console.log(colors.bold.green("\n[OK] All pending migrations executed successfully."));
  if (exitOnFinish) process.exit(0);
}

export async function rollbackMigrations() {
  const migrationsDir = path.resolve(process.cwd(), "database/migrations");
  const db = database;
  await db.init();
  await ensureMigrationsTable(db);

  const maxBatchRow = await db.query("SELECT MAX(batch) as max_batch FROM _seip_migrations", [], { return_row: true });
  const lastBatch = maxBatchRow?.max_batch;

  if (!lastBatch) {
    console.log(colors.yellow("[INFO] No migrations found to rollback."));
    return;
  }

  const batchRows = (await db.query("SELECT name FROM _seip_migrations WHERE batch = ? ORDER BY id DESC", [lastBatch])) || [];
  console.log(colors.cyan(`[INFO] Rolling back Batch #${lastBatch} (${batchRows.length} migration(s))...\n`));

  for (const row of batchRows) {
    const file = row.name;
    const filePath = path.join(migrationsDir, file);

    try {
      if (fs.existsSync(filePath) && file.endsWith(".sql")) {
        const content = fs.readFileSync(filePath, "utf-8");
        const downParts = content.split(/--\s*Down/i);
        if (downParts.length > 1) {
          const downStatements = splitSqlStatements(downParts[1]);
          await db.transaction(async (tx) => {
            for (const stmt of downStatements) {
              await tx.query(stmt);
            }
            await tx.query("DELETE FROM _seip_migrations WHERE name = ?", [file]);
          });
        } else {
          await db.query("DELETE FROM _seip_migrations WHERE name = ?", [file]);
        }
      } else {
        await db.query("DELETE FROM _seip_migrations WHERE name = ?", [file]);
      }
      console.log(colors.green(`  [ROLLED BACK] ${file}`));
    } catch (err) {
      console.error(colors.red(`  [FAILED]      ${file}: ${err.message}`));
      process.exit(1);
    }
  }

  console.log(colors.bold.green("\n[OK] Rollback completed successfully."));
}

export async function showMigrationStatus() {
  const migrationsDir = path.resolve(process.cwd(), "database/migrations");
  if (!fs.existsSync(migrationsDir)) {
    console.log(colors.yellow("[INFO] No 'database/migrations' directory found."));
    return;
  }

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const db = database;
  await db.init();
  await ensureMigrationsTable(db);

  const appliedRows = (await db.query("SELECT name, batch, executed_at FROM _seip_migrations ORDER BY id ASC")) || [];
  const appliedMap = new Map(appliedRows.map((r) => [r.name, r]));

  console.log(colors.bold.cyan("\n============================================================="));
  console.log(colors.bold.cyan(" Database Migrations Status"));
  console.log(colors.bold.cyan("=============================================================\n"));

  for (const file of files) {
    if (appliedMap.has(file)) {
      const record = appliedMap.get(file);
      console.log(`  ${colors.green("[APPLIED]")}  ${file.padEnd(40)} (Batch: ${record.batch}, At: ${record.executed_at})`);
    } else {
      console.log(`  ${colors.yellow("[PENDING]")}  ${file}`);
    }
  }
  console.log("");
}

export function makeSeed(name) {
  if (!name) {
    console.log(colors.red("[ERROR] Missing seed name."));
    console.log("Usage: npx @seip/next make:seed <name>");
    process.exit(1);
  }

  const cleanName = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const seedsDir = path.resolve(process.cwd(), "database/seeds");
  if (!fs.existsSync(seedsDir)) fs.mkdirSync(seedsDir, { recursive: true });

  const filePath = path.join(seedsDir, `${cleanName}.sql`);
  const template = `-- Seed: ${cleanName}\n-- INSERT INTO ${cleanName} (name) VALUES ('Sample 1');\n`;
  fs.writeFileSync(filePath, template, "utf-8");
  console.log(colors.green(`[OK] Seed file created: database/seeds/${cleanName}.sql`));
}

export async function runSeeds() {
  const seedsDir = path.resolve(process.cwd(), "database/seeds");
  if (!fs.existsSync(seedsDir)) {
    console.log(colors.yellow("[INFO] No seeds found in database/seeds."));
    return;
  }

  const files = fs.readdirSync(seedsDir).filter((f) => f.endsWith(".sql")).sort();
  const db = database;
  await db.init();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(seedsDir, file), "utf-8");
    const stmts = splitSqlStatements(sql);
    await db.transaction(async (tx) => {
      for (const s of stmts) await tx.query(s);
    });
    console.log(colors.green(`  [SEEDED] ${file}`));
  }
  console.log(colors.bold.green("\n[OK] All seeds executed."));
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith("migrate.js") ||
  process.argv[1].endsWith("migrate")
);

if (isMain) {
  const rawArgs = process.argv.slice(2);
  const cmd = rawArgs[0];
  const autoYes = rawArgs.includes("--yes") || rawArgs.includes("-y");

  if (cmd === "make:migration") {
    const name = rawArgs.find((a, i) => i > 0 && !a.startsWith("-"));
    await makeMigration(name, null, autoYes);
  } else if (cmd === "migrate:status") {
    await showMigrationStatus();
  } else if (cmd === "migrate:rollback") {
    await rollbackMigrations();
  } else if (cmd === "make:seed") {
    makeSeed(rawArgs[1]);
  } else if (cmd === "seed") {
    await runSeeds();
  } else {
    await runMigrations(true);
  }
}
