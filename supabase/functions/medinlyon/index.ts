// Jarvis — robot MédinLyon côté serveur (remplace le script Scriptable).
// Actions : sync (relit tes rendez-vous + PDF), creneaux, reserver, annuler.
// L'e-mail et le mot de passe MédinLyon sont dans les secrets Supabase
// (MEDINLYON_EMAIL, MEDINLYON_PASSWORD) : ils ne sont jamais dans l'app.
// Rien n'est réservé ni annulé sans que l'app l'envoie après ta confirmation.
import { createClient } from "jsr:@supabase/supabase-js@2";

const BASE = "https://www.medinlyon.fr";
const CENTRES: Record<string, string> = { "1": "Villeurbanne", "2": "Lyon 6 Brotteaux" };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

// ---------- petit navigateur avec cookies ----------
class Nav {
  jar = new Map<string, string>();
  async go(path: string, init: RequestInit & { hx?: boolean } = {}) {
    let url = path.startsWith("http") ? path : BASE + path;
    let method = init.method ?? "GET";
    let body = init.body;
    for (let hop = 0; hop < 6; hop++) {
      const h = new Headers(init.headers);
      h.set("User-Agent", UA);
      h.set("Accept-Language", "fr-FR,fr;q=0.9");
      if (init.hx) h.set("HX-Request", "true");
      if (this.jar.size) h.set("Cookie", [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "));
      const res = await fetch(url, { method, body, headers: h, redirect: "manual" });
      for (const c of res.headers.getSetCookie()) {
        const [kv] = c.split(";"); const i = kv.indexOf("=");
        if (i > 0) this.jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
      }
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.body?.cancel();
        url = new URL(loc, url).toString();
        if (res.status !== 307 && res.status !== 308) { method = "GET"; body = undefined; }
        continue;
      }
      if ((res.headers.get("content-type") ?? "").includes("pdf")) return { status: res.status, url, text: "", res };
      return { status: res.status, url, text: await res.text(), res };
    }
    throw new Error("trop de redirections");
  }
}

const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[2] ?? m[3] ?? "") : null;
};
const txt = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

