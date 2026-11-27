// Jarvis — le moteur du travail, repris de l'app Mac « Mon Planning » (RouteCalendrier) :
// cycle 5x8 de 35 jours, remonte volante, jours sup, absences, données MyHorsys, paye en net.
// Pur calcul : aucune donnée perso ici, tout vient de Supabase (jarvis_items, source « travail »).
// Les dates sont des chaînes AAAA-MM-JJ (jour de Paris).

export type Poste = "M" | "A" | "N" | "R" | "T"; // T = jour de remonte travaillé, poste pas encore donné
export type Genre = "cycle" | "patron" | "sup" | "conge" | "rc" | "maladie"; // patron = jour normal de la remonte
export type Ev = { genre: Genre; poste: Poste };
export type JourHorsys = { prevu?: string; planifie?: string | null; absence?: string | null; anomalie?: string | null };
export type Horsys = { extrait?: string; jours?: Record<string, JourHorsys>; compteurs?: any };

// Les montants (salaire, taux, primes, date d'entrée) ne sont PAS dans ce code public :
// ils sont rangés dans Supabase (jarvis_items, source « travail », kind « regles »).
export type Regles = {
  base: number; anciennete: number; primeVacances: number;
  taux: number; tNuit: number; tDim: number; tFour: number;
  panier: number; panierNuit: number; transport: number;
  maj25: number; maj50: number; maj75: number; plusConge: number;
  heuresPoste: number; seuilCycle: number; plafond25: number;
  partNet: number; tauxImpot: number; partImposable: number;
  soldeCP: number; soldeCET: number; dateSoldes: string;
  entree: string; tauxAnciennete: number;
  cycle: { motif: string; ref: string; decalage: number };
};

