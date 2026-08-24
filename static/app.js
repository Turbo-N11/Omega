// ---------------------------------------------------------------- state & helpers

const view = document.getElementById("view");
const crumb = document.getElementById("crumb");
const modalBackdrop = document.getElementById("modal-backdrop");
const modal = document.getElementById("modal");
const paletteBackdrop = document.getElementById("palette-backdrop");
const paletteInput = document.getElementById("palette-input");
const paletteResults = document.getElementById("palette-results");
const contextMenu = document.getElementById("context-menu");
const sortMenu = document.getElementById("sort-menu");
const shortcutsPanel = document.getElementById("shortcuts-panel");

let state = null;
let currentIdea = null;
let currentTab = "chat";
let currentSort = "default";
let currentFilter = "all";
let paletteSelectedIdx = 0;
let paletteItems = [];
let recentItems = JSON.parse(localStorage.getItem("omega_recent") || "[]");

marked.setOptions({ breaks: true, gfm: true });

const GREEK = ["α","β","γ","δ","ε","ζ","η","θ","ι","κ","λ","μ","ν","ξ","ο","π","ρ","σ","τ","υ","φ","χ","ψ","ω"];

function startAlpha(scopeEl) {
  const span = scopeEl.querySelector(".alpha-char");
  if (!span || scopeEl._timer) return;
  let i = 0;
  scopeEl._timer = setInterval(() => {
    if (!scopeEl.isConnected) { clearInterval(scopeEl._timer); delete scopeEl._timer; return; }
    i = (i + 1) % GREEK.length;
    span.textContent = GREEK[i];
  }, 140);
}

function stopAlpha(scopeEl) {
  if (scopeEl && scopeEl._timer) { clearInterval(scopeEl._timer); delete scopeEl._timer; }
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
}

function titleFromSlug(slug) {
  return slug.split("-").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
}

