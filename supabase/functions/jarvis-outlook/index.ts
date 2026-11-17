// Jarvis — fonction « jarvis-outlook » : tes mails Outlook, en LECTURE SEULE, via Microsoft Graph.
//
// 1. start    : l'app (propriétaire connecté) demande l'adresse de connexion Microsoft.
// 2. callback : Microsoft revient ici avec un code ; on le change en jetons (gardés dans le coffre chiffré).
// 3. sync     : toutes les 15 minutes (tâche planifiée) ou à la demande : nouveaux mails → tri → lieux de la ville.
// 4. status / deconnecter : pour les Réglages de l'app.
//
// Permissions demandées à Microsoft : openid, offline_access, User.Read, Mail.Read. Jamais d'envoi, de modification ni de suppression.
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CLIENT_ID = Deno.env.get("MS_CLIENT_ID") ?? "7bbe78e6-2258-45f1-9ad7-25f731fb1213";
const AUTORITE = "https://login.microsoftonline.com/" + (Deno.env.get("MS_TENANT") ?? "consumers") + "/oauth2/v2.0";
const RETOUR = URL_SB.replace(/\/$/, "") + "/functions/v1/jarvis-outlook";
const APP = Deno.env.get("JARVIS_APP_URL") ?? "https://momonassim.github.io/jarvis/";
const SCOPES = "openid offline_access User.Read Mail.Read";
const GRAPH = "https://graph.microsoft.com/v1.0";
const JOURS_DEPART = 30;          // au premier branchement : les 30 derniers jours
const CORPS_PAR_TOUR = 40;        // mails dont on lit le contenu par passage
const TRI_PAR_TOUR = 20;          // mails triés par Claude par passage

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const page = (titre: string, texte: string, ok: boolean) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jarvis</title><body style="font-family:-apple-system,system-ui,sans-serif;background:#eef2f6;color:#2f343c;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="background:#fff;border-radius:20px;padding:28px 26px;max-width:420px;box-shadow:0 10px 30px rgba(30,40,55,.12)"><h2 style="margin:0 0 8px">${ok ? "✓ " : ""}${titre}</h2><p style="line-height:1.5">${texte}</p>
<a href="${APP}?outlook=${ok ? "ok" : "erreur"}" style="display:inline-block;margin-top:10px;background:#2f343c;color:#fff;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:600">Revenir à Jarvis</a></div>
${ok ? `<script>setTimeout(()=>location.href=${JSON.stringify(APP + "?outlook=ok")},1500)</script>` : ""}</body>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });

// ---------- petits outils ----------
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const aleatoire = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(t: string) { return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))); }
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
async function secret(nom: string) { const { data } = await admin.rpc("jarvis_get_secret", { p_name: nom }); return typeof data === "string" ? data : ""; }
async function ranger(nom: string, valeur: string) { const { error } = await admin.rpc("jarvis_set_secret_srv", { p_name: nom, p_value: valeur }); if (error) throw new Error(error.message); }
// Jamais d'IBAN, de n° de sécu ni de n° de carte dans ce que Jarvis garde
export const masquer = (s: string) => (s ?? "")
  .replace(/\bFR\s?\d{2}(?:[\s.\-]?[0-9A-Z]{2,4}){4,8}/gi, "[IBAN masqué]")
  .replace(/\b[12]\s?\d{2}\s?(?:0[1-9]|1[0-2]|[2-9]\d)\s?(?:\d{2}|2[AB])\s?\d{3}\s?\d{3}\s?\d{2}\b/g, "[n° sécu masqué]")
  .replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => m.replace(/\D/g, "").length >= 15 ? "[n° de carte masqué]" : m);
const propre = (t: string) => masquer(t).replace(/\r/g, "").replace(/[ \t\u00a0]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

async function proprietaire(req: Request) {
  const sb = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data } = await sb.rpc("jarvis_is_owner"); return data === true;
}
async function tacheAutorisee(req: Request) {
  const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!t) return false;
  if (t === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const c = await secret("CRON_TOKEN"); return !!c && t.length === c.length && hex(await sha256(t)) === hex(await sha256(c));
}

