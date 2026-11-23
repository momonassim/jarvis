// Jarvis — fonction « jarvis-quartier » : le vrai quartier autour de chez lui, en données officielles IGN (BD TOPO),
// réduit à l'essentiel pour la carte 3D : bâtiments (avec leur vraie hauteur), routes (avec leur largeur), verdure.
// Coordonnées en mètres autour de la maison (x vers l'est, y vers le nord). Gardé en cache dans le coffre (refait seulement sur demande : « refaire »).
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
function pts2(f: number[]) { const o: number[][] = []; for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]); return o; }
function boite(p: number[][]) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const [x, y] of p) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return [a, b, c, d]; }
function aleat(graine: number) { let s = graine >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }


/* ================= DÉTAIL autour de la maison (rayon R2) =================
   - sol : chaussée / trottoir / bordure / verdure, au pas de C mètres, d'après le PCRS du Grand Lyon (bords de voirie
     relevés au centimètre) : on « remplit » la chaussée depuis l'axe de chaque rue, sans franchir une bordure,
     et sans s'éloigner de l'axe plus que la largeur officielle de la rue (+ 1,5 m).
   - toits : hauteur réelle mesurée par le LiDAR HD de l'IGN (MNH : hauteur au-dessus du sol), dans le contour IGN.
   - arbres : sommets de végétation du LiDAR (tous les arbres, y compris cours et jardins). */