async function login(nav: Nav) {
  const lire = async (n: string) => { const { data } = await admin().rpc("jarvis_get_secret", { p_name: n }); return (typeof data === "string" && data) || Deno.env.get(n); };
  const user = await lire("MEDINLYON_EMAIL"), pass = await lire("MEDINLYON_PASSWORD");
  if (!user || !pass) throw new Error("codes_absents");
  const page = await nav.go("/login");
  const form = page.text.match(/<form[\s\S]*?<\/form>/i)?.[0] ?? "";
  const fd = new URLSearchParams();
  for (const tag of form.match(/<input[^>]*>/gi) ?? []) {
    const n = attr(tag, "name"); if (!n) continue;
    if (n === "username") fd.set(n, user);
    else if (n === "password") fd.set(n, pass);
    else fd.set(n, attr(tag, "value") ?? "");
  }
  const r = await nav.go("/login", { method: "POST", body: fd, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  if (/name="password"/.test(r.text) && /\/login/.test(new URL(r.url).pathname)) throw new Error("connexion_refusee");
}

// ---------- lire les rendez-vous ----------
type Rdv = { id: string; date: string; heure: string; patient: string; pour: string; centre: string; statut: string; annulable: boolean; justificatif: boolean; chemin?: string };
function parseCartes(html: string): Rdv[] {
  const out: Rdv[] = [];
  for (const p of html.split(/(?=<div[^>]*id="rdv_n_\d+")/i)) {
    const id = p.match(/id="rdv_n_(\d+)"/)?.[1]; if (!id) continue;
    const t = txt(p);
    const dm = t.match(/(\d{2})\/(\d{2})\/(\d{4})\s*à\s*(\d{1,2}):(\d{2})/);
    if (!dm) continue;
    const pour = (t.match(/Pour\s+(.*?)(?:Justificatif|Annuler|Terminé|$)/i)?.[1] ?? "").trim();
    out.push({
      id, date: `${dm[3]}-${dm[2]}-${dm[1]}`, heure: `${dm[4].padStart(2, "0")}:${dm[5]}`,
      patient: pour.replace(/^\(Dr[^)]*\)\s*/i, "").replace(/\s+/g, " ").trim(), pour,
      centre: /brotteaux/i.test(t) ? "Lyon 6ème - Brotteaux" : "Villeurbanne",
      statut: "", annulable: /annul/i.test(p), justificatif: /justificatif/i.test(p),
    });
  }
  return out;
}
async function lireCompte(nav: Nav) {
  const page = await nav.go("/mon-compte");
  let html = page.text;
  const urls = new Set<string>();
  for (const tag of html.match(/<[^>]+hx-get="[^"]+"[^>]*>/gi) ?? []) {
    const u = attr(tag, "hx-get"); if (u && u.startsWith("/") && !/logout/i.test(u)) urls.add(u);
  }
  for (const u of urls) { try { html += (await nav.go(u, { hx: true })).text; } catch { /* rien */ } }
  const seen = new Map<string, Rdv>();
  for (const r of parseCartes(html)) if (!seen.has(r.id)) seen.set(r.id, r);
  return { rdv: [...seen.values()], html };
}

async function creneaux(nav: Nav, centre: string, date: string) {
  const r = await nav.go(`/consultation/creneaux?centre=${centre}&date=${date}`, { hx: true });
  const list: { id: string; heure: string; supplement: boolean }[] = [];
  for (const m of r.text.matchAll(/<input[^>]*name="creneau"[^>]*>[\s\S]*?<label[^>]*>([^<]+)<\/label>/gi)) {
    const tag = m[0].match(/<input[^>]*>/)![0];
    const id = attr(tag, "value"); if (!id) continue;
    list.push({ id, heure: m[1].trim(), supplement: /protege/.test(attr(tag, "class") ?? "") });
  }
  return { centre, date, creneaux: list, hors_horaires: /dépassement/i.test(r.text) };
}

// ---------- formulaire de réservation (connecté) ----------
function lireFormulaire(html: string) {
  const form = html.match(/<form[^>]*id="cabinet_form"[\s\S]*?<\/form>/i)?.[0] ?? "";
  const champs = new Map<string, string>();
  for (const tag of form.match(/<input[^>]*>/gi) ?? []) {
    const n = attr(tag, "name"), type = (attr(tag, "type") ?? "text").toLowerCase();
    if (!n || type === "radio" || type === "checkbox" || type === "submit") continue;
    champs.set(n, attr(tag, "value") ?? "");
  }
  const selTag = form.match(/<select[^>]*id="consultation-patient"[^>]*>/i)?.[0] ?? "";
  const sel = form.match(/<select[^>]*id="consultation-patient"[^>]*>([\s\S]*?)<\/select>/i)?.[1] ?? "";
  const patients: { id: string; nom: string; data: Record<string, string> }[] = [];
  for (const o of sel.matchAll(/<option([^>]*)>([^<]*)<\/option>/gi)) {
    const v = attr(o[0], "value"); if (!v) continue;
    const data: Record<string, string> = {};
    for (const d of o[1].matchAll(/data-([a-z0-9_-]+)\s*=\s*"([^"]*)"/gi)) data[d[1].replace(/-/g, "_")] = d[2];
    patients.push({ id: v, nom: txt(o[2]), data });
  }
  return { action: attr(form.match(/<form[^>]*>/i)?.[0] ?? "", "action") || "/consultation/cabinet/confirmer", champs, patients, selName: attr(selTag, "name") ?? "patient" };
}
// structure seulement (noms des champs, jamais leurs valeurs) pour réparer le robot si le site change
function structure(html: string) {
  const forms = [...html.matchAll(/<form([^>]*)>([\s\S]*?)<\/form>/gi)].map((f) => ({
    tag: f[1].replace(/\s+/g, " ").slice(0, 200),
    champs: [...f[2].matchAll(/<(input|select|textarea|button)([^>]*)>/gi)].map((c) => c[1] + ":" + (attr(c[0], "name") ?? attr(c[0], "id") ?? "") + ":" + (attr(c[0], "type") ?? "")),
  }));
  const hx = [...new Set([...html.matchAll(/(hx-(?:get|post|delete|put)="[^"]*")/gi)].map((m) => m[1].replace(/\d{5,}/g, "ID")))];
  const dataKeys = [...new Set([...html.matchAll(/<option[^>]*?(data-[a-z0-9_-]+)=/gi)].map((m) => m[1]))];
  const annul = [...new Set([...html.matchAll(/<(?:a|button)[^>]*>[^<]*annul[^<]*</gi)].map((m) => m[0].replace(/\d{5,}/g, "ID").slice(0, 300)))];
  return { forms, hx, dataKeys, annul };
}

// ---------- Supabase ----------
const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
async function ranger(rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const { error } = await admin().from("jarvis_items").upsert(rows, { onConflict: "source,kind,label,date_key" });
  if (error) throw new Error("supabase " + error.message);
}
const trace = (label: string, data: Record<string, unknown>) =>
  ranger([{ source: "medinlyon", kind: "reperage", label, date: null, data: { ...data, le: new Date().toISOString() } }]);

async function sync(nav: Nav) {
  const { rdv, html } = await lireCompte(nav);
  const sb = admin();
  const { data: deja } = await sb.storage.from("papiers").list("medinlyon", { limit: 1000 });
  const stock = new Set((deja ?? []).map((f) => f.name));
  const auj = today();
  for (const r of rdv) {
    r.statut = r.date >= auj ? "a_venir" : "passe";
    const nom = `${r.id}.pdf`;
    if (stock.has(nom)) { r.chemin = "medinlyon/" + nom; continue; }
    if (!r.justificatif) continue;
    try {
      const p = await nav.go(`/mon-compte/rendezvous/${r.id}/justificatif`);
      if ((p.res.headers.get("content-type") ?? "").includes("pdf")) {
        const buf = new Uint8Array(await p.res.arrayBuffer());
        const { error } = await sb.storage.from("papiers").upload("medinlyon/" + nom, buf, { contentType: "application/pdf", upsert: true });
        if (!error) r.chemin = "medinlyon/" + nom;
      }
    } catch { /* PDF plus disponible */ }
  }
  const rows: Record<string, unknown>[] = rdv.map((r) => ({ source: "medinlyon", kind: "rdv", label: "rdv " + r.id, date: r.date, data: r }));
  // un rendez-vous à venir qui a disparu du site = annulé
  const { data: anciens } = await sb.from("jarvis_items").select("label,date,data").eq("source", "medinlyon").eq("kind", "rdv");
  const ids = new Set(rdv.map((r) => r.id));
  if (rdv.length) for (const a of anciens ?? []) {
    const d = a.data as Rdv;
    if (!ids.has(d.id) && d.statut === "a_venir") rows.push({ source: "medinlyon", kind: "rdv", label: a.label, date: a.date, data: { ...d, statut: "annule" } });
  }
  // créneaux proposés (aujourd'hui et demain) et la famille
  const cab = await nav.go("/consultation/cabinet");
  const f = lireFormulaire(cab.text);
  const dates = [...new Set([...cab.text.matchAll(/name="date"[^>]*value="(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]))];
  for (const c of Object.keys(CENTRES)) for (const d of dates) {
    const x = await creneaux(nav, c, d);
    rows.push({ source: "medinlyon", kind: "creneaux", label: CENTRES[c], date: d, data: { centre: c, nb: x.creneaux.length, heures: x.creneaux.map((y) => y.heure), creneaux: x.creneaux, hors_horaires: x.hors_horaires } });
  }
  if (f.patients.length) rows.push({ source: "medinlyon", kind: "patients", label: "famille", date: null, data: { liste: f.patients.map((p) => ({ id: p.id, nom: p.nom })) } });
  rows.push({ source: "medinlyon", kind: "reperage", label: "structure", date: null, data: { compte: structure(html), cabinet: structure(cab.text), le: new Date().toISOString() } });
  await ranger(rows);
  return { rdv: rdv.length, a_venir: rdv.filter((r) => r.statut === "a_venir").length, pdf: rdv.filter((r) => r.chemin).length, patients: f.patients.length, dates };
}

async function reserver(nav: Nav, b: Record<string, string>) {
  const { patient, centre, date, creneau } = b;
  if (!/^\d+$/.test(patient ?? "") || !CENTRES[centre] || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !/^\d+$/.test(creneau ?? "")) return { ok: false, message: "Demande incomplète." };
  const cab = await nav.go("/consultation/cabinet");
  const f = lireFormulaire(cab.text);
  const p = f.patients.find((x) => x.id === patient);
  if (!p) return { ok: false, message: "Cette personne n'est pas sur ton compte MédinLyon." };
  const cr = (await creneaux(nav, centre, date)).creneaux.find((x) => x.id === creneau);
  if (!cr) return { ok: false, message: "Ce créneau vient d'être pris. Choisis-en un autre." };
  const fd = new URLSearchParams();
  for (const [k, v] of f.champs) fd.set(k, v);
  for (const [k, v] of Object.entries(p.data)) if (f.champs.has(k) && v) fd.set(k, v);
  fd.set(f.selName, patient); fd.set("centre", centre); fd.set("date", date); fd.set("creneau", creneau);
  if (!fd.get("preference_medecin")) fd.set("preference_medecin", "Le premier médecin disponible");
  const manque = ["prenom", "nom", "date_naissance", "mobile", "email", "adresse", "code_postal", "ville"].filter((k) => !fd.get(k));
  if (manque.length) {
    await trace("reserver", { manque, cabinet: structure(cab.text) });
    return { ok: false, message: "Il me manque des infos de la fiche patient (" + manque.join(", ") + "). Rien n'a été réservé." };
  }
  const r = await nav.go(f.action, { method: "POST", body: fd, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  await sync(nav);
  const { data } = await admin().from("jarvis_items").select("data").eq("source", "medinlyon").eq("kind", "rdv").eq("date", date);
  const pris = (data ?? []).map((x) => x.data as Rdv).find((x) => x.heure === cr.heure && x.statut === "a_venir");
  if (pris) return { ok: true, rdv: pris, message: "Rendez-vous pris." };
  await trace("reserver", { reponse: txt(r.text).slice(0, 600), status: r.status, url: new URL(r.url).pathname });
  return { ok: false, message: "MédinLyon n'a pas confirmé. Regarde tes e-mails : une confirmation est peut-être demandée." };
}

async function annuler(nav: Nav, id?: string) {
  if (!/^\d+$/.test(id ?? "")) return { ok: false, message: "Rendez-vous inconnu." };
  const { rdv, html } = await lireCompte(nav);
  if (!rdv.find((r) => r.id === id)) return { ok: false, message: "Je ne trouve plus ce rendez-vous : il est peut-être déjà annulé." };
  const form = html.match(/<form[^>]*id="annuler_form"[\s\S]*?<\/form>/i)?.[0];
  const carte = html.split(/(?=<div[^>]*id="rdv_n_\d+")/i).find((p) => p.includes(`rdv_n_${id}"`)) ?? "";
  const bouton = (carte.match(/<(?:a|button)[^>]*>[^<]*annul[^<]*</i) ?? [""])[0];
  let action = form ? attr(form.match(/<form[^>]*>/i)![0], "action") : null;
  const fd = new URLSearchParams();
  if (form) for (const tag of form.match(/<(input|textarea|select)[^>]*>/gi) ?? []) {
    const n = attr(tag, "name"); if (!n) continue;
    fd.set(n, /reason|raison|motif/i.test(n + (attr(tag, "id") ?? "")) ? "Empêchement" : (attr(tag, "value") ?? ""));
  }
  for (const [k, v] of [...fd]) if (/id|rdv|rendez/i.test(k) && !v) fd.set(k, id!);
  const viaBouton = attr(bouton, "hx-post") ?? attr(bouton, "data-action") ?? attr(bouton, "data-url");
  if ((!action || action === "#") && viaBouton?.startsWith("/")) action = viaBouton;
  if (!action || action === "#") {
    await trace("annuler", { bouton: bouton.replace(/\d{5,}/g, "ID"), compte: structure(html) });
    return { ok: false, message: "Je n'ai pas encore trouvé comment annuler sur le site. Rien n'a changé." };
  }
  action = action.replace(/\{id\}|__id__|:id/gi, id!);
  if (![...fd.values()].includes(id!) && !action.includes(id!)) fd.set("id", id!);
  const r = await nav.go(action, { method: "POST", body: fd, headers: { "Content-Type": "application/x-www-form-urlencoded" }, hx: true });
  await sync(nav);
  const { data } = await admin().from("jarvis_items").select("data").eq("source", "medinlyon").eq("kind", "rdv").eq("label", "rdv " + id).maybeSingle();
  if ((data?.data as Rdv | undefined)?.statut !== "a_venir") return { ok: true, message: "Rendez-vous annulé." };
  await trace("annuler", { reponse: txt(r.text).slice(0, 600), status: r.status });
  return { ok: false, message: "MédinLyon n'a pas confirmé l'annulation. Le rendez-vous est toujours là." };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "methode" }, 405);
  // seul le propriétaire (la base le vérifie) peut lancer le robot
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: owner } = await sb.rpc("jarvis_is_owner");
  if (owner !== true) return json({ error: "interdit" }, 403);

  let b: Record<string, string> = {};
  try { b = await req.json(); } catch { /* vide */ }
  const nav = new Nav();
  try {
    if (b.action === "creneaux") {
      const c = CENTRES[b.centre] ? b.centre : "1";
      const d = /^\d{4}-\d{2}-\d{2}$/.test(b.date ?? "") ? b.date : today();
      return json({ ok: true, ...(await creneaux(nav, c, d)) });
    }
    await login(nav);
    if (b.action === "sync") return json({ ok: true, ...(await sync(nav)) });
    if (b.action === "reserver") return json(await reserver(nav, b));
    if (b.action === "annuler") return json(await annuler(nav, b.id));
    return json({ error: "action" }, 400);
  } catch (e) {
    const m = String((e as Error).message ?? e);
    if (m === "codes_absents") return json({ ok: false, code: m, message: "Ajoute ton e-mail et ton mot de passe MédinLyon dans les Réglages de Jarvis (roue en haut)." });
    if (m === "connexion_refusee") return json({ ok: false, code: m, message: "MédinLyon refuse la connexion : vérifie l'e-mail et le mot de passe dans les Réglages de Jarvis." });
    try { await trace("erreur", { message: m.slice(0, 300), action: b.action ?? "" }); } catch { /* rien */ }
    return json({ ok: false, code: "erreur", message: "Le robot MédinLyon a eu un souci : " + m.slice(0, 160) });
  }
});
