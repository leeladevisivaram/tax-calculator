import { HttpError, MAX_JSON_BODY_BYTES } from "./ops-engine.mjs";

export async function readJsonObjectBody(req, options = {}) {
  const raw = await readLimitedBody(req, options.maxBytes ?? MAX_JSON_BODY_BYTES);
  if (!raw.trim()) return {};

  assertJsonContentType(req);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Malformed JSON request body.", {
      error_code: "REQ_MALFORMED_JSON",
      expected: "A valid JSON object."
    });
  }

  if (!isPlainObject(parsed)) {
    throw new HttpError(400, "JSON request body must be an object.", {
      error_code: "REQ_JSON_OBJECT_REQUIRED",
      expected: "A JSON object at the request root."
    });
  }

  return parsed;
}

async function readLimitedBody(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new HttpError(413, "Request body exceeds JSON size limit.", {
        error_code: "REQ_JSON_BODY_TOO_LARGE",
        max_bytes: maxBytes
      });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function assertJsonContentType(req) {
  const contentType = Array.isArray(req.headers["content-type"])
    ? req.headers["content-type"][0]
    : req.headers["content-type"];
  if (!contentType) return;
  if (/^application\/(?:[\w.-]+\+)?json\b/i.test(contentType)) return;
  throw new HttpError(415, "Unsupported media type for JSON endpoint.", {
    error_code: "REQ_UNSUPPORTED_MEDIA_TYPE",
    expected: "application/json"
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
