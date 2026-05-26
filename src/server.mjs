import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compareRegimes, computeTax } from "./tax-engine.mjs";
import { listSupportedPeriods } from "./rulepack-loader.mjs";
import { validateTaxRequest } from "./validation-engine.mjs";
import { explainTaxRequest, getSourceById } from "./report-engine.mjs";
import { getImportTemplates, previewImport } from "./import-engine.mjs";
import { extractPdfImport } from "./pdf-import-engine.mjs";
import { reviewScenario } from "./ai-review-engine.mjs";
import { classifyCodePart, getApplicationClassification } from "./app-classification.mjs";
import { getApiContracts } from "./api-contracts.mjs";
import { buildChatbotResponseAsync } from "./chatbot-engine.mjs";
import { appendChatbotInteraction } from "./chatbot-interactions.mjs";
import { readJsonObjectBody } from "./request-contracts.mjs";
import {
  classifyBetaFeedback,
  getBetaPlan,
  getLaunchReadiness,
  getLegalAndSupportReadiness,
  runFinalRegression
} from "./launch-engine.mjs";
import {
  HttpError,
  appendAuditEvent,
  buildDeletionWorkflow,
  buildPrivacyExport,
  enforceRateLimit,
  getMetrics,
  getPrivacyPolicy,
  getRunbook,
  recordMetric,
  securityHeaders
} from "./ops-engine.mjs";

const defaultPort = Number.parseInt(process.env.PORT ?? "3000", 10);
const defaultHost = process.env.HOST ?? "127.0.0.1";

const STATIC_ASSETS = new Map([
  ["/", { fileName: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/index.html", { fileName: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/styles.css", { fileName: "styles.css", contentType: "text/css; charset=utf-8" }],
  ["/app.js", { fileName: "app.js", contentType: "text/javascript; charset=utf-8" }],
  ["/ui-validation.js", { fileName: "ui-validation.js", contentType: "text/javascript; charset=utf-8" }],
  ["/storage-state.js", { fileName: "storage-state.js", contentType: "text/javascript; charset=utf-8" }]
]);

const JSON_ROUTES = [
  route("GET", "/health", () => ({ status: "ok" })),
  route("GET", "/api/v1/rules/periods", async () => ({ status: "ok", periods: await listSupportedPeriods() })),
  route("GET", "/api/v1/imports/templates", () => getImportTemplates()),
  route("GET", "/api/v1/privacy/policy", () => getPrivacyPolicy()),
  route("GET", "/api/v1/ops/metrics", () => getMetrics()),
  route("GET", "/api/v1/ops/runbook", () => getRunbook()),
  route("GET", "/api/v1/app/classification", ({ url }) => {
    const classification = getApplicationClassification();
    const part = url.searchParams.get("part");
    return {
      ...classification,
      matched_part: part ? classifyCodePart(part) : null
    };
  }),
  route("GET", "/api/v1/app/contracts", ({ url }) => getApiContracts({
    endpoint: url.searchParams.get("endpoint") ?? undefined
  })),
  route("GET", "/api/v1/launch/beta-plan", () => getBetaPlan()),
  route("GET", "/api/v1/launch/regression", async () => runFinalRegression()),
  route("GET", "/api/v1/launch/readiness", async () => getLaunchReadiness()),
  route("GET", "/api/v1/launch/legal-support", () => getLegalAndSupportReadiness()),
  route("GET", "/api/v1/sources/", async ({ url }) => {
    const sourceId = decodeURIComponent(url.pathname.replace("/api/v1/sources/", ""));
    const source = await getSourceById(sourceId);
    if (!source) {
      return {
        statusCode: 404,
        body: { status: "error", error: "Source not found" }
      };
    }
    return { status: "ok", source };
  }, { prefix: true }),
  route("POST", "/api/v1/tax/compute", ({ body }) => computeTax(body), { readBody: true }),
  route("POST", "/api/v1/tax/validate", ({ body }) => validateTaxRequest(body), { readBody: true }),
  route("POST", "/api/v1/tax/compare-regimes", ({ body }) => compareRegimes(body), { readBody: true }),
  route("POST", "/api/v1/reports/explain", ({ body }) => explainTaxRequest(body), { readBody: true }),
  route("POST", "/api/v1/imports/preview", ({ body }) => previewImport(body), { readBody: true }),
  route("POST", "/api/v1/imports/pdf-extract", ({ body }) => extractPdfImport(body), { readBody: true }),
  route("POST", "/api/v1/ai/review-scenario", ({ body }) => reviewScenario(body), { readBody: true }),
  route("POST", "/api/v1/privacy/export", ({ body }) => buildPrivacyExport(body), { readBody: true }),
  route("POST", "/api/v1/privacy/delete", () => buildDeletionWorkflow(), { readBody: true }),
  route("POST", "/api/v1/launch/triage", ({ body }) => classifyBetaFeedback(body), { readBody: true }),
  route("POST", "/api/v1/launch/readiness", ({ body }) => getLaunchReadiness(body), { readBody: true }),
  route("POST", "/api/v1/chatbot/message", async ({ body }) => {
    const chatbotResponse = await buildChatbotResponseAsync(body);
    const interactionLog = await appendChatbotInteraction({ request: body, response: chatbotResponse });
    return {
      ...chatbotResponse,
      interaction_log: {
        status: interactionLog.status,
        schema_version: interactionLog.record.schema_version
      }
    };
  }, { readBody: true })
];

export function buildServer() {
  return createServer(async (req, res) => {
    const startedAt = Date.now();
    const context = { requestBody: undefined };
    let url;

    try {
      url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      enforceRateLimit(req, url);

      if (req.method === "GET" && isStaticAssetPath(url.pathname)) {
        return sendStatic(res, url.pathname);
      }

      if (req.method === "GET" && url.pathname.startsWith("/react/")) {
        return sendReactAsset(res, url.pathname);
      }

      const matchedRoute = findJsonRoute(req.method, url.pathname);
      if (matchedRoute) {
        const body = matchedRoute.readBody ? await readJsonObjectBody(req) : undefined;
        context.requestBody = body;
        const result = await matchedRoute.handler({ req, url, body });
        const statusCode = result?.statusCode ?? 200;
        const responseBody = result?.body ?? result;
        return finishJson(req, res, url, statusCode, responseBody, context, startedAt);
      }

      const allowedMethods = allowedMethodsForPath(url.pathname);
      if (allowedMethods) {
        return finishJson(req, res, url, 405, {
          status: "error",
          error: "Method not allowed",
          allowed_methods: allowedMethods
        }, context, startedAt);
      }

      return finishJson(req, res, url, 404, {
        status: "error",
        error: "Not found"
      }, context, startedAt);
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 400;
      const details = error?.details ?? undefined;
      if (!url) {
        return sendJson(res, statusCode, {
          status: "error",
          error: error?.message ?? "Request failed",
          error_code: details?.error_code ?? undefined,
          details
        });
      }

      return finishJson(req, res, url, statusCode, {
        status: "error",
        error: error?.message ?? "Request failed",
        error_code: details?.error_code ?? undefined,
        details
      }, context, startedAt);
    }
  });
}

function route(method, path, handler, options = {}) {
  return {
    method,
    path,
    handler,
    prefix: options.prefix === true,
    readBody: options.readBody === true
  };
}

function findJsonRoute(method, pathname) {
  return JSON_ROUTES.find((candidate) => {
    if (candidate.method !== method) return false;
    return candidate.prefix ? pathname.startsWith(candidate.path) : pathname === candidate.path;
  });
}

function routesForPath(pathname) {
  return JSON_ROUTES.filter((candidate) => {
    return candidate.prefix ? pathname.startsWith(candidate.path) : pathname === candidate.path;
  });
}

async function finishJson(req, res, url, statusCode, body, context, startedAt) {
  const route = routeName(url.pathname);
  const duration_ms = Date.now() - startedAt;
  const responseBody = body && typeof body === "object" && !Array.isArray(body) ? { ...body } : body;

  if (url.pathname === "/health" || url.pathname.startsWith("/api/")) {
    const auditId = await appendAuditEvent({
      route,
      method: req.method,
      status_code: statusCode,
      request_body: context.requestBody,
      response_body: responseBody,
      duration_ms
    });
    if (responseBody && typeof responseBody === "object" && !Array.isArray(responseBody)) {
      responseBody.audit_id = auditId;
    }
    recordMetric({
      route,
      method: req.method,
      status_code: statusCode,
      duration_ms,
      response_body: responseBody
    });
  }

  return sendJson(res, statusCode, responseBody);
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, securityHeaders("application/json; charset=utf-8"));
  res.end(`${JSON.stringify(body)}\n`);
}

