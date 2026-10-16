import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import vm from "node:vm";
import http from "node:http";
import { test } from "node:test";
import { apiGet, enumeratePaged } from "../src/api.js";
import { indexConversation, openDatabase } from "../src/database.js";
import { normalizeConversation } from "../src/render.js";

test("API rejects external destinations before browser execution", async () => {
  let evaluated = false;
  const page = { evaluate: async () => { evaluated = true; } };
  await assert.rejects(apiGet(page, "https://example.com/private", {}), /must stay/);
  await assert.rejects(apiGet(page, "//example.com/private", {}), /must stay/);
  assert.equal(evaluated, false);
});

test("authentication failures do not try alternate discovery endpoints", async () => {
  let calls = 0;
  const page = { evaluate: async () => { calls++; return { status: 401 }; } };
  await assert.rejects(enumeratePaged(page, ["/first", "/second"], { maxRetries: 2, pageSize: 30 }, "test"), /Authentication/);
  assert.equal(calls, 1);
});

test("reindex replaces messages and failed writes roll back", () => {
  const db = openDatabase(":memory:");
  try {
    const original = normalizeConversation({ id: "fictional-chat", title: "Example", messages: [{ role: "user", text: "firstword" }] });
    indexConversation(db, original, "raw/example.json", "markdown/example.md");
    const updated = normalizeConversation({ id: "fictional-chat", title: "Example", messages: [{ role: "user", text: "secondword" }] });
    indexConversation(db, updated, "raw/example.json", "markdown/example.md");
    assert.equal(db.prepare("SELECT count(*) AS count FROM search_fts WHERE search_fts MATCH 'firstword'").get().count, 0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM search_fts WHERE search_fts MATCH 'secondword'").get().count, 1);
    assert.throws(() => indexConversation(db, { ...updated, messages: [...updated.messages, ...updated.messages] }, "raw/example.json", "markdown/example.md"));
    assert.equal(db.prepare("SELECT count(*) AS count FROM messages").get().count, 1);
  } finally {
    db.close();
  }
});

test("search preview escapes conversation HTML", async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: "", textContent: "", innerHTML: "", addEventListener() {}, insertAdjacentHTML() {} });
    return elements.get(id);
  };
  element("q").value = "example";
  const context = vm.createContext({
    document: { getElementById: element }, URLSearchParams,
    fetch: async url => ({ ok: true, json: async () => url === "/api/projects" ? [] : [{ id: "fictional", title: "Example", snippet: '<img src=x onerror=alert(1)><mark>example</mark>' }] })
  });
  vm.runInContext(fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8"), context);
  await vm.runInContext("search()", context);
  assert.doesNotMatch(element("results").innerHTML, /<img/);
  assert.match(element("results").innerHTML, /&lt;img/);
  assert.match(element("results").innerHTML, /<mark>example<\/mark>/);
});

test("local reader serves fictional archives and survives missing files", async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "exporter-reader-test-"));
  let child;
  try {
    fs.cpSync(new URL("../src/", import.meta.url), path.join(temporary, "src"), { recursive: true });
    fs.cpSync(new URL("../public/", import.meta.url), path.join(temporary, "public"), { recursive: true });
    fs.writeFileSync(path.join(temporary, "package.json"), '{"type":"module"}');
    fs.mkdirSync(path.join(temporary, "data", "markdown"), { recursive: true });
    fs.writeFileSync(path.join(temporary, "data", "markdown", "example.md"), "# Fictional example");
    const db = openDatabase(path.join(temporary, "data", "archive.db"));
    indexConversation(db, normalizeConversation({ id: "fictional", title: "Fictional example", messages: [{ role: "user", text: "example" }] }), "raw/example.json", "markdown/example.md");
    db.close();
    child = spawn(process.execPath, [path.join(temporary, "src", "server.js")], { env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
    const base = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Reader startup timed out")), 10000);
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Reader exited: ${code}`)); });
      child.stdout.on("data", chunk => {
        const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timeout); resolve(match[0]); }
      });
    });
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(`${base}/missing.js`)).status, 404);
    const search = await fetch(`${base}/api/search?q=example`);
    assert.equal((await search.json()).length, 1);
    assert.match(search.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    const document = await fetch(`${base}/api/document/fictional`).then(response => response.json());
    assert.equal(document.markdown, "# Fictional example");
    const rejectedStatus = await new Promise((resolve, reject) => {
      http.get(base, { headers: { Host: "example.com" } }, response => {
        response.resume();
        resolve(response.statusCode);
      }).on("error", reject);
    });
    assert.equal(rejectedStatus, 403);
  } finally {
    if (child && child.exitCode === null) {
      const stopped = once(child, "exit");
      child.kill();
      await stopped;
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
