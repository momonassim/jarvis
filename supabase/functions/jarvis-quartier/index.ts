// Jarvis — fonction « jarvis-quartier » : le vrai quartier autour de chez lui, en données officielles IGN (BD TOPO),
// réduit à l'essentiel pour la carte 3D : bâtiments (avec leur vraie hauteur), routes (avec leur largeur), verdure.
// Coordonnées en mètres autour de la maison (x vers l'est, y vers le nord). Gardé en cache 7 jours dans le coffre.
import { createClient } from "jsr:@supabase/supabase-js@2";
const URL_SB = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
async function secret(nom: string) { const { data } = await admin.rpc("jarvis_get_secret", { p_name: nom }); return typeof data === "string" ? data : ""; }
async function autorise(req: Request) {
  const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, ""); if (!t) return false;
  if (t === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const c = await secret("CRON_TOKEN"); if (c && t === c) return true;
  const sb = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: "Bearer " + t } } });
  const { data } = await sb.rpc("jarvis_is_owner"); return data === true;
}
const R = 700; // rayon gardé autour de la maison, en mètres
const IGN = "https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&outputFormat=application/json&srsName=EPSG:4326&count=8000";
async function couche(nom: string, la: number, lo: number, r: number) {
  const dla = r / 110574, dlo = r / (111320 * Math.cos(la * Math.PI / 180));
  const u = `${IGN}&TYPENAMES=${nom}&BBOX=${la - dla},${lo - dlo},${la + dla},${lo + dlo},urn:ogc:def:crs:EPSG::4326`;
  const rep = await fetch(u, { signal: AbortSignal.timeout(60000) });
  if (!rep.ok) throw new Error(`IGN ${nom} : HTTP ${rep.status}`);
  return (await rep.json()).features ?? [];
}
function anneaux(g: any): number[][][] {
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates[0]];
  if (g.type === "MultiPolygon") return g.coordinates.map((p: any) => p[0]);
  if (g.type === "LineString") return [g.coordinates];
  if (g.type === "MultiLineString") return g.coordinates;
  return [];
}
async function construire() {
  const g = JSON.parse((await secret("LIEUX_GPS")) || "{}"); const m = g.maison; if (!m) throw new Error("maison absente");
  const la0 = m.lat, lo0 = m.lon, kx = Math.cos(la0 * Math.PI / 180) * 111320, ky = 110574;
  const pt = (p: number[]) => [Math.round((p[0] - lo0) * kx * 10) / 10, Math.round((p[1] - la0) * ky * 10) / 10];
  const dedans = (pts: number[][]) => pts.some(([x, y]) => x * x + y * y < (R + 60) ** 2);
  const [bat, rou, veg] = await Promise.all([couche("BDTOPO_V3:batiment", la0, lo0, R), couche("BDTOPO_V3:troncon_de_route", la0, lo0, R + 100), couche("BDTOPO_V3:zone_de_vegetation", la0, lo0, R).catch(() => [])]);
  const batiments: any[] = [];
  for (const f of bat) for (const a of anneaux(f.geometry)) {
    const pts = a.map(pt); if (!dedans(pts)) continue;
    const p = f.properties ?? {};
    const h = Number(p.hauteur) || (Number(p.nombre_d_etages) ? Number(p.nombre_d_etages) * 3 : 0) || (p.construction_legere ? 3 : 7);
    batiments.push({ h: Math.round(h * 10) / 10, u: p.usage_1 ?? "", e: p.nombre_d_etages ?? null, p: pts.flat() });
  }
  const routes: any[] = [];
  for (const f of rou) {
    const p = f.properties ?? {}; if (p.fictif || p.position_par_rapport_au_sol && Number(p.position_par_rapport_au_sol) < 0) continue;
    const nat = String(p.nature ?? "");
    if (/Sentier|Escalier|Bac|Piste cyclable/i.test(nat)) continue;
    const w = Number(p.largeur_de_chaussee) || (/Chemin|Route empierrée/i.test(nat) ? 3 : Number(p.importance) <= 3 ? 9 : 6);
    for (const l of anneaux(f.geometry)) { const pts = l.map(pt); if (!dedans(pts)) continue; routes.push({ w, i: Number(p.importance) || 5, n: p.nom_collaboratif_gauche || p.nom_collaboratif_droite || "", p: pts.flat() }); }
  }
  const verdure: any[] = [];
  for (const f of veg) for (const a of anneaux(f.geometry)) { const pts = a.map(pt); if (dedans(pts)) verdure.push({ t: f.properties?.nature ?? "", p: pts.flat() }); }
  return { centre: { lat: la0, lon: lo0 }, rayon: R, fait_le: new Date().toISOString(), batiments, routes, verdure };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await autorise(req))) return json({ erreur: "non autorisé" }, 401);
  const b = await req.json().catch(() => ({}));
  const CHEMIN = "cache/quartier-maison.json";
  if (!b.refaire) {
    const { data } = await admin.storage.from("papiers").download(CHEMIN);
    if (data) { const t = await data.text(); try { const j = JSON.parse(t); if (Date.now() - new Date(j.fait_le).getTime() < 7 * 864e5) return new Response(t, { headers: { ...CORS, "Content-Type": "application/json" } }); } catch (_) { /* on refait */ } }
  }
  try {
    const q = await construire();
    const t = JSON.stringify(q);
    await admin.storage.from("papiers").upload(CHEMIN, new Blob([t], { type: "application/json" }), { upsert: true });
    return new Response(t, { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) { return json({ erreur: String(e instanceof Error ? e.message : e) }, 502); }
});
