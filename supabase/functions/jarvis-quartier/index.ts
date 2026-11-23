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
// Grand Lyon : les toits au vrai contour, chacun avec sa hauteur (façade et faîtage), les arbres d'alignement réels, les bordures de trottoir
const GL = "https://data.grandlyon.com/geoserver/metropole-de-lyon/ows?SERVICE=WFS&VERSION=1.0.0&request=GetFeature&outputFormat=application/json&srsName=EPSG:4326&maxFeatures=20000";
async function coucheGL(nom: string, la: number, lo: number, r: number) {
  const dla = r / 110574, dlo = r / (111320 * Math.cos(la * Math.PI / 180));
  const rep = await fetch(`${GL}&typename=metropole-de-lyon:${nom}&bbox=${lo - dlo},${la - dla},${lo + dlo},${la + dla},EPSG:4326`, { signal: AbortSignal.timeout(60000) });
  if (!rep.ok) throw new Error(`Grand Lyon ${nom} : HTTP ${rep.status}`);
  return (await rep.json()).features ?? [];
}
function centroide(p: number[][]) { let x = 0, y = 0; for (const q of p) { x += q[0]; y += q[1]; } return [x / p.length, y / p.length]; }
function dansPoly(x: number, y: number, p: number[][]) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }

async function construire() {
  const g = JSON.parse((await secret("LIEUX_GPS")) || "{}"); const m = g.maison; if (!m) throw new Error("maison absente");
  const la0 = m.lat, lo0 = m.lon, kx = Math.cos(la0 * Math.PI / 180) * 111320, ky = 110574;
  const pt = (p: number[]) => [Math.round((p[0] - lo0) * kx * 10) / 10, Math.round((p[1] - la0) * ky * 10) / 10];
  const dedans = (pts: number[][]) => pts.some(([x, y]) => x * x + y * y < (R + 60) ** 2);
  const [bat, rou, veg, toi, arb, bor] = await Promise.all([couche("BDTOPO_V3:batiment", la0, lo0, R), couche("BDTOPO_V3:troncon_de_route", la0, lo0, R + 100), couche("BDTOPO_V3:zone_de_vegetation", la0, lo0, R).catch(() => []),
    coucheGL("fpc_fond_plan_communaut.fpctoit", la0, lo0, R).catch(() => []), coucheGL("abr_arbres_alignement.abrarbre", la0, lo0, R).catch(() => []), coucheGL("fpc_fond_plan_communaut.fpcbordchaussee", la0, lo0, R).catch(() => [])]);
  // 1) les bâtiments IGN (les plus à jour) : forme et hauteur de référence
  const aire = (p: number[][]) => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(s / 2); };
  const ign: any[] = [];
  for (const f of bat) for (const a of anneaux(f.geometry)) {
    const pts = a.map(pt); if (!dedans(pts)) continue;
    const p = f.properties ?? {};
    const h = Number(p.hauteur) || (Number(p.nombre_d_etages) ? Number(p.nombre_d_etages) * 3 : 0) || (p.construction_legere ? 3 : 7);
    ign.push({ h: Math.round(h * 10) / 10, u: p.usage_1 ?? "", e: p.nombre_d_etages ?? null, pts, aire: aire(pts), toits: [] as any[], couvert: 0 });
  }
  const grille = new Map<string, any[]>(); const cle = (x: number, y: number) => `${Math.floor(x / 50)}|${Math.floor(y / 50)}`;
  for (const b of ign) { let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9; for (const [x, y] of b.pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
    for (let gx = Math.floor(minx / 50); gx <= Math.floor(maxx / 50); gx++) for (let gy = Math.floor(miny / 50); gy <= Math.floor(maxy / 50); gy++) { const k = `${gx}|${gy}`; (grille.get(k) ?? grille.set(k, []).get(k)!).push(b); } }
  // 2) les toits du Grand Lyon (plus détaillés : chaque morceau avec sa hauteur), gardés seulement s'ils collent au bâtiment IGN actuel
  //    (le Grand Lyon peut dater : une vieille maison démolie ne doit pas remplacer un immeuble récent)
  for (const f of toi) for (const a of anneaux(f.geometry)) {
    const pts = a.map(pt); if (pts.length < 3 || !dedans(pts)) continue;
    const p = f.properties ?? {}, ht = Number(p.htotale) || 0, hf = Number(p.hfacade) || ht; if (ht <= 0.5) continue;
    const [cx, cy] = centroide(pts);
    const b = (grille.get(cle(cx, cy)) ?? []).find((b: any) => dansPoly(cx, cy, b.pts)); if (!b) continue;   // démoli depuis
    if (ht < b.h * 0.55 || ht > b.h * 1.7 + 3) continue;                                                     // ne correspond plus
    b.toits.push({ hf: Math.round(hf * 10) / 10, ht: Math.round(ht * 10) / 10, t: ht - hf > 1 ? 1 : 0, p: pts.flat() }); b.couvert += aire(pts);
  }
  const toits: any[] = [], batiments: any[] = [];
  for (const b of ign) {
    if (b.toits.length && b.couvert >= b.aire * 0.7) toits.push(...b.toits);                                // détail du Grand Lyon
    else batiments.push({ h: b.h, u: b.u, e: b.e, p: b.pts.flat() });                                        // forme IGN
  }
  // 3) les vrais arbres d'alignement (hauteur et largeur de couronne mesurées)
  const arbres = arb.map((f: any) => { const c = f.geometry?.coordinates; if (!c) return null; const [x, y] = pt(c); if (x * x + y * y > R * R) return null; const p = f.properties ?? {};
    return [x, y, Math.round((Number(p.hauteurtotale_m) || 8) * 10) / 10, Math.round((Number(p.rayoncouronne_m) || 2.5) * 10) / 10]; }).filter(Boolean);
  // 4) les bordures de trottoir (le vrai dessin des rues)
  const bordures: any[] = [];
  for (const f of bor) for (const l of anneaux(f.geometry)) { const pts = l.map(pt); if (pts.length > 1 && dedans(pts)) bordures.push(pts.flat()); }
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
  return { centre: { lat: la0, lon: lo0 }, rayon: R, fait_le: new Date().toISOString(), version: 3, toits, batiments, routes, verdure, arbres, bordures };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await autorise(req))) return json({ erreur: "non autorisé" }, 401);
  const b = await req.json().catch(() => ({}));
  const CHEMIN = "cache/quartier-maison.json";
  if (!b.refaire) {
    const { data } = await admin.storage.from("papiers").download(CHEMIN);
    if (data) { const t = await data.text(); try { const j = JSON.parse(t); if (j.version === 3 && Date.now() - new Date(j.fait_le).getTime() < 7 * 864e5) return new Response(t, { headers: { ...CORS, "Content-Type": "application/json" } }); } catch (_) { /* on refait */ } }
  }
  try {
    const q = await construire();
    const t = JSON.stringify(q);
    await admin.storage.from("papiers").upload(CHEMIN, new Blob([t], { type: "application/json" }), { upsert: true });
    return new Response(t, { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) { return json({ erreur: String(e instanceof Error ? e.message : e) }, 502); }
});
