import { readFile } from "node:fs/promises";
import { computeTax } from "./tax-engine.mjs";
import { getRulepackForRequest, rulepackChecksum } from "./rulepack-loader.mjs";
import { toRupees } from "./money.mjs";

const SOURCE_REGISTER_URL = new URL("../sprint-zero/source-register.json", import.meta.url);
const REPORT_VERSION = "sprint5-v1";
const LEGAL_DISCLAIMER = "The calculator provides an estimate for supported v1 scenarios and is not a substitute for professional tax advice or official filing validation.";

export async function explainTaxRequest(request) {
  const reportRequest = {
    ...request,
    options: {
      ...(request.options ?? {}),
      include_validation: true
    }
  };
  const [compute, sourceRegister] = await Promise.all([
    computeTax(reportRequest),
    loadSourceRegister()
  ]);
  const rulepack = Array.isArray(request.cases) ? null : await getRulepackForRequest(request);
  const sourceIndex = indexSources(sourceRegister);
  const ruleTrace = buildRuleTrace(rulepack, compute.rule_trace ?? [], sourceIndex);
  const worksheet = buildWorksheet(request, compute, ruleTrace);
  const sourceIds = collectSourceIds(worksheet, ruleTrace, compute);
  const sources = sourceIds.map((sourceId) => enrichSource(sourceIndex.get(sourceId), sourceRegister));
  const report = {
    status: "ok",
    report_version: REPORT_VERSION,
    generated_at: new Date().toISOString(),
    metadata: buildMetadata(request, compute, sourceRegister),
    worksheet,
    rule_trace: ruleTrace,
    sources,
    citation_notes: buildCitationNotes(sources),
    support: {
      computation_hash: compute.computation_hash ?? null,
      rulepack_checksum: rulepack ? rulepackChecksum(rulepack) : null,
      rule_trace_ids: compute.rule_trace ?? [],
      warnings: compute.warnings ?? [],
      validation_results: compute.validation_results ?? [],
      validation_status: compute.validation_status ?? "ok",
      validation_summary: compute.validation_summary ?? { blockers: 0, warnings: compute.warnings?.length ?? 0, infos: 0 }
    },
    summary: compute.summary,
    itr_recommendation: compute.itr_recommendation,
    downloads: {
      json_filename: `tax-report-${compute.computation_hash?.slice(0, 12) ?? "case-set"}.json`,
      html_filename: `tax-report-${compute.computation_hash?.slice(0, 12) ?? "case-set"}.html`,
      pdf_status: "deferred_until_pdf_renderer_available"
    }
  };

  report.report_html = renderReportHtml(report);
  return report;
}

export async function getSourceById(sourceId) {
  const sourceRegister = await loadSourceRegister();
  const source = indexSources(sourceRegister).get(sourceId);
  if (!source) {
    return null;
  }
  return enrichSource(source, sourceRegister);
}

async function loadSourceRegister() {
  const raw = await readFile(SOURCE_REGISTER_URL, "utf8");
  return JSON.parse(raw);
}

function indexSources(sourceRegister) {
  return new Map(sourceRegister.sources.map((source) => [source.source_id, source]));
}

function buildMetadata(request, compute, sourceRegister) {
  return {
    period_type: request.period_type,
    period: request.period,
    act: request.act,
    taxpayer_type: request.taxpayer_type,
    residency: request.residency,
    age_years: request.age_years,
    regime: request.regime,
    rulepack_version: compute.rulepack_version ?? null,
    source_register_version: compute.source_register_version ?? sourceRegister.source_register_version,
    source_register_retrieved_on: sourceRegister.retrieved_on,
    disclaimer: LEGAL_DISCLAIMER,
    assumptions: buildAssumptions(request, compute)
  };
}

function buildAssumptions(request, compute) {
  const assumptions = [
    `${request.period_type} ${request.period}`,
    `${request.regime} regime`,
    `${request.taxpayer_type} taxpayer`
  ];
  if (request.residency) assumptions.push(`${request.residency} residency`);
  if (compute.summary?.rebate_87a_offsets_special_rate_tax === false) {
    assumptions.push("Section 87A rebate does not offset special-rate capital-gains tax in this implementation.");
  }
  return assumptions;
}