const R2 = 200, C = 0.4, N = Math.round(2 * R2 / C);
async function mnhLidar(la0: number, lo0: number, kx: number, ky: number) {
  const n = Math.round(2 * R2 / 0.6), dla = R2 / ky, dlo = R2 / kx;
  const u = `https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.WGS84G&STYLES=normal&CRS=EPSG:4326&BBOX=${la0 - dla},${lo0 - dlo},${la0 + dla},${lo0 + dlo}&WIDTH=${n}&HEIGHT=${n}&FORMAT=image/x-bil;bits=32`;
  let dernier = "";
  for (let essai = 0; essai < 3; essai++) {
    try {
      const rep = await fetch(u, { signal: AbortSignal.timeout(60000) });
      const buf = await rep.arrayBuffer();
      if (!rep.ok || buf.byteLength !== n * n * 4) { dernier = `HTTP ${rep.status}, ${buf.byteLength} octets : ` + new TextDecoder().decode(buf.slice(0, 160)); continue; }
      const dv = new DataView(buf), le = new Float32Array(n * n), be = new Float32Array(n * n); let ok1 = 0, ok2 = 0;
      for (let i = 0; i < n * n; i++) { le[i] = dv.getFloat32(i * 4, true); be[i] = dv.getFloat32(i * 4, false); if (le[i] > -2 && le[i] < 150) ok1++; if (be[i] > -2 && be[i] < 150) ok2++; }
      const h = ok1 >= ok2 ? le : be;
      for (let i = 0; i < h.length; i++) if (!(h[i] > -2 && h[i] < 150)) h[i] = 0;
      return { n, pas: 2 * R2 / n, h, valides: Math.max(ok1, ok2) / (n * n) };
    } catch (e) { dernier = String(e); }
  }
  throw new Error("LiDAR : " + dernier);
}
function rle(cl: Uint8Array) {   // une ligne = suite de « lettre de classe + longueur »
  const L = "abcdz"; const lignes: string[] = [];
  for (let j = 0; j < N; j++) { let s = "", c = cl[j * N], n = 0; for (let i = 0; i < N; i++) { const v = cl[j * N + i]; if (v === c) n++; else { s += L[c === 9 ? 4 : c] + n; c = v; n = 1; } } s += L[c === 9 ? 4 : c] + n; lignes.push(s); }
  return lignes.join("|");
}
function detail(ign: any[], routesIgn: any[], pcrs: any[], troncons: any[], verdure: any[], mnh: any, distMur: (x: number, y: number, r: number) => number) {
  const cx = (x: number) => Math.floor((x + R2) / C), cy = (y: number) => Math.floor((R2 - y) / C);
  const dans = (i: number, j: number) => i >= 0 && j >= 0 && i < N && j < N;
  const barr = new Uint8Array(N * N), masque = new Uint8Array(N * N), cl = new Uint8Array(N * N);
  const tampon = (x1: number, y1: number, x2: number, y2: number, r: number, t: Uint8Array, v: number) => {
    const L = Math.hypot(x2 - x1, y2 - y1), pas = C / 3, k = Math.ceil(r / C);
    for (let s = 0; s <= L; s += pas) { const x = x1 + (x2 - x1) * (L ? s / L : 0), y = y1 + (y2 - y1) * (L ? s / L : 0), i0 = cx(x), j0 = cy(y);
      for (let dj = -k; dj <= k; dj++) for (let di = -k; di <= k; di++) { const i = i0 + di, j = j0 + dj; if (!dans(i, j)) continue; if (k && Math.hypot(di * C, dj * C) > r) continue; t[j * N + i] = v; } }
  };
  const remplir = (p: number[][], f: (k: number) => void) => {   // remplissage d'un polygone ligne par ligne
    let y0 = 1e9, y1 = -1e9; for (const q of p) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    for (let j = Math.max(0, cy(y1)); j <= Math.min(N - 1, cy(y0)); j++) {
      const y = R2 - (j + 0.5) * C, xs: number[] = [];
      for (let a = 0, b = p.length - 1; a < p.length; b = a++) { const [xa, ya] = p[a], [xb, yb] = p[b]; if ((ya > y) !== (yb > y)) xs.push(xa + (y - ya) * (xb - xa) / (yb - ya)); }
      xs.sort((u, v) => u - v);
      for (let m = 0; m + 1 < xs.length; m += 2) for (let i = Math.max(0, Math.ceil((xs[m] + R2) / C - 0.5)); i <= Math.min(N - 1, Math.floor((xs[m + 1] + R2) / C - 0.5)); i++) f(j * N + i);
    }
  };
  // barrières : bâtiments (1) et bords de voirie du PCRS (2)
  for (const b of ign) remplir(b.pts, (k) => { barr[k] = 1; });
  // (3 = petite boucle fermée : îlot, refuge, fosse d'arbre — elle arrête la chaussée mais ne « cache » pas l'axe de la rue)
  for (const l of pcrs) { let per = 0; for (let i = 0; i < l.length - 1; i++) per += Math.hypot(l[i + 1][0] - l[i][0], l[i + 1][1] - l[i][1]);
    const boucle = l.length > 3 && Math.hypot(l[0][0] - l[l.length - 1][0], l[0][1] - l[l.length - 1][1]) < 0.3 && per < 40;
    for (let i = 0; i < l.length - 1; i++) tampon(l[i][0], l[i][1], l[i + 1][0], l[i + 1][1], 0, barr, boucle ? 3 : 2); }
  // zone autorisée autour de chaque axe (largeur officielle + 2,5 m), et points de départ sur l'axe
  const graines: number[] = [];
  const axe = (pts: number[][], larg: number, marge: number) => {
    for (let i = 0; i < pts.length - 1; i++) {
      tampon(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], larg / 2 + marge, masque, 1);
      const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      for (let s = 0; s <= L; s += 1) { const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * s / L, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * s / L, a = cx(x), b = cy(y); if (dans(a, b)) graines.push(b * N + a); }
    }
  };
  // les largeurs officielles du Grand Lyon sont fiables (+1 m de tolérance) ; celles de l'IGN, à peine (+0,5 m)
  for (const t of troncons) axe(t.pts, t.w, 1);
  for (const r of routesIgn) axe(r.pts, r.w, 0.5);
  // remplissage de la chaussée (4 voisins : une bordure tracée en diagonale suffit à l'arrêter)
  const file = new Int32Array(N * N); let tete = 0, fin = 0;
  for (const g of graines) if (masque[g] && !barr[g] && cl[g] !== 1) { cl[g] = 1; file[fin++] = g; }
  while (tete < fin) { const k = file[tete++], i = k % N, j = (k / N) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (!dans(a, b)) continue; const q = b * N + a; if (cl[q] === 1 || barr[q] || !masque[q]) continue; cl[q] = 1; file[fin++] = q; } }
  // fuites : par une entrée de garage ou un passage, le remplissage peut passer derrière une bordure.
  // Chaque case de chaussée doit « voir » l'axe de rue le plus proche sans traverser de bordure, sinon c'est du trottoir.
  const src = new Int32Array(N * N).fill(-1); tete = 0; fin = 0;
  for (const g of graines) if (masque[g] && src[g] < 0) { src[g] = g; file[fin++] = g; }
  while (tete < fin) { const k = file[tete++], i = k % N, j = (k / N) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (!dans(a, b)) continue; const q = b * N + a; if (src[q] >= 0 || !masque[q]) continue; src[q] = src[k]; file[fin++] = q; } }
  for (let k = 0; k < N * N; k++) { if (cl[k] !== 1 || src[k] < 0) continue;
    let i0 = k % N, j0 = (k / N) | 0; const i1 = src[k] % N, j1 = (src[k] / N) | 0, di = Math.abs(i1 - i0), dj = -Math.abs(j1 - j0), si = i0 < i1 ? 1 : -1, sj = j0 < j1 ? 1 : -1; let e = di + dj, coupe = false;
    while (!(i0 === i1 && j0 === j1)) { const e2 = 2 * e; if (e2 >= dj) { e += dj; i0 += si; } if (e2 <= di) { e += di; j0 += sj; } if (barr[j0 * N + i0] === 2) { coupe = true; break; } }
    if (coupe) cl[k] = 0; }
  // bordures : les traits du PCRS qui touchent la chaussée ; verdure ; hors du disque : vide
  for (let k = 0; k < N * N; k++) if ((barr[k] === 2 || barr[k] === 3) && cl[k] !== 1) { const i = k % N, j = (k / N) | 0; if ((i > 0 && cl[k - 1] === 1) || (i < N - 1 && cl[k + 1] === 1) || (j > 0 && cl[k - N] === 1) || (j < N - 1 && cl[k + N] === 1)) cl[k] = 2; }
  for (const v of verdure) remplir(v.pts, (k) => { if (cl[k] === 0 && barr[k] !== 1) cl[k] = 3; });
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = -R2 + (i + 0.5) * C, y = R2 - (j + 0.5) * C; if (x * x + y * y > R2 * R2) cl[j * N + i] = 9; }
  // les bordures à dessiner en relief : les traits du PCRS qui longent vraiment une chaussée
  const bordures: number[][] = [];
  for (const l of pcrs) { let touche = 0, n = 0;
    for (let i = 0; i < l.length - 1; i++) { const L = Math.hypot(l[i + 1][0] - l[i][0], l[i + 1][1] - l[i][1]); for (let s = 0; s <= L; s += C) { const a = cx(l[i][0] + (l[i + 1][0] - l[i][0]) * (L ? s / L : 0)), b = cy(l[i][1] + (l[i + 1][1] - l[i][1]) * (L ? s / L : 0)); if (!dans(a, b)) continue; n++; if (cl[b * N + a] === 2) touche++; } }
    if (n && touche / n > 0.3 && l.some(([x, y]: number[]) => x * x + y * y < R2 * R2)) bordures.push(l.flat().map((v: number) => Math.round(v * 100) / 100)); }
  const sol = { r: R2, pas: C, n: N, lignes: rle(cl), bordures };
  if (!mnh) return { sol, toits: new Map(), arbres: null, retires: new Set() };
  // ---- LiDAR : hauteur au-dessus du sol en (x, y)
  const H = (x: number, y: number) => { const i = Math.floor((x + R2) / mnh.pas), j = Math.floor((R2 - y) / mnh.pas); return i >= 0 && j >= 0 && i < mnh.n && j < mnh.n ? mnh.h[j * mnh.n + i] : 0; };
  const med = (a: number[]) => { const b = [...a].sort((u, v) => u - v); return b[b.length >> 1]; };
  const toits = new Map<any, any>(), retires = new Set<any>();
  for (const b of ign) {
    if (!b.pts.every(([x, y]: number[]) => x * x + y * y < (R2 - 2) ** 2)) continue;
    const [minx, miny, maxx, maxy] = b.bx, x0 = Math.floor(minx), y0 = Math.floor(miny), W = Math.ceil(maxx) - x0, Hh = Math.ceil(maxy) - y0;
    if (W * Hh > 40000) continue;
    const z = new Float32Array(W * Hh).fill(NaN); const vals: number[] = [];
    const bord = (x: number, y: number) => { let d = 1e9; for (let i = 0; i < b.pts.length - 1; i++) d = Math.min(d, distSeg(x, y, b.pts[i][0], b.pts[i][1], b.pts[i + 1][0], b.pts[i + 1][1])); return d; };
    for (let v = 0; v < Hh; v++) for (let u = 0; u < W; u++) { const x = x0 + u + 0.5, y = y0 + v + 0.5; if (!dansPoly(x, y, b.pts) || bord(x, y) < 0.7) continue;
      const m = med([H(x - 0.25, y - 0.25), H(x + 0.25, y - 0.25), H(x - 0.25, y + 0.25), H(x + 0.25, y + 0.25)]); z[v * W + u] = m; vals.push(m); }
    if (vals.length < 3) continue;
    if (vals.length >= 10 && vals.filter(v => v < 1.5).length / vals.length > 0.85) { retires.add(b); continue; }   // le LiDAR ne voit plus rien : démoli
    // les bords (et les petits trous) prennent la hauteur du voisin intérieur le plus proche
    for (let pass = 0; pass < 12; pass++) { let reste = 0; const z2 = z.slice();
      for (let v = 0; v < Hh; v++) for (let u = 0; u < W; u++) { if (!isNaN(z[v * W + u])) continue; const nb: number[] = [];
        for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) { const a = u + du, c = v + dv; if (a >= 0 && c >= 0 && a < W && c < Hh && !isNaN(z[c * W + a])) nb.push(z[c * W + a]); }
        if (nb.length) z2[v * W + u] = Math.max(...nb); else reste++; }
      z.set(z2); if (!reste) break; }
    const mm = med(vals); for (let i = 0; i < z.length; i++) if (isNaN(z[i])) z[i] = mm;
    // lissage doux (médiane 3×3) pour enlever les antennes et le bruit du laser
    const zs = new Float32Array(z.length);
    for (let v = 0; v < Hh; v++) for (let u = 0; u < W; u++) { const nb: number[] = []; for (let dv = -1; dv <= 1; dv++) for (let du = -1; du <= 1; du++) { const a = u + du, c = v + dv; if (a >= 0 && c >= 0 && a < W && c < Hh) nb.push(z[c * W + a]); } zs[v * W + u] = Math.max(2.5, med(nb)); }
    const tri = [...vals].sort((u, v) => u - v);
    toits.set(b, { x0, y0, w: W, h: Hh, z: Array.from(zs, v => Math.round(v * 10)), bas: Math.max(2.5, tri[Math.floor(tri.length * 0.1)]), haut: tri[tri.length - 1] });
  }
  // ---- arbres : sommets de végétation hors bâtiments (au moins 4 m, une vraie couronne, 3 m entre deux sommets)
  const n = mnh.n, P = mnh.pas, hh = mnh.h, bat = new Uint8Array(n * n);
  for (const b of ign) { if (retires.has(b)) continue; let [minx, miny, maxx, maxy] = b.bx; minx -= 1; miny -= 1; maxx += 1; maxy += 1;
    for (let j = Math.max(0, Math.floor((R2 - maxy) / P)); j <= Math.min(n - 1, Math.floor((R2 - miny) / P)); j++) for (let i = Math.max(0, Math.floor((minx + R2) / P)); i <= Math.min(n - 1, Math.floor((maxx + R2) / P)); i++) {
      const x = -R2 + (i + 0.5) * P, y = R2 - (j + 0.5) * P; if (dansPoly(x, y, b.pts) || bord2(x, y, b.pts) < 1) bat[j * n + i] = 1; } }
  function bord2(x: number, y: number, p: number[][]) { let d = 1e9; for (let i = 0; i < p.length - 1; i++) d = Math.min(d, distSeg(x, y, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1])); return d; }
  const k4 = Math.round(2 / P), pics: number[][] = [];
  for (let j = k4; j < n - k4; j++) for (let i = k4; i < n - k4; i++) { const v = hh[j * n + i]; if (v < 4 || bat[j * n + i]) continue;
    let max = true, couronne = 0;
    for (let dj = -k4; dj <= k4 && max; dj++) for (let di = -k4; di <= k4; di++) { const w = hh[(j + dj) * n + i + di]; if (w > v || (w === v && (dj < 0 || (dj === 0 && di < 0)))) { max = false; break; } if (w >= v * 0.5 && !bat[(j + dj) * n + i + di]) couronne++; }
    if (!max || couronne < 10) continue;
    pics.push([i, j, v]); }
  pics.sort((a, b) => b[2] - a[2]);
  const arbres: number[][] = [];
  for (const [i, j, v] of pics) { const x = -R2 + (i + 0.5) * P, y = R2 - (j + 0.5) * P; if (x * x + y * y > (R2 - 3) ** 2) continue;
    if (arbres.some(([ax, ay]) => Math.hypot(ax - x, ay - y) < 3)) continue;
    let s = 0; for (let a = 0; a < 8; a++) { const dx = Math.cos(a * Math.PI / 4), dy = Math.sin(a * Math.PI / 4); let r = P; while (r < 8 && H(x + dx * r, y + dy * r) >= v * 0.45) r += P; s += r; }
    let r = Math.min(7, Math.max(1.2, s / 8)); const dm = distMur(x, y, r + 2); if (dm < 0) continue; r = Math.min(r, dm - 0.3); if (r < 1) continue;
    arbres.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(v * 10) / 10, Math.round(r * 10) / 10]); }
  return { sol, toits, arbres, retires };
}

