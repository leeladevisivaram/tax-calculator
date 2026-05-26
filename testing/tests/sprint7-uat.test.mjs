import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";
import { buildServer } from "../../src/server.mjs";
import { explainTaxRequest } from "../../src/report-engine.mjs";
import { computeTax } from "../../src/tax-engine.mjs";
import {
  MAX_JSON_BODY_BYTES,
  HttpError,
  appendAuditEvent,
  enforceRateLimit,
  getAuditLogPath,
  getMetrics,
  getPrivacyPolicy,
  getRunbook,
  maskAuditPayload
} from "../../src/ops-engine.mjs";

describe("Sprint 7 UAT: Privacy and Data Governance", () => {
  it("TC-S7-001 publishes purpose and retention mapping for saved draft, report, and import data", () => {
    const policy = getPrivacyPolicy();
    const categories = new Map(policy.data_categories.map((item) => [item.category, item]));

    for (const category of ["profile", "income", "deductions_and_credits", "imports", "reports", "audit_logs"]) {
      assert.ok(categories.has(category), `${category} privacy category should exist`);
      assert.ok(categories.get(category).purpose);
      assert.ok(categories.get(category).retention);
    }
    assert.ok(policy.user_controls.some((item) => item.includes("Export")));
    assert.ok(policy.user_controls.some((item) => item.includes("Delete")));
  });

  it("TC-S7-006 masks PII, import content, and raw tax values from audit payloads", () => {
    const masked = maskAuditPayload({
      pan: "ABCDE1234F",
      name: "Sensitive Taxpayer",
      email: "taxpayer@example.com",
      import_content: "gross_salary,tds\n900000,45000",
      income: { salary: { gross_salary: 900000 } },
      confirmed: true
    });

    assert.equal(masked.pan, "[redacted_pii]");
    assert.equal(masked.name, "[redacted_pii]");
    assert.equal(masked.email, "[redacted_pii]");
    assert.equal(masked.import_content, "[redacted_content]");
    assert.equal(masked.income.salary.gross_salary, "[number]");
    assert.equal(masked.confirmed, true);
  });

  it("TC-S7-007 returns a graceful deletion workflow even when no local data exists", async () => {
    await withServer(async (baseUrl) => {
      const deletion = await postJson(baseUrl, "/api/v1/privacy/delete", {});

      assert.equal(deletion.status, "ok");
      assert.equal(deletion.server_records_deleted, 0);
      assert.ok(deletion.browser_actions.some((item) => item.includes("localStorage")));
      assert.match(deletion.note, /No authenticated saved profile/);
    });
  });
});

