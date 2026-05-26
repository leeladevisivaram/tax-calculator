import { computeTax } from "./tax-engine.mjs";
import { validateTaxRequest } from "./validation-engine.mjs";
import { toRupees } from "./money.mjs";

export const AI_REVIEW_VERSION = "guided-accuracy-v1";

const FIELD_STEP_HINTS = [
  [/^period_type$|^period$|^act$|^taxpayer_type$|^residency$|^age_years$|^regime$/, "profile"],
  [/^income\.salary|gross_salary|basic_salary|hra_received|rent_paid|lta_received/, "income"],
  [/^income\.house_property|self_occupied_interest|let_out_loss/, "income"],
  [/^income\.other_sources|interest_income/, "income"],
  [/^income\.capital_gains|capital_gain_/, "income"],
  [/^income\.business_profession|business_/, "income"],
  [/^deductions|deduction_/, "deductions"],
  [/^tax_credits|tds|tcs|advance_tax|self_assessment_tax/, "credits"],
  [/^import|pdf|extraction/, "imports"]
];

const REQUEST_WRAPPER_KEYS = new Set([
  "scenario",
  "request",
  "tax_request",
  "active_step",
  "import_extraction",
  "extraction",
  "previous_scenario",
  "dismissed_finding_ids"
]);

export function getAiReviewCapabilities() {
  return {
    status: "ok",
    review_version: AI_REVIEW_VERSION,
    runtime: "local_deterministic",
    hosted_api_required: false,
    model_required: false,
    uses_existing_engines: [
      "/api/v1/tax/validate",
      "/api/v1/tax/compute",
      "/api/v1/imports/pdf-extract"
    ],
    finding_types: ["missing_input", "validation", "anomaly", "import_confidence", "result_readiness"]
  };
}

export async function reviewScenario(request = {}) {
  const scenario = normalizeScenario(request);
  const activeStep = normalizeStep(request.active_step);
  const importExtraction = request.import_extraction ?? request.extraction ?? null;
  const previousScenario = request.previous_scenario ?? null;
  const dismissedFindingIds = new Set(Array.isArray(request.dismissed_finding_ids) ? request.dismissed_finding_ids : []);

  const validationReport = validateTaxRequest(scenario);
  const findings = [
    ...validationFindings(validationReport),
    ...scenarioFindings(scenario),
    ...duplicateFindings(scenario),
    ...importConfidenceFindings(importExtraction)
  ].filter((finding) => !dismissedFindingIds.has(finding.id));

  let computeResult = null;
  let computeError = null;
  if (validationReport.status === "ok") {
    try {
      computeResult = await computeTax({
        ...scenario,
        options: {
          ...(scenario.options ?? {}),
          include_validation: true
        }
      });
      findings.push(...resultFindings(scenario, computeResult, previousScenario));
    } catch (error) {
      computeError = error;
      findings.push(finding({
        id: "GA_COMPUTE_NOT_READY",
        severity: "blocker",
        category: "result_readiness",
        title: "Compute could not run",
        message: error?.message ?? "The current scenario could not be computed by the tax engine.",
        related_field_ids: ["results"],
        action: "Fix blocking validation messages, then run Compute again.",
        source: "tax_compute"
      }));
    }
  }

  const dedupedFindings = dedupeFindings(findings);
  const readiness = readinessFromFindings(dedupedFindings, computeResult);
  const confidenceScore = confidenceFromFindings(dedupedFindings, { computeResult, importExtraction });
  const suggestedActions = buildSuggestedActions(dedupedFindings, readiness, activeStep);

  return {
    status: "ok",
    review_version: AI_REVIEW_VERSION,
    ai: {
      runtime: "local_deterministic",
      hosted_api_required: false,
      model_required: false
    },
    active_step: activeStep,
    readiness,
    confidence_score: confidenceScore,
    confidence_label: confidenceLabel(confidenceScore),
    summary: summarizeFindings(dedupedFindings),
    findings: dedupedFindings,
    suggested_actions: suggestedActions,
    field_confidence: fieldConfidenceFromExtraction(importExtraction),
    support: {
      validation_status: validationReport.status,
      validation_summary: validationReport.summary,
      computed: Boolean(computeResult),
      compute_status: computeResult?.status ?? (computeError ? "blocked" : "not_run"),
      computation_hash: computeResult?.computation_hash ?? null,
      source: "existing_tax_engine"
    }
  };
}