function buildRuleTrace(rulepack, ruleTraceIds, sourceIndex) {
  if (!rulepack) return [];
  return ruleTraceIds.map((ruleId) => {
    const rule = rulepack.rules.find((candidate) => candidate.rule_id === ruleId);
    const sourceIds = rule?.sources ?? [];
    return {
      rule_id: ruleId,
      rule_type: rule?.rule_type ?? "unknown",
      source_ids: sourceIds,
      sources: sourceIds.map((sourceId) => sourceSummary(sourceIndex.get(sourceId))).filter(Boolean)
    };
  });
}

function buildWorksheet(request, compute, ruleTrace) {
  const summary = compute.summary ?? {};
  const periodSource = periodSourceId(request);
  const ruleSources = new Set(ruleTrace.flatMap((rule) => rule.source_ids));
  const worksheet = [
    line("gross_total_income", "Gross total income", summary.gross_total_income, "income", "Normal income plus special-rate income before deductions.", [periodSource]),
    line("salary_taxable", "Taxable salary after exemptions", summary.salary?.taxable_salary ?? 0, "income", "Gross salary less supported salary exemptions.", [periodSource, "SRC-HRA-LTA-SALARIED-BENEFITS"]),
    line("standard_deduction", "Standard deduction", summary.standard_deduction, "deduction", "Lower of eligible salary and rulepack standard deduction amount.", [...ruleSources].filter((source) => source.includes("SALARIED"))),
    line("chapter_via", "Chapter VI-A deductions", summary.chapter_via_deductions, "deduction", "Supported Chapter VI-A deductions after caps and regime checks.", [periodSource]),
    line("normal_income", "Normal taxable income", summary.normal_income, "tax_base", "Normal income after standard deduction and Chapter VI-A deductions.", [periodSource]),
    line("total_income", "Total income", summary.total_income, "tax_base", "Normal taxable income plus special-rate income.", [periodSource, "SRC-TAX-RATES-COMPUTATION"]),
    line("normal_tax", "Normal slab tax before rebate", summary.tax_before_rebate, "tax", "Tax on normal income using active slab rule.", [...ruleSources]),
    line("special_rate_tax", "Special-rate tax before cess", sumSpecialTax(summary.special_rate_tax), "tax", "Tax on supported special-rate capital gains.", specialRateSources(summary.special_rate_tax)),
    line("rebate_87a", "Section 87A rebate", summary.rebate_87a, "tax", "Rebate applied only to supported normal-income tax.", ["SRC-SECTION-87A"]),
    line("surcharge", "Surcharge", summary.surcharge, "tax", "Surcharge from active surcharge tiers.", [...ruleSources]),
    line("cess", "Health and education cess", summary.cess, "tax", "Four percent cess on tax plus surcharge.", [...ruleSources]),
    line("tax_credits", "Tax credits", summary.tax_credits, "credit", "TDS, TCS, advance tax, and self-assessment tax credits.", ["SRC-TAX-RATES-COMPUTATION"]),
    line("net_tax_liability", "Net tax liability", summary.net_tax_liability, "result", "Total tax reduced by available credits, floored at zero.", ["SRC-TAX-RATES-COMPUTATION"]),
    line("refund_or_payable", "Refund or payable", summary.refund_or_payable, "result", "Positive means payable; negative means refund position before later interest/fee modules.", ["SRC-TAX-RATES-COMPUTATION"]),
    valueLine("itr_recommendation", "ITR recommendation", compute.itr_recommendation ?? "Not available", "filing", "Recommendation based on supported income-head complexity.", itrSourceIds(compute.itr_recommendation))
  ];

  return worksheet.map((item, index) => ({
    line_no: index + 1,
    rule_ids: ruleIdsForLine(item.line_id, ruleTrace),
    ...item
  }));
}

function ruleIdsForLine(lineId, ruleTrace) {
  const allRuleIds = ruleTrace.map((rule) => rule.rule_id);
  if (allRuleIds.length === 0) return [];

  const matchers = {
    standard_deduction: /standard[_-]?deduction/i,
    normal_tax: /slab/i,
    rebate_87a: /87a|rebate/i,
    surcharge: /surcharge/i,
    cess: /cess/i,
    special_rate_tax: /111a|112a|112|50aa|capital/i
  };
  const matcher = matchers[lineId];
  const matched = matcher ? allRuleIds.filter((ruleId) => matcher.test(ruleId)) : [];
  return unique(matched.length ? matched : allRuleIds);
}

