import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const MAX_JSON_BODY_BYTES = 512 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 1_000;
const AUDIT_DIR = path.join(tmpdir(), "tax-calculator-audit");
const AUDIT_LOG_PATH = path.join(AUDIT_DIR, "audit.jsonl");

const rateBuckets = new Map();
const metrics = {
  started_at: new Date().toISOString(),
  requests_total: 0,
  errors_total: 0,
  validation_failures_total: 0,
  import_previews_total: 0,
  report_generations_total: 0,
  by_route: {},
  recent_events: []
};

export class HttpError extends Error {
  constructor(statusCode, message, details = {}) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function securityHeaders(contentType) {
  return {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "content-security-policy": [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join("; ")
  };
}

export function enforceRateLimit(req, url) {
  if (!url.pathname.startsWith("/api/")) return;
  const clientId = clientFingerprint(req);
  const routeKey = `${clientId}:${req.method}:${url.pathname}`;
  const now = Date.now();
  const current = rateBuckets.get(routeKey);
  if (!current || now - current.window_start >= RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(routeKey, { window_start: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > RATE_LIMIT_MAX) {
    throw new HttpError(429, "Rate limit exceeded.", {
      window_ms: RATE_LIMIT_WINDOW_MS,
      max_requests: RATE_LIMIT_MAX
    });
  }
}

export async function appendAuditEvent({ route, method, status_code, request_body, response_body, duration_ms }) {
  await mkdir(AUDIT_DIR, { recursive: true });
  const event = {
    audit_id: randomUUID(),
    occurred_at: new Date().toISOString(),
    route,
    method,
    status_code,
    duration_ms,
    request: maskAuditPayload(request_body),
    response: summarizeResponse(response_body)
  };
  await appendFile(AUDIT_LOG_PATH, `${JSON.stringify(event)}\n`);
  return event.audit_id;
}

export function recordMetric({ route, method, status_code, duration_ms, response_body }) {
  metrics.requests_total += 1;
  if (status_code >= 400) metrics.errors_total += 1;
  if (response_body?.validation_status === "blocked" || response_body?.summary?.blockers > 0) {
    metrics.validation_failures_total += 1;
  }
  if (route === "/api/v1/imports/preview") metrics.import_previews_total += 1;
  if (route === "/api/v1/reports/explain") metrics.report_generations_total += 1;

  const key = `${method} ${route}`;
  const bucket = metrics.by_route[key] ?? {
    count: 0,
    errors: 0,
    total_duration_ms: 0,
    max_duration_ms: 0
  };
  bucket.count += 1;
  if (status_code >= 400) bucket.errors += 1;
  bucket.total_duration_ms += duration_ms;
  bucket.max_duration_ms = Math.max(bucket.max_duration_ms, duration_ms);
  bucket.average_duration_ms = Math.round(bucket.total_duration_ms / bucket.count);
  metrics.by_route[key] = bucket;

  metrics.recent_events.unshift({
    occurred_at: new Date().toISOString(),
    route,
    method,
    status_code,
    duration_ms
  });
  metrics.recent_events = metrics.recent_events.slice(0, 20);
}

export function getMetrics() {
  return {
    status: "ok",
    metrics_version: "sprint7-v1",
    ...metrics,
    security: {
      headers: "enabled",
      json_body_limit_bytes: MAX_JSON_BODY_BYTES,
      rate_limit_window_ms: RATE_LIMIT_WINDOW_MS,
      rate_limit_max_requests: RATE_LIMIT_MAX
    },
    audit_log_path: AUDIT_LOG_PATH
  };
}

export function getPrivacyPolicy() {
  return {
    status: "ok",
    privacy_version: "sprint7-v1",
    data_categories: [
      { category: "profile", purpose: "Select applicable tax rules", examples: ["age", "residency", "taxpayer type"], retention: "browser draft until user deletion" },
      { category: "income", purpose: "Calculate tax and compare regimes", examples: ["salary", "capital gains", "business receipts"], retention: "browser draft until user deletion" },
      { category: "deductions_and_credits", purpose: "Calculate tax base and payable/refund", examples: ["80C", "80D", "TDS"], retention: "browser draft until user deletion" },
      { category: "browser_state", purpose: "Keep the local workflow usable on this device", examples: ["selected start path", "guided checklist", "saved scenarios", "AI review context"], retention: "browser localStorage until user deletion or browser clearing" },
      { category: "imports", purpose: "Prefill fields after user review", examples: ["CSV/JSON rows", "mapping confidence"], retention: "encrypted local artifact for 7 days" },
      { category: "reports", purpose: "User review and support trace", examples: ["worksheet", "rulepack version", "computation hash"], retention: "browser download controlled by user" },
      { category: "audit_logs", purpose: "Operational trace without raw tax values", examples: ["route", "status", "duration", "masked payload shape"], retention: "local development log rotation/manual cleanup" }
    ],
    user_controls: [
      "Export current browser-held draft/report/import metadata.",
      "Delete local browser draft, selected start path, saved scenarios, AI review context, report, and import preview state.",
      "Imports require explicit confirmation before prefilling calculator fields."
    ],
    pii_masking: "Audit logs mask raw field values and store only payload shape or redacted markers; browser-held data stays on this device unless the user exports or deletes it."
  };
}

export function buildPrivacyExport(payload = {}) {
  return {
    status: "ok",
    export_version: "sprint7-v1",
    exported_at: new Date().toISOString(),
    package: {
      profile: payload.profile ?? null,
      draft: payload.draft ?? null,
      report_metadata: payload.report_metadata ?? null,
      import_metadata: payload.import_metadata ?? null
    },
    note: "Server stores no durable user profile in the dependency-free build; browser-held data is exported by the client."
  };
}

export function buildDeletionWorkflow() {
  return {
    status: "ok",
    deletion_version: "sprint7-v1",
    server_records_deleted: 0,
    browser_actions: [
      "Clear tax-wizard-draft from localStorage.",
      "Clear tax-wizard-checks from localStorage.",
      "Clear selected start path, saved scenarios, AI review context, and review dismissals from localStorage.",
      "Clear any unsaved report or import preview state from memory."
    ],
    import_artifact_retention: "Encrypted local import artifacts expire after 7 days in this dependency-free build.",
    note: "No authenticated saved profile store exists yet."
  };
}

export function getRunbook() {
  return {
    status: "ok",
    runbook_version: "sprint7-v1",
    rulepack_activation_checklist: [
      "Every active rule references a source_register source ID.",
      "Source register retrieval date and confidence are reviewed.",
      "All golden vectors pass at 100 percent.",
      "Validation warning parity is checked.",
      "Rollback rulepack remains available before activation."
    ],
    rollback_process: [
      "Mark faulty rulepack deprecated.",
      "Reactivate previous known-good rulepack.",
      "Rerun golden vectors and affected import/report tests.",
      "Publish incident note with rulepack ID and computation hash examples."
    ],
    incident_runbook: [
      "Classify as calculation, validation, import, report, security, or privacy incident.",
      "Capture computation hash, rulepack version, source register version, and masked audit ID.",
      "Freeze affected rulepack or endpoint if high severity.",
      "Patch, rerun regression, and document customer impact."
    ]
  };
}

export function maskAuditPayload(value) {
  if (value === undefined || value === null) return value;
  if (Array.isArray(value)) return value.map(maskAuditPayload);
  if (typeof value !== "object") {
    if (typeof value === "number") return "[number]";
    if (typeof value === "string") return value.length > 0 ? "[redacted]" : "";
    if (typeof value === "boolean") return value;
    return "[redacted]";
  }

  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (["content", "import_content", "content_base64", "extracted_text_preview", "structured_content"].includes(key)) return [key, "[redacted_content]"];
    if (["pan", "aadhaar", "mobile", "email", "name", "employer_name", "payer"].includes(key.toLowerCase())) {
      return [key, "[redacted_pii]"];
    }
    return [key, maskAuditPayload(item)];
  }));
}

export function getAuditLogPath() {
  return AUDIT_LOG_PATH;
}

function summarizeResponse(response) {
  if (!response || typeof response !== "object") return response;
  return {
    status: response.status,
    rulepack_version: response.rulepack_version ?? response.metadata?.rulepack_version,
    validation_status: response.validation_status,
    warning_count: Array.isArray(response.warnings) ? response.warnings.length : undefined,
    import_id: response.import_id,
    report_version: response.report_version,
    metrics_version: response.metrics_version
  };
}

function clientFingerprint(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const source = Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket.remoteAddress || "local";
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}