async function api(path, body = null, method = body ? "POST" : "GET") {
  const opts = { method };
  if (body !== null && method !== "GET") {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

function toast(text) {
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<span class="t-prefix">Ω</span>${esc(text)}`;
  document.getElementById("toasts").appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ---------------------------------------------------------------- recent items

function addRecent(slug) {
  recentItems = recentItems.filter(r => r.slug !== slug);
  recentItems.unshift({ slug, time: Date.now() });
  if (recentItems.length > 10) recentItems = recentItems.slice(0, 10);
  localStorage.setItem("omega_recent", JSON.stringify(recentItems));
  renderRecent();
}

function renderRecent() {
  const el = document.getElementById("recent-list");
  if (!el) return;
  if (!recentItems.length) {
    el.innerHTML = '<div class="sidebar-empty">no recent items</div>';
    return;
  }
  el.innerHTML = recentItems.map(r => `
    <button class="recent-item" data-slug="${esc(r.slug)}">
      <span class="recent-dot"></span>
      <span class="recent-name">${esc(titleFromSlug(r.slug))}</span>
    </button>`).join("");
  el.querySelectorAll(".recent-item").forEach(item =>
    item.onclick = () => { closeSidebar(); openIdea(item.dataset.slug, "notes"); });
}

// ---------------------------------------------------------------- modal

function openModal(html) {
  modal.innerHTML = html;
  modalBackdrop.classList.remove("hidden");
  const first = modal.querySelector("input, textarea");
  if (first) first.focus();
}

function closeModal() {
  modalBackdrop.classList.add("hidden");
  modal.innerHTML = "";
}

modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!paletteBackdrop.classList.contains("hidden")) closePalette();
    else if (!shortcutsPanel.classList.contains("hidden")) shortcutsPanel.classList.add("hidden");
    else closeModal();
  }
});

function modalForm({ title, sub, fields, submitLabel, onSubmit }) {
  openModal(`
    <h2>${title}</h2>
    <div class="modal-sub">${sub}</div>
    <form id="modal-form">
      ${fields.map(f => f.textarea
        ? `<label>${f.label}</label><textarea name="${f.name}" placeholder="${f.placeholder || ""}"></textarea>`
        : `<label>${f.label}</label><input type="text" name="${f.name}" placeholder="${f.placeholder || ""}">`
      ).join("")}
      <div class="modal-actions">
        <button type="button" class="btn" id="modal-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary" id="modal-submit">${submitLabel}</button>
      </div>
    </form>`);
  document.getElementById("modal-cancel").onclick = closeModal;
  document.getElementById("modal-form").onsubmit = async (e) => {
    e.preventDefault();
    const values = {};
    for (const f of fields) values[f.name] = e.target.elements[f.name].value.trim();
    const btn = document.getElementById("modal-submit");
    btn.disabled = true;
    btn.textContent = "Working…";
    try {
      await onSubmit(values);
      closeModal();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = submitLabel;
      toast("✗ " + err.message);
    }
  };
}

// ---------------------------------------------------------------- command palette

const PALETTE_COMMANDS = [
  { id: "new-idea", icon: "💡", text: "New Idea", hint: "Research a topic", action: modalNewIdea },
  { id: "find-papers", icon: "📄", text: "Find Papers", hint: "Search arXiv", action: modalResearch },
  { id: "re-idea", icon: "🔄", text: "Re-idea", hint: "Refine an idea", action: modalReIdea },
  { id: "field-scan", icon: "📊", text: "Field Scan", hint: "Trends in a field", action: modalTrend },
  { id: "hacker-news", icon: "📰", text: "Hacker News", hint: "Top discussions", action: modalHn },
  { id: "github-10", icon: "⭐", text: "GitHub Trending", hint: "Today's top 10", action: github10 },
  { id: "compare", icon: "⚖", text: "Compare Ideas", hint: "Side by side", action: modalCompare },
  { id: "export-all", icon: "📦", text: "Export All", hint: "Download all notes", action: exportAll },
  { id: "home", icon: "⌂", text: "Go Home", hint: "Back to dashboard", action: () => { closePalette(); renderHome(); } },
  { id: "shortcuts", icon: "⌨", text: "Keyboard Shortcuts", hint: "Show shortcuts", action: () => { closePalette(); toggleShortcuts(); } },
];

function openPalette() {
  paletteBackdrop.classList.remove("hidden");
  paletteInput.value = "";
  paletteSelectedIdx = 0;
  filterPalette("");
  paletteInput.focus();
}

function closePalette() {
  paletteBackdrop.classList.add("hidden");
  paletteInput.value = "";
}

function filterPalette(query) {
  const q = query.toLowerCase();
  const ideas = (state?.ideas || []).map(i => ({
    id: `idea-${i.slug}`,
    icon: "💡",
    text: titleFromSlug(i.slug),
    hint: i.qa ? `${i.qa} questions` : "new",
    action: () => { closePalette(); openIdea(i.slug, "notes"); },
  }));
  const research = (state?.research || []).map(r => ({
    id: `research-${r}`,
    icon: "📄",
    text: titleFromSlug(r),
    hint: "research",
    action: () => { closePalette(); openNoteViewer("research", r); },
  }));
  const reideas = (state?.re_ideas || []).map(r => ({
    id: `reidea-${r}`,
    icon: "🔄",
    text: titleFromSlug(r),
    hint: "re-idea",
    action: () => { closePalette(); openNoteViewer("re-ideas", r); },
  }));

  paletteItems = [...PALETTE_COMMANDS, ...ideas, ...research, ...reideas]
    .filter(item => !q || item.text.toLowerCase().includes(q) || (item.hint && item.hint.toLowerCase().includes(q)));

  paletteSelectedIdx = 0;
  renderPaletteResults();
}

function renderPaletteResults() {
  paletteResults.innerHTML = paletteItems.length
    ? paletteItems.map((item, i) => `
      <button class="palette-item ${i === paletteSelectedIdx ? "selected" : ""}" data-idx="${i}">
        <span class="palette-item-icon">${item.icon}</span>
        <span class="palette-item-text">${esc(item.text)}</span>
        <span class="palette-item-hint">${esc(item.hint || "")}</span>
      </button>`).join("")
    : '<div class="palette-item" style="color:var(--chrome-dim)">No results</div>';

  paletteResults.querySelectorAll(".palette-item[data-idx]").forEach(el =>
    el.onclick = () => {
      const idx = parseInt(el.dataset.idx);
      if (paletteItems[idx]) paletteItems[idx].action();
    });
}

paletteInput.addEventListener("input", () => filterPalette(paletteInput.value));
paletteInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    paletteSelectedIdx = Math.min(paletteSelectedIdx + 1, paletteItems.length - 1);
    renderPaletteResults();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    paletteSelectedIdx = Math.max(paletteSelectedIdx - 1, 0);
    renderPaletteResults();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (paletteItems[paletteSelectedIdx]) paletteItems[paletteSelectedIdx].action();
  }
});

paletteBackdrop.addEventListener("click", (e) => {
  if (e.target === paletteBackdrop) closePalette();
});

// ---------------------------------------------------------------- context menu

let contextTarget = null;

function showContextMenu(e, slug) {
  e.preventDefault();
  contextTarget = slug;
  const idea = state?.ideas?.find(i => i.slug === slug);
  const pinItem = contextMenu.querySelector('[data-action="pin"]');
  pinItem.textContent = idea?.pinned ? "☆ Unpin" : "★ Pin";
  contextMenu.style.left = e.clientX + "px";
  contextMenu.style.top = e.clientY + "px";
  contextMenu.classList.remove("hidden");
}

function hideContextMenu() {
  contextMenu.classList.add("hidden");
  contextTarget = null;
}

contextMenu.querySelectorAll(".ctx-item").forEach(item => {
  item.onclick = () => {
    const action = item.dataset.action;
    if (!contextTarget) return;
    if (action === "open") { closeSidebar(); openIdea(contextTarget, "notes"); }
    else if (action === "pin") togglePin(contextTarget);
    else if (action === "export") window.location = `/api/note/ideas/${contextTarget}/download`;
    else if (action === "delete") confirmDelete("ideas", contextTarget, titleFromSlug(contextTarget));
    hideContextMenu();
  };
});

document.addEventListener("click", hideContextMenu);

// ---------------------------------------------------------------- sort menu

document.getElementById("btn-sort-ideas")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();
  sortMenu.style.left = rect.left + "px";
  sortMenu.style.top = rect.bottom + 4 + "px";
  sortMenu.classList.toggle("hidden");
});

sortMenu.querySelectorAll(".sort-option").forEach(opt => {
  opt.onclick = () => {
    currentSort = opt.dataset.sort;
    sortMenu.querySelectorAll(".sort-option").forEach(o => o.classList.toggle("active", o === opt));
    sortMenu.classList.add("hidden");
    renderSidebar();
  };
});

document.addEventListener("click", () => sortMenu.classList.add("hidden"));

// ---------------------------------------------------------------- keyboard shortcuts

function toggleShortcuts() {
  shortcutsPanel.classList.toggle("hidden");
}

document.getElementById("close-shortcuts").onclick = () => shortcutsPanel.classList.add("hidden");

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

  if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    toggleShortcuts();
  } else if (e.key === "k" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    openPalette();
  } else if (e.key === "n" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    modalNewIdea();
  } else if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    document.getElementById("search-input")?.focus();
  } else if (e.key >= "1" && e.key <= "9" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const idx = parseInt(e.key) - 1;
    if (state?.ideas?.[idx]) openIdea(state.ideas[idx].slug, "notes");
  }
});

// ---------------------------------------------------------------- favorites / pinning

async function togglePin(slug) {
  try {
    await api("/api/pin", { slug });
    await refreshState();
    toast(state.ideas.find(i => i.slug === slug)?.pinned ? "Pinned" : "Unpinned");
  } catch (e) {
    toast("✗ " + e.message);
  }
}

// ---------------------------------------------------------------- rendering primitives

function setCrumb(parts) {
  crumb.innerHTML = `<span class="crumb-home" id="crumb-home">Ω</span>`;
  parts.forEach((p, i) => {
    crumb.innerHTML += '<span class="crumb-sep">/</span>';
    if (typeof p === "string") {
      crumb.innerHTML += `<span class="crumb-text">${esc(p)}</span>`;
    } else {
      crumb.innerHTML += `<span class="crumb-current">${esc(p)}</span>`;
    }
  });
  document.getElementById("crumb-home")?.addEventListener("click", () => renderHome());
}

function mdHtml(markdown, title = "") {
  return `
    <div class="msg-assistant">
      ${title ? `<div class="title">${esc(title)}</div>` : ""}
      <div class="markdown">${marked.parse(markdown)}</div>
    </div>`;
}

function statusHtml(text) {
  return `<div class="status-line" data-status><span class="alpha-char" aria-hidden="true">α</span><span>${esc(text)}</span></div>`;
}

function bindStatus(container) {
  const el = container.querySelector("[data-status]");
  if (el) startAlpha(el);
  return {
    remove: () => { if (el) { stopAlpha(el); el.remove(); } },
  };
}

// ---------------------------------------------------------------- sidebar

function sortIdeas(ideas) {
  const sorted = [...ideas];
  switch (currentSort) {
    case "name": sorted.sort((a, b) => a.slug.localeCompare(b.slug)); break;
    case "modified": sorted.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0)); break;
    case "qa": sorted.sort((a, b) => (b.qa || 0) - (a.qa || 0)); break;
    case "created": sorted.sort((a, b) => b.slug.localeCompare(a.slug)); break;
    default: sorted.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || a.slug.localeCompare(b.slug));
  }
  return sorted;
}

function filterIdeas(ideas) {
  switch (currentFilter) {
    case "pinned": return ideas.filter(i => i.pinned);
    case "tagged": return ideas.filter(i => i.tags?.length);
    default: return ideas;
  }
}

function renderSidebar() {
  if (!state) return;

  let ideas = state.ideas || [];
  ideas = filterIdeas(ideas);
  ideas = sortIdeas(ideas);

  const ideasList = document.getElementById("ideas-list");
  ideasList.innerHTML = ideas.length
    ? ideas.map(i => `
        <button class="toc-item ${currentIdea === i.slug ? "active" : ""}" data-slug="${i.slug}" oncontextmenu="showContextMenu(event, '${i.slug}')">
          ${i.pinned ? '<span class="pin-icon">★</span>' : ''}
          <span class="toc-name">${esc(i.slug)}</span><span class="toc-leader"></span>
          <span class="toc-count">${i.qa ? `${i.qa} q` : ""}</span>
        </button>
        ${i.tags?.length ? `<div class="tag-list">${i.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
        `).join("")
    : '<div class="sidebar-empty">none yet</div>';
  ideasList.querySelectorAll(".toc-item").forEach(el =>
    el.onclick = () => { closeSidebar(); openIdea(el.dataset.slug, "chat"); });

  const fill = (id, items) => {
    const el = document.getElementById(id);
    el.innerHTML = items.length
      ? items.map(s => `
          <button class="toc-item" data-name="${esc(s)}">
            <span class="toc-name">${esc(s)}</span>
          </button>`).join("")
      : '<div class="sidebar-empty">none</div>';
    el.querySelectorAll(".toc-item").forEach(item =>
      item.onclick = () => {
        closeSidebar();
        openNoteViewer(id === "research-list" ? "research" : "re-ideas", item.dataset.name);
      });
  };
  fill("research-list", state.research);
  fill("reideas-list", state.re_ideas);

  document.getElementById("model-tag").textContent = state.model;
  renderRecent();
}

function setMarginalia(text) {
  document.getElementById("marginalia").innerHTML =
    `<b>Ω</b> · ${esc(text || "research desk")}`;
}

function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
}

async function refreshState() {
  try {
    state = await api("/api/state");
    renderSidebar();
    if (!currentIdea && document.getElementById("stat-ideas-wrap")) renderHome(false);
  } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- filter chips

document.querySelectorAll("#filter-chips .chip").forEach(chip => {
  chip.onclick = () => {
    currentFilter = chip.dataset.filter;
    document.querySelectorAll("#filter-chips .chip").forEach(c => c.classList.toggle("active", c === chip));
    renderSidebar();
  };
});

// ---------------------------------------------------------------- home view

async function renderHome(fresh = true) {
  currentIdea = null;
  currentTab = "notes";
  setCrumb(["home"]);
  setMarginalia("research desk");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.id === "nav-home"));
  if (fresh) await refreshState();
  const s = state || { stats: {}, ideas: [], research: [], re_ideas: [] };
  const st = s.stats || {};
  const hasContent = s.ideas.length > 0;

  view.innerHTML = `
    <div class="sheet">
      <div class="sheet-head">
        <div class="eyebrow">private research desk</div>
        <h1 class="sheet-title">Omega<span style="color:var(--accent)">.</span></h1>
        <p class="sheet-sub">Name a topic. Omega scans the web and arXiv, writes the notes,
        and stays on call for your questions.</p>
      </div>
      <hr class="rule">
      
      <div class="stats-line" id="stat-ideas-wrap">
        <b>${st.ideas ?? 0}</b> ideas<span class="dot">·</span>
        <b>${st.qa ?? 0}</b> questions asked<span class="dot">·</span>
        <b>${st.research ?? 0}</b> paper saves<span class="dot">·</span>
        <b>${st.re_ideas ?? 0}</b> re-ideas
      </div>

      ${!hasContent ? `
      <div class="getting-started">
        <div class="gs-header">
          <h2>Getting Started</h2>
          <p>Here's how Omega works:</p>
        </div>
        <div class="gs-steps">
          <div class="gs-step">
            <div class="gs-step-num">1</div>
            <div class="gs-step-content">
              <h3>Research a Topic</h3>
              <p>Click <b>+ New Idea</b> or type <code>new &lt;topic&gt;</code> in the terminal. Omega searches the web and arXiv, then writes comprehensive notes.</p>
            </div>
          </div>
          <div class="gs-step">
            <div class="gs-step-num">2</div>
            <div class="gs-step-content">
              <h3>Read the Notes</h3>
              <p>Omega creates a structured document with sections on introduction, details, implementation, and resources.</p>
            </div>
          </div>
          <div class="gs-step">
            <div class="gs-step-num">3</div>
            <div class="gs-step-content">
              <h3>Ask Questions</h3>
              <p>Switch to the <b>Chat</b> tab to ask follow-up questions. Omega answers based on your notes and the live web.</p>
            </div>
          </div>
        </div>
      </div>

      <div class="quick-actions">
        <div class="contents-head">Quick Actions</div>
        <div class="qa-grid">
          <button class="qa-card" id="qa-new">
            <span class="qa-icon">💡</span>
            <span class="qa-text">New Idea</span>
            <span class="qa-desc">Research any topic</span>
          </button>
          <button class="qa-card" id="qa-papers">
            <span class="qa-icon">📄</span>
            <span class="qa-text">Find Papers</span>
            <span class="qa-desc">Search arXiv</span>
          </button>
          <button class="qa-card" id="qa-scan">
            <span class="qa-icon">📊</span>
            <span class="qa-text">Field Scan</span>
            <span class="qa-desc">Explore trends</span>
          </button>
          <button class="qa-card" id="qa-github">
            <span class="qa-icon">⭐</span>
            <span class="qa-text">GitHub 10</span>
            <span class="qa-desc">Trending repos</span>
          </button>
          <button class="qa-card" id="qa-hn">
            <span class="qa-icon">📰</span>
            <span class="qa-text">Hacker News</span>
            <span class="qa-desc">Top discussions</span>
          </button>
          <button class="qa-card" id="qa-terminal">
            <span class="qa-icon">⌬</span>
            <span class="qa-text">Terminal</span>
            <span class="qa-desc">Command line</span>
          </button>
        </div>
      </div>

      <div class="keyboard-hint">
        <span>Press <kbd>?</kbd> for keyboard shortcuts or <kbd>Ctrl+K</kbd> for command palette</span>
      </div>
      ` : `
      <div class="contents-head">Contents</div>
      <div class="paper-toc">
        ${s.ideas.length ? s.ideas.map(i => `
          <button class="toc-item" data-slug="${i.slug}">
            <span class="toc-name">${esc(i.slug)}</span><span class="toc-leader"></span>
            <span class="toc-count">${i.qa ? `${i.qa} q` : "unopened"}</span>
          </button>`).join("")
        : ""}
      </div>
      `}

      ${(s.research?.length || s.re_ideas?.length) ? `
      <div class="home-cols">
        <div>
          ${s.research?.length ? `<div class="contents-head">Research saves</div>
          <div class="small-list">${s.research.map(r => `
            <button class="small-link" data-kind="research" data-name="${esc(r)}">${esc(r)}</button>`).join("")}</div>` : ""}
        </div>
        <div>
          ${s.re_ideas?.length ? `<div class="contents-head">Re-ideas</div>
          <div class="small-list">${s.re_ideas.map(r => `
            <button class="small-link" data-kind="re-ideas" data-name="${esc(r)}">${esc(r)}</button>`).join("")}</div>` : ""}
        </div>
      </div>` : ""}
      
      ${hasContent ? `
      <div class="recent-section">
        <div class="contents-head">Recently Opened</div>
        <div class="recent-grid">
          ${recentItems.slice(0, 4).map(r => `
            <button class="recent-card" data-slug="${esc(r.slug)}">
              <span class="recent-card-icon">📄</span>
              <span class="recent-card-name">${esc(titleFromSlug(r.slug))}</span>
            </button>`).join("") || '<div class="sidebar-empty">No recent items</div>'}
        </div>
      </div>
      ` : ""}
    </div>`;

  // Wire up quick actions
  document.getElementById("qa-new")?.addEventListener("click", modalNewIdea);
  document.getElementById("qa-papers")?.addEventListener("click", modalResearch);
  document.getElementById("qa-scan")?.addEventListener("click", modalTrend);
  document.getElementById("qa-github")?.addEventListener("click", github10);
  document.getElementById("qa-hn")?.addEventListener("click", modalHn);
  document.getElementById("qa-terminal")?.addEventListener("click", toggleTerminal);

  view.querySelectorAll(".paper-toc .toc-item").forEach(c =>
    c.onclick = () => openIdea(c.dataset.slug, "notes"));
  view.querySelectorAll(".small-link").forEach(c =>
    c.onclick = () => openNoteViewer(c.dataset.kind, c.dataset.name));
  view.querySelectorAll(".recent-card").forEach(c =>
    c.onclick = () => openIdea(c.dataset.slug, "notes"));
  const emptyNew = document.getElementById("empty-new");
  if (emptyNew) emptyNew.onclick = modalNewIdea;
  document.getElementById("nav-home").classList.add("active");
}

