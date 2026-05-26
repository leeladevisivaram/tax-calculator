import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const CHECK_ROOTS = [
  "api",
  "client",
  "src",
  "public",
  "scripts",
  "testing/tests",
  "playwright.config.mjs",
  "vite.config.mjs"
];

const CHECK_EXTENSIONS = new Set([".js", ".mjs"]);
const EXCLUDED_DIRS = new Set(["node_modules", "testing/output", "playwright-report", "test-results"]);

const files = (await Promise.all(CHECK_ROOTS.map(resolveCheckFiles)))
  .flat()
  .sort();

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: rootDir,
    encoding: "utf8"
  });

  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`Syntax check passed for ${files.length} JavaScript files.`);
}

async function resolveCheckFiles(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  if (CHECK_EXTENSIONS.has(path.extname(relativePath))) return [relativePath];
  return listJavaScriptFiles(absolutePath);
}

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(rootDir, absolutePath);

    if (entry.isDirectory()) {
      if (!isExcluded(relativePath)) {
        files.push(...await listJavaScriptFiles(absolutePath));
      }
      continue;
    }

    if (entry.isFile() && CHECK_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(relativePath);
    }
  }

  return files;
}

function isExcluded(relativePath) {
  return [...EXCLUDED_DIRS].some((excluded) => {
    return relativePath === excluded || relativePath.startsWith(`${excluded}${path.sep}`);
  });
}
