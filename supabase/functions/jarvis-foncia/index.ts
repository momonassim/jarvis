// Jarvis — fonction « jarvis-foncia » : ton espace MyFoncia lu par le serveur, sans navigateur, même la nuit.
// Lecture seule. Tes identifiants (que tu as rangés toi-même dans le coffre chiffré) servent à te connecter
// comme l'app officielle MyFoncia ; on garde ensuite un jeton de renouvellement pour ne pas s'y reconnecter à chaque fois.
// Rien n'est modifié chez Foncia : écrire (une demande, un message) viendra plus tard, et toujours après ton oui.
//
// Actions : { action: "test" } = connexion seule · { action: "sync" } = tout lire et ranger. Réservé au propriétaire ou à la tâche planifiée.
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const OKTA = "https://login.my-foncia.fonciamillenium.net";
const ISSUER = OKTA + "/oauth2/millenium";
const CLIENT_ID = "0oalslzunnRGZbcuX417";
const RETOUR = "https://my-foncia.fonciamillenium.net/login/callback";
const ORIGINE = "https://my-foncia.fonciamillenium.net";
const SCOPES = "openid profile email offline_access";
const GQL = ["https://customer-portal-gateway.prod.fonciamillenium.net/graphql", "https://ms-gateway-customer-portal.prod.fonciamillenium.net/graphql"];
const NAV = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------- petits outils ----------
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const aleatoire = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(t: string) { return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))); }
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
async function secret(nom: string) { const { data } = await admin.rpc("jarvis_get_secret", { p_name: nom }); return typeof data === "string" ? data : ""; }
async function ranger(nom: string, valeur: string) { const { error } = await admin.rpc("jarvis_set_secret_srv", { p_name: nom, p_value: valeur }); if (error) throw new Error(error.message); }

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

// ---------- connexion (comme l'app officielle MyFoncia) ----------
async function echangeJeton(form: Record<string, string>) {
  const r = await fetch(ISSUER + "/v1/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Origin: ORIGINE, "User-Agent": NAV }, body: new URLSearchParams({ client_id: CLIENT_ID, ...form }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("jeton_" + r.status + "_" + (j.error ?? "") + (j.error_description ? ":" + String(j.error_description).slice(0, 120) : ""));
  if (j.refresh_token) await ranger("FONCIA_REFRESH", j.refresh_token);
  return j.access_token as string;
}

async function seConnecter(): Promise<{ at: string; via: string }> {
  // a) d'abord le jeton de renouvellement gardé la fois d'avant
  const rt = await secret("FONCIA_REFRESH");
  if (rt) { try { return { at: await echangeJeton({ grant_type: "refresh_token", refresh_token: rt, scope: SCOPES }), via: "renouvellement" }; } catch (_) { /* expiré : on refait la connexion complète */ } }
  // b) connexion complète : identifiant + mot de passe → jeton de session → code → jetons
  const username = await secret("FONCIA_ID"), password = await secret("FONCIA_PASSWORD");
  if (!username || !password) throw new Error("identifiants_absents");
  const r = await fetch(OKTA + "/api/v1/authn", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Origin: ORIGINE, "User-Agent": NAV }, body: JSON.stringify({ username, password, options: { warnBeforePasswordExpired: true, multiOptionalFactorEnroll: false } }) });
  const a = await r.json().catch(() => ({}));
  if (a.status !== "SUCCESS" || !a.sessionToken) {
    if (/MFA|FACTOR/i.test(a.status ?? "")) throw new Error("code_de_verification_demande:" + a.status);
    throw new Error("connexion_refusee_" + r.status + "_" + (a.status ?? a.errorCode ?? "") + (a.errorSummary ? ":" + a.errorSummary : ""));
  }
  const verif = aleatoire(48), defi = b64url(await sha256(verif));
  const q = new URLSearchParams({ client_id: CLIENT_ID, response_type: "code", response_mode: "query", scope: SCOPES, redirect_uri: RETOUR, state: aleatoire(16), nonce: aleatoire(16), code_challenge: defi, code_challenge_method: "S256", sessionToken: a.sessionToken, prompt: "none" });
  const z = await fetch(ISSUER + "/v1/authorize?" + q, { redirect: "manual", headers: { "User-Agent": NAV, Accept: "text/html" } });
  const loc = z.headers.get("location") ?? "";
  const code = new URL(loc || "https://x/").searchParams.get("code");
  if (!code) throw new Error("autorisation_" + z.status + "_" + (new URL(loc || "https://x/").searchParams.get("error") ?? "sans_code"));
  return { at: await echangeJeton({ grant_type: "authorization_code", code, code_verifier: verif, redirect_uri: RETOUR }), via: "mot de passe" };
}

