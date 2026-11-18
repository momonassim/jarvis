// Jarvis — connecteur pour Claude (serveur MCP distant).
// Ajouté dans Claude (iPhone, Mac, web) comme « connecteur personnalisé », il donne à Claude
// — et à son mode vocal — l'accès à Jarvis : loyer, énergie, santé, impôts, papiers, rendez-vous.
// Protégé par une clé que le propriétaire crée dans les Réglages de Jarvis (seule son empreinte est gardée).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { rangerPapier, poserAlerte, alertesOuvertes, alerteVue, LIEU_APP } from "./mails.ts";
import { chercher, noter, notesDe } from "./notes.ts";
import { mailsChercher, mailLire, memoire, mailsSynchroniser, comptesOutlook } from "./outlook.ts";

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
async function egal(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function autorise(req: Request) {
  // Claude : clé dans l'en-tête (« Bearer jv_… », « jv_… »…).
  // ChatGPT ne sait pas envoyer d'en-tête : sa clé à lui est dans l'adresse (?cle=jv_…).
  // Deux clés séparées : on peut couper ChatGPT sans toucher à Claude.
  const enTete = ((req.headers.get("Authorization") ?? "").match(/jv_[A-Za-z0-9_-]{20,}/) ?? [""])[0];
  const dansLien = ((new URL(req.url).searchParams.get("cle") ?? "").match(/^jv_[A-Za-z0-9_-]{20,}$/) ?? [""])[0];
  const essais: [string, string][] = [];
  if (enTete) essais.push([enTete, "MCP_TOKEN_HASH"]);
  if (dansLien) essais.push([dansLien, "MCP_TOKEN_HASH_CHATGPT"]);
  for (const [tok, nom] of essais) {
    const data = await empreinte(nom);
    if (data && await egal(await sha256(tok), data)) return true;
  }
  return false;
}
// Les empreintes des clés restent 5 minutes en mémoire : pas de lecture du coffre à chaque question
const EMPREINTES: Record<string, { v: string; t: number }> = {};
async function empreinte(nom: string) {
  const c = EMPREINTES[nom]; if (c && Date.now() - c.t < 300_000) return c.v;
  const { data } = await admin.rpc("jarvis_get_secret", { p_name: nom });
  const v = typeof data === "string" ? data : ""; EMPREINTES[nom] = { v, t: Date.now() }; return v;
}

// ---------- les données ----------
type Row = { source: string; kind: string; label: string; date: string | null; amount: number | null; data: any; updated_at: string };
// Les données restent 60 secondes en mémoire : plusieurs questions d'affilée répondent tout de suite
let CACHE: { rows: Row[]; t: number } | null = null;
const oublier = () => { CACHE = null; };
async function lignes(): Promise<Row[]> {
  if (CACHE && Date.now() - CACHE.t < 60_000) return CACHE.rows;
  const [r1, r2, r3] = await Promise.all([
    admin.from("jarvis_items").select("source,kind,label,date,amount,data,updated_at").not("kind", "in", "(debug,reperage,page,api,document)").limit(5000),
    // Orange : seulement les blocs de données utiles (offre, options, factures, conso)
    admin.from("jarvis_items").select("source,kind,label,date,amount,data,updated_at").eq("source", "orange").eq("kind", "api")
      .or("label.ilike.*offer/contracts/*/details*,label.ilike.*installedOptions*,label.ilike.*billsAndPaymentInfos*,label.ilike.*suiviconso/contracts/conso*,label.ilike.*portfoliomanager/portfolio*"),
    // les PDF de Foncia (seuls « document » utiles ici)
    admin.from("jarvis_items").select("source,kind,label,date,amount,data,updated_at").eq("source", "foncia").eq("kind", "document"),
  ]);
  if (r1.error) throw new Error(r1.error.message);
  const rows = [...(r1.data ?? []), ...(r2.data ?? []), ...(r3.data ?? [])] as Row[];
  CACHE = { rows, t: Date.now() }; return rows;
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
  abonnements: { mac: "orange", nom: "Abonnements (Orange : box, mobile, TV)" },
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
  const n = notesDe(rows, LIEU_APP[id]); let base = lieu0(rows, id, detail);
  if (n.length) base = (base === "Rien pour ce lieu pour l'instant." ? "" : base + "\n") + "Notes rangées : " + n.join(" ; ") + ".";
  const m = mailsDe(rows, LIEU_APP[id], detail ? 15 : 4);
  if (m.length) base = (base === "Rien pour ce lieu pour l'instant." ? "" : base + "\n") + "Retenu des mails Outlook :\n" + m.join("\n");
  return base;
}
function mailsDe(rows: Row[], app: string, n: number) {
  return rows.filter((r) => r.source === "outlook" && r.kind === "info" && r.data?.lieu === app).sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? ""))).slice(0, n)
    .map((r) => `- mail du ${frd(r.date)} (de ${r.data.de ?? "?"}) : ${r.data.titre} — ${r.data.texte}${r.data.action ? " À faire : " + r.data.action : ""} [mail n° ${r.data.mail_id}]`);
}
function lieu0(rows: Row[], id: string, detail: boolean) {
  if (id === "logement") return logement(rows, detail);
  if (id === "energie") return energie(rows, detail);
  if (id === "sante") return sante(rows, detail);
  if (id === "travail") return travail(rows, detail);
  if (id === "abonnements") return abonnements(rows, detail);
  const l = LIEUX[id]; return (l?.mac && mac(rows, l.mac, detail)) || "Rien pour ce lieu pour l'instant.";
}