// ---------------------------------------------------------------- idea view (notes + chat tabs)

async function openIdea(slug, tab = "notes") {
  currentIdea = slug;
  currentTab = tab;
  setCrumb(["home", slug]);
  setMarginalia(`ideas / ${slug}`);
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  renderSidebar();
  addRecent(slug);

  let data;
  try { data = await api(`/api/session/${slug}`); }
  catch (e) { toast("✗ " + e.message); return; }

  const idea = state?.ideas?.find(i => i.slug === slug);

  view.innerHTML = `
    <div class="sheet">
      <div class="sheet-head" style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap">
        <div>
          <div class="eyebrow">ideas / ${esc(slug)}</div>
          <h1 class="sheet-title">${esc(titleFromSlug(slug))}</h1>
          ${idea?.tags?.length ? `<div class="tag-editor" id="tag-editor">${idea.tags.map(t => `<span class="tag" data-tag="${esc(t)}">${esc(t)} <span class="tag-remove">×</span></span>`).join("")}<input class="tag-input" id="tag-input" placeholder="+ tag"></div>` : `<div class="tag-editor" id="tag-editor"><input class="tag-input" id="tag-input" placeholder="+ add tag"></div>`}
        </div>
        <div class="idea-actions">
          <button class="btn" id="ih-pin" title="Pin/unpin">${idea?.pinned ? "☆ Unpin" : "★ Pin"}</button>
          <button class="btn" id="ih-download">↓ .md</button>
          <button class="btn btn-danger" id="ih-delete">Delete</button>
        </div>
      </div>
      <hr class="rule">
      <div class="tabs" role="tablist">
        <button class="tab ${tab === "notes" ? "active" : ""}" data-tab="notes">Notes</button>
        <button class="tab ${tab === "chat" ? "active" : ""}" data-tab="chat">Chat ${data.messages.length ? `(${data.messages.filter(m => m.role === "user").length})` : ""}</button>
      </div>
      <div id="tab-content" class="chat-wrap"></div>
      <div class="chat-input-bar hidden" id="chat-bar">
        <div class="cmd-box">
          <span class="prompt-char">❯</span>
          <input id="chat-input" type="text" placeholder="Ask about ${esc(titleFromSlug(slug))} — answers draw on your notes and the live web…">
        </div>
      </div>
    </div>`;

  view.querySelectorAll(".tab").forEach(t =>
    t.onclick = () => openIdea(slug, t.dataset.tab));

  document.getElementById("ih-download").onclick = () =>
    window.location = `/api/note/ideas/${slug}/download`;
  document.getElementById("ih-delete").onclick = () => confirmDelete("ideas", slug, titleFromSlug(slug));
  document.getElementById("ih-pin").onclick = () => togglePin(slug);

  // Tag handling
  const tagInput = document.getElementById("tag-input");
  const tagEditor = document.getElementById("tag-editor");
  tagInput?.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && tagInput.value.trim()) {
      const tag = tagInput.value.trim().toLowerCase();
      await api("/api/tag", { slug, tag, action: "add" });
      tagInput.value = "";
      await refreshState();
      openIdea(slug, tab);
    }
  });
  tagEditor?.querySelectorAll(".tag").forEach(t => {
    t.querySelector(".tag-remove")?.addEventListener("click", async () => {
      await api("/api/tag", { slug, tag: t.dataset.tag, action: "remove" });
      await refreshState();
      openIdea(slug, tab);
    });
  });

  const content = document.getElementById("tab-content");
  const chatBar = document.getElementById("chat-bar");

  if (tab === "notes") {
    chatBar.classList.add("hidden");
    content.innerHTML = mdHtml(data.doc, "");
    const firstTitle = content.querySelector(".title");
    if (firstTitle) firstTitle.remove();
  } else {
    chatBar.classList.remove("hidden");
    content.innerHTML = "";
    if (!data.messages.length) {
      content.innerHTML = `<p class="empty-note">Nothing asked yet. Your notes are loaded as
        context — ask the first question below.</p>`;
    }
    for (const m of data.messages) {
      if (m.role === "user") content.appendChild(userBubble(m.markdown));
      else content.appendChild(assistantBubble(m.markdown, ""));
    }
    const input = document.getElementById("chat-input");
    input.focus();
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter" || !input.value.trim()) return;
      const q = input.value.trim();
      input.value = "";
      content.querySelector(".empty-note")?.remove();
      content.appendChild(userBubble(q));
      const status = document.createElement("div");
      status.innerHTML = statusHtml("searching the web & thinking");
      content.appendChild(status.firstChild);
      const st = bindStatus(content);
      content.parentElement.scrollTop = content.parentElement.scrollHeight;
      try {
        const resp = await api("/api/ask", { slug, question: q });
        st.remove();
        content.appendChild(assistantBubble(resp.answer, ""));
        state = resp.state;
        renderSidebar();
      } catch (err) {
        st.remove();
        content.appendChild(errorBox(err.message));
      }
      view.scrollTop = view.scrollHeight;
    });
  }
  view.scrollTop = 0;
}