describe("Sprint 7 UAT: Security Controls", () => {
  it("TC-S7-008 applies security headers to API and static responses", async () => {
    await withServer(async (baseUrl) => {
      for (const path of ["/", "/health"]) {
        const response = await fetch(`${baseUrl}${path}`);
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.equal(response.headers.get("x-frame-options"), "DENY");
        assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
        assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
        assert.match(response.headers.get("permissions-policy"), /camera=\(\)/);
        assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
      }
    });
  });

  it("TC-S7-009 rejects oversized JSON bodies with an audited 413 response", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/tax/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ import_content: "x".repeat(MAX_JSON_BODY_BYTES + 10) })
      });
      const body = await response.json();

      assert.equal(response.status, 413);
      assert.match(body.error, /exceeds JSON size limit/);
      assert.ok(body.audit_id);
    });
  });

  it("TC-S7-010 enforces API route rate limiting", () => {
    const maxRequests = getMetrics().security.rate_limit_max_requests;
    const req = {
      method: "POST",
      headers: { "x-forwarded-for": `sprint7-rate-limit-${Date.now()}` },
      socket: { remoteAddress: "127.0.0.1" }
    };
    const url = new URL("/api/v1/tax/compute", "http://localhost");

    for (let index = 0; index < maxRequests; index += 1) {
      enforceRateLimit(req, url);
    }

    assert.throws(
      () => enforceRateLimit(req, url),
      (error) => error instanceof HttpError && error.statusCode === 429 && /Rate limit exceeded/.test(error.message)
    );
  });

  it("TC-S7-011 rejects unsupported HTTP methods with 405 and allowed methods", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/tax/compute`, { method: "GET" });
      const body = await response.json();

      assert.equal(response.status, 405);
      assert.equal(body.error, "Method not allowed");
      assert.deepEqual(body.allowed_methods, ["POST"]);
      assert.ok(body.audit_id);
    });
  });

  it("TC-S7-012 sanitizes suspicious import filenames before processing", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/imports/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          import_type: "form16",
          filename: "../form16.csv",
          content: "gross_salary,tds\n900000,45000"
        })
      });
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.equal(body.error, "Import filename must not include path separators.");
      assert.ok(body.audit_id);
    });
  });

  it("TC-S7-013 records a masked audit event for rulepack activation workflow", async () => {
    const auditId = await appendAuditEvent({
      route: "/ops/rulepack-activation",
      method: "POST",
      status_code: 200,
      request_body: {
        rulepack_id: "ay-2026-27-v1",
        approved_by: "Tax Domain Owner",
        pan: "ABCDE1234F"
      },
      response_body: { status: "ok" },
      duration_ms: 12
    });
    const auditLog = await readFile(getAuditLogPath(), "utf8");
    const eventLine = auditLog.split("\n").filter(Boolean).find((line) => line.includes(auditId));

    assert.ok(eventLine);
    assert.match(eventLine, /"route":"\/ops\/rulepack-activation"/);
    assert.doesNotMatch(eventLine, /ABCDE1234F|Tax Domain Owner|ay-2026-27-v1/);
  });

  it("TC-S7-014 records audit and metrics evidence for report generation", async () => {
    await withServer(async (baseUrl) => {
      const before = getMetrics().report_generations_total;
      const report = await postJson(baseUrl, "/api/v1/reports/explain", salaryRequest());
      const metrics = getMetrics();

      assert.equal(report.status, "ok");
      assert.ok(report.audit_id);
      assert.ok(metrics.report_generations_total >= before + 1);
      assert.ok(metrics.by_route["POST /api/v1/reports/explain"].count >= 1);
    });
  });

  it("TC-S7-015 blocks script-shaped payloads with a safe validation error", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/tax/validate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...salaryRequest(),
          act: "<script>alert(1)</script>"
        })
      });
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.status, "blocked");
      assert.ok(body.codes.includes("VAL_INPUT_UNSAFE_MARKUP"));
      assert.doesNotMatch(JSON.stringify(body), /<script>|alert\(1\)/);
    });
  });
});

describe("Sprint 7 UAT: Accessibility, Quality, and Operations", () => {
  it("TC-S7-022 keeps compute API response within the local performance budget", async () => {
    const started = performance.now();
    const result = await computeTax(salaryRequest());
    const elapsed = performance.now() - started;

    assert.equal(result.status, "ok");
    assert.ok(elapsed < 500, `compute took ${elapsed}ms`);
  });

  it("TC-S7-023 keeps report generation within the local performance budget", async () => {
    const started = performance.now();
    const report = await explainTaxRequest(salaryRequest());
    const elapsed = performance.now() - started;

    assert.equal(report.status, "ok");
    assert.ok(elapsed < 500, `report took ${elapsed}ms`);
  });

  it("TC-S7-024 returns healthy service status", async () => {
    await withServer(async (baseUrl) => {
      const health = await getJson(baseUrl, "/health");
      assert.equal(health.status, "ok");
      assert.ok(health.audit_id);
    });
  });

  it("TC-S7-025 exposes metrics, route counts, latency, and security settings", async () => {
    await withServer(async (baseUrl) => {
      await getJson(baseUrl, "/health");
      const metrics = await getJson(baseUrl, "/api/v1/ops/metrics");

      assert.equal(metrics.status, "ok");
      assert.equal(metrics.metrics_version, "sprint7-v1");
      assert.ok(metrics.requests_total >= 1);
      assert.ok(metrics.by_route["GET /health"].count >= 1);
      assert.equal(metrics.security.headers, "enabled");
      assert.equal(metrics.security.json_body_limit_bytes, MAX_JSON_BODY_BYTES);
      assert.match(metrics.audit_log_path, /audit\.jsonl$/);
    });
  });

  it("TC-S7-026 captures compute failures in structured route metrics", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/tax/compute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...salaryRequest(), period: "2099-00" })
      });
      const metrics = await getJson(baseUrl, "/api/v1/ops/metrics");

      assert.equal(response.status, 400);
      assert.ok(metrics.by_route["POST /api/v1/tax/compute"].errors >= 1);
      assert.ok(metrics.errors_total >= 1);
    });
  });

  it("TC-S7-027 captures validation blockers in validation failure metrics", async () => {
    await withServer(async (baseUrl) => {
      const before = getMetrics().validation_failures_total;
      const validation = await postJson(baseUrl, "/api/v1/tax/validate", {
        ...salaryRequest(),
        age_years: -1
      });
      const metrics = await getJson(baseUrl, "/api/v1/ops/metrics");

      assert.equal(validation.status, "blocked");
      assert.ok(metrics.validation_failures_total >= before + 1);
    });
  });

  it("TC-S7-028 captures import parsing errors in import route metrics", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/imports/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          import_type: "form16",
          filename: "bad.exe",
          content: "gross_salary,tds\n900000,45000"
        })
      });
      const metrics = await getJson(baseUrl, "/api/v1/ops/metrics");

      assert.equal(response.status, 400);
      assert.ok(metrics.import_previews_total >= 1);
      assert.ok(metrics.by_route["POST /api/v1/imports/preview"].errors >= 1);
    });
  });

  it("TC-S7-029 exposes a rulepack rollback checklist", () => {
    const runbook = getRunbook();
    assert.ok(runbook.rulepack_activation_checklist.some((item) => item.includes("source")));
    assert.ok(runbook.rollback_process.some((item) => item.includes("previous known-good")));
    assert.ok(runbook.rollback_process.some((item) => item.includes("golden vectors")));
  });

  it("TC-S7-030 exposes an incident runbook for security and tax failures", () => {
    const runbook = getRunbook();
    assert.ok(runbook.incident_runbook.some((item) => item.includes("calculation")));
    assert.ok(runbook.incident_runbook.some((item) => item.includes("masked audit ID")));
    assert.ok(runbook.incident_runbook.some((item) => item.includes("Freeze")));
  });
});

function salaryRequest(overrides = {}) {
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
    tax_credits: {},
    ...overrides
  };
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
