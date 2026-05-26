import { spawn } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const testSourceDir = path.join(rootDir, "testing", "tests");
const outputDir = path.join(rootDir, "testing", "output");
const startedAt = new Date();
const nodeFiles = await listNativeTestFiles();
const nodeArgs = ["--test", ...nodeFiles];
if (process.env.TEST_CONCURRENCY) {
  nodeArgs.splice(1, 0, `--test-concurrency=${process.env.TEST_CONCURRENCY}`);
}

const playwrightWorkers = process.env.PW_WORKERS ?? process.env.TEST_CONCURRENCY ?? "5";
const playwrightCli = path.join(rootDir, "node_modules", "@playwright", "test", "cli.js");
const playwrightArgs = [playwrightCli, "test", "--config", "playwright.config.mjs", `--workers=${playwrightWorkers}`];

const phases = [
  {
    name: "Native node:test",
    command: `${path.basename(process.execPath)} ${nodeArgs.join(" ")}`,
    runner: () => runCommand(process.execPath, nodeArgs)
  },
  {
    name: "React/Vite build",
    command: `${path.basename(process.execPath)} node_modules/vite/bin/vite.js build --config vite.config.mjs`,
    runner: () => runCommand(process.execPath, [path.join(rootDir, "node_modules", "vite", "bin", "vite.js"), "build", "--config", "vite.config.mjs"])
  },
  {
    name: "Playwright Chrome E2E",
    command: `${headlessPrefix()}${path.basename(process.execPath)} ${playwrightArgs.map(displayArg).join(" ")}`,
    runner: () => runCommand(process.execPath, playwrightArgs, {
      ...process.env,
      PW_WORKERS: playwrightWorkers
    })
  }
];

const results = [];
for (const phase of phases) {
  console.log(`\n# ${phase.name}`);
  console.log(`# ${phase.command}`);
  results.push({
    ...phase,
    result: await phase.runner()
  });
}

const endedAt = new Date();
const exitCode = results.some((phase) => phase.result.exitCode !== 0) ? 1 : 0;
const report = renderReport({
  startedAt,
  endedAt,
  exitCode,
  results,
  mode: {
    headless: process.env.HEADLESS,
    testConcurrency: process.env.TEST_CONCURRENCY,
    playwrightWorkers
  }
});

await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "TEST_REPORT.md"), report);
process.exitCode = exitCode;

async function listNativeTestFiles() {
  const entries = await readdir(testSourceDir);
  return entries
    .filter((entry) => entry.endsWith(".test.mjs"))
    .sort()
    .map((entry) => path.join("testing", "tests", entry));
}

function runCommand(command, args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", (error) => {
      stderr += `${error.message}\n`;
      resolve({ exitCode: 1, stdout, stderr });
    });

    child.on("close", (phaseExitCode) => {
      resolve({ exitCode: phaseExitCode ?? 1, stdout, stderr });
    });
  });
}

function parseNodeSummary(output) {
  return {
    suites: numberAfter(output, "suites"),
    tests: numberAfter(output, "tests"),
    pass: numberAfter(output, "pass"),
    fail: numberAfter(output, "fail"),
    cancelled: numberAfter(output, "cancelled"),
    skipped: numberAfter(output, "skipped"),
    todo: numberAfter(output, "todo"),
    duration_ms: numberAfter(output, "duration_ms")
  };
}

function parsePlaywrightSummary(output, exitCode) {
  const failed = numberBeforeWord(output, "failed");
  const passed = numberBeforeWord(output, "passed");
  const skipped = numberBeforeWord(output, "skipped");
  const timedOut = numberBeforeWord(output, "timed out");
  return {
    suites: 0,
    tests: passed + failed + skipped + timedOut,
    pass: passed,
    fail: failed + timedOut + (exitCode !== 0 && passed + failed + skipped + timedOut === 0 ? 1 : 0),
    cancelled: 0,
    skipped,
    todo: 0,
    duration_ms: 0
  };
}

