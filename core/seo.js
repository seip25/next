import Config from "./config.js";

const DEFAULT_DISALLOWED_PREFIXES = [
  "/api",
  "/dashboard",
  "/admin",
  "/profile",
  "/account",
  "/login",
  "/register",
  "/auth",
  "/reset-password",
  "/settings",
];

const registeredSeoRoutes = new Set();
const customDisallowedRoutes = new Set(DEFAULT_DISALLOWED_PREFIXES);

/**
 * Intelligent SEO module for Next.js with automatic protection against indexing
 * private, authenticated, or sensitive routes in sitemap.xml and robots.txt.
 */
class Seo {
  /**
   * Registers a public route path for inclusion in sitemap.xml.
   * Automatically rejects protected, API, or wildcard routes.
   * @param {string} routePath
   * @param {string[]} [languages=[]]
   */
  static registerRoute(routePath, languages = []) {
    if (typeof routePath !== "string") return;
    if (routePath.includes("*") || routePath.includes(":") || routePath.includes("[")) return;

    const normalizedRoute = routePath.startsWith("/") ? routePath : `/${routePath}`;

    if (this.isDisallowed(normalizedRoute)) {
      return;
    }

    if (languages && languages.length > 0) {
      for (const lang of languages) {
        const cleanLang = String(lang).trim().replace(/^\/|\/$/g, "");
        if (cleanLang) {
          const localized = normalizedRoute === "/" ? `/${cleanLang}` : `/${cleanLang}${normalizedRoute}`;
          registeredSeoRoutes.add(localized);
        }
      }
    } else {
      registeredSeoRoutes.add(normalizedRoute);
    }
  }

  /**
   * Sets or adds route patterns that should be disallowed from SEO indexing.
   * @param {string|string[]} routes
   */
  static disallow(routes) {
    const list = Array.isArray(routes) ? routes : [routes];
    for (const r of list) {
      if (typeof r === "string" && r) {
        const clean = r.startsWith("/") ? r : `/${r}`;
        customDisallowedRoutes.add(clean.replace(/\/$/, ""));
      }
    }
  }

  /**
   * Checks whether a given path is considered protected or disallowed from indexing.
   * @param {string} routePath
   * @returns {boolean}
   */
  static isDisallowed(routePath) {
    const clean = (routePath || "").toLowerCase().replace(/\/$/, "");
    for (const prefix of customDisallowedRoutes) {
      const cleanPrefix = prefix.toLowerCase();
      if (clean === cleanPrefix || clean.startsWith(`${cleanPrefix}/`)) {
        return true;
      }
    }
    return false;
  }

  static getRoutes() {
    return Array.from(registeredSeoRoutes);
  }

  static getDisallowed() {
    return Array.from(customDisallowedRoutes);
  }

  static clear() {
    registeredSeoRoutes.clear();
  }

  /**
   * Generates sitemap XML string, omitting all protected routes.
   * @param {string} [baseUrl]
   * @returns {string}
   */
  static generateSitemap(baseUrl) {
    const props = Config.props();
    const rootUrl = (baseUrl || props.appUrl || `${props.host}:${props.port}`).replace(/\/$/, "");
    const lastmod = new Date().toISOString().split("T")[0];

    const routes = registeredSeoRoutes.size > 0 ? Array.from(registeredSeoRoutes) : ["/"];

    const urls = routes
      .filter((r) => !this.isDisallowed(r))
      .map((routePath) => {
        const priority = routePath === "/" ? "1.0" : "0.8";
        return [
          "  <url>",
          `    <loc>${rootUrl}${routePath}</loc>`,
          `    <lastmod>${lastmod}</lastmod>`,
          "    <changefreq>weekly</changefreq>",
          `    <priority>${priority}</priority>`,
          "  </url>",
        ].join("\n");
      });

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls,
      "</urlset>",
    ].join("\n");
  }

  /**
   * Generates robots.txt content with explicit Disallow rules for all protected routes.
   * @param {string} [baseUrl]
   * @returns {string}
   */
  static generateRobots(baseUrl) {
    const props = Config.props();
    const rootUrl = (baseUrl || props.appUrl || `${props.host}:${props.port}`).replace(/\/$/, "");

    const disallowRules = Array.from(customDisallowedRoutes)
      .map((r) => `Disallow: ${r.endsWith("/") ? r : `${r}/`}`)
      .join("\n");

    return [
      "User-agent: *",
      "Allow: /",
      disallowRules,
      "",
      `Sitemap: ${rootUrl}/sitemap.xml`,
      "",
    ].join("\n");
  }

  /**
   * Next.js App Router Helper for app/sitemap.js:
   * export default function sitemap() { return Seo.toNextSitemap(baseUrl); }
   * @param {string} [baseUrl]
   * @returns {Array<Object>}
   */
  static toNextSitemap(baseUrl) {
    const props = Config.props();
    const rootUrl = (baseUrl || props.appUrl || `${props.host}:${props.port}`).replace(/\/$/, "");
    const routes = registeredSeoRoutes.size > 0 ? Array.from(registeredSeoRoutes) : ["/"];

    return routes
      .filter((r) => !this.isDisallowed(r))
      .map((r) => ({
        url: `${rootUrl}${r}`,
        lastModified: new Date(),
        changeFrequency: r === "/" ? "daily" : "weekly",
        priority: r === "/" ? 1.0 : 0.8,
      }));
  }

  /**
   * Next.js App Router Helper for app/robots.js:
   * export default function robots() { return Seo.toNextRobots(baseUrl); }
   * @param {string} [baseUrl]
   * @returns {Object}
   */
  static toNextRobots(baseUrl) {
    const props = Config.props();
    const rootUrl = (baseUrl || props.appUrl || `${props.host}:${props.port}`).replace(/\/$/, "");

    const disallow = Array.from(customDisallowedRoutes).map((r) => (r.endsWith("/") ? r : `${r}/`));

    return {
      rules: {
        userAgent: "*",
        allow: "/",
        disallow,
      },
      sitemap: `${rootUrl}/sitemap.xml`,
    };
  }
}

export { Seo };
export default Seo;
