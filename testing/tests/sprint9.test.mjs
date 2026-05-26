import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { buildChatbotResponse, buildChatbotResponseAsync } from "../../src/chatbot-engine.mjs";
import { previewImport } from "../../src/import-engine.mjs";
import { extractForm16FieldsFromText, extractPdfImport } from "../../src/pdf-import-engine.mjs";

const sampleForm16 = new URL("../test-data/imports/sample-form16.csv", import.meta.url);
const sampleForm16Pdf = new URL("../test-data/imports/sample-form16.pdf", import.meta.url);
const sampleDeductions = new URL("../test-data/imports/sample-deductions.json", import.meta.url);
const sampleCapitalGains = new URL("../test-data/imports/sample-capital-gains.csv", import.meta.url);

describe("Feature: Sprint 9 chatbot learning and document-upload imports", () => {
  describe("Task: chatbot field-fill agent", () => {
    it("maps add-HRA phrasing to the HRA input and salary income head", () => {
      const answer = buildChatbotResponse({ message: "add HRA 30400" });

      assert.equal(answer.scope, "in_scope");
      assert.equal(answer.requires_confirmation, false);
      assert.ok(answer.actions.some((action) => action.type === "set_checked" && action.field === "income_head_salary"));
      assert.ok(answer.actions.some((action) => action.type === "set_value" && action.field === "hra_received" && action.value === "30400"));
    });

    it("answers supported CSV, JSON, and PDF upload questions", async () => {
      const answer = await buildChatbotResponseAsync({
        message: "How do I upload an import file?"
      }, { aiEnabled: false });

      assert.equal(answer.match_id, "imports.file_upload.csv_json_pdf");
      assert.match(answer.reply, /CSV, JSON, or PDF file picker/);
      assert.match(answer.reply, /searchable Form 16 PDFs/);
      assert.ok(answer.actions.some((action) => action.step === "imports"));
    });
  });

  describe("Task: sample document import parsing", () => {
    it("previews sample Form 16 CSV values for review", async () => {
      const content = await readFile(sampleForm16, "utf8");
      const preview = await previewImport({
        import_type: "form16",
        filename: "sample-form16.csv",
        content
      });

      assert.equal(preview.status, "ok");
      assert.ok(preview.review_items.some((item) => item.path === "income.salary.gross_salary" && item.proposed_value === 900000));
      assert.ok(preview.review_items.some((item) => item.path === "tax_credits.tds" && item.proposed_value === 45000));
      assert.equal(preview.confirmation_required, true);
    });

    it("extracts sample Form 16 PDF values into the existing import preview", async () => {
      const pdfBytes = await readFile(sampleForm16Pdf);
      const extracted = await extractPdfImport({
        import_type: "form16",
        filename: "sample-form16.pdf",
        content_base64: pdfBytes.toString("base64")
      });

      assert.equal(extracted.status, "ok");
      assert.match(extracted.structured_content, /gross_salary,tds,deduction_80c,employer_name/);
      assert.equal(extracted.extraction.fields.gross_salary, 900000);
      assert.equal(extracted.extraction.fields.tds, 45000);
      assert.equal(extracted.extraction.fields.deduction_80c, 150000);
      assert.ok(extracted.preview.review_items.some((item) => item.path === "income.salary.gross_salary" && item.proposed_value === 900000));
      assert.ok(extracted.preview.review_items.some((item) => item.path === "tax_credits.tds" && item.proposed_value === 45000));
    });

    it("can use an injected Hugging Face-style resolver for missing PDF fields without browser math", async () => {
      const extraction = await extractForm16FieldsFromText("Form 16\nGross salary 900000\nCredits summary 45000", {
        fieldResolver: async ({ missingFields }) => ({
          source: "huggingface_embedding_match",
          score: 0.88,
          fields: missingFields.map((field) => ({ field, value: field === "tds" ? 45000 : 0, confidence: "medium" }))
        })
      });

      assert.equal(extraction.fields.gross_salary, 900000);
      assert.equal(extraction.fields.tds, 45000);
      assert.equal(extraction.ai.source, "huggingface_embedding_match");
      assert.deepEqual(extraction.missing_fields, []);
    });

    it("previews sample deduction JSON values for review", async () => {
      const content = await readFile(sampleDeductions, "utf8");
      const preview = await previewImport({
        import_type: "deductions",
        filename: "sample-deductions.json",
        content
      });

      assert.equal(preview.status, "ok");
      assert.ok(preview.review_items.some((item) => item.proposed_value.section === "80C" && item.proposed_value.amount === 150000));
      assert.ok(preview.review_items.some((item) => item.proposed_value.section === "80D" && item.proposed_value.premium === 25000));
    });

    it("previews sample capital-gains CSV values for review", async () => {
      const content = await readFile(sampleCapitalGains, "utf8");
      const preview = await previewImport({
        import_type: "capital_gains",
        filename: "sample-capital-gains.csv",
        content
      });

      assert.equal(preview.status, "ok");
      assert.ok(preview.review_items.some((item) => item.path.includes("capital_gains") && item.proposed_value.net_gain === 125000));
      assert.equal(preview.proposed_request_patch.income.capital_gains[0].net_gain, 125000);
    });
  });
});
