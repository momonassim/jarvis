// Jarvis — tes mails Outlook (synchronisés en lecture seule par la fonction jarvis-outlook)
// et la mémoire de Jarvis (ce qu'il a retenu des mails, notes, alertes), pour Claude et ChatGPT.
const URL_SB = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NOMS: Record<string, string> = { home: "logement", energie: "energie", usine: "travail", impots: "impots", clinique: "sante", mairie: "papiers", banque: "banque", medecin: "bebe", orange: "abonnements", garage: "voiture" };
const APP: Record<string, string> = Object.fromEntries(Object.entries(NOMS).map(([a, b]) => [b, a]));
const frd = (d?: string | null) => d ? d.slice(0, 10).split("-").reverse().join("/") : "";
const quand = (d?: string | null) => d ? new Date(d).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
const masquer = (s: string) => (s ?? "").replace(/\bFR\s?\d{2}(?:[\s.\-]?[0-9A-Z]{2,4}){4,8}/gi, "[IBAN masqué]")
  .replace(/\b[12]\s?\d{2}\s?(?:0[1-9]|1[0-2]|[2-9]\d)\s?(?:\d{2}|2[AB])\s?\d{3}\s?\d{3}\s?\d{2}\b/g, "[n° sécu masqué]");
const iso = (d?: string) => d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;

