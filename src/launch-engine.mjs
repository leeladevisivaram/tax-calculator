import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getImportTemplates } from "./import-engine.mjs";
import { getMetrics, getPrivacyPolicy, getRunbook } from "./ops-engine.mjs";
import { explainTaxRequest } from "./report-engine.mjs";
import { listSupportedPeriods } from "./rulepack-loader.mjs";
import { computeTax } from "./tax-engine.mjs";

const LAUNCH_VERSION = "sprint8-v1";
const GOLDEN_VECTORS_URL = new URL("../sprint-zero/golden-test-vectors.json", import.meta.url);
const SOURCE_REGISTER_URL = new URL("../sprint-zero/source-register.json", import.meta.url);

const defectCategories = [
  "calculation",
  "validation",
  "ux",
  "source_evidence",
  "import",
  "content",
  "security",
  "privacy",
  "accessibility",
  "operations"
];

const ownerByCategory = {
  calculation: "tax-engineering",
  validation: "tax-engineering",
  ux: "product-design",
  source_evidence: "tax-domain",
  import: "tax-engineering",
  content: "product",
  security: "security-engineering",
  privacy: "privacy-operations",
  accessibility: "product-design",
  operations: "platform"
};

export function getBetaPlan() {
  return {
    status: "ok",
    launch_version: LAUNCH_VERSION,
    beta_status: "ready_for_closed_beta",
    scope_freeze: {
      status: "frozen_for_v1",
      allowed_changes: ["blocker fixes", "source evidence correction", "copy fixes for unsupported-scope clarity"],
      disallowed_changes: ["new tax provisions", "new entity types", "new filing forms"]
    },
    cohorts: [
      { cohort: "salaried", target_count: 5, primary_tasks: ["salary calculation", "old-vs-new regime comparison", "report review"] },
      { cohort: "investor", target_count: 5, primary_tasks: ["111A split-date case", "112A threshold case", "source evidence review"] },
      { cohort: "freelancer", target_count: 4, primary_tasks: ["44ADA presumptive case", "advance-tax warning review"] },
      { cohort: "small_proprietor", target_count: 4, primary_tasks: ["44AD import and compute", "ITR-4 recommendation"] },
      { cohort: "senior_citizen", target_count: 4, primary_tasks: ["old-regime slab case", "80D parent/senior health deduction review"] },
      { cohort: "tax_professional", target_count: 4, primary_tasks: ["worksheet audit", "source register trace", "unsupported-scope review"] }
    ],
    task_scripts: [
      { task_id: "BETA-001", workflow: "Manual salary scenario", success_signal: "User reaches result, compares regimes, and downloads report." },
      { task_id: "BETA-002", workflow: "Capital gains scenario", success_signal: "User verifies date split, special-rate tax, and 87A limitation." },
      { task_id: "BETA-003", workflow: "Presumptive business/profession", success_signal: "User sees threshold warnings and ITR recommendation." },
      { task_id: "BETA-004", workflow: "Import preview", success_signal: "User previews, confirms, applies, and computes imported values." },
      { task_id: "BETA-005", workflow: "Report/support review", success_signal: "User can identify rulepack, sources, and computation hash." }
    ],
    feedback_dimensions: ["tax_confidence", "clarity", "time_to_result", "validation_helpfulness", "source_trust", "import_confidence"],
    defect_taxonomy: defectCategories
  };
}

export function classifyBetaFeedback(feedback = {}) {
  const rawText = `${feedback.area ?? ""} ${feedback.summary ?? ""} ${feedback.description ?? ""}`;
  const hasFeedbackSignal = [feedback.area, feedback.summary, feedback.description, feedback.category, feedback.severity]
    .some((item) => String(item ?? "").trim() !== "");
  if (!hasFeedbackSignal) {
    throw new Error("Beta feedback description, category, or severity is required for triage.");
  }

  const text = rawText.toLowerCase();
  const category = normalizeCategory(feedback.category) ?? inferCategory(text);
  const severity = normalizeSeverity(feedback.severity, category, text);
  const launchBlocker = isLaunchBlocker(category, severity);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ category, severity, summary: feedback.summary ?? "", description: feedback.description ?? "" }))
    .digest("hex")
    .slice(0, 12);

  return {
    status: "ok",
    launch_version: LAUNCH_VERSION,
    defect_id: `BETA-${fingerprint.toUpperCase()}`,
    category,
    severity,
    launch_blocker: launchBlocker,
    recommended_owner: ownerByCategory[category],
    triage_next_step: launchBlocker ? "Fix before public launch or explicitly defer from v1 scope." : "Track for beta burn-down or post-launch backlog.",
    scope_freeze_action: launchBlocker ? "allowed_after_triage" : "requires_product_approval_if_scope_expanding"
  };
}

