import fs from "node:fs";
import path from "node:path";
import colors from "../util/colors.js";
import { parseEnv } from "./ecosystem.js";

/**
 * Generates production-ready Nginx reverse proxy configuration for Next.js on VPS.
 * Keepalive upstream, public asset caching, 100M upload limits, Gzip, optional
 * WebSocket worker proxy and a Certbot-friendly flow (HTTP first, --ssl for the final config).
 */
export function generateNginxConfig() {
  const cwd = process.cwd();
  const env = parseEnv(path.join(cwd, ".env"));
  const rawArgs = process.argv.slice(2).filter((a) => a !== "nginx:conf" && a !== "nginx");

  let domainArg = null;
  let portArg = null;
  let rootArg = null;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--root" && rawArgs[i + 1]) {
      rootArg = rawArgs[++i];
    } else if (arg.startsWith("--root=")) {
      rootArg = arg.split("=")[1];
    } else if (!isNaN(Number(arg))) {
      portArg = arg;
    } else if (arg.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(arg)) {
      rootArg = arg;
    } else if (!arg.startsWith("-") && !domainArg) {
      domainArg = arg;
    }
  }

  let domain = domainArg;
  if (!domain && env.APP_URL) {
    try {
      const parsed = new URL(env.APP_URL.includes("://") ? env.APP_URL : `http://${env.APP_URL}`);
      domain = parsed.hostname;
    } catch {
      domain = env.APP_URL.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
    }
  }

  if (!domain) domain = "example.com";
  domain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "").trim();

  const port = portArg ? parseInt(portArg, 10) : parseInt(env.PORT || "3000", 10);
  const projectRoot = (rootArg || cwd).replace(/\\/g, "/").replace(/\/$/, "");
  const publicRoot = `${projectRoot}/public`;

  const upstreamName = `nextjs_${domain.replace(/[^a-zA-Z0-9_]/g, "_")}`;
  // Per-site variable name: two site files defining the same map variable make nginx fail.
  const connVar = `${upstreamName}_connection`;

  // www.<domain> only for apex domains (example.com), unless forced with --www / --no-www.
  const includeWww = rawArgs.includes("--no-www")
    ? false
    : rawArgs.includes("--www") || (!domain.startsWith("www.") && domain.split(".").length === 2);
  const serverNames = includeWww ? `${domain} www.${domain}` : domain;
  const certbotDomains = includeWww ? `-d ${domain} -d www.${domain}` : `-d ${domain}`;

  const wsCandidates = ["server/ws.js", "ws.js", "server/websocket.js"];
  const withWs =
    rawArgs.includes("--with-ws") ||
    Boolean(env.WS_PORT) ||
    wsCandidates.some((f) => fs.existsSync(path.join(cwd, f)));
  const wsPort = parseInt(env.WS_PORT || "3001", 10);
  const wsPath = env.WS_PATH || "/ws";

  // --ssl prints the final HTTPS config (only once the Let's Encrypt certificate exists).
  // By default an HTTP-only config is generated: `nginx -t` passes before the certificate
  // exists, and `certbot --nginx` adds the 443 server + redirect itself.
  const withSsl = rawArgs.includes("--ssl");

  const proxyHeaders = [
    "        proxy_http_version 1.1;",
    "        proxy_set_header Upgrade $http_upgrade;",
    `        proxy_set_header Connection $${connVar};`,
    "        proxy_set_header Host $host;",
    "        proxy_set_header X-Real-IP $remote_addr;",
    "        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "        proxy_set_header X-Forwarded-Proto $scheme;",
    "        proxy_cache_bypass $http_upgrade;",
  ].join("\n");

  const wsLocation = withWs
    ? `
    # Standalone WebSocket worker (PM2 app "<name>-ws")
    location ${wsPath} {
        proxy_pass http://${upstreamName}_ws;
${proxyHeaders}
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
`
    : "";

  const locations = `    # Maximum file upload limit (100MB)
    client_max_body_size 100M;

    # Gzip Compression
    gzip on;
    gzip_proxied any;
    gzip_vary on;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        text/xml
        application/json
        application/javascript
        application/xml
        image/svg+xml;

    # Security: Block sensitive files immediately
    location ~* /(\\.env|\\.git|wp-content|wp-admin|xmlrpc\\.php) {
        return 444;
    }

    location ~ /\\. {
        deny all;
        access_log off;
        log_not_found off;
    }

    # Project public directory for direct asset serving (includes runtime uploads)
    root ${publicRoot};

    # User uploads: never sniffed / executed as HTML or script
    location ^~ /uploads/ {
        add_header X-Content-Type-Options "nosniff" always;
        add_header Content-Security-Policy "default-src 'none'; sandbox" always;
        expires 7d;
        try_files $uri @proxy;
    }

    # Next.js build assets are content-hashed: Next.js already sends immutable headers
    location ^~ /_next/static/ {
        proxy_pass http://${upstreamName};
${proxyHeaders}
    }

    # Files in public/ are NOT hashed: cache them, but never as "immutable"
    location ~* \\.(?:css|js|jpg|jpeg|gif|png|webp|avif|ico|cur|svg|svgz|mp4|ogg|ogv|webm|woff|woff2|ttf|eot)$ {
        expires 7d;
        access_log off;
        try_files $uri @proxy;
    }
${wsLocation}
    location / {
        try_files $uri @proxy;
    }

    # Reverse proxy to Next.js Upstream with WebSocket & Streaming support
    location @proxy {
        proxy_pass http://${upstreamName};
${proxyHeaders}
        proxy_buffering off;
        client_body_buffer_size 128k;
    }`;

  const wsUpstream = withWs
    ? `
upstream ${upstreamName}_ws {
    server 127.0.0.1:${wsPort};
}
`
    : "";

  const header = `# =============================================================
# Next.js Nginx Reverse Proxy Configuration
# File: /etc/nginx/sites-available/${domain}
# =============================================================

# "Connection: upgrade" only for WebSocket requests; empty otherwise so the
# upstream keepalive pool is actually reused for normal requests.
map $http_upgrade $${connVar} {
    default upgrade;
    ''      '';
}

upstream ${upstreamName} {
    server 127.0.0.1:${port};
    keepalive 64;
}
${wsUpstream}`;

  const nginxConf = withSsl
    ? `${header}
# HTTP - Redirect all traffic to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name ${serverNames};
    return 301 https://$host$request_uri;
}

# HTTPS - Next.js Reverse Proxy
server {
    # "listen ... http2" works on every nginx version ("http2 on;" needs nginx >= 1.25.1).
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${serverNames};

    # SSL Certificates (created by Certbot)
    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

${locations}
}
`
    : `${header}
# HTTP server. Certbot (step 4) adds the HTTPS server and the HTTP -> HTTPS redirect.
server {
    listen 80;
    listen [::]:80;
    server_name ${serverNames};

${locations}
}
`;

  console.log(colors.bold.cyan("============================================================="));
  console.log(colors.bold.cyan(` Nginx Reverse Proxy & Certbot Setup for: ${domain}`));
  console.log(colors.bold.cyan("=============================================================\n"));

  console.log(colors.yellow("1. Crea el archivo de configuración en tu VPS:"));
  console.log(colors.green(`   sudo nano /etc/nginx/sites-available/${domain}\n`));

  console.log(colors.yellow("2. Pega la siguiente configuración:\n"));
  console.log(colors.white(nginxConf));

  console.log(colors.yellow("3. Habilita el sitio y recarga Nginx:"));
  console.log(colors.green(`   sudo ln -s /etc/nginx/sites-available/${domain} /etc/nginx/sites-enabled/`));
  console.log(colors.green("   sudo nginx -t"));
  console.log(colors.green("   sudo systemctl reload nginx\n"));

  if (withSsl) {
    console.log(colors.yellow("4. Configuración HTTPS final (requiere el certificado ya emitido). Verifica y recarga:"));
    console.log(colors.green("   sudo nginx -t && sudo systemctl reload nginx\n"));
  } else {
    console.log(colors.yellow("4. Genera el certificado SSL gratis con Certbot (agrega HTTPS y la redirección):"));
    console.log(colors.green(`   sudo certbot --nginx ${certbotDomains}\n`));
  }
  console.log(colors.bold.cyan("============================================================="));
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith("nginx.js") ||
  process.argv[1].endsWith("nginx")
);

if (isMain) {
  generateNginxConfig();
}
