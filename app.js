/* =========================================================
   Jarvis — l'app.
   Aucune donnée personnelle ici : tout arrive de Supabase
   après connexion, et seul le propriétaire peut les lire.
   ========================================================= */
import { creerVille } from "./ville.js?v=ville5";
import { createClient } from "@supabase/supabase-js";

const SB_URL = "https://uaprtibscyepsabyqcyl.supabase.co";
const SB_KEY = "sb_publishable_qjJRK71zrG1ETae5SBY4Dg_ofD8oeYl"; // clé publique, faite pour être dans une page web
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

const $ = id => document.getElementById(id);
const MOIS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
const nb = t => typeof t === "string" ? t.replace(/ (€|%|h\b|kWh)/g, " $1").replace(/(\d) (\d)/g, "$1 $2") : t;
const eur = n => nb(Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €");
const frd = d => d ? d.slice(0, 10).split("-").reverse().join("/") : "";
const parisDay = (plus = 0) => new Date(Date.now() + plus * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const jour = d => new Date(d + "T12:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const hh = h => (h || "").replace(":", "h");
const quand = up => { const t = new Date(up); return t.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) + " à " + t.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); };
const prenomDe = n => (n || "").split(" ")[0];
const ctr = s => /brotteaux/i.test(s || "") ? "Lyon 6 Brotteaux" : "Villeurbanne";
let toastT; function toast(t) { const e = $("toast"); e.textContent = t; e.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove("on"), 3200); }

/* =========================================================
   Les lieux de la ville (vides tant que tu n'es pas connecté)
   ========================================================= */
const PLACES = [
  { id: "home", emoji: "🏠", color: "#ffd9c7", name: "Chez toi" },
  { id: "garage", emoji: "🚗", color: "#dcd6ea", name: "Ta voiture" },
  { id: "usine", emoji: "🏭", color: "#e8dccf", name: "Ton travail" },
  { id: "impots", emoji: "🏛️", color: "#c9d6e6", name: "Impôts et amendes" },
  { id: "clinique", emoji: "🩺", color: "#ffd0cb", name: "Ta santé" },
  { id: "mairie", emoji: "🪪", color: "#efe0c6", name: "Tes papiers" },
  { id: "banque", emoji: "💶", color: "#fbe7a6", name: "Ton argent" },
  { id: "medecin", emoji: "🍼", color: "#cdebd9", name: "Le bébé" },
  { id: "orange", emoji: "📱", color: "#ffd2ad", name: "Abonnements" },
  { id: "energie", emoji: "⚡", color: "#d9eec0", name: "Gaz et électricité" },
];
PLACES.forEach(p => Object.assign(p, { place: "", status: "…", say: "Je regarde…", facts: [], docs: [], live: "" }));
const byId = Object.fromEntries(PLACES.map(p => [p.id, p]));
const S = { sel: null, night: false, prenom: "", profil: "", patients: [], rdv: [], creneaux: [], loaded: false };

/* =========================================================
   La ville en 3D : la maquette (fichier ville.js).
   L'ancienne ville est gardée sur la branche « ancienne-ville » du dépôt.
   ========================================================= */
const canvas = $("c");
let viewShiftGoal = 0, userMoved = false, V = null;
V = await creerVille(canvas, {
  pick: id => { userMoved = true; if (id === "jarvis") openTalk(null); else if (byId[id]) select(byId[id]); },
  action: (id, a) => { userMoved = true; if (a === "rdv") { openBook(); return; }
    const p = byId[id]; if (!p) return; if (S.sel !== p) select(p);
    if (a === "courrier" || a === "details") { openDetails(); return; }
    if (a === "interphone") { const g = (p.docs || []).find(d => d.t === "Ton gestionnaire"); if (g) openDoc(p, g); else toast("Je n’ai pas encore les coordonnées de ton gestionnaire."); return; }
    if (a === "fenetre") { const e = etatMaison(p), c = coupureDe(p);
      toast(e.etat === "coupure" ? "Coupure en cours" + (c ? " jusqu’à " + c.d1.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "")
        : e.etat === "veille" ? "Coupure d’électricité demain" + (c ? " à " + c.d0.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "")
        : e.etat === "rouge" ? "Il reste un montant à régler chez Foncia" : "Tout va bien chez toi" + (p.status ? " · " + p.status : "")); } },
  progress: t => { const b = $("briefTxt"); if (b && !S.loaded) b.textContent = t; },
  frame: () => V && V.decalage(viewShiftGoal),
});
V.controls.addEventListener("start", () => { userMoved = true; });
PLACES.forEach(p => { p.color = V.couleur(p.id) || p.color; });
const icone = (el, p) => { el.innerHTML = V.icone(p.id); el.classList.add("svgic"); };
function overview() { V.ensemble(); }

/* ---------- Jour et nuit ---------- */
const SKY = {
  day: { s1: "#cdd8e2", s2: "#e9eef3", theme: "#cdd8e2" },
  night: { s1: "#0b0f1d", s2: "#1a2233", theme: "#0b0f1d" },
};
function applySky(night) {
  S.night = night; const k = night ? SKY.night : SKY.day;
  document.body.style.setProperty("--sky1", k.s1); document.body.style.setProperty("--sky2", k.s2);
  document.body.classList.toggle("night", night);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", k.theme);
  V.setNuit(night);
  $("skyIc").innerHTML = night ? '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>'
    : '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>';
}
{ const h = new Date().getHours(); applySky(h < 7 || h >= 19); }
$("sky").addEventListener("click", () => applySky(!S.night));

/* =========================================================
   Les lieux dans la ville : mâts 3D et panneaux sur les façades (dans ville.js).
   L'app leur envoie les vraies données à chaque mise à jour.
   ========================================================= */
