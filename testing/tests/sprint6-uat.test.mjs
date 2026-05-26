import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { buildServer } from "../../src/server.mjs";
import { computeTax } from "../../src/tax-engine.mjs";
import { getImportTemplates, previewImport } from "../../src/import-engine.mjs";

describe("Sprint 6 UAT: Import Architecture", () => {
  it("TC-S6-001 fetches import templates and allowed formats from the public API", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/imports/templates`);
      assert.equal(response.status, 200);
      const body = await response.json();

      assert.equal(body.status, "ok");
      assert.equal(body.import_version, "sprint6-v1");
      assert.deepEqual(body.file_policy.allowed_extensions, [".csv", ".json"]);
      assert.ok(body.templates.some((template) => template.import_type === "form16"));
      assert.ok(body.templates.some((template) => template.import_type === "capital_gains"));
    });
  });

  it("TC-S6-002 accepts CSV and JSON imports for preview", async () => {
    const csvPreview = await previewImport(form16CsvImport());
    const jsonPreview = await previewImport({
      import_type: "form16",
      filename: "form16.json",
      content: JSON.stringify({
        gross_salary: 800000,
        tds: 25000,
        deduction_80c: 100000,
        employer_name: "JSON Employer"
      })
    });

    assert.equal(csvPreview.status, "ok");
    assert.equal(jsonPreview.status, "ok");
    assert.equal(csvPreview.proposed_request_patch.income.salary.gross_salary, 900000);
    assert.equal(jsonPreview.proposed_request_patch.income.salary.gross_salary, 800000);
  });

  it("TC-S6-003 rejects disallowed import file types", async () => {
    await assert.rejects(
      previewImport({
        import_type: "form16",
        filename: "form16.exe",
        content: "gross_salary,tds\n900000,45000"
      }),
      {
        name: "ImportError",
        message: "Unsupported import file extension."
      }
    );
  });

  it("TC-S6-004 rejects files above the import size limit", async () => {
    const maxSize = getImportTemplates().file_policy.max_size_bytes;
    await assert.rejects(
      previewImport({
        import_type: "form16",
        filename: "oversized.csv",
        content: "x".repeat(maxSize + 1)
      }),
      {
        name: "ImportError",
        message: "Import file exceeds size limit."
      }
    );
  });

  it("TC-S6-005 stores import artifacts encrypted without plaintext payload values", async () => {
    const preview = await previewImport(form16CsvImport());
    const artifact = await readFile(preview.artifact_storage.path, "utf8");

    assert.match(artifact, /"algorithm": "aes-256-gcm"/);
    assert.match(artifact, /"ciphertext":/);
    assert.doesNotMatch(artifact, /gross_salary/);
    assert.doesNotMatch(artifact, /Example Employer/);
  });

  it("TC-S6-006 includes retention metadata in artifact storage and audit trace", async () => {
    const preview = await previewImport(form16CsvImport());

    assert.match(preview.artifact_storage.retention_expires_on, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(preview.artifact_storage.retention_expires_on, preview.audit_trace.retention_expires_on);
    assert.equal(preview.artifact_storage.status, "stored_encrypted");
  });

  it("TC-S6-007 generates a stable content hash in the audit trace", async () => {
    const payload = form16CsvImport();
    const preview = await previewImport(payload);

    assert.equal(preview.audit_trace.content_hash, sha256(payload.content));
    assert.equal(preview.audit_trace.artifact_id, preview.import_id);
  });

  it("TC-S6-008 exposes the malware-scan placeholder status", async () => {
    const preview = await previewImport(form16CsvImport());

    assert.equal(preview.malware_scan.status, "placeholder_pass");
    assert.equal(preview.malware_scan.scanner, "not_configured_in_dependency_free_build");
  });

  it("TC-S6-009 requires confirmation before imported values affect computation", async () => {
    const preview = await previewImport(form16CsvImport());
    const result = await computeTax(baseRequest({ regime: "old" }));

    assert.equal(preview.confirmation_required, true);
    assert.deepEqual(preview.confirmed_request_patch, {});
    assert.equal(result.summary.gross_total_income, 0);
    assert.equal(result.summary.tax_credits, 0);
  });

  it("TC-S6-010 returns a recoverable empty-file review error", async () => {
    const preview = await previewImport({
      import_type: "form16",
      filename: "blank.csv",
      content: ""
    });

    assert.equal(preview.status, "needs_review");
    assert.deepEqual(preview.errors, ["ERR_IMPORT_EMPTY_FILE"]);
    assert.deepEqual(preview.proposed_request_patch, {});
    assert.deepEqual(preview.confirmed_request_patch, {});
  });
});

describe("Sprint 6 UAT: Form 16 Import", () => {
  it("TC-S6-011 parses salary fields into the proposed request patch", async () => {
    const preview = await previewImport(form16CsvImport());

    assert.equal(preview.proposed_request_patch.income.salary.gross_salary, 900000);
    assert.ok(preview.review_items.some((item) => item.path === "income.salary.gross_salary" && item.confidence === "high"));
  });

  it("TC-S6-012 parses TDS values into tax-credit mappings", async () => {
    const preview = await previewImport(form16CsvImport());

    assert.equal(preview.proposed_request_patch.tax_credits.tds, 45000);
    assert.ok(preview.review_items.some((item) => item.path === "tax_credits.tds" && item.group === "credits"));
  });

  it("TC-S6-013 captures employer metadata for review without writing it into tax compute input", async () => {
    const preview = await previewImport(form16CsvImport());

    assert.ok(preview.review_items.some((item) => item.path === "import_metadata.employer_name" && item.proposed_value === "Example Employer"));
    assert.equal(preview.proposed_request_patch.import_metadata, undefined);
  });

  it("TC-S6-014 warns on unknown Form 16 fields while keeping recoverable mappings", async () => {
    const preview = await previewImport({
      import_type: "form16",
      filename: "form16.csv",
      content: "gross_salary,tds,unexpected_column\n900000,45000,not-used"
    });

    assert.equal(preview.status, "ok");
    assert.deepEqual(preview.unknown_fields, ["unexpected_column"]);
    assert.ok(preview.warnings.includes("WARN_IMPORT_UNKNOWN_FIELDS"));
    assert.equal(preview.proposed_request_patch.income.salary.gross_salary, 900000);
  });

  it("TC-S6-018 computes tax from confirmed imported Form 16 values", async () => {
    const confirmed = await previewImport({
      ...form16CsvImport(),
      user_confirmed: true
    });
    const result = await computeTax(deepMerge(baseRequest({ regime: "old" }), confirmed.confirmed_request_patch));

    assert.equal(confirmed.confirmation_required, false);
    assert.equal(result.summary.gross_total_income, 900000);
    assert.equal(result.summary.chapter_via_allowed, 150000);
    assert.equal(result.summary.tax_credits, 45000);
    assert.equal(result.summary.net_tax_liability, 9600);
  });
});

describe("Sprint 6 UAT: Interest, Dividend, Investment, and Capital-Gains Imports", () => {
  it("TC-S6-019 maps interest imports into other-source income", async () => {
    const preview = await previewImport({
      import_type: "interest_dividend",
      filename: "interest.csv",
      content: "type,amount,payer\ninterest,18000,Bank"
    });

    assert.equal(preview.status, "ok");
    assert.deepEqual(preview.proposed_request_patch.income.other_sources[0], { type: "interest", amount: 18000 });
  });

  it("TC-S6-020 maps dividend imports into other-source income", async () => {
    const preview = await previewImport({
      import_type: "interest_dividend",
      filename: "dividend.csv",
      content: "type,amount,payer\ndividend,12000,Company"
    });

    assert.equal(preview.status, "ok");
    assert.deepEqual(preview.proposed_request_patch.income.other_sources[0], { type: "dividend", amount: 12000 });
  });

  it("TC-S6-021 maps 80C and 80D deduction imports into Chapter VI-A rows", async () => {
    const preview = await previewImport({
      import_type: "deductions",
      filename: "deductions.csv",
      content: "section,amount,premium,preventive_checkup,bucket,senior\n80C,150000,,,,\n80D,,22000,3000,self_family,false"
    });

    assert.equal(preview.status, "ok");
    assert.deepEqual(preview.proposed_request_patch.deductions.chapter_via, [
      { section: "80C", amount: 150000 },
      { section: "80D", bucket: "self_family", premium: 22000, preventive_checkup: 3000, senior: false }
    ]);
  });

  it("TC-S6-022 maps capital-gains imports with asset, date, gain, and STT values", async () => {
    const preview = await previewImport({
      import_type: "capital_gains",
      filename: "capital-gains.csv",
      content: "section,transfer_date,net_gain,stt_paid,asset_type\n112A,2025-08-15,300000,true,equity_share"
    });

    assert.equal(preview.status, "ok");
    assert.deepEqual(preview.proposed_request_patch.income.capital_gains[0], {
      section: "112A",
      transfer_date: "2025-08-15",
      net_gain: 300000,
      stt_paid: true,
      asset_type: "equity_share"
    });
  });

  it("TC-S6-023 warns when capital-gains transfer date is missing", async () => {
    const preview = await previewImport({
      import_type: "capital_gains",
      filename: "capital-gains.csv",
      content: "section,net_gain,stt_paid,asset_type\n112A,300000,true,equity_share"
    });

    assert.ok(preview.warnings.includes("WARN_IMPORT_ROW_2_MISSING_TRANSFER_DATE"));
    assert.equal(preview.review_items[0].confidence, "low");
    assert.equal(preview.proposed_request_patch.income.capital_gains[0].transfer_date, undefined);
  });

  it("TC-S6-024 flags ambiguous capital-gains asset types for review", async () => {
    const preview = await previewImport({
      import_type: "capital_gains",
      filename: "capital-gains.csv",
      content: "section,transfer_date,net_gain,stt_paid,asset_type\n112A,2025-08-15,300000,true,unknown_asset"
    });

    assert.ok(preview.warnings.includes("WARN_IMPORT_ROW_2_AMBIGUOUS_ASSET_TYPE"));
    assert.equal(preview.review_items[0].confidence, "low");
  });

  it("TC-S6-026 warns and prevents duplicate capital-gains rows from being applied twice", async () => {
    const preview = await previewImport({
      import_type: "capital_gains",
      filename: "capital-gains.csv",
      content: "section,transfer_date,net_gain,stt_paid,asset_type\n112A,2025-08-15,300000,true,equity_share\n112A,2025-08-15,300000,true,equity_share"
    });

    assert.ok(preview.warnings.includes("WARN_IMPORT_ROW_3_DUPLICATE_ROW"));
    assert.equal(preview.proposed_request_patch.income.capital_gains.length, 1);
  });

  it("TC-S6-027 warns and removes invalid capital-gains transfer dates from the patch", async () => {
    const preview = await previewImport({
      import_type: "capital_gains",
      filename: "capital-gains.csv",
      content: "section,transfer_date,net_gain,stt_paid,asset_type\n112A,31/31/2026,300000,true,equity_share"
    });

    assert.ok(preview.warnings.includes("WARN_IMPORT_ROW_2_INVALID_TRANSFER_DATE"));
    assert.equal(preview.review_items[0].confidence, "low");
    assert.equal(preview.proposed_request_patch.income.capital_gains[0].transfer_date, undefined);
  });
});

function form16CsvImport() {
  return {
    import_type: "form16",
    filename: "form16.csv",
    content: "gross_salary,tds,deduction_80c,employer_name\n900000,45000,150000,Example Employer"
  };
}

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

async function withServer(callback) {
  const server = buildServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