// ---------- lecture GraphQL (comme le portail) ----------
async function gql(at: string, query: string, variables: Record<string, unknown> = {}) {
  let derniere = "";
  for (const url of GQL) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", authorization: "Bearer " + at, Origin: ORIGINE, "User-Agent": NAV }, body: JSON.stringify({ query, variables }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.data && !(j.errors?.length)) return j.data;
    if (r.ok && j.data && Object.values(j.data).some((v) => v)) return j.data;
    derniere = r.status + " " + JSON.stringify(j.errors ?? j).slice(0, 300);
  }
  throw new Error("graphql:" + derniere);
}

// ---------- les requêtes (extraites du portail) ----------
const F_ADR = `fragment address on Address { address1 address2 city zipCode countryCode }`;
const F_PAGE = `fragment pageInfo on PageInfo { hasNextPage pageNumber itemsPerPage totalPages endCursor }`;
const Q_COMPTES = `query getBasicAccounts($itemsPerPage: Int, $pageNumber: Int) { accounts(itemsPerPage: $itemsPerPage, pageNumber: $pageNumber) { uuid number quality ... on TenantAccount { building { id name number address { ...address } } } } } ${F_ADR}`;
const Q_SOLDE = `query getAccountingBalance($accountUuid: EncodedID!) { account(uuid: $accountUuid) { uuid accounting { currentBalance { value currency } projectedBalance { value currency } } } }`;
const Q_LIGNES = `query getAccountingLines($accountUuid: EncodedID!, $pageOptions: PageOptions) { account(uuid: $accountUuid) { uuid accounting { lines(pageOptions: $pageOptions) { totalCount pageInfo { ...pageInfo } edges { node { id label valueDate dueDate invoiceId amount { __typename ... on Debit { value currency } ... on Credit { value currency } } } } } } } } ${F_PAGE}`;
const Q_PAIEMENTS = `query getPaymentLines($accountUuid: EncodedID!, $pageOptions: PageOptions) { account(uuid: $accountUuid) { uuid accounting { payments(pageOptions: $pageOptions) { totalCount pageInfo { ...pageInfo } edges { node { id status motive createdAt instructionDate isAuto amount { value currency } } } } } } } ${F_PAGE}`;
const Q_CATEGORIES = `query getDocumentCategories($accountUuid: EncodedID!) { account(uuid: $accountUuid) { uuid documentCategories { key documentStats { count } subCategories { key } } } }`;
const Q_DOCS = `query getAccountDocuments($accountUuid: EncodedID!, $first: Int, $after: Cursor, $customerPortalCategory: CustomerPortalFileCategoryEnum!) { account(uuid: $accountUuid) { uuid documents(first: $first, after: $after, customerPortalCategory: $customerPortalCategory) { totalCount pageInfo { ...pageInfo } edges { node { id hashFile mimeType originalFilename category createdAt } } } } } ${F_PAGE}`;
const Q_URL = `query getDocumentUrl($hash: String!) { documentURL(hash: $hash) }`;
const Q_GESTIONNAIRE = `query getManager($uuid: EncodedID!) { account(uuid: $uuid) { uuid manager { id email firstName lastName branch { commercialName } } } }`;
const Q_DEMANDES = `query getDashboardTickets($accountUuid: EncodedID!) { tickets(accountUuid: $accountUuid, first: 20, status: [OPEN, WORK_IN_PROGRESS, WAITING_FOR_FIRST_CLIENT_RESPONSE, PROCESSED, FINISHED, CLOSED]) { edges { node { id category ticketNumber status createdAt finishedAt } } } }`;

