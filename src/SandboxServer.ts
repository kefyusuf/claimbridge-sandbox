/**
 * Sandbox HTTP service: session-based HTTP layer over the Sandbox
 * router. Plain node:http — zero additional dependencies.
 *
 * Endpoints:
 * - POST /sessions            → { sessionId: "S<n>" }
 * - POST /sessions/:id/call   → body { methodId, request, scenarioId? }
 *                               → sandbox CallResult JSON
 * - DELETE /sessions/:id      → 204
 * - unknown session → 404 { sonucKodu: "SANDBOX_1001", sonucMesaji: "Oturum bulunamadi." }
 * - bad JSON / unknown method or scenario → 400 { sonucKodu: "SANDBOX_BAD_REQUEST", ... }
 */
import { createServer, type Server } from "node:http";
import { loadBundle } from "./loadBundle.ts";
import { EpisodeState } from "./EpisodeState.ts";
import { Sandbox } from "./Sandbox.ts";

export interface SandboxServerHandle {
  port: number;
  close(): Promise<void>;
}

export function startSandboxServer(
  bundlePath: string,
  port = 0,
): Promise<SandboxServerHandle> {
  const bundle = loadBundle(bundlePath);
  const sessions = new Map<string, EpisodeState>();
  let counter = 0;

  const server: Server = createServer((req, res) => {
    void handle(req, res);
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort =
        typeof address === "object" && address !== null ? address.port : port;
      resolve({
        port: actualPort,
        close: async () => {
          await new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          });
        },
      });
    });
  });

  async function handle(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ): Promise<void> {
    const url = req.url ?? "";
    const path = url.split("?")[0] ?? "";
    const method = req.method ?? "";

    try {
      // POST /sessions — create an episode session
      if (method === "POST" && path === "/sessions") {
        counter += 1;
        const id = `S${String(counter).padStart(6, "0")}`;
        sessions.set(id, new EpisodeState());
        sendJson(res, 200, { sessionId: id });
        return;
      }

      // POST /sessions/:id/call — route through the Sandbox router
      const callMatch = /^\/sessions\/(S\d+)\/call$/.exec(path);
      if (method === "POST" && callMatch) {
        // Parse the body first: syntax errors are 400 regardless of
        // session validity.
        const body = await readJson(req);
        const state = sessions.get(callMatch[1] ?? "");
        if (!state) {
          sendJson(res, 404, {
            sonucKodu: "SANDBOX_1001",
            sonucMesaji: "Oturum bulunamadi.",
          });
          return;
        }

        const sandbox = new Sandbox(bundle, state);
        const result = sandbox.call(
          String(body["methodId"] ?? ""),
          (body["request"] as Record<string, unknown>) ?? {},
          typeof body["scenarioId"] === "string"
            ? body["scenarioId"]
            : undefined,
        );
        sendJson(res, 200, result);
        return;
      }

      // DELETE /sessions/:id — drop the session
      const deleteMatch = /^\/sessions\/(S\d+)$/.exec(path);
      if (method === "DELETE" && deleteMatch) {
        const existed = sessions.delete(deleteMatch[1] ?? "");
        if (!existed) {
          sendJson(res, 404, {
            sonucKodu: "SANDBOX_1001",
            sonucMesaji: "Oturum bulunamadi.",
          });
          return;
        }
        res.statusCode = 204;
        res.end();
        return;
      }

      sendJson(res, 404, {
        sonucKodu: "SANDBOX_BAD_REQUEST",
        sonucMesaji: "Bilinmeyen yol.",
      });
    } catch (error) {
      sendJson(res, 400, {
        sonucKodu: "SANDBOX_BAD_REQUEST",
        sonucMesaji: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function readJson(
  req: import("node:http").IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk as Buffer));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function sendJson(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