function userBubble(text) {
  const div = document.createElement("div");
  div.className = "msg-user";
  div.innerHTML = `<span class="prefix">❯ </span>${esc(text)}`;
  return div;
}

function assistantBubble(markdown, title = "") {
  const div = document.createElement("div");
  div.innerHTML = mdHtml(markdown, title);
  const el = div.firstChild;
  const actions = document.createElement("div");
  actions.className = "msg-actions";
  const copy = document.createElement("button");
  copy.className = "btn";
  copy.textContent = "copy";
  copy.onclick = () => {
    navigator.clipboard.writeText(markdown);
    toast("copied to clipboard");
  };
  actions.appendChild(copy);
  el.appendChild(actions);
  return el;
}

function errorBox(text) {
  const div = document.createElement("div");
  div.className = "error-box";
  div.textContent = "✗ " + text;
  return div;
}

// ---------------------------------------------------------------- note viewer (research / re-ideas)

async function openNoteViewer(kind, name) {
  currentIdea = null;
  setCrumb(["home", kind, name]);
  setMarginalia(`${kind} / ${name}`);
  try {
    const data = await api(`/api/note/${kind}/${name}`);
    view.innerHTML = `
      <div class="sheet">
        <div class="sheet-head" style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap">
          <div>
            <div class="eyebrow">${esc(kind)}</div>
            <h1 class="sheet-title">${esc(titleFromSlug(name))}</h1>
          </div>
          <div class="idea-actions">
            <button class="btn" id="nv-download">↓ .md</button>
            <button class="btn btn-danger" id="nv-delete">Delete</button>
          </div>
        </div>
        <hr class="rule">
        <div class="chat-wrap">${mdHtml(data.markdown, "")}</div>
      </div>`;
    document.getElementById("nv-download").onclick = () =>
      window.location = `/api/note/${kind}/${name}/download`;
    document.getElementById("nv-delete").onclick = () => confirmDelete(kind, name, titleFromSlug(name));
  } catch (e) {
    toast("✗ " + e.message);
  }
}

