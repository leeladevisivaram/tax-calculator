import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { buildServer } from "../../src/server.mjs";
import {
  MAX_JSON_BODY_BYTES,
  buildDeletionWorkflow,
  buildPrivacyExport,
  getAuditLogPath,
  getMetrics,
  getPrivacyPolicy,
  getRunbook,
  maskAuditPayload
} from "../../src/ops-engine.mjs";

describe("Sprint 7 security, privacy, accessibility, and operations", () => {
  it("applies security headers and publishes privacy and runbook endpoints", async () => {
    const server = buildServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const healthResponse = await fetch(`${baseUrl}/health`);
      assert.equal(healthResponse.status, 200);
      assert.equal(healthResponse.headers.get("x-content-type-options"), "nosniff");
      assert.equal(healthResponse.headers.get("x-frame-options"), "DENY");
      assert.match(healthResponse.headers.get("content-security-policy"), /frame-ancestors 'none'/);
      const health = await healthResponse.json();
      assert.ok(health.audit_id);

      const policy = await getJson(baseUrl, "/api/v1/privacy/policy");
      assert.equal(policy.status, "ok");
      assert.equal(policy.privacy_version, "sprint7-v1");
      assert.ok(policy.data_categories.some((item) => item.category === "imports"));
      assert.match(policy.pii_masking, /mask/i);

      const exported = await postJson(baseUrl, "/api/v1/privacy/export", {
        profile: { regime: "new" },
        draft: { gross_salary: 900000 }
      });
      assert.equal(exported.status, "ok");
      assert.equal(exported.package.profile.regime, "new");
      assert.ok(exported.exported_at);

      const deletion = await postJson(baseUrl, "/api/v1/privacy/delete", {});
      assert.equal(deletion.status, "ok");
      assert.ok(deletion.browser_actions.some((item) => item.includes("localStorage")));

      const runbook = await getJson(baseUrl, "/api/v1/ops/runbook");
      assert.ok(runbook.rulepack_activation_checklist.includes("All golden vectors pass at 100 percent."));
      assert.ok(runbook.rollback_process.length >= 3);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("enforces JSON body limits and records audit IDs and route metrics", async () => {
    const server = buildServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const compute = await postJson(baseUrl, "/api/v1/tax/compute", baseRequest({
        income: { salary: { gross_salary: 1275000 } }
      }));
      assert.equal(compute.status, "ok");
      assert.ok(compute.audit_id);

      const tooLarge = await fetch(`${baseUrl}/api/v1/tax/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ import_content: "x".repeat(MAX_JSON_BODY_BYTES + 10) })
      });
      assert.equal(tooLarge.status, 413);
      const tooLargeBody = await tooLarge.json();
      assert.match(tooLargeBody.error, /exceeds JSON size limit/);
      assert.ok(tooLargeBody.audit_id);

      const metrics = await getJson(baseUrl, "/api/v1/ops/metrics");
      assert.equal(metrics.metrics_version, "sprint7-v1");
      assert.ok(metrics.by_route["POST /api/v1/tax/compute"].count >= 1);
      assert.ok(metrics.by_route["POST /api/v1/tax/validate"].errors >= 1);
      assert.equal(metrics.security.json_body_limit_bytes, MAX_JSON_BODY_BYTES);
      assert.match(metrics.audit_log_path, /tax-calculator-audit/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("masks PII and raw tax values from audit payloads", () => {
    const masked = maskAuditPayload({
      pan: "ABCDE1234F",
      email: "taxpayer@example.com",
      import_content: "gross_salary,tds\n900000,45000",
      income: { salary: { gross_salary: 900000 } },
      confirmed: true
    });

    assert.equal(masked.pan, "[redacted_pii]");
    assert.equal(masked.email, "[redacted_pii]");
    assert.equal(masked.import_content, "[redacted_content]");
    assert.equal(masked.income.salary.gross_salary, "[number]");
    assert.equal(masked.confirmed, true);
  });

  it("exposes operations helpers for privacy, deletion, metrics, and audit path", () => {
    const policy = getPrivacyPolicy();
    const exported = buildPrivacyExport({ draft: { period: "2026-27" } });
    const deletion = buildDeletionWorkflow();
    const runbook = getRunbook();
    const metrics = getMetrics();

    assert.equal(policy.status, "ok");
    assert.equal(exported.package.draft.period, "2026-27");
    assert.match(deletion.import_artifact_retention, /7 days/);
    assert.ok(runbook.incident_runbook.some((item) => item.includes("masked audit ID")));
    assert.equal(metrics.security.headers, "enabled");
    assert.match(getAuditLogPath(), /audit\.jsonl$/);
  });

  it("adds accessibility and privacy controls to the wizard UI", async () => {
    const [html, css, js, operations] = await Promise.all([
      readFile(new URL("../../public/index.html", import.meta.url), "utf8"),
      readFile(new URL("../../public/styles.css", import.meta.url), "utf8"),
      readFile(new URL("../../public/app.js", import.meta.url), "utf8"),
      readFile(new URL("../../docs/engineering/OPERATIONS.md", import.meta.url), "utf8")
    ]);

    assert.match(html, /class="skip-link"/);
    assert.match(html, /aria-label="Wizard actions"/);
    assert.match(html, /name="privacy_notice_ack"/);
    assert.match(html, /id="privacy-output"/);
    assert.match(html, /id="export-local-data-button"/);
    assert.match(css, /\.skip-link:focus/);
    assert.match(css, /textarea:focus-visible/);
    assert.match(css, /prefers-reduced-motion/);
    assert.match(js, /aria-current/);
    assert.match(js, /\/api\/v1\/privacy\/policy/);
    assert.match(js, /\/api\/v1\/privacy\/export/);
    assert.match(js, /\/api\/v1\/privacy\/delete/);
    assert.match(operations, /Rulepack Activation Checklist/);
    assert.match(operations, /Launch Blockers/);
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

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  assert.equal(response.status, 200);
  return response.json();
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