// ---------- abonnements : Orange (robot Scriptable) ----------
function abonnements(rows: Row[], detail: boolean) {
  const o = rows.filter((r) => r.source === "orange");
  const api = o.filter((x) => x.kind === "api");
  const J = (re: RegExp) => { const r = api.find((x) => re.test(x.label)); try { return r ? JSON.parse(r.data.json) : null; } catch { return null; } };
  // tous les contrats (box + mobile, 2e box…)
  const cids = new Set<string>();
  o.forEach((r) => { if (r.kind === "facture" && r.data?.contrat) cids.add(String(r.data.contrat)); const m = r.kind === "api" && r.label.match(/offer\/contracts\/(\d+)\/details/); if (m) cids.add(m[1]); });
  const lieux: Record<string, string> = {};
  try { const pf = J(/portfoliomanager\/portfolio/); for (const c of pf?.contracts ?? []) { const v = String(c.contractInstallationArea?.city ?? ""); lieux[c.cid] = v.charAt(0) + v.slice(1).toLowerCase(); } } catch { /* rien */ }
  const parts: string[] = []; let total = 0;
  for (const cid of cids) {
    const offre = J(new RegExp(`offer/contracts/${cid}/details`)), opts = J(new RegExp(`contracts/${cid}/installedOptions`)) ?? [];
    const bp = J(new RegExp(`billsAndPaymentInfos/users/current/contracts/${cid}`)), conso = J(new RegExp(`suiviconso/contracts/conso/${cid}`));
    const fac = o.filter((r) => r.kind === "facture" && r.date && String(r.data?.contrat) === cid).sort((a, b) => b.date!.localeCompare(a.date!));
    const nom = offre?.name ?? "Contrat " + cid;
    let t = `Orange — ${nom}${lieux[cid] ? " (" + lieux[cid] + ")" : ""}`;
    if (offre?.totalPriceAmount) { t += ` : ${eur(offre.totalPriceAmount / 100)} par mois${offre.engagementLabel ? " (" + offre.engagementLabel + ")" : ""}.`; total += offre.totalPriceAmount / 100; } else t += ".";
    if (fac[0]) t += ` Dernière facture : ${eur(fac[0].amount)} le ${frd(fac[0].date)}${bp?.lastBill?.debitDate ? ", prélevée le " + frd(bp.lastBill.debitDate) : ""}. ${fac.length} factures rangées en PDF (depuis ${frd(fac[fac.length - 1].date)}).`;
    const impayees = fac.filter((r) => Number(r.data?.reste) > 0);
    if (impayees.length) t += ` Reste à payer indiqué : ${impayees.map((r) => `${eur(Number(r.data.reste))} (facture du ${frd(r.date)})`).join(", ")}.`;
    const hf = conso?.equipments?.[0]?.synthesis; if (hf?.displayHF) t += ` Hors forfait en cours : ${hf.mainText}.`;
    if (opts.length) t += " Options : " + opts.map((x: any) => x.name + (x.infos?.length ? ` (${x.infos[0]})` : "")).join(", ") + ".";
    if (detail && bp?.lastBill?.aggregationLevel2) t += "\nDétail de la dernière facture : " + bp.lastBill.aggregationLevel2.map((g: any) => `${g.title} ${eur(g.includingTaxesAmount / 100)}`).join(" ; ") + ".";
    if (detail && fac.length) t += "\nDernières factures :\n" + fac.slice(0, 6).map((r) => `- ${frd(r.date)} : ${eur(r.amount)}`).join("\n");
    parts.push(t);
  }
  let t = (cids.size > 1 ? `${cids.size} contrats Orange${total ? ", " + eur(total) + " par mois au total" : ""}.\n` : "") + parts.join("\n");
  const ma = mac(rows, "orange", detail); if (ma) t += (t ? "\n" : "") + ma;
  return t || "Rien pour ce lieu pour l'instant.";
}