// ---------- jetons Microsoft ----------
async function jetons(params: Record<string, string>) {
  const cs = await secret("MS_CLIENT_SECRET");
  if (!cs) throw new Error("secret_absent");
  const r = await fetch(AUTORITE + "/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: cs, scope: SCOPES, redirect_uri: RETOUR, ...params }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.error_description?.split("\r\n")[0] || j.error || "jeton refusé (" + r.status + ")");
  return j as { access_token: string; refresh_token?: string };
}
async function accesCompte(c: { compte: string; coffre: string }) {
  const rt = await secret(c.coffre); if (!rt) throw new Error("reconnecter");
  const j = await jetons({ grant_type: "refresh_token", refresh_token: rt });
  if (j.refresh_token && j.refresh_token !== rt) await ranger(c.coffre, j.refresh_token);   // le jeton tourne à chaque usage
  return j.access_token;
}
async function graph(at: string, chemin: string, texte = false) {
  const r = await fetch(chemin.startsWith("http") ? chemin : GRAPH + chemin, { headers: { Authorization: "Bearer " + at, ...(texte ? { Prefer: 'outlook.body-content-type="text", odata.maxpagesize=50' } : { Prefer: "odata.maxpagesize=50" }) } });
  if (r.status === 429) throw new Error("Microsoft demande d'attendre un peu (trop de requêtes)");
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message ?? "Graph " + r.status), { status: r.status });
  return j;
}

