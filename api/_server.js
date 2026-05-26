import { buildServer } from "../src/server.mjs";

const server = buildServer();

export function handleRequest(req, res, options = {}) {
  if (options.pathname) {
    req.url = withOriginalQuery(options.pathname, req.url);
  }

  server.emit("request", req, res);
}

function withOriginalQuery(pathname, originalUrl = "") {
  const queryIndex = String(originalUrl).indexOf("?");
  return queryIndex === -1 ? pathname : `${pathname}${String(originalUrl).slice(queryIndex)}`;
}