function confirmDelete(kind, name, display) {
  openModal(`
    <h2>Delete "${esc(display)}"?</h2>
    <div class="modal-sub">This permanently removes the note${kind === "ideas" ? " and its chat session" : ""}.</div>
    <div class="modal-actions">
      <button class="btn" id="del-cancel">Cancel</button>
      <button class="btn btn-primary" id="del-yes">Delete</button>
    </div>`);
  document.getElementById("del-cancel").onclick = closeModal;
  document.getElementById("del-yes").onclick = async () => {
    try {
      const data = await api(`/api/note/${kind}/${name}`, null, "DELETE");
      state = data.state;
      closeModal();
      toast(`deleted '${display}'`);
      renderHome(false);
    } catch (e) { toast("✗ " + e.message); }
  };
}

// ---------------------------------------------------------------- modals for actions

function modalNewIdea() {
  modalForm({
    title: "New idea",
    sub: "Omega researches the topic on the web, then writes notes you can question later.",
    fields: [{ name: "idea", label: "Topic or concept", placeholder: "e.g. vector databases" }],
    submitLabel: "Research it",
    onSubmit: async (v) => {
      if (!v.idea) throw new Error("topic required");
      const data = await api("/api/new", { idea: v.idea });
      state = data.state;
      toast(`saved '/${data.slug}'`);
      await openIdea(data.slug, "notes");
    },
  });
}

function modalResearch() {
  modalForm({
    title: "Find papers",
    sub: "Finds ~10 relevant arXiv papers and saves them under Research.",
    fields: [{ name: "topic", label: "Topic", placeholder: "e.g. attention mechanisms" }],
    submitLabel: "Find papers",
    onSubmit: async (v) => {
      if (!v.topic) throw new Error("topic required");
      const data = await api("/api/research", { topic: v.topic });
      state = data.state;
      openResultsView(`papers: ${data.query}`, data.markdown);
      toast("papers saved to Research");
    },
  });
}

function modalReIdea() {
  modalForm({
    title: "Re-idea",
    sub: "Describe a raw idea. Omega restates it, you confirm, then it finds similar papers.",
    fields: [{ name: "description", label: "Your idea", textarea: true, placeholder: "Describe the idea in a sentence or two…" }],
    submitLabel: "Understand it",
    onSubmit: async (v) => {
      if (!v.description) throw new Error("description required");
      const data = await api("/api/re-idea", { description: v.description });
      openResultsView("re-idea: what Omega understood", data.understanding, (container) => {
        const row = document.createElement("div");
        row.className = "confirm-row";
        const yes = document.createElement("button");
        yes.className = "btn btn-primary";
        yes.textContent = "✓ correct — save & find papers";
        yes.onclick = async () => {
          yes.disabled = true;
          try {
            const d = await api("/api/re-idea/confirm", { description: v.description, understanding: data.understanding });
            state = d.state;
            container.appendChild(assistantBubble(d.papers, "similar papers"));
            toast("re-idea saved");
            refreshState();
          } catch (e) { toast("✗ " + e.message); yes.disabled = false; }
        };
        const no = document.createElement("button");
        no.className = "btn";
        no.textContent = "✗ wrong — try again";
        no.onclick = () => { row.remove(); modalReIdea(); };
        row.append(yes, no);
        container.appendChild(row);
        view.scrollTop = view.scrollHeight;
      });
    },
  });
}