const briefEl = $("brief");
let talkOpen = false;
/* Chez toi : état de la fenêtre (ok / rouge / veille / coupure) et courrier nouveau */
const MOISN = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
function coupureDe(p) { const a = (p.docs || []).find(d => d.alerteId && /coupure/i.test(d.t)); if (!a) return null;
  const m = a.t.match(/(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)/i); if (!m) return null;
  const mi = MOISN.findIndex(x => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "") === m[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")); if (mi < 0) return null;
  const h = a.t.match(/(\d{1,2})\s*h\s*(\d{2})?\s*[–-]\s*(\d{1,2})\s*h\s*(\d{2})?/);
  const now = new Date(), y = now.getFullYear(); const d0 = new Date(y, mi, Number(m[1]), h ? Number(h[1]) : 0, h && h[2] ? Number(h[2]) : 0), d1 = new Date(y, mi, Number(m[1]), h ? Number(h[3]) : 23, h && h[4] ? Number(h[4]) : 59);
  return { d0, d1, a }; }
function etatMaison(p) { const now = new Date(), c = coupureDe(p); let etat = p.retard ? "rouge" : "ok";
  if (c) { if (now >= c.d0 && now <= c.d1) etat = "coupure"; else if (now < c.d0 && c.d0 - now < 36 * 3600e3 && etat === "ok") etat = "veille"; }
  const semaine = Date.now() - 7 * 864e5;
  const nouveau = (p.docs || []).filter(d => (d.alerteId && !/coupure/i.test(d.t)) || (d.ts && d.ts > semaine)).length;
  const gest = (p.docs || []).find(d => d.t === "Ton gestionnaire");
  return { etat, nouveau, gest: gest ? gest.v : "" }; }
function refreshPins() {
  V.setDonnees(PLACES.map(p => ({ id: p.id, n: p.name, c: p.color, place: p.place, status: p.status, say: p.say, facts: p.facts || [],
    alerts: (p.docs || []).filter(d => d.alerteId).map(d => ({ t: d.t.replace(/^⚠︎\s*/, ""), d: d.d })),
    nDocs: (p.docs || []).filter(d => !d.alerteId).length, urgent: !!p.urgent, ...(p.id === "home" ? etatMaison(p) : {}), ...(p.id === "usine" ? { enPoste: !!p.enPoste, aujTxt: p.aujTxt || "", demTxt: p.demTxt || "", semaine: p.semaine || [], compteurs: p.compteurs || {} } : {}), ...(p.id === "orange" ? { hf: !!p.hf, nextBill: p.nextBill || null, lastBill: p.lastBill || null } : {}), ...(p.id === "clinique" ? { prochain: p.prochain || null, liste: p.liste || [] } : {}) })));
}

/* =========================================================
   Fiche d'un lieu
   ========================================================= */
const sheet = $("sheet");
function select(p) {
  S.sel = p; closeTalk(true); closeBook(true); closeSettings(true);
  sheet.classList.remove("open"); viewShiftGoal = 0;
  V.ouvrir(p.id);
  const bar = $("lieubar"); bar.style.setProperty("--c", p.color);
  icone($("lbIc"), p); $("lbName").textContent = p.name; $("lbSub").textContent = p.status || p.place || "";
  $("lbDot").hidden = !p.urgent;
  const nd = (p.docs || []).length; $("lbGo").textContent = nd ? (innerWidth < 420 ? "Papiers ›" : `Papiers · ${nd} ›`) : "Actions ›";
  bar.classList.add("on"); $("ask").classList.add("away");
}
function openDetails() {
  const p = S.sel; if (!p) return;
  $("card").style.setProperty("--c", p.color); $("pIc").style.setProperty("--c", p.color); icone($("pIc"), p);
  $("pPlace").textContent = p.place; $("pName").textContent = p.name;
  renderSheet(p); viewShiftGoal = 1;
  sheet.classList.add("open"); $("lieubar").classList.remove("on");
}
function closeDetails() { sheet.classList.remove("open"); viewShiftGoal = 0; if (S.sel) $("lieubar").classList.add("on"); }
const pas = d => { const i = S.sel ? PLACES.indexOf(S.sel) : -1; select(PLACES[(i + d + PLACES.length) % PLACES.length]); };
$("lbPrev").addEventListener("click", () => pas(-1));
$("lbNext").addEventListener("click", () => pas(1));
$("lbMore").addEventListener("click", openDetails);
$("lbClose").addEventListener("click", () => { deselect(); });
function renderSheet(p) {
  const box = $("pDocs"); box.innerHTML = ""; const docs = p.docs || [];
  if (p.id === "usine" && (p.semaine || []).length) {   // la semaine et les compteurs (en jours, jamais d’argent)
    const JR = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"], NM = { M: "M", A: "A", N: "N", R: "R", J: "?" }, w = document.createElement("div");
    w.innerHTML = '<div class="dh"><b>Les 7 prochains jours</b><span>M matin · A après-midi · N nuit</span></div><div class="wk"></div><div class="dh"><b>Tes compteurs</b><span></span></div><div class="cpt"></div>';
    const wk = w.querySelector(".wk");
    p.semaine.forEach((o, i) => { const c = ["conge", "rc", "maladie"].includes(o.g) ? "C" : (o.poste || "R"), d = new Date(o.d + "T12:00:00"), e = document.createElement("div");
      e.className = "wd" + (i === 0 ? " auj" : ""); e.innerHTML = `<small>${i === 0 ? "auj." : JR[d.getDay()]} ${d.getDate()}</small><b class="p${c}">${c === "C" ? "C" : NM[c] || c}</b><em>${o.sup ? "sup" : o.rem ? "remonte" : ""}</em>`; wk.append(e); });
    const C = p.compteurs || {}, j = v => v == null ? "—" : String(Math.round(v * 100) / 100).replace(".", ",") + " j";
    const L = [["Congés payés", j(C.cp), "restants"], ["COR", j(C.cor), C.cor_janvier != null ? "≈ " + j(C.cor_janvier) + " en janvier" : ""], ["RC8", j(C.rc8), C.rc8_prochain ? "prochain fin " + C.rc8_prochain : ""],
      ["CET", j(C.cet), C.cm ? "+ " + j(C.cm) + " médaille" : ""], ["Remonte", C.remonte ? j(C.remonte.reste) : "—", C.remonte && C.remonte.prevu != null ? "restants sur " + j(C.remonte.prevu) : ""]];
    const cp = w.querySelector(".cpt"); L.forEach(([t, v, s]) => { const r = document.createElement("div"); r.className = "cr"; r.innerHTML = "<span><b></b><small></small></span><strong></strong>";
      r.querySelector("b").textContent = t; r.querySelector("small").textContent = s; r.querySelector("strong").textContent = v; cp.append(r); });
    if (C.extrait) w.querySelectorAll(".dh span")[1].textContent = "relevé du " + new Date(C.extrait).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    box.append(w);
  }
  if (docs.length > 6) { const q = document.createElement("input"); q.className = "dsearch"; q.type = "search"; q.placeholder = "Chercher un papier (ex. octobre, quittance)";
    q.addEventListener("input", () => { const v = q.value.trim().toLowerCase(); box.querySelectorAll(".doc").forEach(b => b.hidden = v && !b.textContent.toLowerCase().includes(v)); }); box.append(q); }
  const dh = document.createElement("div"); dh.className = "dh"; dh.innerHTML = "<b>Papiers rangés</b><span></span>";
  dh.querySelector("span").textContent = docs.length ? docs.length + (docs.length > 1 ? " papiers" : " papier") : ""; box.append(dh);
  if (!docs.length) { const e = document.createElement("div"); e.className = "empty"; e.textContent = "Rien pour l’instant"; box.append(e); }
  docs.forEach(d => { const b = document.createElement("button"); b.className = "doc" + (d.future ? " soon" : "");
    b.innerHTML = '<span class="pg"></span><span class="dt"><b></b><span></span></span><span class="dv"></span><span class="chev">›</span>';
    b.querySelector(".dt b").textContent = d.t; b.querySelector(".dt span").textContent = d.d; b.querySelector(".dv").textContent = d.v || "";
    b.addEventListener("click", () => openDoc(p, d)); box.append(b); });
  $("pNote").textContent = p.live || "";
  $("card").scrollTop = 0;
  $("card").style.setProperty("--c", p.color);
  const acts = $("pActs"); acts.innerHTML = "";
  const mk = (t, c, fn) => { const b = document.createElement("button"); b.className = "btn " + c; b.textContent = t; b.addEventListener("click", fn); acts.append(b); return b; };
  if (p.id === "clinique") {
    mk("Prendre rendez-vous", "main", () => openBook());
    const u = mk("Mettre à jour", "soft", async () => { u.disabled = true; u.textContent = "Je regarde…"; await medin({ action: "sync" }, true); u.disabled = false; u.textContent = "Mettre à jour"; });
  } else mk("Demander à Jarvis", "soft wide", () => openTalk(p));
}
function deselect() { if (!S.sel) return; S.sel = null; sheet.classList.remove("open"); $("lieubar").classList.remove("on"); $("ask").classList.remove("away"); viewShiftGoal = 0; V.fermer(); }
$("pClose").addEventListener("click", closeDetails);
$("home").addEventListener("click", () => { deselect(); closeTalk(); closeBook(); closeSettings(); overview(); });
function swipeClose(el, fn) { let y0 = null;
  // on ne ferme qu'en tirant la poignée ou l'en-tête vers le bas : le reste de la fenêtre défile librement
  el.addEventListener("pointerdown", e => { if (!e.target.closest(".grab,.head") || e.target.closest("button,input,a")) return; y0 = e.clientY; });
  el.addEventListener("pointerup", e => { if (y0 !== null && e.clientY - y0 > 50) fn(); y0 = null; });
  el.addEventListener("pointercancel", () => y0 = null); }
swipeClose($("card"), closeDetails);

/* ---------- Un papier ---------- */
async function openDoc(p, d) {
  $("paper").style.setProperty("--c", p.color); $("dD").textContent = p.name + (d.d ? " · " + d.d : ""); $("dT").textContent = d.t;
  $("dV").textContent = d.v || ""; $("dV").hidden = !d.v;
  const L = $("dL"); L.innerHTML = "";
  (d.lines || []).forEach(([a, b]) => { const r = document.createElement("div"); r.className = "row"; const x = document.createElement("span"); x.textContent = a; const y = document.createElement("b"); y.textContent = b; r.append(x, y); L.append(r); });
  $("dW").textContent = (/Mac|Téléchargements/.test(d.where || "") ? "Sur ton Mac : " : "Rangé dans : ") + (d.where || "Jarvis");
  const pdf = $("dPdf"), x = $("dX");
  pdf.hidden = true; x.hidden = true; x.textContent = "Annuler ce rendez-vous"; x.dataset.step = "";
  if (d.tel) { pdf.hidden = false; pdf.href = "tel:" + d.tel.replace(/\s/g, ""); pdf.textContent = "Appeler " + d.tel; pdf.removeAttribute("target"); }
  if (d.url) { pdf.hidden = false; pdf.href = d.url; pdf.textContent = "Ouvrir le mail dans Outlook"; pdf.target = "_blank"; pdf.rel = "noopener"; }
  if (d.path) {
    pdf.hidden = false; pdf.textContent = "Je prépare le PDF…"; pdf.removeAttribute("href"); pdf.classList.add("wait"); pdf.target = "_blank";
    const { data, error } = await sb.storage.from("papiers").createSignedUrl(d.path, 600);
    pdf.classList.remove("wait");
    if (error || !data) pdf.textContent = "PDF introuvable";
    else { pdf.href = data.signedUrl; pdf.textContent = "Ouvrir le PDF"; }
  }
  x.dataset.mode = "";
  if (d.cancelId) { x.hidden = false; x.dataset.id = d.cancelId; }
  if (d.alerteId) { x.hidden = false; x.dataset.id = d.alerteId; x.dataset.mode = "alerte"; x.textContent = "C’est vu, enlever l’alerte"; }
  $("paperwrap").classList.add("open");
}
$("dX").addEventListener("click", async e => {
  e.preventDefault(); const x = $("dX");
  if (x.dataset.mode === "alerte") {
    if (x.dataset.step === "busy") return; x.dataset.step = "busy"; x.textContent = "J’enlève l’alerte…";
    const { error } = await sb.rpc("jarvis_alerte_vue", { p_id: Number(x.dataset.id) });
    x.textContent = error ? "Pas enlevée : " + error.message : "Alerte enlevée ✓";
    if (!error) { setTimeout(() => $("paperwrap").classList.remove("open"), 900); loadAll(); }
    return;
  }
  if (x.dataset.step !== "sure") { x.dataset.step = "sure"; x.textContent = "Touche encore pour confirmer l’annulation"; x.classList.add("danger"); return; }
  x.dataset.step = "busy"; x.textContent = "J’annule sur MédinLyon…"; x.classList.remove("danger");
  const r = await medin({ action: "annuler", id: x.dataset.id });
  x.textContent = r && r.ok ? "Annulé ✓" : "Pas annulé";
  if (r && r.ok) setTimeout(() => $("paperwrap").classList.remove("open"), 1200);
});
$("dClose").addEventListener("click", () => $("paperwrap").classList.remove("open"));
$("paperwrap").addEventListener("click", e => { if (e.target.id === "paperwrap") $("paperwrap").classList.remove("open"); });

/* ---------- Le mot du haut ---------- */
function updateBrief() {
  const h = new Date().getHours(), n = PLACES.reduce((a, p) => a + (p.docs || []).length, 0);
  $("hello").textContent = (h >= 5 && h < 18 ? "Bonjour" : "Bonsoir") + (S.prenom ? " " + S.prenom : "") + (n ? " · " + n + " papiers rangés" : "");
  const u = aRegarder();
  $("brief").classList.toggle("calm", !u.length);
  $("briefTxt").textContent = !S.loaded ? "Je charge ta ville…" : u.length ? (u.length === 1 ? u[0].p.name + " : " + u[0].titre : u.length + " choses à regarder") : (S.next || "Tout est en ordre");
}
/* Tout ce qui est à regarder : chaque alerte (mails) + les lieux en rouge sans alerte précise */
function aRegarder() {
  const out = [];
  PLACES.filter(p => p.urgent).forEach(p => {
    const al = (p.docs || []).filter(d => d.alerteId);
    if (al.length) al.forEach(d => out.push({ p, d, titre: d.t.replace(/^⚠︎\s*/, ""), quand: d.d }));
    else out.push({ p, d: null, titre: p.status, quand: "" });
  });
  return out;
}
function allerA(x) {
  $("alertwrap").classList.remove("open");
  select(x.p); openDetails();
  if (x.d) setTimeout(() => openDoc(x.p, x.d), 750);
}
function ouvrirListe() {
  const u = aRegarder();
  if (!u.length) { select((S.nextPlace && byId[S.nextPlace]) || byId.home); return; }
  if (u.length === 1) { allerA(u[0]); return; }
  const L = $("alertList"); L.innerHTML = "";
  $("alertT").textContent = u.length + " choses à regarder";
  u.forEach(x => {
    const b = document.createElement("button"); b.type = "button"; b.className = "alertItem"; b.style.setProperty("--c", x.p.color);
    const ic = document.createElement("span"); ic.className = "aic svgic"; ic.innerHTML = V.icone(x.p.id);
    const t = document.createElement("span"); t.className = "atx";
    const n = document.createElement("small"); n.textContent = x.p.name + (x.quand ? " · " + x.quand : "");
    const h = document.createElement("b"); h.textContent = x.titre;
    const go = document.createElement("span"); go.className = "ago"; go.textContent = "›";
    t.append(n, h); b.append(ic, t, go);
    b.addEventListener("click", () => allerA(x));
    L.append(b);
  });
  $("alertwrap").classList.add("open");
}
$("brief").addEventListener("click", ouvrirListe);

/* =========================================================
   Les données (Supabase, en direct)
   ========================================================= */
/* Salaires et soldes : jamais affichés à l'écran. Ils restent dans Supabase,
   et Jarvis ne les donne dans le chat que si on les lui demande. */
const ARGENT = /pai[ew]|paye|salaire|moyenne|solde|touch[ée]|net à payer/i;
const garde = (p, t) => { p.prive = p.prive || []; if (t && !p.prive.includes(t)) p.prive.push(t); };
function cacheArgent(p) {
  p.facts = (p.facts || []).filter(f => { if (ARGENT.test(f[0])) { garde(p, f[0] + " : " + f[1]); return false; } return true; });
  if (p.say && /€/.test(p.say) && ARGENT.test(p.say)) { garde(p, p.say); p.say = "Tes montants restent cachés : demande-les-moi dans le chat."; }
  if (p.status && /€/.test(p.status) && ARGENT.test(p.status)) { garde(p, p.status); p.status = "Montants cachés"; }
  p.docs = (p.docs || []).map(d => {
    if (!/bulletin|paie|salaire/i.test(d.t || "")) return d;
    const sous = [d.v, ...(d.lines || []).filter(l => /€/.test(l[1] || "")).map(l => l.join(" "))].filter(x => x && /€/.test(x));
    if (sous.length) garde(p, `${d.t} ${d.d || ""} : ${sous.join(", ")}`);
    return { ...d, v: /€/.test(d.v || "") ? "PDF" : d.v, lines: (d.lines || []).filter(l => !/€/.test(l[1] || "")) };
  });
  if (p.macDocs) p.macDocs = p.macDocs.map(d => /bulletin|paie|salaire/i.test(d.t || "") ? { ...d, v: /€/.test(d.v || "") ? "PDF" : d.v, lines: (d.lines || []).filter(l => !/€/.test(l[1] || "")) } : d);
}
function applyMac(rows) {
  rows.filter(r => r.kind === "lieu").forEach(r => {
    const p = byId[r.label]; if (!p) return; const d = r.data || {};
    if (r.label === "clinique") { p.macDocs = d.docs || []; return; }
    if (r.label === "home" || r.label === "energie") { p.macDocs = d.docs || []; p.docs = [...p.macDocs]; return; }
    Object.assign(p, { place: d.place || p.place, status: d.status || p.status, say: d.say || p.say, facts: d.facts || [], docs: d.docs || [],
      live: (d.docs || []).length ? "D’après tes papiers trouvés sur ton Mac" : "Pas encore branché" });
    cacheArgent(p);
  });
  const prof = rows.find(r => r.source === "jarvis" && r.kind === "profil");
  if (prof) { S.prenom = prof.data?.prenom || ""; S.profil = prof.data?.texte || ""; }
}
const stamp = (rows, qui) => { const up = rows.map(r => r.updated_at).filter(Boolean).sort().pop(); return up ? "En direct · " + qui + " le " + quand(up) : ""; };

function applyEnergie(rows) {
  const e = byId.energie; if (!rows.length) { e.status = "À brancher"; e.say = "Plenitude n’est pas encore relu."; return; }
  const today = new Date().toISOString().slice(0, 10), ENS = ["Gaz", "Électricité"];
  const conso = Object.fromEntries(rows.filter(r => r.kind === "conso").map(r => [r.label, r.data]));
  const plan = Object.fromEntries(rows.filter(r => r.kind === "echeancier").map(r => [r.label, r]));
  const sorted = k => rows.filter(r => r.kind === k && r.date).sort((a, b) => a.date.localeCompare(b.date));
  const pay = sorted("paiement"), ech = sorted("echeance").filter(r => r.date >= today);
  const next = {}; ENS.forEach(n => next[n] = ech.find(r => r.label === n));
  const tot = ENS.reduce((a, n) => a + (next[n] ? Number(next[n].amount) : 0), 0);
  const dern = {}; ENS.forEach(n => dern[n] = pay.filter(r => r.label === n).slice(-1)[0]);
  const mois = d => MOIS[Number(d.slice(5, 7)) - 1];
  e.place = "Plenitude";
  e.status = tot ? eur(tot) + " par mois" : "—";
  let say = tot ? `À partir de ${mois(next.Gaz?.date || next["Électricité"].date)}, tu paies ${eur(tot)} par mois : ${next.Gaz ? eur(next.Gaz.amount) + " de gaz" : ""}${next.Gaz && next["Électricité"] ? " et " : ""}${next["Électricité"] ? eur(next["Électricité"].amount) + " d’électricité" : ""}.` : "Pas d’échéancier Plenitude relu.";
  if (dern.Gaz && next.Gaz && Number(dern.Gaz.amount) > Number(next.Gaz.amount) + 1) {
    const hauts = pay.filter(r => r.label === "Gaz" && Number(r.amount) > Number(next.Gaz.amount) + 1);
    const trop = hauts.reduce((a, r) => a + Number(r.amount) - Number(next.Gaz.amount), 0);
    say += ` Le gaz a été prélevé à ${eur(dern.Gaz.amount)} en ${hauts.map(r => mois(r.date)).join(" et ")} : environ ${eur(trop)} de plus que l’échéancier. À surveiller sur la prochaine facture.`;
  }
  e.say = nb(say);
  const pf = (plan.Gaz || plan["Électricité"])?.data?.prochaine_facture;
  e.facts = [["Gaz", next.Gaz ? eur(next.Gaz.amount) + " par mois" : "—"], ["Électricité", next["Électricité"] ? eur(next["Électricité"].amount) + " par mois" : "—"], ["Prochaine facture", pf ? frd(pf) : "—"]];
  const d = [];
  ENS.forEach(n => { const p = plan[n], l = ech.filter(r => r.label === n); if (!l.length) return;
    d.push({ t: "Échéancier " + n.toLowerCase(), d: `${mois(l[0].date)} ${l[0].date.slice(0, 4)} → ${mois(l.slice(-1)[0].date)} ${l.slice(-1)[0].date.slice(0, 4)}`, v: eur(l[0].amount), where: "Espace client Plenitude",
      lines: [["Offre", p?.data?.offre || "—"], ["Consommation estimée", p?.data?.conso_annuelle_kwh ? nb(p.data.conso_annuelle_kwh.toLocaleString("fr-FR") + " kWh par an") : "—"], ...l.map(r => [frd(r.date), eur(r.amount)])] }); });
  ENS.forEach(n => { const l = pay.filter(r => r.label === n).reverse(); if (!l.length) return;
    d.push({ t: "Prélèvements " + n.toLowerCase(), d: "Déjà payés", v: eur(l[0].amount), where: "Espace client Plenitude", lines: l.map(r => [frd(r.date), eur(r.amount)]) }); });
  const el = conso["Électricité"], gz = conso["Gaz"];
  if (el) d.push({ t: "Consommation électricité", d: (el.mois || []).join(" et "), v: nb(el.kwh.slice(-1)[0] + " kWh"), where: "Espace client Plenitude", lines: (el.mois || []).map((m, i) => [m, nb(el.kwh[i] + " kWh")]) });
  if (gz) d.push({ t: "Consommation gaz", d: (gz.mois || []).join(" et "), v: nb(gz.kwh.slice(-1)[0] + " kWh"), where: "Espace client Plenitude", lines: (gz.mois || []).map((m, i) => [m, nb(gz.kwh[i] + " kWh")]) });
  e.docs = [...d, ...(e.macDocs || [])]; e.live = stamp(rows, "relu chez Plenitude");
}

function applyFoncia(rows) {
  const h = byId.home; if (!rows.length) { h.status = "À brancher"; return; }
  const by = k => rows.filter(r => r.kind === k);
  const per = l => { const m = l.match(/(\d{2})[ _-](\d{2})[ _-](\d{4})/); return m ? MOIS[Number(m[2]) - 1] + " " + m[3] : ""; };
  const nice = (l, cat) => { const b = l.replace(/\.pdf$/i, "").replace(/_/g, " ");
    if (/^quittance/i.test(b)) return "Quittance · " + per(l);
    if (/^avis d.?[ée]ch[ée]ance/i.test(b)) return "Avis d’échéance · " + per(l);
    if (/^AS \d{4}(\d{2})/.test(b)) { const m = b.match(/^AS (\d{4})(\d{2})/); return "Avis d’échéance · " + MOIS[Number(m[2]) - 1] + " " + m[1]; }
    if (/r[ée]gularisation/i.test(b)) { const y = b.match(/(\d{4})\D+(\d{4})/); return "Régularisation des charges" + (y ? " " + y[1] + "-" + y[2] : ""); }
    if (/^r[ée]vision loyer/i.test(b)) return "Révision de loyer · " + (b.match(/(\d{4})/) || [""])[0];
    if (/ASSURIMO|assurance/i.test(b)) return "Assurance habitation";
    if (/^dpe/i.test(b)) return "Diagnostic de performance énergétique";
    if (/^plan$/i.test(b)) return "Plan du logement";
    if (/^FACT/i.test(b)) return "Facture Foncia";
    return cat ? cat + " · " + b.slice(0, 30) : b; };
  const ops = by("operation").filter(r => r.date).sort((a, b) => b.date.localeCompare(a.date));
  const appels = ops.filter(r => /^APPEL/i.test(r.label));
  const prel = by("paiement").filter(r => r.date).sort((a, b) => b.date.localeCompare(a.date));
  const solde = by("compte")[0], gest = (by("contact")[0] || {}).data || {}, lots = by("lot");
  const loyer = appels[0] ? Math.abs(Number(appels[0].amount)) : null;
  const docs = by("document").sort((a, b) => (b.data?.ajoute_le || "").split("/").reverse().join("").localeCompare((a.data?.ajoute_le || "").split("/").reverse().join("")));
  const quitt = docs.filter(d => /quittance/i.test(d.label));
  const sold = solde && solde.amount != null ? Number(solde.amount) : null;
  h.urgent = sold != null && sold < 0; h.retard = h.urgent;
  const res = ((by("logement")[0] || {}).data || {}).residence;
  h.place = "Foncia" + (res ? " · " + res.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()) : "");
  h.status = loyer ? `Loyer ${eur(loyer)} · ${sold === 0 ? "à jour" : sold < 0 ? "à régler" : "en avance"}` : "À jour";
  h.say = nb(`Ton loyer est de ${eur(loyer || 0)} par mois${prel[0] ? `, le dernier prélèvement est passé le ${frd(prel[0].date)}` : ""}. ${sold === 0 ? "Tu es à jour." : sold < 0 ? "Il reste un montant à régler." : ""} J’ai rangé tes ${docs.length} papiers Foncia${quitt[0] ? `, dont la quittance de ${per(quitt[0].label)}` : ""}.`.replace(/\s+/g, " ").trim());
  h.facts = [["Loyer + charges", loyer ? eur(loyer) + " par mois" : "—"], ["Solde du compte", sold != null ? eur(sold) + (sold === 0 ? ", à jour" : "") : "—"]];
  const d = [];
  if (gest.nom) d.push({ t: "Ton gestionnaire", d: gest.agence || "Foncia", v: gest.nom, where: "MyFoncia", lines: [["Nom", gest.nom], ["Agence", gest.agence || "—"], ["Adresse", gest.adresse || "—"], ["Téléphone", gest.telephone || "—"]], tel: gest.telephone });
  if (lots.length) d.push({ t: "Ton logement", d: `${lots.length} lots`, v: "", where: "MyFoncia", lines: lots.map(l => [l.label, l.data?.tantiemes || ""]) });
  if (ops.length) d.push({ t: "Comptabilité", d: `${ops.length} opérations`, v: loyer ? eur(loyer) : "", where: "MyFoncia", lines: ops.slice(0, 10).map(r => [frd(r.date) + " · " + r.label.toLowerCase().replace(/^./, c => c.toUpperCase()).slice(0, 34), (Number(r.amount) > 0 ? "+" : "") + eur(r.amount)]) });
  by("intervention").forEach(r => d.push({ t: "Intervention", d: frd(r.date), v: r.data?.statut || "", where: "MyFoncia", lines: [["Objet", r.label.toLowerCase().replace(/^./, c => c.toUpperCase())], ["Statut", r.data?.statut || "—"]] }));
  docs.forEach(r => d.push({ ts: (() => { const m = (r.data?.ajoute_le || "").match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : 0; })(), t: nice(r.label, r.data?.categorie).slice(0, 60), d: "Ajouté le " + (r.data?.ajoute_le || "—"), v: "PDF", where: "Jarvis › papiers › Foncia",
    lines: [["Catégorie", r.data?.categorie || "—"], ["Ajouté le", r.data?.ajoute_le || "—"]], path: r.data?.path ? "foncia/" + r.data.path : null }));
  h.docs = [...d, ...(h.macDocs || [])]; h.live = stamp(rows, "relu par ton iPhone");
  cacheArgent(h);
}

