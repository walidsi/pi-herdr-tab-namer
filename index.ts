/**
 * herdr-tab-namer
 *
 * Names the current Herdr tab from a short summary of the user's first
 * prompt in the session. Summarization runs against a separate,
 * pre-configured model (see config.json next to this file), so it never
 * touches the main conversation, the active model, or the visible chat.
 * The rename happens in the background: the summarization call is fired
 * without being awaited inside before_agent_start, so it never delays
 * the user's actual turn.
 *
 * Requires:
 *   - Running inside a Herdr-managed pane (HERDR_ENV=1, HERDR_TAB_ID set)
 *   - The `herdr` binary on PATH
 *   - A model in config.json that pi already has credentials for
 *
 * Install:
 *   Copy this folder to ~/.pi/agent/extensions/herdr-tab-namer/
 *   (or .pi/extensions/herdr-tab-namer/ for a single project), then edit
 *   config.json to point at a model you actually have access to.
 *
 * Docs consulted:
 *   https://pi.dev/docs/latest/extensions
 *   https://herdr.dev/docs/cli-reference/
 *   https://herdr.dev/docs/integrations/
 *   https://herdr.dev/docs/concepts/
 */

import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const DEBUG_LOG = resolve(dirname(fileURLToPath(import.meta.url)), "debug.log");
const FALLBACK_LOG = process.platform === "win32" ? "%TEMP%\\pi-herdr-tab-namer-debug.log" : "/tmp/pi-herdr-tab-namer-debug.log";

function makeLog(enabled: boolean) {
  if (!enabled) {
    return () => { };
  }
  return (...args: any[]) => {
    const line = `[${new Date().toISOString()}] ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}\n`;
    for (const path of [DEBUG_LOG, FALLBACK_LOG]) {
      try {
        appendFileSync(path, line);
        break; // stop after first successful write
      } catch {
        // try next fallback
      }
    }
  };
}

interface NamerConfig {
  model: { provider: string; id: string };
  maxWords: number;
  maxTitleLength: number;
  debug: boolean;
}

const DEFAULT_CONFIG: NamerConfig = {
  model: { provider: "anthropic", id: "claude-haiku-4-5-20251001" },
  maxWords: 4,
  maxTitleLength: 40,
  debug: false,
};

function loadConfig(): NamerConfig {
  try {
    const configPath = fileURLToPath(new URL("./config.json", import.meta.url));
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    return {
      model: {
        provider:
          typeof parsed?.model?.provider === "string" ? parsed.model.provider : DEFAULT_CONFIG.model.provider,
        id: typeof parsed?.model?.id === "string" ? parsed.model.id : DEFAULT_CONFIG.model.id,
      },
      maxWords: Number.isFinite(parsed?.maxWords) && parsed.maxWords > 0 ? parsed.maxWords : DEFAULT_CONFIG.maxWords,
      maxTitleLength:
        Number.isFinite(parsed?.maxTitleLength) && parsed.maxTitleLength > 0
          ? parsed.maxTitleLength
          : DEFAULT_CONFIG.maxTitleLength,
      debug: typeof parsed?.debug === "boolean" ? parsed.debug : DEFAULT_CONFIG.debug,
    };
  } catch {
    // Missing or invalid config.json: fall back to defaults rather than fail.
    return DEFAULT_CONFIG;
  }
}

function sanitizeTitle(raw: string, maxLength: number): string | null {
  const cleaned = raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength).trim() : cleaned;
}

function extractTitleFromThinking(thinking: string): string {
  // Reasoning models often produce quoted candidate titles in their thinking.
  // Grab the last quoted substring as the most likely chosen title.
  const matches = [...thinking.matchAll(/"([^"]{3,80})"/g)];
  if (matches.length > 0) {
    return matches[matches.length - 1][1];
  }
  return "";
}

function firstNWordsHyphenated(raw: string, n: number): string {
  const words = raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, n)
    .map((w) => w.replace(/[^\p{L}\p{N}_-]/gu, ""))
    .filter(Boolean);
  return words.join("-");
}

