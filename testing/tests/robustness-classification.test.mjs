import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyCodePart, getApplicationClassification } from "../../src/app-classification.mjs";
import { buildServer } from "../../src/server.mjs";

describe("Feature: robustness and code classification", () => {
  it("classifies code areas by file path and endpoint", () => {
    const classification = getApplicationClassification();

    assert.equal(classification.status, "ok");
    assert.ok(classification.modules.length >= 8);
    assert.equal(classifyCodePart("src/tax-engine.mjs").id, "tax_engine");
    assert.equal(classifyCodePart("/api/v1/imports/pdf-extract").id, "imports");
    assert.equal(classifyCodePart("public/app.js").id, "browser_ui");
    assert.equal(classifyCodePart("unknown-file.mjs"), null);
    assert.ok(classification.recommended_next_work.some((item) => /contracts/i.test(item)));
  });

  it("serves app classification through the HTTP API", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/app/classification?part=${encodeURIComponent("src/pdf-import-engine.mjs")}`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.status, "ok");
      assert.equal(body.matched_part.id, "imports");
      assert.ok(body.audit_id);
    });
  });

  it("serves shared API contracts through the HTTP API", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/app/contracts?endpoint=${encodeURIComponent("/api/v1/tax/compute")}`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.status, "ok");
      assert.equal(body.contracts.length, 1);
      assert.equal(body.contracts[0].response_schema, "TaxComputationResponse");
      assert.equal(body.validator_dependency, "not_required_dependency_free_contracts");
      assert.ok(body.audit_id);
    });
  });

  it("returns stable request contract errors for malformed JSON", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/tax/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{\"period\":"
      });
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.equal(body.error_code, "REQ_MALFORMED_JSON");
      assert.equal(body.details.error_code, "REQ_MALFORMED_JSON");
      assert.ok(body.audit_id);
    });
  });

  it("rejects non-object JSON request roots before domain logic runs", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/tax/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "[]"
      });
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.equal(body.error_code, "REQ_JSON_OBJECT_REQUIRED");
      assert.ok(body.audit_id);
    });
  });

  it("rejects non-JSON media types for JSON endpoints", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/tax/validate`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}"
      });
      const body = await response.json();

      assert.equal(response.status, 415);
      assert.equal(body.error_code, "REQ_UNSUPPORTED_MEDIA_TYPE");
      assert.ok(body.audit_id);
    });
  });
});

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