function normalizeScenario(request) {
  const source = request.scenario ?? request.request ?? request.tax_request ?? request;
  const scenario = structuredClone(source ?? {});
  for (const key of REQUEST_WRAPPER_KEYS) {
    if (key in scenario) delete scenario[key];
  }
  return scenario;
}

function normalizeStep(step) {
  const value = String(step ?? "profile");
  return ["profile", "imports", "income", "deductions", "credits", "results", "launch"].includes(value)
    ? value
    : "profile";
}

function validationFindings(report) {
  return (report.results ?? []).map((result) => finding({
    id: `VAL_${result.code}_${result.field_path}`.replace(/[^A-Za-z0-9_]+/g, "_"),
    severity: result.severity === "blocker" ? "blocker" : result.severity === "warning" ? "warning" : "info",
    category: "validation",
    title: humanizeCode(result.code),
    message: `${result.field_path}: ${result.remediation_hint}`,
    related_field_ids: [result.field_path],
    action: result.remediation_hint,
    source: result.source_rule ?? "tax_validate"
  }));
}

function scenarioFindings(scenario) {
  const findings = [];
  const salary = scenario.income?.salary ?? {};
  const grossSalary = toRupees(salary.gross_salary);
  const tds = toRupees(scenario.tax_credits?.tds);
  const totalIncomeInput = approximateIncomeInput(scenario);
  const totalDeductions = sumDeductions(scenario.deductions?.chapter_via);
  const negativePaths = collectNegativeNumberPaths(scenario);

  if (totalIncomeInput <= 0) {
    findings.push(finding({
      id: "GA_INCOME_MISSING",
      severity: "blocker",
      category: "missing_input",
      title: "Income is missing",
      message: "Add at least one supported income value before relying on validation, compute, or comparison.",
      related_field_ids: ["income"],
      action: "Open Income and enter salary, interest, capital gains, house-property, or business values.",
      source: "guided_accuracy"
    }));
  }

  for (const path of negativePaths) {
    findings.push(finding({
      id: `GA_NEGATIVE_${path}`.replace(/[^A-Za-z0-9_]+/g, "_"),
      severity: "blocker",
      category: "anomaly",
      title: "Negative amount needs correction",
      message: `${path} is negative. Amount fields should use zero or a positive INR value in this calculator.`,
      related_field_ids: [path],
      action: "Replace the negative value with zero or a valid positive amount.",
      source: "guided_accuracy"
    }));
  }

  if (grossSalary >= 600000 && tds <= 0) {
    findings.push(finding({
      id: "GA_TDS_POSSIBLY_MISSING",
      severity: "warning",
      category: "anomaly",
      title: "TDS may be missing",
      message: "Gross salary is present but TDS is zero. If Form 16 shows tax deducted, enter it in Credits.",
      related_field_ids: ["tax_credits.tds"],
      action: "Check Form 16 or salary records and update TDS if applicable.",
      source: "guided_accuracy"
    }));
  }

  if (grossSalary > 0 && tds > grossSalary * 0.45) {
    findings.push(finding({
      id: "GA_TDS_HIGH_AGAINST_SALARY",
      severity: "warning",
      category: "anomaly",
      title: "TDS looks high against salary",
      message: "TDS is unusually high compared with gross salary. This may be correct, but it is worth reviewing the source amount.",
      related_field_ids: ["tax_credits.tds", "income.salary.gross_salary"],
      action: "Review the TDS value before applying the result.",
      source: "guided_accuracy"
    }));
  }

  if (grossSalary <= 0 && tds > 0) {
    findings.push(finding({
      id: "GA_CREDIT_WITHOUT_SALARY",
      severity: "info",
      category: "anomaly",
      title: "Credit entered without salary",
      message: "TDS is entered while salary is empty. If this credit belongs to another income head, keep the supporting income visible too.",
      related_field_ids: ["tax_credits.tds", "income"],
      action: "Add the related income head or confirm the credit source.",
      source: "guided_accuracy"
    }));
  }

  if (grossSalary >= 800000 && totalDeductions <= 0 && scenario.regime === "old") {
    findings.push(finding({
      id: "GA_OLD_REGIME_DEDUCTIONS_EMPTY",
      severity: "info",
      category: "anomaly",
      title: "Old-regime deductions are empty",
      message: "Old regime is selected with higher salary, but no Chapter VI-A deductions are entered. Keep this only if you have no supported claims.",
      related_field_ids: ["deductions.chapter_via"],
      action: "Review 80C, 80D, and related deduction fields if you expected to claim them.",
      source: "guided_accuracy"
    }));
  }

  if (scenario.regime === "new" && totalDeductions > 0) {
    findings.push(finding({
      id: "GA_NEW_REGIME_DEDUCTIONS_REVIEW",
      severity: "warning",
      category: "anomaly",
      title: "New-regime deduction claims need review",
      message: "Chapter VI-A deduction values are present while the new regime is selected. Validation will identify unsupported claims.",
      related_field_ids: ["deductions.chapter_via", "regime"],
      action: "Use Compare regimes or switch to old regime only if that reflects your intended scenario.",
      source: "guided_accuracy"
    }));
  }

  return findings;
}