function modalTrend() {
  modalForm({
    title: "Field scan",
    sub: "What's moving in a field — top GitHub repos, recent arXiv papers, and a short analysis.",
    fields: [{ name: "field", label: "Field", placeholder: "e.g. ai agents" }],
    submitLabel: "Scan",
    onSubmit: async (v) => {
      if (!v.field) throw new Error("field required");
      openResultsView(`field scan: ${v.field}`, statusHtml("scanning GitHub & arXiv"));
      bindStatus(document.getElementById("results-wrap"));
      const data = await api("/api/trend", { field: v.field });
      openResultsView(`field scan: ${v.field}`,
        mdHtml(data.repos, "repos & papers") + mdHtml(data.analysis, "field analysis"));
    },
  });
}

function modalHn() {
  modalForm({
    title: "Hacker News",
    sub: "Top discussions on a topic, ranked by relevance and points.",
    fields: [{ name: "topic", label: "Topic", placeholder: "e.g. rust" }],
    submitLabel: "Search HN",
    onSubmit: async (v) => {
      if (!v.topic) throw new Error("topic required");
      const data = await api("/api/hn", { topic: v.topic });
      openResultsView(`hn: ${v.topic}`, data.markdown);
    },
  });
}

function modalCompare() {
  modalForm({
    title: "Compare ideas",
    sub: "Compares two saved ideas — a table plus a verdict on which to build first.",
    fields: [
      { name: "a", label: "Idea A", placeholder: "first idea name" },
      { name: "b", label: "Idea B", placeholder: "second idea name" },
    ],
    submitLabel: "Compare",
    onSubmit: async (v) => {
      if (!v.a || !v.b) throw new Error("both ideas required");
      const data = await api("/api/compare", { a: v.a, b: v.b });
      openResultsView(`${slugify(v.a)} vs ${slugify(v.b)}`, data.markdown);
    },
  });
}

async function github10() {
  openResultsView("GitHub trending · today's top 10", statusHtml("fetching today's top trending repos"));
  bindStatus(document.getElementById("results-wrap"));
  try {
    const data = await api("/api/github10", {});
    openResultsView("GitHub trending · today's top 10", data.markdown);
  } catch (e) { openResultsView("GitHub trending", `error: ${e.message}`); }
}

async function exportAll() {
  try {
    const data = await api("/api/export-all");
    const blob = new Blob([data.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "omega-export.md";
    a.click();
    URL.revokeObjectURL(url);
    toast("exported all notes");
  } catch (e) {
    toast("✗ " + e.message);
  }
}

function openResultsView(title, htmlOrMd, after = null) {
  currentIdea = null;
  setCrumb(["home", title]);
  setMarginalia(title);
  view.innerHTML = `
    <div class="sheet">
      <div class="sheet-head">
        <div class="eyebrow">results</div>
        <h1 class="sheet-title" style="font-size:clamp(22px,3.5vw,30px)">${esc(title)}</h1>
      </div>
      <hr class="rule">
      <div class="chat-wrap" id="results-wrap"></div>
    </div>`;
  const wrap = document.getElementById("results-wrap");
  if (typeof htmlOrMd === "string") wrap.innerHTML = mdHtml(htmlOrMd, "");
  else wrap.appendChild(htmlOrMd);
  if (after) after(wrap);
  view.scrollTop = 0;
}

// ---------------------------------------------------------------- search

const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
let searchTimer = null;

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) { searchResults.classList.add("hidden"); return; }
  searchTimer = setTimeout(async () => {
    try {
      const data = await api(`/api/find?q=${encodeURIComponent(q)}`);
      searchResults.classList.remove("hidden");
      searchResults.innerHTML = data.matches.length
        ? data.matches.map(m => `
            <div class="sr-item" data-note="${esc(m.note)}">
              <span class="sr-note">/${esc(m.note)}</span> <span style="color:var(--text-faint)">L${m.line}</span>
              <span class="sr-line">${esc(m.text.slice(0, 90))}</span>
            </div>`).join("")
        : '<div class="sr-empty">no matches</div>';
      searchResults.querySelectorAll(".sr-item").forEach(el =>
        el.onclick = () => {
          const note = el.dataset.note;
          searchResults.classList.add("hidden");
          searchInput.value = "";
          closeSidebar();
          if (note.startsWith("research/")) openNoteViewer("research", note.split("/")[1]);
          else openIdea(note, "notes");
        });
    } catch (e) { /* ignore */ }
  }, 300);
});

// topbar search opens palette
const topbarSearch = document.getElementById("topbar-search-input");
topbarSearch?.addEventListener("focus", () => {
  topbarSearch.blur();
  openPalette();
});

// ---------------------------------------------------------------- dropdown menu

const actionsDropdown = document.getElementById("actions-dropdown");
const actionsMenu = document.getElementById("actions-menu");
const btnActions = document.getElementById("btn-actions");

btnActions?.addEventListener("click", (e) => {
  e.stopPropagation();
  actionsMenu.classList.toggle("hidden");
  actionsDropdown.classList.toggle("open");
});

document.addEventListener("click", () => {
  actionsMenu?.classList.add("hidden");
  actionsDropdown?.classList.remove("open");
});

actionsMenu?.addEventListener("click", (e) => e.stopPropagation());

// ---------------------------------------------------------------- wire up buttons

document.getElementById("nav-home").onclick = () => { closeSidebar(); renderHome(); };
document.getElementById("nav-recent").onclick = () => {
  closeSidebar();
  setCrumb(["home", "recent"]);
  setMarginalia("recent ideas");
  const content = recentItems.length
    ? recentItems.map(r => `
        <button class="toc-item" data-slug="${esc(r.slug)}">
          <span class="toc-name">${esc(titleFromSlug(r.slug))}</span>
        </button>`).join("")
    : '<div class="sidebar-empty">No recent items</div>';
  view.innerHTML = `
    <div class="sheet">
      <div class="sheet-head">
        <div class="eyebrow">navigation</div>
        <h1 class="sheet-title">Recent</h1>
      </div>
      <hr class="rule">
      <div class="paper-toc">${content}</div>
    </div>`;
  view.querySelectorAll(".toc-item").forEach(c =>
    c.onclick = () => openIdea(c.dataset.slug, "notes"));
};

