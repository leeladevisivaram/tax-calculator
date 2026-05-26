import { handleV1Request, querySegment } from "../_dispatch.js";

export default function handler(req, res) {
  handleV1Request(req, res, `/api/v1/imports/${querySegment(req, "action")}`);
}
