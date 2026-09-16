import assert from "node:assert/strict";
import test from "node:test";
import { isSameOriginPanelRequest } from "../lib/qr-request-origin.ts";

const url = "http://internal-railway:3000/api/qr-documents/ay-tercume";
test("accepts direct and reverse-proxied same-origin browser requests", () => {
  assert.equal(isSameOriginPanelRequest(new Request(url, { headers: { origin: "http://internal-railway:3000" } })), true);
  assert.equal(isSameOriginPanelRequest(new Request(url, { headers: { origin: "https://ttaa-production.up.railway.app", "sec-fetch-site": "same-origin" } })), true);
});

test("rejects cross-site and missing-origin requests", () => {
  assert.equal(isSameOriginPanelRequest(new Request(url, { headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } })), false);
  assert.equal(isSameOriginPanelRequest(new Request(url)), false);
});