// ---------- le travail : planning 5x8 envoyé par Mon Planning ----------
const POSTE: Record<string, string> = { M: "matin (4h-12h)", A: "après-midi (12h-20h)", N: "nuit (20h-4h)", R: "repos", J: "poste à fixer par le chef (jour travaillé de la remonte)" };
function planning(rows: Row[]) { return rows.find((r) => r.source === "planning" && r.kind === "etat")?.data ?? null; }
function dit(o: any) {
  if (!o) return "inconnu";
  const f = o.ferie ? ` (férié : ${o.ferie})` : "";
  if (o.g === "conge") return "congé payé" + f;
  if (o.g === "rc") return "récup" + f;
  if (o.g === "maladie") return "maladie" + f;
  if (o.sup) return `jour sup (heures sup), ${POSTE[o.poste] ?? o.poste}` + f;
  if (o.poste === "R") return (o.rem ? "repos (remonte)" : "repos") + f;
  return (POSTE[o.poste] ?? o.poste) + f;
}
function travail(rows: Row[], detail: boolean) {
  const P = planning(rows); let t = "";
  if (P?.jours?.length) {
    const J: Record<string, any> = Object.fromEntries(P.jours.map((o: any) => [o.d, o]));
    const td = today(), de = today(1);
    t += `Aujourd'hui : ${dit(J[td])}. Demain : ${dit(J[de])}.`;
    const fut = P.jours.filter((o: any) => o.d > td);
    const enRem = J[td]?.rem;
    if (enRem) { const fin = fut.find((o: any) => !o.rem && o.poste !== "R" && !["conge", "rc", "maladie"].includes(o.g)); if (fin) t += ` En remonte, reprise le ${jour(fin.d)} (${dit(fin)}).`; }
    else { const rem = fut.find((o: any) => o.rem); if (rem) t += ` Prochaine remonte à partir du ${jour(rem.d)}.`; }
    const sup = fut.filter((o: any) => o.sup).slice(0, 5); if (sup.length) t += ` Jours sup prévus : ${sup.map((o: any) => frd(o.d)).join(", ")}.`;
    const mois = td.slice(0, 7), pm = (P.payes ?? []).find((x: any) => x.mois === mois), pn = (P.payes ?? []).find((x: any) => x.mois > mois);
    if (P.base_ok && pm) t += ` Paye estimée fin ${MOIS[+mois.slice(5) - 1]} : ${eur(pm.net)} net (travail de ${MOIS[+pm.travail.slice(5) - 1]})` + (pn ? `, puis ${eur(pn.net)} fin ${MOIS[+pn.mois.slice(5) - 1]}` : "") + ".";
    const c = P.compteurs ?? {}; t += ` Compteurs : ${c.cp ?? "?"} CP restants, ${c.cor ?? "?"} COR (estimation pour janvier : ${c.cor_estimes_janvier ?? "?"}).`;
    t += ` (Mon Planning, envoyé le ${new Date(P.maj).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })}.)`;
    if (detail) t += "\nLes 14 prochains jours :\n" + fut.slice(0, 14).map((o: any) => `- ${jour(o.d)} : ${dit(o)}`).join("\n");
  } else t += "Planning pas encore relié (dans Mon Planning, Profil › Relier à Jarvis).";
  const ma = mac(rows, "usine", detail); if (ma) t += "\n" + ma;
  return t;
}
function postes(rows: Row[], a: Record<string, any>) {
  const P = planning(rows); if (!P?.jours?.length) return "Le planning n'est pas encore relié : dans Mon Planning, Profil › Relier à Jarvis.";
  const d1 = dateDe(a.date), d2 = a.jusqu_au ? dateDe(a.jusqu_au) : d1;
  const liste = P.jours.filter((o: any) => o.d >= d1 && o.d <= d2).slice(0, 62);
  if (!liste.length) return `Pas de planning pour cette période (connu du ${frd(P.jours[0].d)} au ${frd(P.jours[P.jours.length - 1].d)}).`;
  return liste.map((o: any) => `- ${jour(o.d)} : ${dit(o)}`).join("\n");
}
async function resume() {
  const [rows, al] = await Promise.all([lignes(), alertesOuvertes(admin)]);
  const prof = rows.find((r) => r.source === "jarvis" && r.kind === "profil")?.data?.texte ?? "";
  const now = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" });
  const alertes = al.length ? "## Alertes en cours (lieux en rouge dans l'app)\n" + al.map((x: any) => `- n° ${x.id} · ${x.data.lieu} · ${x.data.titre}${x.data.date_mail ? " (mail du " + frd(x.data.date_mail) + ")" : ""}${x.data.texte ? " : " + x.data.texte : ""}`).join("\n") + "\n\n" : "";
  const comptes = await comptesOutlook(admin).catch(() => []);
  const boites = comptes.length ? `## Mails Outlook\nBoîtes branchées (lecture seule) : ${comptes.map((c: any) => `${c.compte} (${c.statut}${c.derniere_sync ? ", relue le " + new Date(c.derniere_sync).toLocaleString("fr-FR", { timeZone: "Europe/Paris" }) : ""})`).join(", ")}. Pour une question sur un mail : jarvis_mails_chercher, jarvis_mail_lire, jarvis_memoire.\n\n` : "";
  return `Jarvis — situation au ${now}.\n${prof}\n\n` + alertes + boites + Object.entries(LIEUX).map(([id, l]) => `## ${l.nom}\n${lieu(rows, id, false)}`).join("\n\n");
}
async function documents(q: string, ecranAussi = false) {
  const rows = await lignes(); const mots = q.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/).filter(Boolean);
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const cands: { titre: string; chemin: string; date: string; lieu?: string }[] = [];
  rows.filter((r) => r.source === "foncia" && r.kind === "document" && r.data?.path).forEach((r) => cands.push({ titre: "Foncia · " + r.label.replace(/\.pdf$/i, ""), chemin: "foncia/" + r.data.path, date: r.date ?? "", lieu: "logement" }));
  rows.filter((r) => r.source === "mac" && r.kind === "lieu").forEach((r) => (r.data?.docs ?? []).filter((x: any) => x.path).forEach((x: any) => cands.push({ titre: `${x.t} ${x.d ?? ""}`.trim(), chemin: x.path, date: "", lieu: APP_LIEU[r.label] })));
  rows.filter((r) => r.source === "orange" && r.kind === "facture" && r.data?.path).forEach((r) => cands.push({ titre: `Facture Orange ${r.data.contrat === "9097042479" ? "Livebox Up (Villeurbanne) " : ""}${MOIS[+r.date!.slice(5, 7) - 1]} ${r.date!.slice(0, 4)}`, chemin: r.data.path, date: r.date ?? "", lieu: "abonnements" }));
  rows.filter((r) => r.source === "medinlyon" && r.kind === "rdv" && r.data?.chemin).forEach((r) => cands.push({ titre: `MédinLyon · justificatif ${r.data.patient} du ${frd(r.data.date)}`, chemin: r.data.chemin, date: r.data.date, lieu: "sante" }));
  const hits = cands.filter((c) => mots.every((m) => norm(c.titre + " " + c.date).includes(m))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  if (!hits.length) return `Aucun PDF trouvé pour « ${q} ». ${cands.length} PDF rangés au total (Foncia, MédinLyon, papiers du Mac).`;
  const premier = hits[0];
  const [liens] = await Promise.all([
    Promise.all(hits.map((h) => admin.storage.from("papiers").createSignedUrl(h.chemin, 3600))),
    ecranAussi && premier.lieu ? montre("document", { lieu: premier.lieu, titre: premier.titre, path: premier.chemin }) : null,
  ]);
  const out = hits.map((h, i) => `- ${h.titre}${h.date ? " (" + frd(h.date) + ")" : ""} : ${liens[i]?.data?.signedUrl ?? "lien indisponible"}`);
  return "PDF trouvés (liens valables 1 heure) :\n" + out.join("\n");
}
async function robot(body: Record<string, unknown>) {
  const r = await fetch(URL_SB + "/functions/v1/medinlyon", { method: "POST", headers: { Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return await r.json().catch(() => ({ ok: false, message: "Le robot MédinLyon ne répond pas." }));
}
// ---------- l'écran : Claude pilote l'app Jarvis ouverte (iPhone ou Mac) ----------
let menageEcran = 0;
async function ecran(action: string, args: Record<string, unknown> = {}) {
  if (Date.now() - menageEcran > 3_600_000) { menageEcran = Date.now();
    admin.from("jarvis_ecran").delete().lt("created_at", new Date(Date.now() - 864e5).toISOString()).then(() => {}, () => {}); }
  const { error } = await admin.from("jarvis_ecran").insert({ action, args });
  return !error;
}
// L'écran suit tout seul ce que fait l'assistant : l'ordre part en même temps que le travail de l'outil
const montre = (action: string, args: Record<string, unknown> = {}) => ecran(action, args).catch(() => false);
const SOURCE_LIEU: Record<string, string> = { orange: "abonnements", foncia: "logement", plenitude: "energie", medinlyon: "sante" };
const APP_LIEU = Object.fromEntries(Object.entries(LIEU_APP).map(([k, v]) => [v, k]));
async function montrer(a: Record<string, any>) {
  const act = String(a.action ?? "");
  if (act === "lieu" || act === "document") { if (!LIEUX[a.lieu]) return "Lieu inconnu. Choix : " + Object.keys(LIEUX).join(", "); }
  if (act === "document" && !a.titre) return "Donne le titre du papier à ouvrir.";
  const args: Record<string, unknown> = {};
  for (const k of ["lieu", "titre", "tourner", "zoom", "vue", "mode", "texte"]) if (a[k] !== undefined) args[k] = a[k];
  for (const k of ["pour", "centre", "date", "heure", "etape"]) if (a[k] !== undefined) args[k] = a[k];
  if (!["lieu", "document", "ensemble", "camera", "ciel", "fermer", "message", "rdv"].includes(act)) return "Action inconnue.";
  return (await ecran(act, args)) ? "C'est affiché dans l'app Jarvis (si elle est ouverte sur l'iPhone ou le Mac)." : "Je n'ai pas pu envoyer l'ordre à l'écran.";
}
const CENTRES: Record<string, string> = { villeurbanne: "1", brotteaux: "2", "lyon 6": "2", lyon: "2", "1": "1", "2": "2" };
const centreId = (c?: string) => { const k = (c ?? "").toLowerCase(); return Object.entries(CENTRES).find(([n]) => k.includes(n))?.[1] ?? null; };
const dateDe = (d?: string) => !d || /aujourd/i.test(d) ? today() : /apr[eè]s-demain/i.test(d) ? today(2) : /demain/i.test(d) ? today(1) : /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today();

// ---------- les outils proposés à Claude ----------
const TOOLS = [
  { name: "jarvis_resume", title: "Résumé de ma vie (Jarvis)", description: "Vue d'ensemble à jour de la vie de l'utilisateur : logement et loyer (Foncia), gaz et électricité (Plenitude), santé et rendez-vous médicaux de la famille (MédinLyon), travail et paies, impôts, voiture, papiers, banque, bébé, abonnements. À appeler en premier pour toute question sur sa situation, son argent, ses papiers ou ses rendez-vous.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  { name: "jarvis_lieu", title: "Détail d'un domaine (Jarvis)", description: "Détail complet d'un domaine de Jarvis, avec l'historique et la liste des papiers rangés.", inputSchema: { type: "object", properties: { lieu: { type: "string", enum: Object.keys(LIEUX), description: "Le domaine à détailler." } }, required: ["lieu"] }, annotations: { readOnlyHint: true } },
  { name: "jarvis_pdf", title: "Retrouver un PDF (Jarvis)", description: "Cherche un PDF rangé dans Jarvis (quittances, avis d'échéance, régularisations Foncia, justificatifs MédinLyon, avis d'impôt, contrôle technique, assurance auto…) et donne un lien pour l'ouvrir. Exemple de recherche : « quittance octobre 2026 ».", inputSchema: { type: "object", properties: { recherche: { type: "string" } }, required: ["recherche"] }, annotations: { readOnlyHint: true } },
  { name: "jarvis_planning", title: "Mon planning de travail (5x8)", description: "Postes de travail de l'utilisateur jour par jour (matin 4h-12h, après-midi 12h-20h, nuit 20h-4h, repos, remonte, jours sup, congés), envoyés par son app Mon Planning. À utiliser dès qu'il demande s'il travaille ou s'il est libre à une date, et AVANT de lui proposer un rendez-vous (médecin, démarche) : ne propose que des moments où il ne travaille pas. Une nuit compte pour le jour où elle commence.", inputSchema: { type: "object", properties: { date: { type: "string", description: "« aujourd'hui », « demain », « après-demain » ou AAAA-MM-JJ (début)" }, jusqu_au: { type: "string", description: "Optionnel, AAAA-MM-JJ : fin de la période (62 jours max)" } } }, annotations: { readOnlyHint: true } },
  { name: "jarvis_ecran", title: "Piloter l'écran de Jarvis", description: "Pilote l'app Jarvis ouverte sur l'iPhone ou le Mac de l'utilisateur (une ville 3D où chaque bâtiment est un domaine de sa vie). Utilise-le pour MONTRER ce dont tu parles : aller à un lieu et ouvrir sa fiche (action lieu), ouvrir un papier précis (action document, avec lieu + titre, ex. « avis d'impôt 2026 », « contrôle technique »), revenir à la vue de toute la ville (ensemble), bouger la caméra (camera : tourner en degrés, + vers la droite / - vers la gauche ; zoom « avant » ou « arriere » ; vue « dessus » ou « rasante »), passer en jour ou nuit (ciel : mode « jour » / « nuit »), tout fermer (fermer), afficher une courte phrase à l'écran (message : texte), ou montrer la prise de rendez-vous médical en train de se remplir (rdv : pour, centre, date, heure, etape). L'utilisateur doit VOIR ce que tu fais pendant que tu lui parles : à chaque étape d'une prise de rendez-vous (dès qu'il dit pour qui, puis où, puis quand, puis l'heure choisie avant sa confirmation), appelle jarvis_ecran action rdv avec ce que tu sais déjà. Les autres outils de Jarvis mettent l'écran à jour tout seuls.", inputSchema: { type: "object", properties: { action: { type: "string", enum: ["lieu", "document", "ensemble", "camera", "ciel", "fermer", "message", "rdv"] }, pour: { type: "string", description: "Pour rdv : prénom de la personne" }, centre: { type: "string", description: "Pour rdv : « Villeurbanne » ou « Brotteaux »" }, date: { type: "string", description: "Pour rdv : « aujourd'hui », « demain » ou AAAA-MM-JJ" }, heure: { type: "string", description: "Pour rdv : HH:MM choisi" }, etape: { type: "string", enum: ["qui", "ou", "quand", "confirmer"], description: "Pour rdv : l'étape à montrer" }, lieu: { type: "string", enum: Object.keys(LIEUX) }, titre: { type: "string", description: "Pour document : quelques mots du titre du papier" }, tourner: { type: "number", description: "Pour camera : degrés (ex. 90 ou -45)" }, zoom: { type: "string", enum: ["avant", "arriere"] }, vue: { type: "string", enum: ["dessus", "rasante"] }, mode: { type: "string", enum: ["jour", "nuit"] }, texte: { type: "string", description: "Pour message : une phrase courte" } }, required: ["action"] }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
  { name: "jarvis_ranger_papier", title: "Ranger un papier dans Jarvis", description: "Range dans Jarvis un papier trouvé dans les mails de l'utilisateur (Outlook) : facture, quittance, avis d'échéance, régularisation, amende, avis d'impôt, attestation, contrat, compte rendu médical, convocation… À utiliser quand il demande de retrouver un document dans ses mails (même ancien, ex. « la régularisation Foncia de 2024 ») ou de ranger ses mails importants. Envoie le fichier joint de préférence : pdf_base64 (le PDF encodé en base64) ou pdf_url (lien https direct vers le PDF). Si tu ne peux pas transmettre le fichier, envoie contenu_texte : tout le texte du document (ou du mail), Jarvis en fera un PDF propre. Choisis le lieu le plus logique. Ne range JAMAIS une pièce d'identité, ni un papier qui montre un IBAN ou un n° de sécurité sociale complet (sauf bulletin de paie). Une fois rangé, montre-le avec jarvis_ecran (action document).", inputSchema: { type: "object", properties: { lieu: { type: "string", enum: Object.keys(LIEUX) }, titre: { type: "string", description: "Titre court et clair en français, ex. « Régularisation des charges 2024 », « Facture Orange »" }, sous_titre: { type: "string", description: "Organisme · période ou date · montant, ex. « Foncia · 2024 »" }, de: { type: "string", description: "Expéditeur du mail" }, date_mail: { type: "string", description: "Date du mail, AAAA-MM-JJ" }, resume: { type: "string", description: "Une ou deux phrases : ce que dit le papier, ce qu'il faut faire" }, pdf_base64: { type: "string" }, pdf_url: { type: "string" }, contenu_texte: { type: "string" } }, required: ["lieu", "titre"] }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "jarvis_alerte", title: "Poser une alerte dans Jarvis", description: "Met un lieu de la ville Jarvis en rouge, avec une notification, quand un mail important demande l'attention de l'utilisateur : facture ou amende à payer, échéance proche, rendez-vous ou convocation, courrier de la régie, des impôts, de la CAF, de la santé… Pas pour la pub ni les newsletters. Une alerte par sujet. Utilise-le par exemple quand il demande de faire le point sur ses mails de la semaine.", inputSchema: { type: "object", properties: { lieu: { type: "string", enum: Object.keys(LIEUX) }, titre: { type: "string", description: "Très court, ex. « Amende à payer avant le 30/11 »" }, texte: { type: "string", description: "Ce qu'il faut savoir et faire, en 1 à 3 phrases simples" }, de: { type: "string" }, date_mail: { type: "string", description: "AAAA-MM-JJ" } }, required: ["lieu", "titre", "texte"] }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "jarvis_alerte_vue", title: "Retirer une alerte Jarvis", description: "Retire une alerte (le lieu n'est plus rouge) quand l'utilisateur dit que c'est réglé ou vu. Numéro donné par jarvis_resume.", inputSchema: { type: "object", properties: { numero: { type: "string" } }, required: ["numero"] }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "jarvis_chercher", title: "Chercher dans tout Jarvis", description: "Fouille dans TOUT ce que les robots de Jarvis ont ramené (toutes les pages et données lues chez Orange, Foncia, Plenitude, MédinLyon, papiers du Mac, mails rangés…), pas seulement le résumé. À utiliser dès que l'utilisateur demande un détail précis qui n'est pas dans jarvis_resume ou jarvis_lieu : un code (RIO, PUK…), un numéro de ligne, une option, une date de fin, un détail de facture, une adresse… Donne 1 à 3 mots-clés distinctifs (ex. « RIO », « PUK », « résiliation »). Si tu trouves une info utile à garder, range-la avec jarvis_noter.", inputSchema: { type: "object", properties: { recherche: { type: "string", description: "Mots-clés, tous doivent être présents" } }, required: ["recherche"] }, annotations: { readOnlyHint: true } },
  { name: "jarvis_noter", title: "Ranger une info dans Jarvis", description: "Range une info courte dans un lieu de Jarvis (elle s'affiche dans la fiche du lieu dans l'app, et Jarvis s'en souvient), ex. « Code RIO mobile » → « 01P123456ABC ». Même titre = mise à jour. supprimer à true pour l'enlever. Jamais d'IBAN, de n° de sécu, de mot de passe ou de pièce d'identité.", inputSchema: { type: "object", properties: { lieu: { type: "string", enum: Object.keys(LIEUX) }, titre: { type: "string" }, texte: { type: "string" }, supprimer: { type: "boolean" } }, required: ["lieu", "titre"] }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "jarvis_mails_chercher", title: "Chercher dans mes mails Outlook", description: "Cherche dans les mails Outlook de l'utilisateur (lus par Jarvis en lecture seule) : par mots-clés (expéditeur, objet, contenu), période, expéditeur ou domaine de la vie. Cherche aussi directement dans Outlook, y compris les vieux mails, si peu de résultats (ou dans_outlook à true). Donne les n° des mails pour les lire avec jarvis_mail_lire. À utiliser dès qu'il parle d'un mail, d'un courrier reçu, d'une facture, d'une confirmation, d'un message de quelqu'un.", inputSchema: { type: "object", properties: { recherche: { type: "string", description: "Mots-clés, ex. « Foncia régularisation », « amende », « Enedis coupure »" }, depuis: { type: "string", description: "AAAA-MM-JJ" }, jusqu_au: { type: "string", description: "AAAA-MM-JJ" }, de: { type: "string", description: "Expéditeur (nom ou adresse, partiel)" }, lieu: { type: "string", enum: Object.keys(LIEUX) }, limite: { type: "number" }, dans_outlook: { type: "boolean", description: "true pour chercher aussi directement dans Outlook (mails anciens)" } } }, annotations: { readOnlyHint: true } },
  { name: "jarvis_mail_lire", title: "Lire un mail Outlook", description: "Lit un mail en entier (expéditeur, date, objet, texte, pièces jointes, lien pour l'ouvrir dans Outlook) et ce que Jarvis en a retenu. Numéro donné par jarvis_mails_chercher ou jarvis_memoire, ou référence « outlook:… » d'un vieux mail. Les IBAN et n° de sécu sont masqués.", inputSchema: { type: "object", properties: { numero: { type: "string" } }, required: ["numero"] }, annotations: { readOnlyHint: true } },
  { name: "jarvis_memoire", title: "Mémoire de Jarvis", description: "Ce que Jarvis a retenu et rangé : les infos utiles tirées des mails (chacune avec le n° du mail source), les notes rangées et les alertes (en cours ou vues). Filtrable par mots, domaine et date. À utiliser pour « qu'est-ce que je dois savoir / faire », « qu'est-ce que la régie m'a envoyé », « où en est … ».", inputSchema: { type: "object", properties: { recherche: { type: "string" }, lieu: { type: "string", enum: Object.keys(LIEUX) }, depuis: { type: "string", description: "AAAA-MM-JJ" }, limite: { type: "number" } } }, annotations: { readOnlyHint: true } },
  { name: "jarvis_mails_synchroniser", title: "Relire mes mails maintenant", description: "Relit tout de suite les boîtes Outlook branchées (sinon c'est fait toutes les 15 minutes) : nouveaux mails, tri, rangement dans la ville. Lecture seule : rien n'est envoyé ni modifié dans Outlook.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
  { name: "medinlyon_creneaux", title: "Créneaux libres MédinLyon", description: "Créneaux de consultation libres chez MédinLyon (centres Villeurbanne et Lyon 6 Brotteaux), seulement aujourd'hui ou demain. Les créneaux marqués supplément (soir, week-end) coûtent environ 23 € de dépassement : le dire à l'utilisateur.", inputSchema: { type: "object", properties: { pour: { type: "string", description: "Prénom de la personne, s'il est connu (pour l'afficher à l'écran)" }, centre: { type: "string", description: "« Villeurbanne » ou « Brotteaux »" }, date: { type: "string", description: "« aujourd'hui », « demain » ou AAAA-MM-JJ" } }, required: ["centre"] }, annotations: { readOnlyHint: true } },
  { name: "medinlyon_reserver", title: "Réserver un rendez-vous MédinLyon", description: "Réserve un rendez-vous MédinLyon pour une personne de la famille. Avant d'appeler cet outil, récapitule à l'utilisateur pour qui, où, quand et le tarif, et attends son « oui » explicite ; alors seulement mets confirme à true.", inputSchema: { type: "object", properties: { pour: { type: "string", description: "Nom ou prénom de la personne (famille sur le compte)" }, centre: { type: "string" }, date: { type: "string", description: "« aujourd'hui », « demain » ou AAAA-MM-JJ" }, heure: { type: "string", description: "HH:MM, un créneau libre" }, confirme: { type: "boolean", description: "true seulement après le oui explicite de l'utilisateur" } }, required: ["pour", "centre", "date", "heure", "confirme"] }, annotations: { destructiveHint: false, readOnlyHint: false } },
  { name: "medinlyon_annuler", title: "Annuler un rendez-vous MédinLyon", description: "Annule un rendez-vous MédinLyon à venir (numéro donné par jarvis_resume). Avant d'appeler, rappelle le rendez-vous à l'utilisateur et attends son « oui » explicite ; alors seulement mets confirme à true.", inputSchema: { type: "object", properties: { numero: { type: "string" }, confirme: { type: "boolean" } }, required: ["numero", "confirme"] }, annotations: { destructiveHint: true, readOnlyHint: false } },
  { name: "medinlyon_mettre_a_jour", title: "Relire MédinLyon", description: "Relit le compte MédinLyon (rendez-vous, justificatifs PDF, famille, créneaux) et met Jarvis à jour.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: false, destructiveHint: false } },
];

async function appel(nom: string, a: Record<string, any>): Promise<string> {
  switch (nom) {
    case "jarvis_resume": { const [t] = await Promise.all([resume(), montre("ensemble")]); return t; }
    case "jarvis_lieu": { if (!LIEUX[a.lieu]) return "Domaine inconnu. Choix : " + Object.keys(LIEUX).join(", "); const [rows] = await Promise.all([lignes(), ecran("lieu", { lieu: a.lieu }).catch(() => false)]); return `${LIEUX[a.lieu].nom} (affiché aussi dans l'app Jarvis)\n${lieu(rows, a.lieu, true)}`; }
    case "jarvis_ecran": return await montrer(a);
    case "jarvis_planning": { const [rows] = await Promise.all([lignes(), montre("lieu", { lieu: "travail" })]); return postes(rows, a); }
    case "jarvis_pdf": return await documents(String(a.recherche ?? ""), true);
    case "jarvis_ranger_papier": { oublier(); const r = await rangerPapier(admin, a, Object.keys(LIEUX)); if (LIEUX[a.lieu]) await montre("document", { lieu: a.lieu, titre: String(a.titre ?? "") }); return r; }
    case "jarvis_alerte": { oublier(); const [r] = await Promise.all([poserAlerte(admin, a, Object.keys(LIEUX)), LIEUX[a.lieu] ? montre("lieu", { lieu: a.lieu }) : null]); return r; }
    case "jarvis_alerte_vue": oublier(); return await alerteVue(admin, a.numero);
    case "jarvis_chercher": {
      const [r] = await Promise.all([chercher(admin, a), montre("recherche", { texte: "Je cherche « " + String(a.recherche ?? "") + " »" })]);
      // on emmène l'écran là où se trouve la première trouvaille
      const m = r.match(/\n- \[([a-z]+) · ([a-z]+) · ([^\]·]+)/); const src = m?.[1], kind = m?.[2], label = (m?.[3] ?? "").trim();
      const lieu = src && (SOURCE_LIEU[src] ?? (src === "mac" && kind === "lieu" ? APP_LIEU[label] : undefined));
      if (lieu) await montre("lieu", { lieu });
      return r;
    }
    case "jarvis_mails_chercher": { const [r] = await Promise.all([mailsChercher(admin, a), montre("recherche", { texte: "Je cherche dans tes mails" + (a.recherche ? " : « " + String(a.recherche) + " »" : ""), lieu: LIEUX[a.lieu] ? a.lieu : undefined })]); return r; }
    case "jarvis_mail_lire": { const [r] = await Promise.all([mailLire(admin, a), montre("message", { texte: "📩 Je lis le mail n° " + String(a.numero ?? a.id ?? "") })]); return r; }
    case "jarvis_memoire": { const [r] = await Promise.all([memoire(admin, a), LIEUX[a.lieu] ? montre("lieu", { lieu: a.lieu }) : montre("message", { texte: "Je regarde ce que j'ai retenu de tes mails" })]); return r; }
    case "jarvis_mails_synchroniser": oublier(); return await mailsSynchroniser(admin);
    case "jarvis_noter": { oublier(); const r = await noter(admin, a, Object.keys(LIEUX)); if (r.startsWith("Rangé")) await ecran("lieu", { lieu: a.lieu }).catch(() => false); return r; }
    case "medinlyon_creneaux": {
      const c = centreId(a.centre); if (!c) return "Centre inconnu : Villeurbanne ou Brotteaux.";
      const d = dateDe(a.date); if (d !== today() && d !== today(1)) return "MédinLyon ne propose que le jour même et le lendemain.";
      const [r] = await Promise.all([robot({ action: "creneaux", centre: c, date: d }), montre("rdv", { pour: a.pour, centre: c, date: d, etape: "quand" })]);
      if (!r.ok) return r.message ?? "Créneaux indisponibles.";
      await montre("rdv", { pour: a.pour, centre: c, date: d, etape: "creneaux", creneaux: r.creneaux });
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
      if (!cr) { await montre("rdv", { pour: p[0].nom, centre: c, date: d, etape: "creneaux", creneaux: libres.creneaux ?? [] }); return `Le créneau de ${h} n'est plus libre. Libres : ` + (libres.creneaux ?? []).map((x: any) => x.heure).join(", "); }
      await montre("rdv", { pour: p[0].nom, centre: c, date: d, heure: h, supplement: !!cr.supplement, etape: "reservation" });
      const r = await robot({ action: "reserver", patient: p[0].id, centre: c, date: d, creneau: cr.id });
      await montre("rdv", { pour: p[0].nom, centre: c, date: d, heure: h, etape: "fait", resultat: { ok: !!r.ok, message: r.message ?? "", rdv: r.rdv?.chemin ? { chemin: r.rdv.chemin } : null } });
      if (!r.ok) return "Pas réservé : " + (r.message ?? "");
      return `Réservé : ${p[0].nom}, ${jour(d)} à ${h.replace(":", "h")}, centre ${c === "1" ? "Villeurbanne" : "Lyon 6 Brotteaux"}.` + (r.rdv?.chemin ? " Le justificatif PDF est rangé dans Jarvis." : "");
    }
    case "medinlyon_annuler": {
      if (a.confirme !== true) return "Pas annulé : demande d'abord confirmation à l'utilisateur, puis rappelle l'outil avec confirme à true.";
      const [r] = await Promise.all([robot({ action: "annuler", id: String(a.numero ?? "") }), montre("lieu", { lieu: "sante" })]);
      return (r.ok ? "" : "Pas annulé : ") + (r.message ?? "");
    }
    case "medinlyon_mettre_a_jour": { const [r] = await Promise.all([robot({ action: "sync" }), montre("lieu", { lieu: "sante" })]); return r.ok ? `MédinLyon relu : ${r.a_venir} rendez-vous à venir, ${r.rdv} au total, ${r.pdf} justificatifs PDF.` : (r.message ?? "Échec."); }
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
        instructions: "Jarvis est l'assistant personnel de l'utilisateur. Appelle jarvis_resume pour connaître sa situation (loyer, énergie, santé, impôts, papiers…). L'utilisateur a souvent l'app Jarvis ouverte et doit VOIR ce que tu fais pendant que tu lui parles : les outils de Jarvis mettent l'écran à jour tout seuls, et avec jarvis_ecran tu montres le reste (un lieu, un papier, et pendant une prise de rendez-vous l'action rdv à chaque étape : pour qui, où, quand, l'heure). Pour savoir s'il travaille ou s'il est libre un jour, appelle jarvis_planning (son planning 5x8), et vérifie-le avant de proposer un rendez-vous. Réponds en français simple et COURT (une ou deux phrases, surtout à l'oral) : donne juste l'info demandée, sans tout réciter. Ne réserve et n'annule jamais sans son oui explicite. Pour l'argent, conseille seulement. Pour un détail précis (un code RIO, une option, une date…), fouille avec jarvis_chercher, et range ce qui est utile avec jarvis_noter. Ses mails Outlook sont lus par Jarvis (lecture seule) : pour toute question sur un mail ou un courrier, utilise jarvis_mails_chercher puis jarvis_mail_lire ; pour ce que Jarvis a retenu (avec le mail source), jarvis_memoire. Tu peux ranger un papier joint avec jarvis_ranger_papier et signaler ce qui est important avec jarvis_alerte." });
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

// Les données sont en Irlande (eu-west-1). Un appel qui arrive ailleurs (Claude passe par les États-Unis)
// ferait plusieurs allers-retours transatlantiques : on le relaie une seule fois vers l'Irlande.
const ICI = Deno.env.get("SB_REGION") ?? "";
const REGION_DONNEES = "eu-west-1";
async function relayer(req: Request): Promise<Response | null> {
  if (!ICI || ICI === REGION_DONNEES || req.headers.get("x-jv-relais") || req.method !== "POST") return null;
  try {
    const h = new Headers(req.headers); h.set("x-region", REGION_DONNEES); h.set("x-jv-relais", "1"); h.delete("host"); h.delete("content-length");
    const cible = URL_SB + "/functions/v1/jarvis-mcp" + new URL(req.url).search;
    const r = await fetch(cible, { method: "POST", headers: h, body: await req.clone().arrayBuffer(), signal: AbortSignal.timeout(20000) });
    if (r.status >= 500) return null;
    const rh = new Headers(r.headers); rh.delete("content-encoding"); rh.delete("content-length"); rh.delete("transfer-encoding");
    return new Response(r.body, { status: r.status, headers: rh });
  } catch { return null; } // relais en panne : on répond quand même d'ici
}

Deno.serve(async (req) => {
  const relais = await relayer(req); if (relais) return relais;
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
