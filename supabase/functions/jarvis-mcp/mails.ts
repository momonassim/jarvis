// Jarvis — ce que ChatGPT (ou Claude) rapporte des mails Outlook :
// des papiers (PDF joints) rangés au bon lieu, et des alertes rouges sur la ville 3D.
import { decodeBase64 } from "jsr:@std/encoding@1/base64";

// Domaine du connecteur → bâtiment de l'app
export const LIEU_APP: Record<string, string> = {
  logement: "home", energie: "energie", sante: "clinique", travail: "usine", impots: "impots",
  voiture: "garage", papiers: "mairie", banque: "banque", bebe: "medecin", abonnements: "orange",
};
const MAX = 15 * 1024 * 1024;
const slug = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "papier";
const frd = (d?: string) => d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10).split("-").reverse().join("/") : (d ?? "");
const iso = (d?: string) => d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;

// Papiers à ne jamais garder (même règle que le tri des PDF)
const INTERDIT = [
  [/\bFR\d{2}(?:\s?[0-9A-Z]{4}){5}\s?[0-9A-Z]{3}\b/i, "il contient un IBAN"],
  [/\b[12]\s?\d{2}\s?(?:0[1-9]|1[0-2]|[2-9]\d)\s?(?:\d{2}|2[AB])\s?\d{3}\s?\d{3}\s?\d{2}\b/, "il contient un n° de sécurité sociale"],
] as const;

// Texte → PDF propre (quand ChatGPT ne peut pas envoyer le fichier lui-même)
async function texteEnPdf(titre: string, entete: string[], texte: string) {
  // chargé seulement quand il sert (démarrage plus rapide)
  const { PDFDocument, StandardFonts, rgb } = await import("npm:pdf-lib@1.17.1");
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.HelveticaBold);
  // Helvetica ne connaît que l'alphabet occidental : on remplace le reste
  const net = (s: string) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...")
    .replace(/[\u00A0\u202F\t]/g, " ").replace(/\r/g, "")
    .split("\n").map((l) => Array.from(l).map((c) => { try { f.encodeText(c); return c; } catch { return ""; } }).join("")).join("\n");
  const W = 595, H = 842, M = 50, T = 10.5, L = 15;
  let page = doc.addPage([W, H]), y = H - M;
  const ligne = (s: string, font = f, taille = T, couleur = rgb(0.1, 0.1, 0.12)) => {
    if (y < M) { page = doc.addPage([W, H]); y = H - M; }
    page.drawText(s, { x: M, y, size: taille, font, color: couleur }); y -= taille + 5;
  };
  const coupe = (s: string, font = f, taille = T) => {
    const out: string[] = []; let cur = "";
    for (const mot of s.split(/\s+/)) {
      const essai = cur ? cur + " " + mot : mot;
      if (font.widthOfTextAtSize(essai, taille) > W - 2 * M && cur) { out.push(cur); cur = mot; } else cur = essai;
    }
    if (cur) out.push(cur); return out;
  };
  coupe(net(titre), fb, 16).forEach((s) => ligne(s, fb, 16));
  y -= 4; entete.filter(Boolean).forEach((s) => coupe(net(s), f, 9.5).forEach((x) => ligne(x, f, 9.5, rgb(0.4, 0.4, 0.45))));
  y -= 10;
  for (const para of net(texte).split(/\n/)) { if (!para.trim()) { y -= L / 2; continue; } coupe(para).forEach((s) => ligne(s)); }
  return await doc.save();
}

async function lireFichier(a: Record<string, any>) {
  if (a.pdf_base64) {
    const b = decodeBase64(String(a.pdf_base64).replace(/^data:[^,]*,/, "").replace(/\s/g, ""));
    if (b.length > MAX) throw new Error("fichier trop lourd (15 Mo max)");
    return b;
  }
  if (a.pdf_url && /^https:\/\//i.test(a.pdf_url)) {
    const r = await fetch(a.pdf_url).catch(() => null);
    if (r && r.ok) {
      const b = new Uint8Array(await r.arrayBuffer());
      if (b.length <= MAX && new TextDecoder().decode(b.slice(0, 5)) === "%PDF-") return b;
    }
  }
  return null;
}

