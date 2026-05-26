import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { buildServer } from "../../src/server.mjs";
import {
  classifyBetaFeedback,
  getBetaPlan,
  getLaunchReadiness,
  getLegalAndSupportReadiness,
  runFinalRegression
} from "../../src/launch-engine.mjs";

describe("Sprint 8 beta, regression, and launch readiness", () => {
  it("publishes closed-beta cohorts, task scripts, and scope freeze rules", () => {
    const plan = getBetaPlan();

    assert.equal(plan.status, "ok");
    assert.equal(plan.launch_version, "sprint8-v1");
    assert.equal(plan.beta_status, "ready_for_closed_beta");
    assert.ok(plan.cohorts.some((cohort) => cohort.cohort === "salaried"));
    assert.ok(plan.cohorts.some((cohort) => cohort.cohort === "tax_professional"));
    assert.ok(plan.task_scripts.some((task) => task.task_id === "BETA-004"));
    assert.ok(plan.defect_taxonomy.includes("calculation"));
    assert.equal(plan.scope_freeze.status, "frozen_for_v1");
  });

  it("classifies beta feedback into launch-blocking defect taxonomy", () => {
    const triage = classifyBetaFeedback({
      description: "Tax amount looks wrong for the 112A scenario after date split."
    });

    assert.equal(triage.status, "ok");
    assert.equal(triage.category, "calculation");
    assert.equal(triage.severity, "high");
    assert.equal(triage.launch_blocker, true);
    assert.equal(triage.recommended_owner, "tax-engineering");
    assert.match(triage.defect_id, /^BETA-[A-F0-9]{12}$/);

    const contentTriage = classifyBetaFeedback({
      category: "content",
      severity: "low",
      description: "Label casing could be clearer."
    });
    assert.equal(contentTriage.launch_blocker, false);
  });

  it("runs the final machine regression matrix", async () => {
    const regression = await runFinalRegression();

    assert.equal(regression.status, "ok");
    assert.equal(regression.launch_version, "sprint8-v1");
    assert.equal(regression.machine_gate_status, "pass");
    assert.equal(regression.golden_vectors.total, 30);
    assert.equal(regression.golden_vectors.failed, 0);
    assert.equal(regression.golden_vectors.pass_rate, 1);
    assert.ok(regression.regression_suites.every((suite) => suite.status === "pass"));
    assert.equal(regression.period_coverage.find((item) => item.period === "2024-25").status, "excluded_from_current_runtime");
    assert.equal(regression.period_coverage.find((item) => item.period === "2026-27").status, "active");
    assert.equal(regression.source_register.retrieved_on, "2026-05-08");
  });

  it("separates machine readiness from human stakeholder approvals", async () => {
    const pending = await getLaunchReadiness();
    assert.equal(pending.machine_gate_status, "pass");
    assert.equal(pending.closed_beta_status, "ready");
    assert.equal(pending.public_launch_status, "blocked_pending_stakeholder_signoff");
    assert.equal(pending.gates.find((gate) => gate.gate === "stakeholder_approval").status, "pending");

    const approved = await getLaunchReadiness({
      approvals: {
        product: "approved",
        engineering: "approved",
        tax_domain: "approved"
      },
      open_defects: []
    });
    assert.equal(approved.public_launch_status, "go");

    const blocked = await getLaunchReadiness({
      approvals: {
        product: "approved",
        engineering: "approved",
        tax_domain: "approved"
      },
      open_defects: [{ category: "security", severity: "high", description: "Header bypass." }]
    });
    assert.equal(blocked.public_launch_status, "blocked_by_machine_gate");
    assert.equal(blocked.open_defect_summary.launch_blockers, 1);
  });

  it("serves launch endpoints through the API", async () => {
    const server = buildServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const betaPlan = await getJson(baseUrl, "/api/v1/launch/beta-plan");
      assert.equal(betaPlan.beta_status, "ready_for_closed_beta");

      const triage = await postJson(baseUrl, "/api/v1/launch/triage", {
        description: "Keyboard focus is missing on the report download button."
      });
      assert.equal(triage.category, "accessibility");
      assert.ok(["medium", "high"].includes(triage.severity));

      const regression = await getJson(baseUrl, "/api/v1/launch/regression");
      assert.equal(regression.golden_vectors.failed, 0);

      const readiness = await postJson(baseUrl, "/api/v1/launch/readiness", {
        approvals: {
          product: "approved",
          engineering: "approved",
          tax_domain: "approved"
        }
      });
      assert.equal(readiness.public_launch_status, "go");

      const support = await getJson(baseUrl, "/api/v1/launch/legal-support");
      assert.match(support.disclaimer.text, /supported v1 scenarios/);
      assert.ok(support.launch_rollback_plan.length >= 3);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("adds launch controls to the wizard UI and launch plan document", async () => {
    const [html, css, js, launchDoc] = await Promise.all([
      readFile(new URL("../../public/index.html", import.meta.url), "utf8"),
      readFile(new URL("../../public/styles.css", import.meta.url), "utf8"),
      readFile(new URL("../../public/app.js", import.meta.url), "utf8"),
      readFile(new URL("../../docs/release/LAUNCH.md", import.meta.url), "utf8")
    ]);

    assert.match(html, /data-step="launch"/);
    assert.match(html, /id="run-regression-button"/);
    assert.match(html, /id="classify-feedback-button"/);
    assert.match(html, /id="launch-output"/);
    assert.match(css, /\.launch-grid/);
    assert.match(css, /\.launch-card/);
    assert.match(js, /\/api\/v1\/launch\/beta-plan/);
    assert.match(js, /\/api\/v1\/launch\/regression/);
    assert.match(js, /\/api\/v1\/launch\/readiness/);
    assert.match(js, /\/api\/v1\/launch\/triage/);
    assert.match(launchDoc, /Final Regression Matrix/);
    assert.match(launchDoc, /Machine-Readable Endpoints/);
  });

  it("publishes legal and support readiness payloads", () => {
    const support = getLegalAndSupportReadiness();

    assert.equal(support.status, "ok");
    assert.equal(support.disclaimer.status, "draft_ready_for_counsel_review");
    assert.ok(support.support_sop.some((item) => item.includes("computation hash")));
    assert.ok(support.launch_rollback_plan.some((item) => item.includes("Rerun golden vectors")));
  });
});

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
