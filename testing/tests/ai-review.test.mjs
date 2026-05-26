import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAiReviewCapabilities, reviewScenario } from "../../src/ai-review-engine.mjs";
import { buildServer } from "../../src/server.mjs";

describe("Feature: vNext guided accuracy AI review", () => {
  it("reports missing income and next actions without requiring a hosted model token", async () => {
    const review = await reviewScenario({
      scenario: baseRequest(),
      active_step: "income"
    });

    assert.equal(review.status, "ok");
    assert.equal(review.ai.runtime, "local_deterministic");
    assert.equal(review.ai.hosted_api_required, false);
    assert.equal(review.readiness, "needs_input");
    assert.ok(review.confidence_score < 90);
    assert.ok(review.findings.some((item) => item.id === "GA_INCOME_MISSING"));
    assert.ok(review.suggested_actions.some((item) => item.step === "income"));
  });

  it("flags salary, TDS, deduction, duplicate, and regime-sensitive anomalies", async () => {
    const review = await reviewScenario({
      scenario: baseRequest({
        regime: "new",
        income: {
          salary: { gross_salary: 1200000 },
          capital_gains: [
            { section: "112A", transfer_date: "2025-08-15", net_gain: 125000, stt_paid: true },
            { section: "112A", transfer_date: "2025-08-15", net_gain: 125000, stt_paid: true }
          ]
        },
        deductions: {
          standard_deduction: true,
          chapter_via: [{ section: "80C", amount: 150000 }]
        },
        tax_credits: { tds: 0 }
      }),
      active_step: "results"
    });

    assert.equal(review.readiness, "has_warnings");
    assert.ok(review.findings.some((item) => item.id === "GA_TDS_POSSIBLY_MISSING"));
    assert.ok(review.findings.some((item) => item.id === "GA_NEW_REGIME_DEDUCTIONS_REVIEW"));
    assert.ok(review.findings.some((item) => item.id === "GA_DUPLICATE_CAPITAL_GAIN"));
    assert.ok(review.support.computed);
  });

  it("surfaces PDF field confidence and needs-review findings", async () => {
    const review = await reviewScenario({
      scenario: baseRequest({ income: { salary: { gross_salary: 900000 } }, tax_credits: { tds: 45000 } }),
      active_step: "imports",
      import_extraction: {
        fields: { gross_salary: 900000, tds: 45000 },
        missing_fields: ["deduction_80c"],
        errors: [],
        review: [
          {
            field: "gross_salary",
            value: 900000,
            source: "pattern",
            confidence: "high",
            evidence: "Gross salary 900000",
            sourceLabel: "Searchable PDF text",
            needsReview: false
          },
          {
            field: "employer_name",
            value: "Example Employer",
            source: "pattern",
            confidence: "medium",
            evidence: "Employer name Example Employer",
            sourceLabel: "Searchable PDF text",
            needsReview: true
          }
        ]
      }
    });

    assert.equal(review.field_confidence.gross_salary.confidence, "high");
    assert.equal(review.field_confidence.employer_name.needsReview, true);
    assert.ok(review.findings.some((item) => item.id === "GA_IMPORT_MISSING_deduction_80c"));
    assert.ok(review.findings.some((item) => item.id === "GA_IMPORT_LOW_CONFIDENCE_employer_name"));
  });

  it("documents local-first capabilities", () => {
    const capabilities = getAiReviewCapabilities();
    assert.equal(capabilities.hosted_api_required, false);
    assert.equal(capabilities.model_required, false);
    assert.ok(capabilities.uses_existing_engines.includes("/api/v1/tax/compute"));
  });

  it("serves the review through the HTTP API", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/ai/review-scenario`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenario: baseRequest({ income: { salary: { gross_salary: 900000 } } }),
          active_step: "results"
        })
      });

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.status, "ok");
      assert.equal(body.support.compute_status, "ok");
      assert.ok(body.audit_id);
    });
  });
});

function baseRequest(overrides = {}) {
  return deepMerge({
    period_type: "assessment_year",
    period: "2026-27",
    act: "Income-tax Act, 1961",
    taxpayer_type: "individual",
    residency: "resident",
    age_years: 34,
    regime: "new",
    income: {},
    deductions: { standard_deduction: true, chapter_via: [] },
    tax_credits: {}
  }, overrides);
}

function deepMerge(target, source) {
  const output = Array.isArray(target) ? [...target] : { ...target };
  for (const [key, value] of Object.entries(source ?? {})) {
    if (Array.isArray(value)) {
      output[key] = value;
    } else if (value && typeof value === "object") {
      output[key] = deepMerge(output[key] ?? {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

async function withServer(callback) {
  const server = buildServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