function line(lineId, label, amount, category, formula, sourceIds) {
  return {
    line_id: lineId,
    label,
    amount: toRupees(amount),
    category,
    formula,
    source_ids: unique(sourceIds.filter(Boolean))
  };
}

function valueLine(lineId, label, value, category, formula, sourceIds) {
  return {
    line_id: lineId,
    label,
    value,
    category,
    formula,
    source_ids: unique(sourceIds.filter(Boolean))
  };
}

function collectSourceIds(worksheet, ruleTrace, compute) {
  const ids = new Set();
  for (const item of worksheet) {
    for (const sourceId of item.source_ids ?? []) ids.add(sourceId);
  }
  for (const rule of ruleTrace) {
    for (const sourceId of rule.source_ids ?? []) ids.add(sourceId);
  }
  for (const sourceId of warningSourceIds(compute.warnings ?? [])) {
    ids.add(sourceId);
  }
  return [...ids].sort();
}

function warningSourceIds(warnings) {
  const map = {
    WARN_REBATE_SPECIAL_RATE_LIMIT: ["SRC-SECTION-87A"],
    WARN_112A_PRE_2024_07_23_THRESHOLD_REVIEW: ["SRC-SECTION-112A", "SRC-FINANCE-2024-CG"],
    WARN_BASIC_EXEMPTION_ADJUSTMENT_NOT_AVAILABLE: ["SRC-SECTION-111A", "SRC-SECTION-112"],
    WARN_LANDLORD_PAN_MAY_BE_REQUIRED: ["SRC-HRA-LTA-SALARIED-BENEFITS"],
    WARN_HRA_NOT_AVAILABLE_NEW_REGIME: ["SRC-HRA-LTA-SALARIED-BENEFITS", "SRC-ITD-SALARIED-AY2026"],
    WARN_LTA_BLOCK_LIMIT_EXCEEDED: ["SRC-RULE-2B"],
    WARN_HOUSE_PROPERTY_LOSS_SET_OFF_NOT_AVAILABLE_NEW_REGIME: ["SRC-HOUSE-PROPERTY"],
    WARN_80C_CAP_APPLIED: ["SRC-ITD-SALARIED-AY2026"],
    WARN_80D_PREVENTIVE_INCLUDED_IN_BUCKET_CAP: ["SRC-ITD-SALARIED-AY2026"],
    WARN_80EE_80EEA_MUTUAL_EXCLUSION: ["SRC-ITD-SALARIED-AY2026"],
    WARN_44AD_ENHANCED_THRESHOLD_UNAVAILABLE: ["SRC-SECTION-44AD", "SRC-ITR4-FAQ"],
    WARN_44ADA_ENHANCED_THRESHOLD_UNAVAILABLE: ["SRC-SECTION-44ADA", "SRC-ITR4-FAQ"],
    WARN_ADVANCE_TAX_SHORTFALL_REGULAR_CASE: ["SRC-ADVANCE-TAX-DATES"]
  };
  return unique(warnings.flatMap((warning) => map[warning] ?? []));
}

function sourceSummary(source) {
  if (!source) return null;
  return {
    source_id: source.source_id,
    title: source.title,
    publisher: source.publisher,
    confidence: source.confidence
  };
}

function enrichSource(source, sourceRegister) {
  return {
    ...source,
    retrieved_on: sourceRegister.retrieved_on
  };
}

function buildCitationNotes(sources) {
  return sources
    .filter((source) => Array.isArray(source.notes) && source.notes.length > 0)
    .flatMap((source) => source.notes.map((note) => ({
      source_id: source.source_id,
      note
    })));
}

