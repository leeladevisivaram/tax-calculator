import { handleRequest } from "../_server.js";

export default function handler(req, res) {
  const pathname = requestPathname(req.url);
  if (!pathname.startsWith("/api/v1/") || pathname.includes("[...path]")) {
    const pathParts = queryPathParts(req.query?.path);

    if (pathParts.length > 0) {
      handleRequest(req, res, { pathname: `/api/v1/${pathParts.map(encodeURIComponent).join("/")}` });
      return;
    }
  }

  handleRequest(req, res);
}

function queryPathParts(value) {
  const values = Array.isArray(value) ? value : [value].filter(Boolean);
  return values
    .flatMap((item) => String(item).split("/"))
    .filter(Boolean);
}

function requestPathname(url) {
  try {
    return new URL(url ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}
