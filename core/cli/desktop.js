import fs from "node:fs";
import path from "node:path";
import colors from "../util/colors.js";
import { parseEnv } from "./ecosystem.js";

/**
 * Scaffolds Nextron / Electron desktop integration with multi-platform build support
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
  const desktopPkg = {
    name: `${appName}-desktop`,
    version: "1.0.0",
    description: `${appName} Desktop Edition (Windows, macOS, Linux)`,
    main: "main/background.js",
    type: "module",
    scripts: {
      "prepare:server": "node scripts/prepare-server.js",
      dev: "node scripts/prepare-server.js && nextron",
      build: "node scripts/prepare-server.js && nextron build",
      "build:win": "node scripts/prepare-server.js && nextron build --win --x64",
      "build:portable": "node scripts/prepare-server.js && nextron build --win portable --x64",
      "build:mac": "node scripts/prepare-server.js && nextron build --mac zip",
      "build:linux": "node scripts/prepare-server.js && nextron build --linux AppImage tar.gz",
      "build:all": "node scripts/prepare-server.js && nextron build --win --mac --linux",
    },
    build: {
      appId: `com.seip.${appName}`,
      productName: appName.charAt(0).toUpperCase() + appName.slice(1),
      directories: {
        output: "dist",
      },
      files: ["main/**/*", "package.json"],
      extraResources: [
        {
          from: "database",
          to: "database",
          filter: ["**/*", "!**/*-wal", "!**/*-shm"],
        },
        {
          from: "server",
          to: "server",
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
      asarUnpack: ["database/**/*"],
    },
    dependencies: {},
    devDependencies: {
      electron: "^34.0.0",
      "electron-builder": "^25.1.8",
      nextron: "^10.0.0",
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

console.log("[PREPARE] Preparando servidor standalone de Next.js para Desktop...");

if (!fs.existsSync(standaloneDir)) {
  console.error("[PREPARE ERROR] .next/standalone no existe.");
  console.log("Por favor asegúrate de tener en next.config.js: output: 'standalone'");
  console.log("Y ejecuta 'npm run build' en la raíz antes de empaquetar desktop.");
  process.exit(1);
}

// 1. Asegurar static en standalone/.next/static
const rootStaticDir = path.join(rootDir, ".next", "static");
const standaloneStaticDir = path.join(standaloneDir, ".next", "static");
if (fs.existsSync(rootStaticDir)) {
  fs.mkdirSync(standaloneStaticDir, { recursive: true });
  fs.cpSync(rootStaticDir, standaloneStaticDir, { recursive: true });
}

// 2. Asegurar public/ en standalone/public
const rootPublicDir = path.join(rootDir, "public");
const standalonePublicDir = path.join(standaloneDir, "public");
if (fs.existsSync(rootPublicDir)) {
  fs.mkdirSync(standalonePublicDir, { recursive: true });
  fs.cpSync(rootPublicDir, standalonePublicDir, { recursive: true });
}

// 3. Limpiar desktop/server previo y copiar
if (fs.existsSync(destServerDir)) {
  fs.rmSync(destServerDir, { recursive: true, force: true });
}
fs.mkdirSync(destServerDir, { recursive: true });

console.log("[PREPARE] Copiando servidor a desktop/server...");
fs.cpSync(standaloneDir, destServerDir, { recursive: true, dereference: true });
console.log("[PREPARE OK] Servidor preparado exitosamente en desktop/server.");
`;

  fs.writeFileSync(path.join(scriptsDir, "prepare-server.js"), prepareServerContent, "utf-8");

  // 3. desktop/main/background.js
  const backgroundContent = `import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fork } from "node:child_process";
import http from "node:http";

const isProd = process.env.NODE_ENV === "production";
let serverProcess = null;
let mainWindow = null;

function findAvailablePort(startPort = 3000) {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(startPort, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

async function startServer() {
  const port = await findAvailablePort(3000);
  const serverPath = isProd
    ? path.join(process.resourcesPath, "server", "server.js")
    : path.resolve(process.cwd(), "..", ".next", "standalone", "server.js");

  const userDataDir = app.getPath("userData");

  serverProcess = fork(serverPath, [], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      DESKTOP_MODE: "true",
      USER_DATA_PATH: userDataDir,
    },
    stdio: "inherit",
  });

  return port;
}

app.whenReady().then(async () => {
  const port = await startServer();
  const url = \`http://127.0.0.1:\${port}\`;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Wait for local server to be responsive
  setTimeout(() => {
    mainWindow.loadURL(url);
  }, 1000);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
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
  console.log(colors.yellow("2. Compila Next.js en la raíz:"));
  console.log(colors.white("   npm run build"));
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
