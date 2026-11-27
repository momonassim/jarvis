// Jarvis — fonction « jarvis-tcl » : les bus en bas de chez lui, en direct (Data Grand Lyon, avec son compte gratuit).
// Réservée au propriétaire (l'app) ou à la tâche planifiée. Lecture seule.
//  { quoi: "passages" }  → prochains passages aux arrêts du bas de la maison + perturbations de ces lignes
//  { quoi: "carte" }     → tracés officiels des lignes (avec leurs couleurs) + position des arrêts
//  { quoi: "vehicules" } → position en direct des bus de ces lignes
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
async function secret(nom: string) { const { data } = await admin.rpc("jarvis_get_secret", { p_name: nom }); return typeof data === "string" ? data : ""; }
async function autorise(req: Request) {
  const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!t) return false;
  if (t === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const c = await secret("CRON_TOKEN"); if (c && t === c) return true;
  const sb = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: "Bearer " + t } } });
  const { data } = await sb.rpc("jarvis_is_owner"); return data === true;
}

// Les arrêts du bas de la maison (id officiels TCL, un par quai/sens)
const ARRETS = [
  { id: "10239", nom: "Brossolette Genas" }, { id: "269", nom: "Brossolette Genas" },
  { id: "268", nom: "Brossolette Genas" }, { id: "42023", nom: "Brossolette Genas" },
  { id: "42681", nom: "Voillot" }, { id: "10092", nom: "Place de la Paix" },
];
const LIGNES = ["C15", "52", "124", "125", "C17"];

let AUTH = { v: "", t: 0 };
async function auth() {
  if (AUTH.v && Date.now() - AUTH.t < 600_000) return AUTH.v;
  const id = await secret("GRANDLYON_ID"), mdp = await secret("GRANDLYON_PASSWORD");
  if (!id || !mdp) throw new Error("acces_absents");
  AUTH = { v: "Basic " + btoa(String.fromCharCode(...new TextEncoder().encode(id + ":" + mdp))), t: Date.now() };
  return AUTH.v;
}
async function lire(url: string, ms = 20000) {
  const r = await fetch(url, { headers: { Authorization: await auth(), Accept: "application/json", "User-Agent": "Jarvis-perso/1.0" }, signal: AbortSignal.timeout(ms) });
  const t = await r.text();
  if (r.status === 401) throw new Error("acces_refuses");
  if (!r.ok) throw new Error(`HTTP ${r.status} ${t.slice(0, 100)}`);
  return JSON.parse(t);
}
const RD = "https://download.data.grandlyon.com/ws/rdata";
const WFS = "https://data.grandlyon.com/geoserver/sytral/ows?SERVICE=WFS&VERSION=1.0.0&request=GetFeature&outputFormat=application/json";
const ligneDe = (code: string) => { const c = String(code || "").toUpperCase(); return LIGNES.find((l) => c === l || c.startsWith(l) && !/\d/.test(c.charAt(l.length))) ?? ""; };