function duplicateFindings(scenario) {
  const findings = [];
  const duplicateCapitalGain = firstDuplicate(scenario.income?.capital_gains ?? [], (item) => [
    item.section,
    item.transfer_date,
    toRupees(item.net_gain ?? item.gain_without_indexation),
    Boolean(item.stt_paid)
  ].join("|"));
  if (duplicateCapitalGain) {
    findings.push(finding({
      id: "GA_DUPLICATE_CAPITAL_GAIN",
      severity: "warning",
      category: "anomaly",
      title: "Duplicate-looking capital gain",
      message: "Two capital-gain rows have the same section, transfer date, gain, and STT status.",
      related_field_ids: ["income.capital_gains"],
      action: "Review capital-gain rows and remove any accidental duplicate.",
      source: "guided_accuracy"
    }));
  }

  const duplicateSource = firstDuplicate(scenario.income?.other_sources ?? [], (item) => [
    item.type,
    toRupees(item.amount)
  ].join("|"));
  if (duplicateSource) {
    findings.push(finding({
      id: "GA_DUPLICATE_OTHER_SOURCE",
      severity: "info",
      category: "anomaly",
      title: "Duplicate-looking other-source income",
      message: "Two other-source income rows have the same type and amount.",
      related_field_ids: ["income.other_sources"],
      action: "Review other-source rows if this was not intentional.",
      source: "guided_accuracy"
    }));
  }

  const duplicateDeduction = firstDuplicate(scenario.deductions?.chapter_via ?? [], (item) => [
    item.section,
    item.bucket,
    toRupees(item.amount),
    toRupees(item.premium),
    toRupees(item.preventive_checkup)
  ].join("|"));
  if (duplicateDeduction) {
    findings.push(finding({
      id: "GA_DUPLICATE_DEDUCTION",
      severity: "warning",
      category: "anomaly",
      title: "Duplicate-looking deduction",
      message: "Two deduction rows have the same section, bucket, and amount details.",
      related_field_ids: ["deductions.chapter_via"],
      action: "Review deductions and remove any accidental duplicate.",
      source: "guided_accuracy"
    }));
  }

  return findings;
}

