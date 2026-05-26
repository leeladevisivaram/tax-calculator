export const APPLICATION_CLASSIFICATION_VERSION = "app-classification-v1";

const MODULE_CLASSIFICATIONS = [
  {
    id: "api_shell",
    name: "HTTP API shell",
    layer: "interface",
    risk_level: "high",
    files: ["src/server.mjs", "src/request-contracts.mjs"],
    endpoints: ["/health", "/api/v1/*"],
    responsibility: "Route requests, enforce API body contracts, return JSON, serve the static browser shell, and record audit/metrics.",
    robustness_controls: ["JSON size limit", "malformed JSON error codes", "method allowlist", "security headers", "rate limiting"],
    test_surfaces: ["testing/tests/smoke.test.mjs", "testing/tests/robustness-classification.test.mjs", "testing/tests/sprint7.test.mjs"]
  },
  {
    id: "tax_engine",
    name: "Tax computation engine",
    layer: "domain",
    risk_level: "critical",
    files: ["src/tax-engine.mjs", "src/rulepack-loader.mjs", "data/rulepacks/*.json", "sprint-zero/golden-test-vectors.json"],
    endpoints: ["/api/v1/tax/compute", "/api/v1/tax/compare-regimes", "/api/v1/rules/periods"],
    responsibility: "Compute supported tax scenarios using rulepacks and golden-vector-verified business logic.",
    robustness_controls: ["rulepack schema checks", "source-linked rules", "golden-vector regression", "computation hash"],
    test_surfaces: ["testing/tests/sprint1.test.mjs", "testing/tests/tax-edge-coverage.test.mjs", "testing/tests/regression.test.mjs"]
  },
  {
    id: "validation",
    name: "Scenario validation",
    layer: "domain",
    risk_level: "critical",
    files: ["src/validation-engine.mjs", "public/ui-validation.js"],
    endpoints: ["/api/v1/tax/validate"],
    responsibility: "Block unsupported scenarios, warn about risky inputs, and keep UI actions from running with missing required controls.",
    robustness_controls: ["blocker/warning taxonomy", "field-path remediation", "first-error focus", "required UI selector checks"],
    test_surfaces: ["testing/tests/validation.test.mjs", "testing/tests/sprint3.test.mjs"]
  },
  {
    id: "imports",
    name: "Structured import and PDF extraction",
    layer: "ingestion",
    risk_level: "high",
    files: ["src/import-engine.mjs", "src/pdf-import-engine.mjs"],
    endpoints: ["/api/v1/imports/templates", "/api/v1/imports/preview", "/api/v1/imports/pdf-extract"],
    responsibility: "Convert CSV, JSON, and searchable Form 16 PDFs into reviewable request patches without silently applying values.",
    robustness_controls: ["extension allowlist", "file size limits", "encrypted local artifacts", "field confidence", "manual confirmation"],
    test_surfaces: ["testing/tests/sprint6.test.mjs", "testing/tests/ai-review.test.mjs", "testing/tests/e2e/beginner-vnext.spec.mjs"]
  },
  {
    id: "guided_accuracy",
    name: "AI review and anomaly guidance",
    layer: "assistant",
    risk_level: "high",
    files: ["src/ai-review-engine.mjs"],
    endpoints: ["/api/v1/ai/review-scenario"],
    responsibility: "Run local-first readiness, confidence, missing-field, anomaly, and import-confidence checks over the current scenario.",
    robustness_controls: ["deterministic rules", "no hosted token requirement", "existing tax engine reuse", "dismissible findings"],
    test_surfaces: ["testing/tests/ai-review.test.mjs", "testing/tests/e2e/beginner-vnext.spec.mjs"]
  },
  {
    id: "chatbot",
    name: "Step-aware calculator assistant",
    layer: "assistant",
    risk_level: "medium",
    files: ["src/chatbot-engine.mjs", "src/chatbot-knowledge.mjs", "src/chatbot-interactions.mjs", "data/chat-interactions/*.jsonl"],
    endpoints: ["/api/v1/chatbot/message"],
    responsibility: "Answer app-help questions, surface step-aware prompts, and log masked interactions for quality evaluation.",
    robustness_controls: ["guardrail responses", "local knowledge retrieval", "masked interaction log", "quick action preview"],
    test_surfaces: ["testing/tests/chatbot.test.mjs", "testing/tests/e2e/chatbot-ui.spec.mjs"]
  },
  {
    id: "reports",
    name: "Explainable reports and sources",
    layer: "evidence",
    risk_level: "high",
    files: ["src/report-engine.mjs", "sprint-zero/source-register.json"],
    endpoints: ["/api/v1/reports/explain", "/api/v1/sources/:sourceId"],
    responsibility: "Generate user-readable worksheets, rule traces, source evidence, and downloadable report artifacts.",
    robustness_controls: ["source register lookup", "worksheet line traces", "report metadata", "downloadable JSON/HTML"],
    test_surfaces: ["testing/tests/sprint5.test.mjs", "testing/tests/sprint5-uat.test.mjs"]
  },
  {
    id: "operations_privacy_launch",
    name: "Operations, privacy, and launch readiness",
    layer: "governance",
    risk_level: "medium",
    files: ["src/ops-engine.mjs", "src/launch-engine.mjs"],
    endpoints: ["/api/v1/privacy/*", "/api/v1/ops/*", "/api/v1/launch/*"],
    responsibility: "Expose privacy controls, masked auditability, metrics, launch gates, beta triage, and rollback runbooks.",
    robustness_controls: ["masked audit payloads", "local privacy export/delete workflow", "launch blockers", "defect taxonomy"],
    test_surfaces: ["testing/tests/sprint7.test.mjs", "testing/tests/sprint8.test.mjs", "testing/tests/regression.test.mjs"]
  },
  {
    id: "tooling_quality",
    name: "Developer tooling and deploy hygiene",
    layer: "governance",
    risk_level: "medium",
    files: ["package.json", ".gitignore", "scripts/check-syntax.mjs", "scripts/run-tests-with-report.mjs", "playwright.config.mjs"],
    endpoints: [],
    responsibility: "Keep local checks, generated outputs, and deploy-time repository hygiene predictable as the app grows.",
    robustness_controls: ["dynamic syntax check discovery", "test report generation", "ignored local artifacts", "pinned Node runtime"],
    test_surfaces: ["testing/tests/sanity.test.mjs"]
  },
  {
    id: "browser_ui",
    name: "Beginner-friendly browser UI",
    layer: "experience",
    risk_level: "high",
    files: ["public/index.html", "public/app.js", "public/storage-state.js", "public/styles.css"],
    endpoints: ["/", "/index.html", "/styles.css", "/app.js", "/ui-validation.js", "/storage-state.js"],
    responsibility: "Guide users through persona onboarding, step health, import review, computation, what-if comparison, chatbot prompts, and isolated browser storage parsing.",
    robustness_controls: ["stable test IDs", "local-storage guards", "reduced-motion CSS", "context-aware action hints"],
    test_surfaces: ["testing/tests/e2e/ui-bvt.spec.mjs", "testing/tests/e2e/ui-regression.spec.mjs", "testing/tests/e2e/beginner-vnext.spec.mjs"]
  }
];

