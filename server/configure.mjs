import { readFileSync, writeFileSync } from "node:fs";
import { readConfig, browserConfigScript } from "./config.mjs";
import { renderApache, renderNginx } from "./runtime.mjs";

const config = readConfig();
const target = process.argv[2];
if (target === "standalone") {
  if (!config.upstream)
    throw new Error("FRESHRSS_URL is required for the companion proxy.");
  writeFileSync("/usr/share/nginx/html/config.js", browserConfigScript(config));
  const template = readFileSync("/opt/fresher/nginx.conf.template", "utf8");
  writeFileSync(
    "/etc/nginx/conf.d/default.conf",
    renderNginx(template, config),
  );
} else if (target === "freshrss") {
  writeFileSync(
    "/var/www/FreshRSS/p/reader/config.js",
    browserConfigScript(config),
  );
  writeFileSync(
    "/etc/apache2/conf-available/fresher.conf",
    renderApache(config),
  );
} else throw new Error("Expected runtime target: standalone or freshrss.");
