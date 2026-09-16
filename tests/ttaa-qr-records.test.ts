import assert from "node:assert/strict";
import { test } from "node:test";
import { createTtaaQrRecord, getTtaaQrRecord, listTtaaQrRecords, loadTtaaQrPdf, setTtaaQrPdf } from "../lib/ttaa-qr-records.ts";

test("TTAA records persist across reads and private PDFs can be added, replaced and removed", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  const objects = new Map<string, Uint8Array>();
  const removedPaths: string[] = [];
  let bucketExists = false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assert.equal(url.hostname, "supabase.test");
    const path = decodeURIComponent(url.pathname);
    const method = request.method;
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (path === "/storage/v1/bucket" && method === "GET") return json(bucketExists ? [{ id: "ttaa-qr-private", name: "ttaa-qr-private" }] : []);
    if (path === "/storage/v1/bucket" && method === "POST") { bucketExists = true; return json({ name: "ttaa-qr-private" }); }
    const list = /^\/storage\/v1\/object\/list\/ttaa-qr-private$/.test(path);
    if (list) {
      const body = await request.json() as { prefix: string; limit: number; offset: number };
      return json([...objects.keys()].filter((key) => key.startsWith(`${body.prefix}/`)).map((key) => ({ name: key.slice(body.prefix.length + 1) })).slice(body.offset, body.offset + body.limit));
    }
    if (path === "/storage/v1/object/ttaa-qr-private" && method === "DELETE") {
      const body = await request.json() as { prefixes: string[] };
      for (const key of body.prefixes) { removedPaths.push(key); objects.delete(key); }
      return json([]);
    }
    const objectPath = path.replace(/^\/storage\/v1\/object\/(?:authenticated\/)?ttaa-qr-private\//, "");
    if (objectPath === path) throw new Error(`Unexpected storage request: ${method} ${path}`);
    if (method === "GET") {
      const bytes = objects.get(objectPath);
      return bytes ? new Response(bytes.slice()) : json({ message: "Object not found", statusCode: "404" }, 404);
    }
    if (method === "POST" || method === "PUT") {
      const body = request.headers.get("content-type")?.includes("multipart/form-data")
        ? await (async () => { const form = await request.formData(); const file = [...form.values()].find((value) => value instanceof Blob); assert.ok(file instanceof Blob, JSON.stringify([...form.keys()])); return file.arrayBuffer(); })()
        : await request.arrayBuffer();
      if (objectPath.endsWith(".json")) assert.equal(new TextDecoder().decode(body.slice(0, 1)), "{");
      objects.set(objectPath, new Uint8Array(body));
      return json({ Key: objectPath });
    }
    throw new Error(`Unexpected storage request: ${method} ${path}`);
  });

  const details = { documentNumber: "TTAA-2026-01", customer: "Örnek Firma", documentType: "Tercüme belgesi", documentDate: "2026-09-16", driveLink: "" };
  const created = await createTtaaQrRecord(details);
  assert.equal((await getTtaaQrRecord(details.documentNumber))?.id, created.id);
  assert.equal((await listTtaaQrRecords("örnek"))[0].details.documentNumber, details.documentNumber);
  await assert.rejects(createTtaaQrRecord(details), /zaten kayıtlı/);
  const first = new File(["%PDF-1.4\nfirst"], "first.pdf", { type: "application/pdf" });
  const added = await setTtaaQrPdf(details.documentNumber, first);
  assert.ok(added.record.pdfPath);
  assert.equal(new TextDecoder().decode((await loadTtaaQrPdf(details.documentNumber))!.bytes), "%PDF-1.4\nfirst");
  const second = new File(["%PDF-1.4\nsecond"], "second.pdf", { type: "application/pdf" });
  const replaced = await setTtaaQrPdf(details.documentNumber, second);
  assert.notEqual(replaced.record.pdfPath, added.record.pdfPath);
  assert.equal(replaced.warning, null);
  assert.equal(objects.has(added.record.pdfPath!), false, JSON.stringify({ old: added.record.pdfPath, removedPaths, keys: [...objects.keys()] }));
  const removed = await setTtaaQrPdf(details.documentNumber);
  assert.equal(removed.record.pdfPath, undefined);
  assert.equal(await loadTtaaQrPdf(details.documentNumber), null);
});
