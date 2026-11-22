// Jarvis — fonction « jarvis-dehors » : les sources publiques rangées dans Jarvis pour que l'app les AFFICHE.
// Lancée toutes les heures par la tâche planifiée (ou par le propriétaire). Rien de personnel n'est envoyé dehors :
// on lit seulement des données publiques (prix des carburants, chantiers du Grand Lyon, Rappel Conso).
//  - carburant : les 3 stations de gazole les moins chères près de chez lui → fiche « Ta voiture »
//  - chantiers : seulement ceux qui le touchent (sa rue, ou tout près de chez lui ou de l'usine) → fiches « Chez toi » et « Ton travail »
//    + une notification ntfy la veille au soir (19 h) quand un chantier qui bloque (fermé, alterné) commence le lendemain
//  - rappels : lait infantile, couches, petits pots, DS5 → rien tant que tout va bien ; sinon alerte rouge + notification
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function secret(nom: string) { const { data } = await admin.rpc("jarvis_get_secret", { p_name: nom }); return typeof data === "string" ? data : ""; }
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
async function sha256(t: string) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))); }
async function autorise(req: Request) {
  const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!t) return false;
  if (t === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const c = await secret("CRON_TOKEN"); if (c && t.length === c.length && await sha256(t) === await sha256(c)) return true;
  const sb = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: "Bearer " + t } } });
  const { data } = await sb.rpc("jarvis_is_owner"); return data === true;
}

const UA = { "User-Agent": "Jarvis-perso/1.0 (usage personnel)", "Accept": "application/json" };
async function getJson(url: string, ms = 15000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  const t = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status} ${t.slice(0, 120)}`); return JSON.parse(t);
}
type Pt = { nom: string; lat: number; lon: number };
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function champ(r: Record<string, any>, ...motifs: RegExp[]) {
  for (const m of motifs) for (const [k, v] of Object.entries(r)) if (m.test(k) && v != null && String(v).trim()) return Array.isArray(v) ? v.join(", ") : String(v);
  return "";
}
const parisJour = (plus = 0) => new Date(Date.now() + plus * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const parisHeure = () => Number(new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", hour12: false }).slice(0, 2));
const court = (t: string, n = 120) => t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;

// une seule ligne par sorte de donnée : on remplace la précédente
async function poser(kind: string, label: string, data: unknown) {
  await admin.from("jarvis_items").delete().eq("source", "dehors").eq("kind", kind).eq("label", label);
  const { error } = await admin.from("jarvis_items").insert({ source: "dehors", kind, label, data, updated_at: new Date().toISOString() });
  if (error) throw new Error(kind + " : " + error.message);
}

async function notifier(titre: string, texte: string, priorite: "3" | "4" | "5", tags: string, lien?: string) {
  const topic = await secret("NTFY_TOPIC"); if (!topic) return false;
  const h: Record<string, string> = { "Title": "=?UTF-8?B?" + btoa(String.fromCharCode(...new TextEncoder().encode(titre))) + "?=", "Tags": tags, "Priority": priorite };
  if (lien) h["Click"] = lien;
  const r = await fetch(`https://ntfy.sh/${topic}`, { method: "POST", headers: h, body: texte.slice(0, 3000), signal: AbortSignal.timeout(10000) });
  return r.ok;
}

// ---------- Carburant : les 3 moins chers près de chez lui (gazole, sa DS5) ----------
const ECO = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets";
async function carburant(maison: Pt) {
  const where = `within_distance(geom, geom'POINT(${maison.lon} ${maison.lat})', 5km) and gazole_prix is not null`;
  const j = await getJson(`${ECO}/prix-des-carburants-en-france-flux-instantane-v2/records?limit=60&order_by=gazole_prix%20asc&where=${encodeURIComponent(where)}`);
  const st = (j.results ?? []).map((s: any) => {
    const g = s.geom ?? { lat: Number(s.latitude) / 1e5, lon: Number(s.longitude) / 1e5 };
    return { prix: Number(s.gazole_prix), maj: s.gazole_maj ?? null, adresse: s.adresse ?? "", ville: s.ville ?? "", lat: g.lat, lon: g.lon, d: km(maison, g), auto: s.horaires_automate_24_24 === "Oui" };
  }).filter((s: any) => Number.isFinite(s.prix) && s.prix > 0);
  if (!st.length) return null;
  const frais = st.filter((s: any) => !s.maj || Date.now() - new Date(s.maj).getTime() < 7 * 864e5);
  const top = (frais.length ? frais : st).sort((a: any, b: any) => a.prix - b.prix).slice(0, 3);
  const moyenne = st.reduce((s: number, x: any) => s + x.prix, 0) / st.length;
  await poser("carburant", "maison", { carburant: "Gazole", stations: top, moyenne, nb: st.length, lu_le: new Date().toISOString() });
  return top[0];
}