// ---------- prochains passages + perturbations ----------
let CACHE_P: { v: any; t: number } | null = null;
async function passages() {
  if (CACHE_P && Date.now() - CACHE_P.t < 20_000) return CACHE_P.v;
  const res = await Promise.all(ARRETS.map((a) => lire(`${RD}/tcl_sytral.tclpassagearret/all.json?field=id&value=${a.id}&maxfeatures=40`).then((j) => ({ a, v: j.values ?? [] })).catch(() => ({ a, v: [] }))));
  const groupes = new Map<string, any>();
  for (const { a, v } of res) for (const p of v) {
    const ligne = ligneDe(p.ligne); if (!ligne) continue;
    const cle = `${ligne}|${p.direction}`;
    const g = groupes.get(cle) ?? { ligne, direction: p.direction, arret: a.nom, passages: [] as any[] };
    g.passages.push({ heure: String(p.heurepassage ?? "").slice(11, 16), delai: p.delaipassage, direct: p.type === "E" });
    groupes.set(cle, g);
  }
  const liste = [...groupes.values()].map((g) => ({ ...g, passages: g.passages.sort((x: any, y: any) => x.heure.localeCompare(y.heure)).slice(0, 3) }))
    .sort((x, y) => LIGNES.indexOf(x.ligne) - LIGNES.indexOf(y.ligne) || String(x.direction).localeCompare(String(y.direction)));
  let alertes: any[] = [];
  try {
    const j = await lire(`${RD}/tcl_sytral.tclalertetrafic_2/all.json?maxfeatures=500`);
    const maint = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Paris" });
    alertes = (j.values ?? []).filter((x: any) => LIGNES.includes(String(x.ligne_com ?? x.ligne_cli ?? "").toUpperCase()) && (!x.debut || x.debut <= maint) && (!x.fin || x.fin >= maint))
      .map((x: any) => ({ ligne: String(x.ligne_com ?? x.ligne_cli), titre: x.titre, message: x.message, fin: x.fin, grave: /NO_SERVICE|interromp|ne circule pas|supprim|pas de service/i.test(`${x.typeseverite} ${x.titre} ${x.message}`) }));
  } catch (_) { /* pas grave : les horaires suffisent */ }
  const v = { lu_le: new Date().toISOString(), liste, alertes };
  CACHE_P = { v, t: Date.now() };
  return v;
}

// ---------- carte : tracés + arrêts (change rarement : gardé 12 h) ----------
let CACHE_C: { v: any; t: number } | null = null;
async function carte() {
  if (CACHE_C && Date.now() - CACHE_C.t < 12 * 3600e3) return CACHE_C.v;
  const filtre = encodeURIComponent(`ligne IN (${LIGNES.map((l) => `'${l}'`).join(",")})`);
  const j = await lire(`${WFS}&typename=sytral:tcl_sytral.tcllignebus_2_0_0&maxFeatures=300&CQL_FILTER=${filtre}`, 30000);
  // un tracé par ligne et par sens : le tracé « normal » (NOM) s'il existe, sinon le plus long
  const taille = (f: any) => (f.geometry?.coordinates ?? []).reduce((n: number, l: any[]) => n + l.length, 0);
  const choix = new Map<string, any>();
  for (const f of j.features ?? []) {
    const k = f.properties.ligne + "|" + f.properties.sens, a = choix.get(k);
    const mieux = !a || (f.properties.type_trace === "NOM" && a.properties.type_trace !== "NOM") || (f.properties.type_trace === a.properties.type_trace && taille(f) > taille(a));
    if (mieux) choix.set(k, f);
  }
  const lignes = [...choix.values()]
    .map((f: any) => ({ ligne: f.properties.ligne, sens: f.properties.sens, nom: f.properties.nom_trace, couleur: f.properties.couleur_hex || "#666",
      // on allège le tracé : un point sur trois suffit à l'écran, arrondi à ~1 m
      traits: (f.geometry?.coordinates ?? []).map((l: number[][]) => l.filter((_, i) => i % 3 === 0 || i === l.length - 1).map(([x, y]) => [Math.round(y * 1e5) / 1e5, Math.round(x * 1e5) / 1e5])) }));
  const fa = encodeURIComponent(`id IN (${ARRETS.map((a) => `'${a.id}'`).join(",")})`);
  const ja = await lire(`${WFS}&typename=sytral:tcl_sytral.tclarret&maxFeatures=20&CQL_FILTER=${fa}`, 20000);
  const arrets = (ja.features ?? []).map((f: any) => ({ id: f.properties.id, nom: f.properties.nom, desserte: f.properties.desserte, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }));
  let maison = null; try { const g = JSON.parse((await secret("LIEUX_GPS")) || "{}"); if (g.maison) maison = { lat: g.maison.lat, lon: g.maison.lon }; } catch (_) { /* */ }
  const v = { lignes, arrets, maison };
  CACHE_C = { v, t: Date.now() };
  return v;
}