// ---------- mise en forme (mêmes « kind » et libellés que le robot précédent) ----------
const CATEGORIES: Record<string, string> = { dueNotice: "Avis d’échéance et quittances", insurance: "Assurance", diagnosesGl: "Diagnostics", regularization_Rental_Management: "Régularisation des charges", rentReview: "Révision de loyer" };
const jour = (s?: string | null) => (s ? String(s).slice(0, 10) : null);
const frDate = (s?: string | null) => { const d = jour(s); return d ? d.slice(8, 10) + "/" + d.slice(5, 7) + "/" + d.slice(0, 4) : ""; };
const euros = (n: number) => (n < 0 ? "-" : "+") + Math.abs(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " €";
const propreNom = (s: string) => (s || "document").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").slice(0, 120);
const typeDoc = (nom: string, cat: string) => /quittance/i.test(nom) ? "Quittance de loyer" : /avis.?d.?[ée]ch[ée]ance/i.test(nom) ? "Avis d'échéance loyer" : /r[ée]gularisation/i.test(nom) ? "Régularisation des charges locatives" : /r[ée]vision/i.test(nom) ? "Révision de loyer" : /diagnostic/i.test(nom) ? "Diagnostics gl" : /assur/i.test(nom) ? "Assurance locataires" : (CATEGORIES[cat] ?? cat);
const STATUTS: Record<string, string> = { OPEN: "Ouverte", WORK_IN_PROGRESS: "En cours", WAITING_FOR_FIRST_CLIENT_RESPONSE: "En attente de ta réponse", PROCESSED: "Traitée", FINISHED: "Terminée", CLOSED: "Terminée" };

type Ligne = { source: string; kind: string; label: string; date: string | null; date_key: string; amount: number | null; data: Record<string, unknown>; updated_at: string };
function sansDoublon(lignes: Ligne[]) {
  const vu = new Map<string, number>(), out: Ligne[] = [];
  for (const l of lignes) {
    const k = l.kind + "|" + l.label + "|" + l.date_key, n = (vu.get(k) ?? 0) + 1; vu.set(k, n);
    out.push(n === 1 ? l : { ...l, label: l.label + " (" + n + ")", date_key: l.date_key });
  }
  return out;
}
async function enregistrer(lignes: Ligne[]) {
  const l = sansDoublon(lignes);
  for (let i = 0; i < l.length; i += 200) {
    const { error } = await admin.from("jarvis_items").upsert(l.slice(i, i + 200), { onConflict: "source,kind,label,date_key" });
    if (error) throw new Error("enregistrement:" + error.message);
  }
}
async function toutesPages(at: string, q: string, uuid: string, chemin: (d: any) => any) {
  const noeuds: any[] = [];
  for (let p = 1; p <= 40; p++) {
    const d = chemin(await gql(at, q, { accountUuid: uuid, pageOptions: { pageNumber: p, itemsPerPage: 50 } }));
    noeuds.push(...((d?.edges ?? []).map((e: any) => e.node)));
    if (!d?.pageInfo?.hasNextPage || !((d?.edges ?? []).length)) break;
  }
  return noeuds;
}

// ---------- un papier : on le télécharge et on le range dans le stockage « papiers/foncia/… » ----------
async function rangerPapier(at: string, cat: string, n: any, deja: Set<string>) {
  const dateIso = jour(n.createdAt) ?? "0000-00-00";
  const nom = propreNom(n.originalFilename || (n.id + ".pdf"));
  const chemin = cat + "/" + dateIso + "_" + nom;        // ex. dueNotice/2026-11-17_Quittance....pdf
  const cle = "foncia/" + chemin;                         // objet dans le bucket « papiers »
  if (!deja.has(cle)) {
    try {
      const u = (await gql(at, Q_URL, { hash: n.hashFile })).documentURL;
      if (u) {
        const pdf = await fetch(u, { headers: { "User-Agent": NAV } });
        if (pdf.ok) {
          const octets = new Uint8Array(await pdf.arrayBuffer());
          await admin.storage.from("papiers").upload(cle, octets, { upsert: true, contentType: n.mimeType || "application/pdf" });
          deja.add(cle);
        }
      }
    } catch (_) { /* un papier manquant ne bloque pas le reste */ }
  }
  const { data: sign } = await admin.storage.from("papiers").createSignedUrl(cle, 60 * 60 * 24 * 365);
  return { kind: "document", label: n.originalFilename || nom, date: dateIso === "0000-00-00" ? null : dateIso,
    data: { lien: sign?.signedUrl ?? null, path: chemin, type: typeDoc(n.originalFilename || "", cat), ajoute_le: frDate(n.createdAt), categorie: CATEGORIES[cat] ?? cat } };
}

// ---------- la lecture complète, rangée comme avant ----------
async function synchroniser(at: string) {
  const maintenant = new Date().toISOString();
  const L = (kind: string, label: string, date: string | null, amount: number | null, data: Record<string, unknown>): Ligne =>
    ({ source: "foncia", kind, label: String(label).slice(0, 300), date, date_key: date ?? "1970-01-01", amount, data, updated_at: maintenant });

  const comptes = (await gql(at, Q_COMPTES, { itemsPerPage: 20, pageNumber: 1 })).accounts ?? [];
  const compte = comptes.find((c: any) => c.quality === "TENANT") ?? comptes[0];
  if (!compte) throw new Error("aucun_compte");
  const uuid = compte.uuid, bat = compte.building;
  const lignes: Ligne[] = [];
  const erreurs: string[] = [];
  const compte_rendu: Record<string, number> = {};
  const essayer = async (nom: string, fn: () => Promise<number>) => { try { compte_rendu[nom] = await fn(); } catch (e) { erreurs.push(nom + ":" + (e instanceof Error ? e.message : String(e))); } };

  if (bat) lignes.push(L("logement", "Résidence", null, null, { residence: bat.name, adresse: [bat.address?.address1, [bat.address?.zipCode, bat.address?.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") }));

  await essayer("solde", async () => {
    const s = (await gql(at, Q_SOLDE, { accountUuid: uuid }))?.account?.accounting;
    const v = s?.currentBalance?.value; if (v == null) return 0;
    const n = Number(v);
    lignes.push(L("compte", "Solde", null, n, { solde: Math.abs(n).toFixed(2).replace(".", ",") }));
    return 1;
  });

  await essayer("operation", async () => {
    const ns = await toutesPages(at, Q_LIGNES, uuid, (d) => d?.account?.accounting?.lines);
    for (const n of ns) {
      const v = Number(n.amount?.value ?? 0), signe = n.amount?.__typename === "Credit" ? 1 : -1, m = signe * Math.abs(v);
      lignes.push(L("operation", n.label, jour(n.valueDate ?? n.dueDate), m, { date: frDate(n.valueDate ?? n.dueDate), libelle: n.label, montant: euros(m) }));
    }
    return ns.length;
  });

  await essayer("paiement", async () => {
    const ns = await toutesPages(at, Q_PAIEMENTS, uuid, (d) => d?.account?.accounting?.payments);
    for (const n of ns) {
      const m = Math.abs(Number(n.amount?.value ?? 0));
      lignes.push(L("paiement", n.motive || "Paiement", jour(n.instructionDate ?? n.createdAt), m, { date: frDate(n.instructionDate ?? n.createdAt), moyen: n.motive || "Paiement", montant: euros(m), statut: n.status, auto: !!n.isAuto }));
    }
    return ns.length;
  });

  await essayer("document", async () => {
    const cats = (await gql(at, Q_CATEGORIES, { accountUuid: uuid }))?.account?.documentCategories ?? [];
    const { data: liste } = await admin.storage.from("papiers").list("foncia", { limit: 1000 });
    const deja = new Set<string>(); // on évite de re-télécharger ce qui est déjà rangé
    for (const c of cats) { const { data: sub } = await admin.storage.from("papiers").list("foncia/" + c.key, { limit: 1000 }); (sub ?? []).forEach((f: any) => deja.add("foncia/" + c.key + "/" + f.name)); }
    let n = 0;
    for (const c of cats) {
      if (!(c.documentStats?.count)) continue;
      let after: string | null = null;
      for (let p = 0; p < 40; p++) {
        const d: any = (await gql(at, Q_DOCS, { accountUuid: uuid, first: 50, after, customerPortalCategory: c.key }))?.account?.documents;
        for (const e of (d?.edges ?? [])) { lignes.push({ ...L("document", "", null, null, {}), ...(await rangerPapier(at, c.key, e.node, deja)), source: "foncia", updated_at: maintenant, date_key: (jour(e.node.createdAt) ?? "1970-01-01"), amount: null }); n++; }
        if (!d?.pageInfo?.hasNextPage) break; after = d?.pageInfo?.endCursor ?? null; if (!after) break;
      }
    }
    return n;
  });

  await essayer("contact", async () => {
    const m = (await gql(at, Q_GESTIONNAIRE, { uuid }))?.account?.manager; if (!m) return 0;
    lignes.push(L("contact", "Gestionnaire", null, null, { nom: [m.firstName, m.lastName].filter(Boolean).join(" "), agence: m.branch?.commercialName ?? "", email: m.email ?? "" }));
    return 1;
  });

  await essayer("intervention", async () => {
    const ts = ((await gql(at, Q_DEMANDES, { accountUuid: uuid }))?.tickets?.edges ?? []).map((e: any) => e.node);
    for (const t of ts) lignes.push(L("intervention", t.category || ("Demande " + t.ticketNumber), jour(t.createdAt), null, { objet: t.category || "", statut: STATUTS[t.status] ?? t.status, reference: t.ticketNumber }));
    return ts.length;
  });

  await enregistrer(lignes);
  return { ok: erreurs.length === 0, residence: bat?.name ?? null, compte_rendu, erreurs };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (!(await proprietaire(req)) && !(await tacheAutorisee(req))) return json({ error: "non_autorise" }, 401);
    const { action = "sync" } = await req.json().catch(() => ({}));
    const { at, via } = await seConnecter();
    if (action === "test") return json({ ok: true, via });
    const r = await synchroniser(at);
    return json({ ...r, via });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: msg }, msg.startsWith("identifiants_absents") || msg.startsWith("connexion_refusee") || msg.startsWith("code_de_verification") ? 400 : 500);
  }
});
