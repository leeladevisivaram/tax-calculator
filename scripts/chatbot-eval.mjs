import assert from "node:assert/strict";
import { buildChatbotResponseAsync, CHATBOT_KNOWLEDGE } from "../src/chatbot-engine.mjs";

const inScopeCases = [
  ["I do not know tax where should I start?", /Start with Profile/i],
  ["I am a beginner with salary income what should I do?", /beginner salary flow/i],
  ["Should I use import or manual entry?", /manual entry/i],
  ["I know my income and deductions how should I compare regimes?", /Compare regimes/i],
  ["I have salary and interest income how do I use the app?", /income head/i],
  ["I am an advanced user how do I audit the calculation?", /worksheet/i],
  ["How should I enter capital gains as an advanced user?", /Capital gains|Business\/profession/i],
  ["Can the app import AIS automatically?", /not active/i],
  ["Can I upload a PDF Form 16?", /PDF upload is active/i],
  ["How do I upload an import file?", /CSV, JSON, or PDF file picker/i],
  ["Can I save my calculation online?", /not active/i],
  ["How does the calculator know which rulepack is being used?", /rulepack/i],
  ["Which provisions does this calculator support?", /supported calculator scenarios/i],
  ["Where is the source register shown?", /source trace/i],
  ["What should I enter on the profile page?", /Profile/i],
  ["How do I use import preview?", /preview/i],
  ["Can I import Form 16 values?", /Form 16/i],
  ["Where do I enter gross salary?", /salary/i],
  ["Where do I enter 112A capital gains?", /Capital gains/i],
  ["Where do I enter 80C?", /80C/i],
  ["Where do I enter TDS?", /TDS/i],
  ["How do I compute tax?", /Compute/i],
  ["Where is likely ITR form shown?", /ITR/i],
  ["How do I generate a report?", /explain|download/i],
  ["What does Age is missing mean?", /Age field/i],
  ["Why is HRA showing a regime warning?", /regime/i],
  ["How do I delete local data?", /delete local/i],
  ["Where do I check launch readiness?", /Readiness/i],
  ["Can I use the app with keyboard?", /keyboard|Tab|focus/i],
  ["How do I run all tests?", /test/i]
];

const refusalCases = [
  "Which mutual fund should I buy?",
  "Give me legal advice for my tax notice.",
  "How do I avoid tax?",
  "What is the weather today?"
];

const actionCases = [
  ["Set gross salary to 900000", "gross_salary"],
  ["add HRA 30400", "hra_received"],
  ["Choose old regime and set gross salary to 800000", "regime"],
  ["Fill 80C as 150000", "deduction_80c"]
];

const failures = [];

for (const entry of CHATBOT_KNOWLEDGE) {
  try {
    assert.match(entry.id, /^[a-z0-9_.-]+$/);
    assert.ok(entry.category);
    assert.ok(entry.source_doc);
    assert.ok(entry.feature);
    assert.ok(entry.task);
    assert.ok(entry.questions.length >= 3);
    assert.ok(entry.answer);
    assert.ok(Array.isArray(entry.citations));
    assert.ok(Array.isArray(entry.actions));
    assert.ok(Array.isArray(entry.tags));
  } catch (error) {
    failures.push(`${entry.id}: ${error.message}`);
  }
}

let inScopePass = 0;
for (const [prompt, expected] of inScopeCases) {
  const answer = await buildChatbotResponseAsync({ message: prompt }, { aiEnabled: false });
  if (answer.scope === "in_scope" && expected.test(answer.reply)) {
    inScopePass += 1;
  } else {
    failures.push(`In-scope failed: "${prompt}" -> ${answer.reply}`);
  }
}

let refusalPass = 0;
for (const prompt of refusalCases) {
  const answer = await buildChatbotResponseAsync({ message: prompt }, { aiEnabled: false });
  if (answer.scope === "out_of_scope" && answer.actions.length === 0) {
    refusalPass += 1;
  } else {
    failures.push(`Refusal failed: "${prompt}" -> ${answer.reply}`);
  }
}

let actionPass = 0;
for (const [prompt, field] of actionCases) {
  const answer = await buildChatbotResponseAsync({ message: prompt }, { aiEnabled: false });
  if (answer.actions.some((action) => action.field === field)) {
    actionPass += 1;
  } else {
    failures.push(`Action mapping failed: "${prompt}" -> ${JSON.stringify(answer.actions)}`);
  }
}

const inScopeAccuracy = inScopePass / inScopeCases.length;
const refusalAccuracy = refusalPass / refusalCases.length;
const actionAccuracy = actionPass / actionCases.length;

if (inScopeAccuracy < 0.95) failures.push(`In-scope accuracy ${formatPercent(inScopeAccuracy)} is below 95%.`);
if (refusalAccuracy < 1) failures.push(`Refusal accuracy ${formatPercent(refusalAccuracy)} is below 100%.`);
if (actionAccuracy < 1) failures.push(`Action accuracy ${formatPercent(actionAccuracy)} is below 100%.`);

console.log("# Chatbot Eval");
console.log(`Knowledge entries: ${CHATBOT_KNOWLEDGE.length}`);
console.log(`In-scope accuracy: ${formatPercent(inScopeAccuracy)} (${inScopePass}/${inScopeCases.length})`);
console.log(`Refusal accuracy: ${formatPercent(refusalAccuracy)} (${refusalPass}/${refusalCases.length})`);
console.log(`Action accuracy: ${formatPercent(actionAccuracy)} (${actionPass}/${actionCases.length})`);

if (failures.length) {
  console.error("\nFailures:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
}

function formatPercent(value) {
  return `${Math.round(value * 10000) / 100}%`;
}