function resolveModel(
  registry: ExtensionContext["modelRegistry"],
  configModel: NamerConfig["model"],
) {
  // Exact match first.
  let model = registry.find(configModel.provider, configModel.id);
  if (model) return model;

  // Some providers register with a normalized id (without provider prefix) or
  // under a slightly different provider slug. Try a few common fallbacks.
  const tryIds = [configModel.id];
  if (configModel.id.includes("/")) {
    tryIds.push(configModel.id.split("/").slice(1).join("/"));
  }
  if (!configModel.id.includes("/")) {
    tryIds.push(`${configModel.provider}/${configModel.id}`);
  }

  const tryProviders = [configModel.provider];
  if (configModel.provider === "kilo") tryProviders.push("openrouter", "openai");

  for (const provider of tryProviders) {
    for (const id of tryIds) {
      model = registry.find(provider, id);
      if (model) return model;
    }
  }

  return null;
}

/**
 * Run `herdr <args>` directly via child_process.spawn, mimicking the pi-herdr
 * extension's wrapper. This avoids any semantics mismatch with pi.exec and
 * parses herdr's JSON envelope.
 */
function runHerdr(
  args: string[],
  timeoutMs = 10_000,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const bin = "herdr";
    let child: ChildProcess;
    try {
      child = spawn(bin, args, {
        shell: false,
        windowsHide: true,
        env: process.env,
      });
    } catch (e) {
      resolve({ ok: false, error: `failed to spawn herdr: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }

    let out = "";
    let stderr = "";
    let settled = false;

    const finish = (r: { ok: true; data: unknown } | { ok: false; error: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish({ ok: false, error: `herdr ${args.join(" ")} timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout?.on("data", (d) => {
      out += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });

    child.on("error", (e) => {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        finish({ ok: false, error: "herdr binary not found on PATH (set HERDR_BIN)" });
      } else {
        finish({ ok: false, error: `failed to run herdr: ${e instanceof Error ? e.message : String(e)}` });
      }
    });

    child.on("close", (exitCode) => {
      const parsed = parseLastJson(out);
      if (parsed === null) {
        // Commands like `herdr tab rename` may return empty stdout on success.
        if (exitCode === 0 && !out.trim() && !stderr.trim()) {
          finish({ ok: true, data: {} });
          return;
        }
        const firstErr = stderr.split(/\r?\n/).find((l) => l.trim());
        finish({
          ok: false,
          error: firstErr ? `herdr error: ${firstErr.trim()}` : "herdr returned unparseable output",
        });
        return;
      }
      const json = parsed as { error?: { code?: string; message?: string }; result?: unknown };
      if (json.error) {
        finish({
          ok: false,
          error: `${json.error.code ?? "herdr error"}: ${json.error.message ?? "unknown error"}`,
        });
        return;
      }
      finish({ ok: true, data: json.result ?? json });
    });
  });
}

function parseLastJson(s: string): unknown | null {
  const text = s.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* fall through to line scan */
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* keep scanning */
    }
  }
  return null;
}

