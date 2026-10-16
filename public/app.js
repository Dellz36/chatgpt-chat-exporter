const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" })[c]);

async function loadProjects() {
  const projects = await fetch("/api/projects").then(r => r.json());
  for (const name of projects) $("project").insertAdjacentHTML("beforeend", `<option>${escapeHtml(name)}</option>`);
}

async function search() {
  const q = $("q").value.trim();
  if (!q) return;
  $("status").textContent = "Searching…";
  const params = new URLSearchParams({ q, project: $("project").value, archived: $("archived").value });
  try {
    const rows = await fetch(`/api/search?${params}`).then(async r => {
      const value = await r.json(); if (!r.ok) throw new Error(value.error); return value;
    });
    $("status").textContent = `${rows.length} matching messages (maximum 200 shown)`;
    $("results").innerHTML = rows.map(row => `
      <article data-id="${escapeHtml(row.id)}">
        <h2>${escapeHtml(row.title)}</h2>
        <p class="meta">${escapeHtml(row.project || "Unassigned")} · ${row.archived ? "Archived" : "Active"} · ${escapeHtml(row.updated_at || "")}</p>
        <p>${escapeHtml(row.snippet).replaceAll("&lt;mark&gt;", "<mark>").replaceAll("&lt;/mark&gt;", "</mark>")}</p>
      </article>`).join("");
  } catch (error) {
    $("status").textContent = `Search error: ${error.message}. Try simpler FTS5 syntax.`;
  }
}

$("go").addEventListener("click", search);
$("q").addEventListener("keydown", event => { if (event.key === "Enter") search(); });
$("results").addEventListener("click", async event => {
  const article = event.target.closest("article");
  if (!article) return;
  const doc = await fetch(`/api/document/${encodeURIComponent(article.dataset.id)}`).then(r => r.json());
  $("title").textContent = doc.title;
  $("document").textContent = doc.markdown;
  $("viewer").showModal();
});
$("close").addEventListener("click", () => $("viewer").close());
loadProjects();
