import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getApiContracts } from "../../src/api-contracts.mjs";
import { previewImport } from "../../src/import-engine.mjs";
import { extractPdfImport, getPdfImportCapabilities } from "../../src/pdf-import-engine.mjs";
import { roundFinalRupee, toPaise, toRupees } from "../../src/money.mjs";
import { reviewScenario } from "../../src/ai-review-engine.mjs";
import { validateTaxRequest } from "../../src/validation-engine.mjs";
import { isSavedScenario, parseStoredJsonValue } from "../../public/storage-state.js";

describe("Feature: mutation guardrails", () => {
  it("keeps shared API contracts available without a runtime validation dependency", () => {
    const contracts = getApiContracts({ endpoint: "/api/v1/ai/review-scenario" });

    assert.equal(contracts.status, "ok");
    assert.equal(contracts.validator_dependency, "not_required_dependency_free_contracts");
    assert.equal(contracts.dependency_policy.preserve_error_codes, true);
    assert.equal(contracts.contracts.length, 1);
    assert.equal(contracts.contracts[0].request_schema, "AiReviewRequest");
    assert.ok(contracts.shared_error_codes.includes("REQ_MALFORMED_JSON"));
  });

  it("normalizes money through paise-safe helpers", () => {
    assert.equal(toPaise("₹1,234.565"), 123457);
    assert.equal(toRupees("1,234.565"), 1234.57);
    assert.equal(toRupees(0.1 + 0.2), 0.3);
    assert.equal(roundFinalRupee("100.50"), 101);
  });

  it("keeps PDF OCR optional and disabled by default", () => {
    const capabilities = getPdfImportCapabilities();

    assert.equal(capabilities.ocr.default_enabled, false);
    assert.equal(capabilities.ocr.status, "optional_not_configured");
    assert.match(capabilities.ocr.note, /searchable PDFs/i);
  });

  it("rejects explicit OCR requests when offline OCR is not configured", async () => {
    await assert.rejects(
      () => extractPdfImport({
        import_type: "form16",
        filename: "scan.pdf",
        content_base64: Buffer.from("%PDF\n1 0 obj\n<<>>\nendobj\n%%EOF").toString("base64"),
        enable_ocr: true
      }),
      (error) => {
        assert.equal(error.details.error_code, "PDF_OCR_NOT_CONFIGURED");
        assert.equal(error.details.ocr.default_enabled, false);
        return true;
      }
    );
  });

  it("routes formatted import amounts through shared money normalization", async () => {
    const preview = await previewImport({
      import_type: "form16",
      filename: "form16.csv",
      content: 'gross_salary,tds,deduction_80c,employer_name\n"₹9,00,000.505","INR 45,000.255","Rs. 1,50,000.495",Example Employer',
      user_confirmed: true
    });

    assert.equal(preview.confirmed_request_patch.income.salary.gross_salary, 900000.51);
    assert.equal(preview.confirmed_request_patch.tax_credits.tds, 45000.26);
    assert.equal(preview.confirmed_request_patch.deductions.chapter_via[0].amount, 150000.5);
  });

  it("keeps browser storage parsing isolated from the main app module", () => {
    assert.deepEqual(parseStoredJsonValue("[1,2]", []).value, [1, 2]);
    assert.equal(parseStoredJsonValue("{bad", []).invalid, true);
    assert.equal(isSavedScenario({
      id: "scenario-1",
      name: "Salary case",
      saved_at: "2026-05-12T00:00:00.000Z",
      request: baseRequest()
    }), true);
    assert.equal(isSavedScenario({ id: "broken", request: [] }), false);
  });

  for (const mutation of validationMutations()) {
    it(`keeps validation guardrail for mutation: ${mutation.name}`, () => {
      const report = validateTaxRequest(deepMerge(baseRequest(), mutation.patch));

      assert.ok(
        report.results.some((item) => item.code === mutation.code && item.field_path === mutation.field_path),
        `${mutation.code} on ${mutation.field_path} should be present`
      );
    });
  }

  for (const mutation of aiReviewMutations()) {
    it(`keeps AI review guardrail for mutation: ${mutation.name}`, async () => {
      const review = await reviewScenario(mutation.request);

      assert.ok(
        review.findings.some((item) => item.id === mutation.finding_id),
        `${mutation.finding_id} should be present`
      );
    });
  }
});

function validationMutations() {
  return [
    {
      name: "unsupported taxpayer",
      patch: { taxpayer_type: "company" },
      code: "VAL_TAXPAYER_TYPE_UNSUPPORTED",
      field_path: "taxpayer_type"
    },
    {
      name: "negative salary",
      patch: { income: { salary: { gross_salary: -1 } } },
      code: "VAL_SALARY_AMOUNT_NEGATIVE",
      field_path: "income.salary.gross_salary"
    },
    {
      name: "new regime 80C warning",
      patch: { deductions: { chapter_via: [{ section: "80C", amount: 150000 }] } },
      code: "WARN_CHAPTER_VIA_DEDUCTIONS_IGNORED_NEW_REGIME",
      field_path: "deductions.chapter_via"
    },
    {
      name: "capital gain missing date",
      patch: { income: { capital_gains: [{ section: "112A", net_gain: 300000, stt_paid: true }] } },
      code: "VAL_CAPITAL_GAIN_TRANSFER_DATE_REQUIRED",
      field_path: "income.capital_gains[0].transfer_date"
    }
  ];
}

function aiReviewMutations() {
  return [
    {
      name: "missing income",
      request: { scenario: baseRequest(), active_step: "income" },
      finding_id: "GA_INCOME_MISSING"
    },
    {
      name: "possible missing TDS",
      request: {
        scenario: deepMerge(baseRequest(), { income: { salary: { gross_salary: 900000 } }, tax_credits: { tds: 0 } }),
        active_step: "credits"
      },
      finding_id: "GA_TDS_POSSIBLY_MISSING"
    },
    {
      name: "duplicate capital gain",
      request: {
        scenario: deepMerge(baseRequest(), {
          income: {
            capital_gains: [
              { section: "112A", transfer_date: "2025-08-15", net_gain: 150000, stt_paid: true },
              { section: "112A", transfer_date: "2025-08-15", net_gain: 150000, stt_paid: true }
            ]
          }
        }),
        active_step: "income"
      },
      finding_id: "GA_DUPLICATE_CAPITAL_GAIN"
    },
    {
      name: "low-confidence import field",
      request: {
        scenario: deepMerge(baseRequest(), { income: { salary: { gross_salary: 900000 } } }),
        active_step: "imports",
        import_extraction: {
          errors: [],
          missing_fields: [],
          review: [{ field: "gross_salary", value: 900000, confidence: "low", source: "pattern", needsReview: true }]
        }
      },
      finding_id: "GA_IMPORT_LOW_CONFIDENCE_gross_salary"
    }
  ];
}

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

function deepMerge(target, source = {}) {
  const output = Array.isArray(target) ? [...target] : { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (Array.isArray(value)) output[key] = value;
    else if (value && typeof value === "object") output[key] = deepMerge(output[key] ?? {}, value);
    else output[key] = value;
  }
  return output;
}