async function nameHerdrTab(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  promptText: string,
  config: NamerConfig,
  log: (...args: any[]) => void,
): Promise<void> {
  // Mirrors the guard pattern used by pi-herdr's self-report:
  // no-op outside a Herdr-managed pane.
  if (process.env.HERDR_ENV !== "1") {
    log("[herdr-tab-namer] HERDR_ENV not set to 1, skipping");
    return;
  }

  let tabId = process.env.HERDR_TAB_ID;
  if (!tabId) {
    // HERDR_TAB_ID is not always exported; try to derive it from HERDR_PANE_ID.
    const paneId = process.env.HERDR_PANE_ID;
    if (paneId) {
      const r = await runHerdr(["pane", "get", paneId], 5_000);
      if (r.ok) {
        const data = r.data as Record<string, unknown> | undefined;
        const pane = (data?.pane ?? data) as Record<string, unknown> | undefined;
        const found = typeof pane?.tab_id === "string" ? pane.tab_id : undefined;
        if (found) {
          log(`[herdr-tab-namer] Derived HERDR_TAB_ID=${found} from pane ${paneId}`);
          tabId = found;
        }
      }
    }
    if (!tabId) {
      log("[herdr-tab-namer] HERDR_TAB_ID not set and could not be derived, skipping");
      return;
    }
  }

  const model = resolveModel(ctx.modelRegistry, config.model);
  if (!model) {
    const registry = ctx.modelRegistry as any;
    const available = registry.list?.().map((m: any) => `${m.provider}/${m.id}`).join(", ") ?? "(unknown)";
    log(
      `[herdr-tab-namer] Model ${config.model.provider}/${config.model.id} not found. Available: ${available}`,
    );
    return;
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) {
    log("[herdr-tab-namer] No API key available for model");
    return;
  }

  const apiController = new AbortController();
  const apiTimeout = setTimeout(() => apiController.abort(), 15_000);

  let response: unknown;
  try {
    // Use OpenAI-compatible message format (string content, no timestamp).
    response = await complete(
      model,
      {
        messages: [
          {
            role: "user",
            timestamp: Date.now(),
            content: [
              `Create a short topic title for a terminal tab based on the user's request.`,
              `The title should be the main subject, not a sentence fragment.`,
              `Respond with ${config.maxWords} words or fewer.`,
              `Plain text only, no punctuation, no quotes, no markdown, no thinking.`,
              `Output ONLY the final title, nothing else.`,
              "",
              "Request:",
              promptText.slice(0, 4000),
            ].join("\n"),
          },
        ],
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        env: auth.env,
        maxTokens: 500,
        signal: apiController.signal,
      },
    );

    const firstResp = response as any;
    if (firstResp?.stopReason === "error" && String(firstResp?.errorMessage ?? "").includes("Reasoning is mandatory")) {
      log("[herdr-tab-namer] Model requires reasoning, retrying with reasoning_effort=medium");
      response = await complete(
        model,
        {
          messages: [
            {
              role: "user",
              timestamp: Date.now(),
              content: [
                `Summarize the following request as a short terminal tab title.`,
                `Respond with ${config.maxWords} words or fewer.`,
                `Plain text only, no punctuation, no quotes, no markdown.`,
                `Output ONLY the title, nothing else.`,
                "",
                "Request:",
                promptText.slice(0, 4000),
              ].join("\n"),
            },
          ],
        },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          env: auth.env,
          maxTokens: 20,
          signal: apiController.signal,
          reasoning_effort: "medium",
        },
      );
    }
  } catch (err) {
    log("[herdr-tab-namer] complete() threw:", err instanceof Error ? err.message : String(err));
    response = null;
  } finally {
    clearTimeout(apiTimeout);
  }

  // Extract text from the response. The compat layer may return content as a
  // string or as an array of content blocks depending on the provider.
  let rawTitle: string | undefined;
  const resp = response as any;
  log("[herdr-tab-namer] complete() raw response:", JSON.stringify(response).slice(0, 2000));
  if (response == null) {
    log("[herdr-tab-namer] complete() returned null/undefined");
  } else if (typeof resp === "string") {
    log("[herdr-tab-namer] complete() returned string:", resp.slice(0, 200));
    rawTitle = resp;
  } else if (typeof resp.content === "string") {
    log("[herdr-tab-namer] complete() returned content string:", resp.content.slice(0, 200));
    rawTitle = resp.content;
  } else if (Array.isArray(resp.content)) {
    log("[herdr-tab-namer] complete() content array raw:", JSON.stringify(resp.content));
    const textParts = resp.content
      .filter((c: any): c is { type: "text"; text: string } => c.type === "text")
      .map((c: any) => c.text)
      .join(" ");
    const thinkingParts = resp.content
      .filter((c: any): c is { type: "thinking"; thinking: string } => c.type === "thinking")
      .map((c: any) => c.thinking)
      .join(" ");
    rawTitle = textParts || extractTitleFromThinking(thinkingParts);
    log("[herdr-tab-namer] complete() returned content array, extracted:", (rawTitle ?? "").slice(0, 200));
  } else if (typeof resp.text === "string") {
    rawTitle = resp.text;
  } else if (typeof resp.message?.content === "string") {
    rawTitle = resp.message.content;
  } else if (resp.choices?.[0]?.message?.content) {
    rawTitle = String(resp.choices[0].message.content);
  } else if (resp.stopReason === "error") {
    log("[herdr-tab-namer] Model returned error:", resp.errorMessage);
  } else {
    log("[herdr-tab-namer] Unexpected response format:", JSON.stringify(response).slice(0, 500));
  }

  let title = sanitizeTitle(rawTitle ?? "", config.maxTitleLength);
  if (!title) {
    log("[herdr-tab-namer] LLM title empty; falling back to raw prompt");
    title = sanitizeTitle(firstNWordsHyphenated(promptText, config.maxWords), config.maxTitleLength);
  }
  if (!title) {
    log("[herdr-tab-namer] Sanitized title is empty; raw was:", JSON.stringify(rawTitle));
    return;
  }

  // herdr tab rename <tab_id> <label> -- exact syntax per the Herdr CLI reference.
  const r = await runHerdr(["tab", "rename", tabId, title], 5_000);
  if (!r.ok) {
    log(`[herdr-tab-namer] herdr tab rename failed: ${r.error}`);
    return;
  }

  // Rename is intentionally silent: never inject a message/notification into
  // the visible chat. Logs go to file only.
}

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  const log = makeLog(config.debug);
  let handled = false;

  // Top-level smoke signal so we know the extension was loaded and which
  // Herdr env vars Pi actually exported to it.
  log("[herdr-tab-namer] Extension loaded", {
    HERDR_ENV: process.env.HERDR_ENV,
    HERDR_TAB_ID: process.env.HERDR_TAB_ID,
    HERDR_PANE_ID: process.env.HERDR_PANE_ID,
  });

  pi.on("session_start", (_event, ctx) => {
    // Only skip explicitly resumed sessions. Fresh sessions (even with a
    // greeting from Pi) should still get their first user prompt named.
    const reason = (_event as any)?.reason;
    const hasExistingUserMessage = ctx.sessionManager
      .getEntries()
      .some((entry) => entry.type === "message" && entry.message.role === "user");
    handled = reason === "resume" && hasExistingUserMessage;
    log(`[herdr-tab-namer] session_start reason=${reason}, handled=${handled}`);
  });

  pi.on("input", (event, ctx) => {
    // Fallback trigger: if before_agent_start is bypassed by an extension
    // command or skill, the raw input event still carries the user text.
    if (handled) return;
    const text = (event as any)?.text ?? "";
    if (!text || typeof text !== "string") return;
    // Don't trigger on slash commands.
    if (text.startsWith("/")) return;
    handled = true;
    log("[herdr-tab-namer] input event triggered rename");
    void nameHerdrTab(pi, ctx, text.trim(), config, log);
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (handled) return;
    handled = true;

    const promptText = (event.prompt ?? "").trim();
    if (!promptText) return;

    log("[herdr-tab-namer] before_agent_start triggered rename");
    // Fire and forget: intentionally not awaited/returned so this never
    // delays before_agent_start or the user's turn.
    void nameHerdrTab(pi, ctx, promptText, config, log);
  });

  // Manual test command: /tabname-test [title]
  pi.registerCommand("tabname-test", {
    description: "Manually trigger a Herdr tab rename",
    handler: async (args, ctx) => {
      const title = args.trim() || "test-rename";
      log(`[herdr-tab-namer] Manual /tabname-test with title=${title}`);
      await nameHerdrTab(pi, ctx as any, title, { ...config, maxWords: 99 }, log);
      // Intentionally no notify: keep test command invisible in chat.
    },
  });
}