document.getElementById("menu-btn").onclick = () => {
  const sb = document.getElementById("sidebar");
  sb.classList.contains("open") ? closeSidebar() : sb.classList.add("open");
};
document.getElementById("btn-new").onclick = modalNewIdea;
document.getElementById("btn-new2").onclick = modalNewIdea;
document.getElementById("btn-research").onclick = () => { actionsMenu.classList.add("hidden"); actionsDropdown.classList.remove("open"); modalResearch(); };
document.getElementById("btn-reidea").onclick = () => { actionsMenu.classList.add("hidden"); actionsDropdown.classList.remove("open"); modalReIdea(); };
document.getElementById("btn-trend").onclick = () => { actionsMenu.classList.add("hidden"); actionsDropdown.classList.remove("open"); modalTrend(); };
document.getElementById("btn-hn").onclick = () => { actionsMenu.classList.add("hidden"); actionsDropdown.classList.remove("open"); modalHn(); };
document.getElementById("btn-github").onclick = () => { actionsMenu.classList.add("hidden"); actionsDropdown.classList.remove("open"); github10(); };
document.getElementById("btn-compare").onclick = () => { actionsMenu.classList.add("hidden"); actionsDropdown.classList.remove("open"); modalCompare(); };
document.getElementById("btn-export-all").onclick = () => { actionsMenu.classList.add("hidden"); actionsDropdown.classList.remove("open"); exportAll(); };
document.getElementById("btn-settings").onclick = () => {
  modalForm({
    title: "Settings",
    sub: "Configure your Omega experience.",
    fields: [
      { name: "theme", label: "Theme (coming soon)", placeholder: "Midnight Galaxy" },
    ],
    submitLabel: "Save",
    onSubmit: async () => { toast("settings saved"); },
  });
};

// ---------------------------------------------------------------- terminal

const terminalWindow = document.getElementById("terminal-window");
const terminalBody = document.getElementById("terminal-body");
const terminalOutput = document.getElementById("terminal-output");
const terminalInput = document.getElementById("terminal-input");
const terminalTitlebar = document.getElementById("terminal-titlebar");
const terminalResize = document.getElementById("terminal-resize");

let terminalHistory = [];
let terminalHistoryIdx = -1;
let terminalMaximized = false;
let terminalDragState = null;

function toggleTerminal() {
  terminalWindow.classList.toggle("hidden");
  if (!terminalWindow.classList.contains("hidden")) {
    terminalInput.focus();
    if (terminalOutput.children.length === 0) {
      termPrint("Welcome to Ω Terminal", "term-info");
      termPrint("Type 'help' for available commands.\n", "term-muted");
    }
  }
}

function termPrint(text, className = "term-output") {
  const line = document.createElement("div");
  line.className = `term-line ${className}`;
  line.textContent = text;
  terminalOutput.appendChild(line);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function termPrintHtml(html) {
  const line = document.createElement("div");
  line.className = "term-line";
  line.innerHTML = html;
  terminalOutput.appendChild(line);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function termClear() {
  terminalOutput.innerHTML = "";
}

async function termExec(cmd) {
  const parts = cmd.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();
  const args = parts.slice(1).join(" ");

  termPrint(`Ω ~ $ ${cmd}`, "term-command");

  if (!command) return;

  switch (command) {
    case "help":
      termPrint("Available commands:", "term-info");
      termPrint("  new <topic>        Research a new topic", "term-output");
      termPrint("  open <slug>        Open an idea", "term-output");
      termPrint("  search <query>     Search notes", "term-output");
      termPrint("  list               List all ideas", "term-output");
      termPrint("  papers <topic>     Find arXiv papers", "term-output");
      termPrint("  scan <field>       Field scan (GitHub + arXiv)", "term-output");
      termPrint("  hn <topic>         Hacker News search", "term-output");
      termPrint("  github             GitHub trending", "term-output");
      termPrint("  compare <a> <b>    Compare two ideas", "term-output");
      termPrint("  export             Export all notes", "term-output");
      termPrint("  pin <slug>         Toggle pin on idea", "term-output");
      termPrint("  clear              Clear terminal", "term-output");
      termPrint("  help               Show this help", "term-output");
      termPrint("  close              Close terminal", "term-output");
      break;

    case "clear":
      termClear();
      break;

    case "close":
      toggleTerminal();
      break;

    case "new":
      if (!args) { termPrint("Usage: new <topic>", "term-error"); break; }
      termPrint(`Researching: ${args}...`, "term-info");
      try {
        const data = await api("/api/new", { idea: args });
        state = data.state;
        renderSidebar();
        termPrint(`Saved: /${data.slug}`, "term-success");
        await openIdea(data.slug, "notes");
      } catch (e) {
        termPrint(`Error: ${e.message}`, "term-error");
      }
      break;

    case "open":
      if (!args) { termPrint("Usage: open <slug>", "term-error"); break; }
      const ideaExists = state?.ideas?.some(i => i.slug === args);
      if (!ideaExists) { termPrint(`Idea '${args}' not found`, "term-error"); break; }
      closeSidebar();
      openIdea(args, "notes");
      termPrint(`Opened: ${args}`, "term-success");
      break;

    case "search":
      if (!args) { termPrint("Usage: search <query>", "term-error"); break; }
      try {
        const data = await api(`/api/find?q=${encodeURIComponent(args)}`);
        if (data.matches.length === 0) {
          termPrint("No matches found", "term-muted");
        } else {
          termPrint(`Found ${data.matches.length} matches:`, "term-info");
          data.matches.slice(0, 10).forEach(m => {
            termPrintHtml(`  <span class="term-success">/${esc(m.note)}</span> L${m.line}: ${esc(m.text.slice(0, 60))}`);
          });
          if (data.matches.length > 10) {
            termPrint(`  ... and ${data.matches.length - 10} more`, "term-muted");
          }
        }
      } catch (e) {
        termPrint(`Error: ${e.message}`, "term-error");
      }
      break;

    case "list":
      if (!state?.ideas?.length) {
        termPrint("No ideas yet", "term-muted");
      } else {
        termPrint("Ideas:", "term-info");
        state.ideas.forEach(i => {
          const pin = i.pinned ? " ★" : "";
          const tags = i.tags?.length ? ` [${i.tags.join(", ")}]` : "";
          termPrintHtml(`  <span class="term-success">${esc(i.slug)}</span>${esc(pin)}${esc(tags)} (${i.qa} questions)`);
        });
      }
      break;

    case "papers":
      if (!args) { termPrint("Usage: papers <topic>", "term-error"); break; }
      termPrint(`Searching arXiv for: ${args}...`, "term-info");
      try {
        const data = await api("/api/research", { topic: args });
        state = data.state;
        renderSidebar();
        termPrint("Papers saved to Research", "term-success");
        openResultsView(`papers: ${data.query}`, data.markdown);
      } catch (e) {
        termPrint(`Error: ${e.message}`, "term-error");
      }
      break;

    case "scan":
      if (!args) { termPrint("Usage: scan <field>", "term-error"); break; }
      termPrint(`Scanning: ${args}...`, "term-info");
      openResultsView(`field scan: ${args}`, statusHtml("scanning GitHub & arXiv"));
      bindStatus(document.getElementById("results-wrap"));
      try {
        const data = await api("/api/trend", { field: args });
        openResultsView(`field scan: ${args}`,
          mdHtml(data.repos, "repos & papers") + mdHtml(data.analysis, "field analysis"));
        termPrint("Scan complete", "term-success");
      } catch (e) {
        termPrint(`Error: ${e.message}`, "term-error");
      }
      break;

    case "hn":
      if (!args) { termPrint("Usage: hn <topic>", "term-error"); break; }
      termPrint(`Searching HN: ${args}...`, "term-info");
      try {
        const data = await api("/api/hn", { topic: args });
        openResultsView(`hn: ${args}`, data.markdown);
        termPrint("Search complete", "term-success");
      } catch (e) {
        termPrint(`Error: ${e.message}`, "term-error");
      }
      break;

    case "github":
      termPrint("Fetching GitHub trending...", "term-info");
      openResultsView("GitHub trending · today's top 10", statusHtml("fetching today's top trending repos"));
      bindStatus(document.getElementById("results-wrap"));
      try {
        const data = await api("/api/github10", {});
        openResultsView("GitHub trending · today's top 10", data.markdown);
        termPrint("Done", "term-success");
      } catch (e) {
        termPrint(`Error: ${e.message}`, "term-error");
      }
      break;

    case "compare":
      if (!args) { termPrint("Usage: compare <idea-a> <idea-b>", "term-error"); break; }
      const compareParts = args.split(/\s+/);
      if (compareParts.length < 2) { termPrint("Usage: compare <idea-a> <idea-b>", "term-error"); break; }
      termPrint(`Comparing: ${compareParts[0]} vs ${compareParts[1]}...`, "term-info");
      try {
        const data = await api("/api/compare", { a: compareParts[0], b: compareParts[1] });
        openResultsView(`${compareParts[0]} vs ${compareParts[1]}`, data.markdown);
        termPrint("Comparison complete", "term-success");
      } catch (e) {
        termPrint(`Error: ${e.message}`, "term-error");
      }
      break;

    case "export":
      termPrint("Exporting all notes...", "term-info");
      try {
        const data = await api("/api/export-all");
        const blob = new Blob([data.markdown], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "omega-export.md";
        a.click();
        URL.revokeObjectURL(url);
        termPrint("Export complete", "term-success");
      } catch (e) {
        termPrint(`Error: ${e.message}`, "term-error");
      }
      break;

    case "pin":
      if (!args) { termPrint("Usage: pin <slug>", "term-error"); break; }
      try {
        const data = await api("/api/pin", { slug: args });
        state = data.state;
        renderSidebar();
        termPrint(data.pinned ? "Pinned" : "Unpinned", "term-success");
      } catch (e) {
        termPrint(`Error: ${e.message}`, "term-error");
      }
      break;

    default:
      termPrint(`Unknown command: ${command}`, "term-error");
      termPrint("Type 'help' for available commands", "term-muted");
  }
}

terminalInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    const cmd = terminalInput.value.trim();
    if (cmd) {
      terminalHistory.push(cmd);
      terminalHistoryIdx = terminalHistory.length;
      terminalInput.value = "";
      await termExec(cmd);
    }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (terminalHistoryIdx > 0) {
      terminalHistoryIdx--;
      terminalInput.value = terminalHistory[terminalHistoryIdx] || "";
    }
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (terminalHistoryIdx < terminalHistory.length - 1) {
      terminalHistoryIdx++;
      terminalInput.value = terminalHistory[terminalHistoryIdx] || "";
    } else {
      terminalHistoryIdx = terminalHistory.length;
      terminalInput.value = "";
    }
  } else if (e.key === "l" && e.ctrlKey) {
    e.preventDefault();
    termClear();
  }
});

