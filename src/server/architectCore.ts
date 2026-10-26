/**
 * MYTHOS AI World Architect — server core.
 *
 * This module is the ONLY place that talks to OpenRouter. It runs server-side
 * (Vercel function in production, Vite dev middleware locally) and never
 * ships to the browser: the API key arrives via dependency injection from
 * server env vars, and failure payloads are authored here so upstream text —
 * which could echo request headers — never reaches the client.
 *
 * Reliability ladder for the default `openrouter/free` route (per request,
 * at most two model calls):
 *
 *   1. Structured output (json_schema) attempt.
 *   2. If the provider rejects the schema mode (HTTP 400) or the content
 *      fails validation → one fallback attempt in plain JSON-only mode,
 *      carrying the parse/validation feedback.
 *
 * Rate limits, provider errors and timeouts are not retried — the client
 * falls back to procedural generation, which stays fully operational.
 */

import { BLUEPRINT_JSON_SCHEMA, blueprintSchema, type WorldBlueprint } from "../world/architect/blueprint.js";
import type {
  ArchitectFailure,
  ArchitectFailureReason,
  ArchitectStatus,
} from "../world/architect/protocol.js";
import { REVISION_JSON_SCHEMA, revisionSchema, type WorldRevision } from "../world/architect/revision.js";

export const DEFAULT_MODEL = "openrouter/free";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/**
 * Free-route reasoning models can take 20–40 s to produce a blueprint, and the
 * provider sends its 200 headers before the body finishes streaming. A single
 * per-attempt timeout would then abort mid-body. Instead: one deadline for the
 * whole request, capped per attempt, staying inside the 60 s function budget.
 */
const TOTAL_BUDGET_MS = 55_000;
// A slow-but-successful generation should not be cut short: the first attempt
// may use almost the whole budget. Fast failures still leave room to retry.
const PER_ATTEMPT_MS = 48_000;
const MIN_ATTEMPT_MS = 4_000;
const MAX_PROMPT_CHARS = 1200;
const MAX_REVISION_CHARS = 600;