// ---------- Chantiers : seulement ceux qui le touchent ----------
const GL = "https://data.grandlyon.com/geoserver/metropole-de-lyon/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&outputFormat=application/json&SRSNAME=EPSG:4171&typename=metropole-de-lyon:pvo_patrimoine_voirie.pvochantierperturbant";
function premierPoint(g: any) { let c = g?.coordinates; if (!c) return null; while (Array.isArray(c) && Array.isArray(c[0])) c = c[0]; return Array.isArray(c) && c.length >= 2 ? { lon: Number(c[0]), lat: Number(c[1]) } : null; }
const SA_RUE = /route de genas/i;      // sa rue
const PRES = 0.5;                       // km : tout près de chez lui ou de l'usine
async function chantiers(lieux: Record<string, Pt>, deja: Set<string>, essai = false) {
  const j = await getJson(GL, 25000), td = parisJour(), demain = parisJour(1);
  const liste: any[] = [], doublons = new Set<string>();
  for (const f of j.features ?? []) {
    const p = f.properties ?? {}, pp = premierPoint(f.geometry); if (!pp) continue;
    const fin = champ(p, /fin/i).slice(0, 10), debut = champ(p, /debut|début/i).slice(0, 10);
    if (fin && fin < td) continue;
    const rue = champ(p, /^nom$/i, /libelle|intitule|objet|nature|titre/i) || "Chantier";
    const ou = champ(p, /adresse|voie|rue|localisation/i), commune = champ(p, /commune/i);
    const gene = champ(p, /mesure|circulation|restriction|perturbation|impact/i);
    let pres: { lieu: string; m: number } | null = null;
    for (const [k, q] of Object.entries(lieux)) { const d = km(pp, q); if (!pres || d < pres.m / 1000) pres = { lieu: k, m: Math.round(d * 1000) }; }
    if (!pres) continue;
    const saRue = SA_RUE.test(rue) && pres.lieu === "maison" && pres.m <= 1500;
    if (!saRue && pres.m > PRES * 1000) continue;
    if (debut && debut > parisJour(14)) continue;      // pas ce qui commence dans plus de 2 semaines
    const id = String(f.id ?? `${rue}|${debut}|${pp.lat.toFixed(4)}`);
    const cle = `${rue}|${ou}|${debut}|${fin}`.toLowerCase(); if (doublons.has(cle)) continue; doublons.add(cle);
    const fort = /interdit|altern|sens unique|ferm/i.test(gene);
    liste.push({ id, fort, rue: court(rue, 80), ou: court(ou, 90), commune, debut, fin, gene: court(gene, 80), lieu: pres.lieu, m: pres.m, sa_rue: saRue, en_cours: !debut || debut <= td });
  }
  // le plus gênant et le plus proche d'abord
  liste.sort((a, b) => Number(b.fort) - Number(a.fort) || a.m - b.m);
  await poser("chantiers", "proches", { liste, lu_le: new Date().toISOString() });
  // la veille au soir : ceux qui commencent demain
  const prevenir = parisHeure() === 19 && !essai ? liste.filter((c) => c.fort && c.debut === demain && !deja.has(c.id)) : [];
  for (const c of prevenir) {
    const ok = await notifier("Travaux demain · " + c.rue, `${c.gene || "Circulation perturbée"}${c.ou ? " · " + c.ou : ""}, à ${c.m} m ${c.lieu === "usine" ? "de l'usine" : "de chez toi"}, jusqu'au ${c.fin ? c.fin.split("-").reverse().join("/") : "?"}.`, "4", "construction");
    if (ok) deja.add(c.id);
  }
  return liste.length;
}