// Terminal drag
terminalTitlebar.addEventListener("mousedown", (e) => {
  if (e.target.closest(".terminal-controls")) return;
  const rect = terminalWindow.getBoundingClientRect();
  terminalDragState = {
    startX: e.clientX,
    startY: e.clientY,
    startLeft: rect.left,
    startTop: rect.top,
  };
  document.addEventListener("mousemove", handleTerminalDrag);
  document.addEventListener("mouseup", handleTerminalDragEnd);
});

function handleTerminalDrag(e) {
  if (!terminalDragState) return;
  const dx = e.clientX - terminalDragState.startX;
  const dy = e.clientY - terminalDragState.startY;
  terminalWindow.style.left = `${terminalDragState.startLeft + dx}px`;
  terminalWindow.style.top = `${terminalDragState.startTop + dy}px`;
  terminalWindow.style.right = "auto";
  terminalWindow.style.bottom = "auto";
}

function handleTerminalDragEnd() {
  terminalDragState = null;
  document.removeEventListener("mousemove", handleTerminalDrag);
  document.removeEventListener("mouseup", handleTerminalDragEnd);
}

// Terminal resize
terminalResize.addEventListener("mousedown", (e) => {
  e.preventDefault();
  const rect = terminalWindow.getBoundingClientRect();
  const startX = e.clientX;
  const startY = e.clientY;
  const startW = rect.width;
  const startH = rect.height;

  function onMove(e) {
    const newW = Math.max(400, startW + (e.clientX - startX));
    const newH = Math.max(200, startH + (startY - e.clientY));
    terminalWindow.style.width = `${newW}px`;
    terminalWindow.style.height = `${newH}px`;
  }

  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});

// Terminal controls
document.getElementById("btn-terminal").onclick = toggleTerminal;
document.getElementById("btn-terminal-menu").onclick = () => {
  actionsMenu.classList.add("hidden");
  actionsDropdown.classList.remove("open");
  toggleTerminal();
};
document.getElementById("terminal-close").onclick = toggleTerminal;
document.getElementById("terminal-minimize").onclick = () => {
  terminalWindow.style.display = "none";
  setTimeout(() => { terminalWindow.style.display = ""; }, 3000);
};
document.getElementById("terminal-maximize").onclick = () => {
  terminalMaximized = !terminalMaximized;
  terminalWindow.classList.toggle("maximized", terminalMaximized);
};

// Keyboard shortcut for terminal
document.addEventListener("keydown", (e) => {
  if (e.key === "`" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    toggleTerminal();
  }
});

renderHome();