export interface ArchitectEnv {
  apiKey?: string;
  model?: string;
  /** Injectable for tests; defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
}

export interface ArchitectCoreResult {
  status: number;
  body:
    | { ok: true; blueprint: WorldBlueprint; model: string }
    | { ok: true; revision: WorldRevision; model: string }
    | ArchitectFailure;
}

export function architectStatus(env: ArchitectEnv): ArchitectStatus {
  const hasKey = Boolean(env.apiKey?.trim());
  return { available: hasKey, model: hasKey ? (env.model?.trim() || DEFAULT_MODEL) : null };
}

/* ------------------------------------------------------------------ */
/*  Prompts                                                            */
/* ------------------------------------------------------------------ */

const GENERATE_SYSTEM = [
  "You are the MYTHOS World Architect, planning worlds for a procedural 3D world engine.",
  "Convert the user's world description into ONE JSON object with EXACTLY this shape (free-routed models: copy the structure field for field):",
  "{",
  '  "name": "string 2-60 chars, evocative",',
  '  "summary": "string 10-280 chars, one paragraph",',
  '  "biome": "volcanic" | "forest" | "desert" | "tundra" | "celestial",',
  '  "timeOfDay": "dawn" | "day" | "dusk" | "night" | "eclipse",',
  '  "stone": "obsidian" | "sandstone" | "granite" | "marble" | "ice" | "wood" | "metal",',
  '  "terrain": "islands" | "rolling" | "dunes" | "ice" | "plateau",',
  '  "water": true | false,',
  '  "scale": number 0.78-1.5 (0.78 intimate, 1 grand, 1.5 colossal),',
  '  "vegetation": number 0-1,',
  '  "rocky": number 0-1,',
  '  "particles": "embers" | "mist" | "snow" | "dust" | "fireflies" | "rain" | "none",',
  '  "features": { "floating": false, "eclipse": false, "frozen": false, "ruins": false, "monumental": false, "city": false, "tree": false, "ocean": false, "desert": false, "forest": false, "observatory": false, "cathedral": false, "statues": false },',
  '  "palette": { },',
  '  "landmark": { "name": "string", "description": "string" },',
  '  "discoveries": [ { "title": "string", "text": "string", "kind": "artifact" | "secret" | "landmark" | "clue" } ],',
  '  "event": { "title": "string", "description": "string" } | null,',
  '  "notes": [ "short planner remark" ]',
  "}",
  "Rules:",
  "- Output raw JSON only. No markdown, no code fences, no prose, no comments, no analysis.",
  "- Every field above is required. palette may be an empty object, or hold optional #rrggbb overrides for: accent, fog, skyTop, skyHorizon, water, waterDeep, terrainLow, terrainHigh, rock, canopy.",
  "- Choose only from the listed enum values; never invent new ones. Match the biome to the description (frozen → tundra, dunes → desert, forest → forest, volcanic/ash → volcanic, sky/clouds → celestial).",
  "- If the description mentions an eclipse, black sun or dying sun, set timeOfDay to \"eclipse\" and features.eclipse to true.",
  "- Discoveries are short, evocative, written in second person present tense, tied to the described place. Up to 4.",
  "- The event is a single dramatic environmental change the visitor can trigger, or null.",
  "- Never emit code, URLs, file paths, shader source or anything executable. Parameters and prose only.",
].join("\n");

const REVISE_SYSTEM = [
  "You are the MYTHOS World Architect, revising an existing procedural world.",
  "You receive the current world summary and a follow-up instruction. Reply with ONE JSON object of EXACTLY this shape:",
  "{",
  '  "edits": { },',
  '  "reply": "1-2 plain sentences: what changed and what could not.",',
  '  "unsupported": [ "requests the engine cannot represent" ]',
  "}",
  "Allowed edit fields (include ONLY those the instruction asks to change):",
  '- timeOfDay: "dawn"|"day"|"dusk"|"night"|"eclipse"; skyKind: "eclipse"|"sun"|"moon"|"overcast"|"cloudsea"',
  "- fogDensity: 0.0005-0.03; fogColor: #rrggbb; keyIntensity: 0.05-4; ambientIntensity: 0.05-2.5; accentIntensity: 0-8",
  "- terrainRoughness: 0.1-1; terrainAmplitude: 0.2-1.5; vegetationDensity: 0-1; rockDensity: 0-1",
  "- waterColor: #rrggbb; waveHeight: 0-1.5; particleKind: \"embers\"|\"mist\"|\"snow\"|\"dust\"|\"fireflies\"|\"rain\"|\"none\"; particleDensity: 0-1",
  "- stoneColor: #rrggbb; landmarkScale: 0.5-2; landmarkRotation: -180-180; landmarkVisible: true|false",
  "Rules:",
  "- Output raw JSON only. No markdown, no code fences, no prose outside the JSON.",
  "- The engine cannot add, remove or move structures, and cannot create new geometry. Map such requests to the closest supported change and name the original request in \"unsupported\".",
  "- Stay within the documented numeric ranges.",
].join("\n");

/* ------------------------------------------------------------------ */
/*  OpenRouter plumbing                                                */
/* ------------------------------------------------------------------ */

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface CallOptions {
  structured: boolean;
  jsonSchema: typeof BLUEPRINT_JSON_SCHEMA | typeof REVISION_JSON_SCHEMA;
  system: string;
  user: string;
  model: string;
  apiKey: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}

type CallOutcome =
  | { kind: "content"; text: string }
  | { kind: "unsupported" } // provider rejected structured output itself
  | { kind: "failed"; reason: ArchitectFailureReason; debug?: string };

async function callOpenRouter(opts: CallOptions): Promise<CallOutcome> {
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    temperature: 0.7,
    // Enough headroom for reasoning models (which can spend tokens thinking
    // before answering) without asking for a long generation. Reasoning
    // exclusion is a hint; providers that do not honour it ignore it.
    max_tokens: 4500,
    reasoning: { exclude: true },
  };
  if (opts.structured) {
    body.response_format = { type: "json_schema", json_schema: opts.jsonSchema };
  }