function renderReportHtml(report) {
  const worksheetRows = report.worksheet.map((item) => `
    <tr>
      <td>${item.line_no}</td>
      <td>${escapeHtml(item.label)}</td>
      <td>${item.amount === undefined ? escapeHtml(item.value) : formatRupees(item.amount)}</td>
      <td>${escapeHtml(item.formula)}</td>
      <td>${escapeHtml(item.rule_ids.join(", "))}</td>
      <td>${escapeHtml(item.source_ids.join(", "))}</td>
    </tr>
  `).join("");
  const sourceRows = report.sources.map((source) => `
    <tr>
      <td>${escapeHtml(source.source_id)}</td>
      <td>${escapeHtml(source.title)}</td>
      <td>${escapeHtml(source.publisher)}</td>
      <td>${escapeHtml(source.retrieved_on)}</td>
    </tr>
  `).join("");
  const assumptions = report.metadata.assumptions.map((assumption) => `<li>${escapeHtml(assumption)}</li>`).join("");
  const warningItems = report.support.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");
  const validationItems = report.support.validation_results.map((result) => `
    <li>${escapeHtml(result.code)} · ${escapeHtml(result.field_path)} · ${escapeHtml(result.remediation_hint)}</li>
  `).join("");
  const citationNotes = report.citation_notes.map((note) => `
    <li>${escapeHtml(note.source_id)} · ${escapeHtml(note.note)}</li>
  `).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Tax calculation report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #18212a; margin: 32px; }
    h1, h2 { margin-bottom: 8px; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0 28px; }
    th, td { border: 1px solid #d8e0e7; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #eef2f5; }
    .meta { color: #5d6975; }
  </style>
</head>
<body>
  <h1>Tax calculation report</h1>
  <p class="meta">Rulepack ${escapeHtml(report.metadata.rulepack_version)} · Source register ${escapeHtml(report.metadata.source_register_version)} · Computation ${escapeHtml(report.support.computation_hash)}</p>
  <h2>Important disclaimer</h2>
  <p>${escapeHtml(report.metadata.disclaimer)}</p>
  <h2>Assumptions</h2>
  <ul>${assumptions}</ul>
  <h2>Warnings and validation notices</h2>
  <ul>${warningItems}${validationItems || "<li>No validation blockers returned.</li>"}</ul>
  <h2>Likely filing form</h2>
  <p>Likely ITR form: ${escapeHtml(report.itr_recommendation)}. Basis: supported income-head complexity and active rulepack scope.</p>
  ${citationNotes ? `<h2>Citation notes</h2><ul>${citationNotes}</ul>` : ""}
  <h2>Worksheet</h2>
  <table>
    <thead><tr><th>#</th><th>Line item</th><th>Value</th><th>Basis</th><th>Rules</th><th>Sources</th></tr></thead>
    <tbody>${worksheetRows}</tbody>
  </table>
  <h2>Source Evidence</h2>
  <table>
    <thead><tr><th>Source ID</th><th>Title</th><th>Publisher</th><th>Retrieved</th></tr></thead>
    <tbody>${sourceRows}</tbody>
  </table>
</body>
</html>`;
}

function periodSourceId(request) {
  return request.period === "2025-26" ? "SRC-ITD-SALARIED-AY2025" : "SRC-ITD-SALARIED-AY2026";
}

function specialRateSources(specialRateTax = {}) {
  const sourceIds = [];
  if (specialRateTax["111A"]) sourceIds.push("SRC-SECTION-111A", "SRC-FINANCE-2024-CG");
  if (specialRateTax["112A"]) sourceIds.push("SRC-SECTION-112A", "SRC-FINANCE-2024-CG");
  if (specialRateTax["112"]) sourceIds.push("SRC-SECTION-112", "SRC-FINANCE-2024-CG");
  return unique(sourceIds.length ? sourceIds : ["SRC-TAX-RATES-COMPUTATION"]);
}

function itrSourceIds(itr) {
  const map = {
    "ITR-1": ["SRC-ITD-SALARIED-AY2026"],
    "ITR-2": ["SRC-ITD-SALARIED-AY2026"],
    "ITR-3": ["SRC-BUSINESS-AY2026"],
    "ITR-4": ["SRC-ITR4-FAQ"]
  };
  return map[itr] ?? ["SRC-ITD-SALARIED-AY2026"];
}

function sumSpecialTax(specialRateTax = {}) {
  return Object.values(specialRateTax).reduce((total, item) => {
    return total + (item.tax_before_cess ?? item.final_tax_before_cess ?? 0);
  }, 0);
}

function formatRupees(value) {
  return `Rs. ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value ?? 0)}`;
}

function unique(values) {
  return [...new Set(values)];
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
