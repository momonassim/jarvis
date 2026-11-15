// Jarvis — connecteur pour Claude (serveur MCP distant).
// Ajouté dans Claude (iPhone, Mac, web) comme « connecteur personnalisé », il donne à Claude
// — et à son mode vocal — l'accès à Jarvis : loyer, énergie, santé, impôts, papiers, rendez-vous.
// Protégé par une clé que le propriétaire crée dans les Réglages de Jarvis (seule son empreinte est gardée).
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(URL_SB, SERVICE, { auth: { persistSession: false } });
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const json = (o: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...extra } });
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const eur = (n: unknown) => Number(n ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const frd = (d?: string | null) => d ? d.slice(0, 10).split("-").reverse().join("/") : "";
const today = (plus = 0) => new Date(Date.now() + plus * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const jour = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });

// ---------- sécurité ----------
async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function autorise(req: Request) {
  const tok = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!tok.startsWith("jv_")) return false;
  const { data } = await admin.rpc("jarvis_get_secret", { p_name: "MCP_TOKEN_HASH" });
  if (typeof data !== "string" || !data) return false;
  const h = await sha256(tok);
  let diff = h.length ^ data.length;
  for (let i = 0; i < Math.min(h.length, data.length); i++) diff |= h.charCodeAt(i) ^ data.charCodeAt(i);
  return diff === 0;
}

