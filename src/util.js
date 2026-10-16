import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export const root = path.resolve(import.meta.dirname, "..");
export const dataDir = path.join(root, "data");
export const rawDir = path.join(dataDir, "raw");
export const mdDir = path.join(dataDir, "markdown");
export const profileDir = path.join(root, "playwright-profile");
export const checkpointPath = path.join(dataDir, "checkpoint.json");

export function ensureDirs() {
  for (const dir of [dataDir, rawDir, mdDir, profileDir]) fs.mkdirSync(dir, { recursive: true });
}

export function loadJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

export function atomicJson(file, value) {
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(temp, file);
      return;
    } catch (error) {
      if (!["EACCES", "EPERM", "EBUSY"].includes(error.code) || attempt >= 7) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (attempt + 1));
    }
  }
}

export function safeName(value, fallback = "Untitled") {
  const clean = String(value || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return clean || fallback;
}

export function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

export async function pause(message) {
  const rl = readline.createInterface({ input, output });
  await rl.question(`${message}\nPress ENTER to continue... `);
  rl.close();
}

export function timestamp(value) {
  if (!value) return "";
  const date = new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.valueOf()) ? String(value) : date.toISOString();
}

export function textFromContent(content) {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(textFromContent).filter(Boolean).join("\n");
  if (Array.isArray(content.parts)) return content.parts.map(textFromContent).filter(Boolean).join("\n");
  if (typeof content.text === "string") return content.text;
  if (content.content) return textFromContent(content.content);
  return "";
}
