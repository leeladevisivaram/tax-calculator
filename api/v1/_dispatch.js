import { handleRequest } from "../_server.js";

export function handleV1Request(req, res, pathname) {
  handleRequest(req, res, { pathname });
}

export function querySegment(req, name) {
  const value = req.query?.[name];
  const first = Array.isArray(value) ? value[0] : value ?? lastPathSegment(req.url);
  return encodeURIComponent(String(first ?? ""));
}

function lastPathSegment(url) {
  try {
    const pathname = new URL(url ?? "/", "http://localhost").pathname;
    return pathname.split("/").filter(Boolean).at(-1);
  } catch {
    return "";
  }
}
