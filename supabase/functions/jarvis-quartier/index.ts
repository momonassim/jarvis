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
// Grand Lyon : les arbres d'alignement réels
const GL = "https://data.grandlyon.com/geoserver/metropole-de-lyon/ows?SERVICE=WFS&VERSION=1.0.0&request=GetFeature&outputFormat=application/json&srsName=EPSG:4326&maxFeatures=20000";
async function coucheGL(nom: string, la: number, lo: number, r: number) {
  const dla = r / 110574, dlo = r / (111320 * Math.cos(la * Math.PI / 180));
  const rep = await fetch(`${GL}&typename=metropole-de-lyon:${nom}&bbox=${lo - dlo},${la - dla},${lo + dlo},${la + dla},EPSG:4326`, { signal: AbortSignal.timeout(60000) });
  if (!rep.ok) throw new Error(`Grand Lyon ${nom} : HTTP ${rep.status}`);
  return (await rep.json()).features ?? [];
}
function centroide(p: number[][]) { let x = 0, y = 0; for (const q of p) { x += q[0]; y += q[1]; } return [x / p.length, y / p.length]; }
function dansPoly(x: number, y: number, p: number[][]) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }

// distance d'un point à un segment
function distSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy; let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
}
// petite grille pour chercher vite ce qui est autour d'un point
function grilleDe<T>(taille: number) {
  const m = new Map<string, T[]>();
  return {
    mettre(minx: number, miny: number, maxx: number, maxy: number, o: T) { for (let gx = Math.floor(minx / taille); gx <= Math.floor(maxx / taille); gx++) for (let gy = Math.floor(miny / taille); gy <= Math.floor(maxy / taille); gy++) { const k = gx + "|" + gy; (m.get(k) ?? m.set(k, []).get(k)!).push(o); } },
    autour(x: number, y: number, r: number) { const s = new Set<T>(); for (let gx = Math.floor((x - r) / taille); gx <= Math.floor((x + r) / taille); gx++) for (let gy = Math.floor((y - r) / taille); gy <= Math.floor((y + r) / taille); gy++) for (const o of m.get(gx + "|" + gy) ?? []) s.add(o); return [...s]; },
  };
}
function boite(p: number[][]) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const [x, y] of p) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return [a, b, c, d]; }
function aleat(graine: number) { let s = graine >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

async function construire() {
  const g = JSON.parse((await secret("LIEUX_GPS")) || "{}"); const m = g.maison; if (!m) throw new Error("maison absente");
  const la0 = m.lat, lo0 = m.lon, kx = Math.cos(la0 * Math.PI / 180) * 111320, ky = 110574;
  const pt = (p: number[]) => [Math.round((p[0] - lo0) * kx * 10) / 10, Math.round((p[1] - la0) * ky * 10) / 10];
  const dedans = (pts: number[][]) => pts.some(([x, y]) => x * x + y * y < (R + 60) ** 2);
  // Tout vient de la même carte (IGN BD TOPO) pour que bâtiments, routes et verdure tombent pile les uns sur les autres.
  // Seuls les arbres viennent du Grand Lyon (positions GPS mesurées), et on les écarte des murs et des chaussées.
  const [bat, rou, veg, arb] = await Promise.all([couche("BDTOPO_V3:batiment", la0, lo0, R), couche("BDTOPO_V3:troncon_de_route", la0, lo0, R + 100), couche("BDTOPO_V3:zone_de_vegetation", la0, lo0, R).catch(() => []),
    coucheGL("abr_arbres_alignement.abrarbre", la0, lo0, R).catch(() => [])]);
  const aire = (p: number[][]) => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(s / 2); };
  // 1) bâtiments : la forme au sol, la hauteur des murs (gouttière) et celle du haut du toit
  let ign: any[] = [];
  for (const f of bat) for (const a of anneaux(f.geometry)) {
    const pts = a.map(pt); if (pts.length < 4 || !dedans(pts)) continue;
    const p = f.properties ?? {};
    const sol = Number(p.altitude_minimale_sol);
    let h = Number(p.hauteur) || (Number(p.nombre_d_etages) ? Number(p.nombre_d_etages) * 3 : 0) || (p.construction_legere ? 3 : 7);
    let haut = Number(p.altitude_maximale_toit) - sol, bas = Number(p.altitude_minimale_toit) - sol;
    if (!(bas > 1 && bas < h + 4)) bas = h;
    const murs = Math.max(2.5, Math.min(h, bas));
    const [x0, y0, x1, y1] = boite(pts); const etroit = Math.min(x1 - x0, y1 - y0);
    if (!(haut > murs)) haut = murs;
    haut = Math.min(haut, murs + Math.max(0, etroit * 0.45), murs + 9);             // un toit ne peut pas être plus haut que ce que permet sa largeur
    ign.push({ h: Math.round(murs * 10) / 10, t: Math.round(haut * 10) / 10, u: p.usage_1 ?? "", pts, aire: aire(pts), bx: [x0, y0, x1, y1] });
  }
  // un petit bâtiment posé à l'intérieur d'un plus grand (annexe, doublon) : on ne garde que le grand
  ign.sort((a, b) => b.aire - a.aire);
  const gb = grilleDe<any>(40), gardes: any[] = [];
  for (const b of ign) {
    const [cx, cy] = centroide(b.pts);
    const dans = gb.autour(cx, cy, 1).some((o: any) => dansPoly(cx, cy, o.pts) && b.pts.filter(([x, y]: number[]) => dansPoly(x, y, o.pts)).length >= b.pts.length * 0.6);
    if (dans) continue;
    gardes.push(b); gb.mettre(b.bx[0], b.bx[1], b.bx[2], b.bx[3], b);
  }
  ign = gardes;
  const distMur = (x: number, y: number, r: number) => {   // distance au mur le plus proche (négative si on est dedans)
    let d = 1e9;
    for (const b of gb.autour(x, y, r)) { if (dansPoly(x, y, b.pts)) return -1; for (let i = 0; i < b.pts.length - 1; i++) d = Math.min(d, distSeg(x, y, b.pts[i][0], b.pts[i][1], b.pts[i + 1][0], b.pts[i + 1][1])); }
    return d;
  };
  // 2) routes
  const routes: any[] = []; const gr = grilleDe<any>(30);
  for (const f of rou) {
    const p = f.properties ?? {}; if (p.fictif || p.position_par_rapport_au_sol && Number(p.position_par_rapport_au_sol) < 0) continue;
    const nat = String(p.nature ?? "");
    if (/Sentier|Escalier|Bac|Piste cyclable/i.test(nat)) continue;
    const w = Math.max(3, Math.min(16, Number(p.largeur_de_chaussee) || (/Chemin|Route empierrée/i.test(nat) ? 3 : Number(p.importance) <= 3 ? 9 : 6)));
    for (const l of anneaux(f.geometry)) { const pts = l.map(pt); if (!dedans(pts)) continue;
      // une « route » qui traverse des bâtiments n'est pas une vraie rue visible (tracé simplifié, passage souterrain…) : on l'enlève
      let n = 0, dans = 0;
      for (let i = 0; i < pts.length - 1; i++) { const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); for (let s = 0; s < L; s += 3) { const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * s / L, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * s / L; if (x * x + y * y > (R + 60) ** 2) continue; n++; if (distMur(x, y, 1) < 0) dans++; } }
      if (n && dans / n > 0.08) continue;
      const r = { w, i: Number(p.importance) || 5, n: p.nom_collaboratif_gauche || p.nom_collaboratif_droite || "", pts }; routes.push(r);
      for (let i = 0; i < pts.length - 1; i++) gr.mettre(Math.min(pts[i][0], pts[i + 1][0]) - 8, Math.min(pts[i][1], pts[i + 1][1]) - 8, Math.max(pts[i][0], pts[i + 1][0]) + 8, Math.max(pts[i][1], pts[i + 1][1]) + 8, r); }
  }
  const surRoute = (x: number, y: number, marge: number) => gr.autour(x, y, 1).some((r: any) => { for (let i = 0; i < r.pts.length - 1; i++) if (distSeg(x, y, r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1]) < r.w / 2 + marge) return true; return false; });
  // 3) arbres : les vrais (Grand Lyon), jamais dans un mur ni sur la chaussée ; la couronne s'arrête avant la façade
  const arbres: number[][] = []; const ga = grilleDe<number[]>(10);
  const libre = (x: number, y: number, r: number) => ga.autour(x, y, r + 4).every(([ax, ay, , ar]) => Math.hypot(ax - x, ay - y) >= (r + ar) * 0.8);
  for (const f of arb) {
    const c = f.geometry?.coordinates; if (!c) continue; const [x, y] = pt(c); if (x * x + y * y > R * R) continue; const p = f.properties ?? {};
    let r = Number(p.rayoncouronne_m) || 2.5; const h = Number(p.hauteurtotale_m) || 8;
    const dm = distMur(x, y, r + 2); if (dm < 0) continue; r = Math.min(r, dm - 0.3); if (r < 1) continue;
    if (surRoute(x, y, -0.5)) continue;
    if (!libre(x, y, r)) continue;
    const a = [x, y, Math.round(h * 10) / 10, Math.round(r * 10) / 10]; arbres.push(a); ga.mettre(x, y, x, y, a);
  }
  // 4) verdure (IGN) + quelques arbres dedans pour l'ambiance, placés proprement (toujours les mêmes, pas au hasard à chaque ouverture)
  const verdure: any[] = []; const rnd = aleat(4916);
  for (const f of veg) for (const a of anneaux(f.geometry)) {
    const pts = a.map(pt); if (pts.length < 4 || !dedans(pts)) continue; verdure.push({ t: f.properties?.nature ?? "", p: pts.flat() });
    const [x0, y0, x1, y1] = boite(pts); const n = Math.min(60, Math.floor((x1 - x0) * (y1 - y0) / 260));
    for (let k = 0; k < n * 3 && arbres.length < 2000; k++) {
      const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0), r = 2.4 + rnd() * 1.1, h = 6.5 + rnd() * 4;
      if (x * x + y * y > R * R || !dansPoly(x, y, pts)) continue;
      if (distMur(x, y, r + 2) < r + 0.5) continue;
      if (surRoute(x, y, r * 0.6)) continue;
      if (!libre(x, y, r)) continue;
      const t = [Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(h * 10) / 10, Math.round(r * 10) / 10]; arbres.push(t); ga.mettre(x, y, x, y, t);
    }
  }
  const batiments = ign.map(b => ({ h: b.h, t: b.t, u: b.u, p: b.pts.flat() }));
  return { centre: { lat: la0, lon: lo0 }, rayon: R, fait_le: new Date().toISOString(), version: 4, batiments, routes: routes.map(r => ({ w: r.w, i: r.i, n: r.n, p: r.pts.flat() })), verdure, arbres };
}
// aperçu : seulement ce qui touche un petit cercle (pour vérifier sans tout télécharger)
function apercu(q: any, r: number) {
  const pres = (f: number[]) => { for (let i = 0; i < f.length; i += 2) if (f[i] * f[i] + f[i + 1] * f[i + 1] < r * r) return true; return false; };
  return { ...q, rayon: r, batiments: q.batiments.filter((b: any) => pres(b.p)), routes: q.routes.filter((b: any) => pres(b.p)), verdure: q.verdure.filter((b: any) => pres(b.p)), arbres: q.arbres.filter(([x, y]: number[]) => x * x + y * y < r * r) };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await autorise(req))) return json({ erreur: "non autorisé" }, 401);
  const b = await req.json().catch(() => ({}));
  const CHEMIN = "cache/quartier-maison.json";
  const r = Number(b.apercu) || 0;
  if (!b.refaire) {
    const { data } = await admin.storage.from("papiers").download(CHEMIN);
    if (data) { const t = await data.text(); try { const j = JSON.parse(t); if (j.version === 4 && Date.now() - new Date(j.fait_le).getTime() < 7 * 864e5) return r ? json(apercu(j, r)) : new Response(t, { headers: { ...CORS, "Content-Type": "application/json" } }); } catch (_) { /* on refait */ } }
  }
  try {
    const q = await construire();
    const t = JSON.stringify(q);
    await admin.storage.from("papiers").upload(CHEMIN, new Blob([t], { type: "application/json" }), { upsert: true });
    if (r) return json(apercu(q, r));
    return new Response(t, { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) { return json({ erreur: String(e instanceof Error ? e.message : e) }, 502); }
});