// ---------- ranger un papier venu d'un mail ----------
export async function rangerPapier(admin: any, a: Record<string, any>, lieuxValides: string[]) {
  if (!lieuxValides.includes(a.lieu)) return "Lieu inconnu. Choix : " + lieuxValides.join(", ");
  const titre = String(a.titre ?? "").trim().slice(0, 60); if (!titre) return "Donne un titre court au papier.";
  const texte = String(a.contenu_texte ?? "");
  for (const [re, pourquoi] of INTERDIT) if (re.test(texte)) return `Pas rangé : ${pourquoi}. Jarvis ne garde pas ce genre de papier.`;
  const app = LIEU_APP[a.lieu];
  let octets: Uint8Array | null = null, origine = "fichier joint";
  try { octets = await lireFichier(a); } catch (e) { return "Pas rangé : " + (e as Error).message; }
  if (!octets) {
    if (texte.trim().length < 20) return "Pas rangé : je n'ai reçu ni le PDF (pdf_base64 ou pdf_url), ni son contenu (contenu_texte). Renvoie l'un des trois.";
    octets = await texteEnPdf(titre, [a.sous_titre, a.de && "De : " + a.de, a.date_mail && "Mail reçu le " + frd(a.date_mail), "Recopié depuis Outlook par Jarvis"], texte);
    origine = "contenu recopié";
  }
  const nom = `mail-${iso(a.date_mail) ?? new Date().toISOString().slice(0, 10)}-${slug(titre)}.pdf`;
  const chemin = `mac/${app}/${nom}`;
  const { error: eUp } = await admin.storage.from("papiers").upload(chemin, octets, { contentType: "application/pdf", upsert: true });
  if (eUp) return "Pas rangé : " + eUp.message;

  const lines: string[][] = [];
  if (a.de) lines.push(["De", String(a.de).slice(0, 80)]);
  if (a.date_mail) lines.push(["Mail reçu le", frd(a.date_mail)]);
  if (a.resume) lines.push(["En bref", String(a.resume).slice(0, 240)]);
  const doc = { t: titre, d: String(a.sous_titre ?? "").slice(0, 70), v: "PDF", where: "Outlook", lines, path: chemin, ajoute_le: new Date().toISOString() };

  const { data: r } = await admin.from("jarvis_items").select("id,data").eq("source", "mac").eq("kind", "lieu").eq("label", app).maybeSingle();
  if (!r) {
    const { error } = await admin.from("jarvis_items").insert({ source: "mac", kind: "lieu", label: app, data: { docs: [doc] } });
    if (error) return "Rangé dans le coffre, mais pas relié au lieu : " + error.message;
  } else {
    const docs = (r.data?.docs ?? []).filter((x: any) => x.path !== chemin);
    const { error } = await admin.from("jarvis_items").update({ data: { ...(r.data ?? {}), docs: [doc, ...docs] }, updated_at: new Date().toISOString() }).eq("id", r.id);
    if (error) return "Rangé dans le coffre, mais pas relié au lieu : " + error.message;
  }
  return `Rangé dans Jarvis (${a.lieu}) : « ${titre} »${doc.d ? " · " + doc.d : ""} — ${origine === "fichier joint" ? "le PDF joint au mail" : "PDF recréé à partir du contenu du mail"}. Il est visible dans l'app, et retrouvable avec jarvis_pdf.`;
}

// ---------- le même sujet = le même lieu et la même date d'événement (jamais deux alertes pour une seule coupure) ----------
const MOIS_EV = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
/** la date de l'événement dont parle un texte (« 26 novembre », « 26/11 », « 4 décembre 2026 »), au plus près après le mail */
export function dateEvenement(texte: string, ref?: string | null): string | null {
  const t = String(texte ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const r = ref && /^\d{4}-\d{2}-\d{2}/.test(ref) ? new Date(ref.slice(0, 10) + "T12:00:00Z") : new Date();
  const mk = (j: number, m: number, a?: number) => { if (!(j >= 1 && j <= 31 && m >= 0 && m <= 11)) return null; let y = a ?? r.getUTCFullYear(); let d = new Date(Date.UTC(y, m, j, 12));
    if (!a && d.getTime() < r.getTime() - 20 * 864e5) d = new Date(Date.UTC(y + 1, m, j, 12)); return d.toISOString().slice(0, 10); };
  const m1 = t.match(/\b(\d{1,2})(?:er)?\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)(?:\s+(20\d{2}))?/);
  if (m1) return mk(+m1[1], MOIS_EV.indexOf(m1[2]), m1[3] ? +m1[3] : undefined);
  const m2 = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?\b/);
  if (m2) return mk(+m2[1], +m2[2] - 1, m2[3] ? (m2[3].length === 2 ? 2000 + +m2[3] : +m2[3]) : undefined);
  return null;
}
/** cherche une alerte déjà posée sur le même sujet (même lieu et même événement à venir, ou même titre, ou même mail).
 *  La date ne compte que si l'événement est APRÈS le mail (une coupure, un rendez-vous) : deux mails du même jour ne sont pas forcément le même sujet. */