// ---------- bus en direct (SIRI Lite, flux officiel) ----------
let CACHE_V: { v: any; t: number } | null = null;
async function vehicules() {
  if (CACHE_V && Date.now() - CACHE_V.t < 15_000) return CACHE_V.v;
  const j = await lire("https://data.grandlyon.com/siri-lite/2.0/vehicle-monitoring.json", 25000);
  const acts = (j?.Siri?.ServiceDelivery?.VehicleMonitoringDelivery ?? []).flatMap((d: any) => d.VehicleActivity ?? []);
  const val = (x: any) => Array.isArray(x) ? val(x[0]) : (x && typeof x === "object" ? (x.value ?? "") : (x ?? ""));
  const bus = acts.map((a: any) => {
    const m = a.MonitoredVehicleJourney ?? {}, loc = m.VehicleLocation ?? {};
    const nom = String(val(m.PublishedLineName) || val(m.LineRef));
    const ligne = ligneDe(nom) || ligneDe(String(val(m.LineRef)).split(":").find((p: string) => ligneDe(p)) ?? "");
    // l'âge de la position : le flux TCL donne souvent une position vieille d'une ou deux minutes, la carte s'en sert pour remettre le bus là où il est vraiment
    const vu = Date.parse(String(val(a.RecordedAtTime) || val(m.RecordedAtTime) || "")), age = Number.isFinite(vu) ? Math.max(0, Math.min(600, Math.round((Date.now() - vu) / 1000))) : null;
    return { ligne, vers: val(m.DestinationName) || val(m.DirectionName), lat: Number(loc.Latitude), lon: Number(loc.Longitude), cap: Number(m.Bearing ?? 0), retard: val(m.Delay), age };
  }).filter((b: any) => b.ligne && Number.isFinite(b.lat) && Number.isFinite(b.lon));
  const v = { lu_le: new Date().toISOString(), bus, total_reseau: acts.length };
  CACHE_V = { v, t: Date.now() };
  return v;
}

// ---------- veille (tâche planifiée) : une ligne coupée → une notification, une seule fois, jamais la nuit ----------
async function veille() {
  const h = Number(new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }).slice(0, 2));
  if (h < 6 || h > 21) return { envoyees: 0, nuit: true };
  CACHE_P = null;
  const { alertes } = await passages();
  const { data: mem } = await admin.from("jarvis_items").select("id,data").eq("source", "dehors").eq("kind", "tcl_vus").eq("label", "alertes").maybeSingle();
  const vus = new Set<string>(mem?.data?.ids ?? []);
  const topic = await secret("NTFY_TOPIC"); let n = 0;
  for (const a of alertes.filter((x: any) => x.grave)) {
    const id = `${a.ligne}|${a.titre}|${a.fin}`; if (vus.has(id) || !topic) continue;
    const titre = `Bus ${a.ligne} : ${String(a.titre).replace(/\s*-\s*$/, "")}`;
    const r = await fetch(`https://ntfy.sh/${topic}`, { method: "POST", headers: { "Title": "=?UTF-8?B?" + btoa(String.fromCharCode(...new TextEncoder().encode(titre))) + "?=", "Tags": "bus", "Priority": "4" }, body: String(a.message).slice(0, 1500) });
    if (r.ok) { vus.add(id); n++; }
  }
  const data = { ids: [...vus].slice(-200) };
  if (mem) await admin.from("jarvis_items").update({ data, updated_at: new Date().toISOString() }).eq("id", mem.id);
  else await admin.from("jarvis_items").insert({ source: "dehors", kind: "tcl_vus", label: "alertes", data });
  return { envoyees: n };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await autorise(req))) return json({ erreur: "non autorisé" }, 401);
  const b = await req.json().catch(() => ({}));
  try {
    if (b.quoi === "carte") return json({ ok: true, ...(await carte()) });
    if (b.quoi === "veille") return json({ ok: true, ...(await veille()) });
    if (b.quoi === "vehicules") return json({ ok: true, ...(await vehicules()) });
    return json({ ok: true, ...(await passages()) });
  } catch (e) {
    const m = String(e instanceof Error ? e.message : e);
    return json({ ok: false, message: m === "acces_refuses" ? "Data Grand Lyon refuse tes accès : vérifie le mot de passe dans Réglages." : m === "acces_absents" ? "Il manque tes accès Data Grand Lyon dans Réglages." : "Les TCL ne répondent pas pour l’instant." }, 200);
  }
});