function applySante(rows) {
  const p = byId.clinique;
  const rdv = rows.filter(r => r.kind === "rdv").map(r => r.data).filter(r => r && r.statut !== "annule")
    .map(r => ({ ...r, statut: r.date >= parisDay() ? "a_venir" : "passe" }))
    .sort((a, b) => (b.date + b.heure).localeCompare(a.date + a.heure));
  S.rdv = rdv;
  S.creneaux = rows.filter(r => r.kind === "creneaux");
  S.patients = ((rows.find(r => r.kind === "patients") || {}).data || {}).liste || [];
  const fut = rdv.filter(r => r.statut === "a_venir").sort((a, b) => (a.date + a.heure).localeCompare(b.date + b.heure));
  const nxt = fut[0], last = rdv.find(r => r.statut === "passe");
  p.place = "MédinLyon · Villeurbanne et Brotteaux";
  p.status = nxt ? `RDV ${nxt.date === parisDay() ? "aujourd’hui" : nxt.date === parisDay(1) ? "demain" : jour(nxt.date)} à ${hh(nxt.heure)}` : "Aucun rendez-vous prévu";
  p.say = nxt ? `Prochain rendez-vous : ${nxt.patient}, ${jour(nxt.date)} à ${hh(nxt.heure)}, centre ${ctr(nxt.centre)}.${fut.length > 1 ? ` Et ${fut.length - 1} autre${fut.length > 2 ? "s" : ""} après.` : ""}`
    : `Aucun rendez-vous prévu pour la famille.${last ? ` Le dernier, c’était ${prenomDe(last.patient)} le ${frd(last.date)}.` : ""} Touche « Prendre rendez-vous » : je te demande pour qui, où et quand, et je réserve après ta confirmation.`;
  p.facts = [["Rendez-vous", `${fut.length} à venir · ${rdv.length - fut.length} passés`], ["Famille sur le compte", (S.patients.length || new Set(rdv.map(r => r.patient)).size) + " personnes"]];
  const d = [];
  fut.forEach(r => d.push({ t: "Rendez-vous · " + r.patient, d: frd(r.date) + " à " + hh(r.heure), v: "À venir", future: true, where: "MédinLyon",
    lines: [["Pour", r.patient], ["Quand", jour(r.date) + " à " + hh(r.heure)], ["Centre", ctr(r.centre)]], path: r.chemin || null, cancelId: r.id }));
  rdv.filter(r => r.statut === "passe").forEach(r => d.push({ t: (r.chemin ? "Justificatif · " : "Consultation · ") + r.patient, d: frd(r.date) + " à " + hh(r.heure), v: r.chemin ? "PDF" : "", where: "MédinLyon",
    lines: [["Pour", r.patient], ["Centre", ctr(r.centre)], ["Statut", "Terminé"], ["Justificatif", r.chemin ? "PDF rangé ici" : "Plus gardé par MédinLyon"]], path: r.chemin || null }));
  p.docs = [...d, ...(p.macDocs || [])];
  p.live = stamp(rows.filter(r => r.kind === "rdv"), "MédinLyon relu") || "MédinLyon pas encore relu";
  if (nxt) { S.next = p.status; S.nextPlace = "clinique"; }
  // pour la ville : le prochain rendez-vous et la liste de la salle d'attente
  const jc = d => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  p.prochain = nxt ? { qui: prenomDe(nxt.patient), quand: jc(nxt.date) + " · " + hh(nxt.heure), centre: ctr(nxt.centre) } : null;
  p.liste = [...fut.slice(0, 3).map(r => ({ qui: prenomDe(r.patient), quand: jc(r.date) + " · " + hh(r.heure), futur: true })),
             ...rdv.filter(r => r.statut === "passe").slice(0, 4).map(r => ({ qui: prenomDe(r.patient), quand: jc(r.date), futur: false }))].slice(0, 5);
}