async function outlook(body: Record<string, unknown>) {
  const r = await fetch(URL_SB + "/functions/v1/jarvis-outlook", { method: "POST", headers: { Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return await r.json().catch(() => ({ ok: false, message: "La fonction Outlook ne répond pas." }));
}

export async function comptesOutlook(admin: any) {
  const { data } = await admin.from("jarvis_outlook").select("compte,statut,derniere_sync,erreur");
  return data ?? [];
}

export async function mailsChercher(admin: any, a: Record<string, any>) {
  const q = String(a.recherche ?? "").trim().slice(0, 120);
  const lieu = APP[a.lieu] ?? null;
  const comptes = await comptesOutlook(admin);
  if (!comptes.length) return "Aucune boîte Outlook n'est branchée à Jarvis. Dans l'app : Réglages ⚙️ › Mails Outlook › Connecter un compte.";
  const { data, error } = await admin.rpc("jarvis_mails_chercher", { p_q: q, p_depuis: iso(a.depuis), p_jusqu: iso(a.jusqu_au), p_de: String(a.de ?? ""), p_limite: Math.min(Number(a.limite) || 10, 30) });
  if (error) return "Recherche impossible : " + error.message;
  let rows = (data ?? []) as any[];
  if (lieu) rows = rows.filter((r) => r.tri?.lieu === lieu);
  let t = rows.length ? `Mails trouvés dans Jarvis (${rows.length}) :\n` + rows.map((r) => `- n° ${r.id} · ${quand(r.recu_le)} · ${r.de_nom || r.de} · « ${masquer(r.objet ?? "")} »`
    + (r.tri?.utile ? `\n  Jarvis a retenu : ${r.tri.resume ?? ""}${r.tri.lieu ? " [" + (NOMS[r.tri.lieu] ?? r.tri.lieu) + "]" : ""}` : `\n  ${masquer(String(r.apercu ?? "")).slice(0, 160)}`)).join("\n") : "";
  // pas assez trouvé (ou demandé) : on cherche directement dans Outlook, y compris les vieux mails
  if (q && (a.dans_outlook === true || rows.length < 3)) {
    const live = await outlook({ action: "live_chercher", q, max: 8 });
    const l = (live.mails ?? []).filter((m: any) => m.ref);
    if (l.length) t += (t ? "\n\n" : "") + "Trouvés directement dans Outlook (pas encore lus par Jarvis ; pour en lire un, passe sa référence à jarvis_mail_lire) :\n"
      + l.map((m: any) => `- ${quand(m.recu_le)} · ${m.de_nom || m.de} · « ${m.objet} »${m.pieces ? " · pièce jointe" : ""}\n  ${m.apercu.slice(0, 140)}\n  référence : ${m.ref}`).join("\n");
  }
  if (!t) return `Aucun mail trouvé pour « ${q} ». Boîtes branchées : ${comptes.map((c: any) => c.compte).join(", ")}.`;
  return t + "\n\nPour lire un mail en entier : jarvis_mail_lire avec son n° (ou sa référence Outlook).";
}

export async function mailLire(admin: any, a: Record<string, any>) {
  let id = Number(a.numero);
  const ref = String(a.numero ?? "");
  if (!id && ref.startsWith("outlook:")) { const r = await outlook({ action: "live_lire", ref }); if (!r.ok) return "Pas lu : " + (r.message ?? "?"); id = r.id; }
  if (!id) return "Donne le n° du mail (vu dans jarvis_mails_chercher) ou sa référence Outlook.";
  const { data: m } = await admin.from("jarvis_mails").select("id,compte,recu_le,de,de_nom,a,objet,corps,apercu,pieces,web_link,tri").eq("id", id).maybeSingle();
  if (!m) return "Mail introuvable.";
  const pj = (m.pieces ?? []).map((p: any) => p.nom).filter(Boolean);
  return `Mail n° ${m.id} (boîte ${m.compte})\nDe : ${m.de_nom ?? ""} <${m.de ?? ""}>\nÀ : ${m.a ?? ""}\nReçu le : ${quand(m.recu_le)}\nObjet : ${masquer(m.objet ?? "")}`
    + (pj.length ? `\nPièces jointes : ${pj.join(", ")}` : "")
    + (m.tri?.utile ? `\nCe que Jarvis en a retenu : ${m.tri.resume ?? ""}${m.tri.action ? " — À faire : " + m.tri.action : ""}` : "")
    + (m.web_link ? `\nOuvrir dans Outlook : ${m.web_link}` : "")
    + `\n\n${masquer(String(m.corps ?? m.apercu ?? "")).slice(0, 12000)}`;
}

// La mémoire de Jarvis : infos retenues des mails (avec le mail source), notes rangées, alertes
export async function memoire(admin: any, a: Record<string, any>) {
  const lieu = APP[a.lieu] ?? null, q = String(a.recherche ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const depuis = iso(a.depuis);
  const { data } = await admin.from("jarvis_items").select("id,source,kind,label,date,amount,data,updated_at")
    .or("and(source.eq.outlook,kind.eq.info),and(source.eq.jarvis,kind.eq.note),and(source.eq.mails,kind.eq.alerte)").order("date", { ascending: false, nullsFirst: false }).limit(800);
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let rows = (data ?? []) as any[];
  if (lieu) rows = rows.filter((r) => r.data?.lieu === lieu);
  if (depuis) rows = rows.filter((r) => !r.date || r.date >= depuis);
  if (q) { const mots = q.split(/\s+/).filter(Boolean); rows = rows.filter((r) => mots.every((m) => norm(JSON.stringify(r.data ?? {})).includes(m))); }
  rows = rows.slice(0, Math.min(Number(a.limite) || 20, 50));
  if (!rows.length) return "Rien dans la mémoire de Jarvis" + (q ? ` pour « ${a.recherche} »` : "") + (lieu ? ` (${a.lieu})` : "") + ". Essaie jarvis_mails_chercher pour fouiller les mails eux-mêmes.";
  return `Mémoire de Jarvis (${rows.length}) :\n` + rows.map((r) => {
    const d = r.data ?? {}, l = NOMS[d.lieu] ?? d.lieu ?? "?";
    if (r.kind === "note") return `- [note · ${l}] ${d.titre} : ${d.texte}`;
    if (r.kind === "alerte") return `- [alerte n° ${r.id} · ${l}${d.vu ? " · vue" : " · en cours"}] ${d.titre}${d.texte ? " : " + d.texte : ""}${d.date_mail ? " (mail du " + frd(d.date_mail) + ")" : ""}${d.mail_id ? " — mail n° " + d.mail_id : ""}`;
    return `- [${l} · mail du ${frd(d.date_mail)} · de ${d.de ?? "?"}] ${d.titre} : ${d.texte}${d.action ? " — À faire : " + d.action : ""}${d.echeance ? " (avant le " + frd(d.echeance) + ")" : ""} — mail n° ${d.mail_id}`;
  }).join("\n") + "\n\nPour relire le mail d'origine : jarvis_mail_lire avec son n°.";
}

export async function mailsSynchroniser(admin: any) {
  const comptes = await comptesOutlook(admin);
  if (!comptes.length) return "Aucune boîte Outlook branchée. Dans l'app : Réglages ⚙️ › Mails Outlook › Connecter un compte.";
  const r = await outlook({ action: "sync" });
  if (!r.ok) return "Synchro impossible : " + (r.message ?? r.error ?? "?");
  return "Mails relus : " + (r.comptes ?? []).map((c: any) => `${c.compte} : ${c.nouveaux} nouveaux${c.erreur ? " (erreur : " + c.erreur + ")" : ""}`).join(" ; ") + `. ${r.tries?.tries ?? 0} triés par Jarvis.`;
}