// ---------- les données ----------
type Row = { source: string; kind: string; label: string; date: string | null; amount: number | null; data: any; updated_at: string };
async function lignes(): Promise<Row[]> {
  const { data, error } = await admin.from("jarvis_items").select("source,kind,label,date,amount,data,updated_at").not("kind", "in", "(debug,reperage)").limit(5000);
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}
const LIEUX: Record<string, { mac?: string; nom: string }> = {
  logement: { nom: "Chez toi (logement, loyer Foncia)" },
  energie: { nom: "Gaz et électricité (Plenitude)" },
  sante: { mac: "clinique", nom: "Santé (rendez-vous MédinLyon de la famille)" },
  travail: { mac: "usine", nom: "Travail et paies" },
  impots: { mac: "impots", nom: "Impôts et amendes" },
  voiture: { mac: "garage", nom: "Voiture" },
  papiers: { mac: "mairie", nom: "Papiers d'identité" },
  banque: { mac: "banque", nom: "Argent et banque" },
  bebe: { mac: "medecin", nom: "Le bébé" },
  abonnements: { mac: "orange", nom: "Abonnements" },
};
function mac(rows: Row[], id: string, detail: boolean) {
  const r = rows.find((x) => x.source === "mac" && x.kind === "lieu" && x.label === id); if (!r) return "";
  const d = r.data ?? {};
  let t = [d.place && `(${d.place})`, d.say, ...(d.facts ?? []).map((f: string[]) => `${f[0]} : ${f[1]}`)].filter(Boolean).join("\n");
  if (detail && (d.docs ?? []).length) t += "\nPapiers rangés :\n" + d.docs.map((x: any) => `- ${x.t} · ${x.d} ${x.v ?? ""} (${(x.lines ?? []).map((l: string[]) => l.join(" : ")).join(" ; ")})`).join("\n");
  return t;
}
function logement(rows: Row[], detail: boolean) {
  const f = rows.filter((r) => r.source === "foncia"); if (!f.length) return "Pas encore relu.";
  const by = (k: string) => f.filter((r) => r.kind === k);
  const ops = by("operation").filter((r) => r.date).sort((a, b) => b.date!.localeCompare(a.date!));
  const appel = ops.find((r) => /^APPEL/i.test(r.label)); const loyer = appel ? Math.abs(Number(appel.amount)) : null;
  const prel = by("paiement").filter((r) => r.date).sort((a, b) => b.date!.localeCompare(a.date!))[0];
  const solde = by("compte")[0]; const g = by("contact")[0]?.data ?? {}; const docs = by("document");
  let t = `Loyer + charges : ${loyer ? eur(loyer) : "?"} par mois. Solde du compte Foncia : ${solde ? eur(solde.amount) : "?"}${Number(solde?.amount) === 0 ? " (à jour)" : ""}.`
    + (prel ? ` Dernier prélèvement : ${eur(prel.amount)} le ${frd(prel.date)}.` : "")
    + (g.nom ? ` Gestionnaire : ${g.nom}, ${g.agence ?? ""}, tél. ${g.telephone ?? "?"}.` : "")
    + ` ${docs.length} papiers Foncia rangés (quittances, avis d'échéance, régularisations…).`;
  if (detail) {
    t += "\nDernières opérations :\n" + ops.slice(0, 12).map((r) => `- ${frd(r.date)} ${r.label} : ${eur(r.amount)}`).join("\n");
    by("intervention").forEach((r) => t += `\nIntervention : ${r.label} (${r.data?.statut ?? "?"}, ${frd(r.date)})`);
  }
  return t;
}
function energie(rows: Row[], detail: boolean) {
  const e = rows.filter((r) => r.source === "plenitude"); if (!e.length) return "Pas encore relu.";
  const td = today(), ENS = ["Gaz", "Électricité"];
  const srt = (k: string) => e.filter((r) => r.kind === k && r.date).sort((a, b) => a.date!.localeCompare(b.date!));
  const pay = srt("paiement"), ech = srt("echeance").filter((r) => r.date! >= td);
  const plan = Object.fromEntries(e.filter((r) => r.kind === "echeancier").map((r) => [r.label, r.data]));
  const conso = Object.fromEntries(e.filter((r) => r.kind === "conso").map((r) => [r.label, r.data]));
  let tot = 0, t = "Données lues chez Plenitude (échéancier officiel et historique des paiements).";
  for (const n of ENS) {
    const nx = ech.find((r) => r.label === n), last = pay.filter((r) => r.label === n).slice(-1)[0];
    if (nx) tot += Number(nx.amount);
    t += ` ${n} : ${nx ? `${eur(nx.amount)} par mois à partir du ${frd(nx.date)}` : "pas d'échéance à venir"}` + (last ? `, dernier prélèvement ${eur(last.amount)} le ${frd(last.date)}` : "") + (plan[n]?.conso_annuelle_kwh ? `, conso estimée ${plan[n].conso_annuelle_kwh} kWh/an` : "") + ".";
  }
  if (tot) t += ` Total à venir : ${eur(tot)} par mois.`;
  const pf = (plan["Gaz"] ?? plan["Électricité"])?.prochaine_facture; if (pf) t += ` Prochaine facture prévue le ${frd(pf)}.`;
  for (const [k, v] of Object.entries(conso) as [string, any][]) t += ` Conso ${k} : ${(v.mois ?? []).map((m: string, i: number) => `${m} ${v.kwh?.[i]} kWh`).join(", ")}.`;
  if (detail) for (const n of ENS) {
    t += `\nÉchéancier ${n} :\n` + ech.filter((r) => r.label === n).map((r) => `- ${frd(r.date)} : ${eur(r.amount)}`).join("\n");
    t += `\nPrélèvements ${n} déjà payés :\n` + pay.filter((r) => r.label === n).reverse().map((r) => `- ${frd(r.date)} : ${eur(r.amount)}`).join("\n");
  }
  return t;
}
function sante(rows: Row[], detail: boolean) {
  const m = rows.filter((r) => r.source === "medinlyon");
  const rdv = m.filter((r) => r.kind === "rdv").map((r) => r.data).filter((r) => r && r.statut !== "annule")
    .map((r) => ({ ...r, statut: r.date >= today() ? "a_venir" : "passe" })).sort((a, b) => (a.date + a.heure).localeCompare(b.date + b.heure));
  const fut = rdv.filter((r) => r.statut === "a_venir"), passes = rdv.filter((r) => r.statut === "passe").reverse();
  const fam = (m.find((r) => r.kind === "patients")?.data?.liste ?? []).map((p: any) => p.nom);
  let t = fut.length ? "Rendez-vous à venir :\n" + fut.map((r) => `- ${r.patient}, ${jour(r.date)} à ${r.heure.replace(":", "h")}, centre ${r.centre} (n° ${r.id})`).join("\n") : "Aucun rendez-vous médical à venir.";
  if (passes[0]) t += `\nDernier rendez-vous : ${passes[0].patient} le ${frd(passes[0].date)}.`;
  if (fam.length) t += `\nFamille sur le compte MédinLyon : ${fam.join(", ")}.`;
  if (detail) t += "\nHistorique :\n" + passes.slice(0, 20).map((r) => `- ${frd(r.date)} ${r.heure} · ${r.patient} · ${r.centre}${r.chemin ? " · justificatif PDF" : ""}`).join("\n");
  const ma = mac(rows, "clinique", detail); if (ma) t += "\n" + ma;
  return t;
}
function lieu(rows: Row[], id: string, detail: boolean) {
  if (id === "logement") return logement(rows, detail);
  if (id === "energie") return energie(rows, detail);
  if (id === "sante") return sante(rows, detail);
  const l = LIEUX[id]; return (l?.mac && mac(rows, l.mac, detail)) || "Rien pour ce lieu pour l'instant.";
}
async function resume() {
  const rows = await lignes();
  const prof = rows.find((r) => r.source === "jarvis" && r.kind === "profil")?.data?.texte ?? "";
  const now = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" });
  return `Jarvis — situation au ${now}.\n${prof}\n\n` + Object.entries(LIEUX).map(([id, l]) => `## ${l.nom}\n${lieu(rows, id, false)}`).join("\n\n");
}
async function documents(q: string) {
  const rows = await lignes(); const mots = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/\s+/).filter(Boolean);
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const cands: { titre: string; chemin: string; date: string }[] = [];
  rows.filter((r) => r.source === "foncia" && r.kind === "document" && r.data?.path).forEach((r) => cands.push({ titre: "Foncia · " + r.label.replace(/\.pdf$/i, ""), chemin: "foncia/" + r.data.path, date: r.date ?? "" }));
  rows.filter((r) => r.source === "mac" && r.kind === "lieu").forEach((r) => (r.data?.docs ?? []).filter((x: any) => x.path).forEach((x: any) => cands.push({ titre: `${x.t} ${x.d ?? ""}`.trim(), chemin: x.path, date: "" })));
  rows.filter((r) => r.source === "medinlyon" && r.kind === "rdv" && r.data?.chemin).forEach((r) => cands.push({ titre: `MédinLyon · justificatif ${r.data.patient} du ${frd(r.data.date)}`, chemin: r.data.chemin, date: r.data.date }));
  const hits = cands.filter((c) => mots.every((m) => norm(c.titre + " " + c.date).includes(m))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  if (!hits.length) return `Aucun PDF trouvé pour « ${q} ». ${cands.length} PDF rangés au total (Foncia, MédinLyon, papiers du Mac).`;
  const out: string[] = [];
  for (const h of hits) {
    const { data } = await admin.storage.from("papiers").createSignedUrl(h.chemin, 3600);
    out.push(`- ${h.titre}${h.date ? " (" + frd(h.date) + ")" : ""} : ${data?.signedUrl ?? "lien indisponible"}`);
  }
  return "PDF trouvés (liens valables 1 heure) :\n" + out.join("\n");
}
async function robot(body: Record<string, unknown>) {
  const r = await fetch(URL_SB + "/functions/v1/medinlyon", { method: "POST", headers: { Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return await r.json().catch(() => ({ ok: false, message: "Le robot MédinLyon ne répond pas." }));
}
const CENTRES: Record<string, string> = { villeurbanne: "1", brotteaux: "2", "lyon 6": "2", lyon: "2", "1": "1", "2": "2" };
const centreId = (c?: string) => { const k = (c ?? "").toLowerCase(); return Object.entries(CENTRES).find(([n]) => k.includes(n))?.[1] ?? null; };
const dateDe = (d?: string) => !d || /aujourd/i.test(d) ? today() : /demain/i.test(d) ? today(1) : /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today();

// ---------- les outils proposés à Claude ----------
const TOOLS = [
  { name: "jarvis_resume", title: "Résumé de ma vie (Jarvis)", description: "Vue d'ensemble à jour de la vie de l'utilisateur : logement et loyer (Foncia), gaz et électricité (Plenitude), santé et rendez-vous médicaux de la famille (MédinLyon), travail et paies, impôts, voiture, papiers, banque, bébé, abonnements. À appeler en premier pour toute question sur sa situation, son argent, ses papiers ou ses rendez-vous.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "jarvis_lieu", title: "Détail d'un domaine (Jarvis)", description: "Détail complet d'un domaine de Jarvis, avec l'historique et la liste des papiers rangés.", inputSchema: { type: "object", properties: { lieu: { type: "string", enum: Object.keys(LIEUX), description: "Le domaine à détailler." } }, required: ["lieu"] }, annotations: { readOnlyHint: true } },
  { name: "jarvis_pdf", title: "Retrouver un PDF (Jarvis)", description: "Cherche un PDF rangé dans Jarvis (quittances, avis d'échéance, régularisations Foncia, justificatifs MédinLyon, avis d'impôt, contrôle technique, assurance auto…) et donne un lien pour l'ouvrir. Exemple de recherche : « quittance octobre 2026 ».", inputSchema: { type: "object", properties: { recherche: { type: "string" } }, required: ["recherche"] }, annotations: { readOnlyHint: true } },
  { name: "medinlyon_creneaux", title: "Créneaux libres MédinLyon", description: "Créneaux de consultation libres chez MédinLyon (centres Villeurbanne et Lyon 6 Brotteaux), seulement aujourd'hui ou demain. Les créneaux marqués supplément (soir, week-end) coûtent environ 23 € de dépassement : le dire à l'utilisateur.", inputSchema: { type: "object", properties: { centre: { type: "string", description: "« Villeurbanne » ou « Brotteaux »" }, date: { type: "string", description: "« aujourd'hui », « demain » ou AAAA-MM-JJ" } }, required: ["centre"] }, annotations: { readOnlyHint: true } },
  { name: "medinlyon_reserver", title: "Réserver un rendez-vous MédinLyon", description: "Réserve un rendez-vous MédinLyon pour une personne de la famille. Avant d'appeler cet outil, récapitule à l'utilisateur pour qui, où, quand et le tarif, et attends son « oui » explicite ; alors seulement mets confirme à true.", inputSchema: { type: "object", properties: { pour: { type: "string", description: "Nom ou prénom de la personne (famille sur le compte)" }, centre: { type: "string" }, date: { type: "string", description: "« aujourd'hui », « demain » ou AAAA-MM-JJ" }, heure: { type: "string", description: "HH:MM, un créneau libre" }, confirme: { type: "boolean", description: "true seulement après le oui explicite de l'utilisateur" } }, required: ["pour", "centre", "date", "heure", "confirme"] }, annotations: { destructiveHint: false, readOnlyHint: false } },
  { name: "medinlyon_annuler", title: "Annuler un rendez-vous MédinLyon", description: "Annule un rendez-vous MédinLyon à venir (numéro donné par jarvis_resume). Avant d'appeler, rappelle le rendez-vous à l'utilisateur et attends son « oui » explicite ; alors seulement mets confirme à true.", inputSchema: { type: "object", properties: { numero: { type: "string" }, confirme: { type: "boolean" } }, required: ["numero", "confirme"] }, annotations: { destructiveHint: true, readOnlyHint: false } },
  { name: "medinlyon_mettre_a_jour", title: "Relire MédinLyon", description: "Relit le compte MédinLyon (rendez-vous, justificatifs PDF, famille, créneaux) et met Jarvis à jour.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: false, destructiveHint: false } },
];

async function appel(nom: string, a: Record<string, any>): Promise<string> {
  switch (nom) {
    case "jarvis_resume": return await resume();
    case "jarvis_lieu": { if (!LIEUX[a.lieu]) return "Domaine inconnu. Choix : " + Object.keys(LIEUX).join(", "); const rows = await lignes(); return `${LIEUX[a.lieu].nom}\n${lieu(rows, a.lieu, true)}`; }
    case "jarvis_pdf": return await documents(String(a.recherche ?? ""));
    case "medinlyon_creneaux": {
      const c = centreId(a.centre); if (!c) return "Centre inconnu : Villeurbanne ou Brotteaux.";
      const d = dateDe(a.date); if (d !== today() && d !== today(1)) return "MédinLyon ne propose que le jour même et le lendemain.";
      const r = await robot({ action: "creneaux", centre: c, date: d });
      if (!r.ok) return r.message ?? "Créneaux indisponibles.";
      if (!r.creneaux.length) return `Aucun créneau libre à ${c === "1" ? "Villeurbanne" : "Lyon 6 Brotteaux"} ${jour(d)}.`;
      return `Créneaux libres à ${c === "1" ? "Villeurbanne" : "Lyon 6 Brotteaux"}, ${jour(d)} : ` + r.creneaux.map((x: any) => x.heure + (x.supplement ? " (+≈23 €)" : "")).join(", ") + ".";
    }
    case "medinlyon_reserver": {
      if (a.confirme !== true) return "Pas réservé : demande d'abord à l'utilisateur de confirmer (pour qui, où, quand, tarif), puis rappelle l'outil avec confirme à true.";
      const rows = await lignes(); const fam = rows.find((r) => r.source === "medinlyon" && r.kind === "patients")?.data?.liste ?? [];
      const q = String(a.pour ?? "").toLowerCase(); const p = fam.filter((x: any) => x.nom.toLowerCase().includes(q) || q.includes(x.nom.toLowerCase().split(" ")[0]));
      if (p.length !== 1) return p.length ? "Plusieurs personnes correspondent : " + p.map((x: any) => x.nom).join(", ") + ". Précise." : "Personne introuvable. Famille : " + fam.map((x: any) => x.nom).join(", ");
      const c = centreId(a.centre); if (!c) return "Centre inconnu : Villeurbanne ou Brotteaux.";
      const d = dateDe(a.date);
      const libres = await robot({ action: "creneaux", centre: c, date: d });
      const h = String(a.heure ?? "").replace(/h/i, ":").padStart(5, "0");
      const cr = (libres.creneaux ?? []).find((x: any) => x.heure === h);
      if (!cr) return `Le créneau de ${h} n'est plus libre. Libres : ` + (libres.creneaux ?? []).map((x: any) => x.heure).join(", ");
      const r = await robot({ action: "reserver", patient: p[0].id, centre: c, date: d, creneau: cr.id });
      if (!r.ok) return "Pas réservé : " + (r.message ?? "");
      return `Réservé : ${p[0].nom}, ${jour(d)} à ${h.replace(":", "h")}, centre ${c === "1" ? "Villeurbanne" : "Lyon 6 Brotteaux"}.` + (r.rdv?.chemin ? " Le justificatif PDF est rangé dans Jarvis." : "");
    }
    case "medinlyon_annuler": {
      if (a.confirme !== true) return "Pas annulé : demande d'abord confirmation à l'utilisateur, puis rappelle l'outil avec confirme à true.";
      const r = await robot({ action: "annuler", id: String(a.numero ?? "") });
      return (r.ok ? "" : "Pas annulé : ") + (r.message ?? "");
    }
    case "medinlyon_mettre_a_jour": { const r = await robot({ action: "sync" }); return r.ok ? `MédinLyon relu : ${r.a_venir} rendez-vous à venir, ${r.rdv} au total, ${r.pdf} justificatifs PDF.` : (r.message ?? "Échec."); }
  }
  throw new Error("outil inconnu");
}

// ---------- le protocole MCP (HTTP « streamable », réponses JSON) ----------
async function traiter(m: any) {
  const { id, method, params } = m ?? {};
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  const ko = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (id === undefined || id === null) return null; // notification
  switch (method) {
    case "initialize": {
      const v = VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : VERSIONS[0];
      return ok({ protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "jarvis", title: "Jarvis", version: "1.0.0" },
        instructions: "Jarvis est l'assistant personnel de l'utilisateur. Appelle jarvis_resume pour connaître sa situation (loyer, énergie, santé, impôts, papiers…). Réponds en français simple. Ne réserve et n'annule jamais sans son oui explicite. Pour l'argent, conseille seulement." });
    }
    case "ping": return ok({});
    case "tools/list": return ok({ tools: TOOLS });
    case "tools/call": {
      try { const t = await appel(params?.name, params?.arguments ?? {}); return ok({ content: [{ type: "text", text: t }] }); }
      catch (e) { return ok({ content: [{ type: "text", text: "Erreur Jarvis : " + String((e as Error).message ?? e).slice(0, 200) }], isError: true }); }
    }
    case "resources/list": return ok({ resources: [] });
    case "prompts/list": return ok({ prompts: [] });
    default: return ko(-32601, "Méthode inconnue : " + method);
  }
}

Deno.serve(async (req) => {
  if (req.method === "GET" || req.method === "DELETE") return new Response("Méthode non prise en charge", { status: 405, headers: { Allow: "POST" } });
  if (req.method !== "POST") return new Response(null, { status: 405 });
  if (!(await autorise(req))) return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Clé du connecteur Jarvis absente ou fausse." } }, 401, { "WWW-Authenticate": 'Bearer realm="jarvis"' });
  let body: any; try { body = await req.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON invalide" } }, 400); }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(traiter))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const r = await traiter(body);
  return r ? json(r) : new Response(null, { status: 202 });
});