/* ---------- Ton travail : le planning 5x8 envoyé par Mon Planning ---------- */
const POSTE_J = { M: "Matin · 4h–12h", A: "Après-midi · 12h–20h", N: "Nuit · 20h–4h", R: "Repos", J: "Poste à fixer par le chef" };
const lc = t => t.charAt(0).toLowerCase() + t.slice(1);
function ditJ(o) {
  if (!o) return "—"; const f = o.ferie ? ` (${o.ferie})` : "";
  if (o.g === "conge") return "Congé payé" + f; if (o.g === "rc") return "Récup" + f; if (o.g === "maladie") return "Maladie" + f;
  if (o.sup) return "Jour sup · " + (POSTE_J[o.poste] || o.poste) + f;
  if (o.poste === "R") return (o.rem ? "Repos · remonte" : "Repos") + f;
  return (POSTE_J[o.poste] || o.poste) + f;
}
function applyPlanning(rows) {
  S.planningTxt = "";
  const r = rows.find(x => x.source === "planning" && x.kind === "etat"), P = r && r.data; if (!P || !(P.jours || []).length) return;
  const p = byId.usine, m = (rows.find(x => x.source === "mac" && x.kind === "lieu" && x.label === "usine") || {}).data || {};
  const J = Object.fromEntries(P.jours.map(o => [o.d, o])), td = parisDay(), fut = P.jours.filter(o => o.d > td), auj = J[td], dem = J[parisDay(1)];
  let say = `Aujourd’hui : ${lc(ditJ(auj))}. Demain : ${lc(ditJ(dem))}.`;
  const facts = [["Aujourd’hui", ditJ(auj)], ["Demain", ditJ(dem)]];
  if (auj && auj.rem) { const fin = fut.find(o => !o.rem && o.poste !== "R" && !["conge", "rc", "maladie"].includes(o.g)); if (fin) { say += ` Tu es en remonte, reprise ${jour(fin.d)}.`; facts.push(["Reprise", jour(fin.d) + " · " + lc(ditJ(fin))]); } }
  else { const rem = fut.find(o => o.rem); if (rem) facts.push(["Prochaine remonte", "à partir du " + jour(rem.d)]); }
  const sup = fut.filter(o => o.sup); if (sup.length) facts.push(["Jours sup prévus", sup.slice(0, 4).map(o => frd(o.d).slice(0, 5)).join(", ")]);
  // les compteurs en jours (jamais d’argent à l’écran : la paye, il la demande dans le chat)
  { const c = P.compteurs || {}, j = v => v == null ? null : String(Math.round(v * 100) / 100).replace(".", ",") + " j";
    if (j(c.cp)) facts.push(["Congés payés (CP)", j(c.cp) + " restants"]);
    if (j(c.cor)) facts.push(["COR", j(c.cor) + (c.cor_janvier != null ? ` · ≈ ${j(c.cor_janvier)} en janvier` : "")]);
    if (j(c.rc8)) facts.push(["RC8", j(c.rc8) + (c.rc8_prochain ? ` · prochain fin ${c.rc8_prochain}` : "")]);
    if (j(c.cet)) facts.push(["CET", j(c.cet) + (c.cm ? ` + ${j(c.cm)} médaille` : "")]);
    if (c.remonte && c.remonte.reste != null) facts.push(["Remonte", `${j(c.remonte.reste)} restants sur ${j(c.remonte.prevu)}`]); }
  p.status = "Aujourd’hui : " + lc(ditJ(auj).split(" · ")[0]);
  const mc = { say: m.say, facts: m.facts || [] }; cacheArgent(mc); (mc.prive || []).forEach(t => garde(p, t));
  p.say = say + (mc.say ? " " + mc.say : "");
  p.facts = [...facts, ...mc.facts]; cacheArgent(p);
  p.live = "En direct · Mon Planning le " + quand(r.updated_at);
  { const plages = t => [...String(t || "").matchAll(/(\d{1,2})h\s*[-–]\s*(\d{1,2})h/g)].map(m => [+m[1], +m[2]]);
    const h = +new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }).slice(0, 2), hier = J[parisDay(-1)];
    p.enPoste = plages(ditJ(auj)).some(([a, b]) => b > a ? h >= a && h < b : h >= a) || plages(hier && ditJ(hier)).some(([a, b]) => b < a && h < b);
    p.aujTxt = ditJ(auj); p.demTxt = ditJ(dem); }
  p.semaine = P.jours.filter(o => o.d >= td).slice(0, 7); p.compteurs = P.compteurs || {};
  S.planningTxt = fut.slice(0, 21).map(o => `${jour(o.d)} : ${lc(ditJ(o))}`).join("\n");
}
/* ---------- Orange (robot Scriptable « Jarvis Orange ») ---------- */
function applyOrange(rows, apis) {
  const o = byId.orange; if (!rows.length && !apis.length) return;
  const P = t => { try { return JSON.parse(t); } catch { return null; } };
  const A = re => { const r = apis.find(x => re.test(x.label)); return r ? P(r.data && r.data.json) : null; };
  const pf = A(/portfoliomanager\/portfolio/);
  const fac = rows.filter(r => r.kind === "facture" && r.date).sort((x, y) => y.date.localeCompare(x.date));
  const cids = (pf && pf.contracts || []).map(c => c.cid);
  fac.forEach(r => { const c = r.data && r.data.contrat; if (c && !cids.includes(c)) cids.push(c); });
  const ville = v => v ? v.charAt(0) + v.slice(1).toLowerCase() : "";
  const C = cids.map(cid => {
    const info = (pf && pf.contracts || []).find(c => c.cid === cid) || {};
    const offre = A(new RegExp("contracts/" + cid + "/details")), opts = A(new RegExp("contracts/" + cid + "/installedOptions")) || [];
    const bp = A(new RegExp("billsAndPaymentInfos/users/current/contracts/" + cid)), conso = A(new RegExp("suiviconso/contracts/conso/" + cid));
    const f = fac.filter(r => r.data && r.data.contrat === cid);
    const nom = (offre && offre.name) || info.offerName || "Contrat " + cid;
    return { cid, nom, court: nom + (info.contractInstallationArea && info.contractInstallationArea.city ? " · " + ville(info.contractInstallationArea.city) : ""),
      prix: offre ? offre.totalPriceAmount / 100 : null, engagement: offre && offre.engagementLabel, opts, bp, f,
      hf: conso && (conso.equipments || [])[0] && conso.equipments[0].synthesis };
  }).filter(c => c.f.length || c.prix != null || c.nom);
  o.place = "Orange";
  const total = C.reduce((t, c) => t + (c.prix || 0), 0);
  o.status = C.length > 1 ? C.length + " contrats" + (total ? " · " + eur(total) + "/mois" : "") : (fac[0] ? "Facture " + eur(fac[0].amount) : "Orange");
  let say = C.length > 1 ? `Tu as ${C.length} contrats Orange. ` : "";
  C.forEach(c => {
    const der = c.f[0], lb = c.bp && c.bp.lastBill;
    say += `${c.court}${c.prix != null ? " : " + eur(c.prix) + " par mois" : ""}`;
    say += der ? `, dernière facture ${eur(der.amount)} le ${frd(der.date)}${lb && lb.debitDate ? " (prélevée le " + frd(lb.debitDate) + ")" : ""}. ` : (c.prix != null ? ". " : ", factures pas encore relues. ");
    if (c.hf && c.hf.displayHF && c.hf.mainText) say += `Hors forfait en cours : ${c.hf.mainText}. `;
    c.opts.filter(x => x.infos && x.infos.length).forEach(x => say += `${x.name} : ${x.infos[0].toLowerCase()}. `);
  });
  const impaye = fac.filter(r => Number(r.data && r.data.reste) > 0);
  if (impaye.length) { o.urgent = true; say = `Il reste ${eur(impaye.reduce((t, r) => t + Number(r.data.reste), 0))} à payer chez Orange. ` + say; }
  o.say = say.trim() || "Orange relu.";
  o.hf = C.some(c => c.hf && c.hf.displayHF);
  { const now = parisDay(); let nb = null, last = null;
    C.forEach(c => { const d = c.f[0] && c.f[0].date; if (!d) return; const x = new Date(d + "T12:00:00"); const nx = new Date(x); nx.setMonth(nx.getMonth() + 1);
      while (nx.toISOString().slice(0, 10) <= now) nx.setMonth(nx.getMonth() + 1); const pv = new Date(nx); pv.setMonth(pv.getMonth() - 1);
      if (!nb || nx < nb) { nb = nx; last = pv; } });
    o.nextBill = nb ? nb.getTime() : null; o.lastBill = last ? last.getTime() : null; }
  o.facts = C.map(c => [c.court, c.prix != null ? eur(c.prix) + " par mois" : "—"]);
  if (C.length > 1 && total) o.facts.push(["Total des offres", eur(total) + " par mois"]);
  if (C.length === 1 && C[0].engagement) o.facts.push(["Engagement", C[0].engagement.replace(/^Vous n’êtes plus engagé$/, "Plus engagé")]);
  o.facts.push(["Factures rangées", String(fac.length) + (fac.length ? " depuis " + MOIS[Number(fac[fac.length - 1].date.slice(5, 7)) - 1] + " " + fac[fac.length - 1].date.slice(0, 4) : "")]);
  const d = [];
  C.forEach(c => {
    const lb = c.bp && c.bp.lastBill, suf = C.length > 1 ? " · " + c.court : "";
    if (lb && lb.aggregationLevel2) {
      const l = [];
      lb.aggregationLevel2.forEach(g => { l.push([g.title, eur(g.includingTaxesAmount / 100)]);
        (g.aggregationLevel3 || []).forEach(a3 => (a3.aggregationLevel4 || []).forEach(a4 => (a4.aggregationLevel5 || []).forEach(a5 =>
          l.push(["· " + a5.invoiced, a5.amount != null ? eur(a5.amount / 100) : (a5.amountDetail || "")])))); });
      d.push({ t: "Détail de la dernière facture", d: frd(lb.date) + suf, v: eur(lb.amount / 100), where: "Espace client Orange", lines: l });
    }
    if (c.opts.length) d.push({ t: "Options", d: c.opts.length + " options" + suf, v: "", where: "Espace client Orange",
      lines: c.opts.map(x => [x.name, (x.substitutesPriceInfo || "") + (x.infos && x.infos.length ? " · " + x.infos[0] : "")]) });
  });
  fac.forEach(r => { const c = C.find(x => x.cid === (r.data && r.data.contrat));
    d.push({ t: "Facture Orange", d: MOIS[Number(r.date.slice(5, 7)) - 1] + " " + r.date.slice(0, 4) + (C.length > 1 && c ? " · " + c.court : ""), v: eur(r.amount), where: "Espace client Orange",
      lines: [["Contrat", c ? c.court : (r.data && r.data.contrat) || "—"], ["Date", frd(r.date)], ["Montant", eur(r.amount)], ["Reste à payer", eur(r.data.reste || 0)]], path: r.data.path }); });
  o.docs = [...d, ...(o.docs || [])];
  o.live = stamp(rows, "relu chez Orange");
}

/* ---------- Un seul sujet = une seule ligne : même lieu + même événement à venir (une coupure, un rendez-vous…) ---------- */
const MOIS_EV = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
function dateEvenement(texte, ref) {
  const t = String(texte || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const r = ref && /^\d{4}-\d{2}-\d{2}/.test(ref) ? new Date(ref.slice(0, 10) + "T12:00:00Z") : new Date();
  const mk = (j, m, an) => { if (!(j >= 1 && j <= 31 && m >= 0 && m <= 11)) return null; const y = an || r.getUTCFullYear(); let d = new Date(Date.UTC(y, m, j, 12));
    if (!an && d < r - 20 * 864e5) d = new Date(Date.UTC(y + 1, m, j, 12)); return d.toISOString().slice(0, 10); };
  const m1 = t.match(/\b(\d{1,2})(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(20\d{2}))?/);
  if (m1) return mk(+m1[1], MOIS_EV.indexOf(m1[2]), m1[3] ? +m1[3] : 0);
  const m2 = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?\b/);
  if (m2) return mk(+m2[1], +m2[2] - 1, m2[3] ? (m2[3].length === 2 ? 2000 + +m2[3] : +m2[3]) : 0);
  return null;
}
/** la clé du sujet : lieu + date de l'événement, seulement s'il est après le mail (sinon : chaque mail est son propre sujet) */
function sujet(lieu, d) { const ev = d.evenement || d.echeance || dateEvenement((d.titre || "") + " " + (d.texte || ""), d.date_mail); return ev && (!d.date_mail || ev > d.date_mail) ? lieu + "|" + ev : null; }
const SUJETS = { cles: new Set(), mails: new Set() };

