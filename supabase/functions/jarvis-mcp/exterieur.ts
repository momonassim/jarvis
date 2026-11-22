// Jarvis — sources publiques branchées directement dans Supabase (sans connecteur, sans compte) :
//  - Prix Carburant (data.economie.gouv.fr, flux officiel instantané)
//  - Rappel Conso (data.economie.gouv.fr, rappels de produits officiels)
//  - Grand Lyon (data.grandlyon.com, chantiers qui gênent la circulation)
//  - ntfy (notifications sur l'iPhone, appli ntfy abonnée au canal secret de Jarvis)
// Aucune donnée personnelle ici : les adresses (maison, usine) et le canal ntfy sont dans le coffre (vault).

type Secret = (nom: string) => Promise<string>;
type Pt = { nom: string; lat: number; lon: number };

const ECO = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets";
const UA = { "User-Agent": "Jarvis-perso/1.0 (usage personnel)", "Accept": "application/json" };
const frd = (d?: string | null) => d ? String(d).slice(0, 10).split("-").reverse().join("/") : "";

async function getJson(url: string, ms = 12000) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(ms) });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${t.slice(0, 160)}`);
  return JSON.parse(t);
}

// distance à vol d'oiseau, en km
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371, r = Math.PI / 180;
  const dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Les lieux connus (maison, usine) sont rangés dans le coffre sous LIEUX_GPS
let GPS: { v: Record<string, Pt>; t: number } | null = null;
async function lieuxGps(secret: Secret): Promise<Record<string, Pt>> {
  if (GPS && Date.now() - GPS.t < 600_000) return GPS.v;
  let v: Record<string, Pt> = {};
  try { v = JSON.parse((await secret("LIEUX_GPS")) || "{}"); } catch { v = {}; }
  GPS = { v, t: Date.now() }; return v;
}
async function point(secret: Secret, autour?: string, lat?: number, lon?: number): Promise<Pt | null> {
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { nom: "ce point", lat: Number(lat), lon: Number(lon) };
  const l = await lieuxGps(secret);
  const k = /usine|travail|boulot|v[ée]nissieux/i.test(autour ?? "") ? "usine" : "maison";
  return l[k] ?? null;
}

// ---------- Prix Carburant ----------
const CARBU: Record<string, { champ: string; nom: string }> = {
  gazole: { champ: "gazole", nom: "Gazole" },
  sp95: { champ: "sp95", nom: "SP95" },
  e10: { champ: "e10", nom: "SP95-E10" },
  sp98: { champ: "sp98", nom: "SP98" },
  e85: { champ: "e85", nom: "E85" },
  gpl: { champ: "gplc", nom: "GPL" },
};
export async function carburant(secret: Secret, a: Record<string, any>): Promise<string> {
  const c = CARBU[String(a.carburant ?? "gazole").toLowerCase().replace(/[^a-z0-9]/g, "")] ?? CARBU.gazole;
  const p = await point(secret, a.autour, a.lat, a.lon);
  if (!p) return "Je n'ai pas encore la position de ce lieu dans Jarvis.";
  const rayon = Math.min(Math.max(Number(a.rayon_km) || 5, 1), 30);
  const prix = `${c.champ}_prix`, maj = `${c.champ}_maj`;
  const where = `within_distance(geom, geom'POINT(${p.lon} ${p.lat})', ${rayon}km) and ${prix} is not null`;
  const url = `${ECO}/prix-des-carburants-en-france-flux-instantane-v2/records?limit=60&order_by=${prix}%20asc&where=${encodeURIComponent(where)}`;
  const j = await getJson(url);
  const st = (j.results ?? []).map((s: any) => {
    const g = s.geom ?? { lat: Number(s.latitude) / 1e5, lon: Number(s.longitude) / 1e5 };
    return { ...s, d: km(p, { lat: g.lat, lon: g.lon }), prix: Number(s[prix]), maj: s[maj] };
  }).filter((s: any) => Number.isFinite(s.prix) && s.prix > 0);
  if (!st.length) return `Aucune station avec du ${c.nom} trouvée à moins de ${rayon} km de ${p.nom}.`;
  // on écarte les prix trop vieux (plus de 7 jours), souvent faux
  const frais = st.filter((s: any) => !s.maj || Date.now() - new Date(s.maj).getTime() < 7 * 864e5);
  const liste = (frais.length ? frais : st).sort((x: any, y: any) => x.prix - y.prix).slice(0, Math.min(Number(a.nombre) || 5, 10));
  const moy = st.reduce((s: number, x: any) => s + x.prix, 0) / st.length;
  return `${c.nom} autour de ${p.nom} (${rayon} km, ${st.length} stations, prix officiels) — les moins chères :\n` +
    liste.map((s: any) => `- ${s.prix.toFixed(3).replace(".", ",")} € le litre · ${s.adresse ?? "?"}, ${s.ville ?? ""} · à ${s.d.toFixed(1).replace(".", ",")} km${s.maj ? ` · prix du ${frd(s.maj)}` : ""}${s.horaires_automate_24_24 === "Oui" ? " · automate 24h/24" : ""}`).join("\n") +
    `\nPrix moyen du coin : ${moy.toFixed(3).replace(".", ",")} €.`;
}

// ---------- Rappel Conso ----------
// Les noms de champs du jeu de données changent selon les versions : on les repère par leur nom.
function champ(r: Record<string, any>, ...motifs: RegExp[]) {
  for (const m of motifs) for (const [k, v] of Object.entries(r)) if (m.test(k) && v != null && String(v).trim()) return Array.isArray(v) ? v.join(", ") : String(v);
  return "";
}
const court = (t: string, n = 180) => t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
export async function rappels(a: Record<string, any>): Promise<string> {
  const jours = Math.min(Math.max(Number(a.jours) || 30, 1), 365);
  const depuis = new Date(Date.now() - jours * 864e5).toISOString().slice(0, 10);
  const mots = String(a.recherche ?? "").replace(/["\\]/g, " ").trim();
  const base = `${ECO}/rappelconso-v2-gtin-espaces/records?limit=${Math.min(Number(a.limite) || 10, 25)}`;
  const essais = [
    `${base}&order_by=date_publication%20desc&where=${encodeURIComponent(`date_publication >= date'${depuis}'` + (mots ? ` and search("${mots}")` : ""))}`,
    `${base}&order_by=date_publication%20desc${mots ? `&where=${encodeURIComponent(`search("${mots}")`)}` : ""}`,
    `${base}${mots ? `&where=${encodeURIComponent(`"${mots}"`)}` : ""}`,
  ];
  let res: any[] = [], err = "";
  for (const u of essais) { try { res = (await getJson(u)).results ?? []; err = ""; break; } catch (e) { err = String(e); } }
  if (err) return "Rappel Conso ne répond pas pour l'instant (" + court(err, 120) + ").";
  if (!res.length) return mots ? `Aucun rappel de produit trouvé pour « ${mots} » ces ${jours} derniers jours.` : `Aucun rappel de produit ces ${jours} derniers jours.`;
  return `Rappels de produits officiels (Rappel Conso)${mots ? ` pour « ${mots} »` : ""} :\n` + res.map((r) => {
    const date = champ(r, /^date_publication/, /date.*publi/, /^date/);
    const marque = champ(r, /marque/);
    const produit = champ(r, /^libelle/, /modele|reference/, /nom.*produit/);
    const cat = champ(r, /sous_categorie/, /categorie/);
    const motif = champ(r, /motif/, /risque/);
    const faire = champ(r, /conduite|consommateur.*faire|preconisation/);
    const lien = champ(r, /lien_vers_la_fiche|fiche_rappel|^lien/);
    return `- ${frd(date)} · ${[marque, produit].filter(Boolean).join(" — ") || "produit"}${cat ? ` (${cat})` : ""}${motif ? ` · motif : ${court(motif)}` : ""}${faire ? ` · à faire : ${court(faire, 140)}` : ""}${lien ? ` · ${lien}` : ""}`;
  }).join("\n");
}

// ---------- Grand Lyon : chantiers qui gênent la circulation ----------
const GL = "https://data.grandlyon.com/geoserver/metropole-de-lyon/ows?SERVICE=WFS&VERSION=2.0.0&request=GetFeature&outputFormat=application/json&SRSNAME=EPSG:4171&typename=metropole-de-lyon:pvo_patrimoine_voirie.pvochantierperturbant";
function premierPoint(g: any): { lat: number; lon: number } | null {
  let c = g?.coordinates; if (!c) return null;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) && c.length >= 2 ? { lon: Number(c[0]), lat: Number(c[1]) } : null;
}
let CHANTIERS: { v: any[]; t: number } | null = null;
export async function chantiers(secret: Secret, a: Record<string, any>): Promise<string> {
  if (!CHANTIERS || Date.now() - CHANTIERS.t > 900_000) {
    const j = await getJson(GL, 20000);
    CHANTIERS = { v: j.features ?? [], t: Date.now() };
  }
  const tous = CHANTIERS.v;
  if (!tous.length) return "Le Grand Lyon ne signale aucun chantier gênant en ce moment.";
  const gps = await lieuxGps(secret);
  const rayon = Math.min(Math.max(Number(a.rayon_km) || 1.5, 0.3), 15);
  const mots = String(a.recherche ?? "").toLowerCase().trim();
  // par défaut : autour de la maison ET de l'usine ; sinon le lieu demandé
  const pts: Pt[] = a.autour ? [(await point(secret, a.autour)) as Pt].filter(Boolean) : Object.values(gps);
  const td = new Date().toISOString().slice(0, 10);
  const lignes: string[] = [];
  for (const f of tous) {
    const p = f.properties ?? {};
    const texte = Object.values(p).filter((v) => typeof v === "string").join(" ");
    if (mots && !texte.toLowerCase().includes(mots)) continue;
    const pp = premierPoint(f.geometry);
    let pres: { nom: string; d: number } | null = null;
    if (!mots) {
      if (!pp) continue;
      for (const q of pts) { const d = km(pp, q); if (d <= rayon && (!pres || d < pres.d)) pres = { nom: q.nom, d }; }
      if (!pres) continue;
    }
    const fin = champ(p, /fin/i), debut = champ(p, /debut|début/i);
    if (fin && fin.slice(0, 10) < td) continue; // déjà fini
    const quoi = champ(p, /^nom$/i, /libelle|intitule|objet|nature|titre/i) || "Chantier";
    const ou = [champ(p, /adresse|voie|rue|localisation/i), champ(p, /commune/i)].filter(Boolean).join(", ");
    const gene = champ(p, /mesure|circulation|restriction|perturbation|impact/i);
    lignes.push(`- ${court(quoi, 120)}${ou ? ` · ${court(ou, 100)}` : ""}${debut || fin ? ` · du ${frd(debut) || "?"} au ${frd(fin) || "?"}` : ""}${gene ? ` · ${court(gene, 140)}` : ""}${pres ? ` · à ${(pres.d * 1000).toFixed(0)} m de ${pres.nom}` : ""}`);
  }
  if (!lignes.length) return mots ? `Aucun chantier gênant du Grand Lyon pour « ${a.recherche} ».` : `Aucun chantier gênant signalé par le Grand Lyon à moins de ${rayon} km ${a.autour ? "de ce lieu" : "de chez toi ni de l'usine"}.`;
  return `Chantiers qui gênent la circulation (Grand Lyon, données officielles, ${lignes.length}) :\n` + lignes.slice(0, 15).join("\n");
}

// ---------- ntfy : notifications sur l'iPhone ----------
export async function notifier(secret: Secret, a: { titre?: string; texte?: string; priorite?: string; lien?: string; tags?: string }): Promise<string> {
  const topic = await secret("NTFY_TOPIC");
  if (!topic) return "Le canal de notifications n'est pas encore prêt.";
  // en-têtes HTTP : pas d'accents bruts, ntfy accepte le titre encodé (RFC 2047)
  const h: Record<string, string> = { "Title": "=?UTF-8?B?" + btoa(String.fromCharCode(...new TextEncoder().encode(String(a.titre ?? "Jarvis")))) + "?=", "Tags": a.tags ?? "bell" };
  const prio: Record<string, string> = { basse: "2", normale: "3", haute: "4", urgente: "5" };
  h["Priority"] = prio[String(a.priorite ?? "normale")] ?? "3";
  if (a.lien && /^https?:\/\//.test(a.lien)) h["Click"] = a.lien;
  const r = await fetch(`https://ntfy.sh/${topic}`, { method: "POST", headers: h, body: String(a.texte ?? "").slice(0, 3000), signal: AbortSignal.timeout(10000) });
  return r.ok ? "Notification envoyée sur l'iPhone." : `La notification n'est pas partie (HTTP ${r.status}).`;
}
export async function canalNotifications(secret: Secret) {
  return await secret("NTFY_TOPIC");
}
