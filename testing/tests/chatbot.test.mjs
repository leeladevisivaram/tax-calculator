import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  buildChatbotResponse,
  buildChatbotResponseAsync,
  CHATBOT_AI_CONFIG,
  CHATBOT_DATASET,
  CHATBOT_KNOWLEDGE,
  CHATBOT_KNOWLEDGE_CATEGORIES
} from "../../src/chatbot-engine.mjs";
import { appendChatbotInteraction, buildChatbotInteractionRecord } from "../../src/chatbot-interactions.mjs";
import { buildServer } from "../../src/server.mjs";

describe("Feature: Local application chatbot", () => {
  describe("Task: scoped answers and guardrails", () => {
    it("answers app navigation questions with calculator-only guidance", () => {
      const answer = buildChatbotResponse({ message: "Where do I enter TDS?" });

      assert.equal(answer.status, "ok");
      assert.equal(answer.scope, "in_scope");
      assert.match(answer.reply, /Credits/);
      assert.deepEqual(answer.actions, [{ type: "navigate", step: "credits", label: "Credits step" }]);
      assert.ok(answer.citations.some((citation) => citation.target === "usage-guide-credits"));
      assert.doesNotMatch(answer.reply, /Sprint \d|sprint\d+-v\d+/i);
    });

    it("returns field-fill actions for a supported single-field command", () => {
      const answer = buildChatbotResponse({ message: "Set gross salary to 900000" });

      assert.equal(answer.scope, "in_scope");
      assert.equal(answer.requires_confirmation, false);
      assert.ok(answer.actions.some((action) => action.type === "set_checked" && action.field === "income_head_salary"));
      assert.ok(answer.actions.some((action) => action.type === "set_value" && action.field === "gross_salary" && action.value === "900000"));
    });

    it("returns salary-card actions for natural HRA add commands", () => {
      const answer = buildChatbotResponse({ message: "add HRA 30400" });

      assert.equal(answer.scope, "in_scope");
      assert.equal(answer.requires_confirmation, false);
      assert.match(answer.reply, /HRA received/);
      assert.ok(answer.actions.some((action) => action.type === "set_checked" && action.field === "income_head_salary"));
      assert.ok(answer.actions.some((action) => action.type === "set_value" && action.field === "hra_received" && action.value === "30400"));
    });

    it("requires confirmation when one prompt changes multiple user-facing values", () => {
      const answer = buildChatbotResponse({ message: "Choose old regime and set gross salary to 900000" });

      assert.equal(answer.requires_confirmation, true);
      assert.ok(answer.actions.some((action) => action.type === "set_radio" && action.field === "regime" && action.value === "old"));
      assert.ok(answer.actions.some((action) => action.type === "set_value" && action.field === "gross_salary" && action.value === "900000"));
    });

    it("refuses unrelated or advisory prompts without actions", () => {
      const answer = buildChatbotResponse({ message: "Which mutual fund should I buy?" });

      assert.equal(answer.scope, "out_of_scope");
      assert.match(answer.reply, /this calculator/);
      assert.deepEqual(answer.actions, []);
    });

    it("keeps a curated dataset for examples, refusals, and supported intents", () => {
      assert.ok(CHATBOT_DATASET.supportedIntents.includes("form_fill"));
      assert.ok(CHATBOT_DATASET.refusalExamples.length >= 4);
      assert.ok(CHATBOT_DATASET.fieldExamples.some((example) => /gross salary/i.test(example)));
    });

    it("keeps a machine-readable knowledge bank for local ML retrieval", () => {
      assert.ok(CHATBOT_KNOWLEDGE.length >= 35);
      assert.equal(CHATBOT_AI_CONFIG.default_model, "Xenova/all-MiniLM-L6-v2");
      assert.equal(CHATBOT_AI_CONFIG.hosted_api_required, false);

      for (const entry of CHATBOT_KNOWLEDGE) {
        assert.match(entry.id, /^[a-z0-9_.-]+$/);
        assert.ok(CHATBOT_KNOWLEDGE_CATEGORIES.includes(entry.category), `${entry.id} has allowed category`);
        assert.ok(entry.source_doc, `${entry.id} has source doc`);
        assert.ok(entry.feature, `${entry.id} has feature`);
        assert.ok(entry.task, `${entry.id} has task`);
        assert.ok(entry.questions.length >= 3, `${entry.id} has multiple questions`);
        assert.ok(entry.answer, `${entry.id} has approved answer`);
        assert.ok(Array.isArray(entry.citations), `${entry.id} has citations array`);
        assert.ok(Array.isArray(entry.actions), `${entry.id} has actions array`);
        assert.ok(Array.isArray(entry.tags), `${entry.id} has tags`);
      }
    });

    it("answers approved knowledge-bank questions with match metadata", async () => {
      const answer = await buildChatbotResponseAsync({
        message: "Where is the source register shown?"
      }, { aiEnabled: false });

      assert.equal(answer.scope, "in_scope");
      assert.equal(answer.match_id, "rules.source_register.review");
      assert.equal(answer.match_source, "knowledge_exact");
      assert.match(answer.reply, /source trace/i);
      assert.ok(answer.actions.some((action) => action.step === "results"));
    });

    it("guides no-knowledge, beginner, intermediate, and advanced app users", async () => {
      const beginner = await buildChatbotResponseAsync({
        message: "I do not know tax where should I start?"
      }, { aiEnabled: false });
      assert.equal(beginner.match_id, "onboarding.no_knowledge.start");
      assert.match(beginner.reply, /Start with Profile/);
      assert.ok(beginner.actions.some((action) => action.step === "profile"));

      const intermediate = await buildChatbotResponseAsync({
        message: "I know my income and deductions how should I compare regimes?"
      }, { aiEnabled: false });
      assert.equal(intermediate.match_id, "onboarding.intermediate.compare");
      assert.match(intermediate.reply, /Compare regimes/);

      const advanced = await buildChatbotResponseAsync({
        message: "I am an advanced user how do I audit the calculation?"
      }, { aiEnabled: false });
      assert.equal(advanced.match_id, "onboarding.advanced.trace");
      assert.match(advanced.reply, /worksheet/);
    });

    it("answers PDF import questions with the active supported flow", async () => {
      const answer = await buildChatbotResponseAsync({
        message: "Can I upload a PDF Form 16?"
      }, { aiEnabled: false });

      assert.equal(answer.scope, "in_scope");
      assert.equal(answer.match_id, "imports.file_upload.pdf");
      assert.match(answer.reply, /PDF upload is active/);
      assert.match(answer.reply, /salary, TDS, 80C/);
      assert.ok(answer.actions.some((action) => action.step === "imports"));
    });

    it("uses injected local retrieval without a hosted LLM API", async () => {
      const answer = await buildChatbotResponseAsync({
        message: "I need help with paid tax details"
      }, {
        retriever: async ({ entries }) => {
          return {
            id: entries.find((entry) => entry.id === "credits.tax_paid").id,
            score: 0.91,
            source: "local_ml_retrieval"
          };
        }
      });

      assert.equal(answer.match_id, "credits.tax_paid");
      assert.equal(answer.match_source, "local_ml_retrieval");
      assert.match(answer.reply, /TDS, TCS, advance tax/);
      assert.ok(answer.actions.some((action) => action.step === "credits"));
    });

    it("falls back when model-backed retrieval fails", async () => {
      const answer = await buildChatbotResponseAsync({
        message: "download artifacts outputs"
      }, {
        minScore: 0.3,
        modelRetriever: async () => {
          throw new Error("model unavailable");
        }
      });

      assert.equal(answer.scope, "in_scope");
      assert.equal(answer.match_id, "reports.explain.download");
      assert.equal(answer.match_source, "knowledge_keyword_fallback");
      assert.equal(answer.ai_status, "model_fallback");
      assert.match(answer.reply, /Run Explain/);
    });
  });

  describe("Task: chatbot API", () => {
    it("serves chatbot responses through the HTTP API", async () => {
      const server = buildServer();
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const response = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "Why is Age missing?", form_state: {} })
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.status, "ok");
        assert.match(body.reply, /Age field in Profile/);
        assert.equal(body.interaction_log.status, "stored");
        assert.equal(body.interaction_log.schema_version, "chat-interaction-v1");
        assert.ok(body.audit_id);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it("serves the chatbot API matrix for app questions, actions, unavailable features, and refusals", async () => {
      const server = buildServer();
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const cases = [
        {
          message: "I do not know tax where should I start?",
          scope: "in_scope",
          reply: /Start with Profile/,
          step: "profile"
        },
        {
          message: "I know my income and deductions how should I compare regimes?",
          scope: "in_scope",
          reply: /Compare regimes/,
          step: "results"
        },
        {
          message: "Can I upload a PDF Form 16?",
          scope: "in_scope",
          reply: /PDF upload is active/,
          step: "imports"
        },
        {
          message: "Set gross salary to 900000",
          scope: "in_scope",
          reply: /Gross salary/,
          field: "gross_salary"
        },
        {
          message: "Which mutual fund should I buy?",
          scope: "out_of_scope",
          reply: /outside the app/,
          noActions: true
        },
        {
          message: "",
          scope: "in_scope",
          reply: /Ask where to enter a value/,
          noActions: true
        }
      ];

      try {
        for (const item of cases) {
          const response = await fetch(`${baseUrl}/api/v1/chatbot/message`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ message: item.message, form_state: {} })
          });
          assert.equal(response.status, 200);
          const body = await response.json();
          assert.equal(body.scope, item.scope, item.message);
          assert.match(body.reply, item.reply, item.message);
          assert.doesNotMatch(body.reply, /Sprint \d|sprint\d+-v\d+|sprint-zero/i);
          if (item.step) assert.ok(body.actions.some((action) => action.step === item.step), `${item.message} navigates to ${item.step}`);
          if (item.field) assert.ok(body.actions.some((action) => action.field === item.field), `${item.message} includes ${item.field}`);
          if (item.noActions) assert.deepEqual(body.actions, []);
          assert.equal(body.interaction_log.status, "stored");
          assert.ok(body.audit_id);
        }
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it("persists redacted chatbot interaction records for local improvement", async () => {
      const previousDir = process.env.CHATBOT_INTERACTION_LOG_DIR;
      const logDir = await mkdtemp(path.join(tmpdir(), "tax-chatbot-log-"));
      process.env.CHATBOT_INTERACTION_LOG_DIR = logDir;

      try {
        const response = buildChatbotResponse({ message: "Set gross salary to 900000" });
        const result = await appendChatbotInteraction({
          request: {
            message: "My PAN ABCDE1234F and email user@example.com; add HRA 30400",
            form_state: { gross_salary: "900000", age_years: "34" }
          },
          response
        });

        const raw = await readFile(result.path, "utf8");
        const record = JSON.parse(raw.trim());
        assert.equal(record.schema_version, "chat-interaction-v1");
        assert.match(record.user_message, /\[redacted_pan\]/);
        assert.match(record.user_message, /\[redacted_email\]/);
        assert.deepEqual(record.form_state_keys, ["age_years", "gross_salary"]);
        assert.equal(record.improvement_signals.action_count, response.actions.length);

        const built = buildChatbotInteractionRecord({ request: { message: "Which mutual fund should I buy?" }, response: { scope: "out_of_scope" } });
        assert.equal(built.improvement_signals.out_of_scope, true);
      } finally {
        if (previousDir === undefined) delete process.env.CHATBOT_INTERACTION_LOG_DIR;
        else process.env.CHATBOT_INTERACTION_LOG_DIR = previousDir;
      }
    });
  });
});
