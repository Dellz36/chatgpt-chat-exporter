import { textFromContent, timestamp } from "./util.js";

function messagesFromMapping(raw) {
  const nodes = Object.values(raw?.mapping ?? {});
  return nodes
    .map(node => node?.message)
    .filter(Boolean)
    .sort((a, b) => (a.create_time ?? 0) - (b.create_time ?? 0));
}

function messagesFromArrays(raw) {
  for (const candidate of [raw?.messages, raw?.conversation?.messages, raw?.items]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

export function normalizeConversation(raw, summary = {}, projectName = "") {
  const source = Object.keys(raw?.mapping ?? {}).length ? messagesFromMapping(raw) : messagesFromArrays(raw);
  const messages = source.map((message, index) => ({
    index,
    id: message.id ?? "",
    role: message.author?.role ?? message.role ?? "unknown",
    author: message.author?.name ?? "",
    created_at: timestamp(message.create_time ?? message.created_at),
    content_type: message.content?.content_type ?? message.content_type ?? "",
    text: textFromContent(message.content ?? message.text),
    metadata: message.metadata ?? {}
  })).filter(message => message.text || message.content_type);
  return {
    id: raw?.conversation_id ?? raw?.id ?? summary?.id ?? "",
    title: raw?.title ?? summary?.title ?? "Untitled",
    created_at: timestamp(raw?.create_time ?? summary?.create_time),
    updated_at: timestamp(raw?.update_time ?? summary?.update_time),
    archived: Boolean(summary?.is_archived ?? raw?.is_archived),
    project: projectName,
    messages
  };
}

export function toMarkdown(conversation) {
  const yaml = [
    "---",
    `id: ${JSON.stringify(conversation.id)}`,
    `title: ${JSON.stringify(conversation.title)}`,
    `project: ${JSON.stringify(conversation.project || "")}`,
    `archived: ${conversation.archived}`,
    `created_at: ${JSON.stringify(conversation.created_at || "")}`,
    `updated_at: ${JSON.stringify(conversation.updated_at || "")}`,
    "---",
    "",
    `# ${conversation.title}`,
    ""
  ];
  for (const message of conversation.messages) {
    yaml.push(`## ${message.role}${message.author ? ` (${message.author})` : ""}`);
    if (message.created_at) yaml.push(`_${message.created_at}_`);
    yaml.push("", message.text || `_[${message.content_type || "non-text content"}]_`, "");
  }
  return yaml.join("\n");
}
