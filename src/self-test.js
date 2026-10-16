import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, indexConversation } from "./database.js";
import { normalizeConversation, toMarkdown } from "./render.js";

const raw = {
  id: "test-1", title: "Test chat",
  mapping: {
    a: { message: { id: "m1", author: { role: "user" }, create_time: 1, content: { content_type: "text", parts: ["hello proxmox"] } } },
    b: { message: { id: "m2", author: { role: "assistant" }, create_time: 2, content: { content_type: "text", parts: ["hello back"] } } }
  }
};
const conversation = normalizeConversation(raw, { is_archived: true }, "Lab");
assert.equal(conversation.messages.length, 2);
assert.match(toMarkdown(conversation), /hello proxmox/);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "chat-archive-test-"));
const db = openDatabase(path.join(temp, "test.db"));
indexConversation(db, conversation, "raw.json", "chat.md");
const hit = db.prepare("SELECT conversation_id FROM search_fts WHERE search_fts MATCH ?").get("proxmox");
assert.equal(hit.conversation_id, "test-1");
db.close();
fs.rmSync(temp, { recursive: true, force: true });
console.log("Self-test passed.");