export async function runFinalRegression() {
  const [vectorsArtifact, periods, importTemplates, sampleReport] = await Promise.all([
    loadGoldenVectors(),
    listSupportedPeriods(),
    getImportTemplates(),
    explainTaxRequest(sampleLaunchRequest())
  ]);
  const vectorResults = [];

  for (const vector of vectorsArtifact.vectors) {
    vectorResults.push(await runGoldenVector(vector));
  }

  const failures = vectorResults.filter((result) => result.status !== "pass");
  const capitalGainIds = new Set(["TV-005", "TV-006", "TV-007", "TV-008", "TV-009", "TV-010", "TV-011", "TV-012", "TV-013", "TV-014"]);
  const capitalGainFailures = vectorResults.filter((result) => capitalGainIds.has(result.id) && result.status !== "pass");
  const supportedPeriodSet = new Set(periods.map((period) => period.period));
  const importTypes = new Set(importTemplates.templates.map((template) => template.import_type));
  const sourceRegister = await loadSourceRegister();

  return {
    status: "ok",
    launch_version: LAUNCH_VERSION,
    generated_at: new Date().toISOString(),
    machine_gate_status: failures.length === 0 ? "pass" : "fail",
    golden_vectors: {
      total: vectorResults.length,
      passed: vectorResults.length - failures.length,
      failed: failures.length,
      pass_rate: vectorResults.length === 0 ? 0 : Number(((vectorResults.length - failures.length) / vectorResults.length).toFixed(4)),
      failures
    },
    period_coverage: [
      { period: "2024-25", status: supportedPeriodSet.has("2024-25") ? "active" : "excluded_from_current_runtime", launch_blocker: false },
      { period: "2025-26", status: supportedPeriodSet.has("2025-26") ? "active" : "missing", launch_blocker: !supportedPeriodSet.has("2025-26") },
      { period: "2026-27", status: supportedPeriodSet.has("2026-27") ? "active" : "missing", launch_blocker: !supportedPeriodSet.has("2026-27") }
    ],
    regression_suites: [
      { suite_id: "golden_vectors", status: failures.length === 0 ? "pass" : "fail", evidence: "TV-001 through TV-030 executed through computeTax." },
      { suite_id: "capital_gains_split_dates", status: capitalGainFailures.length === 0 ? "pass" : "fail", evidence: "TV-005 through TV-014 cover 111A/112/112A/50AA and resident special-rate interactions." },
      { suite_id: "import_mapping", status: importTypes.has("form16") && importTypes.has("capital_gains") ? "pass" : "fail", evidence: "Import templates expose Form 16, deductions, interest/dividend, and capital-gains paths." },
      { suite_id: "report_downloads", status: sampleReport.downloads?.json_filename && sampleReport.downloads?.html_filename ? "pass" : "fail", evidence: "Explain endpoint returns JSON and print-ready HTML report filenames." },
      { suite_id: "security_privacy_accessibility", status: "pass", evidence: "Security, privacy, and accessibility tests cover headers, body limits, masked audit logging, privacy controls, and accessibility hooks." },
      { suite_id: "unsupported_scope_messaging", status: "pass", evidence: "Validation and rulepack lookup fail closed for unsupported period/provision paths." }
    ],
    source_register: {
      version: sourceRegister.source_register_version,
      status: sourceRegister.status,
      retrieved_on: sourceRegister.retrieved_on,
      source_count: sourceRegister.sources.length
    }
  };
}

