// Jarvis — le travail : planning 5x8, remonte, jours sup, paye et compteurs.
// Tout est calculé par le moteur repris de l'app Mac « Mon Planning » (moteur-travail.ts),
// à partir de ce qui est rangé dans Supabase (jarvis_items, source « travail ») :
//   saisies  = les jours changés à la main (remonte, heures sup, congés…)
//   myhorsys = ce que MyHorsys a donné (postes planifiés, absences, anomalies, compteurs)
//   regles   = les règles et montants de la paye (jamais dans ce code public)
// Règle de l'utilisateur : rien de chiffré n'est affiché ni dit de soi-même. Les montants et
// compteurs ne sortent que par jarvis_paye et jarvis_compteurs, quand il les demande.
import { Planning, paye, gainJour, congesRestants, estimationCOR, ancienneteAns, prochainRC8, ferie, plus, mois, annee, js, jourParis, debutMois, estAbsence, type Poste, type Genre } from "./moteur-travail.ts";

type Row = { source: string; kind: string; label: string; data: any; updated_at: string };
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const today = (n = 0) => new Date(Date.now() + n * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const jour = (d: string) => `${JOURS[js(d)]} ${+d.slice(8, 10)} ${MOIS[mois(d) - 1]}${annee(d) !== annee(today()) ? " " + annee(d) : ""}`;
const eur = (n: number) => Math.round(n).toLocaleString("fr-FR") + " €";
const eur2 = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const nb = (n: number) => (Math.round(n * 100) / 100).toLocaleString("fr-FR");

const POSTE: Record<string, string> = { M: "matin (4h-12h)", A: "après-midi (12h-20h)", N: "nuit (20h-4h)", R: "repos", T: "jour travaillé de la remonte, poste pas encore donné par le chef" };

/** le planning de l'utilisateur, prêt à calculer (null si pas encore rangé) */
export function moteur(rows: Row[]) {
  const t = (k: string) => rows.find((r) => r.source === "travail" && r.kind === k)?.data;
  const regles = t("regles"); if (!regles) return null;
  return new Planning(t("saisies")?.ev ?? {}, t("myhorsys") ?? null, regles);
}
const PAS_PRET = "Le planning n'est pas encore rangé dans Jarvis.";

/** un jour, en clair (sans aucun montant) */
export function dit(P: Planning, d: string) {
  const [p, g] = P.info(d); const f = ferie(d), an = P.anomalie(d);
  let t: string;
  if (g === "conge") t = "congé payé";
  else if (g === "rc") t = "récup";
  else if (g === "maladie") t = "maladie";
  else if (g === "sup") t = `jour sup (heures sup), ${POSTE[p]}`;
  else if (p === "T") t = POSTE.T;
  else if (g === "patron") t = `${POSTE[p]}, jour normal de la remonte`;
  else if (p === "R") t = P.debutRemonte(d) ? "repos (remonte)" : "repos";
  else t = POSTE[p];
  return t + (f ? ` (férié : ${f})` : "") + (an ? ` ⚠ anomalie MyHorsys : ${an}` : "");
}
const travaille = (P: Planning, d: string) => { const [p, g] = P.info(d); return p !== "R" && !estAbsence(g); };

/** pour le résumé et le lieu « travail » : postes seulement, jamais de chiffres */
export function travailTexte(rows: Row[], detail: boolean) {
  const P = moteur(rows); if (!P) return PAS_PRET;
  const td = today();
  let t = `Aujourd'hui : ${dit(P, td)}. Demain : ${dit(P, today(1))}.`;
  const deb = P.debutRemonte(td);
  if (deb) { let d = plus(deb, 10); t += ` En remonte, reprise du cycle le ${jour(d)}.`; }
  else { let d = td; while (!P.debutRemonte(d)) d = plus(d, 1); t += ` Prochaine remonte à partir du ${jour(d)}.`; }
  const sup: string[] = []; for (let d = today(1); d <= plus(td, 45) && sup.length < 6; d = plus(d, 1)) if (P.info(d)[1] === "sup") sup.push(jour(d));
  if (sup.length) t += ` Jours sup prévus : ${sup.join(", ")}.`;
  const an: string[] = []; for (let d = plus(td, -40); d <= td; d = plus(d, 1)) if (P.anomalie(d)) an.push(jour(d));
  if (an.length) t += ` ⚠ Anomalies MyHorsys à vérifier : ${an.join(", ")}.`;
  if (detail) { t += "\nLes 14 prochains jours :"; for (let i = 1; i <= 14; i++) t += `\n- ${jour(today(i))} : ${dit(P, today(i))}`; }
  return t + "\n(Paye, gains et compteurs : seulement si l'utilisateur les demande, avec jarvis_paye et jarvis_compteurs.)";
}

/** jarvis_planning : les postes d'une période */
export function planningTexte(rows: Row[], d1: string, d2: string) {
  const P = moteur(rows); if (!P) return PAS_PRET;
  if (d2 < d1) [d1, d2] = [d2, d1];
  const out: string[] = []; for (let d = d1; d <= d2 && out.length < 62; d = plus(d, 1)) out.push(`- ${jour(d)} : ${dit(P, d)}`);
  return out.join("\n");
}

/** l'état envoyé à l'app Jarvis (fiche Travail) : les postes, sans aucun montant ni compteur */
export function etatApp(P: Planning) {
  const jours = []; const td = today();
  for (let d = plus(td, -60); d <= plus(td, 400); d = plus(d, 1)) {
    const [p, g] = P.info(d); const f = ferie(d);
    jours.push({ d, g, p: p === "T" ? "J" : p, poste: p === "T" ? "J" : p, ...(g === "sup" ? { sup: true } : {}), ...(P.debutRemonte(d) ? { rem: true } : {}), ...(f ? { ferie: f } : {}) });
  }
  return { v: 2, moteur: "jarvis", maj: new Date().toISOString(), jours };
}
export async function publierEtat(admin: any, P: Planning) {
  const data = etatApp(P);
  const { data: ex } = await admin.from("jarvis_items").select("id").eq("source", "planning").eq("kind", "etat").limit(1);
  if (ex?.length) await admin.from("jarvis_items").update({ data, updated_at: new Date().toISOString() }).eq("id", ex[0].id);
  else await admin.from("jarvis_items").insert({ source: "planning", kind: "etat", label: "etat", data });
}
/** l'état de l'app est-il à refaire ? (pas fait par le moteur, ou d'un autre jour) */
export function etatPerime(rows: Row[]) {
  const e = rows.find((r) => r.source === "planning" && r.kind === "etat")?.data;
  return !e || e.moteur !== "jarvis" || jourParis(e.maj) !== today();
}

// ---------- modifier des jours (« la remonte la semaine prochaine je travaille mardi matin… ») ----------
const TYPES: Record<string, Genre | "remettre" | "repos" | null> = {
  travaille: null, remonte: "patron", jour_sup: "sup", sup: "sup", conge: "conge", recup: "rc", rc: "rc", maladie: "maladie", repos: "repos", remettre: "remettre",
};
export async function modifierJours(admin: any, rows: Row[], a: Record<string, any>, dateDe: (s?: string) => string) {
  const P = moteur(rows); if (!P) return { texte: PAS_PRET, P: null };
  const liste: { d: string; poste?: string; type?: string }[] = [];
  for (const x of (Array.isArray(a.jours) ? a.jours : [])) { const d = dateDe(x?.date); if (d) liste.push({ d, poste: x.poste ?? a.poste, type: x.type ?? a.type }); }
  if (!liste.length && a.date) { const d1 = dateDe(a.date), d2 = a.jusqu_au ? dateDe(a.jusqu_au) : d1; for (let d = d1; d <= d2 && liste.length < 62; d = plus(d, 1)) liste.push({ d, poste: a.poste, type: a.type }); }
  if (!liste.length) return { texte: "Donne au moins un jour (date AAAA-MM-JJ) à changer.", P: null };
  const faits: string[] = [];
  for (const { d, poste, type } of liste) {
    const ty = String(type ?? "travaille").toLowerCase().replace(/[ -]/g, "_");
    if (!(ty in TYPES)) return { texte: `Type inconnu « ${type} ». Choix : ${Object.keys(TYPES).join(", ")}.`, P: null };
    const k = TYPES[ty];
    const po = poste ? String(poste).toUpperCase().charAt(0) : undefined;
    if (po && !["M", "A", "N", "R"].includes(po)) return { texte: `Poste inconnu « ${poste} » : M (matin), A (après-midi), N (nuit) ou R (repos).`, P: null };
    if (k === "remettre") P.remettre(d);
    else if (k === "repos") P.modifier(d, "R", "cycle");
    else if (k === null) { // il travaille ce jour-là : dans la remonte, Jarvis classe tout seul (jour normal ou heures sup), comme Mon Planning
      if (!po) return { texte: `Pour le ${jour(d)}, donne le poste (matin, après-midi ou nuit).`, P: null };
      P.modifier(d, po as Poste, "cycle");
    } else {
      if ((k === "sup" || k === "patron") && !po && P.info(d)[0] === "R") return { texte: `Pour le ${jour(d)}, donne le poste (matin, après-midi ou nuit).`, P: null };
      P.modifier(d, (po as Poste) ?? null, k);
    }
  }
  for (const { d } of liste) faits.push(`- ${jour(d)} : ${dit(P, d)}`);
  const { data: ex } = await admin.from("jarvis_items").select("id,data").eq("source", "travail").eq("kind", "saisies").limit(1);
  const data = { ...(ex?.[0]?.data ?? {}), ev: P.ev, maj: new Date().toISOString() };
  const r = ex?.length ? await admin.from("jarvis_items").update({ data, updated_at: new Date().toISOString() }).eq("id", ex[0].id)
    : await admin.from("jarvis_items").insert({ source: "travail", kind: "saisies", label: "planning", data });
  if (r.error) return { texte: "Je n'ai pas pu enregistrer : " + r.error.message, P: null };
  return { texte: "C'est noté dans ton planning :\n" + faits.join("\n"), P };
}

// ---------- la paye, en net (seulement à la demande) ----------
function detailPaye(P: Planning, moisPaye: string) {
  const y = paye(P, moisPaye), k = y.brut > 0 ? y.net / y.brut : 0;
  const parts = [[y.conges > 0 ? "fixe + congés" : "fixe", y.fixe], [y.nomExceptionnel, y.exceptionnel], ["primes du four", y.four], ["nuits", y.nuit], ["dimanches", y.dimanche], ["fériés", y.ferie], ["jours sup", y.majSup]]
    .filter(([n, v]) => n && (v as number) > 0).map(([n, v]) => `${n} ${eur((v as number) * k)}`);
  const act = [`${y.jours} jours`, `${y.nuits} nuits`, `${y.dimanches} dimanche${y.dimanches > 1 ? "s" : ""}`, ...(y.feries ? [`${y.feries} férié${y.feries > 1 ? "s" : ""}`] : []), ...(y.conges + y.maladies ? [`${y.conges + y.maladies} absence(s)`] : [])];
  let t = `Paye de ${MOIS[mois(y.mois) - 1]} ${annee(y.mois)} (travail de ${MOIS[mois(y.moisTravail) - 1]}), versée le ${+y.verseLe.slice(8)} ${MOIS[mois(y.verseLe) - 1]} : environ ${eur(y.net)} net, après ${eur(y.impot)} d'impôt à la source.`;
  t += `\nDétail en net : ${parts.join(", ")}.\nCe qui est compté : ${act.join(", ")}.`;
  if (y.sup) t += `\nHeures sup payées ce mois-là : ${y.sup} jour${y.sup > 1 ? "s" : ""} sup → ${eur(y.majSup * k)} net${y.h25 + y.h50 > 0 ? ` (dont majoration du cycle : ${nb(y.h25)} h à 25 %${y.h50 ? `, ${nb(y.h50)} h à 50 %` : ""})` : ""}.`;
  return t;
}
export function payeTexte(rows: Row[], a: Record<string, any>, dateDe: (s?: string) => string) {
  const P = moteur(rows); if (!P) return PAS_PRET;
  const quoi = String(a.quoi ?? "mois").toLowerCase(), d = dateDe(a.date);
  const fin = "\n(Estimation calculée avec les règles de Mon Planning ; la vraie fiche de paye fait foi.)";
  if (quoi === "jour" || quoi === "periode") {
    const d2 = quoi === "periode" && a.jusqu_au ? dateDe(a.jusqu_au) : d;
    let tot = 0; const l: string[] = [];
    for (let x = d; x <= d2 && l.length < 62; x = plus(x, 1)) { const g = gainJour(P, x); if (g !== null) tot += g; l.push(`- ${jour(x)} : ${dit(P, x)} → ${g === null ? "rien" : "≈ " + eur(g) + " net"}`); }
    return l.join("\n") + (l.length > 1 ? `\nTotal ≈ ${eur(tot)} net.` : "") + "\n(Un jour sup est payé à la fin de son cycle ; un jour normal = sa part du fixe + ses primes.)" + fin;
  }
  if (quoi === "remonte") {
    let deb = P.debutRemonte(d); if (!deb) { let x = d; while (!P.debutRemonte(x)) x = plus(x, 1); deb = x; }
    let tot = 0, sup = 0; const l: string[] = [];
    for (let i = 0; i < 10; i++) { const x = plus(deb, i), g = gainJour(P, x); if (g !== null) tot += g; if (P.info(x)[1] === "sup") sup++; l.push(`- ${jour(x)} : ${dit(P, x)}${g === null ? "" : ` → ≈ ${eur(g)} net`}`); }
    return `Remonte du ${jour(deb)} au ${jour(plus(deb, 9))} (${P.quotaRemonte(deb)} jour(s) normal(aux) prévus, ${sup} jour(s) sup) :\n` + l.join("\n") + `\nTotal ≈ ${eur(tot)} net sur la remonte.` + fin;
  }
  if (quoi === "annee") {
    const a0 = annee(d), cur = annee(today()) === a0 ? mois(today()) : (a0 < annee(today()) ? 12 : 0);
    const ys = Array.from({ length: 12 }, (_, i) => paye(P, `${a0}-${String(i + 1).padStart(2, "0")}-01`));
    const percu = ys.slice(0, cur).reduce((s, y) => s + y.net, 0), prevu = ys.reduce((s, y) => s + y.net, 0);
    return `Payes ${a0} (net, versées en fin de mois) :\n` + ys.map((y, i) => `- ${MOIS[i]} : ≈ ${eur(y.net)}${y.nomExceptionnel ? ` (avec ${y.nomExceptionnel.toLowerCase()})` : ""}${y.sup ? `, dont ${y.sup} jours sup` : ""}`).join("\n")
      + (cur ? `\nDéjà perçu jusqu'à ${MOIS[cur - 1]} : ≈ ${eur(percu)} (moyenne ≈ ${eur(percu / cur)} par mois).` : "") + `\nPrévu sur l'année : ≈ ${eur(prevu)}.` + fin;
  }
  // mois : la paye VERSÉE à la fin de ce mois-là
  return detailPaye(P, debutMois(d)) + fin;
}

// ---------- les compteurs (seulement à la demande) ----------
export function compteursTexte(rows: Row[]) {
  const P = moteur(rows); if (!P) return PAS_PRET;
  const h = P.horsys, c = h?.compteurs ?? {}, j = (v: any) => v === undefined || v === null ? "?" : nb(Number(v)) + " j";
  const l = [
    `Congés payés (CP) restants : ${j(congesRestants(P))}${c.cp ? ` (acquis ${nb(c.cp.acquis)}, pris ${nb(c.cp.pris)})` : ""}`,
    `COR : ${j(c.cor?.solde)} — estimation pour janvier prochain : ≈ ${estimationCOR(P) ?? "?"} j`,
    `RC8 : ${j(c.rc8?.solde)} — le prochain arrive fin ${MOIS[prochainRC8(today()) - 1]}`,
    `CET (épargne-temps) : ${j(c.cet?.total ?? P.R.soldeCET)}${c.cm?.solde ? ` + ${nb(c.cm.solde)} j de médaille (CM)` : ""}`,
    `Remonte : ${c.remonte ? `${nb(c.remonte.reste)} jour(s) restant(s) sur ${nb(c.remonte.prevu)} (${nb(c.remonte.pose)} posés)` : "?"}`,
    `Heures majorées : ${c.heuresMajorees ? `${nb(c.heuresMajorees.annee)} h sur l'année, ${nb(c.heuresMajorees.mois)} h ce mois, ${nb(c.heuresMajorees.cycle)} h sur le cycle` : "?"}`,
    `Présence : ${c.presence ? `${nb(c.presence.annee)} jours sur l'année, ${nb(c.presence.mois)} ce mois` : "?"}`,
    ...(c.absencesAnnee ? [`Absences de l'année : ${Object.entries(c.absencesAnnee).map(([k, v]) => `${k} ${nb(Number(v))}`).join(", ")}`] : []),
    `Ancienneté : ${ancienneteAns(P, today())} ans (prime ${P.R.tauxAnciennete} %)`,
  ];
  return l.join("\n") + (h?.extrait ? `\n(Compteurs MyHorsys du ${new Date(h.extrait).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })}.)` : "");
}
