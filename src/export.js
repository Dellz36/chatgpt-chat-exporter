import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  apiGet, conversationId, detectProjectId, enumeratePaged, extractProjectConversations,
  extractConversationsDeep, normalizeProjects
} from "./api.js";
import { openDatabase, indexConversation } from "./database.js";
import { normalizeConversation, toMarkdown } from "./render.js";
import {
  atomicJson, checkpointPath, dataDir, ensureDirs, loadJson, mdDir, pause, profileDir,
  rawDir, root, safeName, sleep
} from "./util.js";

ensureDirs();
const logFile = path.join(dataDir, "export.log");
const logStream = fs.createWriteStream(logFile, { flags: "a" });
for (const level of ["log", "warn", "error"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    logStream.write(`[${new Date().toISOString()}] ${level.toUpperCase()} ${args.map(value =>
      value instanceof Error ? value.stack : (typeof value === "string" ? value : JSON.stringify(value))
    ).join(" ")}\n`);
  };
}
const config = {
  ...JSON.parse(fs.readFileSync(path.join(root, "config.example.json"), "utf8")),
  ...loadJson(path.join(root, "config.json"))
};
if (new URL(config.chatgptUrl).origin !== "https://chatgpt.com") {
  throw new Error("chatgptUrl must use https://chatgpt.com");
}
const checkpoint = loadJson(checkpointPath, { completed: {}, failures: {}, started_at: new Date().toISOString() });
const db = openDatabase(path.join(dataDir, "archive.db"));

