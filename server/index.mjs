import { createServer } from "node:http";
import { createAppService } from "./app.mjs";
import { readConfig } from "./config.mjs";

const config = readConfig();

// The helper needs neither filesystem writes nor privileged ports.
if (process.getuid?.() === 0) {
  process.setgroups([]);
  process.setgid(config.serverGid);
  process.setuid(config.serverUid);
}
const app = createAppService({ config });
const server = createServer({ maxHeaderSize: config.httpMaxHeaderBytes }, app);
server.headersTimeout = config.httpHeadersTimeoutMs;
server.requestTimeout = config.httpRequestTimeoutMs;
server.keepAliveTimeout = config.httpKeepAliveTimeoutMs;
server.maxRequestsPerSocket = config.httpMaxRequestsPerSocket;
server.maxHeadersCount = config.httpMaxHeaders;
server.listen(config.serverPort, config.serverHost, () =>
  console.log(
    `Fresher services listening on ${config.serverHost}:${config.serverPort}.`,
  ),
);
for (const event of ["SIGTERM", "SIGINT"])
  process.once(event, () => {
    app.close();
    server.close();
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), config.shutdownTimeoutMs).unref();
  });
