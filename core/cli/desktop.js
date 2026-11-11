import fs from "node:fs";
import path from "node:path";
import colors from "../util/colors.js";
import { parseEnv } from "./ecosystem.js";

/**
 * Scaffolds Electron desktop integration with multi-platform build support
 * (Windows NSIS, Windows Portable, macOS zip, Linux AppImage/tar.gz).
 */
export function makeDesktop() {
  const cwd = process.cwd();
  const env = parseEnv(path.join(cwd, ".env"));
  const appName = (env.APP_NAME || env.TITLE || path.basename(cwd) || "next-app")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");

  const desktopDir = path.join(cwd, "desktop");
  const scriptsDir = path.join(desktopDir, "scripts");
  const mainDir = path.join(desktopDir, "main");

  fs.mkdirSync(desktopDir, { recursive: true });
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(mainDir, { recursive: true });

  // 1. desktop/package.json
  // Plain Electron + electron-builder: the UI is the Next.js standalone server, so there is no
  // Nextron "renderer/" app (nextron build would run `next build renderer` and fail).
  const desktopPkg = {
    name: `${appName}-desktop`,
    version: env.VERSION || "1.0.0",
    description: `${appName} Desktop Edition (Windows, macOS, Linux)`,
    main: "main/background.js",
    type: "module",
    private: true,
    scripts: {
      "prepare:server": "node scripts/prepare-server.js",
      // dev: run `npm run dev` in the project root first; Electron loads DEV_URL (http://localhost:3000).
      dev: "electron .",
      // Prueba local del servidor empaquetado (desktop/server) sin generar instalador.
      start: "node scripts/prepare-server.js && cross-env DESKTOP_SERVER=local electron .",
      build: "node scripts/prepare-server.js && electron-builder",
      "build:win": "node scripts/prepare-server.js && electron-builder --win nsis --x64",
      "build:portable": "node scripts/prepare-server.js && electron-builder --win portable --x64",
      "build:mac": "node scripts/prepare-server.js && electron-builder --mac zip",
      "build:linux": "node scripts/prepare-server.js && electron-builder --linux AppImage tar.gz",
      "build:all": "node scripts/prepare-server.js && electron-builder --win --mac --linux",
    },
    build: {
      appId: `com.seip.${appName}`,
      productName: appName.charAt(0).toUpperCase() + appName.slice(1),
      directories: {
        output: "dist",
      },
      files: ["main/**/*", "package.json"],
      // The Next.js server and the DB template live OUTSIDE app.asar (real files on disk).
      extraResources: [
        {
          from: "server",
          to: "server",
          filter: ["**/*", "!**/*-wal", "!**/*-shm", "!**/.env*.local"],
        },
        {
          from: "database",
          to: "database",
          filter: ["**/*", "!**/*-wal", "!**/*-shm"],
        },
      ],
      win: {
        target: [
          { target: "nsis", arch: ["x64"] },
          { target: "portable", arch: ["x64"] },
        ],
      },
      mac: {
        target: ["zip"],
      },
      linux: {
        target: ["AppImage", "tar.gz"],
        category: "Utility",
      },
      nsis: {
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        artifactName: "${productName}-Setup-${version}.${ext}",
      },
      portable: {
        artifactName: "${productName}-Portable-${version}.${ext}",
      },
      asar: true,
    },
    dependencies: {},
    devDependencies: {
      // Electron >= 35 ships Node 22+, required for the native node:sqlite driver (zero native addons).
      electron: "^45.0.0",
      "electron-builder": "^26.0.0",
      "cross-env": "^10.0.0",
    },
  };

  fs.writeFileSync(
    path.join(desktopDir, "package.json"),
    JSON.stringify(desktopPkg, null, 2),
    "utf-8"
  );

  // 2. desktop/scripts/prepare-server.js
  const prepareServerContent = `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const standaloneDir = path.join(rootDir, ".next", "standalone");
const destServerDir = path.resolve(__dirname, "..", "server");
const destDbDir = path.resolve(__dirname, "..", "database");

console.log("[PREPARE] Preparando servidor standalone de Next.js para Desktop...");

if (!fs.existsSync(path.join(standaloneDir, "server.js"))) {
  console.error("[PREPARE ERROR] .next/standalone/server.js no existe.");
  console.log("Asegúrate de tener en next.config: output: 'standalone'");
  console.log("Y ejecuta 'npm run build' en la raíz antes de empaquetar desktop.");
  process.exit(1);
}

// 1. static y public (Next no los copia al standalone)
const copies = [
  [path.join(rootDir, ".next", "static"), path.join(standaloneDir, ".next", "static")],
  [path.join(rootDir, "public"), path.join(standaloneDir, "public")],
];
for (const [from, to] of copies) {
  if (fs.existsSync(from)) {
    fs.mkdirSync(to, { recursive: true });
    fs.cpSync(from, to, { recursive: true });
  }
}

// 2. Limpiar desktop/server previo y copiar
fs.rmSync(destServerDir, { recursive: true, force: true });
fs.mkdirSync(destServerDir, { recursive: true });
console.log("[PREPARE] Copiando servidor a desktop/server...");
fs.cpSync(standaloneDir, destServerDir, { recursive: true, dereference: true });

// La base de datos de desarrollo NO se empaqueta dentro del servidor.
fs.rmSync(path.join(destServerDir, "database"), { recursive: true, force: true });

// 3. Plantilla de base de datos (se copia a userData en el primer arranque).
//    Genera database/app.db con 'npx seip migrate' (y 'npx seip seed') antes de empaquetar.
fs.rmSync(destDbDir, { recursive: true, force: true });
fs.mkdirSync(destDbDir, { recursive: true });
const dbFile = path.basename(process.env.DB_FILE || "app.db");
const rootDb = path.join(rootDir, "database", dbFile);
if (fs.existsSync(rootDb)) {
  fs.copyFileSync(rootDb, path.join(destDbDir, dbFile));
  console.log(\`[PREPARE] Plantilla de BD copiada: database/\${dbFile}\`);
} else {
  console.warn(\`[PREPARE WARN] No existe database/\${dbFile}: la app arrancará con la BD vacía. Ejecuta 'npx seip migrate'.\`);
}

// 4. Addons nativos: deben compilarse para el ABI de Electron, no el de Node.
//    node:sqlite + scrypt (los defaults de @seip/nextjs) no necesitan ninguno.
const abiSensitive = ["better-sqlite3"];
for (const name of abiSensitive) {
  if (fs.existsSync(path.join(destServerDir, "node_modules", name))) {
    console.warn(
      \`[PREPARE WARN] '\${name}' es un addon nativo compilado para Node, no para Electron. \` +
        "Usa el driver nativo node:sqlite (por defecto) o recompílalo con @electron/rebuild."
    );
  }
}

console.log("[PREPARE OK] Servidor preparado en desktop/server.");
`;

  fs.writeFileSync(path.join(scriptsDir, "prepare-server.js"), prepareServerContent, "utf-8");

  // 3. desktop/main/background.js
  const backgroundContent = `import { app, BrowserWindow, dialog, shell, utilityProcess } from "electron";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

// NODE_ENV no existe en una app empaquetada: usar app.isPackaged.
const isPackaged = app.isPackaged;
const useBundledServer = isPackaged || process.env.DESKTOP_SERVER === "local";
// Empaquetado: resources/ (extraResources). Local: la carpeta desktop/.
const resourcesDir = isPackaged
  ? process.resourcesPath
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_URL = process.env.DEV_URL || "http://localhost:3000";
let serverProcess = null;
let mainWindow = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

/** Puerto libre en 127.0.0.1 elegido por el sistema operativo. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Espera a que el servidor responda en lugar de un setTimeout fijo. */
function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) return reject(new Error("El servidor Next.js no respondió a tiempo."));
        setTimeout(attempt, 150);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    attempt();
  });
}

/** JWT_SECRET único por instalación, guardado en userData (nunca dentro del instalador). */
function installSecret(userDataDir) {
  const file = path.join(userDataDir, ".jwt-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    const secret = randomBytes(48).toString("hex");
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

/** Copia la plantilla de BD empaquetada a userData en el primer arranque. */
function ensureDatabase(userDataDir) {
  const templateDir = path.join(resourcesDir, "database");
  const targetDir = path.join(userDataDir, "database");
  if (!fs.existsSync(templateDir)) return;
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of fs.readdirSync(templateDir)) {
    const target = path.join(targetDir, file);
    if (!fs.existsSync(target)) fs.copyFileSync(path.join(templateDir, file), target);
  }
}

async function startServer() {
  const userDataDir = app.getPath("userData");
  ensureDatabase(userDataDir);

  const port = await freePort();
  const serverDir = path.join(resourcesDir, "server");

  // utilityProcess usa el Node embebido de Electron (no hace falta ELECTRON_RUN_AS_NODE).
  serverProcess = utilityProcess.fork(path.join(serverDir, "server.js"), [], {
    cwd: serverDir,
    serviceName: "next-server",
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      // El server.js standalone de Next lee HOSTNAME (no HOST). Sin esto escucha en 0.0.0.0.
      HOSTNAME: "127.0.0.1",
      DESKTOP_MODE: "true",
      USER_DATA_PATH: userDataDir,
      JWT_SECRET: process.env.JWT_SECRET || installSecret(userDataDir),
    },
  });

  serverProcess.on("exit", (code) => {
    serverProcess = null;
    if (!quitting) {
      dialog.showErrorBox("Error", \`El servidor interno se detuvo (código \${code}).\`);
      app.quit();
    }
  });

  const url = \`http://127.0.0.1:\${port}\`;
  await waitForServer(url);
  return url;
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Links externos (target=_blank / window.open) en el navegador del sistema.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      if (/^https?:/i.test(target)) shell.openExternal(target);
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.loadURL(url);
}

app.whenReady().then(async () => {
  try {
    const url = useBundledServer ? await startServer() : DEV_URL;
    createWindow(url);
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
    });
  } catch (err) {
    dialog.showErrorBox("Error al iniciar", String(err?.message || err));
    app.quit();
  }
});

app.on("before-quit", () => {
  quitting = true;
  if (serverProcess) serverProcess.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
`;

  fs.writeFileSync(path.join(mainDir, "background.js"), backgroundContent, "utf-8");

  console.log(colors.bold.green(`\n[OK] Desktop scaffolding created in ./desktop/`));
  console.log(colors.cyan("\nArchivos generados:"));
  console.log(colors.gray("  - desktop/package.json (Scripts para Windows, Mac, Linux y Portable)"));
  console.log(colors.gray("  - desktop/scripts/prepare-server.js (Empaquetado de standalone Next.js)"));
  console.log(colors.gray("  - desktop/main/background.js (Main process con userData y puerto dinámico)"));
  console.log("");
  console.log(colors.bold("Pasos para compilar la versión de escritorio:"));
  console.log(colors.yellow("1. Asegúrate de configurar en tu next.config.js:"));
  console.log(colors.white("   output: 'standalone'"));
  console.log(colors.yellow("2. Genera la plantilla de BD y compila Next.js en la raíz:"));
  console.log(colors.white("   npx seip migrate && npm run build"));
  console.log(colors.yellow("3. Ve a desktop/ e instala dependencias:"));
  console.log(colors.white("   cd desktop && npm install"));
  console.log(colors.yellow("4. Compila para el objetivo deseado:"));
  console.log(colors.green("   npm run build:win        # Windows Setup NSIS"));
  console.log(colors.green("   npm run build:portable   # Windows Portable (.exe autónomo)"));
  console.log(colors.green("   npm run build:mac        # macOS Zip"));
  console.log(colors.green("   npm run build:linux      # Linux AppImage / tar.gz"));
  console.log(colors.green("   npm run build:all        # Todas las plataformas"));
  console.log("");
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith("desktop.js") ||
  process.argv[1].endsWith("desktop")
);

if (isMain) {
  makeDesktop();
}
