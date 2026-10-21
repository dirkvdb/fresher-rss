import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm(new URL("../dist-server", import.meta.url), {
  recursive: true,
  force: true,
});
await build({
  entryPoints: ["server/index.mjs", "server/configure.mjs"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outdir: "dist-server",
  outExtension: { ".js": ".mjs" },
  logLevel: "info",
});