/* ---------- Alertes venues des mails (posées par ChatGPT ou Claude via le connecteur) ---------- */
function applyMails(rows) {
  SUJETS.cles.clear(); SUJETS.mails.clear();
  const vus = new Set();
  const ouvertes = rows.filter(r => r.kind === "alerte" && r.data && !r.data.vu)
    .sort((a, b) => (b.data.texte || "").length - (a.data.texte || "").length || (b.data.date_mail || "").localeCompare(a.data.date_mail || ""))
    .filter(r => { const k = sujet(r.data.lieu, r.data); if (r.data.mail_id) SUJETS.mails.add(r.data.mail_id); if (!k) return true;
      if (k.split("|")[1] < parisDay()) return false;   // l'événement est passé (grève, photos de classe…) : plus rien à regarder
      if (vus.has(k)) return false; vus.add(k); SUJETS.cles.add(k); return true; })
    .sort((a, b) => (b.data.date_mail || "").localeCompare(a.data.date_mail || ""));
  const parLieu = {};
  ouvertes.forEach(r => (parLieu[r.data.lieu] = parLieu[r.data.lieu] || []).push(r));
  Object.entries(parLieu).forEach(([id, liste]) => {
    const p = byId[id]; if (!p) return;
    p.urgent = true;
    p.status = liste.length > 1 ? liste.length + " choses à regarder" : liste[0].data.titre;
    p.say = liste.map(r => r.data.titre + (r.data.texte ? " : " + r.data.texte : "")).join(" ") + " " + (p.say || "");
    let reste = p.docs || [];
    const al = liste.map(r => { const doc = { t: "⚠︎ " + r.data.titre, d: r.data.date_mail ? "Mail du " + frd(r.data.date_mail) : "Nouveau", v: "Nouveau", future: true, where: "Tes mails (Outlook)",
      lines: [["Ce qu’il faut savoir", r.data.texte || "—"], ["De", r.data.de || "—"], ["Reçu le", r.data.date_mail ? frd(r.data.date_mail) : "—"]], alerteId: r.id, url: r.data.web_link || null };
      // la convocation (PDF) du même événement est rattachée à l'alerte au lieu d'apparaître une deuxième fois
      const k = sujet(id, r.data); if (k) { const ev = k.split("|")[1], pdf = reste.find(x => x.path && /convocation/i.test(x.t) && dateEvenement(x.t + " " + (x.d || ""), r.data.date_mail) === ev);
        if (pdf) { doc.path = pdf.path; reste = reste.filter(x => x !== pdf); } }
      return doc; });
    p.docs = [...al, ...reste];
  });
}
/* ---------- Ce que Jarvis a retenu des mails Outlook (une fiche par mail, avec le lien vers le mail) ---------- */
function applyOutlook(rows) {
  const vus = new Set(SUJETS.cles);
  rows.filter(r => r.kind === "info" && r.data && byId[r.data.lieu])
    .sort((a, b) => (b.data.date_mail || "").localeCompare(a.data.date_mail || ""))
    // pas de doublon : un mail déjà en alerte, ou un sujet (même événement) déjà affiché, n'est pas remis
    .filter(r => { if (SUJETS.mails.has(r.data.mail_id)) return false; const k = sujet(r.data.lieu, r.data); if (!k) return true; if (vus.has(k)) return false; vus.add(k); return true; })
    .slice(0, 300)
    .forEach(r => {
      const p = byId[r.data.lieu], d = r.data;
      const lines = [["En bref", d.texte || "—"]];
      if (d.action) lines.push(["À faire", d.action]);
      if (d.echeance) lines.push(["Avant le", frd(d.echeance)]);
      lines.push(["De", d.de || "—"], ["Reçu le", d.date_mail ? frd(d.date_mail) : "—"]);
      if ((d.pieces || []).length) lines.push(["Pièces jointes", d.pieces.join(", ")]);
      const doc = { t: d.titre || "Mail", d: "Mail du " + (d.date_mail ? frd(d.date_mail) : "?"), v: "Mail", where: "Tes mails (Outlook" + (d.compte ? " · " + d.compte : "") + ")", lines, url: d.web_link || null };
      // salaires et soldes : jamais à l'écran
      if (ARGENT.test((d.titre || "") + " " + (d.texte || "")) && /€/.test(d.texte || "")) { garde(p, d.titre + " : " + d.texte); doc.lines = doc.lines.filter(l => !/€/.test(l[1] || "")); doc.lines.unshift(["Montants", "Cachés : demande-les-moi dans le chat"]); }
      p.docs = [...(p.docs || []), doc];
    });
}
/* ---------- Notes rangées par Jarvis (code RIO, numéros…) ---------- */
function applyNotes(rows) {
  rows.filter(r => r.kind === "note" && r.data && byId[r.data.lieu])
    .sort((a, b) => (a.data.titre || "").localeCompare(b.data.titre || ""))
    .forEach(r => { const p = byId[r.data.lieu]; p.facts = [[r.data.titre, r.data.texte], ...(p.facts || [])];
      // une note qui parle de salaire ou de solde reste cachée, comme le reste
      if (ARGENT.test(r.data.titre) && /€/.test(r.data.texte || "")) cacheArgent(p); });
}
let loading = null;
async function loadAll() {
  if (loading) return loading;
  loading = (async () => {
    const { data, error } = await sb.from("jarvis_items").select("id,source,kind,label,date,amount,data,updated_at").not("kind", "in", "(debug,reperage,page,api)").limit(5000);
    // Orange : seulement les quelques blocs de données utiles (offre, options, factures, conso)
    const { data: oApi } = await sb.from("jarvis_items").select("label,data,updated_at").eq("source", "orange").eq("kind", "api")
      .or("label.ilike.*offer/contracts/*/details*,label.ilike.*installedOptions*,label.ilike.*billsAndPaymentInfos*,label.ilike.*suiviconso/contracts/conso*,label.ilike.*portfoliomanager/portfolio*");
    if (error) { toast("Je n’arrive pas à lire tes données : " + error.message); return; }
    const rows = data || [];
    S.next = ""; S.nextPlace = ""; PLACES.forEach(p => Object.assign(p, { place: "", status: "…", say: "Je regarde…", facts: [], docs: [], live: "", macDocs: undefined, prive: [], urgent: false }));
    applyMac(rows.filter(r => r.source === "mac" || r.source === "jarvis"));
    applyPlanning(rows.filter(r => r.source === "planning" || r.source === "mac"));
    applyEnergie(rows.filter(r => r.source === "plenitude"));
    applyFoncia(rows.filter(r => r.source === "foncia"));
    applySante(rows.filter(r => r.source === "medinlyon"));
    applyOrange(rows.filter(r => r.source === "orange"), oApi || []);
    applyMails(rows.filter(r => r.source === "mails"));
    applyOutlook(rows.filter(r => r.source === "outlook"));
    applyNotes(rows.filter(r => r.source === "jarvis"));
    PLACES.forEach(p => {
      if (p.status === "…") { p.status = "À brancher"; p.say = "Je n’ai encore rien pour ce lieu. Dès qu’une source est branchée, je le remplis."; p.live = "Pas encore branché"; }
      p.say = nb(p.say); p.status = nb(p.status); });
    S.loaded = true; refreshPins(); updateBrief(); if (S.sel) renderSheet(S.sel);
  })();
  try { await loading; } finally { loading = null; }
}
let liveCh = null, liveT = null;
function goLive() {
  if (liveCh) return;
  liveCh = sb.channel("jarvis-items").on("postgres_changes", { event: "*", schema: "public", table: "jarvis_items" }, () => {
    clearTimeout(liveT); liveT = setTimeout(loadAll, 900);
  }).subscribe();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.loaded) loadAll(); });

/* ---------- Télécommande : Claude (via le connecteur) pilote l'écran ----------
   Le connecteur écrit un ordre dans jarvis_ecran ; l'app ouverte l'exécute tout de suite. */
const LIEU_APP = { logement: "home", energie: "energie", sante: "clinique", travail: "usine", impots: "impots", voiture: "garage", papiers: "mairie", banque: "banque", bebe: "medecin", abonnements: "orange" };
const sansAccent = t => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function fermerTout() { deselect(); closeTalk(); closeBook(); closeSettings(); $("paperwrap").classList.remove("open"); $("alertwrap").classList.remove("open"); }
function bougerCamera(a) { V.orbit(a); }
async function ordreEcran(o) {
  const a = o.args || {};
  if (o.action === "lieu") { const p = byId[LIEU_APP[a.lieu] || a.lieu]; if (p) { $("paperwrap").classList.remove("open"); select(p); } }
  else if (o.action === "document") {
    const p = byId[LIEU_APP[a.lieu] || a.lieu]; if (!p) return;
    select(p); openDetails(); const q = sansAccent(a.titre || "").split(/\s+/).filter(m => m.length > 1);
    // le papier exact (par son chemin) s'il est connu, sinon par les mots du titre
    const d = (a.path && ((p.docs || []).find(x => x.path === a.path) || { t: a.titre || "Papier", d: a.d || "", path: a.path }))
      || (p.docs || []).find(x => q.every(m => sansAccent(x.t + " " + x.d).includes(m))) || (p.docs || []).find(x => q.some(m => sansAccent(x.t + " " + x.d).includes(m)));
    if (d) setTimeout(() => openDoc(p, d), 700); else toast("Je ne trouve pas « " + a.titre + " » ici.");
  }
  else if (o.action === "rdv") montrerRdv(a);
  else if (o.action === "recherche") { const p = a.lieu && byId[LIEU_APP[a.lieu] || a.lieu]; if (p && S.sel !== p) select(p); toast("🔎 " + String(a.texte || "Je cherche…").slice(0, 120)); }
  else if (o.action === "ensemble") { fermerTout(); overview(); }
  else if (o.action === "camera") bougerCamera(a);
  else if (o.action === "ciel") applySky(a.mode === "nuit");
  else if (o.action === "fermer") fermerTout();
  else if (o.action === "message" && a.texte) toast(String(a.texte).slice(0, 160));
}
let ecranCh = null;
function goTelecommande() {
  if (ecranCh) return;
  ecranCh = sb.channel("jarvis-ecran").on("postgres_changes", { event: "INSERT", schema: "public", table: "jarvis_ecran" }, ({ new: o }) => {
    if (!o || Date.now() - new Date(o.created_at).getTime() > 60000) return; // ordre trop vieux : ignoré
    ordreEcran(o).catch(() => {});
  }).subscribe();
}

/* ---------- Appeler les robots du serveur ---------- */
async function medin(body, quiet) {
  try {
    const { data, error } = await sb.functions.invoke("medinlyon", { body });
    if (error) { let m = "Le robot MédinLyon ne répond pas."; try { const j = await error.context.json(); m = j.message || m; } catch (_) {} toast(m); return { ok: false, message: m }; }
    if (data && data.message && (!quiet || !data.ok)) toast(data.message);
    if (data && data.ok && body.action === "sync") toast(`MédinLyon relu : ${data.a_venir} à venir, ${data.rdv} au total`);
    if (body.action !== "creneaux") await loadAll();
    return data;
  } catch (e) { toast("Pas de réseau ?"); return { ok: false, message: "Pas de réseau." }; }
}

/* =========================================================
   Prendre rendez-vous (dans Jarvis, sans sortir)
   pour qui → où → quand → l'heure → confirmation → PDF
   ========================================================= */