async function construire(lieu = "maison") {
  const g = JSON.parse((await secret("LIEUX_GPS")) || "{}"); const m = g[lieu]; if (!m) throw new Error(lieu + " absent");
  const la0 = m.lat, lo0 = m.lon, kx = Math.cos(la0 * Math.PI / 180) * 111320, ky = 110574;
  const pt = (p: number[]) => [Math.round((p[0] - lo0) * kx * 10) / 10, Math.round((p[1] - la0) * ky * 10) / 10];
  const dedans = (pts: number[][]) => pts.some(([x, y]) => x * x + y * y < (R + 60) ** 2);
  // Tout vient de la même carte (IGN BD TOPO) pour que bâtiments, routes et verdure tombent pile les uns sur les autres.
  // Seuls les arbres viennent du Grand Lyon (positions GPS mesurées), et on les écarte des murs et des chaussées.
  const [bat, rou, veg, arb] = await Promise.all([couche("BDTOPO_V3:batiment", la0, lo0, R), couche("BDTOPO_V3:troncon_de_route", la0, lo0, R + 100), couche("BDTOPO_V3:zone_de_vegetation", la0, lo0, R).catch(() => []),
    coucheGL("abr_arbres_alignement.abrarbre", la0, lo0, R).catch(() => [])]);
  const info: any = {};
  const [pcrsF, tronF, mnh] = await Promise.all([
    coucheGL("pub_pcrs.limitevoiriepcrs", la0, lo0, R2 + 30).catch((e) => { info.pcrs = String(e); return []; }),
    coucheGL("pvo_patrimoine_voirie.pvochausseetrottoir", la0, lo0, R2 + 60).catch((e) => { info.troncons = String(e); return []; }),
    mnhLidar(la0, lo0, kx, ky).catch((e) => { info.lidar = String(e); return null; })]);
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
      let suite = 0, traverse = false;   // plus de 6 m d'affilée à l'intérieur d'un bâtiment
      for (let i = 0; i < pts.length - 1 && !traverse; i++) { const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); for (let s = 0; s < L; s += 2) { const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * s / L, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * s / L; if (x * x + y * y > (R + 60) ** 2) { suite = 0; continue; } if (distMur(x, y, 1) < 0) { if (++suite >= 4) { traverse = true; break; } } else suite = 0; } }
      if (traverse) continue;
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
  // ---- le détail autour de la maison
  const pcrs: number[][][] = []; for (const f of pcrsF) for (const l of anneaux(f.geometry)) { const p = l.map(pt); if (p.length > 1) pcrs.push(p); }
  const troncons: any[] = []; for (const f of tronF) { const p = f.properties ?? {}; const w = (Number(p.largeurchaussee) || 0) + (Number(p.largeurcouloirbus) || 0); if (w <= 0) continue; for (const l of anneaux(f.geometry)) troncons.push({ w, pts: l.map(pt) }); }
  const proche = (pts: number[][]) => pts.some(([x, y]) => x * x + y * y < (R2 + 30) ** 2);
  const d = detail(ign.filter(b => proche(b.pts)), routes.filter(r => proche(r.pts)), pcrs, troncons.filter(t => proche(t.pts)),
    verdure.map(v => ({ pts: pts2(v.p) })).filter(v => proche(v.pts)), mnh, distMur);
  info.pcrs ??= pcrs.length; info.troncons ??= troncons.length; info.lidar ??= mnh ? `ok (${Math.round(mnh.valides * 100)} % de mesures)` : "absent";
  info.toits_lidar = d.toits.size; info.demolis = d.retires.size; info.arbres_lidar = d.arbres ? d.arbres.length : 0;
  // dans le cercle détaillé, les arbres du LiDAR remplacent les autres
  const arbresFinal = d.arbres ? [...arbres.filter(([x, y]) => x * x + y * y > R2 * R2), ...d.arbres] : arbres;
  const batiments = ign.filter(b => !d.retires.has(b)).map(b => { const t = d.toits.get(b); return t ? { h: Math.round(t.bas * 10) / 10, t: Math.round(t.haut * 10) / 10, u: b.u, p: b.pts.flat(), l: { x0: t.x0, y0: t.y0, w: t.w, h: t.h, z: t.z } } : { h: b.h, t: b.t, u: b.u, p: b.pts.flat() }; });
  return { centre: { lat: la0, lon: lo0 }, rayon: R, fait_le: new Date().toISOString(), version: 5, info, batiments, routes: routes.map(r => ({ w: r.w, i: r.i, n: r.n, p: r.pts.flat() })), verdure, arbres: arbresFinal, sol: d.sol };
}
function couperSol(sol: any, r: number) {   // le sol, réduit au carré de côté 2r autour de la maison
  const k = Math.max(0, Math.floor((sol.r - r) / sol.pas)), m = sol.n - 2 * k;
  const lignes = sol.lignes.split("|").slice(k, k + m).map((l: string) => {
    const cells: string[] = []; for (const t of l.match(/[a-z]\d+/g) ?? []) { for (let i = 0; i < Number(t.slice(1)); i++) cells.push(t[0]); }
    const c = cells.slice(k, k + m); let out = "", cur = c[0], n = 0; for (const v of c) { if (v === cur) n++; else { out += cur + n; cur = v; n = 1; } } return out + cur + n; });
  const pres = (f: number[]) => { for (let i = 0; i < f.length; i += 2) if (Math.abs(f[i]) < r && Math.abs(f[i + 1]) < r) return true; return false; };
  return { r: (m * sol.pas) / 2, pas: sol.pas, n: m, lignes: lignes.join("|"), bordures: (sol.bordures || []).filter(pres) };
}
// aperçu : seulement ce qui touche un petit cercle (pour vérifier sans tout télécharger)
function apercu(q: any, r: number) {
  const pres = (f: number[]) => { for (let i = 0; i < f.length; i += 2) if (f[i] * f[i] + f[i + 1] * f[i + 1] < r * r) return true; return false; };
  return { ...q, rayon: r, batiments: q.batiments.filter((b: any) => pres(b.p)), routes: q.routes.filter((b: any) => pres(b.p)), verdure: q.verdure.filter((b: any) => pres(b.p)), arbres: q.arbres.filter(([x, y]: number[]) => x * x + y * y < r * r), sol: q.sol ? couperSol(q.sol, r) : null };
}
// les chantiers du Grand Lyon autour de la maison, en direct (pas de cache : ça change tous les jours)
function champ(r: Record<string, any>, ...motifs: RegExp[]) {
  for (const m of motifs) for (const [k, v] of Object.entries(r)) if (m.test(k) && v != null && String(v).trim()) return Array.isArray(v) ? v.join(", ") : String(v);
  return "";
}
async function chantiersAutour(lieu = "maison") {
  const g = JSON.parse((await secret("LIEUX_GPS")) || "{}"); const m = g[lieu]; if (!m) throw new Error(lieu + " absent");
  const la0 = m.lat, lo0 = m.lon, kx = Math.cos(la0 * Math.PI / 180) * 111320, ky = 110574;
  const pt = (p: number[]) => [Math.round((p[0] - lo0) * kx * 10) / 10, Math.round((p[1] - la0) * ky * 10) / 10];
  const fs = await coucheGL("pvo_patrimoine_voirie.pvochantierperturbant", la0, lo0, R);
  const td = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  const liste: any[] = [];
  for (const f of fs) {
    const p = f.properties ?? {};
    const fin = champ(p, /fin/i).slice(0, 10), debut = champ(p, /debut|début/i).slice(0, 10);
    if (fin && fin < td) continue;
    const gene = champ(p, /mesure|circulation|restriction|perturbation|impact/i);
    const l = anneaux(f.geometry).map(a => a.map(pt).flat()).filter(a => a.length >= 2);
    if (f.geometry?.type === "Point" || f.geometry?.type === "MultiPoint") { const c = f.geometry.type === "Point" ? [f.geometry.coordinates] : f.geometry.coordinates; for (const q of c) l.push(pt(q)); }
    if (!l.length) continue;
    liste.push({ nom: (champ(p, /^nom$/i, /libelle|intitule|objet|nature|titre/i) || "Chantier").slice(0, 80), gene: gene.slice(0, 80), debut, fin,
      fort: /interdit|altern|sens unique|ferm/i.test(gene), en_cours: !debut || debut <= td, l });
  }
  return { ok: true, centre: { lat: la0, lon: lo0 }, liste, cles: fs[0] ? Object.keys(fs[0].properties ?? {}) : [] };
}
// « Vivant » : ce qui bouge autour du lieu, en direct et sans clé — stations-service et leurs prix (flux de l'État),
// stations Vélo'v (vélos et places libres) et parkings (Grand Lyon). En mètres autour du lieu, comme le reste de la carte.
async function vivantAutour(lieu = "maison") {
  const g = JSON.parse((await secret("LIEUX_GPS")) || "{}"); const m = g[lieu]; if (!m) throw new Error(lieu + " absent");
  const la0 = m.lat, lo0 = m.lon, kx = Math.cos(la0 * Math.PI / 180) * 111320, ky = 110574;
  const pt = (lo: number, la: number) => [Math.round((lo - lo0) * kx * 10) / 10, Math.round((la - la0) * ky * 10) / 10];
  const ECO = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";
  const where = `within_distance(geom, geom'POINT(${lo0} ${la0})', 1.6km)`;
  const [carbu, velo, parcs] = await Promise.all([
    fetch(`${ECO}?limit=40&where=${encodeURIComponent(where)}`, { signal: AbortSignal.timeout(15000) }).then(r => r.ok ? r.json() : { results: [] }).catch(() => ({ results: [] })),
    coucheGL("jcd_jcdecaux.jcdvelov", la0, lo0, R).catch(() => []),
    coucheGL("pvo_patrimoine_voirie.pvoparking", la0, lo0, R).catch(() => []),
  ]);
  const frais = (d: any) => !d || Date.now() - new Date(d).getTime() < 7 * 864e5;
  const prix = (s: any, c: string) => { const v = Number(s[c + "_prix"]); return Number.isFinite(v) && v > 0 && frais(s[c + "_maj"]) ? Math.round(v * 1000) / 1000 : null; };
  const stations = (carbu.results ?? []).map((s: any) => { const geo = s.geom ?? { lat: Number(s.latitude) / 1e5, lon: Number(s.longitude) / 1e5 };
    return { nom: String(s.adresse ?? "Station").slice(0, 60), ville: s.ville ?? "", xy: pt(geo.lon, geo.lat), gazole: prix(s, "gazole"), sp95: prix(s, "sp95"), e10: prix(s, "e10"), sp98: prix(s, "sp98"), auto: s.horaires_automate_24_24 === "Oui" }; })
    .filter((s: any) => s.gazole || s.sp95 || s.e10 || s.sp98);
  const velov = velo.map((f: any) => { const p = f.properties ?? {}, c = f.geometry?.coordinates; if (!c) return null;
    return { nom: String(p.name ?? "").replace(/^\d+\s*-\s*/, "").slice(0, 50), xy: pt(c[0], c[1]), velos: Number(p.available_bikes) || 0, places: Number(p.available_bike_stands) || 0, ouvert: p.status === "OPEN" }; }).filter(Boolean);
  const parkings = parcs.map((f: any) => { const p = f.properties ?? {}, c = f.geometry?.coordinates; if (!c || f.geometry?.type !== "Point") return null; if ((Number(p.capacite) || 0) < 15) return null;
    return { nom: String(p.nom ?? "Parking").slice(0, 50), xy: pt(c[0], c[1]), places: Number(p.capacite) || 0, usage: p.usage ?? "", type: p.typeparking ?? "", sous_sol: /sous|souterrain|ouvrage/i.test(String(p.situation ?? "") + String(p.typeparking ?? "")) }; }).filter(Boolean);
  return { ok: true, lu_le: new Date().toISOString(), stations, velov, parkings };
}
// TomTom : le trafic en direct autour du lieu (bouchons, accidents, routes fermées), avec la clé rangée dans les Réglages.
// On ne garde que l'info utile, en mètres autour du lieu : la carte fait le reste (couleur sur la rue, voitures qui ralentissent).
const CAT: Record<number, string> = { 1: "Accident", 2: "Brouillard", 3: "Conditions dangereuses", 4: "Pluie", 5: "Verglas", 6: "Bouchon", 7: "Voie fermée", 8: "Route fermée", 9: "Travaux", 10: "Vent", 11: "Inondation", 14: "Véhicule en panne" };
async function traficAutour(lieu = "maison") {
  const cle = await secret("TOMTOM_KEY"); if (!cle) return { ok: false, cle: false };
  const g = JSON.parse((await secret("LIEUX_GPS")) || "{}"); const m = g[lieu]; if (!m) throw new Error(lieu + " absent");
  const la0 = m.lat, lo0 = m.lon, kx = Math.cos(la0 * Math.PI / 180) * 111320, ky = 110574, r = 900;
  const dla = r / ky, dlo = r / kx;
  const champs = "{incidents{type,geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description},startTime,endTime,from,to,length,delay,roadNumbers}}}";
  const u = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${encodeURIComponent(cle)}&bbox=${lo0 - dlo},${la0 - dla},${lo0 + dlo},${la0 + dla}&fields=${encodeURIComponent(champs)}&language=fr-FR&timeValidityFilter=present`;
  const rep = await fetch(u, { signal: AbortSignal.timeout(20000) });
  if (!rep.ok) return { ok: false, cle: true, erreur: "TomTom HTTP " + rep.status };
  const j = await rep.json();
  const pt = (c: number[]) => [Math.round((c[0] - lo0) * kx * 10) / 10, Math.round((c[1] - la0) * ky * 10) / 10];
  const liste = (j.incidents ?? []).map((f: any) => { const p = f.properties ?? {}, g2 = f.geometry ?? {};
    const l = g2.type === "LineString" ? g2.coordinates.map(pt).flat() : g2.type === "Point" ? pt(g2.coordinates) : [];
    return { type: CAT[p.iconCategory] ?? "Incident", cat: p.iconCategory ?? 0, gravite: p.magnitudeOfDelay ?? 0, retard: Math.round(p.delay ?? 0), longueur: Math.round(p.length ?? 0),
      de: p.from ?? "", vers: p.to ?? "", routes: p.roadNumbers ?? [], texte: (p.events ?? []).map((e: any) => e.description).filter(Boolean).join(" · ").slice(0, 120), fin: p.endTime ?? null, l };
  }).filter((x: any) => x.l.length >= 2);
  return { ok: true, cle: true, lu_le: new Date().toISOString(), liste };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await autorise(req))) return json({ erreur: "non autorisé" }, 401);
  const b = await req.json().catch(() => ({}));
  const lieu = b.lieu === "usine" ? "usine" : "maison";   // chez toi, ou ton travail
  if (b.quoi === "vivant") { try { return json(await vivantAutour(lieu)); } catch (e) { return json({ ok: false, erreur: String(e instanceof Error ? e.message : e) }, 502); } }
  if (b.quoi === "trafic") { try { return json(await traficAutour(lieu)); } catch (e) { return json({ ok: false, erreur: String(e instanceof Error ? e.message : e) }, 502); } }
  if (b.quoi === "chantiers") { try { return json(await chantiersAutour(lieu)); } catch (e) { return json({ ok: false, erreur: String(e instanceof Error ? e.message : e) }, 502); } }
  const CHEMIN = `cache/quartier-${lieu}.json`;
  const r = Number(b.apercu) || 0;
  if (!b.refaire) {
    const { data } = await admin.storage.from("papiers").download(CHEMIN);
    if (data) { const t = await data.text(); try { const j = JSON.parse(t); if (j.version === 5) return r ? json(apercu(j, r)) : new Response(t, { headers: { ...CORS, "Content-Type": "application/json" } }); } catch (_) { /* on refait */ } }
  }
  try {
    const q = { ...(await construire(lieu)), lieu };
    const t = JSON.stringify(q);
    await admin.storage.from("papiers").upload(CHEMIN, new Blob([t], { type: "application/json" }), { upsert: true });
    if (r) return json(apercu(q, r));
    return new Response(t, { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) { return json({ erreur: String(e instanceof Error ? e.message : e) }, 502); }
});
