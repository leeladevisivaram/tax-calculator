import { appendFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const LOCAL_INTERACTION_DIR = fileURLToPath(new URL("../data/chat-interactions/", import.meta.url));
const SERVERLESS_INTERACTION_DIR = path.join(tmpdir(), "tax-calculator-chat-interactions");
const DEFAULT_INTERACTION_FILE = "chatbot-interactions.jsonl";

export async function appendChatbotInteraction({ request = {}, response = {}, now = new Date() } = {}) {
  const dir = process.env.CHATBOT_INTERACTION_LOG_DIR
    ? path.resolve(process.env.CHATBOT_INTERACTION_LOG_DIR)
    : defaultInteractionDir();
  const filePath = path.join(dir, DEFAULT_INTERACTION_FILE);
  const record = buildChatbotInteractionRecord({ request, response, now });

  await mkdir(dir, { recursive: true });
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");

  return {
    status: "stored",
    path: filePath,
    record
  };
}

function defaultInteractionDir() {
  return process.env.VERCEL ? SERVERLESS_INTERACTION_DIR : LOCAL_INTERACTION_DIR;
}

export function buildChatbotInteractionRecord({ request = {}, response = {}, now = new Date() } = {}) {
  const message = String(request.message ?? "");
  const actions = Array.isArray(response.actions) ? response.actions : [];
  return {
    schema_version: "chat-interaction-v1",
    captured_at: now.toISOString(),
    user_message: redactSensitiveText(message),
    message_length: message.length,
    form_state_keys: Object.keys(request.form_state ?? {}).sort(),
    response: {
      scope: response.scope ?? "unknown",
      confidence: response.confidence ?? null,
      match_id: response.match_id ?? null,
      match_source: response.match_source ?? null,
      requires_confirmation: Boolean(response.requires_confirmation),
      reply: redactSensitiveText(response.reply ?? "")
    },
    action_summary: actions.map((action) => ({
      type: action.type,
      field: action.field ?? null,
      step: action.step ?? null,
      label: action.label ?? null,
      has_value: action.value !== undefined || action.checked !== undefined
    })),
    improvement_signals: {
      no_answer: response.match_source === "deterministic_fallback",
      out_of_scope: response.scope === "out_of_scope",
      action_count: actions.length
    }
  };
}

export function redactSensitiveText(value) {
  return String(value)
    .replace(/[A-Z]{5}[0-9]{4}[A-Z]/gi, "[redacted_pan]")
    .replace(/\b[2-9][0-9]{3}\s?[0-9]{4}\s?[0-9]{4}\b/g, "[redacted_aadhaar]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted_email]")
    .replace(/\b(?:\+91[-\s]?)?[6-9][0-9]{9}\b/g, "[redacted_phone]");
}
