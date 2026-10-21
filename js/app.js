/* ============================================================
   app.js — UI layer: store, views, chat rendering, settings,
   files, topics, history, global search and quick actions.
   ============================================================ */
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const timeStr = ts => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dateStr = ts => new Date(ts).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
const formatTokens = value => new Intl.NumberFormat("en-ZA", { notation: Number(value) >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(Number(value) || 0);
const formatZar = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", minimumFractionDigits: Number(value) < 0.1 ? 4 : 2, maximumFractionDigits: Number(value) < 0.1 ? 4 : 2 }).format(Number(value)) : "Not priced";
const PALETTES = [
  { id: "manuscript", name: "Manuscript", colors: ["#315b49", "#b68a45"] },
  { id: "oxford", name: "Oxford", colors: ["#203e63", "#a77a3b"] },
  { id: "olive", name: "Olive", colors: ["#59633a", "#ba8c4d"] },
  { id: "clay", name: "Clay", colors: ["#8d4e38", "#c69b63"] },
  { id: "midnight", name: "Midnight", colors: ["#445f87", "#b69355"] },
];
const safeHttpUrl = value => {
  try {
    const url = new URL(String(value));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "#";
  } catch { return "#"; }
};

/* ---------- Mini markdown renderer ---------- */
function md(src, citations = []) {
  let text = String(src||'');
  // Insert source links at API-provided character boundaries before Markdown parsing.
  const ranges = citations.filter(c => Number.isInteger(c.end_index) && c.end_index <= text.length)
    .sort((a,b) => b.end_index-a.end_index);
  for (const c of ranges) text = text.slice(0,c.end_index) + ` [source](${safeHttpUrl(c.url)})` + text.slice(c.end_index);
  text=cleanCitationArtifacts(text);
  let rendered = DOMPurify.sanitize(marked.parse(text, { gfm:true, breaks:false }), { USE_PROFILES:{html:true}, FORBID_TAGS:['img','style','iframe','form','input','button'], FORBID_ATTR:['style'] });
  const host=document.createElement('div');host.innerHTML=rendered;
  host.querySelectorAll('a').forEach(a=>{a.href=safeHttpUrl(a.getAttribute('href'));a.classList.add('in-app-link');a.rel='noopener';});
  host.querySelectorAll('strong').forEach(node=>{
    const ref=RefParser.parse(node.textContent);
    if(ref&&!ref.error&&ref.confidence>=.9){const button=document.createElement('button');button.className='ref-chip';button.dataset.ref=node.textContent;button.textContent=node.textContent;node.replaceWith(button);}
  });
  return host.innerHTML;
}

/* ---------- Store: sessions, notes, topics ---------- */
const Store = {
  sessions: [], notes: [], topics: [],
  load() {
    const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
    const snapshot=Workspace.readLocal(localStorage);
    if(snapshot){this.quarantined=snapshot.quarantined||[];this.trash=snapshot.trash||[];return this.hydrate(snapshot);}
    const sessions = get("bibleai.sessions.v1", []);
    const notes = get("bibleai.notes.v1", []);
    const topics = get("bibleai.topics.v1", []);
    return this.hydrate({ sessions, notes, topics });
  },
  deletedSessions: {}, quarantined: [],
  hydrate(data = {}) {
    const parsed=Workspace.normalizeWorkspace(data);
    Object.assign(this, {sessions:parsed.state.sessions,notes:parsed.state.notes,topics:parsed.state.topics,trash:parsed.state.trash,deletedSessions:parsed.state.deletedSessions});
    if(parsed.rejected.length) { this.quarantined.push(...parsed.rejected); setTimeout(()=>window.App?.toast('Some saved records need recovery. Export a backup before removing them.'),0); }
    return this;
  },
  persist(opts = {}) {
    const state={settings:Settings.data,sessions:this.sessions,notes:this.notes,topics:this.topics,trash:this.trash||[],deletedSessions:this.deletedSessions,quarantined:this.quarantined,syncBase:window.CloudSync?.base||null,syncRevision:window.CloudSync?.revision||0,dirty:opts.markUpdated!==false||Boolean(window.CloudSync?.dirty)};
    const ok=Workspace.writeLocal(localStorage,state);
    if(ok)document.querySelector("#storageWarning")?.remove();
    this.unsaved=!ok;
    if(!ok) window.App?.storageWarning?.();
    if(opts.sync!==false)window.CloudSync?.schedule();
    return ok;
  },
  newSession(mode) {
    const s = { id: uid(), title: "", mode: mode || "chat", created: Date.now(), updated: Date.now(),
                translation: Settings.data.translation, messages: [], citations: [], lastPassage: null, lastResponseId: null };
    this.sessions.unshift(s); this.persist(); return s;
  },
  addTopic(t) { this.topics.unshift({ id: uid(), created: Date.now(), ...t }); this.persist(); },
};

/* ---------- Understand: multi-level analysis catalogue ----------
   Each card builds a rich prompt that runs through the agent harness in
   deep-study mode (original-language + structural instructions). */
const STUDY_LEVELS = {
  book: {
    label: "Book", needs: "book",
    cards: [
      { icon: "i-book", title: "Genre & type", desc: "What kind of book is this, and how should that shape reading it?",
        prompt: r => `Analyse the BOOK of ${r.book} at book level: What literary genre(s) and type of book is it (narrative, law, wisdom, gospel, epistle, apocalyptic…)? How does its genre change how it should be read and applied? Give concrete examples from the text (retrieve them).` },
      { icon: "i-grid", title: "Structure & outline", desc: "The book's architecture — sections, movements, turning points.",
        prompt: r => `Give a structural analysis of the BOOK of ${r.book}: a clear outline of its major sections and movements, its turning points, and any deliberate architecture (chiasm, framing, cycles, alternation). Demonstrate each structural claim with actual references and short retrieved quotes.` },
      { icon: "i-sparkles", title: "Themes & message", desc: "Central themes and the book's big idea.",
        prompt: r => `What are the major THEMES of the book of ${r.book}, and what is its central message? Trace each theme through 3–4 key passages (retrieve them), and state the book's big idea in one sentence at the end.` },
      { icon: "i-history", title: "Patterns & motifs", desc: "Repetitions, key words, literary devices across the book.",
        prompt: r => `What literary PATTERNS and motifs run through the book of ${r.book}? Repeated words/phrases (check the original language for key terms), recurring images, numeric or structural patterns, irony, foreshadowing. Show real examples with references.` },
      { icon: "i-cap", title: "Setting & audience", desc: "Author, date, first readers, historical situation.",
        prompt: r => `Give the historical setting of the book of ${r.book}: author (and debates about it, fairly presented), approximate date, original audience, occasion and purpose. Use web research for scholarly backing and cite sources.` },
      { icon: "i-logo", title: "Christ in this book", desc: "How the book fits redemptive history and points to Jesus.",
        prompt: r => `How does the book of ${r.book} fit into redemptive history and point to Christ? Distinguish direct prophecy, typology, and broader theological trajectory — label which is which, and ground each in retrieved passages.` },
    ],
  },
  chapter: {
    label: "Chapter", needs: "chapter",
    cards: [
      { icon: "i-grid", title: "Flow & outline", desc: "How the chapter's argument or story moves.",
        prompt: r => `Analyse ${r.book} ${r.chapter} as a CHAPTER: retrieve it, then give its outline and the flow of its argument/story — how each section advances the whole, and where the climax or hinge is.` },
      { icon: "i-history", title: "Context: before & after", desc: "What this chapter does inside the book.",
        prompt: r => `Place ${r.book} ${r.chapter} in CONTEXT: what happens immediately before and after (retrieve the surrounding passages briefly), what role this chapter plays in the whole book of ${r.book}, and what is lost if it is read in isolation.` },
      { icon: "i-sparkles", title: "Key verses & themes", desc: "Load-bearing verses and what the chapter teaches.",
        prompt: r => `Identify the KEY VERSES of ${r.book} ${r.chapter} (retrieve the chapter first): which verses carry the chapter's weight and why, what themes the chapter develops, and how they connect to the book's larger message.` },
      { icon: "i-book", title: "Original-language notes", desc: "Words and grammar in this chapter worth knowing.",
        prompt: r => `Give original-language notes on ${r.book} ${r.chapter}: retrieve the original text of its most important verses, pick the 5–7 most significant Hebrew/Greek words or constructions (look each up in the lexicon), and explain what they add that translations flatten out.` },
    ],
  },
  verse: {
    label: "Verse", needs: "verse",
    cards: [
      { icon: "i-book", title: "Original-language exegesis", desc: "Word-by-word walk through the original text.",
        prompt: r => `Do a careful ORIGINAL-LANGUAGE EXEGESIS of ${r.ref}: retrieve the translation and the original text, walk through it phrase by phrase (original script + transliteration), look up the key words in the lexicon, note grammar/word order/emphasis that translations can't show, then give a tight summary of what the verse actually says.` },
      { icon: "i-cap", title: "Original intent & context", desc: "What the author meant the first readers to hear.",
        prompt: r => `What was the ORIGINAL INTENT of ${r.ref}? Retrieve it with surrounding context. Cover: the literary context (what comes before/after), the historical situation of the first audience, what the author was arguing or narrating, and common modern misreadings of this verse.` },
      { icon: "i-crossref", title: "Cross-references", desc: "Where Scripture interprets this verse.",
        prompt: r => `Trace the CROSS-REFERENCES of ${r.ref}: retrieve it, then find and retrieve the passages that echo, quote, or illuminate it (search the Bible text for its key phrases and terms). Explain each connection and what the web of references teaches together.` },
      { icon: "i-sparkles", title: "Meaning & application", desc: "From sound exegesis to life.",
        prompt: r => `Move from exegesis to APPLICATION for ${r.ref}: retrieve it, establish its meaning in context briefly, then draw applications that genuinely follow from the text (label anything that is inference rather than direct teaching). Practical, warm, no clichés.` },
    ],
  },
  word: {
    label: "Word", needs: "word",
    cards: [
      { icon: "i-book", title: "Full word study", desc: "Lemma, semantic range, and this verse's usage.",
        prompt: (r, w) => `Do a FULL WORD STUDY of ${w.lexeme || w.text} (Strong's ${w.strongs}), as used in ${r.ref}: look it up in the lexicon, give lemma/transliteration/pronunciation, its full semantic range, which sense operates in ${r.ref} and why, and how the KJV/CSB/ESV render it here (retrieve the verse in those translations).` },
      { icon: "i-search", title: "Usage across Scripture", desc: "How this word behaves elsewhere.",
        prompt: (r, w) => `Trace the USAGE of ${w.lexeme || w.text} (Strong's ${w.strongs}) across Scripture: where else does this lemma appear in important passages (search the Bible text for its main English glosses to locate candidates, then verify)? Group the occurrences by sense, and show how the usage pattern sharpens its meaning in ${r.ref}.` },
      { icon: "i-cap", title: "Theology of the word", desc: "The concept behind the word in biblical theology.",
        prompt: (r, w) => `Explain the THEOLOGY carried by ${w.lexeme || w.text} (Strong's ${w.strongs}) in ${r.ref}: what concept does this word carry in biblical theology, how did its meaning develop across the canon, what do trusted sources say about it (search and cite), and what difference it makes for reading ${r.ref}.` },
    ],
  },
};

/* ---------- App ---------- */
const App = {
  view: "chat",
  session: null,
  activeRun: null,
  lastPassage: null,
  study: { ref: null, data: null, level: "verse", selectedWord: null },
  pendingAttachments: [],
  library: [],
  libraryFilter: "all",
  cameraFacing: "environment",
  cameraStream: null,

  async init() {
    Settings.load(); Store.load();
    this.applyTheme();
    this.session = Store.sessions.find(s => s.pendingRun) || (Store.sessions[0] || { id:uid(),mode:"chat",translation:Settings.data.translation,messages:[],citations:[] });
    this.bindNav(); this.bindTopbar(); this.bindComposer(); this.bindQuickActions(); this.bindGlobal(); this.bindOriginal(); this.bindFiles(); this.bindViewers(); this.bindSelectionActions();
    this.renderAll();
    const localSessionId = this.session.id;
    await CloudSync.init();
    this.applyTheme();
    this.session = Store.sessions.find(s => s.pendingRun)
      || Store.sessions.find(s => s.id === localSessionId)
      || Store.sessions[0]
      || Store.newSession("chat");
    this.renderAll();
    this.refreshFxRate();
    this.bindAccessibleNavigation();
    if (this.session.pendingRun && this.session.pendingRun.status !== "failed") this.resumePendingRun();
    if (!Settings.data.apiKey && localStorage.getItem("bibleai.welcomeDismissed.v1") !== "1") this.showWelcome();
  },

  /* ===== Theme ===== */
  applyTheme() {
    const pref = Settings.data.theme;
    const dark = pref === "dark" || (pref === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.dataset.palette = Settings.data.palette || "manuscript";
    const themeColors = { manuscript: "#315b49", oxford: "#203e63", olive: "#59633a", clay: "#8d4e38", midnight: "#26364d" };
    $("meta[name='theme-color']")?.setAttribute("content", dark ? "#101511" : (themeColors[Settings.data.palette] || themeColors.manuscript));
    $("#themeIcon use")?.setAttribute("href", dark ? "#i-moon" : "#i-sun");
  },

  /* ===== Navigation ===== */
  bindNav() {
    $$("[data-nav]").forEach(btn => btn.addEventListener("click", () => {
      const target = btn.dataset.nav;
      this.go(target, target === "chat" ? { mode: "chat" } : {});
    }));
    $("#collapseSidebar")?.addEventListener("click", () => $("#appShell").classList.toggle("sidebar-collapsed"));
    $("#mobileMenu")?.addEventListener("click", () => {
      this.setRightPanel(false);
      $("#sidebar").classList.toggle("mobile-open");
    });
    $("#scrim")?.addEventListener("click", () => {
      $("#sidebar").classList.remove("mobile-open");
      this.setRightPanel(false);
    });
    $("#rightPanelClose")?.addEventListener("click", () => this.setRightPanel(false));
  },
  go(view, opts = {}) {
    if (view === "chat" && opts.fresh) {
      this.pendingAttachments=[];this.renderAttachmentTray();
      this.session = Store.newSession("chat");
    }
    this.lastPassage = this.passageForSession(this.session);
    this.view = view;
    $$(".view").forEach(v => v.classList.toggle("active", v.dataset.view === view));
    $$("[data-nav]").forEach(b => {
      b.classList.toggle("active", b.dataset.nav === view);
      if(b.dataset.nav===view)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");
    });
    $("#sidebar").classList.remove("mobile-open");
    $("#rightPanel").classList.remove("open");
    $("#scrim").classList.remove("panel-open");
    if (view === "chat") this.renderChat();
    if (view === "original") this.renderUnderstand();
    if (view === "topics") this.renderTopics();
    if (view === "library") this.renderLibrary();
    if (view === "history") this.renderHistory();
    if (view === "settings") this.renderSettings();
    this.renderModeBanner();
    this.renderSourcesPanel();
    this.updateDrawerAccess?.();
    if(!opts.fromHistory && location.hash!=="#"+view)history.pushState({view},"","#"+view);
  },
  passageForSession(session) {
    if (!session) return null;
    return session.lastPassage || [...(session.messages || [])].reverse().find(m => m.passage)?.passage || null;
  },
  setRightPanel(open) {
    $("#rightPanel")?.classList.toggle("open", Boolean(open));
    $("#scrim")?.classList.toggle("panel-open", Boolean(open));
    $("#panelToggle")?.setAttribute("aria-expanded", String(Boolean(open)));
  },

  renderAll() {
    this.go(this.view);
    this.renderRecents(); this.renderSourcesPanel();
    $("#currentVersion").textContent = Settings.data.translation;
  },

  /* ===== Topbar: search, version, theme ===== */
  bindTopbar() {
    const input = $("#globalSearch"), pop = $("#searchPopover");
    const close = () => { pop.classList.remove("open"); input.setAttribute("aria-expanded", "false"); };
    input.addEventListener("input", () => this.renderSearch(input.value));
    input.addEventListener("focus", () => this.renderSearch(input.value));
    document.addEventListener("pointerdown", e => { if (!e.target.closest(".global-search")) close(); });
    document.addEventListener("keydown", e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.focus(); }
      if (e.key === "Escape") { close(); $$("dialog[open]").forEach(d => d.close()); }
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        const ref = RefParser.parse(input.value);
        if (ref && !ref.error) { close(); input.blur(); this.go("chat"); this.submitPrompt(input.value); input.value = ""; }
      }
    });

    const vBtn = $("#versionButton"), vMenu = $("#versionMenu");
    vMenu.innerHTML = `<button class="version-option" data-v="AUTO"><span>Auto</span><small>from prompt</small></button>` +
      Translations.map(t => `<button class="version-option" data-v="${t.code}"><span>${t.code}</span><small>${esc(t.name)}</small></button>`).join("");
    const closeVersionMenu = () => { vMenu.classList.remove("open"); vBtn.setAttribute("aria-expanded", "false"); };
    vBtn.addEventListener("click", () => { vMenu.classList.toggle("open"); vBtn.setAttribute("aria-expanded", String(vMenu.classList.contains("open"))); });
    document.addEventListener("pointerdown", e => { if (!e.target.closest(".version-control")) closeVersionMenu(); });
    $$(".version-option", vMenu).forEach(o => o.addEventListener("click", () => {
      const v = o.dataset.v;
      if (v === "AUTO") { Settings.data.autoTranslation = true; this.toast("Auto mode: translation follows your prompt"); }
      else { Settings.data.autoTranslation = false; Settings.data.translation = v; this.session.translation = v; }
      Settings.save(); $("#currentVersion").textContent = v === "AUTO" ? Settings.data.translation : v;
      this.markVersionMenu(); closeVersionMenu();
    }));
    this.markVersionMenu();

    $("#themeButton").addEventListener("click", () => {
      const cur = document.documentElement.dataset.theme;
      Settings.data.theme = cur === "dark" ? "light" : "dark"; Settings.save(); this.applyTheme();
    });
    $("#panelToggle")?.addEventListener("click", () => this.setRightPanel(!$("#rightPanel").classList.contains("open")));
    $("#chatCostBadge")?.addEventListener("click", () => {
      this.go("settings");
      requestAnimationFrame(() => $("#usageSettings")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    });
  },
  markVersionMenu() {
    $$(".version-option").forEach(o => o.classList.toggle("active",
      o.dataset.v === "AUTO" ? Settings.data.autoTranslation : !Settings.data.autoTranslation && o.dataset.v === Settings.data.translation));
  },

  renderSearch(q) {
    const pop = $("#searchPopover");
    q = (q || "").trim().toLowerCase();
    const groups = [];
    const ref = RefParser.parse(q);
    if (ref && !ref.error) groups.push({ label: "Scripture", items: [{ icon: "i-book", title: RefParser.format(ref) + (ref.translation ? " " + ref.translation : ""), sub: "Open passage", act: () => { this.go("chat"); this.submitPrompt(q); } }] });
    const match = (txt) => txt && txt.toLowerCase().includes(q);
    if (q) {
      const chats = Store.sessions.filter(s => match(s.title) || s.messages.some(m => match(m.text))).slice(0, 4)
        .map(s => ({ icon: "i-chat", title: s.title || "Untitled conversation", sub: dateStr(s.updated), act: () => this.openSession(s.id) }));
      if (chats.length) groups.push({ label: "Conversations", items: chats });
      const topics = Store.topics.filter(t => match(t.title)).slice(0, 3)
        .map(t => ({ icon: "i-grid", title: t.title, sub: "Saved topic", act: () => this.go("topics") }));
      if (topics.length) groups.push({ label: "Topics", items: topics });
    }
    if (!groups.length) {
      pop.innerHTML = `<div class="search-empty">${q ? "No matches. Try a verse reference like <b>John 3:16</b>." : "Search chats, verses and topics — or type a reference and press Enter."}</div>`;
    } else {
      pop.innerHTML = groups.map(g => `<div class="search-group-label">${g.label}</div>` + g.items.map((it, i) =>
        `<button class="search-result" data-g="${g.label}" data-i="${i}"><span class="result-icon"><svg><use href="#${it.icon}"/></svg></span><span><strong>${esc(it.title)}</strong><small>${esc(it.sub)}</small></span></button>`).join("")).join("");
      let idx = 0;
      groups.forEach(g => g.items.forEach(it => {
        pop.children; // noop
      }));
      const flat = groups.flatMap(g => g.items);
      $$(".search-result", pop).forEach((btn, i) => btn.addEventListener("click", () => { flat[i].act(); pop.classList.remove("open"); $("#globalSearch").value = ""; }));
    }
    pop.classList.add("open");
    $("#globalSearch").setAttribute("aria-expanded", "true");
  },

  /* ===== Sidebar recents ===== */
  renderRecents() {
    const list = $("#recentList");
    const items = Store.sessions.filter(s => s.messages.length).slice(0, 6);
    list.innerHTML = items.length ? items.map(s =>
      `<button class="recent-item" data-id="${s.id}"><svg><use href="#i-chat"/></svg><span>${esc(s.title || "Untitled conversation")}</span></button>`).join("")
      : `<p class="recent-empty">No conversations yet</p>`;
    $$(".recent-item", list).forEach(b => b.addEventListener("click", () => this.openSession(b.dataset.id)));
  },
  openSession(id) {
    const s = Store.sessions.find(x => x.id === id);
    if (!s) return;
    this.session = s; this.lastPassage = this.passageForSession(s); this.go("chat"); this.renderSourcesPanel();
  },

  /* ===== Chat ===== */
  renderModeBanner() {
    const b = $("#modeBanner");
    if (!b) return;
    const mode = this.session.mode;
    b.classList.remove("research");
    b.classList.toggle("study", mode === "study");
    b.querySelector("span").textContent =
      mode === "study" ? "Deep study · manuscripts, lexicons and source checks when needed"
      : "Study chat · Scripture, open-web research and artifact creation in one place";
    const usage = this.usageForSession(this.session);
    const badge = $("#chatCostBadge");
    if (badge) {
      badge.hidden = usage.totalTokens === 0;
      badge.textContent = usage.totalTokens ? `${usage.priced ? formatZar(usage.costZar) + " · " : ""}${formatTokens(usage.totalTokens)} tokens` : "";
      badge.title = `${formatTokens(usage.inputTokens)} input · ${formatTokens(Math.max(0, usage.outputTokens - usage.reasoningTokens))} answer · ${formatTokens(usage.reasoningTokens)} reasoning tokens`;
    }
  },

  usageForSession(session) {
    const total = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, costUsd: 0, costZar: 0, priced: true };
    for (const message of session?.messages || []) {
      const u = message.usage;
      if (!u) continue;
      for (const key of ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens", "totalTokens", "costUsd", "costZar"])
        total[key] += Number(u[key]) || 0;
      if (u.priced === false) total.priced = false;
    }
    return total;
  },

  usageAcrossChats() {
    const total = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, costUsd: 0, costZar: 0, priced: true };
    for (const session of Store.sessions) {
      const u = this.usageForSession(session);
      for (const key of ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens", "totalTokens", "costUsd", "costZar"])
        total[key] += Number(u[key]) || 0;
      if (u.priced === false) total.priced = false;
    }
    return total;
  },

  renderUsageLine(usage) {
    const div = document.createElement("div");
    div.className = "usage-line";
    const answer = Math.max(0, (usage.outputTokens || 0) - (usage.reasoningTokens || 0));
    div.innerHTML = `<span>${formatTokens(usage.inputTokens)} in</span><span>${formatTokens(answer)} answer</span><span>${formatTokens(usage.reasoningTokens)} reasoning</span><strong>${usage.priced === false ? "Price unavailable" : formatZar(usage.costZar)}</strong>`;
    div.title = "Reasoning is shown separately but is already included in billed output tokens.";
    return div;
  },

  renderChat() {
    const feed = $("#feed");
    feed.innerHTML = "";
    if (!this.session.messages.length) {
      feed.appendChild(this.emptyState());
    } else {
      for (const m of this.session.messages) feed.appendChild(this.renderMessage(m));
    }
    this.scrollFeed(true);
    this.renderModeBanner();
    if(this.session.pendingRun?.status==='failed'){
      const recovery=document.createElement('div');recovery.className='fallback-note';recovery.setAttribute('role','status');
      recovery.innerHTML='This response stopped before completion. <button type="button" data-retry>Retry response</button> <button type="button" data-discard>Dismiss recovery</button>';
      recovery.querySelector('[data-retry]').onclick=()=>{if(this.activeRun||this.lookupRun)return;recovery.remove();this.resumePendingRun();};
      recovery.querySelector('[data-discard]').onclick=()=>{delete this.session.pendingRun;Store.persist();recovery.remove();};feed.append(recovery);
    }
  },

  emptyState() {
    const div = document.createElement("div");
    div.className = "empty-state";
    const examples = ["Matthew 1:1 CSB", "Research the historical case for the resurrection", "Create a visual explainer of Romans 8", "What does ‘Selah’ mean in the Psalms?"];
    div.innerHTML = `
      <div class="empty-logo"><svg><use href="#i-logo"/></svg></div>
      <h2>What shall we study?</h2>
      <p>Look up Scripture, test a claim, research the open web, study original words, or create a visual you can keep.</p>
      <div class="example-grid">${examples.map(e => `<button class="example-card">${esc(e)}</button>`).join("")}</div>`;
    $$(".example-card", div).forEach(b => b.addEventListener("click", () => this.submitPrompt(b.textContent)));
    return div;
  },

  renderMessage(m) {
    const row = document.createElement("div");
    if (m.role === "user") {
      row.className = "user-row";
      row.innerHTML = `<div class="mini-avatar">W</div><div class="user-bubble"><div><span>${esc(m.text)}</span>${m.attachments?.length ? `<div class="message-files">${m.attachments.map(f => `<button data-file-preview="${esc(f.id)}"><svg><use href="#${String(f.mimeType).startsWith("image/") ? "i-image" : "i-file"}"/></svg>${esc(f.name)}</button>`).join("")}</div>` : ""}</div><span class="time">${timeStr(m.ts)}</span></div>`;
      $$('[data-file-preview]', row).forEach(button => button.addEventListener("click", () => this.previewFile(m.attachments.find(f => f.id === button.dataset.filePreview))));
      return row;
    }
    row.className = "assistant-row";
    const avatarIcon = m.kind === "passage" ? "i-book" : "i-sparkles";
    row.innerHTML = `<div class="assistant-avatar${m.kind === "passage" ? " book" : ""}"><svg><use href="#${avatarIcon}"/></svg></div><div class="assistant-body"></div>`;
    const body = $(".assistant-body", row);
    if (m.log?.length) body.appendChild(this.renderLog(m.log, true));
    if (m.kind === "passage" && m.passage) body.appendChild(this.renderPassageCard(m.passage));
    if(m.passages?.length)m.passages.forEach(p=>body.appendChild(this.renderPassageCard(p)));
    if (m.text) {
      const card = document.createElement("div");
      card.className = "result-card prose";
      card.innerHTML = md(m.text,m.citations||[]);
      if(m.kind!=="passage"){const label=document.createElement("p");label.className="ai-provenance";label.textContent="AI commentary · verify quotations against the retrieved passage cards";card.prepend(label);}
      body.appendChild(card);
    }
    if (m.citations?.length) body.appendChild(this.renderCitationsStrip(m.citations));
    if (m.artifacts?.length) {
      const artifacts = document.createElement("div");
      artifacts.className = "artifact-actions";
      artifacts.innerHTML = m.artifacts.map(a => `<button class="artifact-preview" data-artifact="${esc(a.id)}"><span><svg><use href="#${a.format === "pdf" ? "i-file" : "i-image"}"/></svg></span><span><strong>${esc(a.metadata?.title || a.name)}</strong><small>${esc(a.format.toUpperCase())} · Ready</small></span><b>Preview</b></button>`).join("");
      $$('[data-artifact]', artifacts).forEach(button => button.addEventListener("click", () => this.previewArtifact(m.artifacts.find(a => a.id === button.dataset.artifact))));
      body.appendChild(artifacts);
    }
    if (m.suggestions?.length) {
      const suggestions = document.createElement("div");
      suggestions.className = "followups";
      suggestions.innerHTML = `<span>Continue the study</span>${m.suggestions.map(s => `<button>${esc(s)}</button>`).join("")}`;
      $$("button", suggestions).forEach(button => button.addEventListener("click", () => this.submitPrompt(button.textContent)));
      body.appendChild(suggestions);
    }
    if (m.usage?.totalTokens) body.appendChild(this.renderUsageLine(m.usage));
    this.bindRefChips(body);
    return row;
  },

  renderPassageCard(p) {
    const card = document.createElement("div");
    card.className = "result-card passage-card";
    card.innerHTML = `
      <div class="card-header">
        <div class="card-title">${esc(p.reference)}</div>
        <span class="badge">${esc(p.translation)}</span>
        <div class="card-actions">
          <button title="Copy passage" data-act="copy"><svg><use href="#i-copy"/></svg></button>
          <button title="Compare versions" data-act="compare"><svg><use href="#i-grid"/></svg></button>
        </div>
      </div>
      ${p.fallbackNote ? `<p class="fallback-note">${esc(p.fallbackNote)}</p>` : ""}
      <div class="verse-block">${p.verses.map(v => `<div class="verse-line"><span class="verse-no">${p.verses.some(x => x.chapter !== p.verses[0].chapter) ? v.chapter + ":" : ""}${v.verse}</span><span>${esc(v.text)}</span></div>`).join("")}</div>
      <p class="attribution">${esc(p.attribution)}</p>`;
    $('[data-act="copy"]', card).addEventListener("click", () => this.copy(`${p.reference} (${p.translation})\n` + p.verses.map(v => `${v.verse} ${v.text}`).join("\n"), "Passage copied"));
    $('[data-act="compare"]', card).addEventListener("click", () => this.compareVersions(p));
    return card;
  },

  renderLog(entries, collapsed) {
    const wrap = document.createElement("details");
    wrap.className = "agent-log";
    if (!collapsed) wrap.open = true;
    wrap.innerHTML = `<summary><svg><use href="#i-bolt"/></svg><span>${entries.length} agent action${entries.length > 1 ? "s" : ""}</span></summary>
      <div class="log-body">${entries.map(e => `<div class="log-line ${e.ok === false ? "err" : ""}">${esc(e.text)}</div>`).join("")}</div>`;
    return wrap;
  },

  renderCitationsStrip(citations) {
    const div = document.createElement("div");
    div.className = "citations-strip";
    div.innerHTML = `<div class="cit-label"><svg><use href="#i-external"/></svg><span><strong>Source ledger</strong><small>${citations.length} source${citations.length === 1 ? "" : "s"} used</small></span></div><div class="citation-list">` +
      citations.map((c, i) => `<a class="citation-row in-app-link" href="${esc(safeHttpUrl(c.url))}" rel="noopener"><span>${i + 1}</span><span><strong>${esc(c.title || this.hostOf(c.url))}</strong><small>${esc(this.hostOf(c.url))}</small></span><svg><use href="#i-chev-right"/></svg></a>`).join("") + `</div>`;
    return div;
  },
  hostOf(url) {
    const safe = safeHttpUrl(url);
    if (safe === "#") return "Invalid source";
    return new URL(safe).hostname.replace(/^www\./, "");
  },

  bindRefChips(root) {
    $$(".ref-chip", root).forEach(chip => chip.addEventListener("click", () => this.submitPrompt(chip.dataset.ref)));
  },

  scrollFeed(instant, onlyFollowing = false) {
    const c = $("#conversation");
    if(onlyFollowing && c.scrollHeight-c.scrollTop-c.clientHeight>120)return;
    this.setComposerHidden(false);
    c.scrollTo({ top: c.scrollHeight, behavior: instant ? "auto" : "smooth" });
  },

  setComposerHidden(hidden) {
    const zone = $(".composer-zone");
    const input = $("#composerInput");
    if (!zone || !matchMedia("(max-width: 744px)").matches) return;
    const keepVisible = document.activeElement === input || Boolean(input?.value) || Boolean(this.activeRun);
    zone.classList.toggle("scroll-hidden", Boolean(hidden) && !keepVisible);
  },

  /* ===== Composer & agent run ===== */
  bindComposer() {
    const form = $("#composer"), ta = $("#composerInput"), conversation = $("#conversation");
    ta.addEventListener("input", () => {
      ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
      this.setComposerHidden(false);
    });
    ta.addEventListener("focus", () => this.setComposerHidden(false));
    ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener("submit", e => {
      e.preventDefault();
      if(this.activeRun||this.lookupRun){this.toast("A request is still running. Your draft is kept.");return;}
      const error=Workspace.attachmentError(this.pendingAttachments);if(error){this.toast(error);return;}
      const text = ta.value.trim();
      if (!text && !this.pendingAttachments.length) return;
      const ref=RefParser.parse(text);
      if(ref?.error){this.toast(ref.error);return;}
      if(!Settings.data.apiKey&&!(ref&&ref.confidence>=.9&&!this.pendingAttachments.length)){this.toast("Add an API key in Settings for AI requests. Your draft is kept.");return;}
      ta.value = ""; ta.style.height = "auto";
      const attachments = [...this.pendingAttachments];
      this.pendingAttachments = []; this.renderAttachmentTray();
      this.submitPrompt(text || "Please examine the attached file.", attachments);
    });
    $$(".chip", form).forEach(chip => chip.addEventListener("click", () => {
      const hint = chip.dataset.hint;
      ta.value = ta.value ? ta.value.replace(/\s+$/, "") + " — " + hint : hint + " ";
      ta.focus();
    }));
    $("#attachButton")?.addEventListener("click", () => this.openSheet("attachSheet"));
    let lastTop = conversation.scrollTop;
    conversation.addEventListener("scroll", () => {
      if (!matchMedia("(max-width: 744px)").matches) return;
      const top = conversation.scrollTop;
      const delta = top - lastTop;
      const nearBottom = conversation.scrollHeight - top - conversation.clientHeight < 28;
      if (nearBottom || delta < -8) this.setComposerHidden(false);
      else if (delta > 10) this.setComposerHidden(true);
      lastTop = top;
    }, { passive: true });
    $("#stopButton").addEventListener("click", () => { this.activeRun?.cancel();this.lookupRun?.abort(); });
    $("#newChatBtn")?.addEventListener("click", () => this.go("chat", { fresh: true }));
  },

  async submitPrompt(text, attachments = []) {
    if (this.activeRun || this.lookupRun) { this.toast("A request is still running — your draft is kept."); return; }
    const attachmentError=Workspace.attachmentError(attachments);if(attachmentError){this.toast(attachmentError);return;}
    const parsed=RefParser.parse(text);if(parsed?.error){this.toast(parsed.error);return;}
    if (this.view !== "chat") this.go("chat");
    const s = this.session;
    if ($(".empty-state")) $("#feed").innerHTML = "";
    const userMsg = { role: "user", text, ts: Date.now(), attachments };
    s.messages.push(userMsg);
    if(!Store.sessions.some(item=>item.id===s.id))Store.sessions.unshift(s);
    if (!s.title) { s.title = text.slice(0, 48); this.renderRecents(); }
    s.updated = Date.now(); Store.persist();
    $("#feed").appendChild(this.renderMessage(userMsg));
    this.scrollFeed();

    /* Fast-path: pure direct reference → deterministic parser + provider, no model call */
    const ref = RefParser.parse(text);
    if (ref && !ref.error && ref.confidence >= 0.9 && !attachments.length) {
      await this.fastPassage(ref, text, s);
      return;
    }
    await this.agentTurn(text, attachments);
  },

  async fastPassage(ref, originalText, session = this.session) {
    this.lookupRun=new AbortController();document.body.classList.add("agent-running");
    if(!Settings.data.autoTranslation)ref.translation=session.translation||Settings.data.translation;
    if (!ref.translation) ref.translation = session.translation || Settings.data.translation;
    const msg = { role: "assistant", kind: "passage", ts: Date.now(), log: [{ text: `Deterministic parser resolved “${RefParser.format(ref)}” — retrieved directly, no model call needed`, ok: true }] };
    const row = document.createElement("div");
    row.className = "assistant-row";
    row.innerHTML = `<div class="assistant-avatar book"><svg><use href="#i-book"/></svg></div><div class="assistant-body"><div class="run-status"><span class="pulse"></span>Resolving reference…</div></div>`;
    $("#feed").appendChild(row); this.scrollFeed();
    try {
      const passage = await BibleProvider.getPassage(ref, "WEB", this.lookupRun.signal);
      msg.passage = passage;
      if(this.session===session)this.lastPassage = passage;
      session.lastPassage = passage;
      (session.directContext ||= []).push(`Retrieved ${passage.reference} (${passage.translation}): ${passage.verses.map(v=>v.text).join(" ")}`);
      session.contextNote = `The user just looked up ${passage.reference} (${passage.translation}) via direct lookup.`;
      session.messages.push(msg);
      row.replaceWith(this.renderMessage(msg));
    } catch (e) {
      msg.text = `I couldn't retrieve **${RefParser.format(ref)}** — ${esc(e.message)}. Check the reference or try another translation.`;
      session.messages.push(msg);
      row.replaceWith(this.renderMessage(msg));
    }
    this.lookupRun=null;document.body.classList.remove("agent-running");
    session.updated = Date.now(); Store.persist();
    if(this.session===session){this.renderChat();this.scrollFeed();}
  },

  async resumePendingRun() {
    const pending = this.session?.pendingRun;
    if (!pending || this.activeRun) return;
    this.go("chat");
    this.toast("Rejoining the study you left running…");
    await this.agentTurn(pending.userText || "Continue the pending request.", pending.attachments || [], pending);
  },

  async agentTurn(text, attachments = [], resumeState = null) {
    const s = this.session;
    const msg = { id:resumeState?.messageId||uid(),role: "assistant", text: resumeState?.text || "", ts: Date.now(), log: [], citations: resumeState?.citations || [], artifacts: resumeState?.artifacts || [] };
    const row = document.createElement("div");
    row.className = "assistant-row";
    row.innerHTML = `<div class="assistant-avatar"><svg><use href="#i-sparkles"/></svg></div>
      <div class="assistant-body">
        <div class="run-status"><span class="pulse"></span><span><strong class="status-text">Opening the study desk…</strong><small class="status-sub">The current model response can be recovered after reconnecting.</small></span></div>
        <div class="live-log"></div>
        <div class="result-card prose live-text" hidden></div>
        <div class="live-citations"></div>
      </div>`;
    $("#feed").appendChild(row); this.scrollFeed();
    const statusEl = $(".status-text", row), liveLog = $(".live-log", row), liveText = $(".live-text", row), liveCits = $(".live-citations", row);
    document.body.classList.add("agent-running");

    const contextNote = resumeState?.contextNote ?? s.contextNote;
    const run = new AgentRun({
      mode: s.mode, session: s, userText: text, contextNote, attachments, resumeState, messageId:msg.id,
      onEvent: (type, p) => {
        if (type === "status") statusEl.textContent = p;
        if (type === "token") {
          liveText.hidden = false;
          msg.text=run.text;
          if(!this._renderFrame)this._renderFrame=requestAnimationFrame(()=>{this._renderFrame=null;liveText.innerHTML=md(msg.text,run.citations);this.scrollFeed(false,true);});
          this.scrollFeed(false,true);
        }
        if (type === "replaceText") { liveText.hidden = false; liveText.innerHTML = md(msg.text = p); this.scrollFeed(); }
        if (type === "toolStart") { this.pushLog(msg, liveLog, { text: p.label, ok: true }); statusEl.textContent = p.label + "…"; }
        if (type === "toolDone" && !p.ok) this.pushLog(msg, liveLog, { text: `${p.label} — failed`, ok: false });
        if (type === "toolNote") this.pushLog(msg, liveLog, { text: p.text, ok: true });
        if (type === "passage") { if(this.session===s)this.lastPassage = p; s.lastPassage = p; (msg.passages ||= []).push(p); }
        if (type === "citation") {
          msg.citations = run.citations;
          liveCits.replaceChildren(this.renderCitationsStrip(run.citations));
        }
        if (type === "artifact") { if(!msg.artifacts.some(a=>a.id===p.id))msg.artifacts.push(p); this.pushLog(msg, liveLog, { text: `${p.format.toUpperCase()} ready for preview`, ok: true }); }
        if (type === "approval") this.showApproval(p, liveLog, msg);
      },
    });
    this.activeRun = run;
    try {
      await run.run();
      msg.text = run.text; msg.citations = run.citations; msg.usage = run.usage;
      if (run.citations.length) {
        s.citations = [...(s.citations || []), ...run.citations]
          .filter((c, i, all) => all.findIndex(x => x.url === c.url) === i);
        this.renderSourcesPanel();
      }
      /* Auto-save topical studies */
      if (/verses (about|on|for)/i.test(text) && msg.text) Store.addTopic({ title: text.slice(0, 60), summary: msg.text.slice(0, 400), sessionId: s.id });
      const previous=s.messages.findIndex(item=>item.id===msg.id);if(previous>=0)s.messages[previous]=msg;else s.messages.push(msg);s.updated=Date.now();
      if(!Store.persist())throw new Error("The answer is complete but could not be saved on this device. Export a backup now.");
      run.clearCheckpoint();s.contextNote=null;
      const followups = await generateSuggestedPrompts(msg.text, s.title, run.controller.signal).catch(() => ({ suggestions: [] }));
      msg.suggestions = followups.suggestions || [];
      if (followups.usage) {
        const u = { inputTokens: Number(followups.usage.input_tokens) || 0, cachedInputTokens: Number(followups.usage.input_tokens_details?.cached_tokens) || 0, outputTokens: Number(followups.usage.output_tokens) || 0, reasoningTokens: Number(followups.usage.output_tokens_details?.reasoning_tokens) || 0, totalTokens: Number(followups.usage.total_tokens) || 0 };
        Object.assign(u, estimateUsageCost(u, followups.model, Settings.data.usdZarRate));
        msg.usage.inputTokens += u.inputTokens; msg.usage.cachedInputTokens += u.cachedInputTokens; msg.usage.outputTokens += u.outputTokens; msg.usage.reasoningTokens += u.reasoningTokens; msg.usage.totalTokens += u.totalTokens; msg.usage.costUsd += u.costUsd || 0; msg.usage.costZar += u.costZar || 0;
      }
    } catch (e) {
      if (e.name === "AbortError") msg.text += (msg.text ? "\n\n" : "") + "*(stopped by user)*";
      else if (e.code === "no_key") { msg.text = "**No API key configured.** Open **Settings → AI Model** and paste your OpenAI API key to bring the agent online."; }
      else msg.text += (msg.text ? "\n\n" : "") + `**Something went wrong:** ${e.message}`;
    } finally {
      if (run.usage?.totalTokens) msg.usage = run.usage;
      this.activeRun = null;
      document.body.classList.remove("agent-running");
      const existing=s.messages.findIndex(item=>item.id&&item.id===msg.id);
      if(existing>=0)s.messages[existing]=msg;else if(!s.messages.includes(msg))s.messages.push(msg);
      if(s.pendingRun){s.pendingRun.status="failed";s.pendingRun.error=msg.text.slice(-500);}
      s.updated = Date.now(); Store.persist();
      row.replaceWith(this.renderMessage(msg));
      this.scrollFeed();
      this.renderRecents();
      this.renderModeBanner();
    }
  },

  pushLog(msg, liveLog, entry) {
    msg.log.push(entry);
    const div = document.createElement("div");
    div.className = "log-line live" + (entry.ok === false ? " err" : "");
    div.textContent = entry.text;
    liveLog.appendChild(div);
    this.scrollFeed();
  },

  showApproval(p, liveLog, msg) {
    const card = document.createElement("div");
    card.className = "approval-card";
    card.innerHTML = `<div><strong>Approval needed</strong><p>${esc(p.label)}</p></div>
      <div class="approval-actions"><button class="btn ghost" data-a="no">Deny</button><button class="btn primary" data-a="yes">Allow</button></div>`;
    liveLog.appendChild(card); this.scrollFeed();
    $$("button", card).forEach(b => b.addEventListener("click", () => {
      const ok = b.dataset.a === "yes";
      card.remove();
      this.pushLog(msg, liveLog, { text: (ok ? "Approved: " : "Denied: ") + p.label, ok });
      p.resolve(ok);
    }));
  },

  /* ===== Quick actions & right panel ===== */
  bindQuickActions() {
    $("#qaCopy").addEventListener("click", () => {
      const p = this.lastPassage;
      if (!p) return this.toast("Look up a verse first");
      this.copy(`${p.reference} (${p.translation})\n` + p.verses.map(v => `${v.verse} ${v.text}`).join("\n"), "Verse copied");
    });
    $("#qaCompare").addEventListener("click", () => {
      if (!this.lastPassage) return this.toast("Look up a verse first");
      this.compareVersions(this.lastPassage);
    });
    $("#qaContext").addEventListener("click", () => {
      if (!this.lastPassage) return this.toast("Look up a verse first");
      const ref = RefParser.parse(this.lastPassage.reference);
      this.submitPrompt(`${ref.book} ${ref.chapterStart}`);
    });
    $("#viewAllSources").addEventListener("click", () => this.openSourcesDialog());
  },

  async compareVersions(p) {
    const dlg = $("#compareDialog"), body = $("#compareBody");
    $("#compareTitle").textContent = `${p.reference} — compare versions`;
    body.innerHTML = `<div class="loading-row"><span class="pulse"></span>Fetching translations…</div>`;
    dlg.showModal();
    const ref = RefParser.parse(p.reference);
    const codes = ["CSB", "ESV", "KJV", "NIV"].filter(c => Translations.some(t => t.code === c));
    const rows = await Promise.all(codes.map(async code => {
      try {
        const r = { ...ref, translation: code };
        const pass = await BibleProvider.getPassage(r);
        return { code, actual:pass.translation, note:pass.fallbackNote, text: pass.verses.map(v => `${v.verse} ${v.text}`).join(" ") };
      } catch { return { code, text: "(unavailable)" }; }
    }));
    body.innerHTML = rows.map(r => `<div class="compare-row"><span class="badge">${r.code}${r.actual&&r.actual!==r.code?' → '+esc(r.actual):''}</span><div>${r.note?`<p class="fallback-note">${esc(r.note)}</p>`:''}<p>${esc(r.text)}</p></div></div>`).join("");
  },

  renderSourcesPanel() {
    const list = $("#sourceList"), badge = $("#sourceCount");
    const cits = this.session?.citations || [];
    badge.textContent = `${cits.length} source${cits.length === 1 ? "" : "s"}`;
    list.innerHTML = cits.length ? cits.slice(0, 5).map((c, i) =>
      `<a class="source-item in-app-link" href="${esc(safeHttpUrl(c.url))}" rel="noopener">
        <span class="source-number">${i + 1}</span>
        <span><p class="source-title">${esc(c.title || c.url)}</p><p class="source-meta">${esc(this.hostOf(c.url))}</p></span></a>`).join("")
      : `<p class="panel-empty">Run a research question and the sources actually used will appear here.</p>`;
  },
  openSourcesDialog() {
    const cits = this.session?.citations || [];
    $("#sourcesBody").innerHTML = cits.length ? cits.map((c, i) =>
      `<a class="source-item in-app-link" href="${esc(safeHttpUrl(c.url))}" rel="noopener"><span class="source-number">${i + 1}</span>
        <span><p class="source-title">${esc(c.title || c.url)}</p><p class="source-meta">${esc(c.url)}</p></span></a>`).join("")
      : `<p class="panel-empty">No sources in this conversation yet.</p>`;
    $("#sourcesDialog").showModal();
  },

  /* ===== Original Languages & Understand view ===== */
  bindOriginal() {
    const form = $("#origForm"), input = $("#origInput");
    form.addEventListener("submit", e => { e.preventDefault(); const v = input.value.trim(); if (v) this.loadOriginal(v); });
    $$(".orig-quick .chip").forEach(c => c.addEventListener("click", () => { input.value = c.dataset.ref; this.loadOriginal(c.dataset.ref); }));
  },

  async loadOriginal(refString) {
    const host = $("#origResult");
    const requestId=this.originalRequest=(this.originalRequest||0)+1;
    this.study.ref=null;this.study.selectedWord=null;$("#understandPanel").hidden=true;
    const ref = RefParser.parse(refString);
    if (!ref || ref.error) {
      host.innerHTML = `<div class="orig-error">${esc(ref?.error || `Couldn't parse “${refString}” — try a reference like “Genesis 1:1” or “John 3:16-17”.`)}</div>`;
      return;
    }
    if (ref.verseStart == null) { ref.verseStart = 1; ref.verseEnd = Math.min(6, 176); ref.wholeChapter = true; }
    if ((ref.verseEnd ?? ref.verseStart) - ref.verseStart > 9) { ref.verseEnd = ref.verseStart + 9; this.toast("Showing the first 10 verses of that range"); }
    host.innerHTML = `<div class="loading-row"><span class="pulse"></span>Fetching manuscript text…</div>`;
    try {
      const data = await OriginalProvider.getInterlinear(ref);
      if(requestId!==this.originalRequest)return;
      this.study.ref = ref; this.study.data = data; this.study.selectedWord = null;
      this.renderInterlinear();
      this.renderUnderstand();
    } catch (e) {
      if(requestId!==this.originalRequest)return;
      host.innerHTML = `<div class="orig-error">Couldn't load the original text — ${esc(e.message)}</div>`;
    }
  },

  renderInterlinear() {
    const host = $("#origResult"), d = this.study.data;
    const rtl = d.source.dir === "rtl";
    const badge = { hebrew: "עברית", aramaic: "ארמית", mixed: "עברית · ארמית", greek: "Ἑλληνικά" }[d.source.lang] || d.source.langName;
    const langAttr = { hebrew: "he", aramaic: "arc", mixed: "he", greek: "grc" }[d.source.lang] || "he";
    const versePill = v =>
      v.aramaic === true ? `<span class="verse-lang-pill">Aramaic</span>` :
      v.aramaic === "partial" ? `<span class="verse-lang-pill partial">contains Aramaic</span>` :
      d.source.lang === "mixed" ? `<span class="verse-lang-pill hebrew">Hebrew</span>` : "";
    host.innerHTML = `
      <div class="orig-header">
        <div>
          <h2>${esc(d.reference)}${this.study.ref.wholeChapter ? " <small>(first verses)</small>" : ""}</h2>
          <p>${esc(d.source.langName)} · ${esc(d.source.name)}</p>
        </div>
        <span class="lang-badge ${d.source.lang}">${badge}</span>
      </div>
      ${d.alignmentWarning ? `<p class="fallback-note" role="status">${esc(d.alignmentWarning)}</p>` : ""}
      ${d.verses.map(v => `
        <div class="orig-verse-card" data-verse="${v.verse}">
          <div class="orig-verse-no">${d.chapter}:${v.verse} ${versePill(v)}</div>
          <p class="orig-text ${rtl ? "hebrew" : "greek"}" dir="${d.source.dir}" lang="${v.aramaic === true ? "arc" : langAttr}">${esc(v.original)}</p>
          <div class="word-row" role="list" aria-label="Word-by-word with Strong's numbers">
            ${v.words.flatMap((w,i)=>w.strongs.length?w.strongs.map(code=>({...w,strongs:[code],sourceIndex:i})):[{...w,sourceIndex:i}]).map((w, i) => w.strongs.length
              ? `<button class="word-chip${w.untranslated ? " faded" : ""}" data-verse="${v.verse}" data-i="${w.sourceIndex}" data-strongs="${w.strongs[0]}" title="${w.strongs.join(", ")}"><span>${esc(w.text)}</span><small>${w.strongs.join(" ")}</small></button>`
              : `<span class="word-chip plain"><span>${esc(w.text)}</span></span>`).join("")}
          </div>
          <div class="lexicon-slot" data-verse="${v.verse}"></div>
        </div>`).join("")}
      <p class="attribution">${esc(d.attribution)}</p>`;
    $$(".word-chip[data-strongs]", host).forEach(chip => chip.addEventListener("click", () => this.openLexicon(chip)));
  },

  async openLexicon(chip) {
    const strongs = chip.dataset.strongs, verse = chip.dataset.verse;
    const d = this.study.data;
    const word = d.verses.find(v => String(v.verse) === verse)?.words[+chip.dataset.i];
    $$(".word-chip.selected").forEach(c => c.classList.remove("selected"));
    chip.classList.add("selected");
    const slot = $(`.lexicon-slot[data-verse="${verse}"]`);
    // toggle off if same word tapped again
    if (slot.dataset.open === strongs) { slot.innerHTML = ""; slot.dataset.open = ""; chip.classList.remove("selected"); this.study.selectedWord = null; this.renderUnderstand(); return; }
    $$(".lexicon-slot").forEach(s => { s.innerHTML = ""; s.dataset.open = ""; });
    slot.dataset.open = strongs;
    slot.innerHTML = `<div class="lexicon-card"><div class="loading-row"><span class="pulse"></span>Opening lexicon…</div></div>`;
    try {
      const requestId=this.lexiconRequest=(this.lexiconRequest||0)+1;
      const lex = await OriginalProvider.getLexicon(strongs);
      if(requestId!==this.lexiconRequest||this.study.data!==d||slot.dataset.open!==strongs)return;
      this.study.selectedWord = { verse:Number(verse),text: word?.text || "", strongs, lexeme: lex.lexeme, translit: lex.transliteration };
      slot.innerHTML = `
        <div class="lexicon-card">
          <div class="lex-head">
            <span class="lex-lexeme ${d.source.lang}" dir="${d.source.dir}">${esc(lex.lexeme)}</span>
            <span class="lex-meta"><em>${esc(lex.transliteration)}</em>${lex.pronunciation ? " · " + esc(lex.pronunciation) : ""}</span>
            <span class="badge">${esc(lex.strongs)}</span>
          </div>
          ${lex.short ? `<p class="lex-short">${esc(lex.short)}</p>` : ""}
          <div class="lex-def">${lex.definitionHtml}</div>
          <div class="lex-actions">
            <button class="btn primary small" data-wordstudy>✦ AI word study</button>
            <button class="btn ghost small" data-copylex>Copy entry</button>
          </div>
        </div>`;
      $("[data-wordstudy]", slot).addEventListener("click", () => this.runAnalysis("word", STUDY_LEVELS.word.cards[0]));
      $("[data-copylex]", slot).addEventListener("click", () => this.copy(`${lex.lexeme} (${lex.strongs}) ${lex.transliteration}\n${lex.short}\n\n${lex.definitionText}`, "Lexicon entry copied"));
      this.renderUnderstand();
    } catch (e) {
      slot.innerHTML = `<div class="lexicon-card"><p class="orig-error">${esc(e.message)}</p></div>`;
    }
  },

  renderUnderstand() {
    const panel = $("#understandPanel");
    const ref = this.study.ref;
    if (!ref) { panel.hidden = true; return; }
    panel.hidden = false;
    const level = this.study.level;
    const refCtx = {
      book: ref.book, chapter: ref.chapterStart,
      ref: RefParser.format({ ...ref, verseEnd: ref.wholeChapter ? ref.verseStart : ref.verseEnd }),
    };
    if (ref.wholeChapter) refCtx.ref = `${ref.book} ${ref.chapterStart}:1`;
    const scopeLabel = {
      book: `the book of ${ref.book}`,
      chapter: `${ref.book} ${ref.chapterStart}`,
      verse: refCtx.ref,
      word: this.study.selectedWord ? `${this.study.selectedWord.text} (${this.study.selectedWord.strongs})` : null,
    };
    panel.innerHTML = `
      <div class="understand-head">
        <h2 class="right-section-title" style="margin:0"><svg><use href="#i-cap"/></svg>Understand</h2>
        <div class="seg-group level-tabs">
          ${Object.entries(STUDY_LEVELS).map(([k, l]) => `<button class="seg ${level === k ? "active" : ""}" data-level="${k}">${l.label}</button>`).join("")}
        </div>
      </div>
      <p class="understand-scope">${scopeLabel[level]
        ? `Analysing <strong>${esc(scopeLabel[level])}</strong> — each study runs the agent in deep-study mode with manuscript &amp; lexicon tools.`
        : `Tap a <strong>word</strong> in the interlinear above to unlock word-level studies.`}</p>
      <div class="analysis-grid">
        ${STUDY_LEVELS[level].cards.map((c, i) => `
          <button class="analysis-card" data-card="${i}" ${level === "word" && !this.study.selectedWord ? "disabled" : ""}>
            <svg><use href="#${c.icon}"/></svg>
            <strong>${esc(c.title)}</strong><small>${esc(c.desc)}</small>
          </button>`).join("")}
      </div>`;
    $$(".level-tabs .seg", panel).forEach(b => b.addEventListener("click", () => { this.study.level = b.dataset.level; this.renderUnderstand(); }));
    $$(".analysis-card", panel).forEach(b => b.addEventListener("click", () => this.runAnalysis(this.study.level, STUDY_LEVELS[this.study.level].cards[+b.dataset.card])));
  },

  runAnalysis(level, card) {
    const ref = this.study.ref;
    if (!ref) return this.toast("Load a passage first");
    if (level === "word" && !this.study.selectedWord) return this.toast("Tap a word in the interlinear first");
    const refCtx = { book: ref.book, chapter: ref.chapterStart, ref: RefParser.format(ref) };
    if (ref.wholeChapter) refCtx.ref = `${ref.book} ${ref.chapterStart}:1`;
    if(level==="word"&&this.study.selectedWord?.verse)refCtx.ref=`${ref.book} ${ref.chapterStart}:${this.study.selectedWord.verse}`;
    const prompt = card.prompt(refCtx, this.study.selectedWord || {});
    this.session = Store.newSession("study");
    this.go("chat");
    this.toast(`${STUDY_LEVELS[level].label}-level study: ${card.title}`);
    this.submitPrompt(prompt);
  },

  /* ===== Files, camera & Library ===== */
  bindFiles() {
    const fileInput = $("#fileInput"), imageInput = $("#imageInput");
    fileInput?.addEventListener("change", async () => { await this.uploadFiles(fileInput.files, this.view!=="library"); fileInput.value = ""; });
    imageInput?.addEventListener("change", async () => { await this.uploadFiles(imageInput.files,true); imageInput.value = ""; });
    $("#libraryUpload")?.addEventListener("click", () => fileInput?.click());
    $$('[data-attach]').forEach(button => button.addEventListener("click", () => {
      const type = button.dataset.attach;
      this.closeSheets();
      if (type === "files") fileInput?.click();
      if (type === "photos") imageInput?.click();
      if (type === "camera") this.openCamera();
    }));
    $("#capturePhoto")?.addEventListener("click", () => this.captureCamera());
    $("#flipCamera")?.addEventListener("click", () => { this.cameraFacing = this.cameraFacing === "environment" ? "user" : "environment"; this.openCamera(true); });
    $$('[data-close-camera]').forEach(button => button.addEventListener("click", () => this.closeCamera()));
  },

  async uploadFiles(fileList, attach = true) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    for (const file of files) {
      if (file.size > 25_000_000) { this.toast(`${file.name} is larger than 25 MB`); continue; }
      this.toast(`Uploading ${file.name}…`);
      const form = new FormData(); form.append("file", file, file.name);
      try {
        const response = await fetch("/api/files", { method: "POST", body: form, credentials: "same-origin" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Upload failed (${response.status})`);
        if(attach)this.pendingAttachments.push(result.file);
        this.library.unshift(result.file);
      } catch (error) { this.toast(error.message); }
    }
    this.renderAttachmentTray();
    if (this.view === "library") this.renderLibrary(false);
  },

  renderAttachmentTray() {
    const tray = $("#attachmentTray");
    if (!tray) return;
    tray.hidden = !this.pendingAttachments.length;
    tray.innerHTML = this.pendingAttachments.map(file => `<div class="attachment-chip" data-id="${esc(file.id)}"><svg><use href="#${String(file.mimeType).startsWith("image/") ? "i-image" : "i-file"}"/></svg><span>${esc(file.name)}</span><button type="button" aria-label="Remove ${esc(file.name)}">×</button></div>`).join("");
    $$(".attachment-chip button", tray).forEach(button => button.addEventListener("click", () => {
      const id = button.closest(".attachment-chip").dataset.id;
      this.pendingAttachments = this.pendingAttachments.filter(file => file.id !== id); this.renderAttachmentTray();
    }));
  },

  async renderLibrary(load = true) {
    const grid = $("#libraryGrid");
    if (!grid) return;
    if (load) {
      grid.innerHTML = `<div class="loading-row"><span class="pulse"></span>Opening your Library…</div>`;
      try {
        this.library = await this.allLibraryFiles();
      } catch (error) { grid.innerHTML = `<div class="view-empty"><h3>Library unavailable</h3><p>${esc(error.message)}</p></div>`; return; }
    }
    $$("#libraryFilters .seg").forEach(button => {
      button.classList.toggle("active", button.dataset.filter === this.libraryFilter);
      button.onclick = () => { this.libraryFilter = button.dataset.filter; this.renderLibrary(false); };
    });
    const files = this.libraryFilter === "all" ? this.library : this.library.filter(file => file.kind === this.libraryFilter);
    grid.innerHTML = files.length ? files.map(file => {
      const image = String(file.mimeType).startsWith("image/");
      return `<article class="library-item" data-id="${esc(file.id)}"><button class="library-preview" data-preview>${image ? `<img src="${esc(file.url)}" alt="" loading="lazy">` : `<span class="file-glyph"><svg><use href="#${file.kind === "created" ? "i-image" : "i-file"}"/></svg><b>${esc(String(file.format || "file").toUpperCase())}</b></span>`}</button><div><span class="library-kind">${file.kind === "created" ? "Created" : "Uploaded"}</span><h3>${esc(file.metadata?.title || file.name)}</h3><p>${this.formatBytes(file.size)} · ${dateStr(file.createdAt)}</p></div><div class="library-actions"><button class="btn small" data-preview>Preview</button><a class="btn small" href="${esc(file.url)}?download=1" download>Download</a><button class="btn ghost small danger" data-delete>Delete</button></div></article>`;
    }).join("") : `<div class="view-empty"><svg><use href="#i-file"/></svg><h3>Your Library is ready</h3><p>Attach a photo or file in chat, or ask Bible AI to create a visual, article or PDF.</p><button class="btn primary" id="emptyLibraryUpload">Add a file</button></div>`;
    $("#emptyLibraryUpload")?.addEventListener("click", () => $("#fileInput")?.click());
    $$(".library-item", grid).forEach(card => {
      const file = files.find(item => item.id === card.dataset.id);
      $$('[data-preview]', card).forEach(button => button.addEventListener("click", () => file.kind === "created" ? this.previewArtifact(file) : this.previewFile(file)));
      $('[data-delete]', card)?.addEventListener("click", () => this.deleteLibraryFile(file));
    });
  },

  formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  },

  async deleteLibraryFile(file) {
    if (!file || !confirm(`Delete “${file.metadata?.title || file.name}” from your Library?`)) return;
    const response = await fetch(`/api/files/${encodeURIComponent(file.id)}`, { method: "DELETE", credentials: "same-origin" });
    if (!response.ok) return this.toast("Could not delete that file");
    this.library = this.library.filter(item => item.id !== file.id); this.renderLibrary(false); this.toast("File deleted");
  },

  async openCamera(restart = false) {
    const generation=this.cameraGeneration=(this.cameraGeneration||0)+1;
    if (!navigator.mediaDevices?.getUserMedia) { $("#imageInput")?.setAttribute("capture", "environment"); $("#imageInput")?.click(); return; }
    if (restart) this.stopCameraStream();
    this.openSheet("cameraSheet");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: this.cameraFacing } }, audio: false });
      if(this.cameraGeneration!==generation||!$("#cameraSheet").classList.contains("open")){stream.getTracks().forEach(t=>t.stop());return;}
      this.cameraStream=stream;
      $("#cameraVideo").srcObject = this.cameraStream;
    } catch { this.closeCamera(); this.toast("Camera access was blocked. Choose a photo instead."); }
  },

  stopCameraStream() { this.cameraStream?.getTracks().forEach(track => track.stop()); this.cameraStream = null; },
  closeCamera() { this.cameraGeneration=(this.cameraGeneration||0)+1;this.stopCameraStream(); this.closeSheets(); },
  captureCamera() {
    const video = $("#cameraVideo");
    if (!video?.videoWidth) return this.toast("Camera is still starting");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob(async blob => {
      if (!blob) return;
      const file = new File([blob], `bible-ai-photo-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`, { type: "image/jpeg" });
      this.closeCamera(); await this.uploadFiles([file]);
    }, "image/jpeg", .9);
  },

  /* ===== Bottom sheets, previews & in-app browser ===== */
  bindViewers() {
    $("#sheetScrim")?.addEventListener("click", () => { this.stopCameraStream(); this.closeSheets(); });
    $$('[data-close-sheet]').forEach(button => button.addEventListener("click", () => this.closeSheets()));
    $$('[data-close-browser]').forEach(button => button.addEventListener("click", () => this.closeSheets()));
    $$('[data-close-artifact]').forEach(button => button.addEventListener("click", () => this.closeSheets()));
    $("#browserFrame")?.addEventListener("load", () => $("#browserProgress")?.classList.add("done"));
    $("#openExternal")?.addEventListener("click", () => { if (this.currentBrowserUrl) window.open(this.currentBrowserUrl, "_blank", "noopener"); });
    document.addEventListener("click", event => {
      const link = event.target.closest?.("a.in-app-link");
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const url = safeHttpUrl(link.href); if (url === "#") return;
      event.preventDefault(); this.openBrowser(url, link.textContent.trim());
    });
  },
  openSheet(id) {
    const sheet=document.getElementById(id);if(!sheet)return;
    $$('dialog[open]').forEach(d=>d.close());
    this.closeSheets(false);this.sheetReturnFocus=document.activeElement;
    sheet.setAttribute('role','dialog');sheet.setAttribute('aria-modal','true');sheet.setAttribute('aria-hidden','false');
    $('#sheetScrim').hidden=false;$('#sheetScrim').classList.add('open');sheet.classList.add('open');
    $('#appShell').inert=true;$('#attachButton').setAttribute('aria-expanded',String(id==='attachSheet'));
    sheet.querySelector('button,a[href]')?.focus();
  },
  closeSheets(restoreFocus=true) {
    $$('.bottom-sheet.open').forEach(sheet=>{sheet.classList.remove('open');sheet.setAttribute('aria-hidden','true');});
    $('#sheetScrim').classList.remove('open');$('#sheetScrim').hidden=true;$('#appShell').inert=false;
    $('#attachButton').setAttribute('aria-expanded','false');
    if($('#browserFrame'))$('#browserFrame').src='about:blank';if($('#artifactFrame'))$('#artifactFrame').src='about:blank';
    clearTimeout(this.browserTimeout);if(restoreFocus&&this.sheetReturnFocus?.isConnected)this.sheetReturnFocus.focus();
  },
  openBrowser(url, title = "Source") {
    url=safeHttpUrl(url);if(url==="#")return;
    this.currentBrowserUrl = url;
    $("#browserTitle").textContent = title || "Source"; $("#browserHost").textContent = this.hostOf(url);
    $("#browserHint").textContent="Some publishers block embedded previews. Open externally if the page stays blank.";
    clearTimeout(this.browserTimeout);this.browserTimeout=setTimeout(()=>{$("#browserHint").textContent="Preview may be unavailable. Open this source externally.";$("#browserProgress").classList.add("done");},10000);
    $("#browserProgress").classList.remove("done"); $("#browserFrame").src = url; this.openSheet("browserSheet");
  },
  previewFile(file) { if (file) this.previewArtifact(file); },
  previewArtifact(file) {
    if (!file) return;
    $("#artifactTitle").textContent = file.metadata?.title || file.name;
    $("#artifactMeta").textContent = `${String(file.format || "file").toUpperCase()} · ${this.formatBytes(file.size)}`;
    $("#artifactDownload").href = `${file.url}?download=1`; $("#artifactDownload").download = file.name;
    $("#artifactFrame").src = file.url; this.openSheet("artifactSheet");
  },

  /* ===== Text selection as context ===== */
  bindSelectionActions() {
    const inspect = () => setTimeout(() => {
      const selection = getSelection(); const text = selection?.toString().trim();
      const anchor = selection?.anchorNode?.parentElement;
      if (!text || text.length < 3 || !anchor?.closest(".assistant-body, .passage-card")) return;
      this.selectedContext = text.slice(0, 1400);
      $("#selectionQuote").textContent = `“${this.selectedContext.slice(0, 72)}${this.selectedContext.length > 72 ? "…" : ""}”`;
      $("#selectionActions").hidden = false;
    }, 80);
    document.addEventListener("pointerup", inspect);
    document.addEventListener("touchend", inspect, { passive: true });
    $$('[data-selection]').forEach(button => button.addEventListener("click", () => {
      const action = button.dataset.selection; const selected = this.selectedContext; $("#selectionActions").hidden = true;
      if (!selected || action === "close") return;
      this.session.contextNote = `The user selected this text from the current answer and wants it treated as quoted context: “${selected}”`;
      if (action === "ask") { const input = $("#composerInput"); input.value = "About the selected text: "; input.focus(); input.dispatchEvent(new Event("input")); }
      if (action === "more") this.submitPrompt("Tell me more about the selected text in its immediate argument and the wider biblical context.");
    }));
  },

  /* ===== Topics view ===== */
  renderTopics() {
    const grid = $("#topicsGrid");
    grid.innerHTML = Store.topics.length ? Store.topics.map(t => `
      <div class="topic-card" data-id="${t.id}">
        <h3>${esc(t.title)}</h3>
        <p>${esc(t.summary.replace(/[#*`>-]/g, "").slice(0, 140))}…</p>
        <div class="topic-foot"><span>${dateStr(t.created)}</span><button class="btn ghost small" data-open>Open study</button></div>
      </div>`).join("")
      : `<div class="view-empty"><svg><use href="#i-grid"/></svg><h3>No saved topics yet</h3><p>Ask for “verses about …” in chat and finished topical studies are saved here automatically.</p><button class="btn primary" id="topicsTry">Try a topical search</button></div>`;
    $("#topicsTry")?.addEventListener("click", () => { this.go("chat"); this.submitPrompt("Verses about courage in the face of fear"); });
    $$(".topic-card [data-open]", grid).forEach(b => b.addEventListener("click", () => {
      const t = Store.topics.find(x => x.id === b.closest(".topic-card").dataset.id);
      const sess = Store.sessions.find(x => x.id === t.sessionId);
      if (sess) this.openSession(sess.id); else this.toast("Original conversation was deleted");
    }));
  },

  /* ===== History view ===== */
  renderHistory() {
    const list = $("#historyList");
    $("#restoreTrash")?.remove();
    if(Store.trash?.length){const button=document.createElement("button");button.id="restoreTrash";button.className="btn";button.textContent=`Restore last deleted conversation (${Store.trash.length} in Trash)`;button.onclick=()=>{const session=Store.trash.pop();delete Store.deletedSessions[session.id];session.updated=Date.now();Store.sessions.unshift(session);Store.persist();this.renderHistory();this.renderRecents();};list.before(button);}
    const sessions = Store.sessions.filter(s => s.messages.length);
    list.innerHTML = sessions.length ? sessions.map(s => `
      <div class="history-card" data-id="${s.id}">
        <div class="history-main">
          <span class="history-mode ${s.mode}">${s.mode === "research" ? "Research" : s.mode === "study" ? "Study" : "Chat"}</span>
          <div><h3>${esc(s.title || "Untitled conversation")}</h3>
          <p>${s.messages.length} messages · ${s.citations?.length || 0} sources · ${formatTokens(this.usageForSession(s).totalTokens)} tokens · ${this.usageForSession(s).priced ? formatZar(this.usageForSession(s).costZar) : "partly unpriced"} · ${dateStr(s.updated)}</p></div>
        </div>
        <span><button class="btn ghost small" data-open>Open</button><button class="btn ghost small danger" data-del>Delete</button></span>
      </div>`).join("")
      : `<div class="view-empty"><svg><use href="#i-history"/></svg><h3>No history yet</h3><p>Every conversation is saved here automatically, including its sources and agent actions.</p></div>`;
    $$(".history-card", list).forEach(card => {
      $("[data-open]", card).addEventListener("click", () => this.openSession(card.dataset.id));
      $("[data-del]", card).addEventListener("click", () => {
        if(!confirm("Move this conversation to Trash? You can restore it from History."))return;
        const deleted=Store.sessions.find(s=>s.id===card.dataset.id);
        (Store.trash ||= []).push(deleted);Store.deletedSessions[card.dataset.id]=Date.now();
        Store.sessions = Store.sessions.filter(s => s.id !== card.dataset.id); Store.persist();
        if (this.session.id === card.dataset.id) this.session = Store.newSession("chat");
        this.renderHistory(); this.renderRecents(); this.toast("Conversation deleted");
      });
    });
  },

  /* ===== Settings view ===== */
  renderSettings() {
    const s = Settings.data;
    /* model cards */
    const grid = $("#modelGrid");
    grid.innerHTML = MODELS.map(m => `
      <button class="model-card ${s.model === m.id && !s.customModel ? "active" : ""}" data-id="${m.id}">
        <svg><use href="#${m.icon}"/></svg>
        <strong>${m.name}</strong><small>${m.blurb}</small>
      </button>`).join("");
    $$(".model-card", grid).forEach(c => c.addEventListener("click", () => {
      s.model = c.dataset.id; s.customModel = ""; $("#customModel").value = "";
      Settings.save(); this.renderSettings();
    }));
    /* reasoning */
    const model = MODELS.find(m => m.id === s.model) || MODELS[1];
    const efforts = ["none","low","medium","high","xhigh","max"].filter(e => model.efforts.includes(e) || s.customModel);
    if (!efforts.includes(s.reasoning)) { s.reasoning = model.efforts.includes("medium") ? "medium" : model.efforts[0]; }
    $("#reasoningSeg").innerHTML = efforts.map(e =>
      `<button class="seg ${s.reasoning === e ? "active" : ""}" aria-pressed="${s.reasoning===e}" data-v="${e}">${e === "xhigh" ? "x-high" : e}</button>`).join("");
    $$("#reasoningSeg .seg").forEach(b => b.addEventListener("click", () => { s.reasoning = b.dataset.v; Settings.save(); this.renderSettings(); }));
    $("#verbositySeg").innerHTML = ["low","medium","high"].map(v =>
      `<button class="seg ${s.verbosity === v ? "active" : ""}" aria-pressed="${s.verbosity===v}" data-v="${v}">${v}</button>`).join("");
    $$("#verbositySeg .seg").forEach(b => b.addEventListener("click", () => { s.verbosity = b.dataset.v; Settings.save(); this.renderSettings(); }));

    /* api key */
    const keyInput = $("#apiKeyInput");
    keyInput.value = s.apiKey;
    $("#apiKeyStatus").innerHTML = s.apiKey ? `<span class="status-dot ok"></span>Key saved on this device · cloud status is shown below` : `<span class="status-dot"></span>No key — the agent is offline`;
    $("#apiKeyForm").onsubmit = e => {
      e.preventDefault();
      s.apiKey = keyInput.value.trim(); Settings.save();
      this.toast(s.apiKey ? "API key saved" : "API key cleared"); this.renderSettings();
    };
    $("#toggleKeyBtn").onclick = e => {
      const reveal = keyInput.type === "password";
      keyInput.type = reveal ? "text" : "password";
      e.currentTarget.textContent = reveal ? "Hide" : "Show";
      e.currentTarget.setAttribute("aria-pressed", String(reveal));
    };
    $("#customModel").value = s.customModel;
    $("#customModel").onchange = e => { s.customModel = e.target.value.trim(); Settings.save(); this.renderSettings(); };

    /* harness */
    $("#maxRounds").value = s.maxToolRounds;
    $("#maxRounds").onchange = e => { s.maxToolRounds = Math.max(1, Math.min(20, +e.target.value || 8)); Settings.save(); };
    const toolMeta = [
      ["scripture", "Scripture provider", "get_passage — exact verse retrieval (bolls.life)"],
      ["bibleSearch", "Bible text search", "search_bible_text — topical full-text search inside the Bible"],
      ["originals", "Original languages", "get_original_text / get_strongs_lexicon — Hebrew & Greek manuscripts + BDB/Thayer lexicon"],
      ["webSearch", "Open web research", "Search any public source, then check its standpoint and claims"],
      ["artifacts", "Artifact creation", "create_artifact — HTML, React-style visuals, articles and PDFs saved to Library"],
      ["fetchPage", "Page reader", "fetch_page — deep-read a source page via r.jina.ai proxy (approval-gated)"],
    ];
    $("#toolToggles").innerHTML = toolMeta.map(([k, name, desc]) => `
      <label class="toggle-row"><span><strong>${name}</strong><small>${desc}</small></span>
        <input type="checkbox" data-k="${k}" ${s.tools[k] ? "checked" : ""}><span class="switch"></span></label>`).join("");
    $$("#toolToggles input").forEach(i => i.addEventListener("change", () => { s.tools[i.dataset.k] = i.checked; Settings.save(); }));

    /* bible & app */
    $("#defaultTranslation").innerHTML = Translations.map(t => `<option value="${t.code}" ${s.translation === t.code ? "selected" : ""}>${t.code} — ${esc(t.name)}</option>`).join("");
    $("#defaultTranslation").onchange = e => { s.translation = e.target.value; this.session.translation=s.translation;Store.persist(); Settings.save(); $("#currentVersion").textContent = s.translation; this.markVersionMenu(); };
    $("#autoTranslation").checked = s.autoTranslation;
    $("#autoTranslation").onchange = e => { s.autoTranslation = e.target.checked; Settings.save(); this.markVersionMenu(); };
    $("#themeSeg").innerHTML = ["auto","light","dark"].map(t => `<button class="seg ${s.theme === t ? "active" : ""}" aria-pressed="${s.theme===t}" data-v="${t}">${t}</button>`).join("");
    $$("#themeSeg .seg").forEach(b => b.addEventListener("click", () => { s.theme = b.dataset.v; Settings.save(); this.applyTheme(); this.renderSettings(); }));

    $("#paletteGrid").innerHTML = PALETTES.map(p => `
      <button class="palette-option ${s.palette === p.id ? "active" : ""}" data-palette="${p.id}" aria-pressed="${s.palette === p.id}">
        <span class="palette-swatches"><i style="--swatch:${p.colors[0]}"></i><i style="--swatch:${p.colors[1]}"></i></span>
        <span>${p.name}</span>
      </button>`).join("");
    $$("#paletteGrid .palette-option").forEach(b => b.addEventListener("click", () => {
      s.palette = b.dataset.palette; Settings.save(); this.applyTheme(); this.renderSettings();
    }));
    this.renderUsageSettings();
    this.updateSyncStatus(CloudSync.status);

    $("#exportBtn").onclick = () => this.exportBackup();
    $("#exportJsonBtn")?.addEventListener("click",()=>this.exportWorkspaceJson());
    $("#importBtn")?.addEventListener("click",()=>$("#backupInput").click());
    $("#backupInput").onchange=e=>this.importBackup(e.target.files[0]);
    /* Legacy workspace-only export */
    this.exportWorkspaceJson = () => {
      const blob = new Blob([JSON.stringify({ settings: { ...s, apiKey: "(redacted)" }, sessions: Store.sessions, topics: Store.topics, legacyNotes: Store.notes }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "bible-ai-export.json"; a.click();
      this.toast("Exported all data");
    };
    $("#wipeBtn").onclick = async () => {
      if (!confirm("Delete all conversations, files, topics and settings (including your API key)? This cannot be undone.")) return;
      try {
        clearTimeout(CloudSync.timer);CloudSync.disabled=true;
        const response=await fetch("/api/files",{method:"DELETE",credentials:"same-origin",signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw new Error("Some cloud files could not be deleted. Your local workspace has been kept.");
        await CloudSync.clearRemote();
      }
      catch (error) { CloudSync.disabled=false;CloudSync.schedule();this.toast(error.message); return; }
      [Workspace.SNAPSHOT_KEY,Settings.KEY, "bibleai.sessions.v1", "bibleai.notes.v1", "bibleai.topics.v1", "bibleai.welcomeDismissed.v1", "bibleai.localUpdated.v1"]
        .forEach(key => localStorage.removeItem(key));
      location.reload();
    };
  },

  renderUsageSettings() {
    const host = $("#usageSummary");
    if (!host) return;
    const current = this.usageForSession(this.session);
    const all = this.usageAcrossChats();
    const card = (label, u) => {
      const answer = Math.max(0, u.outputTokens - u.reasoningTokens);
      return `<div class="usage-card"><span>${label}</span><strong>${u.priced ? formatZar(u.costZar) : "Partly unpriced"}</strong>
        <div><small>${formatTokens(u.inputTokens)} input</small><small>${formatTokens(answer)} answer</small><small>${formatTokens(u.reasoningTokens)} reasoning</small><small>${formatTokens(u.totalTokens)} total</small></div></div>`;
    };
    host.innerHTML = card("This chat", current) + card("All chats", all);
    $("#fxRateText").textContent = `USD 1 = ZAR ${Number(Settings.data.usdZarRate).toFixed(4)} · ${Settings.data.usdZarDate || "saved rate"}`;
    $("#refreshRateBtn").onclick = () => this.refreshFxRate(true);
  },

  async refreshFxRate(force = false) {
    if (!force && Settings.data.usdZarDate === new Date().toISOString().slice(0, 10)) return;
    const button = $("#refreshRateBtn");
    if (button) { button.disabled = true; button.textContent = "Refreshing…"; }
    try {
      const response = await fetch("/api/fx", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Exchange-rate service unavailable.");
      const data = await response.json();
      if (!Number.isFinite(Number(data.rate)) || Number(data.rate) <= 0) throw new Error("Invalid exchange rate.");
      Settings.data.usdZarRate = Number(data.rate);
      Settings.data.usdZarDate = data.date || new Date().toISOString().slice(0, 10);
      Settings.save();
      if (this.view === "settings") this.renderUsageSettings();
      this.toast("ZAR exchange rate refreshed");
    } catch (error) {
      if (force) this.toast(`${error.message} Using the saved rate.`);
    } finally {
      if (button && document.contains(button)) { button.disabled = false; button.textContent = "Refresh rate"; }
    }
  },

  updateSyncStatus(status, detail = "") {
    const el = $("#syncStatus");
    if (!el) return;
    const labels = { synced: "Synced across devices", syncing: "Syncing…", pending: "Waiting to sync", local: "Using device copy" };
    el.className = `sync-status ${status || "local"}`;
    el.innerHTML = `<span class="status-dot ${status === "synced" ? "ok" : ""}"></span><span><strong>${labels[status] || labels.local}</strong>${detail ? `<small>${esc(detail)}</small>` : ""}</span>`;
  },

  /* ===== Welcome ===== */
  showWelcome() {
    $("#welcomeDialog").showModal();
    const dismiss = () => localStorage.setItem("bibleai.welcomeDismissed.v1", "1");
    $("#welcomeSettings").addEventListener("click", () => { dismiss(); $("#welcomeDialog").close(); this.go("settings"); });
    $("#welcomeSkip").addEventListener("click", () => { dismiss(); $("#welcomeDialog").close(); });
  },

  async allLibraryFiles() {
    const files=[];let cursor=null;
    do{const response=await fetch('/api/files'+(cursor!==null?'?cursor='+cursor:''),{credentials:'same-origin',signal:AbortSignal.timeout(15000)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Library unavailable');files.push(...data.files);cursor=data.nextCursor??null;}while(cursor!==null);
    return files;
  },
  storageWarning(){
    let warning=$('#storageWarning');if(!warning){warning=document.createElement('div');warning.id='storageWarning';warning.role='alert';warning.innerHTML='Device storage is full or blocked. Work is still in memory. <button type="button">Export a backup</button>';warning.querySelector('button').onclick=()=>this.exportBackup();document.body.append(warning);}
  },
  downloadBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);},
  async exportBackup(){
    try{
      this.toast('Preparing backup with your Library files…');
      const files=await this.allLibraryFiles();if(files.reduce((n,f)=>n+f.size,0)>250_000_000)throw new Error('This Library exceeds the 250 MB browser backup limit. Download files in batches before deleting data.');
      const archive={};
      for(const file of files){const response=await fetch(file.url,{credentials:'same-origin',signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Backup stopped: a file could not be read.');archive['files/'+file.id]=new Uint8Array(await response.arrayBuffer());}
      const state={...CloudSync.snapshot(),settings:{...Settings.data,apiKey:''},quarantined:Store.quarantined,trash:Store.trash||[]};
      archive['workspace.json']=BackupZip.strToU8(JSON.stringify({version:2,state,files},null,2));
      this.downloadBlob(new Blob([BackupZip.zipSync(archive,{level:0})],{type:'application/zip'}),'bible-ai-backup.zip');this.toast('Backup ready. API keys are excluded; all listed files are included.');
    }catch(error){this.toast(error.message);}
  },
  async importBackup(file){
    if(!file)return;
    const created=[];
    try{
      if(file.size>260_000_000)throw new Error('Backup is too large for browser restore.');
      let total=0;const archive=BackupZip.unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:entry=>{total+=entry.originalSize;if(total>250_000_000)throw new Error('Backup expands beyond the restore limit.');return true;}});
      const manifest=JSON.parse(BackupZip.strFromU8(archive['workspace.json']||new Uint8Array()));
      if(manifest.version!==2||!manifest.state||!Array.isArray(manifest.files))throw new Error('Unsupported backup format.');
      const parsed=Workspace.normalizeWorkspace(manifest.state);if(parsed.rejected.length)throw new Error('Backup contains invalid records. Your workspace is unchanged.');
      if(!confirm('Restore this backup? Existing conversations will be kept. Conflicting copies will be labelled. API keys are not restored.'))return;
      const mapping=new Map();
      for(const item of manifest.files){const bytes=archive['files/'+item.id];if(!bytes||bytes.byteLength!==item.size)throw new Error('Backup file missing or incomplete: '+item.name);const form=new FormData();form.append('file',new File([bytes],item.name,{type:item.mimeType}));form.append('restoreMetadata',JSON.stringify({kind:item.kind,format:item.format,metadata:item.metadata}));const response=await fetch('/api/files',{method:'POST',credentials:'same-origin',body:form});const result=await response.json();if(!response.ok)throw new Error(result.error||'Restore upload failed');created.push(result.file);mapping.set(item.id,result.file);}
      const remap=value=>{if(Array.isArray(value))return value.map(remap);if(value&&typeof value==='object'){if(mapping.has(value.id)&&value.url)return mapping.get(value.id);return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v)]));}return value;};
      const restored=remap(parsed.state);restored.settings.apiKey=Settings.data.apiKey;
      const merged=Workspace.mergeWorkspace(null,restored,CloudSync.snapshot());CloudSync.applyRemote(merged);CloudSync.schedule();this.renderAll();this.toast('Backup restored. Conflicting copies were preserved.');
    }catch(error){for(const item of created)await fetch(item.url,{method:'DELETE',credentials:'same-origin'}).catch(()=>{});this.toast('Restore stopped: '+error.message);}
    finally{if($('#backupInput'))$('#backupInput').value='';}
  },
  updateDrawerAccess(){
    const narrow=matchMedia('(max-width:744px)').matches,contextHidden=matchMedia('(max-width:1200px)').matches;
    const sidebar=$('#sidebar'),right=$('#rightPanel');
    sidebar.inert=(narrow&&!sidebar.classList.contains('mobile-open'))||$('#appShell').classList.contains('sidebar-collapsed');
    right.inert=contextHidden&&!right.classList.contains('open');
    sidebar.setAttribute('aria-hidden',String(sidebar.inert));right.setAttribute('aria-hidden',String(right.inert));
    $('#mobileMenu').setAttribute('aria-expanded',String(!sidebar.inert));
    $('#expandSidebar').hidden=!$('#appShell').classList.contains('sidebar-collapsed');
  },
  bindAccessibleNavigation(){
    const update=()=>this.updateDrawerAccess();
    new MutationObserver(update).observe($('#appShell'),{subtree:true,attributes:true,attributeFilter:['class']});
    addEventListener('resize',update);addEventListener('popstate',()=>{const view=location.hash.slice(1);if(['chat','original','topics','library','history','settings'].includes(view))this.go(view,{fromHistory:true});});
    $('#expandSidebar').onclick=()=>{$('#appShell').classList.remove('sidebar-collapsed');update();$('#collapseSidebar').focus();};
    const initial=location.hash.slice(1);if(['chat','original','topics','library','history','settings'].includes(initial))this.go(initial,{fromHistory:true});update();
    document.addEventListener('keydown',event=>{
      const sheet=$('.bottom-sheet.open');
      if(sheet&&event.key==='Tab'){const buttons=$$('button,a[href],input,textarea,select,iframe',sheet).filter(e=>!e.disabled&&e.getClientRects().length);const first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
      if(event.target.matches('#globalSearch')&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();$('#searchPopover button')?.focus();}
      if(event.target.closest('#versionMenu')&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const rows=$$('#versionMenu button');rows[(rows.indexOf(document.activeElement)+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length]?.focus();}
    });
    $('#toggleHints').onclick=()=>{const expanded=$('#composerHints').classList.toggle('expanded');$('#toggleHints').setAttribute('aria-expanded',String(expanded));};
  },

  /* ===== Utilities ===== */
  bindGlobal() {
    $$("[data-close-dialog]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
    $$("dialog").forEach(d => d.addEventListener("click", e => { if (e.target === d) d.close(); }));
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        this.setRightPanel(false);
        $("#sidebar")?.classList.remove("mobile-open");
        $("#selectionActions") && ($("#selectionActions").hidden = true);
        this.stopCameraStream(); this.closeSheets();
      }
    });
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyTheme());
  },
  async copy(text, message) {
    try { await navigator.clipboard.writeText(text); this.toast(message || "Copied"); }
    catch { this.toast("Copy failed — your browser blocked clipboard access"); }
  },
  toast(message) {
    const t = $("#toast");
    t.textContent = message; t.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  },
};

window.Store = Store;
window.App = App;
document.addEventListener("DOMContentLoaded", () => App.init());