// ---------- dates ----------
const ms = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const plus = (d: string, n: number) => new Date(ms(d) + n * 864e5).toISOString().slice(0, 10);
export const ecart = (a: string, b: string) => Math.round((ms(b) - ms(a)) / 864e5); // jours de a à b
export const mois = (d: string) => +d.slice(5, 7);
export const annee = (d: string) => +d.slice(0, 4);
export const js = (d: string) => (new Date(ms(d)).getUTCDay() + 6) % 7; // 0 = lundi … 6 = dimanche
const dmy = (a: number, m: number, j: number) => `${a}-${String(m).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
export const debutMois = (d: string) => d.slice(0, 8) + "01";
export const moisPlus = (d: string, n: number) => { const t = annee(d) * 12 + mois(d) - 1 + n; return dmy(Math.floor(t / 12), (t % 12) + 1, 1); };
export const finMois = (d: string) => plus(moisPlus(d, 1), -1);
export const jourParis = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

// ---------- jours fériés ----------
function paques(a: number) {
  const a1 = a % 19, b = Math.floor(a / 100), c = a % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a1 + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a1 + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), j = ((h + l - 7 * m + 114) % 31) + 1;
  return dmy(a, mo, j);
}
const FIXES: [number, number, string][] = [[1, 1, "Jour de l'an"], [5, 1, "Fête du travail"], [5, 8, "Victoire 1945"], [7, 14, "Fête nationale"],
  [8, 15, "Assomption"], [11, 1, "Toussaint"], [11, 11, "Armistice"], [12, 25, "Noël"]];
export function ferie(d: string): string | null {
  const f = FIXES.find(([m, j]) => dmy(annee(d), m, j) === d); if (f) return f[2];
  const p = paques(annee(d));
  if (plus(p, 1) === d) return "Lundi de Pâques";
  if (plus(p, 39) === d) return "Ascension";
  if (plus(p, 50) === d) return "Lundi de Pentecôte";
  return null;
}
const estFerie = (d: string) => ferie(d) !== null;

const posteDe = (c?: string | null): Poste | null => (c === "M" || c === "A" || c === "N" || c === "R") ? c : null;
/** type d'absence MyHorsys → type de jour (null = absence partielle, ignorée) */
const genreAbsence = (a?: string | null): Genre | null =>
  a === "CP" || a === "AV" ? "conge" : a === "RC" || a === "RC8" ? "rc" : a === "MA" ? "maladie" : null;
export const estAbsence = (g: Genre) => g === "conge" || g === "rc" || g === "maladie";

// ---------- le planning ----------
export class Planning {
  ev: Record<string, Ev>;
  horsys: Horsys | null;
  R: Regles;
  motif: string;
  private ext: string | null; // jour de la dernière extraction MyHorsys
  private memo = new Map<string, { travailles: Set<string>; remonte: Set<string>; aConfirmer: Set<string> }>();

  constructor(ev: Record<string, Ev> | null, horsys: Horsys | null, regles: Regles) {
    this.ev = { ...(ev ?? {}) };
    this.horsys = horsys;
    this.R = regles;
    this.motif = this.R.cycle.motif;
    this.ext = horsys?.extrait ? jourParis(horsys.extrait) : null;
  }
  private h(d: string) { return this.horsys?.jours?.[d]; }

  /** rang du jour dans le cycle de 35 jours (0 = premier matin du cycle) */
  rang(d: string) { const L = this.motif.length, n = ecart(this.R.cycle.ref, d) + this.R.cycle.decalage; return ((n % L) + L) % L; }
  posteCycle(d: string) { return this.motif[this.rang(d)] as Poste; }

  // la remonte (volante) : les 10 jours de repos entre deux cycles (rangs 25 à 34, du samedi au lundi)
  debutRemonte(d: string) { const r = this.rang(d); return r >= 25 ? plus(d, -(r - 25)) : null; }
  quotaAlterne(debut: string) {
    const mardi = plus(debut, 3);
    if ([7, 8].includes(mois(mardi))) return 0;
    const n = Math.trunc(ecart("2026-09-15", plus(debut, -25)) / this.motif.length); // le cycle du 15/09 en avait 2
    return n % 2 === 0 ? 2 : 1;
  }
  quotaRemonte(debut: string) {
    const q = this.quotaAlterne(debut);
    const c = this.horsys?.compteurs;
    // remontes à venir de l'année : on ne dépasse pas le « reste » du compteur MyHorsys
    if (!c || !this.ext || !(debut > this.ext) || annee(debut) !== annee(this.ext)) return q;
    let reste = Math.round(Number(c.remonte?.reste ?? 0));
    let b = plus(debut, -this.motif.length * 12);
    while (b < debut) {
      if (b > this.ext && annee(b) === annee(this.ext)) reste -= this.quotaAlterne(b);
      b = plus(b, this.motif.length);
    }
    return Math.max(0, Math.min(q, reste));
  }
  /** le poste d'un jour travaillé (MyHorsys planifié, sinon saisie à la main) */
  posteTravaille(d: string): Poste { return posteDe(this.h(d)?.planifie) ?? this.ev[d]?.poste ?? "M"; }
  /** répartition de la remonte : jours travaillés, jours comptés en remonte (normaux), cases « à confirmer » */
  repartition(debut: string) {
    const m = this.memo.get(debut); if (m) return m;
    const jours = Array.from({ length: 10 }, (_, i) => plus(debut, i));
    const travailles: string[] = [], imposes: string[] = [];
    for (const d of jours) {
      const e = this.ev[d], h = this.h(d);
      if (h && genreAbsence(h.absence)) continue;
      if (e && estAbsence(e.genre)) continue; // congé, récup ou maladie saisis à la main : jour non travaillé
      const pl = posteDe(h?.planifie);
      if (pl) { if (pl !== "R") { travailles.push(d); if (e?.genre === "patron") imposes.push(d); } continue; } // MyHorsys fait foi
      if (!e || e.poste === "R" || estAbsence(e.genre)) continue;
      travailles.push(d); if (e.genre === "patron") imposes.push(d);
    }
    const quota = this.quotaRemonte(debut);
    const remonte = new Set(imposes);
    // le patron avantage : il met la remonte sur les jours les moins majorés (matin / après-midi en semaine)
    const cout = (d: string) => (this.posteTravaille(d) === "N" || js(d) === 6 || estFerie(d)) ? 1 : 0;
    for (const d of travailles.filter((x) => !remonte.has(x)).sort((a, b) => cout(a) - cout(b) || a.localeCompare(b))) {
      if (remonte.size >= quota) break; remonte.add(d);
    }
    const aConfirmer = new Set<string>();
    const libres = [3, 4, 5, 6].map((i) => plus(debut, i)).filter((d) => !travailles.includes(d) && !(this.ev[d] && estAbsence(this.ev[d].genre)) && !this.h(d)?.planifie);
    for (const d of libres) { if (remonte.size + aConfirmer.size >= quota) break; aConfirmer.add(d); }
    const r = { travailles: new Set(travailles), remonte, aConfirmer };
    this.memo.set(debut, r); return r;
  }
  anomalie(d: string) { return this.h(d)?.anomalie ?? null; }
  /** ce que l'on fait ce jour-là : (poste, genre) */
  info(d: string): [Poste, Genre] {
    const e = this.ev[d], h = this.h(d);
    const ga = genreAbsence(h?.absence);
    if (h && ga) return [posteDe(h.planifie) ?? posteDe(h.prevu) ?? this.posteCycle(d), ga];
    // une absence saisie à la main l'emporte sur MyHorsys (son extraction ne montre pas toujours les congés posés)
    if (e && estAbsence(e.genre)) return [e.poste, e.genre];
    const deb = this.debutRemonte(d);
    if (deb) {
      const r = this.repartition(deb);
      if (r.travailles.has(d)) return [this.posteTravaille(d), r.remonte.has(d) ? "patron" : "sup"];
      if (r.aConfirmer.has(d)) return ["T", "patron"];
      return ["R", "cycle"];
    }
    const pl = posteDe(h?.planifie); if (pl) return [pl, "cycle"]; // jour déjà planifié dans MyHorsys
    if (e) return [e.poste, e.genre];
    return [this.posteCycle(d), "cycle"];
  }
  /** remet le jour tel que prévu par le cycle */
  remettre(d: string) { delete this.ev[d]; this.memo.clear(); }
  modifier(d: string, poste?: Poste | null, genre?: Genre | null) {
    let [p, g] = this.info(d);
    if (poste) p = poste;
    if (genre) g = genre;
    if (p === "T") return;
    if (g === "cycle" && p === this.posteCycle(d)) delete this.ev[d];
    else if (estAbsence(g)) this.ev[d] = { genre: g, poste: this.posteCycle(d) }; // une absence garde le poste prévu
    else this.ev[d] = { genre: g, poste: p };
    this.memo.clear();
  }
}

// ---------- la paye (en net) ----------
// Bulletin du mois M (versé à la date du calendrier Tokai Cobex, sinon le dernier jour de M) = FIXE du mois M + VARIABLES des pointages du mois M − 1.
export type Paye = {
  mois: string; moisTravail: string; verseLe: string;
  jours: number; heures: number; nuits: number; dimanches: number; feries: number; repos: number; sup: number; conges: number; maladies: number;
  exceptionnel: number; nomExceptionnel: string;
  fixe: number; four: number; nuit: number; dimanche: number; ferie: number; majSup: number; nonSoumis: number;
  heuresCycle: number; h25: number; h50: number;
  brut: number; netAvantImpot: number; impot: number; net: number;
};
// Dates de virement de la paie (calendrier Tokai Cobex) ; sinon, le dernier jour du mois.
const VIREMENTS: Record<string, string> = {
  "2026-01": "2026-01-29", "2026-02": "2026-02-26", "2026-03": "2026-03-27", "2026-04": "2026-04-28",
  "2026-05": "2026-05-27", "2026-06": "2026-06-26", "2026-07": "2026-07-29", "2026-08": "2026-08-28",
  "2026-09": "2026-09-28", "2026-10": "2026-10-29", "2026-11": "2026-11-27", "2026-12": "2026-12-21",
};
export const dateVirement = (mp: string) => VIREMENTS[mp.slice(0, 7)] ?? finMois(mp);
export function paye(P: Planning, moisPaye: string): Paye {
  const R = P.R, mp = debutMois(moisPaye);
  const p: Paye = { mois: mp, moisTravail: moisPlus(mp, -1), verseLe: dateVirement(mp), jours: 0, heures: 0, nuits: 0, dimanches: 0, feries: 0, repos: 0, sup: 0, conges: 0, maladies: 0,
    exceptionnel: 0, nomExceptionnel: "", fixe: R.base + R.anciennete, four: 0, nuit: 0, dimanche: 0, ferie: 0, majSup: 0, nonSoumis: 0,
    heuresCycle: 0, h25: 0, h50: 0, brut: 0, netAvantImpot: 0, impot: 0, net: 0 };
  if (mois(mp) === 6) { p.exceptionnel = R.primeVacances; p.nomExceptionnel = "Prime de vacances"; }
  if (mois(mp) === 12) { p.exceptionnel = R.base + R.anciennete; p.nomExceptionnel = "13e mois"; }
  const debut = p.moisTravail, m = mois(debut);
  for (let d = debut; mois(d) === m; d = plus(d, 1)) {
    const [po, g] = P.info(d); const fe = estFerie(d), dim = js(d) === 6;
    if (g === "conge" || g === "rc") {
      p.conges++; if (g === "conge") p.fixe += R.plusConge;
      if (po === "N") p.nuit += 8 * R.tNuit + R.panier;
      if (fe) p.ferie += 8 * R.tDim; else if (dim) p.dimanche += 8 * R.tDim;
    } else if (g === "maladie") p.maladies++;
    else if (po === "R") { p.repos++; if (fe) p.ferie += 8 * R.taux; }
    else {
      p.jours++; p.heures += 8; p.four += 8 * R.tFour; p.nonSoumis += R.transport;
      if (po === "N") { p.nuits++; p.nuit += R.panier; p.nonSoumis += R.panierNuit; if (g !== "sup" || dim || fe) p.nuit += 8 * R.tNuit; }
      if (fe) { p.feries++; p.ferie += 8 * R.tDim + 8 * R.taux; }
      else if (dim) { p.dimanches++; p.dimanche += 8 * R.tDim; }
    }
  }
  // heures sup : payées pour les cycles dont le DERNIER jour sup tombe dans le mois travaillé
  const vus = new Set<string>();
  for (let j = debut; mois(j) === m; j = plus(j, 1)) {
    if (P.info(j)[1] !== "sup") continue;
    const dc = plus(j, -P.rang(j)); if (vus.has(dc)) continue; vus.add(dc);
    const j35 = Array.from({ length: P.motif.length }, (_, i) => plus(dc, i));
    const joursSup = j35.filter((x) => P.info(x)[1] === "sup");
    const dernier = joursSup[joursSup.length - 1];
    if (!dernier || mois(dernier) !== m) continue;
    let hc = 0;
    for (const x of j35) { const [po, g] = P.info(x); if (po !== "R" && g !== "maladie") hc += R.heuresPoste; } // congés et récup comptent comme travaillés
    for (const x of joursSup) { const po = P.info(x)[0]; p.sup++; p.majSup += 8 * R.taux + ((po === "N" || js(x) === 6 || estFerie(x)) ? 8 * R.maj75 : 0); }
    // la majoration ne dépasse pas les heures des jours sup du cycle
    const ex = Math.min(Math.max(0, hc - R.seuilCycle), joursSup.length * 8), a = Math.min(ex, R.plafond25), b = Math.max(0, ex - R.plafond25);
    p.heuresCycle = hc; p.h25 += a; p.h50 += b; p.majSup += a * R.maj25 + b * R.maj50;
  }
  p.brut = p.fixe + p.exceptionnel + p.four + p.nuit + p.dimanche + p.ferie + p.majSup;
  p.netAvantImpot = p.brut * R.partNet + p.nonSoumis;
  p.impot = p.netAvantImpot * R.partImposable * R.tauxImpot;
  p.net = p.netAvantImpot - p.impot;
  return p;
}
/** ce que rapporte un jour, en net (part du fixe + primes du jour ; jour sup = poste payé majoré) ; null = rien (repos, maladie) */
export function gainJour(P: Planning, d: string): number | null {
  const R = P.R, [po, g] = P.info(d);
  if (po === "R" || g === "maladie") return null;
  const partFixe = (R.base + R.anciennete) / 21.0, k = R.partNet * (1 - R.tauxImpot * R.partImposable);
  const dim = js(d) === 6, fe = estFerie(d);
  if (g === "conge" || g === "rc") return (partFixe + (g === "conge" ? R.plusConge : 0)) * k;
  let brut = 8 * R.tFour, ns = R.transport;
  if (po === "N") { brut += R.panier; ns += R.panierNuit; if (g !== "sup" || dim || fe) brut += 8 * R.tNuit; }
  if (dim || fe) brut += 8 * R.tDim;
  if (fe) brut += 8 * R.taux;
  if (g === "sup") brut += 8 * R.taux + ((po === "N" || dim || fe) ? 8 * R.maj75 : 0) + 8 * R.maj25;
  else brut += partFixe;
  return brut * k + ns;
}

// ---------- les compteurs ----------
export function congesRestants(P: Planning) {
  const h = P.horsys, sol = Number(h?.compteurs?.cp?.solde ?? P.R.soldeCP);
  if (h?.extrait) {
    const ext = jourParis(h.extrait);
    return sol - Object.entries(P.ev).filter(([k, v]) => v.genre === "conge" && k > ext && !h.jours?.[k]?.absence).length;
  }
  return P.R.soldeCP - Object.entries(P.ev).filter(([k, v]) => v.genre === "conge" && k >= P.R.dateSoldes).length;
}
/** COR donnés en janvier prochain : (heures effectives de l'année − 1 620 h) ÷ 8 h */
export function estimationCOR(P: Planning) {
  const h = P.horsys; if (!h?.extrait) return null;
  const ext = jourParis(h.extrait); let heures = Number(h.compteurs?.heuresMajorees?.annee ?? 0);
  for (let d = plus(ext, 1); annee(d) === annee(ext); d = plus(d, 1)) { const [po, g] = P.info(d); if (po !== "R" && !estAbsence(g)) heures += 7.75; }
  return Math.max(0, Math.floor((heures - 1620) / 8));
}
export function ancienneteAns(P: Planning, au: string) {
  const e = P.R.entree; let n = annee(au) - annee(e); if (au.slice(5) < e.slice(5)) n--; return n;
}
/** un RC8 arrive à la fin d'avril, d'août et de décembre */
export const prochainRC8 = (aujourdhui: string) => { const m = mois(aujourdhui); return [4, 8, 12].find((x) => x >= m) ?? 4; };
