import { handleV1Request } from "../_dispatch.js";

export default function handler(req, res) {
  handleV1Request(req, res, "/api/v1/reports/explain");
}