  let res: Response;
  try {
    res = await opts.fetchImpl(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.apiKey}`,
        "http-referer": "https://github.com/Aryan-Protein-Vala/mythos",
        "x-title": "MYTHOS World Architect",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    const timedOut = aborted || (err instanceof Error && err.name === "TimeoutError");
    return { kind: "failed", reason: timedOut ? "timeout" : "provider_error" };
  }

  if (res.status === 400 && opts.structured) return { kind: "unsupported" };
  if (res.status === 429) return { kind: "failed", reason: "rate_limited" };
  if (res.status === 401 || res.status === 403) return { kind: "failed", reason: "unavailable" };
  if (!res.ok) return { kind: "failed", reason: "provider_error" };

  // A body read can abort when the deadline lands while the provider is still
  // streaming — that is a timeout, not an empty answer. Never swallow it.
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    return { kind: "failed", reason: "timeout" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Diagnostics without risk: status plus a short body preview, with any
    // key-shaped token stripped. Never the full upstream payload.
    const preview = raw.slice(0, 120).replace(/\s+/g, " ").replace(/sk-or-[A-Za-z0-9_-]+/g, "[redacted]");
    return { kind: "failed", reason: "invalid", debug: `HTTP ${res.status}, body: ${preview}` };
  }

  const message =
    typeof payload === "object" && payload !== null
      ? (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message
      : undefined;

  // Content is usually a string; some providers return an array of parts.
  let text = "";
  const content = message?.content;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text?: unknown }).text ?? "") : ""))
      .join("");
  }

  if (!text.trim()) return { kind: "failed", reason: "empty" };
  return { kind: "content", text };
}

/* ------------------------------------------------------------------ */
/*  Content extraction                                                 */
/* ------------------------------------------------------------------ */

/** Extract a JSON object from model output: strip fences, then the outermost braces. */
export function extractJson(text: string): unknown {
  let cleaned = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
  if (fence) cleaned = fence[1].trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    return undefined;
  }
}

function issuesOf(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: Array<{ path: PropertyKey[]; message: string }> }).issues;
    return issues
      .slice(0, 4)
      .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
      .join("; ");
  }
  return "not valid JSON";
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                        */
/* ------------------------------------------------------------------ */

export async function runArchitect(request: unknown, env: ArchitectEnv): Promise<ArchitectCoreResult> {
  const apiKey = env.apiKey?.trim();
  if (!apiKey) {
    return { status: 503, body: { ok: false, reason: "unavailable", detail: "The architect is not configured on this server." } };
  }
  const model = env.model?.trim() || DEFAULT_MODEL;
  const fetchImpl = env.fetchImpl ?? fetch;

  if (typeof request !== "object" || request === null || !("mode" in request)) {
    return { status: 400, body: { ok: false, reason: "invalid", detail: "Malformed request." } };
  }
  const req = request as { mode?: unknown; prompt?: unknown; spec?: unknown };

  const isGenerate = req.mode === "generate";
  const isRevise = req.mode === "revise";
  if (!isGenerate && !isRevise) {
    return { status: 400, body: { ok: false, reason: "invalid", detail: "Unknown mode." } };
  }

  const rawPrompt = typeof req.prompt === "string" ? req.prompt.trim() : "";
  const limit = isGenerate ? MAX_PROMPT_CHARS : MAX_REVISION_CHARS;
  if (!rawPrompt) return { status: 400, body: { ok: false, reason: "invalid", detail: "A description is required." } };
  const prompt = rawPrompt.slice(0, limit);

  const system = isGenerate ? GENERATE_SYSTEM : REVISE_SYSTEM;
  const jsonSchema = isGenerate ? BLUEPRINT_JSON_SCHEMA : REVISION_JSON_SCHEMA;
  const validate = (value: unknown) => (isGenerate ? blueprintSchema.safeParse(value) : revisionSchema.safeParse(value));

  let user = isGenerate
    ? `World description:\n${prompt}`
    : `Current world:\n${JSON.stringify(req.spec ?? {})}\n\nInstruction:\n${prompt}`;

  // Attempt 1: structured output. Attempt 2 (only if needed): JSON-only with feedback.
  let structured = true;
  let feedback = "";
  let lastIssues = "";
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_MS) {
      return { status: 504, body: { ok: false, reason: "timeout" } };
    }
    const outcome = await callOpenRouter({
      structured,
      jsonSchema,
      system,
      user: user + feedback,
      model,
      apiKey,
      fetchImpl,
      timeoutMs: Math.min(PER_ATTEMPT_MS, remaining),
    });

    if (outcome.kind === "unsupported") {
      // The provider cannot do schema mode — retry once in plain JSON mode.
      structured = false;
      feedback = "\n\nReply with raw JSON only, matching the blueprint shape exactly.";
      continue;
    }
    if (outcome.kind === "failed" && (outcome.reason === "empty" || outcome.reason === "invalid")) {
      // Empty completions and unparseable upstream bodies are the two ways a
      // malformed free-route provider shows up. Both get one bounded retry in
      // plain JSON mode, which is the more universally supported shape.
      if (attempt < 2) {
        structured = false;
        feedback =
          "\n\nYour previous reply was empty or unreadable. Reply with the raw JSON blueprint only — no analysis, no fences.";
        continue;
      }
      return { status: 502, body: { ok: false, reason: outcome.reason, detail: outcome.debug } };
    }
    if (outcome.kind === "failed") {
      const status =
        outcome.reason === "unavailable"
          ? 503
          : outcome.reason === "rate_limited"
            ? 429
            : outcome.reason === "timeout"
              ? 504
              : 502;
      return { status, body: { ok: false, reason: outcome.reason, detail: outcome.debug } };
    }

    const parsed = validate(extractJson(outcome.text));
    if (parsed.success) {
      const body = isGenerate
        ? { ok: true as const, blueprint: parsed.data as WorldBlueprint, model }
        : { ok: true as const, revision: parsed.data as WorldRevision, model };
      return { status: 200, body };
    }

    // Validation failed — one bounded retry carrying the exact complaints.
    lastIssues = issuesOf(parsed.error);
    feedback = `\n\nYour previous reply was rejected: ${lastIssues}. Reply again with corrected raw JSON only.`;
    structured = false;
  }

  return {
    status: 502,
    body: {
      ok: false,
      reason: "invalid",
      detail: `The architect answered, but the plan failed validation twice. ${lastIssues}`,
    },
  };
}