console.log("Opening a dedicated Chromium profile. Login data stays in this folder.");
let context;
try {
context = await chromium.launchPersistentContext(profileDir, {
  executablePath: config.browserExecutablePath || undefined,
  headless: Boolean(config.headless),
  viewport: { width: 1440, height: 900 }
});
const capturedJson = [];
const capturedUrls = new Set();
const businessHeaders = {};
context.on("response", async response => {
  try {
    const url = response.url();
    const type = response.headers()["content-type"] ?? "";
    if (new URL(url).origin !== "https://chatgpt.com") return;
    const likelyData = type.includes("json") || url.includes("/backend-api/") ||
      url.includes("/api/") || url.toLowerCase().includes("conversation");
    if (!likelyData) return;
    const requestHeaders = await response.request().allHeaders();
    for (const [name, value] of Object.entries(requestHeaders)) {
      const lower = name.toLowerCase();
      if (
        lower === "authorization" ||
        lower === "chatgpt-account-id" ||
        lower === "openai-organization" ||
        lower === "oai-device-id" ||
        lower.includes("sentinel") ||
        lower.startsWith("x-openai-")
      ) {
        businessHeaders[name] = value;
      }
    }
    if (capturedUrls.has(url) || capturedJson.length >= 500) return;
    capturedUrls.add(url);
    const text = await response.text();
    if (!text.trim().startsWith("{") && !text.trim().startsWith("[")) return;
    const body = JSON.parse(text);
    capturedJson.push({ url, status: response.status(), body });
  } catch {
  }
});
const page = context.pages()[0] ?? await context.newPage();
await page.goto(config.chatgptUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
await pause("Sign in manually, select the workspace to export, and wait for its conversation sidebar. Use a separate project folder for each account or workspace.");
await page.evaluate(headers => { window.__chatArchiveHeaders = headers; }, businessHeaders);
console.log(`  Inspected ${capturedJson.length} JSON responses in memory`);

const discovered = new Map();
for (const item of extractConversationsDeep(capturedJson.map(entry => entry.body))) {
  const id = conversationId(item);
  if (id) discovered.set(String(id), { ...item, id: String(id) });
}
console.log(`  Live network capture: ${discovered.size} conversation references detected`);
const prefetchedRaw = new Map();
const preflightSummary = discovered.values().next().value;
if (preflightSummary) {
  const preflightId = conversationId(preflightSummary);
  const endpoint = config.endpointTemplates.conversation[0].replace("{id}", encodeURIComponent(preflightId));
  try {
    const raw = await apiGet(page, endpoint, config);
    prefetchedRaw.set(String(preflightId), raw);
    console.log(`  Download preflight passed: ${preflightSummary.title ?? preflightId}`);
  } catch (error) {
    console.error(`  Download preflight failed: ${error.message}`);
    throw new Error(`Download preflight failed; full export was not started: ${error.message}`);
  }
} else {
  console.error("  Discovery preflight failed: the live sidebar returned no conversation references.");
  throw new Error("Discovery preflight failed; full export was not started.");
}
const collect = async (kind, archived) => {
  try {
    const items = await enumeratePaged(page, config.endpointTemplates[kind], config, kind);
    for (const item of items) {
      const id = conversationId(item);
      if (id) discovered.set(String(id), { ...discovered.get(String(id)), ...item, id: String(id), is_archived: archived });
    }
  } catch (error) {
    if (error.nonRetryable && /Authentication\/authorization/.test(error.message)) throw error;
    console.warn(`WARNING: Could not enumerate ${kind}: ${error.message}`);
  }
};

const capturedProjectPayloads = capturedJson
  .filter(entry => entry.status >= 200 && entry.status < 300 && entry.url.includes("/backend-api/gizmos"))
  .map(entry => entry.body);
let projects = normalizeProjects(capturedProjectPayloads);
const savedCatalog = loadJson(path.join(dataDir, "discovered.json"), []);
const canResumeCatalog = Boolean(
  config.reuseDiscoveryOnResume &&
  Object.keys(checkpoint.completed).length &&
  Array.isArray(savedCatalog) &&
  savedCatalog.length
);
if (canResumeCatalog) {
  discovered.clear();
  for (const item of savedCatalog) {
    const id = conversationId(item);
    if (id) discovered.set(String(id), { ...item, id: String(id) });
  }
  console.log(`Reusing checkpointed discovery catalog: ${discovered.size} conversations`);
} else {
  console.log("Discovering chats...");
  await collect("active", false);
  await collect("archived", true);

  console.log(`  Projects: ${projects.size} named projects detected`);
  const projectChats = extractProjectConversations(capturedProjectPayloads, projects);
  for (const item of projectChats) {
    const id = conversationId(item);
    if (id) discovered.set(String(id), { ...discovered.get(String(id)), ...item, id: String(id) });
  }
  console.log(`  Project payloads: ${projectChats.length} conversation references detected`);
}

if (!discovered.size) {
  throw new Error("No conversations were discovered. See TROUBLESHOOTING.md and update config.json endpoint templates.");
}

const summaries = [...discovered.values()];
if (!canResumeCatalog) atomicJson(path.join(dataDir, "discovered.json"), summaries);
console.log(`Exporting ${summaries.length} unique conversations...`);

let done = Object.keys(checkpoint.completed).length;
for (const [index, summary] of summaries.entries()) {
  const id = summary.id;
  if (checkpoint.completed[id]) {
    console.log(`[${index + 1}/${summaries.length}] skip completed: ${summary.title ?? id}`);
    continue;
  }
  try {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid conversation identifier");
    const endpoint = config.endpointTemplates.conversation[0].replace("{id}", encodeURIComponent(id));
    const raw = prefetchedRaw.get(String(id)) ?? await apiGet(page, endpoint, config);
    prefetchedRaw.delete(String(id));
    const projectId = detectProjectId(summary, raw);
    const projectName = projects.get(projectId) ?? summary.project_title ?? summary.project_name ?? (projectId ? `Project ${projectId}` : "");
    const conversation = normalizeConversation(raw, summary, projectName);
    conversation.id ||= id;
    const prefix = safeName(projectName || (conversation.archived ? "Archived" : "Unassigned"));
    const folder = path.join(mdDir, prefix);
    fs.mkdirSync(folder, { recursive: true });
    const stem = `${safeName(conversation.title)}--${id}`;
    const rawPath = path.join(rawDir, `${id}.json`);
    const mdPath = path.join(folder, `${stem}.md`);
    fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2), "utf8");
    fs.writeFileSync(mdPath, toMarkdown(conversation), "utf8");
    indexConversation(db, conversation, path.relative(dataDir, rawPath), path.relative(dataDir, mdPath));
    checkpoint.completed[id] = {
      title: conversation.title, project: conversation.project, exported_at: new Date().toISOString()
    };
    delete checkpoint.failures[id];
    done++;
    console.log(`[${index + 1}/${summaries.length}] exported: ${conversation.title}`);
  } catch (error) {
    checkpoint.failures[id] = { title: summary.title ?? "", error: error.message, at: new Date().toISOString() };
    console.error(`[${index + 1}/${summaries.length}] FAILED ${summary.title ?? id}: ${error.message}`);
    if (error.nonRetryable && /Authentication\/authorization/.test(error.message)) throw error;
  } finally {
    checkpoint.updated_at = new Date().toISOString();
    atomicJson(checkpointPath, checkpoint);
    await sleep(config.requestDelayMs);
  }
}

console.log(`Finished. ${done} conversations are in the archive. Run: npm run serve`);
} finally {
  db.close();
  try {
    await context?.close();
  } finally {
    logStream.end();
  }
}