let bookOpen = false;
const B = {};
const CENTRES = { "1": "Villeurbanne", "2": "Lyon 6 Brotteaux" };
function openBook() {
  if (S.sel) { S.sel = null; sheet.classList.remove("open"); }
  closeTalk(true); closeSettings(true);
  icone($("bIc"), byId.clinique); $("bIc").style.setProperty("--c", byId.clinique.color);
  bookOpen = true; viewShiftGoal = 1; $("book").classList.add("open"); $("ask").classList.add("away");
  Object.keys(B).forEach(k => delete B[k]); stepWho();
}
function closeBook(keep) { if (!bookOpen) return; bookOpen = false; $("book").classList.remove("open"); if (!keep) { viewShiftGoal = 0; $("ask").classList.remove("away"); } }
$("bClose").addEventListener("click", () => closeBook());
swipeClose($("book").querySelector(".card"), () => closeBook());
function bookStep(title, sub) { $("bQ").textContent = title; $("bSub").textContent = sub || ""; const o = $("bBody"); o.innerHTML = ""; return o; }
function choice(o, label, sub, fn, cls = "") { const b = document.createElement("button"); b.className = "opt " + cls; b.innerHTML = "<b></b><span></span>"; b.querySelector("b").textContent = label; b.querySelector("span").textContent = sub || ""; b.addEventListener("click", fn); o.append(b); return b; }
function back(o, fn) { const b = document.createElement("button"); b.className = "btn soft wide back"; b.textContent = "‹ Retour"; b.addEventListener("click", fn); o.append(b); }
function stepWho() {
  const o = bookStep("Pour qui ?", "La famille enregistrée sur ton compte MédinLyon");
  let list = S.patients;
  if (!list.length) list = [...new Set(S.rdv.map(r => r.patient))].map(n => ({ id: "", nom: n }));
  if (!list.length) { o.innerHTML = '<p class="empty">Je ne connais pas encore la famille. Touche « Mettre à jour » dans Ta santé.</p>'; return; }
  const counts = {}; S.rdv.forEach(r => counts[r.patient] = (counts[r.patient] || 0) + 1);
  list.slice().sort((a, b) => (counts[b.nom] || 0) - (counts[a.nom] || 0)).forEach(p => choice(o, p.nom, counts[p.nom] ? counts[p.nom] + " rendez-vous passés" : "", () => { B.patient = p; stepWhere(); }, "who"));
}
function stepWhere() {
  const o = bookStep("Où ?", "Pour " + B.patient.nom);
  const lastC = (S.rdv.find(r => r.patient === B.patient.nom) || {}).centre;
  Object.entries(CENTRES).forEach(([id, n]) => choice(o, n, lastC && ctr(lastC) === n ? "Là où il va d’habitude" : "", () => { B.centre = id; stepWhen(); }));
  back(o, stepWho);
}
function stepWhen() {
  const o = bookStep("Quand ?", B.patient.nom + " · " + CENTRES[B.centre]);
  [[parisDay(), "Aujourd’hui"], [parisDay(1), "Demain"]].forEach(([d, n]) => {
    const c = S.creneaux.find(x => x.date === d && x.data && x.data.centre === B.centre);
    choice(o, n, jour(d) + (c ? " · " + (c.data.nb ? c.data.nb + " créneaux vus" : "complet au dernier relevé") : ""), () => { B.date = d; stepSlot(); });
  });
  const hint = document.createElement("p"); hint.className = "hint"; hint.textContent = "MédinLyon ne propose que le jour même et le lendemain."; o.append(hint);
  back(o, stepWhere);
}
async function stepSlot() {
  const o = bookStep("À quelle heure ?", jour(B.date) + " · " + CENTRES[B.centre]);
  o.innerHTML = '<p class="empty">Je regarde les créneaux libres…</p>';
  const r = await medin({ action: "creneaux", centre: B.centre, date: B.date }, true);
  if (!bookOpen) return;
  o.innerHTML = "";
  let list = r && r.ok ? r.creneaux : null;
  if (!list) { const c = S.creneaux.find(x => x.date === B.date && x.data && x.data.centre === B.centre); list = (c && c.data.creneaux) || []; }
  if (!list.length) { o.innerHTML = '<p class="empty">Plus aucun créneau libre ce jour-là.</p>'; back(o, stepWhen); return; }
  const g = document.createElement("div"); g.className = "slots"; o.append(g);
  list.forEach(s => { const b = document.createElement("button"); b.className = "slot" + (s.supplement ? " plus" : ""); b.innerHTML = "<b></b>" + (s.supplement ? "<span>+≈23 €</span>" : "");
    b.querySelector("b").textContent = hh(s.heure); b.addEventListener("click", () => { B.slot = s; stepConfirm(); }); g.append(b); });
  if (list.some(s => s.supplement)) { const h = document.createElement("p"); h.className = "hint"; h.textContent = "+≈23 € : soir et week-end, dépassement facturé par le médecin (environ 32 € à régler, remboursé selon ta mutuelle)."; o.append(h); }
  back(o, stepWhen);
}
function stepConfirm() {
  const o = bookStep("Je réserve ?", "Dernière vérification");
  const c = document.createElement("div"); c.className = "recap";
  [["Pour", B.patient.nom], ["Où", CENTRES[B.centre]], ["Quand", jour(B.date) + " à " + hh(B.slot.heure)], ["Tarif", B.slot.supplement ? "Dépassement ≈23 € (soir / week-end)" : "Tarif normal, tiers payant avec la carte Vitale"]]
    .forEach(([a, b]) => { const r = document.createElement("div"); r.className = "row"; const x = document.createElement("span"); x.textContent = a; const y = document.createElement("b"); y.textContent = b; r.append(x, y); c.append(r); });
  o.append(c);
  const go = document.createElement("button"); go.className = "btn main wide"; go.textContent = "Oui, réserver"; o.append(go);
  if (!B.patient.id) { go.disabled = true; go.textContent = "Mets d’abord MédinLyon à jour"; }
  go.addEventListener("click", async () => {
    go.disabled = true; go.textContent = "Je réserve sur MédinLyon…";
    const r = await medin({ action: "reserver", patient: B.patient.id, centre: B.centre, date: B.date, creneau: B.slot.id }, true);
    stepDone(r);
  });
  back(o, stepSlot);
}
function montrerCreneaux(list) {
  const o = bookStep("À quelle heure ?", (B.patient ? B.patient.nom + " · " : "") + jour(B.date) + " · " + CENTRES[B.centre]);
  if (!list.length) { o.innerHTML = '<p class="empty">Plus aucun créneau libre ce jour-là.</p>'; back(o, stepWhen); return; }
  const g = document.createElement("div"); g.className = "slots"; o.append(g);
  list.forEach(s => { const b = document.createElement("button"); b.className = "slot" + (s.supplement ? " plus" : ""); b.innerHTML = "<b></b>" + (s.supplement ? "<span>+≈23 €</span>" : "");
    b.querySelector("b").textContent = hh(s.heure); b.addEventListener("click", () => { B.slot = s; if (B.patient) stepConfirm(); else stepWho(); }); g.append(b); });
  back(o, stepWhen);
}
/* L'assistant (Claude ou ChatGPT) parle : l'écran de prise de rendez-vous suit la conversation, étape par étape */
function montrerRdv(a) {
  const sansA = t => sansAccent(String(t || ""));
  if (!bookOpen) { openBook(); }
  if (a.pour) { const q = sansA(a.pour).split(/\s+/)[0]; const fam = S.patients.length ? S.patients : [...new Set(S.rdv.map(r => r.patient))].map(n => ({ id: "", nom: n }));
    const p = fam.find(x => sansA(x.nom).includes(q)); if (p) B.patient = p; }
  if (a.centre) { const c = /brott|lyon/i.test(a.centre) ? "2" : /villeur/i.test(a.centre) ? "1" : (CENTRES[a.centre] ? a.centre : null); if (c) B.centre = c; }
  if (a.date) B.date = /demain/i.test(a.date) ? parisDay(1) : /aujourd/i.test(a.date) ? parisDay() : a.date;
  const e = a.etape || (a.resultat ? "fait" : a.heure ? "confirmer" : a.creneaux ? "creneaux" : B.date ? "quand" : B.centre ? "quand" : B.patient ? "ou" : "qui");
  if (e === "creneaux" && B.centre && B.date) return montrerCreneaux(a.creneaux || []);
  if (e === "qui" || !B.patient) return stepWho();
  if (e === "ou" || !B.centre) return stepWhere();
  if (e === "quand" || !B.date) return stepWhen();
  if (a.heure) B.slot = { id: a.creneau || "", heure: String(a.heure).replace(/h/i, ":").padStart(5, "0"), supplement: !!a.supplement };
  if (e === "confirmer" && B.slot) return stepConfirm();
  if (e === "fait") { if (!B.slot && a.heure) B.slot = { heure: a.heure }; return stepDone(a.resultat || { ok: false }); }
  if (e === "reservation") { const o = bookStep("Je réserve…", (B.patient ? B.patient.nom : "") + " · " + jour(B.date) + (B.slot ? " à " + hh(B.slot.heure) : "")); o.innerHTML = '<p class="empty">Je réserve sur MédinLyon…</p>'; }
}
function stepDone(r) {
  const ok = r && r.ok;
  const o = bookStep(ok ? "C’est réservé ✓" : "Pas réservé", ok ? B.patient.nom + " · " + jour(B.date) + " à " + hh(B.slot.heure) : (r && r.message) || "MédinLyon n’a pas répondu.");
  if (ok && r.rdv && r.rdv.chemin) {
    const a = document.createElement("a"); a.className = "btn main wide pdf"; a.textContent = "Je prépare le PDF…"; a.target = "_blank"; o.append(a);
    sb.storage.from("papiers").createSignedUrl(r.rdv.chemin, 600).then(({ data }) => { if (data) { a.href = data.signedUrl; a.textContent = "Voir la confirmation (PDF)"; } else a.textContent = "PDF pas encore prêt"; });
  } else if (ok) { const p = document.createElement("p"); p.className = "hint"; p.textContent = "Le PDF de confirmation arrivera dans Ta santé dès que MédinLyon le donne."; o.append(p); }
  const b = document.createElement("button"); b.className = "btn soft wide"; b.textContent = ok ? "Voir Ta santé" : "Réessayer"; o.append(b);
  b.addEventListener("click", () => { if (ok) { closeBook(true); select(byId.clinique); openDetails(); } else stepSlot(); });
}

/* =========================================================
   Parler à Jarvis (API Claude via ton serveur)
   ========================================================= */
let history = [], busy = false;
const msgs = $("msgs"), input = $("input");
function bubble(c, t) { const d = document.createElement("div"); d.className = "m " + c; d.textContent = t; msgs.append(d); msgs.scrollTop = msgs.scrollHeight; return d; }
function openTalk(p) {
  if (S.sel) { S.sel = null; sheet.classList.remove("open"); }
  closeBook(true); closeSettings(true);
  talkOpen = true; viewShiftGoal = 1; $("talk").classList.add("open"); $("ask").classList.add("away");
  if (!msgs.children.length) bubble("j", p ? "On parle de " + p.name.toLowerCase() + " ? Je t’écoute." : "Je t’écoute. Pose-moi une question sur ton argent, tes papiers, ta santé ou ton planning.");
  else if (p) bubble("j", "On parle de " + p.name.toLowerCase() + " ?");
  const chips = $("chips"); chips.innerHTML = "";
  ["Qu’est-ce que je dois payer ce mois-ci ?", "Prends un rendez-vous médical", "Qu’est-ce qui manque ?"].forEach(q => { const b = document.createElement("button"); b.className = "chip"; b.textContent = q;
    b.addEventListener("click", () => { if (/rendez-vous/.test(q)) { openBook(); return; } input.value = q; send(); }); chips.append(b); });
}
function closeTalk(keep) { if (!talkOpen) return; talkOpen = false; $("talk").classList.remove("open"); input.blur(); stopListen(); voix.stop(); if (!keep) { viewShiftGoal = 0; $("ask").classList.remove("away"); } }
$("ask").addEventListener("click", () => openTalk(null));
$("tClose").addEventListener("click", () => closeTalk());
swipeClose($("talk").querySelector(".card"), () => closeTalk());
function context() {
  const lines = PLACES.map(p => `${p.name} (${p.place}) : ${p.say} ${p.facts.map(f => f[0] + " : " + f[1]).join(" ; ")}${p.prive && p.prive.length ? " [Caché à l’écran : " + p.prive.join(" ; ") + "]" : ""}${p.urgent ? " [à regarder]" : ""}`).join("\n");
  const papiers = PLACES.map(p => (p.docs || []).slice(0, 25).map(d => `${p.name} : ${d.t} ${d.d} ${d.v || ""} (${(d.lines || []).map(l => l.join(" ")).join(", ")})`).join("\n")).filter(Boolean).join("\n");
  return `Tu es Jarvis, l’assistant personnel de ${S.prenom || "ton propriétaire"}. ${S.profil}
Tu vois ses comptes, ses papiers, sa santé et ses abonnements. Tu anticipes et tu proposes, mais tu n’agis jamais sans sa confirmation, et pour l’argent tu conseilles seulement.
Réponds en français parlé (ta réponse peut être lue à voix haute), très simple, sans jargon, en 1 à 3 phrases courtes, sans listes ni titres, avec des chiffres concrets.
Avant de proposer un moment pour un rendez-vous ou une démarche, regarde son planning de travail et choisis un moment où il ne travaille pas. Pour prendre ou annuler un rendez-vous médical, dis-lui de toucher « Ta santé » puis « Prendre rendez-vous » : c’est là que Jarvis réserve après sa confirmation.
Ses salaires, ses paies et ses soldes sont cachés à l’écran (notés « Caché à l’écran ») : ne les donne que s’il te les demande clairement, jamais de toi-même.
Ce qui n’est pas encore branché (banque, mails, Ameli, Orange), dis-le simplement sans inventer de chiffre.
Nous sommes le ${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, il est ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.
Situation :
${lines}
Papiers :
${papiers}${S.planningTxt ? `
Son planning de travail des 3 prochaines semaines (Mon Planning ; une nuit compte pour le jour où elle commence) :
${S.planningTxt}` : ""}`;
}
async function send() {
  const t = input.value.trim(); if (!t || busy) return; input.value = ""; bubble("me", t); history.push({ role: "user", content: t });
  const out = bubble("j", "…"); busy = true; $("send").disabled = true; let text = "", said = 0;
  const parle = voiceMode || lireToujours();
  if (parle) voix.stop();
  try {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(SB_URL + "/functions/v1/jarvis-chat", { method: "POST",
      headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: "Bearer " + (session ? session.access_token : "") },
      body: JSON.stringify({ system: context(), messages: history }) });
    if (!r.ok) { let j = {}; try { j = await r.json(); } catch (_) {}
      throw new Error(j.error === "cle_absente" ? "Il me manque ta clé Claude : touche la roue ⚙️ en haut, colle-la dans « Clé Claude » et je te réponds." : j.error === "interdit" ? "Reconnecte-toi, je ne te reconnais plus." :
        /workspace/i.test(j.detail || "") ? "Ta clé Claude n’est rattachée à aucun espace (workspace). Crée une clé dans un espace sur platform.claude.com, puis colle-la dans les Réglages ⚙️." :
        /credit|balance|billing/i.test(j.detail || "") ? "Ta clé Claude n’a plus de crédit. Vérifie Billing sur platform.claude.com." :
        /invalid x-api-key|authentication/i.test(j.detail || "") ? "Ta clé Claude est refusée. Recolle-la dans les Réglages ⚙️." :
        "Je n’arrive pas à joindre Claude (" + (j.status || r.status) + ")."); }
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
    for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue; try { const ev = JSON.parse(line.slice(5)); if (ev.type === "content_block_delta" && ev.delta && ev.delta.text) { text += ev.delta.text; out.textContent = text; msgs.scrollTop = msgs.scrollHeight; } } catch (_) {} }
      // Jarvis commence à parler dès la première phrase finie, sans attendre la fin
      if (parle) { const m = text.slice(said).match(/^[\s\S]*?[.!?…:](?=\s)/); if (m) { voix.dire(m[0]); said += m[0].length; } } }
    if (!text) throw new Error("Je n’ai rien reçu, réessaie.");
    history.push({ role: "assistant", content: text });
    if (parle && text.slice(said).trim()) voix.dire(text.slice(said));
  } catch (e) { out.textContent = e.message || "Je n’arrive pas à répondre là, réessaie."; history.pop(); if (parle) voix.dire(out.textContent); }
  finally { busy = false; $("send").disabled = false; voix.finPossible(); }
}
$("send").addEventListener("click", send);
input.addEventListener("keydown", e => { voiceMode = false; convo = false; if (e.key === "Enter") send(); });

/* ---------- La voix : vraie conversation, mains libres ----------
   Tu touches le micro une fois : tu parles, Jarvis répond à voix haute,
   puis il t'écoute de nouveau. Touche le micro pour arrêter.
   Le cerveau, c'est Claude. La voix, c'est la meilleure voix française de ton appareil. */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const micBtn = $("mic"), vhint = $("vhint");
