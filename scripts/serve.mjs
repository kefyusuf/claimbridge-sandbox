/**
 * Starts the sandbox HTTP service. Zero runtime dependencies —
 * node:http + the TS sources (type stripping must be available:
 * node >= 22.18 or >= 23.6 default-on).
 *
 * Usage: node scripts/serve.mjs [--port 8123] [--bundle fixtures/bundle.json]
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startSandboxServer } from "../src/SandboxServer.ts";

const args = process.argv.slice(2);
const portFlag = args.indexOf("--port");
const bundleFlag = args.indexOf("--bundle");

const port =
  portFlag >= 0 && args[portFlag + 1] ? Number(args[portFlag + 1]) : 8123;
const bundle =
  bundleFlag >= 0 && args[bundleFlag + 1]
    ? path.resolve(args[bundleFlag + 1])
    : path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../fixtures/bundle.json",
      );

const handle = await startSandboxServer(bundle, port);
console.log(`claimbridge sandbox listening on http://127.0.0.1:${handle.port}`);
console.log(`bundle: ${bundle} (spec v0.4.0)`);

const shutdown = async () => {
  await handle.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