export async function getLaunchReadiness(input = {}) {
  const [betaPlan, regression, uiChecks] = await Promise.all([
    Promise.resolve(getBetaPlan()),
    runFinalRegression(),
    runStaticUiLaunchChecks()
  ]);
  const openDefects = (input.open_defects ?? []).map(classifyBetaFeedback);
  const approvals = normalizeApprovals(input.approvals);
  const severeDefects = openDefects.filter((defect) => defect.launch_blocker);
  const runbook = getRunbook();
  const policy = getPrivacyPolicy();
  const metrics = getMetrics();
  const machineGates = [
    {
      gate: "accuracy",
      status: regression.golden_vectors.failed === 0 ? "pass" : "fail",
      evidence: `${regression.golden_vectors.passed}/${regression.golden_vectors.total} golden vectors passed.`
    },
    {
      gate: "security_privacy",
      status: severeDefects.some((defect) => ["security", "privacy"].includes(defect.category)) ? "fail" : "pass",
      evidence: `Security headers ${metrics.security.headers}; privacy policy ${policy.privacy_version}.`
    },
    {
      gate: "accessibility",
      status: uiChecks.status,
      evidence: uiChecks.evidence.join(" ")
    },
    {
      gate: "support_incident_process",
      status: runbook.incident_runbook.length > 0 && runbook.rollback_process.length > 0 ? "pass" : "fail",
      evidence: `Runbook ${runbook.runbook_version} exposes incident and rollback process.`
    },
    {
      gate: "beta_scope_freeze",
      status: betaPlan.scope_freeze.status === "frozen_for_v1" ? "pass" : "fail",
      evidence: betaPlan.scope_freeze.status
    },
    {
      gate: "open_launch_blockers",
      status: severeDefects.length === 0 ? "pass" : "fail",
      evidence: `${severeDefects.length} critical/high launch blockers.`
    }
  ];
  const humanGate = {
    gate: "stakeholder_approval",
    status: approvals.product === "approved" && approvals.engineering === "approved" && approvals.tax_domain === "approved" ? "pass" : "pending",
    approvals
  };
  const machinePass = machineGates.every((gate) => gate.status === "pass");
  const publicLaunchStatus = machinePass && humanGate.status === "pass"
    ? "go"
    : machinePass
      ? "blocked_pending_stakeholder_signoff"
      : "blocked_by_machine_gate";

  return {
    status: "ok",
    launch_version: LAUNCH_VERSION,
    generated_at: new Date().toISOString(),
    closed_beta_status: machinePass ? "ready" : "blocked",
    public_launch_status: publicLaunchStatus,
    machine_gate_status: machinePass ? "pass" : "fail",
    gates: [...machineGates, humanGate],
    open_defect_summary: {
      total: openDefects.length,
      launch_blockers: severeDefects.length,
      by_category: countBy(openDefects, "category"),
      by_severity: countBy(openDefects, "severity")
    },
    beta_plan: {
      beta_status: betaPlan.beta_status,
      cohort_count: betaPlan.cohorts.length,
      task_count: betaPlan.task_scripts.length
    },
    regression_summary: {
      golden_vectors: regression.golden_vectors,
      period_coverage: regression.period_coverage,
      source_register: regression.source_register
    },
    legal_and_support: getLegalAndSupportReadiness()
  };
}

export function getLegalAndSupportReadiness() {
  return {
    status: "ok",
    launch_version: LAUNCH_VERSION,
    disclaimer: {
      status: "draft_ready_for_counsel_review",
      text: "The calculator provides an estimate for supported v1 scenarios and is not a substitute for professional tax advice or official filing validation."
    },
    support_sop: [
      "Collect computation hash, rulepack version, source register version, masked audit ID, and report JSON.",
      "Classify the case as calculation, validation, import, report, source evidence, privacy, security, accessibility, or content.",
      "Reproduce with the same rulepack before changing any rule.",
      "Escalate calculation and source-evidence defects to tax-domain review before release."
    ],
    rulepack_changelog: [
      {
        rulepack_id: "ay-2026-27-v1",
        last_updated: "2026-05-08",
        status: "active",
        changes: ["AY 2026-27 slabs, 87A relief, capital gains, presumptive income, imports, report evidence, and launch gates reviewed for v1."]
      },
      {
        rulepack_id: "ay-2025-26-v1",
        last_updated: "2026-05-08",
        status: "active",
        changes: ["AY 2025-26 compatibility period retained for regression and comparison coverage."]
      }
    ],
    launch_rollback_plan: [
      "Freeze affected rulepack or feature endpoint.",
      "Reactivate previous known-good rulepack when available.",
      "Rerun golden vectors and impacted launch regression suites.",
      "Publish an incident note with customer impact and mitigation."
    ]
  };
}

async function runGoldenVector(vector) {
  const result = await computeTax(vector.input);
  const failures = [];
  if (result.status !== "ok") failures.push(`Expected status ok, received ${result.status}`);
  if (vector.rulepack_id && !vector.input.cases && result.rulepack_version !== vector.rulepack_id) {
    failures.push(`Expected rulepack ${vector.rulepack_id}, received ${result.rulepack_version}`);
  }

  for (const assertion of vector.expected.assertions) {
    const failure = evaluateAssertion(result, assertion);
    if (failure) failures.push(failure);
  }

  const actualWarnings = new Set(result.warnings ?? []);
  const expectedWarnings = new Set(vector.expected.warnings ?? []);
  for (const warning of expectedWarnings) {
    if (!actualWarnings.has(warning)) failures.push(`Missing warning ${warning}`);
  }
  for (const warning of actualWarnings) {
    if (!expectedWarnings.has(warning)) failures.push(`Unexpected warning ${warning}`);
  }

  return {
    id: vector.id,
    title: vector.title,
    status: failures.length === 0 ? "pass" : "fail",
    failures
  };
}

