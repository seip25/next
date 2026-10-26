import fs from "node:fs";
import path from "node:path";
import colors from "../util/colors.js";
import { parseEnv } from "./ecosystem.js";

/**
 * Generates production-ready Nginx reverse proxy configuration for Next.js on VPS.
 * Matches real-world production configurations with keepalive upstream,
 * public asset caching, 100M upload limits, Gzip compression, and Certbot SSL.
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

  const nginxConf = `# =============================================================
# Next.js Nginx Reverse Proxy Configuration
# File: /etc/nginx/sites-available/${domain}
# =============================================================

upstream ${upstreamName} {
    server 127.0.0.1:${port};
    keepalive 64;
}

# HTTP - Redirect all traffic to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name ${domain} www.${domain};
    return 301 https://$host$request_uri;
}

# HTTPS - Next.js Reverse Proxy
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${domain} www.${domain};

    # SSL Certificates (Managed by Certbot or manual certificates)
    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Project public directory for direct asset serving
    root ${publicRoot};

    # Maximum file upload limit (100MB)
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

    # Static Assets in public/ & Next.js compiled static files
    location ~* \\.(?:css|js|jpg|jpeg|gif|png|ico|cur|gz|svg|svgz|mp4|ogg|ogv|webm|htc|woff|woff2|ttf|eot)$ {
        expires 1M;
        access_log off;
        add_header Cache-Control "public, max-age=2592000, immutable";
        try_files $uri @proxy;
    }

    location / {
        try_files $uri @proxy;
    }

    # Reverse proxy to Next.js Upstream with WebSocket & Streaming support
    location @proxy {
        proxy_pass http://${upstreamName};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        client_body_buffer_size 128k;
    }
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

  console.log(colors.yellow("4. Genera el certificado SSL gratis con Certbot:"));
  console.log(colors.green(`   sudo certbot --nginx -d ${domain} -d www.${domain}\n`));
  console.log(colors.bold.cyan("============================================================="));
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith("nginx.js") ||
  process.argv[1].endsWith("nginx")
);

if (isMain) {
  generateNginxConfig();
}