const RECOMMENDED_NEXT_WORK = [
  "Adopt a runtime schema validator only when dependency policy allows it; dependency-free API contracts are available now.",
  "Continue routing money normalization through src/money.mjs before expanding to high-value complex scenarios.",
  "Keep PDF OCR out of the default path until a bounded offline OCR pipeline is available.",
  "Continue splitting public/app.js by feature with native ES modules before adding a bundler; keep current test IDs stable.",
  "Add mutation-style tests around validation and AI-review findings before changing tax-rule scope."
];

export function getApplicationClassification() {
  const modules = MODULE_CLASSIFICATIONS.map(cloneClassification);
  return {
    status: "ok",
    classification_version: APPLICATION_CLASSIFICATION_VERSION,
    product: "Beginner-friendly Indian tax calculator",
    architecture_style: "dependency-light Node API plus vanilla browser UI",
    principles: [
      "The backend tax engine remains the only source of tax math.",
      "Imports and AI review suggest values or findings; users confirm before values are applied.",
      "Beginner guidance should clarify state and next action without expanding tax-law scope.",
      "Operational records must avoid raw PII and raw import content."
    ],
    layers: summarizeLayers(modules),
    modules,
    recommended_next_work: RECOMMENDED_NEXT_WORK
  };
}

export function classifyCodePart(part) {
  const target = String(part ?? "").trim().toLowerCase();
  if (!target) return null;

  const exactModule = MODULE_CLASSIFICATIONS.find((item) => {
    return item.id.toLowerCase() === target ||
      item.name.toLowerCase() === target ||
      item.files.some((file) => file.toLowerCase() === target || target.endsWith(`/${file.toLowerCase()}`)) ||
      item.endpoints.some((endpoint) => endpoint.toLowerCase() === target);
  });
  if (exactModule) return cloneClassification(exactModule);

  const module = MODULE_CLASSIFICATIONS
    .map((item) => ({ item, score: bestPatternScore(target, item) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.item;

  return module ? cloneClassification(module) : null;
}

function summarizeLayers(modules) {
  const layers = new Map();
  for (const module of modules) {
    const current = layers.get(module.layer) ?? { layer: module.layer, modules: [], highest_risk_level: "low" };
    current.modules.push(module.id);
    current.highest_risk_level = higherRisk(current.highest_risk_level, module.risk_level);
    layers.set(module.layer, current);
  }
  return [...layers.values()];
}

function higherRisk(left, right) {
  const rank = { low: 0, medium: 1, high: 2, critical: 3 };
  return rank[right] > rank[left] ? right : left;
}

function matchesPattern(target, pattern) {
  if (pattern.endsWith("/*")) return target.startsWith(pattern.slice(0, -1));
  if (pattern.includes("*")) {
    const [prefix, suffix] = pattern.split("*");
    return target.startsWith(prefix) && target.endsWith(suffix);
  }
  if (pattern.includes(":")) {
    const prefix = pattern.slice(0, pattern.indexOf(":"));
    return target.startsWith(prefix);
  }
  return target === pattern || target.endsWith(`/${pattern}`);
}

function bestPatternScore(target, item) {
  const patterns = [...item.files, ...item.endpoints].map((value) => value.toLowerCase());
  return patterns.reduce((best, pattern) => {
    return matchesPattern(target, pattern) ? Math.max(best, pattern.replaceAll("*", "").length) : best;
  }, 0);
}

function cloneClassification(item) {
  return {
    ...item,
    files: [...item.files],
    endpoints: [...item.endpoints],
    robustness_controls: [...item.robustness_controls],
    test_surfaces: [...item.test_surfaces]
  };
}