// ---------- 1. démarrer la connexion ----------
async function demarrer() {
  if (!(await secret("MS_CLIENT_SECRET"))) return json({ ok: false, message: "Range d'abord le secret de l'application Microsoft dans les Réglages." });
  await admin.from("jarvis_outlook_etat").delete().lt("cree_le", new Date(Date.now() - 15 * 60e3).toISOString());
  const etat = aleatoire(24), verifier = aleatoire(48);
  const { error } = await admin.from("jarvis_outlook_etat").insert({ etat, verifier }); if (error) return json({ ok: false, message: error.message });
  const challenge = b64url(await sha256(verifier));
  const url = AUTORITE + "/authorize?" + new URLSearchParams({ client_id: CLIENT_ID, response_type: "code", redirect_uri: RETOUR, response_mode: "query",
    scope: SCOPES, state: etat, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" });
  return json({ ok: true, url });
}

// ---------- 2. retour de Microsoft ----------
async function retour(u: URL) {
  const err = u.searchParams.get("error");
  if (err) return page("Connexion annulée", "Microsoft n'a pas donné l'accès : " + (u.searchParams.get("error_description") ?? err).replace(/</g, "&lt;").slice(0, 200), false);
  const code = u.searchParams.get("code") ?? "", etat = u.searchParams.get("state") ?? "";
  const { data: e } = await admin.from("jarvis_outlook_etat").select("verifier,cree_le").eq("etat", etat).maybeSingle();
  await admin.from("jarvis_outlook_etat").delete().eq("etat", etat);
  if (!e || Date.now() - new Date(e.cree_le).getTime() > 15 * 60e3) return page("Lien expiré", "Recommence depuis les Réglages de Jarvis (« Connecter un compte Outlook »).", false);
  try {
    const j = await jetons({ grant_type: "authorization_code", code, code_verifier: e.verifier });
    if (!j.refresh_token) throw new Error("Microsoft n'a pas donné d'accès durable (offline_access)");
    const moi = await graph(j.access_token, "/me?$select=displayName,mail,userPrincipalName");
    const compte = String(moi.mail || moi.userPrincipalName || "").toLowerCase();
    if (!compte) throw new Error("adresse du compte introuvable");
    const coffre = "MSRT_" + hex(await sha256(compte)).slice(0, 16);
    await ranger(coffre, j.refresh_token);
    await admin.from("jarvis_outlook").upsert({ compte, nom: moi.displayName ?? null, coffre, statut: "branché", erreur: null }, { onConflict: "compte" });
    // premier passage tout de suite, sans faire attendre la page
    // @ts-ignore EdgeRuntime existe dans Supabase
    (globalThis.EdgeRuntime?.waitUntil ?? ((p: Promise<unknown>) => p))(synchroniser(compte).catch(() => {}));
    return page("Outlook est branché", `Jarvis lit maintenant les mails de <b>${compte}</b> (lecture seule). Il range les 30 derniers jours, puis chaque nouveau mail toutes les 15 minutes.`, true);
  } catch (x) {
    const m = (x as Error).message;
    return page("Pas branché", m === "secret_absent" ? "Le secret de l'application Microsoft manque dans les Réglages de Jarvis." : "Microsoft a répondu : " + m.replace(/</g, "&lt;").slice(0, 240), false);
  }
}

// ---------- 3. synchroniser ----------
const LIEUX: Record<string, string> = {
  home: "Chez toi : logement, loyer, régie Foncia, charges, assurance habitation, coupures (Enedis, eau), voisinage, travaux, courses",
  energie: "Gaz et électricité : Plenitude, Engie, EDF, compteur, consommation, échéancier, tarifs",
  usine: "Travail : employeur Tokai Cobex, planning, convocations, formations, visite médicale du travail, bulletins de paie, CSE",
  impots: "Impôts et amendes : impots.gouv, avis d'impôt, prélèvement à la source, amendes (ANTAI), taxes",
  clinique: "Santé de la famille : rendez-vous médicaux, MédinLyon, Doctolib, Ameli, mutuelle, analyses, ordonnances",
  mairie: "Papiers : mairie, pièce d'identité, passeport, permis, préfecture, état civil, démarches administratives",
  banque: "Argent et banque : La Banque Postale, Revolut, virements, prélèvements, cartes, crédits, CAF (argent)",
  medecin: "Le bébé : crèche, école maternelle, pédiatre, vaccins, CAF pour l'enfant, garde",
  orange: "Abonnements : Orange (box, mobile), Sosh, streaming, abonnements en ligne, résiliations",
  garage: "Voiture : contrôle technique, assurance auto (Ornikar), garage, entretien, carte grise, stationnement, péage",
};
const EMOJI_LIEU = Object.keys(LIEUX);

export async function synchroniser(seul?: string) {
  const { data: comptes } = await admin.from("jarvis_outlook").select("compte,coffre").order("branche_le");
  const bilan: Record<string, unknown>[] = [];
  for (const c of comptes ?? []) {
    if (seul && c.compte !== seul) continue;
    const b: Record<string, unknown> = { compte: c.compte, nouveaux: 0, lus: 0, tries: 0 };
    try {
      const at = await accesCompte(c);
      // a) la liste des nouveaux mails de la boîte de réception (depuis le dernier mail connu, avec 2 h de marge)
      const { data: dernier } = await admin.from("jarvis_mails").select("recu_le").eq("compte", c.compte).order("recu_le", { ascending: false }).limit(1).maybeSingle();
      const depuis = dernier?.recu_le ? new Date(new Date(dernier.recu_le).getTime() - 2 * 3600e3) : new Date(Date.now() - JOURS_DEPART * 864e5);
      let lien = `/me/mailFolders/inbox/messages?$select=subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments,internetMessageId,webLink,inferenceClassification`
        + `&$filter=receivedDateTime ge ${depuis.toISOString()}&$orderby=receivedDateTime desc&$top=50`;
      let tours = 0;
      while (lien && tours++ < 10) {
        const p = await graph(at, lien);
        const lignes = (p.value ?? []).filter((m: any) => m.id).map((m: any) => ({
          compte: c.compte, graph_id: m.id, internet_id: m.internetMessageId ?? null, recu_le: m.receivedDateTime ?? null,
          de: (m.from?.emailAddress?.address ?? "").toLowerCase().slice(0, 200), de_nom: (m.from?.emailAddress?.name ?? "").slice(0, 200),
          a: (m.toRecipients ?? []).map((t: any) => t.emailAddress?.address).filter(Boolean).join(", ").slice(0, 400),
          objet: masquer(m.subject ?? "").slice(0, 400), apercu: propre(m.bodyPreview ?? "").slice(0, 500),
          web_link: m.webLink ?? null, classement: m.inferenceClassification ?? null, pieces: m.hasAttachments ? [{ joint: true }] : [],
        }));
        if (lignes.length) {
          // pas de doublon : même mail = même identifiant (le même mail transféré deux fois garde son identifiant internet)
          const ids = lignes.map((l: any) => l.internet_id).filter(Boolean);
          const { data: connus } = ids.length ? await admin.from("jarvis_mails").select("internet_id").eq("compte", c.compte).in("internet_id", ids) : { data: [] };
          const vus = new Set((connus ?? []).map((x: any) => x.internet_id));
          const neufs = lignes.filter((l: any) => !l.internet_id || !vus.has(l.internet_id));
          if (neufs.length) { const { data: ins } = await admin.from("jarvis_mails").upsert(neufs, { onConflict: "compte,graph_id", ignoreDuplicates: true }).select("id"); b.nouveaux = (b.nouveaux as number) + (ins?.length ?? 0); }
        }
        lien = p["@odata.nextLink"] ?? "";
      }
      // b) le contenu des mails pas encore lus (texte seulement, nettoyé)
      const { data: aLire } = await admin.from("jarvis_mails").select("id,graph_id,pieces").eq("compte", c.compte).eq("corps_lu", false).order("recu_le", { ascending: false }).limit(CORPS_PAR_TOUR);
      for (const m of aLire ?? []) {
        try {
          const d = await graph(at, `/me/messages/${encodeURIComponent(m.graph_id)}?$select=body,hasAttachments`, true);
          let pieces = m.pieces;
          if (d.hasAttachments) { const pj = await graph(at, `/me/messages/${encodeURIComponent(m.graph_id)}/attachments?$select=name,contentType,size`).catch(() => ({ value: [] }));
            pieces = (pj.value ?? []).map((x: any) => ({ nom: String(x.name ?? "").slice(0, 120), type: x.contentType, taille: x.size })); }
          await admin.from("jarvis_mails").update({ corps: propre(d.body?.content ?? "").slice(0, 20000), corps_lu: true, pieces }).eq("id", m.id);
          b.lus = (b.lus as number) + 1;
        } catch (x) { if ((x as any).status === 404) await admin.from("jarvis_mails").update({ corps_lu: true, traite: true, tri: { utile: false, raison: "supprimé" } }).eq("id", m.id); }
      }
      await admin.from("jarvis_outlook").update({ derniere_sync: new Date().toISOString(), statut: "branché", erreur: null }).eq("compte", c.compte);
    } catch (x) {
      const m = (x as Error).message;
      const reco = /reconnecter|invalid_grant|AADSTS70000|AADSTS700082|consent/i.test(m);
      await admin.from("jarvis_outlook").update({ statut: reco ? "à reconnecter" : "erreur", erreur: m.slice(0, 300) }).eq("compte", c.compte);
      b.erreur = m;
    }
    bilan.push(b);
  }
  const t = await trier();
  return { comptes: bilan, tries: t };
}

// ---------- tri : Claude lit chaque mail et dit ce qu'il faut en retenir ----------
const slug = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "info";
async function trier() {
  const cle = await secret("ANTHROPIC_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (!cle) return { ok: false, message: "clé Claude absente" };
  const { data: lot } = await admin.from("jarvis_mails").select("id,compte,recu_le,de,de_nom,objet,apercu,corps,pieces,web_link,classement")
    .eq("traite", false).eq("corps_lu", true).order("recu_le", { ascending: false }).limit(TRI_PAR_TOUR);
  let n = 0;
  for (const m of lot ?? []) {
    let tri: any = null;
    try { tri = await demanderTri(cle, m); } catch (x) { if (/credit|balance|401|403/i.test((x as Error).message)) break; continue; }
    await admin.from("jarvis_mails").update({ tri, traite: true }).eq("id", m.id);
    n++;
    if (!tri?.utile || !EMOJI_LIEU.includes(tri.lieu)) continue;
    const date = (m.recu_le ?? "").slice(0, 10) || null;
    // l'info retenue, avec la référence au mail source (une seule par mail : pas de doublon)
    await admin.from("jarvis_items").upsert({ source: "outlook", kind: "info", label: "mail:" + m.id, date, amount: typeof tri.montant === "number" ? tri.montant : null,
      data: { lieu: tri.lieu, titre: String(tri.titre ?? m.objet ?? "").slice(0, 80), texte: String(tri.resume ?? "").slice(0, 500), action: tri.action ?? null,
        echeance: tri.echeance ?? null, de: m.de_nom || m.de, date_mail: date, mail_id: m.id, compte: m.compte, web_link: m.web_link, pieces: (m.pieces ?? []).map((p: any) => p.nom).filter(Boolean) },
      updated_at: new Date().toISOString() }, { onConflict: "source,kind,label,date_key" });
    // ce qui demande d'agir : le lieu passe en rouge (une alerte par sujet, jamais remise si déjà vue)
    if (tri.importance === "alerte") {
      const label = `${tri.lieu}:${slug(String(tri.titre ?? m.objet ?? ""))}`.slice(0, 60);
      const { data: deja } = await admin.from("jarvis_items").select("id,data").eq("source", "mails").eq("kind", "alerte").eq("label", label).limit(5);
      const meme = (deja ?? []).find((x: any) => (x.data?.date_mail ?? null) === date || x.data?.mail_id === m.id);
      const data = { lieu: tri.lieu, titre: String(tri.titre ?? "").slice(0, 70), texte: String(tri.resume ?? "").slice(0, 500), de: (m.de_nom || m.de || "").slice(0, 80), date_mail: date, vu: false, mail_id: m.id, web_link: m.web_link };
      if (!meme) await admin.from("jarvis_items").insert({ source: "mails", kind: "alerte", label, date, data });
      else if (!meme.data?.vu) await admin.from("jarvis_items").update({ data, updated_at: new Date().toISOString() }).eq("id", meme.id);
    }
  }
  return { ok: true, tries: n };
}
async function demanderTri(cle: string, m: any) {
  const lieux = Object.entries(LIEUX).map(([k, v]) => `- ${k} : ${v}`).join("\n");
  const texte = `De : ${m.de_nom ?? ""} <${m.de ?? ""}>\nReçu le : ${m.recu_le}\nObjet : ${m.objet ?? ""}\nPièces jointes : ${(m.pieces ?? []).map((p: any) => p.nom).filter(Boolean).join(", ") || "aucune"}\nBoîte : ${m.classement === "other" ? "Autres" : "Prioritaire"}\n\n${String(m.corps ?? m.apercu ?? "").slice(0, 5000)}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "x-api-key": cle, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: Deno.env.get("JARVIS_MAIL_MODEL") ?? "claude-haiku-5-5", max_tokens: 400,
      system: `Tu tries les mails de Sabri pour son assistant Jarvis. Réponds UNIQUEMENT par un objet JSON, sans texte autour :
{"utile":bool,"lieu":"…","importance":"alerte|info|ignorer","titre":"…","resume":"…","action":"…","echeance":"AAAA-MM-JJ ou null","montant":nombre ou null}
- utile = false pour la pub, les newsletters, les promos, les réseaux sociaux, les notifications sans enjeu.
- lieu : un seul parmi :\n${lieux}
- importance « alerte » seulement s'il faut agir ou ne pas oublier : payer, répondre, une date limite, un rendez-vous, une convocation, une coupure, une hausse de tarif, un problème.
- titre : très court (6 mots max), en français. resume : 1 ou 2 phrases simples, avec les chiffres et dates utiles. action : ce qu'il doit faire, ou null.
- Ne recopie JAMAIS d'IBAN, de numéro de sécurité sociale, de numéro de carte, de mot de passe ni de code de connexion.`,
      messages: [{ role: "user", content: texte }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j?.error?.message ?? "Claude " + r.status) + " " + r.status);
  const t = (j.content ?? []).map((x: any) => x.text ?? "").join("");
  const o = JSON.parse((t.match(/\{[\s\S]*\}/) ?? ["{}"])[0]);
  o.titre = masquer(String(o.titre ?? "")); o.resume = masquer(String(o.resume ?? "")); if (o.action) o.action = masquer(String(o.action));
  if (!EMOJI_LIEU.includes(o.lieu)) o.lieu = null;
  return o;
}

// ---------- recherche directe dans Outlook (mails anciens, pas encore dans Jarvis) ----------
async function liveChercher(q: string, max = 8) {
  const { data: comptes } = await admin.from("jarvis_outlook").select("compte,coffre");
  const out: any[] = [];
  for (const c of comptes ?? []) {
    try {
      const at = await accesCompte(c);
      const p = await graph(at, `/me/messages?$search=${encodeURIComponent('"' + q.replace(/"/g, "") + '"')}&$top=${max}&$select=subject,from,receivedDateTime,bodyPreview,hasAttachments,webLink`);
      (p.value ?? []).forEach((m: any) => out.push({ ref: "outlook:" + c.compte + ":" + m.id, compte: c.compte, recu_le: m.receivedDateTime, de: m.from?.emailAddress?.address, de_nom: m.from?.emailAddress?.name,
        objet: masquer(m.subject ?? ""), apercu: propre(m.bodyPreview ?? "").slice(0, 300), pieces: !!m.hasAttachments }));
    } catch (x) { out.push({ erreur: c.compte + " : " + (x as Error).message }); }
  }
  return out.sort((a, b) => String(b.recu_le ?? "").localeCompare(String(a.recu_le ?? "")));
}
// Lire un mail trouvé dans Outlook : il est gardé dans Jarvis (puis trié au prochain passage)
async function liveLire(ref: string) {
  const m = ref.match(/^outlook:([^:]+):(.+)$/); if (!m) return { ok: false, message: "Référence inconnue." };
  const [, compte, gid] = m;
  const { data: deja } = await admin.from("jarvis_mails").select("id").eq("compte", compte).eq("graph_id", gid).maybeSingle();
  if (deja) return { ok: true, id: deja.id };
  const { data: c } = await admin.from("jarvis_outlook").select("compte,coffre").eq("compte", compte).maybeSingle(); if (!c) return { ok: false, message: "Compte non branché." };
  const at = await accesCompte(c);
  const d = await graph(at, `/me/messages/${encodeURIComponent(gid)}?$select=subject,from,toRecipients,receivedDateTime,bodyPreview,body,hasAttachments,internetMessageId,webLink,inferenceClassification`, true);
  let pieces: any[] = [];
  if (d.hasAttachments) { const pj = await graph(at, `/me/messages/${encodeURIComponent(gid)}/attachments?$select=name,contentType,size`).catch(() => ({ value: [] })); pieces = (pj.value ?? []).map((x: any) => ({ nom: x.name, type: x.contentType, taille: x.size })); }
  const { data: ins, error } = await admin.from("jarvis_mails").upsert({ compte, graph_id: gid, internet_id: d.internetMessageId ?? null, recu_le: d.receivedDateTime,
    de: (d.from?.emailAddress?.address ?? "").toLowerCase(), de_nom: d.from?.emailAddress?.name ?? "", a: (d.toRecipients ?? []).map((t: any) => t.emailAddress?.address).join(", "),
    objet: masquer(d.subject ?? ""), apercu: propre(d.bodyPreview ?? "").slice(0, 500), corps: propre(d.body?.content ?? "").slice(0, 20000), corps_lu: true,
    web_link: d.webLink, classement: d.inferenceClassification, pieces }, { onConflict: "compte,graph_id" }).select("id").single();
  if (error) return { ok: false, message: error.message };
  return { ok: true, id: ins.id };
}

// ---------- 4. réglages ----------
async function deconnecter(compte: string) {
  const { data: c } = await admin.from("jarvis_outlook").select("coffre").eq("compte", compte).maybeSingle();
  if (!c) return json({ ok: false, message: "Compte inconnu." });
  await ranger(c.coffre, "");
  await admin.from("jarvis_outlook").delete().eq("compte", compte);
  return json({ ok: true, message: "Compte débranché. Les mails déjà rangés restent dans Jarvis." });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const u = new URL(req.url);
  if (req.method === "GET") {
    if (u.searchParams.has("code") || u.searchParams.has("error")) return await retour(u);
    return new Response("Jarvis Outlook", { status: 200 });
  }
  if (req.method !== "POST") return json({ error: "methode" }, 405);
  let body: any = {}; try { body = await req.json(); } catch { /* vide */ }
  const action = String(body.action ?? "");
  // la tâche planifiée (toutes les 15 min) ou le connecteur MCP
  if (await tacheAutorisee(req)) {
    if (action === "sync") return json({ ok: true, ...(await synchroniser(body.compte)) });
    if (action === "live_chercher") return json({ ok: true, mails: await liveChercher(String(body.q ?? ""), Number(body.max) || 8) });
    if (action === "live_lire") return json(await liveLire(String(body.ref ?? "")));
  }
  // sinon : seulement le propriétaire connecté dans l'app
  if (!(await proprietaire(req))) return json({ error: "interdit" }, 403);
  if (action === "start") return await demarrer();
  if (action === "sync") return json({ ok: true, ...(await synchroniser(body.compte)) });
  if (action === "deconnecter") return await deconnecter(String(body.compte ?? ""));
  return json({ error: "action inconnue" }, 400);
});
