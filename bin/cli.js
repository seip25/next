#!/usr/bin/env node

import colors from "../core/util/colors.js";
import { loadEnvFiles } from "../core/util/env.js";

// Load .env BEFORE importing the database module: it reads DB_TYPE / DATABASE_URL at import time.
loadEnvFiles();

const {
  makeModel,
} = await import("../core/cli/model.js");
const {
  makeMigration,
  runMigrations,
  rollbackMigrations,
  showMigrationStatus,
  makeSeed,
  runSeeds,
} = await import("../core/cli/migrate.js");
const { makeEcosystem } = await import("../core/cli/ecosystem.js");
const { generateNginxConfig } = await import("../core/cli/nginx.js");
const { makeDesktop } = await import("../core/cli/desktop.js");
const { makeSeo } = await import("../core/cli/seo.js");
const { makeUi } = await import("../core/cli/ui.js");
const { Database } = await import("../core/database.js");

const args = process.argv.slice(2);
// Allow global flags before the command, e.g. `--yes migrate`.
const command = args.find((arg) => !arg.startsWith("-"));
const positional = args.filter((arg) => !arg.startsWith("-") && arg !== command);

function showHelp() {
  console.log(colors.bold.cyan("\n============================================================="));
  console.log(colors.bold.cyan(" @seip/nextjs CLI - Production Toolkit for Next.js & Desktop"));
  console.log(colors.bold.cyan("=============================================================\n"));

  console.log(colors.bold("Comandos disponibles:\n"));

  console.log(colors.green("  make:model <Name>         ") + colors.gray("Crea un modelo en src/models o app/models"));
  console.log(colors.green("  make:migration [name]     ") + colors.gray("Genera migración SQL comparando modelos con la BD"));
  console.log(colors.green("  migrate                   ") + colors.gray("Ejecuta migraciones pendientes"));
  console.log(colors.green("  migrate:status            ") + colors.gray("Muestra el estado de migraciones aplicadas"));
  console.log(colors.green("  migrate:rollback          ") + colors.gray("Revierte el último lote de migraciones"));
  console.log(colors.green("  make:seed <name>          ") + colors.gray("Crea un archivo de seed en database/seeds/"));
  console.log(colors.green("  seed [--force]            ") + colors.gray("Ejecuta los seeds pendientes (--force re-ejecuta todos)"));
  console.log(colors.green("  make:ecosystem            ") + colors.gray("Genera ecosystem.config.cjs para PM2 en VPS"));
  console.log(colors.green("  nginx:conf [domain]       ") + colors.gray("Genera configuración Nginx y comandos Certbot"));
  console.log(colors.green("  make:desktop              ") + colors.gray("Scaffold de Electron (Win, Mac, Linux, Portable)"));
  console.log(colors.green("  make:seo                  ") + colors.gray("Genera sitemap.xml y robots.txt con filtro"));
  console.log(colors.green("  make:ui [comp...] [--force]") + colors.gray(" Copia componentes UI (Tailwind v4) a src/ui (--list, --dir=ruta)"));
  console.log(colors.green("  ws:start [port] [--auth]   ") + colors.gray("Inicia el servidor WebSocket independiente (--auth exige token)"));
  console.log("");
}

async function run() {
  if (!command || command === "--help" || command === "-h" || command === "help") {
    showHelp();
    process.exit(0);
  }

  const autoYes = args.includes("--yes") || args.includes("-y");

  switch (command) {
    case "make:model":
    case "model": {
      makeModel(positional[0]);
      break;
    }
    case "make:migration": {
      await makeMigration(positional[0], null, autoYes);
      break;
    }
    case "migrate": {
      await runMigrations(true);
      break;
    }
    case "migrate:status": {
      await showMigrationStatus();
      break;
    }
    case "migrate:rollback": {
      await rollbackMigrations();
      break;
    }
    case "make:seed": {
      makeSeed(positional[0]);
      break;
    }
    case "seed": {
      await runSeeds(args.includes("--force"));
      break;
    }
    case "make:ecosystem":
    case "ecosystem": {
      makeEcosystem();
      break;
    }
    case "nginx:conf":
    case "nginx": {
      generateNginxConfig();
      break;
    }
    case "make:desktop":
    case "desktop": {
      makeDesktop();
      break;
    }
    case "make:ui":
    case "ui": {
      const dirArg = args.find((arg) => arg.startsWith("--dir="));
      makeUi(positional, {
        force: args.includes("--force"),
        list: args.includes("--list"),
        dir: dirArg ? dirArg.slice("--dir=".length) : undefined,
      });
      break;
    }
    case "make:seo":
    case "seo": {
      makeSeo();
      break;
    }
    case "ws:start": {
      const { WebSocketManager } = await import("../core/ws.js");
      const portArg = args.find((arg) => /^\d+$/.test(arg)) || process.env.WS_PORT || "3001";
      const port = parseInt(portArg, 10);
      const auth = args.includes("--auth") || process.env.WS_AUTH === "true";
      new WebSocketManager({ port, auth });
      // Long-running server: do not close connections / exit.
      return { keepAlive: true };
    }
    default: {
      console.log(colors.red(`[ERROR] Comando desconocido: '${command}'\n`));
      showHelp();
      process.exit(1);
    }
  }
}

run()
  .then(async (result) => {
    if (result?.keepAlive) return;
    // Open pg/mysql pools keep the event loop alive: close them so the CLI exits.
    await Database.closeAll();
    process.exit(process.exitCode ?? 0);
  })
  .catch(async (err) => {
    console.error(colors.red("[FATAL ERROR]"), err.message);
    await Database.closeAll().catch(() => {});
    process.exit(1);
  });
