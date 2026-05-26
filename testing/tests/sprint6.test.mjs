import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { buildServer } from "../../src/server.mjs";
import { computeTax } from "../../src/tax-engine.mjs";
import { getImportTemplates, previewImport } from "../../src/import-engine.mjs";

describe("Sprint 6 imports", () => {
  it("publishes import templates and file policy", () => {
    const templates = getImportTemplates();
    assert.equal(templates.status, "ok");
    assert.equal(templates.import_version, "sprint6-v1");
    assert.ok(templates.file_policy.allowed_extensions.includes(".csv"));
    assert.ok(templates.file_policy.allowed_extensions.includes(".json"));
    assert.ok(templates.templates.some((template) => template.import_type === "form16"));
    assert.ok(templates.templates.some((template) => template.import_type === "capital_gains"));
  });

  it("previews Form 16 values without silently confirming them", async () => {
    const preview = await previewImport({
      import_type: "form16",
      filename: "form16.csv",
      content: "gross_salary,tds,deduction_80c,employer_name\n900000,45000,150000,Example Employer"
    });

    assert.equal(preview.status, "ok");
    assert.equal(preview.confirmation_required, true);
    assert.deepEqual(preview.confirmed_request_patch, {});
    assert.equal(preview.proposed_request_patch.income.salary.gross_salary, 900000);
    assert.equal(preview.proposed_request_patch.tax_credits.tds, 45000);
    assert.equal(preview.proposed_request_patch.deductions.chapter_via[0].amount, 150000);
    assert.equal(preview.artifact_storage.status, "stored_encrypted");
    assert.equal(preview.artifact_storage.algorithm, "aes-256-gcm");
    assert.ok(preview.audit_trace.content_hash);
  });

  it("applies confirmed imports into compute input only after confirmation", async () => {
    const confirmed = await previewImport({
      import_type: "form16",
      filename: "form16.csv",
      content: "gross_salary,tds,deduction_80c\n900000,45000,150000",
      user_confirmed: true
    });
    const request = deepMerge(baseRequest({ regime: "old" }), confirmed.confirmed_request_patch);
    const result = await computeTax(request);

    assert.equal(confirmed.confirmation_required, false);
    assert.equal(result.summary.gross_total_income, 900000);
    assert.equal(result.summary.chapter_via_allowed, 150000);
    assert.equal(result.summary.tax_credits, 45000);
  });

  it("keeps ambiguous capital-gains imports recoverable for review", async () => {
    const preview = await previewImport({
      import_type: "capital_gains",
      filename: "capital-gains.csv",
      content: "section,net_gain,stt_paid\n112A,300000,true"
    });

    assert.equal(preview.status, "ok");
    assert.ok(preview.warnings.includes("WARN_IMPORT_ROW_2_MISSING_TRANSFER_DATE"));
    assert.equal(preview.review_items[0].confidence, "low");
    assert.equal(preview.proposed_request_patch.income.capital_gains[0].transfer_date, undefined);
  });

  it("serves import templates and preview endpoint", async () => {
    const server = buildServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const templatesResponse = await fetch(`${baseUrl}/api/v1/imports/templates`);
      assert.equal(templatesResponse.status, 200);
      const templatesBody = await templatesResponse.json();
      assert.equal(templatesBody.status, "ok");

      const previewBody = await postJson(baseUrl, "/api/v1/imports/preview", {
        import_type: "interest_dividend",
        filename: "interest.csv",
        content: "type,amount,payer\ninterest,18000,Bank"
      });
      assert.equal(previewBody.status, "ok");
      assert.equal(previewBody.proposed_request_patch.income.other_sources[0].amount, 18000);
      assert.equal(previewBody.confirmation_required, true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("adds import controls to the wizard UI", async () => {
    const [html, js] = await Promise.all([
      readFile(new URL("../../public/index.html", import.meta.url), "utf8"),
      readFile(new URL("../../public/app.js", import.meta.url), "utf8")
    ]);

    assert.match(html, /data-step="imports"/);
    assert.match(html, /name="import_type"/);
    assert.match(html, /id="preview-import-button"/);
    assert.match(html, /id="apply-import-button"/);
    assert.match(js, /\/api\/v1\/imports\/preview/);
    assert.match(js, /applyRequestPatch/);
  });
});

function baseRequest(overrides = {}) {
  return {
    period_type: "assessment_year",
    period: "2026-27",
    act: "Income-tax Act, 1961",
    taxpayer_type: "individual",
    residency: "resident",
    age_years: 34,
    regime: "new",
    income: {},
    deductions: { standard_deduction: true },
    tax_credits: {},
    ...overrides
  };
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

async function postJson(baseUrl, path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 200);
  return response.json();
}
