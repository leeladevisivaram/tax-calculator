import { handleRequest } from "../_server.js";

export default function handler(req, res) {
  const pathname = requestPathname(req.url);
  if (!pathname.startsWith("/api/v1/") || pathname.includes("[...path]")) {
    const pathParts = Array.isArray(req.query?.path)
      ? req.query.path
      : [req.query?.path].filter(Boolean);

    if (pathParts.length > 0) {
      handleRequest(req, res, { pathname: `/api/v1/${pathParts.map(encodeURIComponent).join("/")}` });
      return;
    }
  }

  handleRequest(req, res);
}

function requestPathname(url) {
  try {
    return new URL(url ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}
