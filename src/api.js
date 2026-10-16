import { sleep } from "./util.js";

function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(values[key] ?? ""));
}

export async function apiGet(page, endpoint, config) {
  const target = new URL(endpoint, "https://chatgpt.com");
  if (target.origin !== "https://chatgpt.com") {
    throw new Error("API requests must stay on https://chatgpt.com");
  }
  let lastError;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const result = await page.evaluate(async (url) => {
        const runtimeHeaders = window.__chatArchiveHeaders || {};
        const response = await fetch(url, {
          method: "GET",
          redirect: "error",
          credentials: "include",
          headers: { accept: "application/json", ...runtimeHeaders }
        });
        return {
          status: response.status,
          text: await response.text(),
          url: response.url,
          retryAfter: response.headers.get("retry-after")
        };
      }, endpoint);
      if (result.status === 401 || result.status === 403) {
        const error = new Error(`Authentication/authorization failed (${result.status}) for ${endpoint}`);
        error.nonRetryable = true;
        throw error;
      }
      if (result.status === 429 || result.status >= 500) {
        const error = new Error(`Retryable HTTP ${result.status} for ${endpoint}`);
        error.status = result.status;
        const retrySeconds = Number(result.retryAfter);
        if (Number.isFinite(retrySeconds) && retrySeconds > 0) error.retryAfterMs = retrySeconds * 1000;
        throw error;
      }
      if (result.status < 200 || result.status >= 300) {
        const error = new Error(`HTTP ${result.status} for ${endpoint}`);
        error.nonRetryable = true;
        throw error;
      }
      return JSON.parse(result.text);
    } catch (error) {
      lastError = error;
      if (error.nonRetryable && /Authentication\/authorization/.test(error.message)) throw error;
      if (error.nonRetryable || attempt === config.maxRetries) break;
      const exponential = error.status === 429
        ? Math.min(config.rateLimitBaseMs * (2 ** attempt), config.rateLimitMaxMs)
        : config.retryBaseMs * (2 ** attempt);
      const wait = Math.max(error.retryAfterMs ?? 0, exponential) + Math.floor(Math.random() * 1000);
      console.warn(
        `  Request failed; retry ${attempt + 1}/${config.maxRetries} in ${Math.ceil(wait / 1000)} seconds: ${error.message}`
      );
      await sleep(wait);
    }
  }
  throw lastError;
}

function listItems(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["items", "conversations", "data", "gizmos", "projects"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

export async function enumeratePaged(page, templates, config, label) {
  let lastError;
  for (const template of templates) {
    const all = [];
    let offset = 0;
    let cursor = "";
    try {
      for (;;) {
        const endpoint = fill(template, { offset, limit: config.pageSize, cursor });
        const payload = await apiGet(page, endpoint, config);
        const items = listItems(payload);
        all.push(...items);
        process.stdout.write(`\r  ${label}: ${all.length} discovered`);
        const nextCursor = payload?.next_cursor ?? payload?.cursor ?? "";
        const total = Number(payload?.total ?? payload?.count ?? 0);
        const hasMore = payload?.has_more === true || Boolean(nextCursor) ||
          (total > 0 && all.length < total);
        if (!items.length || (!hasMore && items.length < config.pageSize)) break;
        if (nextCursor && nextCursor !== cursor) cursor = nextCursor;
        else offset += items.length;
        await sleep(config.requestDelayMs);
      }
      console.log("");
      return all;
    } catch (error) {
      console.log("");
      lastError = error;
      if (error.nonRetryable && /Authentication\/authorization/.test(error.message)) throw error;
      console.warn(`  ${label} endpoint did not work: ${template} (${error.message})`);
    }
  }
  throw lastError ?? new Error(`No endpoint template configured for ${label}`);
}

export function conversationId(item) {
  return item?.id ?? item?.conversation_id ?? item?.conversationId ?? null;
}

export function normalizeProjects(payloads) {
  const map = new Map();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (!Array.isArray(value)) {
      const id = value.id ?? value.gizmo_id ?? value.project_id;
      const name = value.name ?? value.title ?? value.display_name;
      const looksProject = value.type === "project" || value.gizmo_type === "snorlax" ||
        "project_id" in value || "workspace_id" in value;
      if (id && name && looksProject) map.set(String(id), String(name));
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") visit(child);
    }
  };
  visit(payloads);
  return map;
}

export function extractProjectConversations(payloads, projects) {
  const found = new Map();
  const visit = (value, inheritedProjectId = "") => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, inheritedProjectId);
      return;
    }
    const ownProjectId = value.project_id ?? value.gizmo_id ??
      ((value.type === "project" || value.gizmo_type === "snorlax") ? value.id : "");
    const projectId = String(ownProjectId || inheritedProjectId || "");
    const id = value.conversation_id ?? value.conversationId ??
      ((value.title && (value.create_time || value.update_time || value.current_node)) ? value.id : "");
    if (id && (value.title || value.conversation_id || value.conversationId)) {
      found.set(String(id), { ...value, id: String(id), project_id: projectId });
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") visit(child, projectId);
    }
  };
  visit(payloads);
  return [...found.values()].filter(item => item.project_id && (projects.has(item.project_id) || item.title));
}

export function extractConversationsDeep(payloads) {
  const found = new Map();
  const visit = (value, context = {}) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, context);
      return;
    }
    const archived = value.is_archived ?? value.archived ?? context.archived;
    const projectId = value.project_id ?? value.gizmo_id ?? context.project_id ?? "";
    const explicitId = value.conversation_id ?? value.conversationId;
    const looksLikeConversation = Boolean(
      explicitId ||
      (value.id && value.title && (
        value.create_time || value.update_time || value.current_node ||
        value.is_archived !== undefined || value.mapping
      ))
    );
    if (looksLikeConversation) {
      const id = String(explicitId ?? value.id);
      found.set(id, {
        ...found.get(id),
        ...value,
        id,
        is_archived: Boolean(archived),
        project_id: String(projectId || "")
      });
    }
    const nextContext = { archived, project_id: projectId };
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") visit(child, nextContext);
    }
  };
  visit(payloads);
  return [...found.values()];
}

export function detectProjectId(summary, raw) {
  const candidates = [
    summary?.project_id, summary?.gizmo_id, summary?.workspace_id,
    raw?.project_id, raw?.gizmo_id, raw?.conversation?.project_id,
    raw?.conversation?.gizmo_id
  ];
  return candidates.find(Boolean)?.toString() ?? "";
}