// ---------- Rappels : bébé et voiture ----------
// « garde » : le produit doit vraiment être ce qu'il achète pour le bébé (lait, couches, petits pots) ou une DS5 — pas un yaourt en pot
const LAIT = /((lait|pr[ée]paration)[^.]{0,40}(infantile|nourrisson|b[ée]b[ée]|[12]er? [âa]ge|croissance))|((infantile|nourrisson)[^.]{0,40}lait)/i;
const POTS = /((petits? pots?|pur[ée]e|compote|repas)[^.]{0,40}(b[ée]b[ée]|infantile|mois))|aliments? infantiles?/i;
const SUJETS = [
  { mots: "lait infantile", lieu: "medecin", pour: "le bébé", garde: LAIT },
  { mots: "préparation pour nourrissons", lieu: "medecin", pour: "le bébé", garde: LAIT },
  { mots: "petits pots bébé", lieu: "medecin", pour: "le bébé", garde: POTS },
  { mots: "couches", lieu: "medecin", pour: "le bébé", garde: /couches?[^.]{0,30}(b[ée]b[ée]|enfant|culotte|taille)|culottes? d'apprentissage/i },
  { mots: "DS5", lieu: "garage", pour: "ta DS5", garde: /\bDS\s?5\b/i },
];
async function rappels(vus: Set<string>, essai: boolean) {
  const depuis = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), nouveaux: any[] = [];
  for (const s of SUJETS) {
    const where = `date_publication >= date'${depuis}' and search("${s.mots}")`;
    let res: any[] = [];
    try { res = (await getJson(`${ECO}/rappelconso-v2-gtin-espaces/records?limit=10&order_by=date_publication%20desc&where=${encodeURIComponent(where)}`)).results ?? []; } catch (_) { continue; }
    for (const r of res) {
      const id = champ(r, /numero_fiche|reference_fiche|^id$|guid/i) || champ(r, /^libelle/, /modele/) + "|" + champ(r, /date_publication/);
      if (vus.has(id)) continue; if (!essai) vus.add(id);
      const quoi = [champ(r, /sous_categorie/), champ(r, /^categorie/), champ(r, /^libelle/), champ(r, /modele|reference/), champ(r, /nom.*produit/)].join(" ");
      if (!s.garde.test(quoi)) continue;
      const marque = champ(r, /marque/), produit = champ(r, /^libelle/, /modele|reference/, /nom.*produit/);
      const motif = champ(r, /motif/, /risque/), faire = champ(r, /conduite|consommateur.*faire|preconisation/), lien = champ(r, /lien_vers_la_fiche|fiche_rappel|^lien/);
      nouveaux.push({ ...s, id, titre: court(`Rappel : ${[marque, produit].filter(Boolean).join(" — ") || s.mots}`, 70), texte: court(`${motif ? "Motif : " + motif + ". " : ""}${faire ? "À faire : " + faire : "Vérifie si tu as ce produit."}`, 480), lien, date: champ(r, /date_publication/).slice(0, 10) });
    }
  }
  if (essai) return nouveaux.map((n) => n.titre);
  for (const n of nouveaux) {
    // alerte rouge dans l'app (même format que les alertes des mails : elle se retire avec « C'est vu »)
    const label = `${n.lieu}:rappel-${n.id}`.slice(0, 60);
    const { data: ex } = await admin.from("jarvis_items").select("id").eq("source", "mails").eq("kind", "alerte").eq("label", label).limit(1);
    if (!ex?.length) await admin.from("jarvis_items").insert({ source: "mails", kind: "alerte", label, date: n.date || null, data: { lieu: n.lieu, titre: n.titre, texte: n.texte, de: "Rappel Conso (officiel)", date_mail: n.date || null, vu: false, lien: n.lien || null, pour: n.pour, a_notifier: true } });
  }
  return nouveaux.length;
}
// la notification part entre 6 h et 21 h (pas la nuit) ; sinon elle attend le prochain passage dans ces heures-là
async function notifierRappels() {
  const h = parisHeure(); if (h < 6 || h > 21) return;
  const { data } = await admin.from("jarvis_items").select("id,data").eq("source", "mails").eq("kind", "alerte").like("label", "%:rappel-%");
  for (const x of data ?? []) {
    const d = x.data ?? {}; if (!d.a_notifier || d.vu) continue;
    const ok = await notifier("⚠️ " + d.titre, `Ça peut concerner ${d.pour ?? "toi"}. ${d.texte ?? ""}`, "5", "warning", /^https?:\/\//.test(d.lien ?? "") ? d.lien : undefined);
    if (ok) await admin.from("jarvis_items").update({ data: { ...d, a_notifier: false } }).eq("id", x.id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await autorise(req))) return json({ erreur: "non autorisé" }, 401);
  const corps = await req.json().catch(() => ({}));
  const essai = corps?.essai === true;   // essai : on regarde sans rien alerter ni notifier
  let lieux: Record<string, Pt> = {};
  try { lieux = JSON.parse((await secret("LIEUX_GPS")) || "{}"); } catch { lieux = {}; }
  if (!lieux.maison) return json({ erreur: "position de la maison absente" }, 400);
  // ce qui a déjà été vu / prévenu, pour ne jamais envoyer deux fois la même chose
  const { data: mem } = await admin.from("jarvis_items").select("data").eq("source", "dehors").eq("kind", "memoire").eq("label", "vus").maybeSingle();
  const vus = new Set<string>(mem?.data?.rappels ?? []), deja = new Set<string>(mem?.data?.chantiers ?? []);
  const out: Record<string, unknown> = {};
  try { const s = await carburant(lieux.maison); out.carburant = s ? s.prix : null; } catch (e) { out.carburant = "erreur : " + String(e).slice(0, 120); }
  try { out.chantiers = await chantiers(lieux, essai ? new Set(["*"]) : deja, essai); } catch (e) { out.chantiers = "erreur : " + String(e).slice(0, 120); }
  try { out.rappels = await rappels(vus, essai); } catch (e) { out.rappels = "erreur : " + String(e).slice(0, 120); }
  if (!essai) { try { await notifierRappels(); } catch (_) { /* on réessaiera au prochain passage */ } }
  if (!essai) await poser("memoire", "vus", { rappels: [...vus].slice(-500), chantiers: [...deja].slice(-300) });
  return json({ ok: true, ...out });
});
