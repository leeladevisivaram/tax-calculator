import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const targetUrl = process.env.VERCEL_TEST_URL ?? "https://tax-calculator-ochre-phi.vercel.app";
const playwrightCli = path.join(rootDir, "node_modules", "@playwright", "test", "cli.js");
const args = [playwrightCli, "test", "--config", "playwright.config.mjs", ...process.argv.slice(2)];

console.log(`# Production E2E target: ${targetUrl}`);

const child = spawn(process.execPath, args, {
  cwd: rootDir,
  env: {
    ...process.env,
    PLAYWRIGHT_BASE_URL: targetUrl
  },
  stdio: "inherit"
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
