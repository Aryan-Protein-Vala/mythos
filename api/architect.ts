/**
 * Vercel serverless function — the only production home of the OpenRouter
 * credential. The browser calls this route; the key never leaves the server.
 *
 *   GET  /api/architect → { available, model }   (capability probe, no auth)
 *   POST /api/architect → generate | revise      (see src/server/architectCore)
 *
 * Local development uses the Vite middleware in vite.config.ts, which calls
 * the same core. No web framework is introduced on purpose.
 */

import { architectStatus, runArchitect } from "../src/server/architectCore";

/* Minimal structural types — avoids a hard dependency on @vercel/node while
   staying compatible with the Node runtime's request/response objects. */
interface ApiRequest {
  method?: string;
  body?: unknown;
  on?: (event: string, cb: (chunk?: unknown) => void) => void;
}
interface ApiResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(data?: string): void;
  json?(body: unknown): void;
}

function send(res: ApiResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

async function readBody(req: ApiRequest): Promise<unknown> {
  // Vercel's Node runtime pre-parses JSON bodies; when it didn't (or when
  // running behind a plain Node server), read the stream ourselves.
  if (req.body !== undefined) return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (typeof req.on !== "function") return undefined;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on!("data", (chunk) => chunks.push(chunk as Buffer));
    req.on!("end", () => resolve());
    req.on!("error", () => reject(new Error("failed to read request body")));
  });
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : undefined;
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const env = { apiKey: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL };

  if (req.method === "GET") {
    send(res, 200, architectStatus(env));
    return;
  }
  if (req.method !== "POST") {
    send(res, 405, { ok: false, reason: "invalid", detail: "Method not allowed." });
    return;
  }

  let parsed: unknown;
  try {
    parsed = await readBody(req);
  } catch {
    send(res, 400, { ok: false, reason: "invalid", detail: "Request body must be JSON." });
    return;
  }

  const { status, body } = await runArchitect(parsed, env);
  send(res, status, body);
}