export async function alerteMemeSujet(admin: any, lieu: string, ev: string | null, label: string, dateMail: string | null, mailId?: number | null) {
  const { data } = await admin.from("jarvis_items").select("id,label,data").eq("source", "mails").eq("kind", "alerte").eq("data->>lieu", lieu).limit(200);
  const aVenir = (e: string | null, d?: string | null) => !!e && (!d || e > d);
  return (data ?? []).find((x: any) => x.label === label || (mailId && x.data?.mail_id === mailId) ||
    (aVenir(ev, dateMail) && (() => { const e2 = x.data?.evenement ?? dateEvenement(`${x.data?.titre ?? ""} ${x.data?.texte ?? ""}`, x.data?.date_mail); return e2 === ev && aVenir(e2, x.data?.date_mail); })())) ?? null;
}

// ---------- alertes rouges sur la ville ----------
export async function poserAlerte(admin: any, a: Record<string, any>, lieuxValides: string[]) {
  if (!lieuxValides.includes(a.lieu)) return "Lieu inconnu. Choix : " + lieuxValides.join(", ");
  const titre = String(a.titre ?? "").trim().slice(0, 70); if (!titre) return "Donne un titre court à l'alerte.";
  const app = LIEU_APP[a.lieu], date = iso(a.date_mail);
  const label = `${app}:${slug(titre).slice(0, 30)}`;
  const texte = String(a.texte ?? "").slice(0, 500), evenement = dateEvenement(`${titre} ${texte}`, date);
  const data: Record<string, any> = { lieu: app, titre, texte, de: String(a.de ?? "").slice(0, 80), date_mail: date, vu: false, ...(evenement ? { evenement } : {}) };
  const meme = await alerteMemeSujet(admin, app, evenement, label, date);
  if (meme) {
    if (meme.data?.vu) return `Cette alerte (« ${titre} ») a déjà été vue, je ne la remets pas.`;
    // même sujet : on complète l'alerte existante au lieu d'en créer une deuxième
    const garde = (meme.data?.texte ?? "").length > texte.length ? { titre: meme.data.titre, texte: meme.data.texte } : {};
    await admin.from("jarvis_items").update({ data: { ...meme.data, ...data, ...garde }, updated_at: new Date().toISOString() }).eq("id", meme.id);
    return `Cette alerte existait déjà (« ${meme.data?.titre ?? titre} ») : je l'ai complétée, sans la mettre en double.`;
  } else {
    const { error } = await admin.from("jarvis_items").insert({ source: "mails", kind: "alerte", label, date, data });
    if (error) return "Alerte pas posée : " + error.message;
  }
  return `Alerte posée : le lieu « ${a.lieu} » est en rouge dans l'app Jarvis avec « ${titre} ».`;
}

export async function alertesOuvertes(admin: any) {
  const { data } = await admin.from("jarvis_items").select("id,data").eq("source", "mails").eq("kind", "alerte");
  return (data ?? []).filter((x: any) => !x.data?.vu);
}

export async function alerteVue(admin: any, numero: unknown) {
  const id = Number(numero); if (!id) return "Donne le numéro de l'alerte (vu dans jarvis_resume).";
  const { data } = await admin.from("jarvis_items").select("id,data").eq("id", id).eq("source", "mails").eq("kind", "alerte").maybeSingle();
  if (!data) return "Alerte introuvable.";
  await admin.from("jarvis_items").update({ data: { ...data.data, vu: true, vu_le: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq("id", id);
  return `Alerte « ${data.data?.titre} » retirée : le lieu n'est plus en rouge.`;
}
