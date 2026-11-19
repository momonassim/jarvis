// Jarvis — fonction « jarvis-chat »
// Reçoit la conversation depuis l'app, vérifie que c'est bien le propriétaire, puis parle à l'API Claude.
// La clé API est dans les secrets Supabase (ANTHROPIC_API_KEY) : elle n'est jamais dans l'app.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "methode" }, 405);

  // 1. Qui appelle ? (la base seule sait qui est le propriétaire)
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: ok } = await sb.rpc("jarvis_is_owner");
  if (ok !== true) return json({ error: "interdit" }, 403);

  // 2. La clé Claude (rangée depuis les Réglages de l'app, sinon dans les secrets Supabase)
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: coffre } = await admin.rpc("jarvis_get_secret", { p_name: "ANTHROPIC_API_KEY" });
  const key = (typeof coffre === "string" && coffre) || Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "cle_absente" }, 503);

  // 3. La demande
  let body: { system?: string; messages?: { role: string; content: string }[] };
  try { body = await req.json(); } catch { return json({ error: "json" }, 400); }
  const messages = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
  // l'historique coupé aux 20 derniers peut commencer par une réponse de Jarvis : on la retire
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[0].role !== "user") return json({ error: "messages" }, 400);

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("JARVIS_MODEL") ?? "claude-sonnet-5-5",
      max_tokens: 700,
      stream: true,
      system: (body.system ?? "").slice(0, 60000),
      messages,
    }),
  });
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => "");
    return json({ error: "claude", status: r.status, detail: t.slice(0, 300) }, 502);
  }
  // 4. On renvoie la réponse au fil de l'eau
  return new Response(r.body, { headers: { ...CORS, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
});
