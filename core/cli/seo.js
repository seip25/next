import fs from "node:fs";
import path from "node:path";
import colors from "../util/colors.js";
import { Seo } from "../seo.js";
import Config from "../config.js";

/**
 * Generates sitemap.xml and robots.txt in public/ directory,
 * or App Router sitemap.js and robots.js.
 */
export function makeSeo() {
  const cwd = process.cwd();
  const publicDir = path.join(cwd, "public");
  fs.mkdirSync(publicDir, { recursive: true });

  const props = Config.props();
  const baseUrl = props.appUrl || "http://localhost:3000";

  // 1. Generate public/robots.txt
  const robotsContent = Seo.generateRobots(baseUrl);
  fs.writeFileSync(path.join(publicDir, "robots.txt"), robotsContent, "utf-8");
  console.log(colors.green("[OK] Generated public/robots.txt (with protected routes excluded)"));

  // 2. Generate public/sitemap.xml
  const sitemapContent = Seo.generateSitemap(baseUrl);
  fs.writeFileSync(path.join(publicDir, "sitemap.xml"), sitemapContent, "utf-8");
  console.log(colors.green("[OK] Generated public/sitemap.xml (with protected routes excluded)"));

  console.log("");
  console.log(colors.bold("Tip para Next.js App Router (sitemaps dinámicos):"));
  console.log(colors.gray("Puedes crear app/sitemap.js con:"));
  console.log(colors.cyan("  import { Seo } from '@seip/next';\n  export default function sitemap() { return Seo.toNextSitemap(); }"));
  console.log(colors.gray("Y app/robots.js con:"));
  console.log(colors.cyan("  import { Seo } from '@seip/next';\n  export default function robots() { return Seo.toNextRobots(); }"));
  console.log("");
}

const isMain = process.argv[1] && (
  process.argv[1].endsWith("seo.js") ||
  process.argv[1].endsWith("seo")
);

if (isMain) {
  makeSeo();
}