function importConfidenceFindings(extraction) {
  if (!extraction) return [];
  const findings = [];
  for (const error of extraction.errors ?? []) {
    findings.push(finding({
      id: `GA_IMPORT_${error}`.replace(/[^A-Za-z0-9_]+/g, "_"),
      severity: "blocker",
      category: "import_confidence",
      title: "PDF extraction needs review",
      message: `Import extraction returned ${error}.`,
      related_field_ids: ["import.extraction"],
      action: "Review the extracted values or paste CSV/JSON values manually.",
      source: "pdf_import"
    }));
  }

  for (const field of extraction.missing_fields ?? []) {
    findings.push(finding({
      id: `GA_IMPORT_MISSING_${field}`.replace(/[^A-Za-z0-9_]+/g, "_"),
      severity: "warning",
      category: "import_confidence",
      title: "PDF field was not found",
      message: `${field} was not confidently extracted from the uploaded PDF.`,
      related_field_ids: [`import.${field}`],
      action: "Review the PDF text or enter this value manually before applying the import.",
      source: "pdf_import"
    }));
  }

  for (const item of extraction.review ?? []) {
    if (item.needsReview || item.confidence === "low") {
      findings.push(finding({
        id: `GA_IMPORT_LOW_CONFIDENCE_${item.field}`.replace(/[^A-Za-z0-9_]+/g, "_"),
        severity: item.needsReview ? "warning" : "info",
        category: "import_confidence",
        title: "Imported field needs review",
        message: `${item.field} was extracted with ${item.confidence ?? "unknown"} confidence.`,
        related_field_ids: [`import.${item.field}`],
        action: "Confirm the extracted value against the source PDF before applying it.",
        source: item.source ?? "pdf_import"
      }));
    }
  }
  return findings;
}

function resultFindings(scenario, computeResult, previousScenario) {
  const findings = [];
  const summary = computeResult?.summary;
  if (!summary) return findings;

  if ((computeResult.warnings ?? []).length > 0) {
    findings.push(finding({
      id: "GA_COMPUTE_WARNINGS_PRESENT",
      severity: "warning",
      category: "result_readiness",
      title: "Compute returned warnings",
      message: "The tax engine returned warnings for this scenario. Review them before relying on the result.",
      related_field_ids: ["results"],
      action: "Read the warnings and run Explain for worksheet-level detail.",
      source: "tax_compute"
    }));
  }

  if (previousScenario) {
    const previousIncome = approximateIncomeInput(previousScenario);
    const currentIncome = approximateIncomeInput(scenario);
    if (Math.abs(currentIncome - previousIncome) >= 500000) {
      findings.push(finding({
        id: "GA_SCENARIO_BIG_INCOME_CHANGE",
        severity: "info",
        category: "result_readiness",
        title: "Large income change from saved scenario",
        message: "Current income differs substantially from the saved scenario used for context.",
        related_field_ids: ["income", "results"],
        action: "Use What-if comparison to compute both scenarios through the backend engine.",
        source: "guided_accuracy"
      }));
    }
  }

  return findings;
}

function fieldConfidenceFromExtraction(extraction) {
  const confidence = {};
  for (const item of extraction?.review ?? []) {
    confidence[item.field] = {
      confidence: item.confidence ?? "low",
      evidence: item.evidence ?? "",
      sourceLabel: item.sourceLabel ?? item.source_label ?? item.source ?? "PDF extraction",
      needsReview: Boolean(item.needsReview)
    };
  }
  return confidence;
}

function summarizeFindings(findings) {
  return {
    blockers: findings.filter((item) => item.severity === "blocker").length,
    warnings: findings.filter((item) => item.severity === "warning").length,
    infos: findings.filter((item) => item.severity === "info").length,
    missing_fields: findings.filter((item) => item.category === "missing_input").length,
    unusual_values: findings.filter((item) => item.category === "anomaly").length
  };
}

function readinessFromFindings(findings, computeResult) {
  if (findings.some((item) => item.severity === "blocker")) return "needs_input";
  if (findings.some((item) => item.severity === "warning")) return "has_warnings";
  if (computeResult) return "complete";
  return "ready_to_compute";
}

function confidenceFromFindings(findings, { computeResult, importExtraction }) {
  let score = computeResult ? 96 : 88;
  for (const item of findings) {
    if (item.severity === "blocker") score -= 22;
    else if (item.severity === "warning") score -= 10;
    else score -= 4;
  }
  if ((importExtraction?.missing_fields ?? []).length > 0) score -= 6;
  return Math.max(20, Math.min(99, Math.round(score)));
}

