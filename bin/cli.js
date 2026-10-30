#!/usr/bin/env node

import colors from "../core/util/colors.js";
import { makeModel } from "../core/cli/model.js";
import {
  makeMigration,
  runMigrations,
  rollbackMigrations,
  showMigrationStatus,
  makeSeed,
  runSeeds,
} from "../core/cli/migrate.js";
import { makeEcosystem } from "../core/cli/ecosystem.js";
import { generateNginxConfig } from "../core/cli/nginx.js";
import { makeDesktop } from "../core/cli/desktop.js";
import { makeSeo } from "../core/cli/seo.js";
import { WebSocketManager } from "../core/ws.js";

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
  console.log(colors.green("  make:desktop              ") + colors.gray("Scaffold de Nextron/Electron (Win, Mac, Linux, Portable)"));
  console.log(colors.green("  make:seo                  ") + colors.gray("Genera sitemap.xml y robots.txt con filtro"));
  console.log(colors.green("  ws:start                  ") + colors.gray("Inicia el servidor WebSocket independiente"));
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
    case "make:seo":
    case "seo": {
      makeSeo();
      break;
    }
    case "ws:start": {
      const portArg = args.find((arg) => /^\d+$/.test(arg)) || process.env.WS_PORT || "3001";
      const port = parseInt(portArg, 10);
      new WebSocketManager({ port });
      break;
    }
    default: {
      console.log(colors.red(`[ERROR] Comando desconocido: '${command}'\n`));
      showHelp();
      process.exit(1);
    }
  }
}

run().catch((err) => {
  console.error(colors.red("[FATAL ERROR]"), err.message);
  process.exit(1);
});