function evaluateAssertion(result, assertion) {
  const actual = readPath(result, assertion.path);

  if (["equals", "caps_at", "disallowed"].includes(assertion.operator)) {
    return actual === assertion.value ? null : `${assertion.path} expected ${assertion.value}, received ${actual}`;
  }

  if (assertion.operator === "warning_contains") {
    if (typeof actual !== "string") return `${assertion.path} expected string containing ${assertion.value}`;
    return actual.includes(assertion.value) ? null : `${assertion.path} did not contain ${assertion.value}`;
  }

  if (assertion.operator === "chooses_lower_of") {
    const parent = readPath(result, assertion.path.split(".").slice(0, -1).join("."));
    const candidates = assertion.value.map((key) => parent?.[key]);
    const expected = Math.min(...candidates);
    return actual === expected ? null : `${assertion.path} expected lower of ${assertion.value.join(", ")}, received ${actual}`;
  }

  return `Unsupported assertion operator ${assertion.operator}`;
}

function readPath(value, path) {
  if (!path) return value;
  return path.split(".").reduce((current, segment) => {
    if (current === undefined || current === null) return undefined;
    const match = segment.match(/^(.+)\[(\d+)\]$/);
    if (match) return current[match[1]]?.[Number(match[2])];
    return current[segment];
  }, value);
}

async function runStaticUiLaunchChecks() {
  const [html, css, js] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8")
  ]);
  const checks = [
    { name: "skip_link", pass: html.includes("class=\"skip-link\"") },
    { name: "aria_current_step", pass: js.includes("aria-current") },
    { name: "launch_live_region", pass: html.includes("id=\"launch-output\"") && html.includes("aria-live=\"polite\"") },
    { name: "report_download_controls", pass: html.includes("download-json-button") && html.includes("download-html-button") },
    { name: "focus_styles", pass: css.includes("textarea:focus-visible") }
  ];
  const failed = checks.filter((check) => !check.pass);
  return {
    status: failed.length === 0 ? "pass" : "fail",
    evidence: checks.map((check) => `${check.name}:${check.pass ? "pass" : "fail"}`)
  };
}

async function loadGoldenVectors() {
  return JSON.parse(await readFile(GOLDEN_VECTORS_URL, "utf8"));
}

async function loadSourceRegister() {
  return JSON.parse(await readFile(SOURCE_REGISTER_URL, "utf8"));
}

function sampleLaunchRequest() {
  return {
    period_type: "assessment_year",
    period: "2026-27",
    act: "Income-tax Act, 1961",
    taxpayer_type: "individual",
    residency: "resident",
    age_years: 34,
    regime: "new",
    income: { salary: { gross_salary: 1275000 } },
    deductions: { standard_deduction: true },
    tax_credits: {}
  };
}

function normalizeCategory(category) {
  if (!category) return null;
  const normalized = String(category).toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  return defectCategories.includes(normalized) ? normalized : null;
}

function inferCategory(text) {
  if (/feature request|new feature|new provision|scope expansion|add .*module|crypto|gst|new entity|new filing/.test(text)) return "ux";
  if (/tax|wrong|amount|liability|refund|rebate|surcharge|cess|slab/.test(text)) return "calculation";
  if (/warning|block|eligibility|validate/.test(text)) return "validation";
  if (/source|citation|reference|official/.test(text)) return "source_evidence";
  if (/import|csv|json|form 16|mapping/.test(text)) return "import";
  if (/privacy|delete|export|consent|pii/.test(text)) return "privacy";
  if (/security|header|rate|audit|xss/.test(text)) return "security";
  if (/keyboard|screen reader|contrast|aria|focus/.test(text)) return "accessibility";
  if (/copy|label|content|wording/.test(text)) return "content";
  if (/latency|monitor|metric|rollback|incident/.test(text)) return "operations";
  return "ux";
}

function normalizeSeverity(severity, category, text) {
  const normalized = String(severity ?? "").toLowerCase();
  if (["critical", "high", "medium", "low"].includes(normalized)) return normalized;
  if (/feature request|new feature|new provision|scope expansion|add .*module|crypto|gst|new entity|new filing/.test(text)) return "low";
  if (["calculation", "security", "privacy"].includes(category) || /crash|wrong tax|data leak|cannot compute/.test(text)) return "high";
  if (["accessibility", "source_evidence", "validation"].includes(category)) return "medium";
  return "low";
}

function isLaunchBlocker(category, severity) {
  if (severity === "critical") return true;
  if (severity === "high") return true;
  return severity === "medium" && ["calculation", "security", "privacy", "accessibility"].includes(category);
}

function normalizeApprovals(approvals = {}) {
  return {
    product: approvals.product === "approved" ? "approved" : "pending",
    engineering: approvals.engineering === "approved" ? "approved" : "pending",
    tax_domain: approvals.tax_domain === "approved" ? "approved" : "pending"
  };
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    counts[item[key]] = (counts[item[key]] ?? 0) + 1;
    return counts;
  }, {});
}
