import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { openDatabase } from "./database.js";
import { dataDir, root } from "./util.js";

const dbFile = path.join(dataDir, "archive.db");
if (!fs.existsSync(dbFile)) throw new Error("Archive not found. Run npm run export first.");
const db = openDatabase(dbFile);
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 43110);

function json(response, value, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function safeDataPath(relative) {
  const resolved = path.resolve(dataDir, relative);
  if (!resolved.startsWith(path.resolve(dataDir) + path.sep)) throw new Error("Invalid path");
  return resolved;
}

const server = http.createServer((request, response) => {
  try {
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    if (!["127.0.0.1", "localhost"].includes(new URL(`http://${request.headers.host}`).hostname)) {
      return json(response, { error: "Invalid host" }, 403);
    }
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === "/api/search") {
      const q = url.searchParams.get("q")?.trim() || "";
      const project = url.searchParams.get("project") || "";
      const archived = url.searchParams.get("archived") || "";
      if (!q) return json(response, []);
      const filters = ["search_fts MATCH @query"];
      if (project) filters.push("c.project = @project");
      if (archived === "yes") filters.push("c.archived = 1");
      if (archived === "no") filters.push("c.archived = 0");
      const rows = db.prepare(`
        SELECT c.id,c.title,c.project,c.archived,c.updated_at,c.markdown_path,
          snippet(search_fts,4,'<mark>','</mark>',' … ',24) AS snippet,
          bm25(search_fts) AS rank
        FROM search_fts JOIN conversations c ON c.id=search_fts.conversation_id
        WHERE ${filters.join(" AND ")}
        ORDER BY rank LIMIT 200
      `).all({ query: q, project, archived });
      return json(response, rows);
    }
    if (url.pathname === "/api/projects") {
      return json(response, db.prepare("SELECT DISTINCT project FROM conversations WHERE project <> '' ORDER BY project").all().map(x => x.project));
    }
    if (url.pathname.startsWith("/api/document/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/document/".length));
      const row = db.prepare("SELECT * FROM conversations WHERE id=?").get(id);
      if (!row) return json(response, { error: "Not found" }, 404);
      return json(response, { ...row, markdown: fs.readFileSync(safeDataPath(row.markdown_path), "utf8") });
    }
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const resolved = path.resolve(publicDir, file);
    if (!resolved.startsWith(path.resolve(publicDir) + path.sep) && resolved !== path.join(publicDir, "index.html")) throw new Error("Invalid path");
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return json(response, { error: "Not found" }, 404);
    }
    response.writeHead(200, { "content-type": `${types[path.extname(resolved)] || "application/octet-stream"}; charset=utf-8` });
    fs.createReadStream(resolved).pipe(response);
  } catch (error) {
    json(response, { error: error.message }, 500);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Search archive: http://127.0.0.1:${server.address().port}`);
  console.log("Press Ctrl+C to stop.");
});