function numberAfter(output, label) {
  const match = output.match(new RegExp(`# ${label} (\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : 0;
}

function numberBeforeWord(output, label) {
  const matches = [...output.matchAll(new RegExp(`(\\d+)\\s+${label}`, "gi"))];
  return matches.reduce((total, match) => total + Number(match[1]), 0);
}

function parseFailures(output) {
  const tapFailures = output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("not ok"))
    .map((line) => line.replace(/^not ok\s+\d+\s+-\s+/, "").trim());
  const playwrightFailures = output
    .split(/\r?\n/)
    .filter((line) => /^\s*\d+\)\s+/.test(line))
    .map((line) => line.trim());
  return [...tapFailures, ...playwrightFailures];
}

function renderReport({ startedAt, endedAt, exitCode, results, mode }) {
  const status = exitCode === 0 ? "PASS" : "FAIL";
  const durationMs = endedAt.getTime() - startedAt.getTime();
  const phaseRows = results.map(({ name, command, result }) => {
    const summary = phaseSummary(name, result);
    return `| ${name} | ${result.exitCode === 0 ? "PASS" : "FAIL"} | \`${command}\` | ${result.exitCode} | ${summary.tests} | ${summary.pass} | ${summary.fail} |`;
  }).join("\n");
  const failureSection = results
    .flatMap(({ name, result }) => parseFailures(`${result.stdout}\n${result.stderr}`).map((failure) => `- ${name}: ${failure}`));
  const failureText = failureSection.length ? failureSection.join("\n") : "- None";
  const modeNote = mode.headless === "false"
    ? "- HEADLESS=false runs Playwright with visible Chrome windows. This is browser-driven automation, not a passive preview."
    : `- HEADLESS=${mode.headless ?? "not set"} runs Playwright Chrome in headless mode by default.`;

  return `# Test Report

Generated: ${endedAt.toISOString()}

## Run Summary

| Field | Value |
|---|---:|
| Status | ${status} |
| Exit code | ${exitCode} |
| Wall time ms | ${durationMs} |

## Phase Summary

| Phase | Status | Command | Exit code | Tests | Passed | Failed |
|---|---|---|---:|---:|---:|---:|
${phaseRows}

## Execution Mode

| Field | Value |
|---|---:|
| HEADLESS | ${mode.headless ?? "not set"} |
| TEST_CONCURRENCY | ${mode.testConcurrency ?? "default"} |
| PW_WORKERS | ${mode.playwrightWorkers} |
| Browser automation | Playwright Chrome channel |

${modeNote}

## Included QA Scope

- Sprint 0 through Sprint 9 native runnable UAT and API contract suites.
- Native smoke, sanity, validation, API BVT, and API regression checks in \`testing/tests/*.test.mjs\`.
- Chrome browser UI automation in \`testing/tests/e2e/*.spec.mjs\`.
- UI BVT coverage in \`testing/tests/e2e/ui-bvt.spec.mjs\`.
- UI regression coverage in \`testing/tests/e2e/ui-regression.spec.mjs\`.
- Dedicated chatbot UI and browser-request API coverage in \`testing/tests/e2e/chatbot-ui.spec.mjs\`.
- Cross-functional UAT data-variation coverage in \`testing/tests/cross-functional-uat.test.mjs\`.
- Cross-functional UI, accessibility, and language coverage in \`testing/tests/e2e/cross-functional-uat.spec.mjs\`.
- Tax edge-case coverage in \`testing/tests/tax-edge-coverage.test.mjs\`.
- UI gap coverage in \`testing/tests/e2e/ui-gap-coverage.spec.mjs\`.
- Local chatbot guardrails, knowledge-bank schema, Hugging Face retrieval contract, and fallback coverage in \`testing/tests/chatbot.test.mjs\`.
- Sprint 9 chatbot interaction logging, HRA assistant action, and supported CSV/JSON upload coverage in \`testing/tests/sprint9.test.mjs\` and \`testing/tests/e2e/sprint9-uat.spec.mjs\`.
- UI smoke, responsive layout, accessibility labels, missing-field validation, import validation, salary compute, regime comparison, explanation, report downloads, privacy, operations, and readiness flows.

## Failure Notes

${failureText}
`;
}

function phaseSummary(name, result) {
  const output = `${result.stdout}\n${result.stderr}`;
  if (name.startsWith("Native")) return parseNodeSummary(output);
  if (name.startsWith("Playwright")) return parsePlaywrightSummary(output, result.exitCode);
  return {
    suites: 0,
    tests: result.exitCode === 0 ? 1 : 0,
    pass: result.exitCode === 0 ? 1 : 0,
    fail: result.exitCode === 0 ? 0 : 1,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    duration_ms: 0
  };
}

function displayArg(arg) {
  return arg.startsWith(rootDir) ? path.relative(rootDir, arg) : arg;
}

function headlessPrefix() {
  return process.env.HEADLESS === undefined ? "" : `HEADLESS=${process.env.HEADLESS} `;
}
