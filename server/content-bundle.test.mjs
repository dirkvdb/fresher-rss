import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("runs bundled extraction and the production entry point without node_modules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fresher-content-bundle-"));
  let child;
  try {
    await build({
      entryPoints: [
        fileURLToPath(new URL("./index.mjs", import.meta.url)),
        fileURLToPath(new URL("./content-extract.mjs", import.meta.url)),
      ],
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      outdir: directory,
      outExtension: { ".js": ".mjs" },
      logLevel: "silent",
    });
    const { extractArticleContent } = await import(
      pathToFileURL(join(directory, "content-extract.mjs")).href
    );
    const result = extractArticleContent(
      `<html><head><title>Bundled article</title></head><body><article><p>${"A substantial article about reliable software, safe extraction, and useful reading experiences. ".repeat(15)}</p><p><a href="../more">More</a></p></article></body></html>`,
      "https://publisher.example/posts/story",
    );
    expect(result.title).toBe("Bundled article");
    expect(result.content).toContain('href="https://publisher.example/more"');

    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    child = spawn(process.execPath, [join(directory, "index.mjs")], {
      cwd: directory,
      env: {
        ...process.env,
        SERVER_HOST: "127.0.0.1",
        SERVER_PORT: String(port),
        IMAGE_ENABLED: "false",
        FRESHRSS_URL: "",
        FRESHRSS_REFRESH_TOKENS: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
    });
    await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("Fresher services listening")) resolve();
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        reject(new Error(`Bundled server exited (${code}): ${output}`)),
      );
    });
    const response = await fetch(
      `http://127.0.0.1:${port}/api/article-content?url=http://127.0.0.1/`,
      { signal: AbortSignal.timeout(3000) },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
