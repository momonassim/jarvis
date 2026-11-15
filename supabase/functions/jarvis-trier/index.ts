// Jarvis — fonction « jarvis-trier »
// L'app dépose un PDF dans papiers/mac/a-trier/. Jarvis le lit (API Claude), décide tout seul
// à quel lieu il appartient, lui donne un vrai titre, puis le range et le relie au lieu.
// Il refuse (et efface) les papiers qui portent un n° de sécu, un IBAN, une pièce d'identité…
import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const LIEUX: Record<string, string> = {
  home: "Chez toi : logement, loyer, bail, quittances, assurance habitation, état des lieux, courses",
  energie: "Gaz et électricité : contrat, échéancier, facture ou relevé d'énergie, compteur",
  garage: "Voiture : assurance auto, contrôle technique, entretien, réparation, amende liée à la conduite non encore traitée par les impôts, historique du véhicule",
  impots: "Impôts et amendes : avis d'impôt, taxe, amende (ANTAI), majoration, paiement au Trésor public",
  clinique: "Santé : rendez-vous médical, ordonnance, facture d'hôpital ou de clinique, mutuelle, remboursement",
  usine: "Travail : contrat de travail, planning, attestation employeur, formation, bulletins de paie",
  mairie: "Papiers administratifs divers : mairie, CAF, attestations, courriers officiels qui ne vont nulle part ailleurs",
  banque: "Argent : courrier de banque, crédit, prêt, épargne (sans IBAN ni relevé de compte)",
  medecin: "Le bébé : crèche, pédiatre, vaccins, carnet, papiers concernant l'enfant",
  orange: "Abonnements : téléphone, internet, box, streaming, salle de sport, tout abonnement payé chaque mois",
};

const OUTIL = {
  name: "ranger",
  description: "Range le papier lu au bon lieu de Jarvis, ou le refuse.",
  input_schema: {
    type: "object",
    properties: {
      refus: { type: ["string", "null"], description: "null si on peut le ranger. Sinon, la raison courte en français (ex. « contient ton n° de sécu »)." },
      lieu: { type: "string", enum: Object.keys(LIEUX) },
      titre: { type: "string", description: "Titre court et clair en français, comme un humain l'écrirait (ex. « Attestation d'assurance auto », « Facture Orange »). 50 caractères max." },
      sous_titre: { type: "string", description: "Détail utile pour le distinguer : organisme, période ou date, montant (ex. « MAAF · 2026 », « Octobre 2026 · 29,99 € »). 60 caractères max." },
    },
    required: ["refus", "lieu", "titre", "sous_titre"],
  },
};

const CONSIGNE = `Tu es Jarvis, l'assistant perso de Sabri. On te donne un PDF qu'il vient d'ajouter.
Lis-le et range-le toi-même. Lieux possibles :
${Object.entries(LIEUX).map(([k, v]) => `- ${k} = ${v}`).join("\n")}

Exception : un bulletin de paie de Sabri est TOUJOURS accepté et rangé dans usine,
même s'il porte son n° de sécu et son IBAN (titre « Bulletin de paie », sous-titre = le mois et l'année, ex. « Octobre 2026 »).

Pour tous les autres papiers, refuse (champ refus rempli) s'il contient au moins une de ces choses :
un numéro de sécurité sociale complet, un IBAN ou un numéro de compte bancaire complet,
une pièce d'identité (carte d'identité, passeport, permis de conduire, titre de séjour),
un papier de préfecture, ou s'il s'agit du papier d'une autre personne que Sabri et sa famille.
Sinon, refus = null, et choisis le lieu le plus logique. Appelle toujours l'outil « ranger ».`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "methode" }, 405);

  // 1. Qui appelle ?
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: ok } = await sb.rpc("jarvis_is_owner");
  if (ok !== true) return json({ error: "interdit" }, 403);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: coffre } = await admin.rpc("jarvis_get_secret", { p_name: "ANTHROPIC_API_KEY" });
  const key = (typeof coffre === "string" && coffre) || Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "cle_absente" }, 503);

  // 2. Le PDF déposé
  let body: { path?: string };
  try { body = await req.json(); } catch { return json({ error: "json" }, 400); }
  const path = body.path ?? "";
  if (!/^mac\/a-trier\/[\w.-]+$/.test(path)) return json({ error: "chemin" }, 400);
  const nom = path.split("/").pop()!;
  const { data: fichier, error: eDl } = await admin.storage.from("papiers").download(path);
  if (eDl || !fichier) return json({ error: "introuvable" }, 404);
  const efface = () => admin.storage.from("papiers").remove([path]);

  // 3. Pour ranger, les 2 premières pages suffisent (beaucoup plus rapide qu'un papier entier)
  let octets = new Uint8Array(await fichier.arrayBuffer());
  try {
    const src = await PDFDocument.load(octets, { ignoreEncryption: true });
    if (src.getPageCount() > 2) {
      const court = await PDFDocument.create();
      (await court.copyPages(src, [0, 1])).forEach((pg) => court.addPage(pg));
      octets = await court.save();
    }
  } catch { /* PDF spécial : on l'envoie tel quel */ }

  // 4. Jarvis lit et décide
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("JARVIS_TRI_MODEL") ?? "claude-haiku-5-5",
      max_tokens: 1200,
      system: CONSIGNE,
      tools: [OUTIL],
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: encodeBase64(octets) } },
          { type: "text", text: `Nom du fichier : ${nom}. Range ce papier.` },
        ],
      }],
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.error("claude", r.status, t.slice(0, 500));
    await efface();
    return json({ error: "claude", status: r.status, detail: t.slice(0, 300) }, 502);
  }
  const rep = await r.json();
  type Choix = { refus: string | null; lieu: string; titre: string; sous_titre: string };
  let choix = (rep.content ?? []).find((c: { type: string }) => c.type === "tool_use")?.input as Choix | undefined;
  if (!choix) { // au cas où il répond en texte : on cherche le JSON dedans
    const txt = (rep.content ?? []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
    try { const m = txt.match(/\{[\s\S]*\}/); if (m) choix = JSON.parse(m[0]); } catch { /* rien */ }
  }
  if (!choix) { await efface(); return json({ error: "illisible" }, 502); }

  // 5. Refusé : on l'efface tout de suite
  if (choix.refus) { await efface(); return json({ refus: choix.refus }); }

  // 6. Rangé : on le déplace au bon lieu et on le relie
  const lieu = LIEUX[choix.lieu] ? choix.lieu : "mairie";
  const dest = `mac/${lieu}/${nom}`;
  await admin.storage.from("papiers").remove([dest]);
  const { error: eMv } = await admin.storage.from("papiers").move(path, dest);
  if (eMv) { await efface(); return json({ error: "deplacement", detail: eMv.message }, 500); }
  const titre = (choix.titre || nom.replace(/\.pdf$/i, "")).slice(0, 60);
  const sous = (choix.sous_titre || "").slice(0, 70) || null;
  const { error: eAt } = await sb.rpc("jarvis_attach_doc", { p_lieu: lieu, p_t: titre, p_d: sous, p_path: dest });
  if (eAt) return json({ error: "relier", detail: eAt.message }, 500);
  return json({ lieu, titre, sous });
});
