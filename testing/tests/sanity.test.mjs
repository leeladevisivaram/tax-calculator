import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("Feature: Sanity checks", () => {
  describe("Task: QA documents and suite wiring", () => {
    it("documents negative data, required UI validation, sanity, smoke, BVT, and regression scope", async () => {
      const qaDocs = await readFile(new URL("../../docs/testing/TEST_STRATEGY_AND_CASES.md", import.meta.url), "utf8");

      for (const requiredText of [
        "Negative Input Values",
        "Concrete Input Values For QA",
        "Required UI Element And Button Validation",
        "Sanity And Smoke Coverage",
        "Compute button is missing (#compute-button)."
      ]) {
        assert.match(qaDocs, new RegExp(escapeRegExp(requiredText)));
      }

      for (const requiredText of [
        "Negative Test Data Matrix",
        "Required UI Elements And Button Data",
        "Sanity And Smoke Test Scope",
        "testing/tests/validation.test.mjs",
        "testing/tests/sanity.test.mjs",
        "testing/tests/smoke.test.mjs"
      ]) {
        assert.match(qaDocs, new RegExp(escapeRegExp(requiredText)));
      }
    });

    it("keeps package scripts wired for check, raw tests, and report generation", async () => {
      const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));

      assert.equal(packageJson.scripts.check, "node scripts/check-syntax.mjs");
      assert.equal(packageJson.scripts.build, "vite build --config vite.config.mjs");
      assert.equal(packageJson.scripts["test:node"], "node --test testing/tests");
      assert.match(packageJson.scripts["test:e2e"], /playwright test/);
      assert.equal(packageJson.scripts.test, "node scripts/run-tests-with-report.mjs");
      assert.equal(packageJson.dependencies.react, "19.2.6");
      assert.equal(packageJson.dependencies["react-dom"], "19.2.6");
      assert.equal(packageJson.dependencies.vite, "8.0.12");
    });
  });
});

describe("Feature: Rule data sanity", () => {
  describe("Task: golden vectors and source register", () => {
    it("keeps golden vectors within the approved v1 count and backed by sources", async () => {
      const vectors = JSON.parse(await readFile(new URL("../../sprint-zero/golden-test-vectors.json", import.meta.url), "utf8"));
      const sourceRegister = JSON.parse(await readFile(new URL("../../sprint-zero/source-register.json", import.meta.url), "utf8"));
      const provisions = JSON.parse(await readFile(new URL("../../sprint-zero/v1-supported-provisions.json", import.meta.url), "utf8"));

      assert.ok(vectors.vectors.length >= 25);
      assert.ok(vectors.vectors.length <= 30);
      assert.equal(vectors.vectors.length, 30);
      assert.ok(sourceRegister.sources.length > 0);

      const sourceIds = new Set(sourceRegister.sources.map((source) => source.source_id));
      const supported = provisions.decisions.filter((decision) => decision.v1_decision === "supported");
      assert.ok(supported.length > 0);
      for (const decision of supported) {
        assert.ok(decision.source_ids.length > 0, `${decision.provision_id} should have source IDs`);
        for (const sourceId of decision.source_ids) {
          assert.equal(sourceIds.has(sourceId), true, `${decision.provision_id} references ${sourceId}`);
        }
      }
    });
  });
});

describe("Feature: UI message sanity", () => {
  describe("Task: public labels and visible messages", () => {
    it("does not expose sprint names or internal version tokens in static user-facing UI files", async () => {
      const indexHtml = await readFile(new URL("../../public/index.html", import.meta.url), "utf8");
      const appJs = await readFile(new URL("../../public/app.js", import.meta.url), "utf8");

      assert.doesNotMatch(indexHtml, /Sprint \d|sprint\d+-v\d+/i);
      assert.doesNotMatch(appJs, /Sprint 4|Sprint 7 tests|sprint7-v1|sprint8-v1/);
      assert.match(appJs, /Inputs are clear for this supported calculation flow/);
      assert.match(appJs, /Privacy policy<\/strong>/);
    });
  });
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
