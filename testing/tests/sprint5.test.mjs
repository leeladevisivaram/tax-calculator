import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { buildServer } from "../../src/server.mjs";
import { explainTaxRequest, getSourceById } from "../../src/report-engine.mjs";

const vectors = JSON.parse(await readFile(new URL("../../sprint-zero/golden-test-vectors.json", import.meta.url), "utf8"));

function vector(id) {
  const found = vectors.vectors.find((item) => item.id === id);
  if (!found) throw new Error(`Missing vector ${id}`);
  return found;
}

describe("Sprint 5 explanation layer", () => {
  it("builds a worksheet with rule trace, source evidence, and support metadata", async () => {
    const report = await explainTaxRequest(vector("TV-005").input);

    assert.equal(report.status, "ok");
    assert.equal(report.report_version, "sprint5-v1");
    assert.ok(report.worksheet.length >= 10);
    assert.ok(report.worksheet.some((line) => line.line_id === "special_rate_tax"));
    assert.ok(report.rule_trace.some((rule) => rule.rule_id.startsWith("slab.")));
    assert.ok(report.sources.some((source) => source.source_id === "SRC-SECTION-112A"));
    assert.ok(report.sources.every((source) => source.title && source.retrieved_on));
    assert.ok(report.support.computation_hash);
    assert.ok(report.support.rulepack_checksum);
    assert.ok(report.report_html.includes("Tax calculation report"));
    assert.ok(report.report_html.includes("SRC-SECTION-112A"));
  });

  it("serves explain and source lookup endpoints", async () => {
    const server = buildServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const report = await postJson(baseUrl, "/api/v1/reports/explain", vector("TV-001").input);
      assert.equal(report.status, "ok");
      assert.equal(report.metadata.rulepack_version, "ay-2026-27-v1");
      assert.equal(report.metadata.source_register_retrieved_on, "2026-05-08");
      assert.ok(report.downloads.json_filename.endsWith(".json"));
      assert.ok(report.downloads.html_filename.endsWith(".html"));

      const sourceResponse = await fetch(`${baseUrl}/api/v1/sources/SRC-SECTION-87A`);
      assert.equal(sourceResponse.status, 200);
      const sourceBody = await sourceResponse.json();
      assert.equal(sourceBody.status, "ok");
      assert.equal(sourceBody.source.source_id, "SRC-SECTION-87A");
      assert.equal(sourceBody.source.retrieved_on, "2026-05-08");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("looks up source-register records directly", async () => {
    const source = await getSourceById("SRC-ITD-SALARIED-AY2026");
    assert.equal(source.source_id, "SRC-ITD-SALARIED-AY2026");
    assert.equal(source.confidence, "primary");
    assert.equal(source.retrieved_on, "2026-05-08");
  });

  it("adds report controls to the wizard UI", async () => {
    const [html, js] = await Promise.all([
      readFile(new URL("../../public/index.html", import.meta.url), "utf8"),
      readFile(new URL("../../public/app.js", import.meta.url), "utf8")
    ]);

    assert.match(html, /id="report-output"/);
    assert.match(html, /id="explain-button"/);
    assert.match(html, /id="download-json-button"/);
    assert.match(html, /id="download-html-button"/);
    assert.match(js, /\/api\/v1\/reports\/explain/);
    assert.match(js, /downloadJsonReport/);
    assert.match(js, /downloadHtmlReport/);
  });
});

async function postJson(baseUrl, path, payload) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 200);
  return response.json();
}