function confidenceLabel(score) {
  if (score >= 85) return "high";
  if (score >= 65) return "medium";
  return "needs_review";
}

function buildSuggestedActions(findings, readiness, activeStep) {
  const topFindings = findings.filter((item) => item.severity !== "info").slice(0, 3);
  const actions = topFindings.map((item) => {
    const step = stepForFields(item.related_field_ids) ?? activeStep;
    return {
      id: `action-${item.id}`.toLowerCase(),
      label: actionLabelForStep(step, item),
      step,
      button_id: buttonForStep(step, readiness),
      related_finding_id: item.id
    };
  });
  if (actions.length === 0) {
    actions.push({
      id: "action-run-compute-or-explain",
      label: readiness === "complete" ? "Run Explain for worksheet detail" : "Run Compute when fields look correct",
      step: "results",
      button_id: readiness === "complete" ? "explain-button" : "compute-button",
      related_finding_id: null
    });
  }
  return actions;
}

function actionLabelForStep(step, item) {
  const label = {
    profile: "Fix profile fields",
    imports: "Review imported values",
    income: "Review income values",
    deductions: "Review deductions",
    credits: "Review tax credits",
    results: "Review results"
  }[step] ?? "Review this section";
  return `${label}: ${item.title}`;
}

function buttonForStep(step, readiness) {
  if (step === "imports") return "preview-import-button";
  if (step === "results") return readiness === "complete" ? "explain-button" : "compute-button";
  return "validate-button";
}

function stepForFields(fields = []) {
  for (const field of fields) {
    for (const [pattern, step] of FIELD_STEP_HINTS) {
      if (pattern.test(String(field))) return step;
    }
  }
  return null;
}

function finding({ id, severity, category, title, message, related_field_ids, action, source }) {
  return {
    id,
    severity,
    category,
    title,
    message,
    related_field_ids: related_field_ids ?? [],
    action,
    source
  };
}

function dedupeFindings(findings) {
  const seen = new Set();
  const output = [];
  for (const item of findings) {
    const key = item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(severity) {
  return { blocker: 3, warning: 2, info: 1 }[severity] ?? 0;
}

function approximateIncomeInput(scenario) {
  const income = scenario.income ?? {};
  return toRupees(income.salary?.gross_salary) +
    (income.other_sources ?? []).reduce((total, item) => total + toRupees(item.amount), 0) +
    (income.capital_gains ?? []).reduce((total, item) => total + toRupees(item.net_gain ?? item.gain_without_indexation), 0) +
    (income.business_profession ?? []).reduce((total, item) => {
      return total + toRupees(item.net_income ?? item.declared_income ?? item.gross_receipts ?? item.turnover);
    }, 0);
}

function sumDeductions(deductions = []) {
  return deductions.reduce((total, item) => {
    return total +
      toRupees(item.amount) +
      toRupees(item.premium) +
      toRupees(item.preventive_checkup) +
      toRupees(item.rent_paid) +
      toRupees(item.interest_paid) +
      toRupees(item.medical_treatment_paid) +
      toRupees(item.employer_contribution);
  }, 0);
}

function collectNegativeNumberPaths(value, prefix = "") {
  const paths = [];
  if (typeof value === "number" && Number.isFinite(value) && value < 0) return [prefix || "request"];
  if (!value || typeof value !== "object") return paths;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      paths.push(...collectNegativeNumberPaths(item, `${prefix}[${index}]`));
    });
    return paths;
  }
  for (const [key, item] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    paths.push(...collectNegativeNumberPaths(item, nextPrefix));
  }
  return paths;
}

function firstDuplicate(items, keyBuilder) {
  const seen = new Set();
  for (const item of items) {
    const key = keyBuilder(item);
    if (seen.has(key)) return item;
    seen.add(key);
  }
  return null;
}

function humanizeCode(code) {
  return String(code ?? "")
    .replace(/^VAL_|^WARN_|^INFO_/, "")
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
