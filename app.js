import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { ICONS } from "./icons.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// =====================================================================
// Zustand & Helfer
// =====================================================================
const S = { session: null, me: null, members: [], settings: {}, ideaCat: "Alle", taskFilter: "alle", guestQ: "" };
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
const fdate = (d) => (d ? new Date(d + "T12:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
const today = () => new Date().toISOString().slice(0, 10);
const isCouple = () => S.me?.role === "paar";
const member = (id) => S.members.find((m) => m.id === id);
const mName = (id) => member(id)?.name ?? "Unbekannt";

function avatar(id, sm = false) {
  const m = member(id);
  if (!m) return "";
  return `<span class="avatar ${sm ? "sm" : ""}" style="background:${h(m.color)}" title="${h(m.name)}">${h(m.name.slice(0, 1).toUpperCase())}</span>`;
}

function toast(msg, err = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("err", err);
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2400);
}

async function q(promise) {
  const { data, error } = await promise;
  if (error) { console.error(error); toast("Hat nicht geklappt: " + error.message, true); throw error; }
  return data;
}

const VIS_LABEL = { alle: "Für alle", paar: "Nur Brautpaar", trauzeugen: "Nur Trauzeugen (geheim)" };
const visBadge = (v) => (v === "paar" ? `<span class="badge rose">${icon("lock")}Nur Paar</span>` : v === "trauzeugen" ? `<span class="badge secret">${icon("lock")}Geheim</span>` : "");

// ---------- Icons (Phosphor) ----------
const icon = (n, fill = false) => `<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">${ICONS[fill ? n + "F" : n] || ""}</svg>`;

// =====================================================================
// Bilder (Komprimierung, Upload, signierte URLs)
// =====================================================================
async function compressImage(file, max = 1600, quality = 0.82) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

async function uploadImage(file, folder) {
  const blob = await compressImage(file);
  const ext = blob.type === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  await q(sb.storage.from("bilder").upload(path, blob, { contentType: blob.type || "image/jpeg" }));
  return path;
}

const urlCache = new Map();
async function signedUrls(paths) {
  const need = [...new Set(paths.filter((p) => p && !(urlCache.get(p)?.exp > Date.now())))];
  if (need.length) {
    const { data } = await sb.storage.from("bilder").createSignedUrls(need, 3600 * 6);
    (data || []).forEach((d) => d.signedUrl && urlCache.set(d.path, { url: d.signedUrl, exp: Date.now() + 3600 * 5 * 1000 }));
  }
  return (p) => urlCache.get(p)?.url ?? "";
}

async function removeImage(path) {
  if (path) await sb.storage.from("bilder").remove([path]);
}

// =====================================================================
// Modal & generische Formulare
// =====================================================================
function openModal(html, { wide = false, onMount } = {}) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="overlay"><div class="modal ${wide ? "wide" : ""}">${html}</div></div>`;
  const ov = $(".overlay", root);
  ov.addEventListener("mousedown", (e) => { if (e.target === ov) closeModal(); });
  $$("[data-close]", root).forEach((b) => b.addEventListener("click", closeModal));
  document.addEventListener("keydown", escClose);
  onMount?.($(".modal", root));
}
function escClose(e) { if (e.key === "Escape") closeModal(); }
function closeModal() { $("#modal-root").innerHTML = ""; document.removeEventListener("keydown", escClose); }

function visOptions() {
  return isCouple() ? ["alle", "paar"] : ["alle", "trauzeugen"];
}

function field(f, v) {
  const val = v ?? f.default ?? "";
  const cls = `f ${f.full ? "full" : ""}`;
  const req = f.required ? "required" : "";
  switch (f.type) {
    case "textarea":
      return `<label class="${cls} full">${h(f.label)}<textarea name="${f.name}" ${req}>${h(val)}</textarea></label>`;
    case "select":
      return `<label class="${cls}">${h(f.label)}<select name="${f.name}">${f.options
        .map((o) => { const [k, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${h(k)}" ${String(k) === String(val) ? "selected" : ""}>${h(l)}</option>`; })
        .join("")}</select></label>`;
    case "member":
      return `<label class="${cls}">${h(f.label)}<select name="${f.name}"><option value="">Noch offen</option>${S.members
        .map((m) => `<option value="${h(m.id)}" ${m.id === val ? "selected" : ""}>${h(m.name)}</option>`)
        .join("")}</select></label>`;
    case "visibility":
      return field({ ...f, type: "select", options: visOptions().map((k) => [k, VIS_LABEL[k]]) }, v ?? "alle");
    case "checkbox":
      return `<label class="f cb ${f.full ? "full" : ""}"><input type="checkbox" name="${f.name}" ${val ? "checked" : ""}> ${h(f.label)}</label>`;
    case "file":
      return `<label class="${cls} full">${h(f.label)}<input type="file" name="${f.name}" accept="image/*"></label>`;
    default:
      return `<label class="${cls}">${h(f.label)}<input type="${f.type || "text"}" name="${f.name}" value="${h(val)}" ${req} ${f.step ? `step="${f.step}"` : ""} ${f.placeholder ? `placeholder="${h(f.placeholder)}"` : ""}></label>`;
  }
}

/**
 * Öffnet ein Formular für eine Tabelle.
 * cfg: { table, title, fields, record, before(values, form), after() , canDelete }
 */
function openForm(cfg) {
  const rec = cfg.record || {};
  const isEdit = !!rec.id;
  openModal(
    `<div class="m-head"><h2>${h(isEdit ? cfg.title + " bearbeiten" : "Neu: " + cfg.title)}</h2><button class="icon-btn" data-close>${icon("x")}</button></div>
     <form class="form">${cfg.fields.filter((f) => !f.hidden?.()).map((f) => field(f, rec[f.name])).join("")}</form>
     <div class="form-actions">
       ${isEdit && cfg.canDelete !== false ? `<button class="btn danger ghost" data-del>Löschen</button>` : ""}
       <div class="right"><button class="btn" data-close>Abbrechen</button><button class="btn primary" data-save>Speichern</button></div>
     </div>`,
    {
      onMount: (m) => {
        const form = $("form", m);
        $("input,textarea", form)?.focus();
        form.addEventListener("submit", (e) => { e.preventDefault(); $("[data-save]", m).click(); });
        $("[data-save]", m).addEventListener("click", async (e) => {
          if (!form.reportValidity()) return;
          e.target.disabled = true; e.target.classList.add("busy");
          try {
            const vals = {};
            for (const f of cfg.fields) {
              if (f.hidden?.()) continue;
              const el = form.elements[f.name];
              if (!el) continue;
              if (f.type === "checkbox") vals[f.name] = el.checked;
              else if (f.type === "file") continue;
              else if (f.type === "number") vals[f.name] = el.value === "" ? null : Number(el.value);
              else vals[f.name] = el.value === "" ? null : el.value;
            }
            if (cfg.before) await cfg.before(vals, form, rec);
            if (isEdit) await q(sb.from(cfg.table).update(vals).eq("id", rec.id));
            else await q(sb.from(cfg.table).insert(vals));
            closeModal();
            toast("Gespeichert");
            (cfg.after || render)();
          } catch { e.target.disabled = false; e.target.classList.remove("busy"); }
        });
        $("[data-del]", m)?.addEventListener("click", async () => {
          if (!confirm("Wirklich löschen?")) return;
          await q(sb.from(cfg.table).delete().eq("id", rec.id));
          if (cfg.onDelete) await cfg.onDelete(rec);
          closeModal();
          toast("Gelöscht");
          (cfg.after || render)();
        });
      },
    },
  );
}

// =====================================================================
// Routing & Layout
// =====================================================================
const ROUTES = {
  "": { label: "Übersicht", icon: "home", view: viewDashboard },
  aufgaben: { label: "Aufgaben", icon: "check", view: viewTasks },
  ideen: { label: "Ideenboard", icon: "image", view: viewIdeas },
  ausgaben: { label: "Ausgaben", icon: "euro", view: viewExpenses },
  gaeste: { label: "Gäste", icon: "users", view: viewGuests },
  helfer: { label: "Helfer", icon: "hands", view: viewHelpers },
  dienstleister: { label: "Dienstleister", icon: "shop", view: viewVendors },
  ablauf: { label: "Tagesablauf", icon: "clock", view: viewTimeline },
  einstellungen: { label: "Einstellungen", icon: "gear", view: viewSettings },
};
const route = () => location.hash.replace(/^#\/?/, "").split("/")[0];

function shell() {
  const r = route();
  const title = S.settings.title || "Unsere Hochzeit";
  const nav = Object.entries(ROUTES)
    .map(([k, v]) => `<a href="#/${k}" class="${k === r ? "on" : ""}">${icon(v.icon)}${v.label}</a>`)
    .join("");
  const tabs = ["", "aufgaben", "ideen", "ausgaben"]
    .map((k) => `<a href="#/${k}" class="${k === r ? "on" : ""}">${icon(ROUTES[k].icon)}${ROUTES[k].label.replace("Ideenboard", "Ideen")}</a>`)
    .join("");
  const moreOn = ["gaeste", "helfer", "dienstleister", "ablauf", "einstellungen"].includes(r);
  $("#app").innerHTML = `
    <div class="shell">
      <aside class="side">
        <div class="brand">${h(title)}<small>${S.settings.wedding_date ? fdate(S.settings.wedding_date) : "Hochzeitsplaner"}</small></div>
        <nav class="nav">${nav}</nav>
        <a class="me" href="#/einstellungen">${avatar(S.me.id)}<span>${h(S.me.name)}</span></a>
      </aside>
      <div>
        <div class="mobile-top"><div class="brand">${h(title)}</div><a href="#/einstellungen" aria-label="Einstellungen">${avatar(S.me.id)}</a></div>
        <main id="view">${skeleton()}</main>
      </div>
      <nav class="tabbar">${tabs}<button data-more class="${moreOn ? "on" : ""}">${icon("more")}Mehr</button></nav>
    </div>`;
  $("[data-more]").addEventListener("click", () =>
    openModal(
      `<div class="m-head"><h2>Mehr</h2><button class="icon-btn" data-close>${icon("x")}</button></div>
       <div class="sheet-menu">${["gaeste", "helfer", "dienstleister", "ablauf", "einstellungen"]
         .map((k) => `<a href="#/${k}" data-close>${icon(ROUTES[k].icon)}${ROUTES[k].label}</a>`)
         .join("")}</div>`,
    ),
  );
}

async function render() {
  const r = ROUTES[route()] ? route() : "";
  shell();
  try {
    await ROUTES[r].view($("#view"));
  } catch (e) {
    console.error(e);
    $("#view").innerHTML = `<div class="empty">Da ist etwas schiefgelaufen: ${h(e.message)}</div>`;
  }
}

function skeleton() {
  return `<div class="skel" style="height:34px;width:220px;margin-bottom:24px"></div>
    <div class="skel" style="height:88px;margin-bottom:16px"></div>
    <div class="grid g2"><div class="skel" style="height:200px"></div><div class="skel" style="height:200px"></div></div>`;
}

function header(title, sub, actions = "") {
  return `<div class="head"><div><h1>${h(title)}</h1>${sub ? `<p>${sub}</p>` : ""}</div><div class="row wrap">${actions}</div></div>`;
}

// =====================================================================
// App installieren (Startbildschirm)
// =====================================================================
let installEvt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; if (route() === "" && S.me) refreshQuiet(); });
window.addEventListener("appinstalled", () => { installEvt = null; store.set("installHidden", "1"); toast("App ist installiert"); });
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isMobile = () => isIOS() || /android/i.test(navigator.userAgent);

function installBanner() {
  if (isStandalone() || store.get("installHidden")) return "";
  if (!installEvt && !isMobile()) return "";
  return `<div class="install" data-install-box>
    <span class="install-ic">${icon("phone")}</span>
    <div class="grow"><b>Als App aufs Handy</b><div class="small muted">Mit eigenem Symbol auf dem Startbildschirm, öffnet sich ohne Browserleiste.</div></div>
    <button class="btn primary sm" data-install>${installEvt ? "Installieren" : "So geht's"}</button>
    <button class="icon-btn" data-install-hide aria-label="Hinweis ausblenden">${icon("x")}</button>
  </div>`;
}

async function startInstall() {
  if (installEvt) {
    installEvt.prompt();
    const { outcome } = await installEvt.userChoice;
    installEvt = null;
    if (outcome === "accepted") { store.set("installHidden", "1"); render(); }
    return;
  }
  const ios = isIOS();
  openModal(`<div class="m-head"><h2>App auf den Startbildschirm</h2><button class="icon-btn" data-close>${icon("x")}</button></div>
    <ol class="steps">
      ${ios
        ? `<li>Öffne diese Seite in <b>Safari</b>.</li>
           <li>Tippe unten auf das Teilen-Symbol <span class="inline-ic">${icon("share")}</span>.</li>
           <li>Wähle <b>Zum Home-Bildschirm</b> <span class="inline-ic">${icon("plusSquare")}</span> und tippe auf <b>Hinzufügen</b>.</li>`
        : `<li>Öffne diese Seite in <b>Chrome</b>.</li>
           <li>Tippe oben rechts auf das Menü <span class="inline-ic">${icon("more")}</span>.</li>
           <li>Wähle <b>Zum Startbildschirm hinzufügen</b> oder <b>App installieren</b>.</li>`}
    </ol>
    <p class="small muted">Danach findest du den Planer wie jede andere App auf deinem Handy. Eingeloggt bleibst du dabei.</p>
    <div class="form-actions"><div class="right"><button class="btn primary" data-close>Verstanden</button></div></div>`);
}

function bindInstall(el) {
  $("[data-install]", el)?.addEventListener("click", startInstall);
  $("[data-install-hide]", el)?.addEventListener("click", () => { store.set("installHidden", "1"); $("[data-install-box]", el)?.remove(); toast("Findest du jederzeit unter Einstellungen"); });
}

// =====================================================================
// Übersicht
// =====================================================================
async function viewDashboard(el) {
  const [tasks, expenses, guests, cats, vendors] = await Promise.all([
    q(sb.from("tasks").select("*").neq("status", "erledigt").order("due_date", { nullsFirst: false })),
    q(sb.from("expenses").select("amount,paid_by,reimbursed")),
    q(sb.from("guests").select("persons,rsvp")),
    q(sb.from("budget_categories").select("planned")),
    q(sb.from("vendors").select("status")),
  ]);
  const d = S.settings.wedding_date;
  const days = d ? Math.ceil((new Date(d + "T00:00:00") - new Date(today() + "T00:00:00")) / 864e5) : null;
  const spent = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const budget = Number(S.settings.budget_total) || cats.reduce((s, c) => s + Number(c.planned || 0), 0);
  const yes = guests.filter((g) => g.rsvp === "zugesagt").reduce((s, g) => s + (g.persons || 1), 0);
  const invited = guests.reduce((s, g) => s + (g.persons || 1), 0);
  const mine = tasks.filter((t) => t.assignee === S.me.id);
  const openRefund = expenses.filter((e) => !e.reimbursed && member(e.paid_by)?.role === "trauzeuge").reduce((s, e) => s + Number(e.amount), 0);
  const booked = vendors.filter((v) => v.status === "gebucht").length;

  const due = tasks.filter((t) => t.due_date).slice(0, 6);
  const pct = (a, b) => (b ? Math.min(100, (a / b) * 100) : 0);

  el.innerHTML = `
    <section class="countdown">
      <div>
        <div class="hi">Hallo ${h(S.me.name)}</div>
        <h1>${h(S.settings.title || "Unsere Hochzeit")}</h1>
        <div class="when">${icon("calendar")}${d ? new Date(d + "T12:00:00").toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "Datum noch nicht festgelegt"}${S.settings.location ? `<span aria-hidden="true">·</span>${h(S.settings.location)}` : ""}</div>
      </div>
      ${days !== null
        ? `<div class="days"><b>${days > 0 ? days : days === 0 ? "Heute" : "Verheiratet"}</b>${days > 1 ? `<span>Tage noch</span>` : days === 1 ? `<span>Tag noch</span>` : ""}</div>`
        : isCouple() ? `<a class="btn" href="#/einstellungen">Datum eintragen</a>` : ""}
    </section>
    ${installBanner()}
    ${openRefund > 0 && isCouple() ? `<a class="notice" href="#/ausgaben">${icon("coins")}<span>Die Trauzeugen haben ${eur(openRefund)} ausgelegt, die noch nicht erstattet sind.</span></a>` : ""}
    <div class="status">
      <a href="#/aufgaben"><div class="k">${icon("check")}Aufgaben offen</div><div class="v">${tasks.length} <small>${mine.length} bei dir</small></div></a>
      <a href="#/ausgaben"><div class="k">${icon("euro")}Ausgegeben</div><div class="v">${eur(spent)}${budget ? ` <small>von ${eur(budget)}</small>` : ""}</div>${budget ? `<div class="bar ${spent > budget ? "over" : ""}"><span style="width:${pct(spent, budget)}%"></span></div>` : ""}</a>
      <a href="#/gaeste"><div class="k">${icon("users")}Zusagen</div><div class="v">${yes} <small>von ${invited} Personen</small></div>${invited ? `<div class="bar"><span style="width:${pct(yes, invited)}%"></span></div>` : ""}</a>
      <a href="#/dienstleister"><div class="k">${icon("shop")}Dienstleister gebucht</div><div class="v">${booked} <small>von ${vendors.length}</small></div></a>
    </div>
    <div class="grid g2" style="align-items:start">
      <section>
        <div class="section-title"><h2>Bei dir offen</h2><a href="#/aufgaben">Alle Aufgaben</a></div>
        ${mine.length ? `<div class="tasklist">${mine.slice(0, 6).map(taskCard).join("")}</div>` : `<div class="empty"><b>Bei dir ist alles erledigt</b>Neue Aufgaben, die dir zugeteilt werden, tauchen hier auf.</div>`}
      </section>
      <section>
        <div class="section-title"><h2>Demnächst fällig</h2></div>
        ${due.length ? `<div class="tasklist">${due.map(taskCard).join("")}</div>` : `<div class="empty"><b>Keine Fristen</b>Gib Aufgaben ein Fälligkeitsdatum, dann siehst du hier, was ansteht.</div>`}
      </section>
    </div>`;
  bindTaskCards(el, tasks);
  bindInstall(el);
}

// =====================================================================
// Aufgaben
// =====================================================================
const TASK_CATS = ["Allgemein", "Location", "Trauung", "Feier", "Essen", "Deko", "Outfit", "Papeterie", "Musik", "Foto", "Gäste", "JGA", "Flitterwochen"];
const STARTER_TASKS = [
  ["Gästeliste grob festlegen", "Gäste"], ["Budget besprechen", "Allgemein"], ["Location besichtigen und buchen", "Location"],
  ["Standesamt-Termin reservieren", "Trauung"], ["Trauredner oder Kirche anfragen", "Trauung"], ["Fotograf buchen", "Foto"],
  ["DJ oder Band buchen", "Musik"], ["Catering auswählen", "Essen"], ["Save-the-Date verschicken", "Papeterie"],
  ["Brautkleid aussuchen", "Outfit"], ["Anzug aussuchen", "Outfit"], ["Ringe aussuchen", "Allgemein"],
  ["Einladungen verschicken", "Papeterie"], ["Torte bestellen", "Essen"], ["Deko und Blumen planen", "Deko"],
  ["Sitzplan erstellen", "Gäste"], ["JGA planen", "JGA"], ["Flitterwochen buchen", "Flitterwochen"],
];
const STATUS = [["offen", "Offen"], ["in_arbeit", "In Arbeit"], ["erledigt", "Erledigt"]];
const taskFields = () => [
  { name: "title", label: "Aufgabe", required: true, full: true },
  { name: "assignee", label: "Zuständig", type: "member" },
  { name: "due_date", label: "Fällig am", type: "date" },
  { name: "category", label: "Kategorie", type: "select", options: TASK_CATS },
  { name: "status", label: "Status", type: "select", options: STATUS },
  { name: "visibility", label: "Sichtbar für", type: "visibility", full: true },
  { name: "notes", label: "Notizen", type: "textarea" },
];

function taskCard(t) {
  const late = t.due_date && t.due_date < today() && t.status !== "erledigt";
  const done = t.status === "erledigt";
  return `<div class="task ${done ? "done" : ""}" data-task="${t.id}" draggable="true" tabindex="0" role="button">
    <button class="check ${done ? "on" : ""}" data-toggle="${t.id}" aria-label="${done ? "Wieder öffnen" : "Erledigt"}">${done ? icon("tick") : ""}</button>
    <div style="flex:1;min-width:0">
      <div class="t-title">${h(t.title)}</div>
      <div class="meta">
        ${t.assignee ? avatar(t.assignee, true) : ""}
        ${t.due_date ? `<span class="${late ? "late" : ""}">${late ? "Überfällig: " : ""}${fdate(t.due_date)}</span>` : ""}
        <span>${h(t.category)}</span>${visBadge(t.visibility)}
      </div>
    </div></div>`;
}

function bindTaskCards(el, tasks) {
  $$("[data-task]", el).forEach((c) =>
    c.addEventListener("click", (e) => {
      if (e.target.closest("[data-toggle]")) return;
      const t = tasks.find((x) => x.id === c.dataset.task);
      openForm({ table: "tasks", title: "Aufgabe", fields: taskFields(), record: t });
    }),
  );
  $$("[data-toggle]", el).forEach((b) =>
    b.addEventListener("click", async (e) => {
      e.stopPropagation();
      const t = tasks.find((x) => x.id === b.dataset.toggle);
      await q(sb.from("tasks").update({ status: t.status === "erledigt" ? "offen" : "erledigt" }).eq("id", t.id));
      render();
    }),
  );
}

async function viewTasks(el) {
  let tasks = await q(sb.from("tasks").select("*").order("due_date", { nullsFirst: false }).order("created_at"));
  const total = tasks.length, done = tasks.filter((t) => t.status === "erledigt").length;
  const f = S.taskFilter;
  if (f === "meine") tasks = tasks.filter((t) => t.assignee === S.me.id);
  else if (f !== "alle") tasks = tasks.filter((t) => t.assignee === f);

  el.innerHTML = `
    ${header("Aufgaben", "", `<button class="btn primary" data-new>${icon("plus")}Aufgabe</button>`)}
    ${total ? `<div class="progress-line"><span class="num">${done} von ${total} erledigt</span><div class="bar"><span style="width:${(done / total) * 100}%"></span></div></div>` : ""}
    ${!total ? `<div class="empty" style="margin-bottom:20px"><b>Noch keine Aufgaben</b>Leg eigene an oder startet mit einer typischen Hochzeits-Checkliste, die ihr danach anpasst.<br><button class="btn" data-starter>Checkliste übernehmen</button></div>` : ""}
    <div class="chips">
      ${[["alle", "Alle"], ["meine", "Meine"], ...S.members.filter((m) => m.id !== S.me.id).map((m) => [m.id, m.name])]
        .map(([k, l]) => `<button class="chip ${f === k ? "on" : ""}" data-f="${h(k)}">${h(l)}</button>`).join("")}
    </div>
    <div class="kanban">
      ${STATUS.map(([k, l]) => {
        const list = tasks.filter((t) => t.status === k);
        return `<div class="col" data-col="${k}"><h3><span>${l}</span><span>${list.length}</span></h3>${list.map(taskCard).join("") || `<div class="none">Nichts hier</div>`}</div>`;
      }).join("")}
    </div>`;

  $("[data-new]", el).addEventListener("click", () => openForm({ table: "tasks", title: "Aufgabe", fields: taskFields(), record: { assignee: S.me.id } }));
  $$("[data-f]", el).forEach((b) => b.addEventListener("click", () => { S.taskFilter = b.dataset.f; render(); }));
  $("[data-starter]", el)?.addEventListener("click", async (e) => {
    e.target.classList.add("busy");
    const list = STARTER_TASKS.filter(([, c]) => !(c === "JGA" && isCouple()));
    await q(sb.from("tasks").insert(list.map(([title, category]) => ({ title, category, visibility: "alle" }))));
    toast(`${list.length} Aufgaben angelegt`); render();
  });
  bindTaskCards(el, tasks);

  // Drag & Drop zwischen Spalten (Desktop)
  $$("[data-task]", el).forEach((c) => c.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", c.dataset.task)));
  $$("[data-col]", el).forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drop"); });
    col.addEventListener("dragleave", () => col.classList.remove("drop"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("drop");
      const id = e.dataTransfer.getData("text/plain");
      if (id) { await q(sb.from("tasks").update({ status: col.dataset.col }).eq("id", id)); render(); }
    });
  });
}

// =====================================================================
// Ideenboard
// =====================================================================
const IDEA_CATS = ["Deko", "Blumen", "Location", "Kleid", "Anzug", "Haare & Make-up", "Torte", "Essen", "Papeterie", "Tischdeko", "Fotos", "Ringe", "Sonstiges"];

async function viewIdeas(el) {
  const [ideas, likes, comments] = await Promise.all([
    q(sb.from("ideas").select("*").order("created_at", { ascending: false })),
    q(sb.from("idea_likes").select("*")),
    q(sb.from("idea_comments").select("idea_id")),
  ]);
  const cats = ["Alle", ...IDEA_CATS.filter((c) => ideas.some((i) => i.category === c))];
  if (!cats.includes(S.ideaCat)) S.ideaCat = "Alle";
  const shown = S.ideaCat === "Alle" ? ideas : ideas.filter((i) => i.category === S.ideaCat);
  const url = await signedUrls(shown.map((i) => i.image_path));

  el.innerHTML = `
    ${header("Ideenboard", `${ideas.length} Ideen gesammelt`, `<button class="btn" data-link>${icon("link")}Pinterest-Link</button><button class="btn primary" data-up>${icon("upload")}Bild hochladen</button>`)}
    <div class="dropzone" data-drop>Bilder hierher ziehen, mit Strg/Cmd + V einfügen oder oben einen Link einfügen</div>
    <input type="file" accept="image/*" multiple hidden data-file>
    <div class="chips">${cats.map((c) => `<button class="chip ${S.ideaCat === c ? "on" : ""}" data-cat="${h(c)}">${h(c)}</button>`).join("")}</div>
    ${shown.length ? `<div class="masonry">${shown.map((i) => {
      const lk = likes.filter((l) => l.idea_id === i.id);
      const cm = comments.filter((c) => c.idea_id === i.id).length;
      return `<button class="pin" data-idea="${i.id}">
        ${i.image_path ? `<img src="${h(url(i.image_path))}" loading="lazy" alt="">` : `<div class="noimg">${h(i.title || "Idee")}</div>`}
        <div class="p-body">
          ${i.title && i.image_path ? `<div class="p-title">${h(i.title)}</div>` : ""}
          <div class="p-meta"><span class="row" style="gap:6px">${avatar(i.created_by, true)}<span>${h(i.category)}</span>${visBadge(i.visibility)}</span>
          <span class="row" style="gap:8px">${cm ? `<span class="like">${icon("chat")}${cm}</span>` : ""}<span class="like ${lk.some((l) => l.member === S.me.id) ? "on" : ""}">${icon("heart", lk.some((l) => l.member === S.me.id))}${lk.length || ""}</span></span></div>
        </div></button>`;
    }).join("")}</div>` : `<div class="empty"><b>Euer Board ist noch leer</b>Füg einen Pinterest-Link ein oder lade Screenshots hoch. Am Rechner kannst du Bilder auch direkt hineinziehen.</div>`}`;

  const fileIn = $("[data-file]", el);
  $("[data-up]", el).addEventListener("click", () => fileIn.click());
  fileIn.addEventListener("change", () => addIdeaFiles([...fileIn.files]));
  $("[data-link]", el).addEventListener("click", () => ideaForm({}));
  $$("[data-cat]", el).forEach((b) => b.addEventListener("click", () => { S.ideaCat = b.dataset.cat; render(); }));
  $$("[data-idea]", el).forEach((p) => p.addEventListener("click", () => ideaDetail(ideas.find((i) => i.id === p.dataset.idea))));

  const dz = $("[data-drop]", el);
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("over"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    dz.classList.remove("over");
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
    if (files.length) return addIdeaFiles(files);
    const txt = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (/^https?:\/\//.test(txt)) ideaForm({ source_url: txt.trim() });
  });
}

// Einfügen aus der Zwischenablage (global, nur auf dem Ideenboard)
document.addEventListener("paste", (e) => {
  if (route() !== "ideen" || $(".overlay")) return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
  if (files.length) { e.preventDefault(); addIdeaFiles(files); return; }
  const txt = e.clipboardData?.getData("text") || "";
  if (/^https?:\/\//.test(txt.trim())) { e.preventDefault(); ideaForm({ source_url: txt.trim() }); }
});

async function addIdeaFiles(files) {
  if (files.length === 1) return ideaForm({}, files[0]);
  toast(`${files.length} Bilder werden hochgeladen …`);
  for (const f of files) {
    const path = await uploadImage(f, "ideen");
    await q(sb.from("ideas").insert({ image_path: path, category: S.ideaCat !== "Alle" ? S.ideaCat : "Deko", visibility: "alle" }));
  }
  toast("Hochgeladen");
  render();
}

function ideaForm(rec, presetFile) {
  let pending = { image_path: rec.image_path || null };
  const isEdit = !!rec.id;
  openModal(
    `<div class="m-head"><h2>${isEdit ? "Idee bearbeiten" : "Neue Idee"}</h2><button class="icon-btn" data-close>${icon("x")}</button></div>
     <form class="form">
       <label class="f full">Link (Pinterest, Instagram, Shop …)
         <div class="row"><input name="source_url" value="${h(rec.source_url || "")}" placeholder="https://pin.it/…"><button type="button" class="btn sm" data-fetch>Laden</button></div>
       </label>
       <div class="full" data-preview style="display:none"><img style="max-height:260px;border-radius:12px;margin:0 auto"></div>
       <label class="f full">Oder Bild hochladen<input type="file" name="file" accept="image/*"></label>
       ${field({ name: "title", label: "Titel", full: true }, rec.title)}
       ${field({ name: "category", label: "Kategorie", type: "select", options: IDEA_CATS }, rec.category || (S.ideaCat !== "Alle" ? S.ideaCat : "Deko"))}
       ${field({ name: "visibility", label: "Sichtbar für", type: "visibility" }, rec.visibility)}
       ${field({ name: "notes", label: "Notizen", type: "textarea" }, rec.notes)}
     </form>
     <div class="form-actions"><div class="right"><button class="btn" data-close>Abbrechen</button><button class="btn primary" data-save>Speichern</button></div></div>`,
    {
      onMount: async (m) => {
        const form = $("form", m);
        const prev = $("[data-preview]", m);
        const showPrev = (src) => { if (src) { $("img", prev).src = src; prev.style.display = ""; } };
        if (rec.image_path) showPrev((await signedUrls([rec.image_path]))(rec.image_path));
        let file = presetFile || null;
        if (file) showPrev(URL.createObjectURL(file));
        form.elements.file.addEventListener("change", () => { file = form.elements.file.files[0]; if (file) showPrev(URL.createObjectURL(file)); });

        const fetchBtn = $("[data-fetch]", m);
        const doFetch = async () => {
          const link = form.elements.source_url.value.trim();
          if (!link) return;
          fetchBtn.disabled = true; fetchBtn.classList.add("busy");
          try {
            const { data, error } = await sb.functions.invoke("link-preview", { body: { url: link } });
            if (error || data?.error) throw new Error(data?.error || error.message);
            if (data.image_path) {
              if (pending.image_path && pending.image_path !== rec.image_path) removeImage(pending.image_path);
              pending.image_path = data.image_path;
              file = null;
              showPrev((await signedUrls([data.image_path]))(data.image_path));
            } else toast("Auf der Seite war kein Bild zu finden. Lade stattdessen einen Screenshot hoch.", true);
            if (data.title && !form.elements.title.value) form.elements.title.value = data.title;
            if (data.source_url) form.elements.source_url.value = data.source_url;
          } catch (e) {
            toast("Der Link ließ sich nicht laden. Lade stattdessen einen Screenshot hoch.", true);
          }
          fetchBtn.disabled = false; fetchBtn.classList.remove("busy");
        };
        fetchBtn.addEventListener("click", doFetch);
        if (rec.source_url && !rec.id) doFetch();

        $("[data-save]", m).addEventListener("click", async (e) => {
          e.target.disabled = true; e.target.classList.add("busy");
          try {
            if (file) pending.image_path = await uploadImage(file, "ideen");
            const vals = {
              title: form.elements.title.value || null,
              notes: form.elements.notes.value || null,
              category: form.elements.category.value,
              visibility: form.elements.visibility.value,
              source_url: form.elements.source_url.value.trim() || null,
              image_path: pending.image_path,
            };
            if (!vals.image_path && !vals.title && !vals.notes) { toast("Bitte ein Bild, einen Link oder einen Titel angeben", true); e.target.disabled = false; e.target.classList.remove("busy"); return; }
            if (isEdit) {
              await q(sb.from("ideas").update(vals).eq("id", rec.id));
              if (rec.image_path && rec.image_path !== vals.image_path) removeImage(rec.image_path);
            } else await q(sb.from("ideas").insert(vals));
            closeModal(); toast("Gespeichert"); render();
          } catch { e.target.disabled = false; e.target.classList.remove("busy"); }
        });
      },
    },
  );
}

async function ideaDetail(idea) {
  const [likes, comments] = await Promise.all([
    q(sb.from("idea_likes").select("*").eq("idea_id", idea.id)),
    q(sb.from("idea_comments").select("*").eq("idea_id", idea.id).order("created_at")),
  ]);
  const url = await signedUrls([idea.image_path]);
  const liked = likes.some((l) => l.member === S.me.id);
  openModal(
    `<div class="m-head"><h2>${h(idea.title || idea.category)}</h2><button class="icon-btn" data-close>${icon("x")}</button></div>
     <div class="idea-detail">
       <div>${idea.image_path ? `<img src="${h(url(idea.image_path))}" alt="">` : `<div class="pin"><div class="noimg">${h(idea.title || "Idee")}</div></div>`}</div>
       <div class="stack">
         <div class="row wrap"><span class="badge green">${h(idea.category)}</span>${visBadge(idea.visibility)}<span class="muted small">von ${h(mName(idea.created_by))}</span></div>
         ${idea.notes ? `<p style="white-space:pre-wrap;margin:0">${h(idea.notes)}</p>` : ""}
         ${idea.source_url ? `<a href="${h(idea.source_url)}" target="_blank" rel="noopener" class="small">${icon("link").replace("<svg", '<svg style="width:14px;vertical-align:-2px"')} Original öffnen</a>` : ""}
         <div class="row">
           <button class="btn sm like ${liked ? "on" : ""}" data-like>${icon("heart", liked)} ${likes.length ? likes.length : ""} Gefällt mir</button>
           <span class="row" style="gap:4px">${likes.map((l) => avatar(l.member, true)).join("")}</span>
         </div>
         <div>
           <h3 style="margin-bottom:6px">Kommentare</h3>
           ${comments.map((c) => `<div class="comment"><div class="row small" style="gap:6px">${avatar(c.created_by, true)}<b>${h(mName(c.created_by))}</b><span class="muted">${new Date(c.created_at).toLocaleDateString("de-DE")}</span></div><div style="margin-top:4px;white-space:pre-wrap">${h(c.body)}</div></div>`).join("") || `<div class="muted small">Noch keine Kommentare.</div>`}
           <form class="row" data-comment style="margin-top:10px"><input class="search" style="flex:1;min-width:0" name="body" placeholder="Kommentar schreiben …" required><button class="btn sm primary">Senden</button></form>
         </div>
         <div class="row" style="padding-top:8px;border-top:1px solid var(--line)">
           <button class="btn sm" data-edit>Bearbeiten</button>
           <button class="btn sm danger ghost" data-del>Löschen</button>
         </div>
       </div>
     </div>`,
    {
      wide: true,
      onMount: (m) => {
        $("[data-like]", m).addEventListener("click", async () => {
          if (liked) await q(sb.from("idea_likes").delete().eq("idea_id", idea.id).eq("member", S.me.id));
          else await q(sb.from("idea_likes").insert({ idea_id: idea.id }));
          ideaDetail(idea); refreshQuiet();
        });
        $("[data-comment]", m).addEventListener("submit", async (e) => {
          e.preventDefault();
          await q(sb.from("idea_comments").insert({ idea_id: idea.id, body: e.target.body.value }));
          ideaDetail(idea); refreshQuiet();
        });
        $("[data-edit]", m).addEventListener("click", () => ideaForm(idea));
        $("[data-del]", m).addEventListener("click", async () => {
          if (!confirm("Idee löschen?")) return;
          await q(sb.from("ideas").delete().eq("id", idea.id));
          await removeImage(idea.image_path);
          closeModal(); toast("Gelöscht"); render();
        });
      },
    },
  );
}

// Seite im Hintergrund neu laden, ohne offenes Modal zu schließen
async function refreshQuiet() {
  const v = $("#view");
  if (v) await ROUTES[ROUTES[route()] ? route() : ""].view(v).catch(() => {});
}

// =====================================================================
// Ausgaben & Budget
// =====================================================================
async function viewExpenses(el) {
  const [expenses, cats] = await Promise.all([
    q(sb.from("expenses").select("*").order("spent_on", { ascending: false }).order("created_at", { ascending: false })),
    q(sb.from("budget_categories").select("*").order("sort")),
  ]);
  const catNames = cats.map((c) => c.name);
  const spent = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const planned = cats.reduce((s, c) => s + Number(c.planned || 0), 0);
  const budget = Number(S.settings.budget_total) || planned;
  const url = await signedUrls(expenses.map((e) => e.receipt_path));

  // Erstattungen: alles, was Trauzeugen ausgelegt haben und noch nicht erstattet ist
  const refunds = S.members
    .filter((m) => m.role === "trauzeuge")
    .map((m) => ({ m, sum: expenses.filter((e) => e.paid_by === m.id && !e.reimbursed).reduce((s, e) => s + Number(e.amount), 0) }))
    .filter((r) => r.sum > 0);
  const perPerson = S.members.map((m) => ({ m, sum: expenses.filter((e) => e.paid_by === m.id).reduce((s, e) => s + Number(e.amount), 0) })).filter((r) => r.sum > 0);

  const expFields = () => [
    { name: "description", label: "Wofür?", required: true, full: true },
    { name: "amount", label: "Betrag (€)", type: "number", step: "0.01", required: true },
    { name: "spent_on", label: "Datum", type: "date", default: today() },
    { name: "category", label: "Kategorie", type: "select", options: catNames.length ? catNames : ["Sonstiges"] },
    { name: "paid_by", label: "Bezahlt von", type: "member", default: S.me.id },
    { name: "visibility", label: "Sichtbar für", type: "visibility", full: true },
    { name: "reimbursed", label: "Bereits erstattet", type: "checkbox", full: true, hidden: () => !isCouple() },
    { name: "receipt", label: "Beleg (Foto, optional)", type: "file" },
  ];
  const expForm = (rec) =>
    openForm({
      table: "expenses", title: "Ausgabe", fields: expFields(), record: rec,
      before: async (vals, form, r) => {
        const f = form.elements.receipt?.files?.[0];
        if (f) { vals.receipt_path = await uploadImage(f, "belege"); if (r.receipt_path) removeImage(r.receipt_path); }
      },
      onDelete: (r) => removeImage(r.receipt_path),
    });

  el.innerHTML = `
    ${header("Ausgaben & Budget", "", `${isCouple() ? `<button class="btn" data-budget>Budget planen</button>` : ""}<button class="btn primary" data-new>${icon("plus")}Ausgabe</button>`)}
    <div class="money-hero">
      <div class="card">
        <div class="muted">Bisher ausgegeben</div>
        <div class="big">${eur(spent)}</div>
        ${budget ? `<div class="bar ${spent > budget ? "over" : ""}"><span style="width:${Math.min(100, (spent / budget) * 100)}%"></span></div>
          <div class="small muted" style="margin-top:8px">${spent > budget ? `<span style="color:var(--danger)">${eur(spent - budget)} über dem Budget</span>` : `${eur(budget - spent)} übrig von ${eur(budget)}`}</div>`
          : `<div class="small muted">Noch kein Budget geplant.${isCouple() ? ` <a href="#" data-budget2>Jetzt planen</a>` : ""}</div>`}
      </div>
      <div class="card">
        <h3 style="margin-bottom:4px">${refunds.length ? "Noch zu erstatten" : "Wer hat bezahlt"}</h3>
        ${(refunds.length ? refunds : perPerson).map((r) => `<div class="people-row"><span class="row">${avatar(r.m.id, true)}${h(r.m.name)}</span><b class="num">${eur(r.sum)}</b></div>`).join("")
          || `<div class="small muted" style="margin-top:6px">Sobald jemand etwas einträgt, siehst du hier, wer wie viel ausgelegt hat.</div>`}
        ${refunds.length && perPerson.length ? `<div class="small muted" style="margin-top:8px">Insgesamt bezahlt: ${perPerson.map((r) => `${h(r.m.name)} ${eur(r.sum)}`).join(", ")}</div>` : ""}
      </div>
    </div>
    <div class="grid g2" style="align-items:start">
      <div>
        <div class="section-title"><h2>Alle Ausgaben</h2></div>
        ${expenses.length ? `<div class="list">${expenses.map((e) => `
          <div class="li" data-exp="${e.id}">
            ${e.receipt_path ? `<img class="thumb" src="${h(url(e.receipt_path))}" alt="Beleg">` : `<span title="Bezahlt von ${h(mName(e.paid_by))}">${avatar(e.paid_by)}</span>`}
            <div class="grow"><div class="title">${h(e.description)} ${visBadge(e.visibility)}</div>
              <div class="sub">${fdate(e.spent_on)}${e.category ? ", " + h(e.category) : ""}</div></div>
            <div style="text-align:right"><div class="amount">${eur(e.amount)}</div>
              ${member(e.paid_by)?.role === "trauzeuge" ? (e.reimbursed ? `<span class="badge green">erstattet</span>` : isCouple() ? `<button class="btn sm" data-refund="${e.id}">Erstatten</button>` : `<span class="badge gold">offen</span>`) : ""}
            </div>
          </div>`).join("")}</div>` : `<div class="empty"><b>Noch keine Ausgaben</b>Wenn jemand etwas bezahlt, hier mit Betrag und optional einem Foto vom Beleg eintragen.</div>`}
      </div>
      <div class="card">
        <h2 style="margin-bottom:14px">Nach Kategorie</h2>
        ${cats.map((c) => {
          const s = expenses.filter((e) => e.category === c.name).reduce((a, e) => a + Number(e.amount), 0);
          const p = Number(c.planned || 0);
          if (!s && !p) return "";
          return `<div style="margin-bottom:12px"><div class="row between small"><span>${h(c.name)}</span><span><b>${eur(s)}</b>${p ? ` <span class="muted">/ ${eur(p)}</span>` : ""}</span></div>
            <div class="bar ${p && s > p ? "over" : ""}" style="margin-top:5px"><span style="width:${p ? Math.min(100, (s / p) * 100) : 100}%;${p ? "" : "background:var(--line-strong)"}"></span></div></div>`;
        }).join("") || `<div class="small muted">Hier erscheint, wie viel pro Kategorie geplant und schon ausgegeben ist.</div>`}
      </div>
    </div>`;

  $("[data-new]", el).addEventListener("click", () => expForm({ paid_by: S.me.id, spent_on: today() }));
  $$("[data-exp]", el).forEach((r) => r.addEventListener("click", (e) => {
    if (e.target.closest("[data-refund]")) return;
    expForm(expenses.find((x) => x.id === r.dataset.exp));
  }));
  $$("[data-refund]", el).forEach((b) => b.addEventListener("click", async () => {
    await q(sb.from("expenses").update({ reimbursed: true }).eq("id", b.dataset.refund));
    toast("Als erstattet markiert"); render();
  }));
  $("[data-budget]", el)?.addEventListener("click", () => budgetForm(cats));
  $("[data-budget2]", el)?.addEventListener("click", (e) => { e.preventDefault(); budgetForm(cats); });
}

function budgetForm(cats) {
  openModal(
    `<div class="m-head"><h2>Budget planen</h2><button class="icon-btn" data-close>${icon("x")}</button></div>
     <form class="form">
       ${field({ name: "__total", label: "Gesamtbudget (€)", type: "number", step: "1", full: true }, S.settings.budget_total || "")}
       ${cats.map((c) => field({ name: c.id, label: c.name, type: "number", step: "1" }, c.planned || "")).join("")}
       <label class="f full">Neue Kategorie<input name="__new" placeholder="z. B. Hochzeitsauto"></label>
     </form>
     <p class="muted small">Ist kein Gesamtbudget gesetzt, wird die Summe der Kategorien verwendet.</p>
     <div class="form-actions"><div class="right"><button class="btn" data-close>Abbrechen</button><button class="btn primary" data-save>Speichern</button></div></div>`,
    {
      onMount: (m) => {
        $("[data-save]", m).addEventListener("click", async () => {
          const f = $("form", m).elements;
          await Promise.all(cats.map((c) => sb.from("budget_categories").update({ planned: Number(f[c.id].value) || 0 }).eq("id", c.id)));
          if (f.__new.value.trim()) await q(sb.from("budget_categories").insert({ name: f.__new.value.trim(), sort: cats.length + 1 }));
          await q(sb.from("settings").update({ budget_total: Number(f.__total.value) || 0 }).eq("id", 1));
          S.settings.budget_total = Number(f.__total.value) || 0;
          closeModal(); toast("Budget gespeichert"); render();
        });
      },
    },
  );
}

// =====================================================================
// Gäste
// =====================================================================
const GUEST_GROUPS = ["Familie", "Freunde", "Kollegen", "Nachbarn", "Verein", "Sonstige"];
const STAGES = [["standesamt", "Ab Standesamt"], ["trauung", "Ab freier Trauung"], ["abend", "Nur Abendfeier"]];
const STAGE_LABEL = Object.fromEntries(STAGES);
const guestFields = () => [
  { name: "name", label: "Name (oder Familie)", required: true, full: true },
  { name: "persons", label: "Personen", type: "number", default: 1 },
  { name: "from_stage", label: "Dabei", type: "select", options: STAGES, default: "trauung" },
  { name: "rsvp", label: "Rückmeldung", type: "select", options: [["offen", "Offen"], ["zugesagt", "Zugesagt"], ["abgesagt", "Abgesagt"]] },
  { name: "grp", label: "Gruppe", type: "select", options: GUEST_GROUPS },
  { name: "side", label: "Seite", type: "select", options: [["beide", "Beide"], ...S.members.filter((m) => m.role === "paar").map((m) => [m.name, m.name])] },
  { name: "diet", label: "Essen / Unverträglichkeiten", full: true },
  { name: "notes", label: "Notizen", type: "textarea" },
];

async function viewGuests(el) {
  const guests = await q(sb.from("guests").select("*").order("name"));
  const ppl = (list) => list.reduce((s, g) => s + (g.persons || 1), 0);
  const coming = guests.filter((g) => g.rsvp !== "abgesagt");
  const order = { standesamt: 0, trauung: 1, abend: 2 };
  // Wer früher kommt, ist auch später dabei
  const at = (stage) => coming.filter((g) => order[g.from_stage || "trauung"] <= order[stage]);
  const yesAt = (stage) => ppl(at(stage).filter((g) => g.rsvp === "zugesagt"));
  const ql = S.guestQ.toLowerCase();
  const f = S.guestStage || "alle";
  const shown = guests.filter((g) => (!ql || `${g.name} ${g.grp} ${g.diet || ""}`.toLowerCase().includes(ql)) && (f === "alle" || (g.from_stage || "trauung") === f));
  const rsvpBadge = { offen: "", zugesagt: "green", abgesagt: "red" };
  const row = (g) => `
      <div class="li" data-g="${g.id}">
        <div class="grow"><div class="title">${h(g.name)}${g.persons > 1 ? ` <span class="muted">(${g.persons} Personen)</span>` : ""}</div>
          <div class="sub">${h(g.grp)}${g.side !== "beide" ? ", " + h(g.side) : ""}${g.diet ? ", " + h(g.diet) : ""}</div></div>
        <button class="badge ${rsvpBadge[g.rsvp]}" data-rsvp="${g.id}" title="Tippen zum Ändern" aria-label="Rückmeldung ${h(g.rsvp)}, tippen zum Ändern">${{ offen: "Offen", zugesagt: "Zugesagt", abgesagt: "Abgesagt" }[g.rsvp]}</button>
      </div>`;
  const groups = STAGES.map(([k, l]) => [k, l, shown.filter((g) => (g.from_stage || "trauung") === k)]).filter(([, , list]) => list.length);

  el.innerHTML = `
    ${header("Gäste", `${ppl(guests)} eingeladen, ${ppl(guests.filter((g) => g.rsvp === "abgesagt"))} abgesagt`, `<button class="btn" data-csv>${icon("download")}CSV</button><button class="btn primary" data-new>${icon("plus")}Gast</button>`)}
    <div class="totals three">
      <div><div class="k">Standesamt</div><div class="v">${ppl(at("standesamt"))}</div><div class="small muted">${yesAt("standesamt")} zugesagt</div></div>
      <div><div class="k">Freie Trauung</div><div class="v">${ppl(at("trauung"))}</div><div class="small muted">${yesAt("trauung")} zugesagt</div></div>
      <div><div class="k">Abendfeier</div><div class="v">${ppl(at("abend"))}</div><div class="small muted">${yesAt("abend")} zugesagt</div></div>
    </div>
    <div class="chips">${[["alle", "Alle"], ...STAGES].map(([k, l]) => `<button class="chip ${f === k ? "on" : ""}" data-stage="${k}">${l}</button>`).join("")}</div>
    <input class="search" data-q placeholder="Suchen …" value="${h(S.guestQ)}" style="margin-bottom:16px;width:100%;max-width:340px">
    ${groups.length ? groups.map(([k, l, list]) => `
      <section style="margin-bottom:22px">
        <div class="section-title"><h2>${l}</h2><span class="small muted">${((n) => `${n} ${n === 1 ? "Person" : "Personen"}`)(ppl(list.filter((g) => g.rsvp !== "abgesagt")))}</span></div>
        <div class="list">${list.map(row).join("")}</div>
      </section>`).join("")
      : `<div class="empty">${guests.length ? `<b>Keine Treffer</b>Hier passt gerade kein Gast zu Suche oder Filter.` : `<b>Noch keine Gäste</b>Trag Einzelpersonen oder ganze Familien ein und wähle, ab wann sie dabei sind: Standesamt, freie Trauung oder erst abends.`}</div>`}`;

  $$("[data-stage]", el).forEach((b) => b.addEventListener("click", () => { S.guestStage = b.dataset.stage; render(); }));
  $("[data-new]", el).addEventListener("click", () => openForm({ table: "guests", title: "Gast", fields: guestFields() }));
  $$("[data-g]", el).forEach((r) => r.addEventListener("click", (e) => {
    if (e.target.closest("[data-rsvp]")) return;
    openForm({ table: "guests", title: "Gast", fields: guestFields(), record: guests.find((g) => g.id === r.dataset.g) });
  }));
  $$("[data-rsvp]", el).forEach((b) => b.addEventListener("click", async () => {
    const g = guests.find((x) => x.id === b.dataset.rsvp);
    const next = { offen: "zugesagt", zugesagt: "abgesagt", abgesagt: "offen" }[g.rsvp];
    await q(sb.from("guests").update({ rsvp: next }).eq("id", g.id));
    render();
  }));
  const qi = $("[data-q]", el);
  qi.addEventListener("input", () => { S.guestQ = qi.value; clearTimeout(qi._t); qi._t = setTimeout(async () => { await render(); const n = $("[data-q]"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); });
  $("[data-csv]", el).addEventListener("click", () => {
    const rows = [["Name", "Personen", "Dabei", "Rückmeldung", "Gruppe", "Seite", "Essen", "Notizen"], ...guests.map((g) => [g.name, g.persons, STAGE_LABEL[g.from_stage || "trauung"], g.rsvp, g.grp, g.side, g.diet || "", g.notes || ""])];
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = "gaesteliste.csv";
    a.click();
  });
}

// =====================================================================
// Helfer
// =====================================================================
const HELPER_JOBS = ["Aufbau", "Abbau", "Ausschank", "Bedienung", "Küche & Buffet", "Deko", "Fahrdienst", "Kinderbetreuung", "Technik & Musik", "Fotos", "Sonstiges"];
const helperFields = () => [
  { name: "name", label: "Name", required: true, full: true },
  { name: "job", label: "Aufgabe", type: "select", options: HELPER_JOBS },
  { name: "slot", label: "Wann", placeholder: "z. B. Freitag ab 16 Uhr" },
  { name: "phone", label: "Telefon", type: "tel" },
  { name: "confirmed", label: "Hat fest zugesagt", type: "checkbox" },
  { name: "notes", label: "Notizen", type: "textarea" },
];

async function viewHelpers(el) {
  const helpers = await q(sb.from("helpers").select("*").order("job").order("name"));
  const jobs = HELPER_JOBS.filter((j) => helpers.some((x) => x.job === j));
  const sure = helpers.filter((x) => x.confirmed).length;
  el.innerHTML = `
    ${header("Helfer", helpers.length ? `${helpers.length} Helfer, ${sure} fest zugesagt` : "", `<button class="btn primary" data-new>${icon("plus")}Helfer</button>`)}
    ${helpers.length ? `<div class="grid g2" style="align-items:start">${jobs.map((j) => {
      const list = helpers.filter((x) => x.job === j);
      return `<section>
        <div class="section-title"><h2>${h(j)}</h2><span class="small muted">${list.length}</span></div>
        <div class="list">${list.map((x) => `
          <div class="li" data-h="${x.id}">
            <button class="check ${x.confirmed ? "on" : ""}" data-conf="${x.id}" aria-label="${x.confirmed ? "Zusage zurücknehmen" : "Als zugesagt markieren"}">${x.confirmed ? icon("tick") : ""}</button>
            <div class="grow"><div class="title">${h(x.name)}</div>
              ${x.slot || x.phone ? `<div class="sub">${[x.slot, x.phone].filter(Boolean).map(h).join(", ")}</div>` : ""}</div>
            ${x.phone ? `<a class="icon-btn" href="tel:${h(x.phone.replace(/[^+\d]/g, ""))}" aria-label="${h(x.name)} anrufen" data-call>${icon("call")}</a>` : ""}
          </div>`).join("")}</div>
      </section>`;
    }).join("")}</div>`
    : `<div class="empty"><b>Noch keine Helfer</b>Sammelt hier, wer beim Aufbau, Ausschank, in der Bedienung oder beim Abbau hilft und wann. Mit dem Haken markiert ihr, wer fest zugesagt hat.</div>`}`;
  $("[data-new]", el).addEventListener("click", () => openForm({ table: "helpers", title: "Helfer", fields: helperFields() }));
  $$("[data-h]", el).forEach((r) => r.addEventListener("click", (e) => {
    if (e.target.closest("[data-conf],[data-call]")) return;
    openForm({ table: "helpers", title: "Helfer", fields: helperFields(), record: helpers.find((x) => x.id === r.dataset.h) });
  }));
  $$("[data-conf]", el).forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    const x = helpers.find((y) => y.id === b.dataset.conf);
    await q(sb.from("helpers").update({ confirmed: !x.confirmed }).eq("id", x.id));
    render();
  }));
}

// =====================================================================
// Dienstleister
// =====================================================================
const VENDOR_CATS = ["Location", "Catering", "Fotograf", "Videograf", "DJ / Band", "Floristik", "Konditor", "Brautmode", "Herrenmode", "Friseur & Make-up", "Trauredner", "Papeterie", "Transport", "Sonstiges"];
const VENDOR_STATUS = [["angefragt", "Angefragt"], ["angebot", "Angebot erhalten"], ["gebucht", "Gebucht"], ["abgesagt", "Abgesagt"]];
const vendorFields = () => [
  { name: "name", label: "Name", required: true, full: true },
  { name: "category", label: "Kategorie", type: "select", options: VENDOR_CATS },
  { name: "status", label: "Status", type: "select", options: VENDOR_STATUS },
  { name: "contact", label: "Ansprechpartner" },
  { name: "phone", label: "Telefon", type: "tel" },
  { name: "email", label: "E-Mail", type: "email" },
  { name: "website", label: "Website", type: "url", placeholder: "https://" },
  { name: "price", label: "Preis (€)", type: "number", step: "0.01" },
  { name: "deposit", label: "Anzahlung (€)", type: "number", step: "0.01" },
  { name: "notes", label: "Notizen", type: "textarea" },
];

async function viewVendors(el) {
  const vendors = await q(sb.from("vendors").select("*").order("category").order("name"));
  const sBadge = { angefragt: "", angebot: "gold", gebucht: "green", abgesagt: "red" };
  const sLabel = Object.fromEntries(VENDOR_STATUS);
  const bookedSum = vendors.filter((v) => v.status === "gebucht").reduce((s, v) => s + Number(v.price || 0), 0);
  el.innerHTML = `
    ${header("Dienstleister", vendors.length ? `Gebucht: ${eur(bookedSum)}` : "", `<button class="btn primary" data-new>${icon("plus")}Dienstleister</button>`)}
    ${vendors.length ? `<div class="grid g3">${vendors.map((v) => `
      <div class="card" data-v="${v.id}" tabindex="0" role="button" style="cursor:pointer">
        <div class="row between"><span class="muted small">${h(v.category || "")}</span><span class="badge ${sBadge[v.status]}">${h(sLabel[v.status])}</span></div>
        <h3 style="margin:6px 0 4px">${h(v.name)}</h3>
        ${v.contact ? `<div class="small">${h(v.contact)}</div>` : ""}
        ${v.phone || v.email ? `<div class="small muted">${[v.phone, v.email].filter(Boolean).map(h).join(", ")}</div>` : ""}
        ${v.price ? `<div style="margin-top:10px"><b>${eur(v.price)}</b>${v.deposit ? ` <span class="muted small">(Anzahlung ${eur(v.deposit)})</span>` : ""}</div>` : ""}
      </div>`).join("")}</div>` : `<div class="empty"><b>Noch keine Dienstleister</b>Sammelt hier Fotografen, Location, DJ und Co. mit Angebot und Anzahlung, damit alle den Stand kennen.</div>`}`;
  $("[data-new]", el).addEventListener("click", () => openForm({ table: "vendors", title: "Dienstleister", fields: vendorFields() }));
  $$("[data-v]", el).forEach((c) => c.addEventListener("click", () => openForm({ table: "vendors", title: "Dienstleister", fields: vendorFields(), record: vendors.find((v) => v.id === c.dataset.v) })));
}

// =====================================================================
// Tagesablauf
// =====================================================================
const tlFields = () => [
  { name: "time", label: "Uhrzeit", type: "time", required: true },
  { name: "title", label: "Programmpunkt", required: true },
  { name: "place", label: "Ort" },
  { name: "responsible", label: "Verantwortlich", type: "member" },
  { name: "visibility", label: "Sichtbar für", type: "visibility", full: true },
  { name: "notes", label: "Notizen", type: "textarea" },
];

async function viewTimeline(el) {
  const items = await q(sb.from("timeline").select("*").order("time"));
  el.innerHTML = `
    ${header("Tagesablauf", S.settings.wedding_date ? fdate(S.settings.wedding_date) : "", `<button class="btn" data-print>${icon("printer")}Drucken</button><button class="btn primary" data-new>${icon("plus")}Programmpunkt</button>`)}
    ${items.length ? `<div class="timeline">${items.map((t) => `
      <div class="tl" data-t="${t.id}" tabindex="0" role="button">
        <div class="time">${h(t.time.slice(0, 5))}</div>
        <div class="body">
          <div class="row between"><b>${h(t.title)}</b>${t.responsible ? avatar(t.responsible, true) : ""}</div>
          ${t.place || t.visibility !== "alle" ? `<div class="row small muted" style="gap:8px;margin-top:2px">${h(t.place || "")}${visBadge(t.visibility)}</div>` : ""}
          ${t.notes ? `<div class="small" style="margin-top:6px;white-space:pre-wrap">${h(t.notes)}</div>` : ""}
        </div>
      </div>`).join("")}</div>` : `<div class="empty"><b>Noch kein Ablauf</b>Plant den Tag Punkt für Punkt, z. B. 14:00 Trauung, 15:30 Sektempfang. Jeder Punkt kann eine verantwortliche Person bekommen.</div>`}`;
  $("[data-print]", el).addEventListener("click", () => window.print());
  $("[data-new]", el).addEventListener("click", () => openForm({ table: "timeline", title: "Programmpunkt", fields: tlFields() }));
  $$("[data-t]", el).forEach((c) => c.addEventListener("click", () => openForm({ table: "timeline", title: "Programmpunkt", fields: tlFields(), record: items.find((t) => t.id === c.dataset.t) })));
}

// =====================================================================
// Einstellungen
// =====================================================================
const COLORS = ["#7d8b6a", "#c08b7a", "#8a7fb0", "#c9a44c", "#5d8aa8", "#b4523f", "#6b8f8a", "#a0708f"];

async function viewSettings(el) {
  const s = S.settings;
  el.innerHTML = `
    ${header("Einstellungen", "")}
    <div class="grid g2" style="align-items:start">
      <div class="card">
        <h2 style="margin-bottom:14px">Hochzeit</h2>
        ${isCouple() ? `<form class="form" data-settings>
          ${field({ name: "title", label: "Titel", full: true }, s.title)}
          ${field({ name: "wedding_date", label: "Datum", type: "date" }, s.wedding_date)}
          ${field({ name: "location", label: "Ort" }, s.location)}
          <div class="full"><button class="btn primary">Speichern</button></div>
        </form>` : `<p>${h(s.title)}<br><span class="muted">${fdate(s.wedding_date)} ${h(s.location || "")}</span></p><p class="muted small">Nur das Brautpaar kann diese Angaben ändern.</p>`}
      </div>
      <div class="card">
        <div class="row between" style="margin-bottom:14px"><h2>Team</h2>${isCouple() ? `<button class="btn sm" data-add>${icon("plus")}Person</button>` : ""}</div>
        <div class="list">${S.members.map((m) => `
          <div class="li" data-m="${h(m.id)}" style="${isCouple() ? "" : "cursor:default"}">
            ${avatar(m.id)}<div class="grow"><div class="title">${h(m.name)}</div></div>
            <span class="badge ${m.role === "paar" ? "rose" : "green"}">${m.role === "paar" ? "Brautpaar" : "Trauzeuge/in"}</span>
          </div>`).join("")}</div>
        <p class="muted small" style="margin-top:12px">Neue Personen erscheinen sofort als Button auf der Login-Seite.<br>
        <b>Sichtbarkeit:</b> „Nur Brautpaar“ sehen nur ihr beide. „Geheim“ sehen nur die Trauzeugen, praktisch für JGA und Überraschungen.</p>
      </div>
      ${isCouple() ? `<div class="card">
        <h2 style="margin-bottom:10px">Codewort</h2>
        <p class="muted small" style="margin-top:0">Wird beim ersten Login auf jedem Gerät abgefragt. Leer lassen = Login nur mit Namen.</p>
        <form class="row" data-code><input class="search" style="flex:1;min-width:0" name="code" placeholder="Neues Codewort"><button class="btn primary">Setzen</button></form>
      </div>` : ""}
      <div class="card">
        <h2 style="margin-bottom:10px">Dein Konto</h2>
        <p class="muted small" style="margin-top:0">Angemeldet als ${h(S.me.name)} auf diesem Gerät</p>
        <div class="row wrap"><button class="btn" data-me>Name & Farbe ändern</button><button class="btn danger" data-logout>Abmelden</button></div>
        ${isStandalone() ? `<p class="muted small">Läuft als App auf diesem Gerät.</p>` : `<button class="btn" data-install style="margin-top:12px">${icon("phone")}Als App installieren</button>`}
      </div>
    </div>`;

  $("[data-settings]", el)?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const vals = { title: f.title.value || "Unsere Hochzeit", wedding_date: f.wedding_date.value || null, location: f.location.value || null, updated_at: new Date().toISOString() };
    await q(sb.from("settings").update(vals).eq("id", 1));
    Object.assign(S.settings, vals);
    toast("Gespeichert"); render();
  });
  $("[data-logout]", el).addEventListener("click", async () => { await sb.rpc("release_member"); await sb.auth.signOut(); location.hash = ""; location.reload(); });
  $("[data-code]", el)?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = e.target.code.value;
    if (!code && !confirm("Codewort entfernen? Dann reicht der Name zum Einloggen.")) return;
    await q(sb.rpc("set_access_code", { p_code: code }));
    e.target.reset(); toast(code ? "Codewort gesetzt" : "Codewort entfernt");
  });

  const memberForm = (m, self = false) => {
    const isEdit = !!m.id;
    openModal(
      `<div class="m-head"><h2>${isEdit ? h(m.name) : "Person hinzufügen"}</h2><button class="icon-btn" data-close>${icon("x")}</button></div>
       <form class="form">
         ${field({ name: "name", label: "Name", required: true }, m.name)}
         ${self ? "" : field({ name: "role", label: "Rolle", type: "select", options: [["trauzeuge", "Trauzeuge/in"], ["paar", "Brautpaar"]] }, m.role || "trauzeuge")}
         <div class="f full">Farbe<div class="swatches">${COLORS.map((c, i) => `<label><input class="vh" type="radio" name="color" value="${c}" aria-label="Farbe ${i + 1}" ${c === (m.color || COLORS[S.members.length % COLORS.length]) ? "checked" : ""}><span class="avatar" style="background:${c}"></span></label>`).join("")}</div></div>
       </form>
       <div class="form-actions">
         ${isEdit && !self && m.id !== S.me.id ? `<button class="btn danger ghost" data-del>Entfernen</button>` : ""}
         <div class="right"><button class="btn" data-close>Abbrechen</button><button class="btn primary" data-save>Speichern</button></div>
       </div>`,
      {
        onMount: (md) => {
          const form = $("form", md);
          $("[data-save]", md).addEventListener("click", async () => {
            if (!form.reportValidity()) return;
            const vals = { name: form.elements.name.value.trim(), color: form.elements.color.value };
            if (!self) vals.role = form.elements.role.value;
            if (!isEdit) {
              vals.id = vals.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || crypto.randomUUID().slice(0, 8);
              if (member(vals.id)) vals.id += "-" + Math.random().toString(36).slice(2, 5);
            }
            if (isEdit) await q(sb.from("members").update(vals).eq("id", m.id));
            else await q(sb.from("members").insert(vals));
            closeModal(); toast("Gespeichert"); await loadBase(); render();
          });
          $("[data-del]", md)?.addEventListener("click", async () => {
            if (!confirm(`${m.name} wirklich entfernen? Die Person hat danach keinen Zugriff mehr.`)) return;
            await q(sb.from("members").delete().eq("id", m.id));
            closeModal(); await loadBase(); render();
          });
        },
      },
    );
  };
  $("[data-add]", el)?.addEventListener("click", () => memberForm({}));
  if (isCouple()) $$("[data-m]", el).forEach((r) => r.addEventListener("click", () => memberForm(member(r.dataset.m))));
  $("[data-me]", el).addEventListener("click", () => memberForm(S.me, !isCouple()));
  bindInstall(el);
}

// =====================================================================
// Login & Start
// =====================================================================
async function viewLogin(msg = "") {
  const [{ data: names, error }, { data: needsCode }] = await Promise.all([sb.rpc("login_names"), sb.rpc("login_needs_code")]);
  if (error) {
    $("#app").innerHTML = `<div class="login"><div class="inner"><h1>Keine Verbindung</h1><p class="lead">Die Datenbank antwortet nicht: ${h(error.message)}</p><p class="small muted">Prüfe, ob das Schema in Supabase eingespielt ist, und lade die Seite neu.</p></div></div>`;
    return;
  }
  $("#app").innerHTML = `
    <div class="login"><div class="inner">
      <h1>${h(document.title === "Hochzeitsplaner" ? "Unsere Hochzeit" : document.title)}</h1>
      <p class="lead">Wer bist du?</p>
      <form data-login>
        <div class="who" role="radiogroup" aria-label="Person auswählen">${(names || []).map((n) => `<label><input class="vh" type="radio" name="who" value="${h(n.id)}" required><span><span class="avatar" style="background:${h(n.color)}">${h(n.name[0])}</span>${h(n.name)}</span></label>`).join("")}</div>
        ${needsCode ? `<label class="f">Codewort<input type="password" name="code" required autocomplete="current-password" placeholder="Nur beim ersten Mal auf diesem Gerät"></label>` : ""}
        <button class="btn primary">Anmelden</button>
      </form>
      <div class="msg" data-msg>${msg}</div>
    </div></div>`;
  $("[data-login]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("button", e.target);
    const who = e.target.who.value;
    const code = e.target.code?.value || null;
    btn.disabled = true;
    const say = (t) => { const m = $("[data-msg]"); m.textContent = t; m.classList.add("err"); };
    btn.classList.add("busy");
    try {
      let { data: { session } } = await sb.auth.getSession();
      if (!session) {
        const { data, error } = await sb.auth.signInAnonymously();
        if (error) throw new Error(error.message.includes("disabled") ? "Anonyme Anmeldung ist in Supabase noch nicht aktiviert." : error.message);
        session = data.session;
      }
      const { data: ok, error } = await sb.rpc("claim_member", { p_member: who, p_code: code });
      if (error) throw error;
      if (!ok) { say("Das Codewort stimmt nicht. Probier es nochmal."); btn.disabled = false; btn.classList.remove("busy"); return; }
      S.session = session;
      await loadBase();
      render();
    } catch (err) {
      say(err.message); btn.disabled = false; btn.classList.remove("busy");
    }
  });
}

async function loadBase() {
  const [members, settings] = await Promise.all([
    q(sb.from("members").select("*").order("role").order("name")),
    q(sb.from("settings").select("id,title,wedding_date,location,budget_total").eq("id", 1).maybeSingle()),
  ]);
  S.members = members;
  S.settings = settings || {};
  const { data: myId } = await sb.rpc("my_id");
  S.me = members.find((m) => m.id === myId) || null;
  if (S.settings.title) document.title = S.settings.title;
}

async function start() {
  if (SUPABASE_URL.includes("DEIN-PROJEKT")) {
    $("#app").innerHTML = `<div class="login"><div class="inner"><h1>Fast fertig</h1><p class="lead">Trag in config.js die Supabase-URL und den Key ein.</p></div></div>`;
    return;
  }
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  if (!S.session) return viewLogin();
  await loadBase();
  if (!S.me) return viewLogin();
  render();
}

// Tastatur: Enter/Leertaste auf klickbaren Karten
document.addEventListener("keydown", (e) => {
  const t = e.target;
  if ((e.key === "Enter" || e.key === " ") && t.getAttribute?.("role") === "button" && t.tagName !== "BUTTON") { e.preventDefault(); t.click(); }
});
window.addEventListener("hashchange", () => { closeModal(); if (S.me) render(); });
sb.auth.onAuthStateChange((evt) => {
  if (evt === "SIGNED_OUT") { S.session = null; S.me = null; }
});
// Beim Zurückkehren in den Tab aktualisieren (andere haben vielleicht etwas eingetragen)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.me && !$(".overlay")) render();
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

start();
