import { handleRequest } from "./_server.js";

export default function handler(req, res) {
  handleRequest(req, res, { pathname: "/health" });
}
