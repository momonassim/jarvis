// Jarvis — chercher dans tout ce que les robots ont ramené, et ranger une info dans un lieu.
import { LIEU_APP } from "./mails.ts";

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "note";
// Jamais d'IBAN ni de n° de sécu dans les réponses ou les notes
const masquer = (s: string) => s.replace(/\bFR\s?\d{2}(?:[\s.\-]?[0-9A-Z]{2,4}){4,8}/gi, "[IBAN masqué]")
  .replace(/\b[12]\s?\d{2}\s?(?:0[1-9]|1[0-2]|[2-9]\d)\s?(?:\d{2}|2[AB])\s?\d{3}\s?\d{3}\s?\d{2}\b/g, "[n° sécu masqué]");

export async function chercher(admin: any, a: Record<string, any>) {
  const mots = String(a.recherche ?? "").split(/[,;]|\s+/).map((m) => m.trim()).filter((m) => m.length > 1).slice(0, 6);
  if (!mots.length) return "Donne un ou plusieurs mots à chercher.";
  const { data, error } = await admin.rpc("jarvis_chercher", { p_mots: mots, p_limite: 12 });
  if (error) return "Recherche impossible : " + error.message;
  if (!data?.length) return `Rien trouvé pour « ${mots.join(" ")} » dans ce que les robots ont ramené. Essaie d'autres mots (ou un seul mot).`;
  return `Trouvé dans les données de Jarvis (${data.length} endroits) :\n` + data.map((r: any) =>
    `- [${r.source} · ${r.kind} · ${r.label}${r.contrat ? " · contrat " + r.contrat : ""}]\n  ${masquer(String(r.extrait ?? "")).replace(/\s+/g, " ").trim()}`).join("\n")
    + "\n\nSi c'est une info utile à garder (code, numéro, date…), range-la avec jarvis_noter.";
}

export async function noter(admin: any, a: Record<string, any>, lieuxValides: string[]) {
  if (!lieuxValides.includes(a.lieu)) return "Lieu inconnu. Choix : " + lieuxValides.join(", ");
  const titre = String(a.titre ?? "").trim().slice(0, 60); if (!titre) return "Donne un titre court (ex. « Code RIO mobile »).";
  const app = LIEU_APP[a.lieu], label = `${app}:${slug(titre)}`;
  if (a.supprimer === true) {
    await admin.from("jarvis_items").delete().eq("source", "jarvis").eq("kind", "note").eq("label", label);
    return `Note « ${titre} » retirée de Jarvis.`;
  }
  const texte = masquer(String(a.texte ?? "").trim()).slice(0, 300); if (!texte) return "Donne le contenu de la note.";
  const { error } = await admin.from("jarvis_items").upsert({ source: "jarvis", kind: "note", label, date: null, amount: null,
    data: { lieu: app, titre, texte, ajoute_le: new Date().toISOString() }, updated_at: new Date().toISOString() }, { onConflict: "source,kind,label,date_key" });
  if (error) return "Pas rangé : " + error.message;
  return `Rangé dans Jarvis (${a.lieu}) : « ${titre} : ${texte} ». Visible dans la fiche du lieu dans l'app.`;
}

export function notesDe(rows: any[], app: string) {
  return rows.filter((r) => r.source === "jarvis" && r.kind === "note" && r.data?.lieu === app).map((r) => `${r.data.titre} : ${r.data.texte}`);
}