function isStaticAssetPath(pathname) {
  return STATIC_ASSETS.has(pathname);
}

async function sendStatic(res, pathname) {
  const asset = STATIC_ASSETS.get(pathname);
  const fileUrl = new URL(`../public/${asset.fileName}`, import.meta.url);
  const body = await readFile(fileUrl);
  res.writeHead(200, securityHeaders(asset.contentType));
  res.end(body);
}

async function sendReactAsset(res, pathname) {
  const safePath = decodeURIComponent(pathname);
  if (safePath.includes("..") || !safePath.startsWith("/react/")) {
    return sendJson(res, 404, { status: "error", error: "Not found" });
  }

  const fileUrl = new URL(`../public${safePath}`, import.meta.url);
  const body = await readFile(fileUrl);
  res.writeHead(200, securityHeaders(contentTypeForFile(safePath)));
  res.end(body);
}

function contentTypeForFile(fileName) {
  if (fileName.endsWith(".css")) return "text/css; charset=utf-8";
  if (fileName.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (fileName.endsWith(".map")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function routeName(pathname) {
  if (pathname.startsWith("/api/v1/sources/")) return "/api/v1/sources/:sourceId";
  return pathname;
}

function allowedMethodsForPath(pathname) {
  const methods = [...new Set(routesForPath(pathname).map((candidate) => candidate.method))];
  return methods.length ? methods : null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildServer().listen(defaultPort, defaultHost, () => {
    console.log(`Tax calculator API listening on http://${defaultHost}:${defaultPort}`);
  });
}