let rec = null, listening = false, voiceMode = false, convo = false, heard = "";
const store = { get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };
const lireToujours = () => store.get("jarvis.lire") === "1";
const HINT = SR ? "Touche le micro pour parler avec Jarvis" : "Pour dicter, touche le micro du clavier";
if (SR) micBtn.hidden = false;
vhint.textContent = HINT;

const voix = {
  attente: 0,
  liste() { return ("speechSynthesis" in window) ? speechSynthesis.getVoices().filter(v => /^fr/i.test(v.lang)) : []; },
  note(v) { return (/premium/i.test(v.name) ? 6 : 0) + (/enhanced|amélioré|améliorée|natural|neural/i.test(v.name) ? 4 : 0) + (/fr-FR/i.test(v.lang) ? 2 : 0) + (v.localService ? 1 : 0)
    + (/^(Amélie|Thomas|Audrey|Aurélie|Marie|Daniel|Jacques)/i.test(v.name) ? 1 : 0) - (/compact|eloquence|grandma|grandpa|rocko|shelley|sandy|flo|reed|eddy/i.test(v.name) ? 5 : 0); },
  choisie() { const l = this.liste(), n = store.get("jarvis.voix"); return l.find(v => v.name === n) || l.sort((a, b) => this.note(b) - this.note(a))[0] || null; },
  dire(t) {
    t = (t || "").replace(/[*_#`>]/g, "").replace(/\s+/g, " ").trim(); if (!t || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(t); const v = this.choisie(); if (v) u.voice = v; u.lang = v ? v.lang : "fr-FR"; u.rate = 1.0; u.pitch = 1.0;
    this.attente++; micBtn.classList.add("talking"); vhint.textContent = convo ? "Jarvis parle… touche le micro pour l’arrêter" : "Jarvis parle…";
    u.onend = u.onerror = () => { this.attente = Math.max(0, this.attente - 1); this.finPossible(); };
    speechSynthesis.speak(u);
  },
  stop() { this.attente = 0; if ("speechSynthesis" in window) speechSynthesis.cancel(); micBtn.classList.remove("talking"); },
  finPossible() {
    if (this.attente || busy) return;
    micBtn.classList.remove("talking");
    if (convo && talkOpen) setTimeout(() => { if (convo && talkOpen && !listening && !busy && !this.attente) ecouter(); }, 250);
    else vhint.textContent = HINT;
  },
};
if ("speechSynthesis" in window) speechSynthesis.addEventListener?.("voiceschanged", () => {});

function stopListen() { convo = false; if (rec && listening) { try { rec.abort(); } catch (_) {} } listening = false; micBtn.classList.remove("on"); }
function ecouter() {
  if (!SR) return;
  rec = new SR(); rec.lang = "fr-FR"; rec.interimResults = true; rec.continuous = false;
  heard = ""; input.value = ""; voiceMode = true;
  rec.onstart = () => { listening = true; micBtn.classList.add("on"); vhint.textContent = "Je t’écoute…"; };
  rec.onresult = e => { let t = ""; for (const r of e.results) t += r[0].transcript; heard = t; input.value = t; };
  rec.onerror = e => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") { convo = false; vhint.textContent = "Micro refusé : autorise-le pour Safari dans les réglages de l’iPhone"; }
    else if (e.error === "no-speech" && convo) vhint.textContent = "Je n’ai rien entendu… touche le micro pour reprendre";
  };
  rec.onend = () => {
    listening = false; micBtn.classList.remove("on");
    if (heard.trim()) { send(); return; }
    if (convo) { convo = false; vhint.textContent = "Je n’ai rien entendu. Touche le micro pour reprendre"; }
  };
  try { rec.start(); } catch (_) { convo = false; vhint.textContent = "Touche le micro pour me répondre"; }
}
micBtn.addEventListener("click", () => {
  // en pleine conversation : un toucher arrête tout
  if (convo || listening || voix.attente) {
    const parlait = voix.attente > 0; voix.stop();
    if (listening) { try { rec.stop(); } catch (_) {} convo = false; return; } // il envoie ce que tu as dit
    convo = false; vhint.textContent = parlait ? "D’accord, je me tais. Touche le micro pour reprendre" : HINT; return;
  }
  if ("speechSynthesis" in window) { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } // débloque la voix sur iPhone
  convo = true; ecouter();
});

/* =========================================================
   Réglages : tes codes, rangés dans le coffre chiffré de Supabase.
   L'app peut les écrire, jamais les relire.
   ========================================================= */
const REGLAGES = [
  { name: "ANTHROPIC_API_KEY", label: "Clé Claude", help: "Pour parler avec Jarvis. Elle commence par « sk-ant- » (platform.claude.com › API keys).", type: "password", ph: "sk-ant-…" },
  { name: "MEDINLYON_EMAIL", label: "MédinLyon · e-mail", help: "Pour prendre et annuler les rendez-vous de la famille.", type: "email", ph: "ton e-mail MédinLyon" },
  { name: "MEDINLYON_PASSWORD", label: "MédinLyon · mot de passe", help: "", type: "password", ph: "ton mot de passe MédinLyon" },
  { name: "MS_CLIENT_SECRET", label: "Outlook · secret de l’application", help: "La « valeur » du secret client créé dans Microsoft Entra (application Jarvis › Certificats et secrets). Elle sert seulement à lire tes mails.", type: "password", ph: "valeur du secret Microsoft" },
];
let setOpen = false;
async function openSettings() {
  deselect(); closeTalk(true); closeBook(true);
  setOpen = true; viewShiftGoal = 1; $("setsheet").classList.add("open"); $("ask").classList.add("away");
  const o = $("sBody"); o.innerHTML = '<p class="empty">Je regarde ce qui est déjà rangé…</p>';
  const { data, error } = await sb.rpc("jarvis_secret_status");
  const etat = Object.fromEntries((data || []).map(r => [r.name, r]));
  o.innerHTML = "";
  if (error) { o.innerHTML = '<p class="empty">Je n’arrive pas à ouvrir le coffre. Reconnecte-toi.</p>'; return; }
  REGLAGES.forEach(r => {
    const c = document.createElement("div"); c.className = "set";
    c.innerHTML = '<div class="stop"><b></b><span></span></div><div class="row2"><input autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn main" type="button">Enregistrer</button></div><small></small>';
    const st = c.querySelector(".stop span"), inp = c.querySelector("input"), b = c.querySelector("button");
    c.querySelector(".stop b").textContent = r.label; c.querySelector("small").textContent = r.help;
    inp.type = r.type; inp.placeholder = etat[r.name]?.rempli ? "•••••••• déjà rangé" : r.ph;
    const show = ok => { st.textContent = ok ? "Enregistré ✓" : "À ajouter"; st.className = ok ? "ok" : ""; };
    show(!!etat[r.name]?.rempli);
    b.addEventListener("click", async () => {
      const v = inp.value.trim(); if (!v) { inp.focus(); return; }
      b.disabled = true; b.textContent = "…";
      const { error: e } = await sb.rpc("jarvis_set_secret", { p_name: r.name, p_value: v });
      b.disabled = false; b.textContent = "Enregistrer";
      if (e) { toast("Pas enregistré : " + e.message); return; }
      inp.value = ""; inp.placeholder = "•••••••• déjà rangé"; show(true); toast(r.label + " enregistré ✓");
    });
    inp.addEventListener("keydown", e => { if (e.key === "Enter") b.click(); });
    o.append(c);
  });
  o.append(blocOutlook());
  o.append(blocPapiers());
  o.append(blocVoix());
  o.append(blocConnecteur());
}

/* ---------- Ajouter mes papiers (depuis le Mac ou l'iPhone) ----------
   Jarvis lit le papier (fonction jarvis-trier) et le range tout seul au bon lieu.
   Papiers jamais acceptés : ceux qui portent un numéro de sécu, un IBAN, une pièce d'identité,
   un papier de préfecture ou le papier d'une autre personne. */
const INTERDITS = [
  [/permis|identit|passeport|sajalni/i, "pièce d’identité"],
  [/s[ée]jour|prolongation|pr[ée]fecture/i, "papier de préfecture"],
  [/attestation ?de ?droits|ameli|attestationpaiement|carsat/i, "contient un n° de sécu"],
  [/cession|carte.?grise|carte-g|cerfa|signee/i, "papier de vente ou carte grise : contient l’identité d’autres personnes"],
  [/billet|tunisair/i, "papier d’une autre personne"],
  [/\brib\b|iban/i, "relevé bancaire (IBAN)"],
];
const LIEUX_PAPIERS = { home: "Chez toi", energie: "Gaz et électricité", garage: "Voiture", impots: "Impôts et amendes", clinique: "Santé", usine: "Travail", mairie: "Papiers", banque: "Banque", orange: "Abonnements", medecin: "Bébé" };
function blocPapiers() {
  const c = document.createElement("div"); c.className = "set";
  c.innerHTML = '<div class="stop"><b>Ajouter mes papiers</b><span></span></div>'
    + '<small>Choisis tes PDF (par exemple dans Téléchargements), autant que tu veux. Jarvis les lit, les range tout seul au bon lieu et leur donne un nom clair. Tes bulletins de paie vont dans Travail. Il refuse les pièces d’identité et les autres papiers qui portent ton n° de sécu ou ton IBAN.</small>'
    + '<div class="row2"><button class="btn main" type="button" style="flex:1">Choisir des PDF…</button></div>'
    + '<input type="file" accept="application/pdf,.pdf" multiple hidden><div class="dep"></div>';
  const btn = c.querySelector(".btn"), inp = c.querySelector("input"), out = c.querySelector(".dep"), st = c.querySelector(".stop span");
  btn.addEventListener("click", () => inp.click());
  const ligne = (t, cls) => { const e = document.createElement("small"); e.textContent = t; if (cls) e.className = cls; out.append(e); return e; };
  inp.addEventListener("change", async () => {
    const files = [...inp.files]; inp.value = ""; out.textContent = ""; if (!files.length) return;
    let ok = 0; st.textContent = "Je lis…"; st.className = "";
    const { data: { session } } = await sb.auth.getSession();
    const un = async (f) => {
      const n = f.name, ban = INTERDITS.find(([re]) => re.test(n));
      if (ban) { ligne("✕ " + n + " — pas rangé (" + ban[1] + ")"); return; }
      if (f.size > 20e6) { ligne("✕ " + n + " — trop lourd"); return; }
      const slug = n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.]+/g, "-").toLowerCase();
      const path = "mac/a-trier/" + slug;
      const l = ligne("… " + n + " — je le lis");
      const { error } = await sb.storage.from("papiers").upload(path, f, { upsert: true, contentType: "application/pdf" });
      if (error) { l.textContent = "✕ " + n + " — envoi raté : " + error.message; return; }
      try {
        const r = await fetch(SB_URL + "/functions/v1/jarvis-trier", { method: "POST",
          headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: "Bearer " + (session ? session.access_token : "") },
          body: JSON.stringify({ path }) });
        const j = await r.json().catch(() => ({}));
        if (j.refus) { l.textContent = "✕ " + n + " — pas rangé (" + j.refus + ")"; return; }
        if (!r.ok) { l.textContent = "✕ " + n + " — " + (j.error === "cle_absente" ? "il me manque ta clé Claude (Réglages ⚙️)" : "je n’ai pas réussi à le lire"); return; }
        l.textContent = "✓ " + j.titre + (j.sous ? " (" + j.sous + ")" : "") + " → " + (LIEUX_PAPIERS[j.lieu] || j.lieu); ok++;
      } catch (_) { l.textContent = "✕ " + n + " — pas de connexion"; }
    };
    // 4 papiers lus en même temps
    const file = [...files]; await Promise.all(Array.from({ length: Math.min(4, file.length) }, async () => { while (file.length) await un(file.shift()); }));
    st.textContent = ok ? ok + " rangé" + (ok > 1 ? "s" : "") + " ✓" : ""; st.className = ok ? "ok" : "";
    if (ok) loadAll();
  });
  return c;
}
/* ---------- Mails Outlook (lecture seule, Microsoft Graph) ----------
   La connexion se fait chez Microsoft ; Jarvis ne voit jamais le mot de passe.
   Les nouveaux mails sont relus toutes les 15 minutes par la fonction jarvis-outlook. */
