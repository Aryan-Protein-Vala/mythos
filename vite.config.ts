import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { architectStatus, runArchitect } from "./src/server/architectCore";

/**
 * Serves /api/architect during `npm run dev` — the same handler the Vercel
 * function wraps in production, so local AI generation needs nothing but a
 * gitignored .env.local. Non-VITE_ variables are loaded explicitly and stay
 * out of the browser bundle.
 */
function architectDev(vars: Record<string, string>): Plugin {
  const env = { apiKey: vars.OPENROUTER_API_KEY, model: vars.OPENROUTER_MODEL };
  return {
    name: "mythos-architect-dev",
    configureServer(server) {
      server.middlewares.use("/api/architect", (req, res) => {
        void (async () => {
          const send = (status: number, body: unknown) => {
            res.statusCode = status;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.setHeader("cache-control", "no-store");
            res.end(JSON.stringify(body));
          };

          if (req.method === "GET") {
            send(200, architectStatus(env));
            return;
          }
          if (req.method !== "POST") {
            send(405, { ok: false, reason: "invalid", detail: "Method not allowed." });
            return;
          }

          const raw = await new Promise<string>((resolve, reject) => {
            const chunks: Buffer[] = [];
            req.on("data", (chunk: Buffer) => chunks.push(chunk));
            req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
            req.on("error", () => reject(new Error("failed to read request body")));
          });

          let parsed: unknown;
          try {
            parsed = raw ? JSON.parse(raw) : undefined;
          } catch {
            send(400, { ok: false, reason: "invalid", detail: "Request body must be JSON." });
            return;
          }

          const { status, body } = await runArchitect(parsed, env);
          send(status, body);
        })().catch(() => {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, reason: "provider_error" }));
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), architectDev(env)],
    server: {
      host: "127.0.0.1",
      port: 5173,
    },
    build: {
      target: "es2020",
      chunkSizeWarningLimit: 1400,
    },
  };
});