async function appelOutlook(body) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(SB_URL + "/functions/v1/jarvis-outlook", { method: "POST",
    headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: "Bearer " + (session ? session.access_token : "") },
    body: JSON.stringify(body) });
  return await r.json().catch(() => ({ ok: false, message: "pas de réponse" }));
}
function blocOutlook() {
  const c = document.createElement("div"); c.className = "set";
  c.innerHTML = '<div class="stop"><b>Mails Outlook</b><span></span></div>'
    + '<small>Jarvis lit tes mails (jamais il n’en envoie, n’en déplace ni n’en supprime), garde ce qui compte et le range dans le bon lieu de la ville. Les IBAN et n° de sécu sont masqués.</small>'
    + '<div class="cpt"></div>'
    + '<div class="row2"><button class="btn main go" type="button" style="flex:1">Connecter un compte Outlook</button></div>'
    + '<div class="row2"><button class="btn soft sy" type="button" style="flex:1" hidden>Relire mes mails maintenant</button></div>';
  const st = c.querySelector(".stop span"), cpt = c.querySelector(".cpt"), go = c.querySelector(".go"), sy = c.querySelector(".sy");
  const lister = async () => {
    const { data } = await sb.rpc("jarvis_outlook_etat_comptes");
    cpt.textContent = ""; const l = data || [];
    st.textContent = l.length ? l.length + " boîte" + (l.length > 1 ? "s" : "") + " branchée" + (l.length > 1 ? "s" : "") : "Pas encore branché"; st.className = l.length ? "ok" : "";
    sy.hidden = !l.length; go.textContent = l.length ? "Connecter un autre compte" : "Connecter un compte Outlook";
    l.forEach(a => {
      const d = document.createElement("div"); d.className = "row2"; d.style.alignItems = "center";
      const t = document.createElement("small"); t.style.flex = "1";
      t.textContent = a.compte + " — " + (a.statut === "branché" ? "✓ " : "⚠︎ ") + a.statut
        + (a.derniere_sync ? " · relu à " + new Date(a.derniere_sync).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "")
        + " · " + (a.nb_mails || 0) + " mails, " + (a.nb_infos || 0) + " infos gardées" + (a.erreur && a.statut !== "branché" ? " (" + a.erreur + ")" : "");
      const b = document.createElement("button"); b.className = "btn soft"; b.type = "button"; b.textContent = a.statut === "à reconnecter" ? "Reconnecter" : "Débrancher";
      b.addEventListener("click", async () => {
        if (b.textContent === "Reconnecter") { go.click(); return; }
        if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Sûr ?"; return; }
        b.disabled = true; const j = await appelOutlook({ action: "deconnecter", compte: a.compte });
        toast(j.message || "Débranché"); lister();
      });
      d.append(t, b); cpt.append(d);
    });
  };
  go.addEventListener("click", async () => {
    go.disabled = true; go.textContent = "J’ouvre Microsoft…";
    const j = await appelOutlook({ action: "start" });
    go.disabled = false;
    if (!j.ok || !j.url) { go.textContent = "Connecter un compte Outlook"; toast(j.message || "Je n’arrive pas à ouvrir Microsoft."); return; }
    location.href = j.url;
  });
  sy.addEventListener("click", async () => {
    sy.disabled = true; sy.textContent = "Je relis tes mails…";
    const j = await appelOutlook({ action: "sync" });
    sy.disabled = false; sy.textContent = "Relire mes mails maintenant";
    if (!j.ok) { toast("Pas relu : " + (j.message || j.error || "?")); return; }
    const n = (j.comptes || []).reduce((s, x) => s + (x.nouveaux || 0), 0), err = (j.comptes || []).find(x => x.erreur);
    toast(err ? "Souci avec " + err.compte + " : " + err.erreur : n + " nouveau" + (n > 1 ? "x" : "") + " mail" + (n > 1 ? "s" : "") + ", " + (j.tries?.tries || 0) + " triés ✓");
    lister(); loadAll();
  });
  lister();
  return c;
}
// Retour de Microsoft (…/jarvis/?outlook=ok)
{ const q = new URLSearchParams(location.search).get("outlook");
  if (q) { window.history.replaceState(null, "", location.pathname); setTimeout(() => toast(q === "ok" ? "Outlook est branché ✓ Je range tes mails, ça prend quelques minutes." : "Outlook n’est pas branché. Réessaie depuis les Réglages."), 1500); } }

function blocConnecteur() {
  const URL_MCP = SB_URL + "/functions/v1/jarvis-mcp";
  const c = document.createElement("div"); c.className = "set";
  c.innerHTML = '<div class="stop"><b>Connecteur Claude</b><span></span></div>'
    + '<small>Pour parler à Jarvis avec la vraie voix de l’app Claude (iPhone, Mac). Adresse du connecteur :</small>'
    + '<div class="row2"><input readonly class="url"><button class="btn soft" type="button">Copier</button></div>'
    + '<div class="row2"><button class="btn main gen" type="button" style="flex:1">Créer ma clé</button></div>'
    + '<div class="tok" hidden><small><b>Ta clé (affichée une seule fois) :</b></small><div class="row2"><input readonly class="tk"><button class="btn soft" type="button">Copier</button></div></div>'
    + '<small>Dans Claude : Personnaliser › Connecteurs › + › Ajouter un connecteur personnalisé. Nom : Jarvis. Colle l’adresse. Authentification : « Pas de connexion ». En-têtes de requête : nom <b>Authorization</b>, valeur <b>Bearer</b> + espace + ta clé.</small>';
  const st = c.querySelector(".stop span"), url = c.querySelector(".url"), gen = c.querySelector(".gen"), box = c.querySelector(".tok"), tk = c.querySelector(".tk");
  url.value = URL_MCP;
  const copier = (v, quoi) => { (navigator.clipboard?.writeText(v) || Promise.reject()).then(() => toast(quoi + " copiée ✓"), () => toast("Touche longtemps le champ pour copier")); };
  c.querySelectorAll(".row2 .btn.soft")[0].addEventListener("click", () => copier(URL_MCP, "Adresse"));
  c.querySelectorAll(".row2 .btn.soft")[1].addEventListener("click", () => copier("Bearer " + tk.value, "Valeur « Bearer + clé »"));
  sb.rpc("jarvis_mcp_token_status").then(({ data }) => { if (data) { st.textContent = "Clé créée ✓"; st.className = "ok"; gen.textContent = "Remplacer ma clé"; } else st.textContent = "Pas encore de clé"; });
  gen.addEventListener("click", async () => {
    if (gen.textContent.startsWith("Remplacer") && gen.dataset.sure !== "1") { gen.dataset.sure = "1"; gen.textContent = "Touche encore : l’ancienne clé ne marchera plus"; return; }
    gen.disabled = true;
    const { data, error } = await sb.rpc("jarvis_new_mcp_token");
    gen.disabled = false; gen.dataset.sure = "";
    if (error || !data) { toast("Pas créée : " + (error ? error.message : "")); return; }
    tk.value = data; box.hidden = false; st.textContent = "Clé créée ✓"; st.className = "ok"; gen.textContent = "Remplacer ma clé";
    toast("Clé créée. Copie-la maintenant, elle ne sera plus affichée.");
  });
  return c;
}
function blocVoix() {
  const c = document.createElement("div"); c.className = "set";
  c.innerHTML = '<div class="stop"><b>Voix de Jarvis</b><span></span></div><div class="row2"><select></select><button class="btn main" type="button">Écouter</button></div>'
    + '<label class="tog"><input type="checkbox"> Lire aussi les réponses quand j’écris</label>'
    + '<small>Pour une voix naturelle, télécharge une fois une voix française « Premium » (gratuit) : Réglages de l’iPhone › Accessibilité › Contenu énoncé › Voix › Français, par exemple « Amélie (Premium) » ou « Thomas (amélioré) ». Puis reviens ici et choisis-la.</small>';
  const sel = c.querySelector("select"), b = c.querySelector("button"), st = c.querySelector(".stop span"), tog = c.querySelector(".tog input");
  tog.checked = lireToujours(); tog.addEventListener("change", () => store.set("jarvis.lire", tog.checked ? "1" : "0"));
  const remplir = () => {
    const l = voix.liste().sort((a, b) => voix.note(b) - voix.note(a)), cur = voix.choisie();
    sel.innerHTML = "";
    if (!l.length) { const o = document.createElement("option"); o.textContent = "Aucune voix française trouvée"; sel.append(o); sel.disabled = true; st.textContent = ""; return; }
    sel.disabled = false;
    l.forEach(v => { const o = document.createElement("option"); o.value = v.name; o.textContent = v.name.replace(/\s*\(.*?\)\s*$/, "") + (/premium/i.test(v.name) ? " · Premium" : /enhanced|amélior/i.test(v.name) ? " · Améliorée" : "") + (/fr-CA/i.test(v.lang) ? " (Canada)" : /fr-BE/i.test(v.lang) ? " (Belgique)" : /fr-CH/i.test(v.lang) ? " (Suisse)" : ""); if (cur && v.name === cur.name) o.selected = true; sel.append(o); });
    const top = voix.note(l[0]) >= 6; st.textContent = top ? "Voix naturelle ✓" : "Voix de base"; st.className = top ? "ok" : "";
  };
  remplir(); if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = remplir;
  sel.addEventListener("change", () => store.set("jarvis.voix", sel.value));
  b.addEventListener("click", () => { voix.stop(); voix.dire("Bonjour" + (S.prenom ? " " + S.prenom : "") + ", c’est Jarvis. Je suis là quand tu as besoin de moi."); setTimeout(() => voix.finPossible(), 50); });
  return c;
}
function closeSettings(keep) { if (!setOpen) return; setOpen = false; $("setsheet").classList.remove("open"); document.activeElement?.blur?.(); if (!keep) { viewShiftGoal = 0; $("ask").classList.remove("away"); } }
$("gear").addEventListener("click", () => setOpen ? closeSettings() : openSettings());
$("sClose").addEventListener("click", () => closeSettings());
swipeClose($("setsheet").querySelector(".card"), () => closeSettings());
$("sOut").addEventListener("click", async () => { closeSettings(); await sb.auth.signOut(); });

/* =========================================================
   La porte d'entrée
   ========================================================= */

/* ---------- Ta voiture : la vraie DS5, gardée dans le coffre privé « modeles » (jamais dans le dépôt public) ---------- */
async function chargerDS5(essai = 1) {
  try {
    const { data, error } = await sb.storage.from("modeles").createSignedUrl("ds5.glb", 3600);
    if (error || !data) throw new Error("coffre : " + (error ? error.message : "pas de lien"));
    await V.chargerVoiture(data.signedUrl);
    window.__ds5 = "ok";
  } catch (e) {
    window.__ds5 = "erreur : " + (e && e.message || e); console.warn("DS5", e);
    if (essai < 3) setTimeout(() => chargerDS5(essai + 1), 2500 * essai);
    else toast("Ta DS5 n’a pas pu se charger (" + window.__ds5 + ")");
  }
}
const gate = $("gate"), gmsg = $("gmsg");
function showGate(msg) { gate.hidden = false; if (msg) gmsg.textContent = msg; }
async function enter(session) {
  if (!session) { showGate(); return; }
  const { data: ok } = await sb.rpc("jarvis_is_owner");
  if (ok !== true) { showGate(session.user && !session.user.email_confirmed_at ? "Confirme d’abord ton e-mail (lien reçu), puis reviens ici." : "Cette ville est privée."); return; }
  gate.hidden = true;
  chargerDS5(); // la voiture se charge tout de suite, sans attendre le reste
  await loadAll(); goLive(); goTelecommande();
  // Le bandeau du haut a pris sa vraie taille : on recadre si tu n’as encore rien touché
  if (!userMoved && !S.sel) overview();
}
$("gform").addEventListener("submit", async e => {
  e.preventDefault(); const email = $("gmail").value.trim(), password = $("gpass").value;
  $("gin").disabled = true; gmsg.textContent = "J’ouvre…";
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  $("gin").disabled = false;
  if (error) { gmsg.textContent = /confirm/i.test(error.message) ? "Confirme d’abord ton e-mail : touche le lien que tu as reçu." : "E-mail ou mot de passe incorrect."; return; }
  enter(data.session);
});
sb.auth.onAuthStateChange((ev, session) => { if (ev === "SIGNED_OUT") { showGate("Connecte-toi pour ouvrir ta ville."); } });
sb.auth.getSession().then(({ data }) => enter(data.session));


/* ---------- Mise à jour : l'app regarde toute seule s'il y a une nouvelle version en ligne ---------- */
const VERSION = (document.querySelector('script[src*="app.js?v="]')?.getAttribute("src") || "").split("v=")[1] || "";
let majVue = false;
async function verifierMaj() {
  if (majVue || !VERSION) return;
  try {
    const html = await (await fetch(location.pathname + "?t=" + Date.now(), { cache: "no-store" })).text();
    const m = html.match(/app\.js\?v=([\w.-]+)/); if (!m || m[1] === VERSION) return;
    majVue = true;
    const b = document.createElement("button"); b.className = "maj"; b.type = "button";
    b.innerHTML = "<span>↻</span> Mise à jour";
    b.onclick = () => { b.disabled = true; b.innerHTML = "<span>↻</span> Je recharge…"; location.replace(location.pathname + "?v=" + m[1]); };
    document.body.appendChild(b); requestAnimationFrame(() => b.classList.add("on"));
  } catch (e) { /* pas de réseau : on réessaiera */ }
}
setInterval(verifierMaj, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) verifierMaj(); });
addEventListener("focus", verifierMaj);
setTimeout(verifierMaj, 5000);
/* ---------- Démarrage ---------- */
refreshPins(); updateBrief();
window.__jv = { V, select, deselect, openDetails, PLACES, byId, refreshPins, applySky };

$("alertClose").addEventListener("click", () => $("alertwrap").classList.remove("open"));
$("alertwrap").addEventListener("click", e => { if (e.target.id === "alertwrap") $("alertwrap").classList.remove("open"); });
