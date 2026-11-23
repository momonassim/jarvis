/* =========================================================
   Jarvis — ESSAI « carte réelle » (page à part, l'app n'est pas touchée).
   Le vrai quartier autour de chez lui (bâtiments et routes de l'IGN, avec leurs vraies
   hauteurs), dans le style maquette de sa ville, avec les vrais bus TCL en direct.
   ========================================================= */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const $ = id => document.getElementById(id);
const TEST = window.__JARVIS_TEST || null;
const LIEU = /[?&]lieu=usine/.test(location.search) ? "usine" : "maison";   // chez toi, ou ton travail (même carte, autre quartier)          // seulement pour les essais hors ligne

/* ---------- accès aux données (même connexion que l'app Jarvis) ---------- */
let fn;
if (TEST) fn = async (nom, body) => TEST[nom](body);
else {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient("https://uaprtibscyepsabyqcyl.supabase.co", "sb_publishable_qjJRK71zrG1ETae5SBY4Dg_ofD8oeYl", { auth: { persistSession: true, autoRefreshToken: true } });
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $("msg").textContent = "Ouvre d'abord Jarvis et connecte-toi, puis reviens ici."; throw new Error("pas connecté"); }
  fn = async (nom, body) => { const { data, error } = await sb.functions.invoke(nom, { body }); if (error) throw error; return data; };
}

/* ---------- la scène : même ambiance que la ville (crème, blanc, ombres douces) ---------- */
const FOND = 0xebe6dc;
const canvas = $("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !!TEST });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.background = new THREE.Color(FOND);
scene.fog = new THREE.Fog(FOND, 650, 1500);
const camera = new THREE.PerspectiveCamera(38, 1, 2, 5000);
camera.position.set(-260, 330, 380);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = 1.32; controls.minDistance = 40; controls.maxDistance = 1300;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
controls.screenSpacePanning = false;

scene.add(new THREE.HemisphereLight(0xfffbf2, 0xcfc6b6, 1.15));
const soleil = new THREE.DirectionalLight(0xfff1dc, 2.1);
soleil.position.set(-300, 420, 220); soleil.castShadow = true;
soleil.shadow.mapSize.set(matchMedia("(pointer:coarse)").matches ? 2048 : 4096, matchMedia("(pointer:coarse)").matches ? 2048 : 4096);
Object.assign(soleil.shadow.camera, { left: -720, right: 720, top: 720, bottom: -720, near: 50, far: 1600 });
soleil.shadow.bias = -0.0004; soleil.shadow.normalBias = 0.6;
scene.add(soleil);

const sol = new THREE.Mesh(new THREE.CircleGeometry(2400, 64), new THREE.MeshStandardMaterial({ color: 0xe9e3d7, roughness: 1 }));
sol.rotation.x = -Math.PI / 2; sol.receiveShadow = true; scene.add(sol);

// x = est, z = -nord (les données arrivent en mètres autour de la maison)
const V = (x, y) => new THREE.Vector2(x, y);   // après la rotation du sol, (x, y) tombe en (x, 0, -y), comme les routes
const pts = flat => { const a = []; for (let i = 0; i < flat.length; i += 2) a.push([flat[i], flat[i + 1]]); return a; };

/* ---------- construction du quartier ---------- */
function dansPoly(x, y, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }

function ruban(ligne, largeur, hauteur) {
  // un ruban plat le long d'une ligne + un disque à chaque coude (pas de trou entre les morceaux)
  const g = [];
  for (let i = 0; i < ligne.length - 1; i++) {
    const [x1, y1] = ligne[i], [x2, y2] = ligne[i + 1], dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy); if (L < 0.2) continue;
    const s = new THREE.PlaneGeometry(L, largeur); s.rotateX(-Math.PI / 2); s.rotateY(Math.atan2(dy, dx));   // dans le bon sens : (x, y) → (x, 0, -y)
    s.translate((x1 + x2) / 2, hauteur, -(y1 + y2) / 2); g.push(s);
  }
  for (const [x, y] of ligne) { const d = new THREE.CircleGeometry(largeur / 2, 12); d.rotateX(-Math.PI / 2); d.translate(x, hauteur, -y); g.push(d); }
  return g;
}

let maisonPoly = null, maisonH = 15, maisonCentre = null;
/* index des rues (pour recaler lignes, arrêts et bus pile sur la chaussée) */
const RUES = new Map(); const CR = 25;
function indexerRues(routes) {
  for (const r of routes) { const l = pts(r.p); for (let i = 0; i < l.length - 1; i++) { const sg = [l[i][0], l[i][1], l[i + 1][0], l[i + 1][1], r.w, r];
    for (let gx = Math.floor((Math.min(sg[0], sg[2]) - 5) / CR); gx <= Math.floor((Math.max(sg[0], sg[2]) + 5) / CR); gx++) for (let gy = Math.floor((Math.min(sg[1], sg[3]) - 5) / CR); gy <= Math.floor((Math.max(sg[1], sg[3]) + 5) / CR); gy++) { const k = gx + "|" + gy; (RUES.get(k) || RUES.set(k, []).get(k)).push(sg); } } }
}
// le point de chaussée le plus proche (à moins de « max » mètres), avec la direction de la rue
function surLaRue(x, y, max = 20) {
  let best = null, bd = max;
  for (let gx = Math.floor((x - max) / CR); gx <= Math.floor((x + max) / CR); gx++) for (let gy = Math.floor((y - max) / CR); gy <= Math.floor((y + max) / CR); gy++)
    for (const [x1, y1, x2, y2, w] of RUES.get(gx + "|" + gy) || []) {
      const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy; let t = L ? ((x - x1) * dx + (y - y1) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
      const px = x1 + t * dx, py = y1 + t * dy, d = Math.hypot(x - px, y - py);
      if (d < bd) { bd = d; best = { x: px, y: py, d, w, ang: Math.atan2(dy, dx) }; }
    }
  return best;
}
// ce point est-il sur la chaussée d'une AUTRE rue que « sauf » ? (pour ne pas tracer bordures et marquages à travers un carrefour)
function surAutreRue(x, y, sauf, marge = 0.2) {
  const gx = Math.floor(x / CR), gy = Math.floor(y / CR);
  for (const [x1, y1, x2, y2, w, r] of RUES.get(gx + "|" + gy) || []) { if (r === sauf || w < 4) continue;
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy; let t = L ? ((x - x1) * dx + (y - y1) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
    if (Math.hypot(x - x1 - t * dx, y - y1 - t * dy) < w / 2 - marge) return true; }
  return false;
}
// un bâtiment : des murs jusqu'à la gouttière, puis le toit posé exactement sur les murs (jamais plus large)
function etoile(p, cx, cy) {   // tout le contour est « visible » depuis le centre : on peut monter un toit en pyramide sans sortir des murs
  if (!dansPoly(cx, cy, p)) return false;
  let sg = 0; for (let i = 0; i < p.length - 1; i++) { const c = (p[i][0] - cx) * (p[i + 1][1] - cy) - (p[i][1] - cy) * (p[i + 1][0] - cx); if (Math.abs(c) < 1e-6) continue; const s = Math.sign(c); if (!sg) sg = s; else if (s !== sg) return false; }
  return true;
}
function batiment(p, h, t) {
  const sh = new THREE.Shape(p.map(([x, y]) => V(x, y)));
  const murs = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false }); murs.rotateX(-Math.PI / 2);
  const ni = g => g.index ? g.toNonIndexed() : g;
  const parts = [ni(murs)];
  const [cx, cy] = p.slice(0, -1).reduce((a, [x, y]) => [a[0] + x / (p.length - 1), a[1] + y / (p.length - 1)], [0, 0]);
  if (t > h + 0.6 && etoile(p, cx, cy)) {
    const k = 0.25, v = [];  // pans du toit : du haut du mur vers un petit plateau au-dessus du centre
    const q = p.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
    for (let i = 0; i < p.length - 1; i++) {
      const A = [p[i][0], h, -p[i][1]], B = [p[i + 1][0], h, -p[i + 1][1]], C = [q[i + 1][0], t, -q[i + 1][1]], D = [q[i][0], t, -q[i][1]];
      v.push(...A, ...B, ...C, ...A, ...C, ...D);
    }
    for (let i = 0; i < q.length - 1; i++) v.push(cx, t, -cy, q[i][0], t, -q[i][1], q[i + 1][0], t, -q[i + 1][1]);
    const r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    // les faces regardent vers l'extérieur / le haut, quel que soit le sens du contour
    const pos = r.attributes.position.array;
    for (let i = 0; i < pos.length; i += 9) { const ax = pos[i], ay = pos[i + 1], az = pos[i + 2], bx = pos[i + 3] - ax, by = pos[i + 4] - ay, bz = pos[i + 5] - az, cx2 = pos[i + 6] - ax, cy2 = pos[i + 7] - ay, cz = pos[i + 8] - az;
      const ny = bz * cx2 - bx * cz; if (ny < 0) for (let j = 0; j < 3; j++) { const tmp = pos[i + 3 + j]; pos[i + 3 + j] = pos[i + 6 + j]; pos[i + 6 + j] = tmp; } }
    r.computeVertexNormals(); r.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2));
    parts.push(r);
  } else if (t > h + 0.6) {
    // forme trop tordue pour une pyramide propre : toit plat à mi-hauteur du faîtage
    const m2 = new THREE.ExtrudeGeometry(sh, { depth: h + (t - h) * 0.5, bevelEnabled: false }); m2.rotateX(-Math.PI / 2); parts[0] = ni(m2);
  }
  return parts.length > 1 ? mergeGeometries(parts) : parts[0];
}

/* ---------- toit mesuré au laser (LiDAR HD), rangé en grands plateaux nets ----------
   Les mesures (une par m²) sont regroupées en zones de même hauteur (écart < 0,5 m entre voisins) :
   toit principal, attique, aile basse, cage d'ascenseur… Chaque zone devient un plateau plat à sa hauteur mesurée,
   avec une marche verticale entre deux plateaux. Résultat : la vraie silhouette, sans l'aspect « pâte fondue ». */
function batimentLidar(p, L) {
  const W = L.w, H = L.h, z = L.z, reg = new Int32Array(W * H).fill(-1), hauts = [];
  for (let k0 = 0; k0 < W * H; k0++) { if (reg[k0] >= 0) continue; const id = hauts.length, pile = [k0], vals = []; reg[k0] = id;
    while (pile.length) { const k = pile.pop(), u = k % W, v = (k / W) | 0; vals.push(z[k]);
      for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = u + du, b = v + dv; if (a < 0 || b < 0 || a >= W || b >= H) continue; const q = b * W + a; if (reg[q] >= 0 || Math.abs(z[q] - z[k]) > 5) continue; reg[q] = id; pile.push(q); } }
    vals.sort((x, y) => x - y); hauts.push({ h: vals[vals.length >> 1] / 10, n: vals.length }); }
  // les toutes petites zones (bruit, antenne) rejoignent leur voisine la plus proche en hauteur
  for (let pass = 0; pass < 3; pass++) for (let k = 0; k < W * H; k++) { const r = reg[k]; if (hauts[r].n >= 6) continue; const u = k % W, v = (k / W) | 0; let best = -1, bd = 1e9;
    for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = u + du, b = v + dv; if (a < 0 || b < 0 || a >= W || b >= H) continue; const r2 = reg[b * W + a]; if (r2 === r || hauts[r2].n < 6) continue; const d = Math.abs(hauts[r2].h - hauts[r].h); if (d < bd) { bd = d; best = r2; } }
    if (best >= 0) { reg[k] = best; hauts[best].n++; hauts[r].n--; } }
  const hCell = (a, b) => hauts[reg[Math.max(0, Math.min(H - 1, b)) * W + Math.max(0, Math.min(W - 1, a))]].h;
  const hAt = (x, y) => hCell(Math.floor(x - L.x0), Math.floor(y - L.y0));
  const poly = p.slice(0, -1), v = [];
  const clip = (pts, dedans, coupe) => { const o = []; for (let k = 0; k < pts.length; k++) { const A = pts[k], B = pts[(k + 1) % pts.length], ia = dedans(A), ib = dedans(B); if (ia) o.push(A); if (ia !== ib) o.push(coupe(A, B)); } return o; };
  const surX = (X) => (A, B) => [X, A[1] + (B[1] - A[1]) * (X - A[0]) / (B[0] - A[0])];
  const surY = (Y) => (A, B) => [A[0] + (B[0] - A[0]) * (Y - A[1]) / (B[1] - A[1]), Y];
  // un pan vertical de P à Q, tourné vers le point (vx, vy) : les faces regardent toujours vers l'extérieur (ombres propres)
  const quad = (P, Q, h1, h2, vx, vy) => {
    if (vx !== undefined) { const ex = Q[0] - P[0], ey = Q[1] - P[1], mx = (P[0] + Q[0]) / 2, my = (P[1] + Q[1]) / 2; if (ey * (vx - mx) - ex * (vy - my) < 0) { const t = P; P = Q; Q = t; } }
    v.push(P[0], h1, -P[1], Q[0], h1, -Q[1], Q[0], h2, -Q[1], P[0], h1, -P[1], Q[0], h2, -Q[1], P[0], h2, -P[1]); };
  // dessus : chaque case d'1 m découpée par le contour, posée à la hauteur de sa zone
  for (let b = 0; b < H; b++) for (let a = 0; a < W; a++) {
    const x0 = L.x0 + a, x1 = x0 + 1, y0 = L.y0 + b, y1 = y0 + 1;
    let q = clip(poly, P => P[0] >= x0, surX(x0)); if (q.length < 3) continue;
    q = clip(q, P => P[0] <= x1, surX(x1)); if (q.length < 3) continue;
    q = clip(q, P => P[1] >= y0, surY(y0)); if (q.length < 3) continue;
    q = clip(q, P => P[1] <= y1, surY(y1)); if (q.length < 3) continue;
    const h = hCell(a, b);
    for (const t of THREE.ShapeUtils.triangulateShape(q.map(([x, y]) => new THREE.Vector2(x, y)), [])) {
      const P3 = t.map(k => [q[k][0], h, -q[k][1]]); const ny = (P3[1][2] - P3[0][2]) * (P3[2][0] - P3[0][0]) - (P3[1][0] - P3[0][0]) * (P3[2][2] - P3[0][2]);
      if (ny < 0) P3.reverse(); for (const w of P3) v.push(...w); }
  }
  // marches entre deux plateaux, seulement à l'intérieur du contour
  const morceauxDedans = (A, B) => {   // le segment AB découpé par le contour : on garde les bouts à l'intérieur
    const ts = [0, 1];
    for (let k = 0; k < poly.length; k++) { const C = poly[k], D = poly[(k + 1) % poly.length], r = [B[0] - A[0], B[1] - A[1]], s2 = [D[0] - C[0], D[1] - C[1]], den = r[0] * s2[1] - r[1] * s2[0]; if (Math.abs(den) < 1e-9) continue;
      const t = ((C[0] - A[0]) * s2[1] - (C[1] - A[1]) * s2[0]) / den, u = ((C[0] - A[0]) * r[1] - (C[1] - A[1]) * r[0]) / den; if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t); }
    ts.sort((x, y) => x - y); const o = [];
    for (let m = 0; m + 1 < ts.length; m++) { const tm = (ts[m] + ts[m + 1]) / 2; if (dansPoly(A[0] + (B[0] - A[0]) * tm, A[1] + (B[1] - A[1]) * tm, p)) o.push([[A[0] + (B[0] - A[0]) * ts[m], A[1] + (B[1] - A[1]) * ts[m]], [A[0] + (B[0] - A[0]) * ts[m + 1], A[1] + (B[1] - A[1]) * ts[m + 1]]]); }
    return o;
  };
  for (let b = 0; b < H; b++) for (let a = 0; a < W; a++) { const h = hCell(a, b);
    if (a + 1 < W) { const h2 = hCell(a + 1, b); if (Math.abs(h2 - h) > 0.05) for (const [P, Q] of morceauxDedans([L.x0 + a + 1, L.y0 + b], [L.x0 + a + 1, L.y0 + b + 1])) quad(P, Q, Math.min(h, h2), Math.max(h, h2), L.x0 + a + (h < h2 ? 0.5 : 1.5), P[1]); }
    if (b + 1 < H) { const h2 = hCell(a, b + 1); if (Math.abs(h2 - h) > 0.05) for (const [P, Q] of morceauxDedans([L.x0 + a, L.y0 + b + 1], [L.x0 + a + 1, L.y0 + b + 1])) quad(P, Q, Math.min(h, h2), Math.max(h, h2), P[0], L.y0 + b + (h < h2 ? 0.5 : 1.5)); } }
  // murs : découpés aux lignes de la grille, chaque morceau monte jusqu'au plateau qui le touche
  for (let k = 0; k < poly.length; k++) {
    const A = poly[k], B = poly[(k + 1) % poly.length], ts = [0, 1];
    for (let X = Math.ceil(Math.min(A[0], B[0])); X <= Math.floor(Math.max(A[0], B[0])); X++) if (B[0] !== A[0]) ts.push((X - A[0]) / (B[0] - A[0]));
    for (let Y = Math.ceil(Math.min(A[1], B[1])); Y <= Math.floor(Math.max(A[1], B[1])); Y++) if (B[1] !== A[1]) ts.push((Y - A[1]) / (B[1] - A[1]));
    ts.sort((x, y) => x - y);
    for (let m = 0; m + 1 < ts.length; m++) { if (ts[m + 1] - ts[m] < 1e-6) continue;
      const P = [A[0] + (B[0] - A[0]) * ts[m], A[1] + (B[1] - A[1]) * ts[m]], Q = [A[0] + (B[0] - A[0]) * ts[m + 1], A[1] + (B[1] - A[1]) * ts[m + 1]];
      // le plateau de la case juste à l'intérieur du mur
      const mx = (P[0] + Q[0]) / 2, my = (P[1] + Q[1]) / 2, nx = -(Q[1] - P[1]), ny = Q[0] - P[0], ln = Math.hypot(nx, ny) || 1;
      let ix = mx + nx / ln * 0.3, iy = my + ny / ln * 0.3; if (!dansPoly(ix, iy, p)) { ix = mx - nx / ln * 0.3; iy = my - ny / ln * 0.3; }
      quad(P, Q, 0, hAt(ix, iy), 2 * mx - ix, 2 * my - iy); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals();
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(v.length / 3 * 2).fill(0), 2));
  g.userData.hAt = hAt;
  return g;
}
function aireDe(p) { let s = 0; for (let i = 0; i < p.length - 1; i++) s += p[i][0] * p[i + 1][1] - p[i + 1][0] * p[i][1]; return Math.abs(s / 2); }

/* ---------- sol détaillé (PCRS du Grand Lyon) : chaussée en bas, trottoirs surélevés, bordures ---------- */
const HSOL = [0.12, 0.12, 0.12, 0.12], CSOL = [0xebe7e0, 0xa4a4a2, 0xa4a4a2, 0xc9d6b8];
/* ---------- marquages au sol : lignes de milieu de rue et passages piétons ---------- */
let SOL = null;
function cellSol(x, y) { if (!SOL) return 9; const i = Math.floor((x + SOL.R0) / SOL.P), j = Math.floor((SOL.R0 - y) / SOL.P); return i < 0 || j < 0 || i >= SOL.N || j >= SOL.N ? 9 : SOL.cls[j * SOL.N + i]; }
function peindreMarquages() {
  if (!SOL) return; const { S, k, R0, gx } = SOL;
  gx.globalCompositeOperation = "source-over"; gx.drawImage(SOL.fondCv, 0, 0);
  const calque = document.createElement("canvas"); calque.width = calque.height = S; const c = calque.getContext("2d");
  const X = x => (x + R0) * k, Y = y => (R0 - y) * k;
  // bord de trottoir net : côté trottoir une bande couleur trottoir, côté route un caniveau clair (cache les petites vagues)
  const tc = new THREE.Color(), hex = h => { tc.setHex(h); return `rgb(${Math.round(tc.r * 255)},${Math.round(tc.g * 255)},${Math.round(tc.b * 255)})`; };   // même calcul de teinte que le fond
  gx.lineCap = "round"; gx.lineJoin = "round";
  for (const { pts: l, w } of ruesSansBordure()) {
    const ligne = (pl, larg, col) => { gx.strokeStyle = col; gx.lineWidth = larg * k; gx.beginPath(); pl.forEach(([x, y], i) => i ? gx.lineTo(X(x), Y(y)) : gx.moveTo(X(x), Y(y))); gx.stroke(); };
    ligne(l, w + 3.2, hex(CSOL[0])); ligne(l, w, hex(CSOL[1])); }
  for (const f of SOL.bordures) { const l = pts(f); if (l.length < 2) continue;
    // de quel côté est la route ? on regarde au milieu du trait
    const m = Math.floor((l.length - 1) / 2), [x1, y1] = l[m], [x2, y2] = l[m + 1], L = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / L, ny = (x2 - x1) / L;
    const sg = cellSol((x1 + x2) / 2 + nx * 1.2, (y1 + y2) / 2 + ny * 1.2) === 1 ? 1 : cellSol((x1 + x2) / 2 - nx * 1.2, (y1 + y2) / 2 - ny * 1.2) === 1 ? -1 : 0; if (!sg) continue;
    const decal = (d) => l.map(([x, y], i) => { const A = l[Math.max(0, i - 1)], B = l[Math.min(l.length - 1, i + 1)], dx = B[0] - A[0], dy = B[1] - A[1], LL = Math.hypot(dx, dy) || 1; return [x - dy / LL * d * sg, y + dx / LL * d * sg]; });
    const trait = (pl, w, col) => { gx.strokeStyle = col; gx.lineWidth = w * k; gx.beginPath(); pl.forEach(([x, y], i) => i ? gx.lineTo(X(x), Y(y)) : gx.moveTo(X(x), Y(y))); gx.stroke(); };
    trait(decal(-0.45), 0.8, hex(CSOL[0]));      // trottoir
    trait(decal(0.55), 0.9, hex(CSOL[1]));       // bitume jusqu'au caniveau
    trait(decal(0.22), 0.3, "#b9b7b1");          // caniveau
  }
  c.strokeStyle = c.fillStyle = "#ffffff"; c.lineCap = "butt";
  // ligne de milieu en tirets (3 m de trait, 3,5 m d'espace) sur les rues assez larges pour deux voies
  c.lineWidth = Math.max(1.5, 0.2 * k); c.setLineDash([3 * k, 3.5 * k]);
  for (const r of SOL.routes) { if (r.w < 6) continue; const l = pts(r.p); c.beginPath(); l.forEach(([x, y], i) => i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))); c.stroke(); }
  c.setLineDash([]);
  c.globalCompositeOperation = "destination-in"; c.imageSmoothingEnabled = false; c.drawImage(SOL.mcv, 0, 0, S, S);
  gx.drawImage(calque, 0, 0); SOL.tex.needsUpdate = true;
}

/* rues sans bordure dans le plan officiel : on leur donne des bords nets et des bordures « logiques » */
function ruesSansBordure() {
  if (SOL.synth) return SOL.synth;
  const G = new Map(), C = 4, cle = (x, y) => Math.floor(x / C) + "|" + Math.floor(y / C);
  for (const f of SOL.bordures) { const l = pts(f); for (let i = 0; i < l.length - 1; i++) { const L = Math.hypot(l[i + 1][0] - l[i][0], l[i + 1][1] - l[i][1]); for (let t = 0; t <= L; t += 1) { const x = l[i][0] + (l[i + 1][0] - l[i][0]) * (L ? t / L : 0), y = l[i][1] + (l[i + 1][1] - l[i][1]) * (L ? t / L : 0); (G.get(cle(x, y)) || G.set(cle(x, y), []).get(cle(x, y))).push([x, y]); } } }
  const bordProche = (x, y, d) => { for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (const [px, py] of G.get((Math.floor(x / C) + a) + "|" + (Math.floor(y / C) + b)) || []) if (Math.hypot(px - x, py - y) < d) return true; return false; };
  const out = [];
  for (const r of SOL.routes) { if (r.i <= 4 || r.w > 7) continue;   // grands axes : jamais traités comme « petite rue »
    const l = pts(r.p), w = r.w; let cur = [];
    const pousser = () => { if (cur.length > 1) out.push({ pts: cur, w }); cur = []; };
    for (let i = 0; i < l.length - 1; i++) { const [x1, y1] = l[i], [x2, y2] = l[i + 1], L = Math.hypot(x2 - x1, y2 - y1);
      for (let t = 0; t < L; t += 2) { const x = x1 + (x2 - x1) * t / L, y = y1 + (y2 - y1) * t / L;
        const ok = Math.hypot(x, y) < SOL.R0 - 3 && !bordProche(x, y, w / 2 + 4) && cellSol(x, y) !== 9;
        if (ok) cur.push([x, y]); else pousser(); } }
    pousser(); }
  return (SOL.synth = out);
}

let passages3D = null;
function poserPassages() {
  if (!SOL) return; if (passages3D) { scene.remove(passages3D); passages3D.geometry.dispose(); }
  // aux carrefours : un passage sur chaque branche, à 6 m du croisement, s'il n'y en a pas déjà un tout près (placé « à la logique »)
  const liste = SOL.passages.slice(), noeuds = new Map();
  for (const r of SOL.routes) { const l = pts(r.p); for (const [x, y] of [l[0], l[l.length - 1]]) { const k = Math.round(x) + "|" + Math.round(y); const n = noeuds.get(k) || { x, y, b: [] }; n.b.push(l[0][0] === x && l[0][1] === y ? l[1] : l[l.length - 2]); noeuds.set(k, n); } }
  for (const n of noeuds.values()) { if (n.b.length < 3 || Math.hypot(n.x, n.y) > SOL.R0 - 10) continue;
    for (const [bx, by] of n.b) { const L = Math.hypot(bx - n.x, by - n.y) || 1, px = n.x + (bx - n.x) / L * 9, py = n.y + (by - n.y) / L * 9;
      if (cellSol(px, py) === 1 && !liste.some(([a, c]) => Math.hypot(a - px, c - py) < 12)) liste.push([px, py]); } }
  const bandes = []; SOL.zebras = liste;
  for (const [px, py] of liste) {
    const r = surLaRue(px, py, 15); if (!r) continue;
    const ux = Math.cos(r.ang), uy = Math.sin(r.ang), nx = -uy, ny = ux;
    const bout = (sg) => { let t = 0, dernier = 0, trou = 0; while (t < 18) { t += 0.3; if (cellSol(px + sg * nx * t, py + sg * ny * t) === 1) { dernier = t; trou = 0; } else if ((trou += 0.3) > 6) break; } return dernier; };
    const a = bout(-1), b = bout(1); if (a + b < 3) continue;
    for (let t = -a + 0.45; t < b - 0.3; t += 1) { const cx = px + nx * t, cy = py + ny * t; if (cellSol(cx, cy) !== 1) continue;
      const g = new THREE.BoxGeometry(2.8, 0.025, 0.5); g.rotateY(r.ang); g.translate(cx, 0.135, -cy); bandes.push(g.toNonIndexed()); }
  }
  if (!bandes.length) return;
  passages3D = new THREE.Mesh(mergeGeometries(bandes), new THREE.MeshStandardMaterial({ color: 0xfafaf7, roughness: 0.7 })); passages3D.receiveShadow = true; scene.add(passages3D);
}
async function chercherPassages() {   // les vrais passages piétons (OpenStreetMap), chargés après coup pour ne pas ralentir l'ouverture
  try {
    const q = `[out:json][timeout:20];node["highway"="crossing"](around:${Math.round(SOL.R0 + 20)},${centre.lat},${centre.lon});out;`;
    const rep = await fetch("https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(q), { signal: AbortSignal.timeout(20000) });
    const j = await rep.json(); SOL.passages = (j.elements || []).map(e => local(e.lat, e.lon, centre)); poserPassages();
  } catch (_) { /* pas grave : la carte reste sans passages piétons */ }
}
function construireSol(sol) {
  const N = sol.n, P = sol.pas, R0 = sol.r, cls = new Uint8Array(N * N);
  sol.lignes.split("|").forEach((l, j) => { let i = 0; for (const t of l.match(/[a-z]\d+/g) || []) { const c = t[0] === "z" ? 9 : t.charCodeAt(0) - 97, n = +t.slice(1); cls.fill(c, j * N + i, j * N + i + n); i += n; } });
  // nettoyage : les petites taches isolées (moins de 5 m²) prennent la couleur de ce qui les entoure
  { const vu = new Uint8Array(N * N), pile = [], comp = [];
    for (let k0 = 0; k0 < N * N; k0++) { if (vu[k0] || cls[k0] === 9) continue; const c0 = cls[k0] === 2 ? 1 : cls[k0]; comp.length = 0; pile.push(k0); vu[k0] = 1; const voisins = new Map();
      while (pile.length) { const k = pile.pop(); comp.push(k); const i = k % N, j = (k / N) | 0;
        for (const q of [i > 0 ? k - 1 : -1, i < N - 1 ? k + 1 : -1, j > 0 ? k - N : -1, j < N - 1 ? k + N : -1]) { if (q < 0) continue; const cq = cls[q] === 2 ? 1 : cls[q]; if (cq === c0) { if (!vu[q]) { vu[q] = 1; pile.push(q); } } else if (cq !== 9) voisins.set(cq, (voisins.get(cq) || 0) + 1); } }
      if (comp.length < 32 && voisins.size) { let best = -1, bn = -1; for (const [c, n] of voisins) if (n > bn) { bn = n; best = c; } for (const k of comp) cls[k] = best; } } }
  // le sol est peint comme une image (un point = 40 cm) puis lissé : les limites restent nettes mais sans « escalier »
  const cv = document.createElement("canvas"); cv.width = N; cv.height = N; const cx = cv.getContext("2d"), img = cx.createImageData(N, N), c3 = new THREE.Color();
  const teintes = CSOL.map(h => { c3.setHex(h); return [Math.round(c3.r * 255), Math.round(c3.g * 255), Math.round(c3.b * 255)]; });
  for (let k = 0; k < N * N; k++) { const c = cls[k], t = teintes[c === 9 ? 0 : c]; img.data[k * 4] = t[0]; img.data[k * 4 + 1] = t[1]; img.data[k * 4 + 2] = t[2]; img.data[k * 4 + 3] = c === 9 ? 0 : 255; }
  cx.putImageData(img, 0, 0);
  // agrandie et adoucie : les bords en biais deviennent des lignes douces
  const grand = document.createElement("canvas"); grand.width = grand.height = Math.min(3072, N * 3); const gx = grand.getContext("2d");   // taille limitée pour les iPhone
  gx.imageSmoothingEnabled = true; gx.imageSmoothingQuality = "high"; gx.filter = `blur(${(grand.width / N * 0.55).toFixed(1)}px)`; gx.drawImage(cv, 0, 0, grand.width, grand.height);
  // grain du bitume (chaussée plus marquée, trottoir très fin) — toujours le même dessin d'une ouverture à l'autre
  const S = grand.width, k = S / (2 * R0), fond = gx.getImageData(0, 0, S, S), d = fond.data; let graine = 12345;
  const alea = () => { graine = (graine * 1103515245 + 12345) & 0x7fffffff; return graine / 0x7fffffff; };
  for (let py = 0; py < S; py++) { const j = Math.min(N - 1, (py / S * N) | 0);
    for (let px = 0; px < S; px++) { const c = cls[j * N + Math.min(N - 1, (px / S * N) | 0)], o = (py * S + px) * 4; if (c === 9) continue;
      const amp = c === 1 || c === 2 ? 14 : 6, n = (alea() - 0.5) * amp + (alea() < 0.01 ? -10 : 0); d[o] += n; d[o + 1] += n; d[o + 2] += n; } }
  gx.filter = "none"; gx.putImageData(fond, 0, 0);
  const fondCv = document.createElement("canvas"); fondCv.width = fondCv.height = S; fondCv.getContext("2d").drawImage(grand, 0, 0);
  // masque « chaussée » : les marquages ne débordent jamais sur le trottoir
  const mcv = document.createElement("canvas"); mcv.width = mcv.height = N; const mctx = mcv.getContext("2d"), mimg = mctx.createImageData(N, N);
  for (let q = 0; q < N * N; q++) mimg.data[q * 4 + 3] = cls[q] === 1 ? 255 : 0; mctx.putImageData(mimg, 0, 0);
  const tex = new THREE.CanvasTexture(grand);
  SOL = { cls, N, P, R0, S, k, grand, gx, fondCv, mcv, tex, routes: [], passages: [], bordures: sol.bordures || [] };
  tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const g = new THREE.CircleGeometry(R0 - 0.5, 128); g.rotateX(-Math.PI / 2); g.translate(0, HSOL[0], 0);
  const uv = g.attributes.uv, ps = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (ps.getX(i) + R0) / (2 * R0), 1 - (R0 + ps.getZ(i)) / (2 * R0) );
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 1, transparent: true })); m.receiveShadow = true; scene.add(m);
  // les bordures de trottoir, tracées au centimètre (PCRS) : un petit muret de 20 cm de large, 15 cm au-dessus de la chaussée
  const bg = [];
  for (const f of sol.bordures || []) { const l = pts(f); for (let i = 0; i < l.length - 1; i++) { const [x1, y1] = l[i], [x2, y2] = l[i + 1], L = Math.hypot(x2 - x1, y2 - y1); if (L < 0.05) continue;
    const b = new THREE.BoxGeometry(L + 0.2, 0.15, 0.2); b.rotateY(Math.atan2(y2 - y1, x2 - x1)); b.translate((x1 + x2) / 2, 0.195, -(y1 + y2) / 2); bg.push(b.toNonIndexed()); } }
  if (bg.length) { const mb = new THREE.Mesh(mergeGeometries(bg), new THREE.MeshStandardMaterial({ color: 0xe4ded3, roughness: 0.9 })); mb.castShadow = true; mb.receiveShadow = true; scene.add(mb); }
  return R0;
}


/* ---------- deuxième couche : l'habillage (placé « à la logique », pour un rendu vivant) ---------- */
function habiller(sol) {
  if (!SOL) return;
  // les rues sans bordure officielle : la chaussée devient nette (pour les passages piétons) et reçoit deux bordures
  const synth = ruesSansBordure(), kb = [];
  for (const { pts: l, w } of synth) {
    for (const [x, y] of l) for (let dx = -w / 2; dx <= w / 2; dx += SOL.P) for (let dy = -w / 2; dy <= w / 2; dy += SOL.P) { if (dx * dx + dy * dy > w * w / 4) continue; const i = Math.floor((x + dx + SOL.R0) / SOL.P), j = Math.floor((SOL.R0 - y - dy) / SOL.P); if (i >= 0 && j >= 0 && i < SOL.N && j < SOL.N && SOL.cls[j * SOL.N + i] !== 9) SOL.cls[j * SOL.N + i] = 1; }
    for (const sg of [-1, 1]) for (let i = 0; i < l.length - 1; i++) { const [x1, y1] = l[i], [x2, y2] = l[i + 1], L = Math.hypot(x2 - x1, y2 - y1); if (L < 0.1) continue; const nx = -(y2 - y1) / L * sg * (w / 2 + 0.1), ny = (x2 - x1) / L * sg * (w / 2 + 0.1);
      const b = new THREE.BoxGeometry(L + 0.25, 0.15, 0.2); b.rotateY(Math.atan2(y2 - y1, x2 - x1)); b.translate((x1 + x2) / 2 + nx, 0.195, -((y1 + y2) / 2 + ny)); kb.push(b.toNonIndexed()); } }
  if (kb.length) { const mb = new THREE.Mesh(mergeGeometries(kb), new THREE.MeshStandardMaterial({ color: 0xe4ded3, roughness: 0.9 })); mb.castShadow = mb.receiveShadow = true; scene.add(mb); }
  let graine = 777; const alea = () => { graine = (graine * 1103515245 + 12345) & 0x7fffffff; return graine / 0x7fffffff; };
  const lamp = [], autos = [];
  const passageProche = (x, y, d) => SOL.passages.some(([a, b]) => Math.hypot(a - x, b - y) < d);
  for (const f of sol.bordures || []) {
    const l = pts(f); let reste = 8 + alea() * 10;
    for (let i = 0; i < l.length - 1; i++) {
      const [x1, y1] = l[i], [x2, y2] = l[i + 1], L = Math.hypot(x2 - x1, y2 - y1); if (L < 0.1) continue;
      const ux = (x2 - x1) / L, uy = (y2 - y1) / L; let t = reste;
      for (; t < L; t += 1) {
        const x = x1 + ux * t, y = y1 + uy * t;
        // de quel côté est le trottoir ? (la chaussée est de l'autre)
        const g = cellSol(x - uy * 1.2, y + ux * 1.2), d = cellSol(x + uy * 1.2, y - ux * 1.2);
        const cote = g === 1 && d !== 1 ? -1 : d === 1 && g !== 1 ? 1 : 0; if (!cote) continue;
        // un lampadaire tous les ~25 m, côté trottoir
        if (!lamp.length || Math.hypot(lamp[lamp.length - 1][0] - x, lamp[lamp.length - 1][1] - y) > 24) {
          const lx = x - uy * 0.6 * cote, ly = y + ux * 0.6 * cote;
          if (cellSol(lx, ly) !== 1 && !passageProche(lx, ly, 3)) lamp.push([lx, ly, Math.atan2(-ux * cote, uy * cote)]);
        }
      }
      reste = t - L;
    }
  }
  // voitures garées : le long des bordures des rues calmes (pas sur la route de Genas ni près des passages piétons)
  for (const f of sol.bordures || []) {
    const l = pts(f);
    for (let i = 0; i < l.length - 1; i++) {
      const [x1, y1] = l[i], [x2, y2] = l[i + 1], L = Math.hypot(x2 - x1, y2 - y1); if (L < 5) continue;
      const ux = (x2 - x1) / L, uy = (y2 - y1) / L;
      for (let t = 3; t < L - 3; t += 5.6) {
        if (alea() < 0.45) continue;
        const x = x1 + ux * t, y = y1 + uy * t;
        const g = cellSol(x - uy * 1.2, y + ux * 1.2) === 1, d = cellSol(x + uy * 1.2, y - ux * 1.2) === 1; if (g === d) continue;
        const s2 = g ? 1 : -1, cx = x - uy * 1.15 * s2, cy = y + ux * 1.15 * s2;
        const r = surLaRue(cx, cy, 12); if (r && r.w >= 9) continue;                     // grands axes : pas de stationnement
        if (passageProche(cx, cy, 8)) continue;
        let libre = true; for (const [a, b] of [[2.2, 0.9], [-2.2, 0.9], [2.2, -0.9], [-2.2, -0.9]]) if (cellSol(cx + ux * a - uy * b, cy + uy * a + ux * b) !== 1) libre = false;
        if (!libre || autos.some(([a, b]) => Math.hypot(a - cx, b - cy) < 5)) continue;
        autos.push([cx, cy, Math.atan2(uy, ux)]);
      }
    }
  }
  // petites rues (sans bordure officielle) : des voitures garées d'un côté, et quelques lampadaires
  for (const { pts: l, w } of ruesSansBordure()) {
    if (w < 5) continue;
    for (let i = 0; i < l.length - 1; i++) { const [x1, y1] = l[i], [x2, y2] = l[i + 1], L = Math.hypot(x2 - x1, y2 - y1); if (L < 0.5) continue;
      const ux = (x2 - x1) / L, uy = (y2 - y1) / L, cx = (x1 + x2) / 2 - uy * (w / 2 - 1.0), cy = (y1 + y2) / 2 + ux * (w / 2 - 1.0);
      if (alea() < 0.55 && !passageProche(cx, cy, 8) && !autos.some(([a, b]) => Math.hypot(a - cx, b - cy) < 5.2)) autos.push([cx, cy, Math.atan2(uy, ux)]);
      const lx = (x1 + x2) / 2 + uy * (w / 2 + 0.6), ly = (y1 + y2) / 2 - ux * (w / 2 + 0.6);
      if (!lamp.some(([a, b]) => Math.hypot(a - lx, b - ly) < 22)) lamp.push([lx, ly, Math.atan2(ux, -uy)]); }
  }
  const o = new THREE.Object3D();
  // un banc à côté de chaque abribus
  { const bancs = [];
    for (const ab of ABRIS) { const b1 = new THREE.BoxGeometry(1.8, 0.08, 0.45); b1.translate(0, 0.45, 0.1); const b2 = new THREE.BoxGeometry(1.8, 0.45, 0.06); b2.translate(0, 0.7, 0.33);
      for (const b of [b1, b2]) { b.rotateY(ab.ang); b.translate(ab.x + Math.cos(ab.ang) * 3.6, 0.12, -(ab.y + Math.sin(ab.ang) * 3.6)); bancs.push(b.toNonIndexed()); } }
    if (bancs.length) { const m = new THREE.Mesh(mergeGeometries(bancs), new THREE.MeshStandardMaterial({ color: 0x6b5a48, roughness: 0.8 })); m.castShadow = true; scene.add(m); } }
  if (lamp.length) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6 });
    const mat2 = new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffe2a0, emissiveIntensity: 0.6 });
    const pied = new THREE.CylinderGeometry(0.07, 0.1, 6, 6); pied.translate(0, 3.1, 0);
    const tete = new THREE.BoxGeometry(0.9, 0.12, 0.3); tete.translate(0.35, 6.05, 0);
    const ip = new THREE.InstancedMesh(pied, mat, lamp.length), it = new THREE.InstancedMesh(tete, mat2, lamp.length);
    lamp.forEach(([x, y, a], i) => { o.position.set(x, 0, -y); o.rotation.set(0, a, 0); o.updateMatrix(); ip.setMatrixAt(i, o.matrix); it.setMatrixAt(i, o.matrix); });
    ip.castShadow = true; scene.add(ip, it);
  }
  if (autos.length) {
    const teintes = [0xf4f2ee, 0x2e3237, 0x9aa1a8, 0x6f7b86, 0xb8442f, 0x2f4d6e, 0xd9d4c7, 0x55606a];
    const caisse = new THREE.BoxGeometry(4.2, 0.75, 1.75); caisse.translate(0, 0.62, 0);
    const toit = new THREE.BoxGeometry(2.2, 0.55, 1.5); toit.translate(-0.2, 1.25, 0);
    const vitres = new THREE.BoxGeometry(2.25, 0.4, 1.53); vitres.translate(-0.2, 1.2, 0);
    const ic = new THREE.InstancedMesh(caisse, new THREE.MeshStandardMaterial({ roughness: 0.45 }), autos.length);
    const ir = new THREE.InstancedMesh(toit, new THREE.MeshStandardMaterial({ roughness: 0.45 }), autos.length);
    const iv = new THREE.InstancedMesh(vitres, new THREE.MeshStandardMaterial({ color: 0x2b333b, roughness: 0.2 }), autos.length);
    const col = new THREE.Color();
    autos.forEach(([x, y, a], i) => { o.position.set(x, 0.12, -y); o.rotation.set(0, a, 0); o.updateMatrix(); ic.setMatrixAt(i, o.matrix); ir.setMatrixAt(i, o.matrix); iv.setMatrixAt(i, o.matrix);
      col.setHex(teintes[Math.floor(alea() * teintes.length)]); ic.setColorAt(i, col); ir.setColorAt(i, col); });
    ic.castShadow = ir.castShadow = true; ic.receiveShadow = true; scene.add(ic, ir, iv);
  }
}


/* ---------- ton immeuble en détail (d'après tes photos : approximatif, mais ressemblant) ----------
   façades gris très clair, fenêtres à volets roulants, balcons à garde-corps en verre, panneaux blancs ajourés,
   garde-corps vitré en toiture, porte de garage et boîtes aux lettres au rez-de-chaussée,
   jardin avec haie, muret en béton surmonté d'un grillage vert. */
function motifAjoure() {   // panneau blanc découpé (motif « branches ») : dessiné une fois, utilisé partout
  const c = document.createElement("canvas"); c.width = 128; c.height = 512; const x = c.getContext("2d");
  x.fillStyle = "#f4f3ef"; x.fillRect(0, 0, 128, 512); x.globalCompositeOperation = "destination-out"; x.strokeStyle = "#000"; x.lineCap = "round";
  let g = 99; const a = () => { g = (g * 16807) % 2147483647; return g / 2147483647; };
  for (let i = 0; i < 70; i++) { const px = 14 + a() * 100, py = 14 + a() * 484, ang = a() * Math.PI; x.lineWidth = 5 + a() * 7; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(ang) * (18 + a() * 30), py + Math.sin(ang) * (30 + a() * 60)); x.stroke(); }
  x.globalCompositeOperation = "source-over"; x.strokeStyle = "#f4f3ef"; x.lineWidth = 10; x.strokeRect(0, 0, 128, 512);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const ZONES_LIBRES = [];
function lames(c1, c2, n) {   // lames horizontales (volets roulants, porte de garage)
  const c = document.createElement("canvas"); c.width = 32; c.height = 64; const x = c.getContext("2d"), col = new THREE.Color();
  x.fillStyle = "#" + col.setHex(c1).getHexString(); x.fillRect(0, 0, 32, 64); x.fillStyle = "#" + col.setHex(c2).getHexString();
  for (let i = 0; i < n; i++) x.fillRect(0, Math.floor(i * 64 / n), 32, 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function grilleBoites() {   // façade du bloc de boîtes aux lettres
  const c = document.createElement("canvas"); c.width = 128; c.height = 64; const x = c.getContext("2d");
  x.fillStyle = "#5d666c"; x.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { x.fillStyle = "#8a949a"; x.fillRect(3 + i * 21, 3 + j * 20, 18, 17); x.fillStyle = "#3a4146"; x.fillRect(6 + i * 21, 8 + j * 20, 12, 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function detaillerMaison(pp, hAt, voisins) {
  const poly = pp.slice(0, -1), n = poly.length;
  let aire = 0; for (let i = 0; i < n; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n]; aire += x1 * y2 - x2 * y1; }
  const sens = aire > 0 ? 1 : -1;   // pour trouver « l'extérieur » de chaque façade
  const vitres = [], volets = [], cadres = [], dalles = [], verres = [], ajoures = [], garage = [], beton = [], rails = [], socle = [], portes = [], boites = [], lampes = [], metal = [], bois = [];
  let entreeGarage = null;
  const boite = (arr, w, h, d, x, y, z, ang) => { const b = new THREE.BoxGeometry(w, h, d); b.rotateY(ang); b.translate(x, z, -y); arr.push(b.toNonIndexed()); };
  const ETAGE = 2.9, RDC = 3.1;
  let garagePose = false, boitesPosees = false, k = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n], L = Math.hypot(x2 - x1, y2 - y1); if (L < 2.4) continue;
    const ux = (x2 - x1) / L, uy = (y2 - y1) / L, nx = uy * sens, ny = -ux * sens, ang = Math.atan2(uy, ux);   // n : vers l'extérieur
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, hF = hAt(mx - nx * 0.6, my - ny * 0.6);                     // hauteur de cette façade
    const niveaux = Math.max(0, Math.floor((hF - RDC - 0.6) / ETAGE));
    const versRue = ny < -0.55;                                                                               // façade côté route de Genas
    const balcons = L >= 6 && ny < 0.5 && niveaux >= 2;                                                       // façades au soleil : balcons
    const nb = Math.max(1, Math.floor((L - 1.2) / 2.7));
    for (let w = 0; w < nb; w++) {
      const t = (w + 0.5) * L / nb, px = x1 + ux * t, py = y1 + uy * t, ox = px + nx * 0.04, oy = py + ny * 0.04;
      // rez-de-chaussée : une porte de garage sur la façade côté rue, des fenêtres ailleurs
      if (versRue && !garagePose && L >= 8 && w === 0) {
        // porte de garage (lames horizontales), encadrement blanc, et l'accès qui descend jusqu'à la route
        const gx0 = x1 + ux * 2.4, gy0 = y1 + uy * 2.4;
        boite(cadres, 3.7, 2.55, 0.12, gx0 + nx * 0.03, gy0 + ny * 0.03, 1.27, ang);
        boite(garage, 3.4, 2.35, 0.14, gx0 + nx * 0.05, gy0 + ny * 0.05, 1.17, ang);
        entreeGarage = { x: gx0, y: gy0, nx, ny, ux, uy, ang };
        // à côté du garage (vu sur Street View) : l'entrée piétonne est un portillon en métal, au bout de l'immeuble,
        // sous un auvent plat qui couvre aussi un abri en lattes de bois sombre ; boîtes aux lettres blanches devant
        const ex = x1 - ux * 0.95, ey = y1 - uy * 0.95;
        boite(metal, 0.08, 2.0, 0.08, ex - ux * 0.62, ey - uy * 0.62, 1.0, ang);
        boite(metal, 0.08, 2.0, 0.08, ex + ux * 0.62, ey + uy * 0.62, 1.0, ang);
        for (let b = -0.5; b <= 0.51; b += 0.1) boite(metal, 0.025, 1.8, 0.025, ex + ux * b, ey + uy * b, 1.05, ang);
        boite(metal, 1.2, 0.06, 0.05, ex, ey, 1.95, ang); boite(metal, 1.2, 0.06, 0.05, ex, ey, 0.2, ang); boite(metal, 1.2, 0.06, 0.05, ex, ey, 1.05, ang);
        boite(rails, 0.05, 0.16, 0.08, ex + ux * 0.42 + nx * 0.05, ey + uy * 0.42 + ny * 0.05, 1.05, ang);   // poignée
        // l'abri en lattes de bois, juste à gauche du portillon
        const ax = x1 - ux * 3.7 - nx * 0.4, ay = y1 - uy * 3.7 - ny * 0.4;
        boite(bois, 3.9, 2.45, 3.0, ax, ay, 1.36, ang);
        // l'auvent plat blanc au-dessus des deux
        boite(dalles, 6.3, 0.18, 3.8, x1 - ux * 2.9 - nx * 0.2, y1 - uy * 2.9 - ny * 0.2, 2.72, ang);
        boite(metal, 0.1, 2.6, 0.1, x1 - ux * 0.3 + nx * 1.6, y1 - uy * 0.3 + ny * 1.6, 1.42, ang);
        boite(lampes, 0.25, 0.06, 0.25, ex + nx * 0.4, ey + ny * 0.4, 2.6, ang);
        entreeGarage.porte = [ex, ey];
        ZONES_LIBRES.push([ax, ay, 2.6], [ex, ey, 1.3]);
        // boîtes aux lettres et interphone : deux blocs blancs bas devant, entre le portillon et le garage
        const bx = x1 + ux * 0.0 + nx * 2.3, by = y1 + uy * 0.0 + ny * 2.3;
        boite(beton, 1.5, 1.15, 0.55, bx, by, 0.72, ang);
        boite(boites, 1.3, 0.75, 0.04, bx + nx * 0.29, by + ny * 0.29, 0.8, ang);
        boite(beton, 0.45, 1.45, 0.45, bx - ux * 1.05, by - uy * 1.05, 0.87, ang);   // pilier de l'interphone
        boite(rails, 0.22, 0.3, 0.04, bx - ux * 1.05 + nx * 0.24, by - uy * 1.05 + ny * 0.24, 1.25, ang);
        // à droite du garage : bloc blanc (local poubelles) et deux grandes portes-fenêtres à volets
        const cx2 = x1 + ux * 5.0 + nx * 1.2, cy2 = y1 + uy * 5.0 + ny * 1.2;
        boite(beton, 1.6, 1.0, 0.9, cx2, cy2, 0.65, ang);
        for (const tt of [5.4, 7.3]) { const qx = x1 + ux * tt + nx * 0.04, qy = y1 + uy * tt + ny * 0.04;
          boite(cadres, 1.25, 2.45, 0.05, qx, qy, 1.4, ang); boite(vitres, 1.05, 2.25, 0.07, qx, qy, 1.35, ang);
          boite(volets, 1.05, tt > 6 ? 2.2 : 1.6, 0.09, qx, qy, tt > 6 ? 1.38 : 1.68, ang); }
        garagePose = true; boitesPosees = true;
      }
      if (versRue && garagePose && t < 8.2) { /* rez-de-chaussée : place du garage et de l'entrée */ }
      else { boite(vitres, 1.0, 1.25, 0.06, ox, oy, 1.35, ang); boite(volets, 1.0, 0.35, 0.08, ox, oy, 2.05, ang); }
      for (let e = 0; e < niveaux; e++) {
        const z = RDC + e * ETAGE;
        const loggia = balcons && w % 2 === 0 && t > 1.5 && t < L - 1.5;
        if (loggia) {
          // balcon : dalle débordante, garde-corps en verre, baie vitrée derrière
          const dx = px + nx * 0.75, dy = py + ny * 0.75;
          boite(dalles, 2.7, 0.22, 1.55, dx, dy, z - 0.11, ang);
          boite(verres, 2.6, 1.0, 0.05, px + nx * 1.48, py + ny * 1.48, z + 0.5, ang);
          boite(rails, 2.62, 0.05, 0.08, px + nx * 1.48, py + ny * 1.48, z + 1.02, ang);
          boite(verres, 0.05, 1.0, 1.45, px + nx * 0.75 + ux * 1.3, py + ny * 0.75 + uy * 1.3, z + 0.5, ang);
          boite(verres, 0.05, 1.0, 1.45, px + nx * 0.75 - ux * 1.3, py + ny * 0.75 - uy * 1.3, z + 0.5, ang);
          boite(vitres, 1.8, 2.1, 0.06, ox, oy, z + 1.05, ang);
          if ((e + w) % 3 !== 1) { boite(ajoures, 0.55, ETAGE - 0.25, 0.05, dx + ux * 1.0 + nx * 0.72, dy + uy * 1.0 + ny * 0.72, z + ETAGE / 2, ang); boite(ajoures, 0.55, ETAGE - 0.25, 0.05, dx - ux * 1.0 + nx * 0.72, dy - uy * 1.0 + ny * 0.72, z + ETAGE / 2, ang); }
        } else {
          const paire = !balcons && L >= 5 ? [-0.62, 0.62] : [0];   // façades pleines : fenêtres par deux, rapprochées
          for (const dec of paire) { const qx = ox + ux * dec, qy = oy + uy * dec, lw = paire.length > 1 ? 0.78 : 0.96;
            boite(cadres, lw + 0.18, 1.62, 0.05, qx, qy, z + 1.33, ang);
            boite(vitres, lw, 1.36, 0.07, qx, qy, z + 1.27, ang);
            const desc = 0.25 + ((e * 7 + w * 3 + k + (dec > 0 ? 2 : 0)) % 5) * 0.15;   // chaque volet plus ou moins descendu, comme en vrai
            boite(volets, lw, desc, 0.09, qx, qy, z + 1.95 - desc / 2, ang); }
        }
      }
    }
    // socle un peu plus foncé au pied de la façade
    boite(socle, L + 0.06, 0.55, 0.06, mx + nx * 0.03, my + ny * 0.03, 0.4, ang);
    // garde-corps vitré en haut de chaque façade (toit-terrasse), avec sa lisse métallique
    boite(verres, L, 0.95, 0.05, mx - nx * 0.1, my - ny * 0.1, hF + 0.47, ang);
    boite(rails, L, 0.05, 0.08, mx - nx * 0.1, my - ny * 0.1, hF + 0.97, ang);
    // boîtes aux lettres près de l'entrée côté rue
    if (versRue && !boitesPosees && L >= 6) { boite(beton, 1.8, 1.3, 0.5, mx + nx * 1.2, my + ny * 1.2, 0.77, ang); boitesPosees = true; }
    k++;
  }
  const mat = {
    vitres: new THREE.MeshStandardMaterial({ color: 0x7d8f99, roughness: 0.12, metalness: 0.45 }),
    volets: new THREE.MeshStandardMaterial({ map: lames(0xdcdcda, 0xc9c9c6, 10), roughness: 0.6 }),
    rails: new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.4, metalness: 0.6 }),
    socle: new THREE.MeshStandardMaterial({ color: 0xd4d1ca, roughness: 0.95 }),
    portes: new THREE.MeshStandardMaterial({ color: 0x9fb4bd, roughness: 0.08, metalness: 0.35 }),
    lampes: new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffe0a0, emissiveIntensity: 0.8 }),
    boites: new THREE.MeshStandardMaterial({ map: grilleBoites(), roughness: 0.5, metalness: 0.4 }),
    cadres: new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.5 }),
    dalles: new THREE.MeshStandardMaterial({ color: 0xf3f2ee, roughness: 0.8 }),
    verres: new THREE.MeshStandardMaterial({ color: 0xbfd2d8, roughness: 0.1, transparent: true, opacity: 0.55 }),
    ajoures: new THREE.MeshStandardMaterial({ map: motifAjoure(), alphaTest: 0.5, transparent: true, side: THREE.DoubleSide, roughness: 0.6 }),
    garage: new THREE.MeshStandardMaterial({ map: lames(0xc4c8cb, 0xa9aeb2, 9), roughness: 0.45, metalness: 0.3 }),
    beton: new THREE.MeshStandardMaterial({ color: 0xe6e2d9, roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x6e7376, roughness: 0.5, metalness: 0.6 }),
    bois: new THREE.MeshStandardMaterial({ map: (() => { const t = lames(0x5b4a3c, 0x2e2620, 22); t.center.set(0.5, 0.5); t.rotation = Math.PI / 2; return t; })(), roughness: 0.85 }),
  };
  for (const [nom, arr] of Object.entries({ vitres, volets, cadres, dalles, verres, ajoures, garage, beton, rails, socle, portes, boites, lampes, metal, bois })) {
    if (!arr.length) continue; const m = new THREE.Mesh(mergeGeometries(arr), mat[nom]); m.castShadow = nom !== "verres"; m.receiveShadow = true; scene.add(m);
  }
  // l'accès au garage : une rampe en enrobé du garage jusqu'à la chaussée, qui passe par-dessus la bordure (bateau)
  if (entreeGarage) { const { x, y, nx, ny, ux, uy } = entreeGarage; let d = 0.3; while (d < 16 && cellSol(x + nx * d, y + ny * d) !== 1) d += 0.3;
    if (d < 16) { const prof = [[0, 0.15], [Math.max(0.5, d - 1.1), 0.2], [d - 0.4, 0.3], [d + 0.3, 0.13]], v = [];
      for (let i = 0; i < prof.length - 1; i++) { const [a, ha] = prof[i], [b, hb] = prof[i + 1];
        const P = (t, sg) => [x + nx * t + ux * 1.8 * sg, y + ny * t + uy * 1.8 * sg];
        const [A1, A2, B1, B2] = [P(a, -1), P(a, 1), P(b, -1), P(b, 1)];
        v.push(A1[0], ha, -A1[1], B1[0], hb, -B1[1], B2[0], hb, -B2[1], A1[0], ha, -A1[1], B2[0], hb, -B2[1], A2[0], ha, -A2[1]); }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x8f8c87, roughness: 1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 })); m.receiveShadow = true; scene.add(m);
      ZONES_LIBRES.push([x + nx * d / 2, y + ny * d / 2, d / 2 + 2]);
      // le parvis de l'entrée : dalles claires de la porte jusqu'au trottoir (pas de pelouse devant)
      if (entreeGarage.porte) { const [ex, ey] = entreeGarage.porte, L2 = Math.max(1, d - 0.8), cx = ex + nx * L2 / 2, cy = ey + ny * L2 / 2;
        const pv = new THREE.BoxGeometry(1.7, 0.05, L2); pv.rotateY(Math.atan2(nx, ny)); pv.translate(cx, 0.16, -cy);
        const mp = new THREE.Mesh(pv, new THREE.MeshStandardMaterial({ color: 0xdedad2, roughness: 0.9 })); mp.receiveShadow = true; scene.add(mp);
        ZONES_LIBRES.push([cx, cy, L2 / 2 + 1.5]); } } }
  if (TEST || location.search.includes("regard")) window.MAISON = { poly, garage: entreeGarage };
  // le jardin : pelouse, haie et clôture (muret + grillage vert) autour de l'immeuble, sans jamais déborder sur la route ni chez les voisins
  const env = [...poly].sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const bas = [], haut = []; for (const p of env) { while (bas.length >= 2 && cr(bas[bas.length - 2], bas[bas.length - 1], p) <= 0) bas.pop(); bas.push(p); }
  for (const p of env.slice().reverse()) { while (haut.length >= 2 && cr(haut[haut.length - 2], haut[haut.length - 1], p) <= 0) haut.pop(); haut.push(p); }
  const coque = bas.slice(0, -1).concat(haut.slice(0, -1));
  const [gx0, gy0] = coque.reduce((a, [x, y]) => [a[0] + x / coque.length, a[1] + y / coque.length], [0, 0]);
  const jardin = coque.map(([x, y]) => { const dx = x - gx0, dy = y - gy0, d = Math.hypot(dx, dy) || 1; return [x + dx / d * 3.5, y + dy / d * 3.5]; });
  const libre = (x, y) => cellSol(x, y) !== 1 && cellSol(x, y) !== 9 && !voisins.some(b => dansPoly(x, y, b.pp)) && !ZONES_LIBRES.some(([a, b, r]) => Math.hypot(a - x, b - y) < r);
  const pel = new THREE.ShapeGeometry(new THREE.Shape(jardin.map(([x, y]) => V(x, y)))); pel.rotateX(-Math.PI / 2); pel.translate(0, 0.135, 0);
  scene.add(Object.assign(new THREE.Mesh(pel, new THREE.MeshStandardMaterial({ color: 0x9fb784, roughness: 1 })), { receiveShadow: true }));
  const muret = [], grillage = [], haies = [];
  for (let i = 0; i < jardin.length; i++) {
    const [x1, y1] = jardin[i], [x2, y2] = jardin[(i + 1) % jardin.length], L = Math.hypot(x2 - x1, y2 - y1), ang = Math.atan2(y2 - y1, x2 - x1);
    for (let t = 0; t < L; t += 1) { const s1 = Math.min(1, L - t), x = x1 + (x2 - x1) * (t + s1 / 2) / L, y = y1 + (y2 - y1) * (t + s1 / 2) / L; if (!libre(x, y)) continue;
      boite(muret, s1 + 0.02, 0.6, 0.22, x, y, 0.42, ang); boite(grillage, s1 + 0.02, 1.25, 0.03, x, y, 1.35, ang);
      if (Math.floor(t) % 2 === 0) { const hx = x - (x - gx0) / Math.hypot(x - gx0, y - gy0) * 0.9, hy = y - (y - gy0) / Math.hypot(x - gx0, y - gy0) * 0.9; if (!poly.length || !dansPoly(hx, hy, pp)) haies.push([hx, hy]); } }
  }
  if (muret.length) { const m = new THREE.Mesh(mergeGeometries(muret), mat.beton); m.castShadow = m.receiveShadow = true; scene.add(m);
    scene.add(new THREE.Mesh(mergeGeometries(grillage), new THREE.MeshStandardMaterial({ color: 0x2f4b3b, roughness: 0.8, transparent: true, opacity: 0.85 }))); }
  if (haies.length) { const geo = new THREE.IcosahedronGeometry(0.9, 1); geo.scale(1, 1.15, 1); geo.translate(0, 1.0, 0);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x5f8a4a, roughness: 1, flatShading: true }), haies.length), o = new THREE.Object3D();
    haies.forEach(([x, y], i) => { o.position.set(x, 0.12, -y); const sc = 0.85 + ((i * 37) % 10) / 25; o.scale.set(sc, sc * (1 + ((i * 13) % 7) / 10), sc); o.rotation.y = i; o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    im.castShadow = true; scene.add(im); }
}

let RDETAIL = 0;
function construireQuartier(q) {
  if (q.sol) { RDETAIL = construireSol(q.sol); SOL.routes = (q.routes || []).filter(r => pts(r.p).some(([x, y]) => Math.hypot(x, y) < RDETAIL)); }
  indexerRues(q.routes || []);
  // verdure : taches vert sauge
  const vg = [];
  for (const v of q.verdure || []) {
    const p = pts(v.p); if (p.length < 3) continue;
    const g = new THREE.ShapeGeometry(new THREE.Shape(p.map(([x, y]) => V(x, y)))); g.rotateX(-Math.PI / 2); g.translate(0, 0.05, 0); vg.push(g);
  }
  if (vg.length) { const m = new THREE.Mesh(mergeGeometries(vg), new THREE.MeshStandardMaterial({ color: 0xd3dcc6, roughness: 1 })); m.receiveShadow = true; scene.add(m); }
  // arbres : déjà placés proprement par Jarvis (hors des murs, hors des chaussées, sans se marcher dessus)
  const arbres = q.arbres || [];
  if (arbres.length) {
    const geo = new THREE.IcosahedronGeometry(1, 0); geo.translate(0, 1, 0);       // couronne unité
    const tronc = new THREE.CylinderGeometry(0.3, 0.4, 1, 5); tronc.translate(0, 0.5, 0);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xa9bb98, roughness: 1, flatShading: true }), arbres.length);
    const it = new THREE.InstancedMesh(tronc, new THREE.MeshStandardMaterial({ color: 0x9c8b78, roughness: 1 }), arbres.length);
    const o = new THREE.Object3D();
    arbres.forEach(([x, y, h, r], i) => {
      const hc = Math.min(h * 0.6, r * 2.2), ht = Math.max(1.2, h - hc);           // tronc jusqu'à la couronne, couronne de rayon r
      o.position.set(x, ht, -y); o.scale.set(r, hc / 2, r); o.rotation.set(0, (x * 7 + y * 13) % 6, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
      o.position.set(x, 0, -y); o.scale.set(1, ht + 0.4, 1); o.updateMatrix(); it.setMatrixAt(i, o.matrix);
    });
    im.castShadow = true; it.castShadow = true; scene.add(im, it);
  }
  // routes au-delà du quartier détaillé : chaussée, trottoirs et bordures, comme au centre
  dessinerRues(q.routes || []);
  // bâtiments : un seul volume chacun, toit compris ; le sien ressort
  const bg = []; let maison = null, maisonT = 0;
  const liste = (q.batiments || []).map(b => ({ ...b, pp: pts(b.p) })).filter(b => b.pp.length >= 4);
  let mb = liste.find(b => dansPoly(0, 0, b.pp));
  if (!mb) { let bd = 1e9; for (const b of liste) for (const [x, y] of b.pp) { const d = Math.hypot(x, y); if (d < bd) { bd = d; mb = b; } } }
  for (const b of liste) {
    const pente = b.l && aireDe(b.pp) < 250 && b.t - b.h > 1.5;   // petite maison au toit en pente : un vrai toit en pente, aux hauteurs du laser
    const g = b.l && !pente ? batimentLidar(b.pp, b.l) : batiment(b.pp, Math.max(2.5, b.h), Math.max(b.h, b.t || b.h));
    if (b === mb) { maison = g; maisonPoly = b.pp; maisonH = Math.max(b.h, b.t || b.h); } else bg.push(g);
  }
  if (bg.length) {
    const all = mergeGeometries(bg.map(x => { if (!x.attributes.normal) x.computeVertexNormals(); return x; }));
    const m = new THREE.Mesh(all, new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.92, side: THREE.DoubleSide })); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(all, 35), new THREE.LineBasicMaterial({ color: 0xc8c0b3, transparent: true, opacity: 0.55 })));
  }
  if (maison) {
    // ton immeuble : gris très clair comme en vrai, avec tous ses détails (s'il a ses hauteurs mesurées)
    const m = new THREE.Mesh(maison, new THREE.MeshStandardMaterial({ color: maison.userData.hAt ? 0xeeedea : 0xf2c48a, roughness: 0.85, side: THREE.DoubleSide })); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(maison, 35), new THREE.LineBasicMaterial({ color: 0xc9c6bf })));
    if (maison.userData.hAt && LIEU === "maison") detaillerMaison(maisonPoly, maison.userData.hAt, liste.filter(b => b !== mb && b.pp.some(([x, y]) => Math.hypot(x, y) < 60)));
    const [cx, cy] = maisonPoly.slice(0, -1).reduce((a, [x, y]) => [a[0] + x / (maisonPoly.length - 1), a[1] + y / (maisonPoly.length - 1)], [0, 0]);
    maisonCentre = [cx, cy];
    // l'anneau suit le pied de l'immeuble (un liseré autour des murs), au lieu d'un cercle qui traverse les voisins
    const ligne = new THREE.BufferGeometry().setFromPoints(maisonPoly.map(([x, y]) => new THREE.Vector3(x, 0.3, -y)));
    const anneau = new THREE.Line(ligne, new THREE.LineBasicMaterial({ color: 0xe9a23b, transparent: true, opacity: 0.9 })); scene.add(anneau);
    scene.add(etiquette(LIEU === "usine" ? "🏭 Ton travail" : "Chez toi", "#2b3138", "#f5f1e8", { x: cx, y: maisonH + 4, z: -cy }, 0.028));
  }
}
const anneaux = []; // (gardé pour la boucle)

/* ---------- étiquettes (taille fixe à l'écran, comme la ville) ---------- */
function etiquette(texte, fond, encre, pos, taille = 0.045, sous = "") {
  const c = document.createElement("canvas"), x = c.getContext("2d"), dpr = 3;
  x.font = `800 ${15 * dpr}px "Plus Jakarta Sans", Arial`;
  const w1 = x.measureText(texte).width; x.font = `600 ${13 * dpr}px "Plus Jakarta Sans", Arial`; const w2 = sous ? x.measureText(sous).width : 0;
  const W = Math.ceil(Math.max(w1, w2) + 22 * dpr), H = (sous ? 44 : 28) * dpr;
  c.width = W; c.height = H;
  x.fillStyle = fond; x.fillRect(0, 0, W, H);
  x.fillStyle = encre; x.font = `800 ${15 * dpr}px "Plus Jakarta Sans", Arial`; x.textBaseline = "middle"; x.fillText(texte, 11 * dpr, (sous ? 15 : 14) * dpr);
  if (sous) { x.globalAlpha = 0.85; x.font = `600 ${13 * dpr}px "Plus Jakarta Sans", Arial`; x.fillText(sous, 11 * dpr, 32 * dpr); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, sizeAttenuation: false, depthTest: false, transparent: true }));
  s.center.set(0.5, 0); s.scale.set(taille * W / H, taille, 1); s.position.set(pos.x, pos.y, pos.z); s.renderOrder = 10;
  return s;
}

/* ---------- les lignes TCL, les arrêts ---------- */
const COUL = {};
const local = (lat, lon, c) => [(lon - c.lon) * Math.cos(c.lat * Math.PI / 180) * 111320, (lat - c.lat) * 110574];
let centre = null;
function poserLignes(carte) {
  const R = 760, g = {};
  for (const l of carte.lignes || []) {
    COUL[l.ligne] = l.couleur;
    for (const t of l.traits) {
      let seg = [];
      const rang = Math.max(0, (carte.lignes || []).findIndex(x => x.ligne === l.ligne)), dec = (rang - ((carte.lignes || []).length - 1) / 2) * 0.55;   // chaque ligne sur son propre « rail », 55 cm d'écart
      const decaler = (pl) => pl.map(([x, y], i) => { const A = pl[Math.max(0, i - 1)], B = pl[Math.min(pl.length - 1, i + 1)]; let dx = B[0] - A[0], dy = B[1] - A[1]; if (dx < 0 || (dx === 0 && dy < 0)) { dx = -dx; dy = -dy; } const L = Math.hypot(dx, dy) || 1; return [x - dy / L * dec, y + dx / L * dec]; });   // même côté quel que soit le sens du bus
      const flush = () => { if (seg.length > 1) (g[l.couleur] ||= []).push(...ruban(decaler(seg), 0.32, 0.3 + rang * 0.03)); seg = []; };
      // tracé redécoupé tous les 3 m, puis chaque point posé sur la rue la plus proche
      const brut = t.map(([la, lo]) => local(la, lo, centre)), fin = [];
      for (let i = 0; i < brut.length; i++) { if (i) { const [x1, y1] = brut[i - 1], [x2, y2] = brut[i], n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 3); for (let k = 1; k < n; k++) fin.push([x1 + (x2 - x1) * k / n, y1 + (y2 - y1) * k / n]); } fin.push(brut[i]); }
      for (let [x, y] of fin) { const r = surLaRue(x, y, 14); if (r) { x = r.x; y = r.y; } const surRoute = !RDETAIL || Math.hypot(x, y) > RDETAIL + 5; /* autour de chez toi : pas de tracés de lignes, les bus en direct suffisent */ if (x * x + y * y < R * R && surRoute) seg.push([x, y]); else flush(); }
      // chaque ligne décalée sur le côté (comme des rails parallèles), pour ne jamais se superposer à une autre

      flush();
    }
  }
  for (const [c, gs] of Object.entries(g)) scene.add(new THREE.Mesh(mergeGeometries(gs), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
  // abribus : petit toit + poteau, aux vrais emplacements
  const vus = new Set();
  for (const a of carte.arrets || []) {
    let [x, y] = local(a.lat, a.lon, centre); let ang = 0;
    const r = surLaRue(x, y, 25);
    if (r) { // posé sur le trottoir, du côté où il est vraiment, juste au bord de la chaussée
      const nx = -Math.sin(r.ang), ny = Math.cos(r.ang), cote = ((x - r.x) * nx + (y - r.y) * ny) >= 0 ? 1 : -1, off = r.w / 2 + 1.6;
      x = r.x + nx * off * cote; y = r.y + ny * off * cote; ang = r.ang + (cote > 0 ? 0 : Math.PI);
    }
    const abri = new THREE.Group();
    const toit = new THREE.Mesh(new THREE.BoxGeometry(5, 0.25, 1.8), new THREE.MeshStandardMaterial({ color: 0x2b3138 })); toit.position.y = 2.6;
    const vitre = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 0.12), new THREE.MeshStandardMaterial({ color: 0xcfe0e6, transparent: true, opacity: 0.55 })); vitre.position.set(0, 1.3, -0.8);  // la vitre du fond est côté trottoir
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.6, 6), new THREE.MeshStandardMaterial({ color: 0x2b3138 })); pot.position.set(3.2, 1.8, 0);
    abri.add(toit, vitre, pot); abri.position.set(x, RDETAIL ? 0.12 : 0, -y); abri.rotation.y = ang; ABRIS.push({ x, y, ang }); abri.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(abri);
    if (!vus.has(a.nom)) { vus.add(a.nom); if (a.nom === "Brossolette Genas") { arretLabel = etiquette("Brossolette Genas", "#2b3138", "#f5f1e8", { x, y: 9, z: -y }, 0.03, "…"); scene.add(arretLabel); arretPos = [x, y]; } }
  }
}
let arretLabel = null, arretPos = null; const ABRIS = [];

/* ---------- les bus : une petite maquette par bus, à sa vraie position GPS ---------- */
const BUS = new Map();
function maquetteBus(ligne) {
  const g = new THREE.Group(), coul = new THREE.Color(COUL[ligne] || "#2b3138");
  const caisse = new THREE.Mesh(new THREE.BoxGeometry(2.55, 2.7, 12), new THREE.MeshStandardMaterial({ color: coul, roughness: 0.6 })); caisse.position.y = 1.75;
  const toit = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 11.4), new THREE.MeshStandardMaterial({ color: 0xf5f3ee })); toit.position.y = 3.22;
  const vitres = new THREE.Mesh(new THREE.BoxGeometry(2.62, 1.0, 10.6), new THREE.MeshStandardMaterial({ color: 0x27303a, roughness: 0.3 })); vitres.position.y = 2.35;
  const avant = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.3, 0.1), new THREE.MeshStandardMaterial({ color: 0x27303a })); avant.position.set(0, 2.25, -6.02);
  const roues = new THREE.CylinderGeometry(0.5, 0.5, 2.6, 10); roues.rotateZ(Math.PI / 2);
  g.userData.roues = [];
  for (const z of [-4, 3.6]) { const r = new THREE.Mesh(roues, new THREE.MeshStandardMaterial({ color: 0x22262b })); r.position.set(0, 0.5, z); g.add(r); g.userData.roues.push(r);
    const jante = new THREE.Mesh(new THREE.BoxGeometry(2.64, 0.5, 0.12), new THREE.MeshStandardMaterial({ color: 0xc9ccce })); r.add(jante); }
  g.add(caisse, toit, vitres, avant);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  // taille réelle : un bus de 12 m tient dans sa voie
  return g;
}
function majBus(liste) {
  const vu = new Set(), t = performance.now();
  for (const b of liste) {
    let [x, y] = local(b.lat, b.lon, centre); if (x * x + y * y > 1100 * 1100) continue;
    // on rattache au bus le plus proche de la même ligne (les identifiants ne sont pas toujours fournis)
    let k = null, dmin = 260;
    for (const [kk, o] of BUS) { if (o.ligne !== b.ligne || vu.has(kk)) continue; const d = Math.hypot(o.cible[0] - x, o.cible[1] - y); if (d < dmin) { dmin = d; k = kk; } }
    const B = accrocher(x, y, 30);
    if (!k) {   // nouveau bus : posé sur la rue, tourné dans le sens de sa marche
      k = (b.id || b.ligne) + "|" + Math.random(); const m = maquetteBus(b.ligne); scene.add(m);
      const lab = etiquette(b.ligne, COUL[b.ligne] || "#2b3138", /^#(D3D8|FFF)/i.test(COUL[b.ligne] || "") ? "#2b3138" : "#ffffff", { x: 0, y: 4.5, z: 0 }, 0.018); m.add(lab);
      let tr;
      if (B) { const a = RESEAU.aretes[B.e], q = surArete(a, B.s); let sens = 1;
        if (Number.isFinite(b.cap)) { const cx = Math.sin(b.cap * Math.PI / 180), cy = Math.cos(b.cap * Math.PI / 180); sens = cx * q.tx + cy * q.ty >= 0 ? 1 : -1; }
        const s0 = Math.max(0, Math.min(a.L, B.s - sens * 4)), s1 = Math.max(0, Math.min(a.L, B.s)); tr = trajet(troncon(a, s0, s1 === s0 ? s0 + 0.01 * sens : s1)); }
      else tr = trajet([[x, y, 3], [x + 0.01, y, 3]]);
      BUS.set(k, { ligne: b.ligne, m, cible: [x, y], tr, t0: t - 15000, ang: null });
    } else {
      const o = BUS.get(k);
      const A = o.axe ? accrocher(o.axe[0], o.axe[1], 30) : null;
      if (A && B) {
        const pts = cheminRue(A, B), droit = Math.hypot(x - o.axe[0], y - o.axe[1]);
        if (pts) { const tr = trajet(pts);
          // le GPS a sauté un peu en arrière : on ne recule pas, on attend la prochaine position
          const recule = A.e === B.e && o.sens && Math.sign(B.s - A.s) === -o.sens && Math.abs(B.s - A.s) < 30;
          // jamais de demi-tour sur place : si le nouveau trajet part à l'opposé de là où le bus regarde, c'est un saut du GPS
          const p0 = pointA(tr, 0), p1 = pointA(tr, 5), demi = o.ang != null && tr.L < 120 && ((p1[0] - p0[0]) * -Math.sin(o.ang) + (p1[1] - p0[1]) * Math.cos(o.ang)) < -2;
          if (!recule && !demi && tr.L < droit * 2.5 + 40) { o.tr = tr; o.t0 = t; o.dPrec = null; if (A.e === B.e && B.s !== A.s) o.sens = Math.sign(B.s - A.s); else o.sens = 0; }
          else if (droit > 200) { const a = RESEAU.aretes[B.e]; o.tr = trajet(troncon(a, B.s, Math.min(a.L, B.s + 0.01))); o.t0 = t - 15000; o.dPrec = null; } }
      }
      o.cible = [x, y];
    }
    vu.add(k);
  }
  for (const [k, o] of BUS) if (!vu.has(k)) { scene.remove(o.m); BUS.delete(k); }
}
function animerBus(t) {
  for (const o of BUS.values()) {
    // le bus roule le long des rues de la carte, sur sa voie de droite : démarre doucement, roule régulier, freine en douceur
    const a = Math.min(1, (t - o.t0) / 15000), e = a < 0.15 ? a * a / 0.3 : a > 0.85 ? 0.85 - (1 - a) * (1 - a) / 0.3 : a - 0.075;
    const d = o.tr.L * Math.min(1, e / 0.85), p = surTrajet(o.tr, d);
    o.axe = pointA(o.tr, d);
    o.m.position.set(p.x, RDETAIL ? 0.12 : 0, -p.y);
    if (p.tx || p.ty) { const vise = Math.atan2(-p.tx, p.ty);   // l'avant du bus (vers -z) dans le sens de la marche
      if (o.ang == null) o.ang = vise; let dd = vise - o.ang; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); o.ang += dd * 0.2; o.m.rotation.y = o.ang; }
    const avance = o.dPrec == null ? 0 : Math.abs(d - o.dPrec); o.dPrec = d;
    for (const r of o.m.userData.roues || []) r.rotation.x -= avance / 0.5;
  }
}

/* ---------- les chantiers réels du Grand Lyon, mis en scène (symbolique) ----------
   Autour de chaque zone de travaux : barrières de chantier vertes et blanches (comme sur la route de Genas),
   et à quelques endroits un « atelier » : pelleteuse qui creuse, deux ouvriers en gilet orange, cônes, panneau « travaux »,
   et une petite file de voitures qui avance au ralenti à côté (le bouchon). Rien de tout ça n'est exact : ça montre où ça bouge. */
const ANIMS = [];
function panneauTravaux() {   // triangle rouge, pictogramme « travaux »
  const c = document.createElement("canvas"); c.width = 128; c.height = 128; const x = c.getContext("2d");
  x.fillStyle = "#d8262f"; x.beginPath(); x.moveTo(64, 6); x.lineTo(124, 116); x.lineTo(4, 116); x.closePath(); x.fill();
  x.fillStyle = "#ffffff"; x.beginPath(); x.moveTo(64, 30); x.lineTo(104, 104); x.lineTo(24, 104); x.closePath(); x.fill();
  x.fillStyle = "#1d1d1d"; x.beginPath(); x.arc(58, 56, 7, 0, 7); x.fill(); x.fillRect(52, 64, 10, 22); x.fillRect(46, 70, 26, 5); x.fillRect(70, 62, 4, 28);
  x.beginPath(); x.moveTo(64, 98); x.lineTo(90, 98); x.lineTo(80, 84); x.closePath(); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function pelleteuse() {
  const g = new THREE.Group(), jaune = new THREE.MeshStandardMaterial({ color: 0xf2b215, roughness: 0.55 }), noir = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.8 });
  const vitre = new THREE.MeshStandardMaterial({ color: 0x33424d, roughness: 0.2, metalness: 0.3 });
  for (const s of [-1, 1]) { const ch = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.75, 0.6), noir); ch.position.set(0, 0.38, s * 1.0); g.add(ch); }
  const tour = new THREE.Group(); tour.position.y = 0.85; g.add(tour);
  const corps = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 2.2), jaune); corps.position.set(-0.3, 0.5, 0); tour.add(corps);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.35, 1.0), jaune); cab.position.set(0.45, 1.65, 0.55); tour.add(cab);
  const vit = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.75, 0.9), vitre); vit.position.set(0.47, 1.85, 0.55); tour.add(vit);
  const bras = new THREE.Group(); bras.position.set(0.8, 1.0, -0.4); tour.add(bras);
  const b1 = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.32, 0.32), jaune); b1.position.x = 1.3; bras.add(b1);
  const coude = new THREE.Group(); coude.position.x = 2.6; bras.add(coude);
  const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.9, 0.28), jaune); b2.position.y = -0.95; coude.add(b2);
  const godet = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.75), noir); godet.position.set(0.2, -1.95, 0); coude.add(godet);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { g, tour, bras, coude };
}
function ouvrier(gilet) {
  const g = new THREE.Group(), peau = new THREE.MeshStandardMaterial({ color: 0xc89b7b, roughness: 0.8 });
  const jambes = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.85, 0.24), new THREE.MeshStandardMaterial({ color: 0x2f3a4a })); jambes.position.y = 0.43;
  const buste = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.28), new THREE.MeshStandardMaterial({ color: gilet, roughness: 0.6, emissive: gilet, emissiveIntensity: 0.15 })); buste.position.y = 1.17;
  const tete = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), peau); tete.position.y = 1.62;
  const casque = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf4f4f0 })); casque.position.y = 1.66;
  const bras = new THREE.Group(); bras.position.set(0.27, 1.42, 0); const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), new THREE.MeshStandardMaterial({ color: gilet })); b.position.y = -0.28; bras.add(b);
  const pelle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x7a5a3a })); pelle.position.set(0, -0.6, 0.15); pelle.rotation.x = 0.5; bras.add(pelle);
  g.add(jambes, buste, tete, casque, bras); g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { g, bras };
}
function rayures() {   // barrière de chantier pleine : bandes rouges et blanches en biais, bien visibles de loin
  const c = document.createElement("canvas"); c.width = 128; c.height = 64; const x = c.getContext("2d");
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, 128, 64); x.fillStyle = "#e0262e";
  for (let i = -64; i < 160; i += 32) { x.beginPath(); x.moveTo(i, 64); x.lineTo(i + 16, 64); x.lineTo(i + 48, 0); x.lineTo(i + 32, 0); x.closePath(); x.fill(); }
  x.strokeStyle = "#b8b8b4"; x.lineWidth = 4; x.strokeRect(2, 2, 124, 60);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/* ---------- au-delà du quartier détaillé : les rues dessinées comme dans le centre ----------
   chaussée en bitume (même grain), trottoirs clairs, bordures en relief ; puis (une fois le réseau des rues prêt)
   marquage au milieu, passages piétons aux carrefours et lampadaires — sur toute la carte. */
function grainBitume(base, amp) {
  const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d"), col = new THREE.Color(base);
  const img = x.createImageData(256, 256); let g = 777; const al = () => { g = (g * 1103515245 + 12345) & 0x7fffffff; return g / 0x7fffffff; };
  for (let i = 0; i < 256 * 256; i++) { const n = (al() - 0.5) * amp + (al() < 0.01 ? -10 : 0); img.data[i * 4] = col.r * 255 + n; img.data[i * 4 + 1] = col.g * 255 + n; img.data[i * 4 + 2] = col.b * 255 + n; img.data[i * 4 + 3] = 255; }
  x.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function uvMonde(g, k) { const p = g.attributes.position, uv = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / k; uv[i * 2 + 1] = p.getZ(i) / k; } g.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); return g; }
function dessinerRues(routes) {
  const chaussee = [], trottoir = [], bord = [];
  for (const r of routes) { const l = pts(r.p);
    let seg = [];
    const vider = () => { if (seg.length > 1) {
        chaussee.push(...ruban(seg, r.w, 0.125)); if (r.w >= 4) trottoir.push(...ruban(seg, r.w + 4.4, 0.118));
        if (r.w >= 4) for (const sg of [-1, 1]) for (let i = 0; i < seg.length - 1; i++) { const [x1, y1] = seg[i], [x2, y2] = seg[i + 1], L = Math.hypot(x2 - x1, y2 - y1); if (L < 0.3) continue;
          const nx = -(y2 - y1) / L * sg * (r.w / 2 + 0.1), ny = (x2 - x1) / L * sg * (r.w / 2 + 0.1), n = Math.ceil(L), ang = Math.atan2(y2 - y1, x2 - x1);
          for (let j = 0; j < n; j++) { const f = (j + 0.5) / n, x = x1 + (x2 - x1) * f + nx, y = y1 + (y2 - y1) * f + ny; if (surAutreRue(x, y, r, -0.3)) continue;
            const b = new THREE.BoxGeometry(L / n + 0.02, 0.15, 0.2); b.rotateY(ang); b.translate(x, 0.195, -y); bord.push(b.toNonIndexed()); } } }
      seg = []; };
    for (let k = 0; k < l.length; k++) { const [x, y] = l[k], dedans = RDETAIL && Math.hypot(x, y) < RDETAIL - 2;
      if (dedans) { if (seg.length) { seg.push(l[k]); vider(); } } else { if (!seg.length && k > 0) seg.push(l[k - 1]); seg.push(l[k]); } }
    vider(); }
  const poser = (arr, mat) => { if (!arr.length) return; const g = mergeGeometries(arr.map(x => x.index ? x.toNonIndexed() : x)); uvMonde(g, 6); const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m); };
  poser(trottoir, new THREE.MeshStandardMaterial({ map: grainBitume(CSOL[0], 6), roughness: 1 }));
  poser(chaussee, new THREE.MeshStandardMaterial({ map: grainBitume(CSOL[1], 14), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }));
  if (bord.length) { const m = new THREE.Mesh(mergeGeometries(bord), new THREE.MeshStandardMaterial({ color: 0xe4ded3, roughness: 0.9 })); m.castShadow = m.receiveShadow = true; scene.add(m); }
}
function habillerRues() {   // une fois le réseau prêt : marquages, passages piétons et lampadaires hors du quartier détaillé
  if (!RESEAU) return; const { aretes, noeuds } = RESEAU, hors = (x, y) => !RDETAIL || Math.hypot(x, y) > RDETAIL + 1;
  const tirets = [], bandes = [], lamp = [];
  const deg = n => n.a.length + (n.bout || 0);
  for (const a of aretes) {
    const libre = s => !((s < 12 && deg(a.n0) >= 3) || (a.L - s < 12 && deg(a.n1) >= 3));
    if (a.w >= 7) for (let s = 4; s < a.L - 3; s += 8) { if (!libre(s)) continue; const q = surArete(a, s); if (!hors(q.x, q.y) || surAutreRue(q.x, q.y, a.src, -1.5)) continue;
      const b = new THREE.BoxGeometry(3, 0.02, 0.15); b.rotateY(Math.atan2(q.ty, q.tx)); b.translate(q.x, 0.135, -q.y); tirets.push(b); }
    let cote = 1;
    for (let s = 10; s < a.L - 6; s += 28) { const q = surArete(a, s); if (!hors(q.x, q.y)) continue; cote = -cote;
      const v = cote * (q.hw + 1.4); lamp.push([q.x - q.ty * v, q.y + q.tx * v, Math.atan2(-cote * q.tx, cote * q.ty)]); }
  }
  // passages piétons : sur chaque branche d'un carrefour, à 7 m du centre, sur toute la largeur de la chaussée
  for (const n of noeuds) { if (deg(n) < 3 || !hors(n.x, n.y)) continue;
    const large = Math.max(...n.a.map(e => aretes[e].w)) / 2;   // le passage se pose juste après la chaussée de la plus grande rue du carrefour
    for (const e of n.a) { const a = aretes[e], d0 = (a.w / 2 >= large ? Math.max(...n.a.filter(f => f !== e).map(f => aretes[f].w / 2), 3) : large) + 2.2; if (a.L < d0 + 8 || a.w < 5) continue;
      const s = a.n0 === n ? d0 : a.L - d0, q = surArete(a, s), ang = Math.atan2(q.ty, q.tx);
      for (let v = -q.hw + 0.45; v <= q.hw - 0.3; v += 1) { const zx = q.x - q.ty * v, zy = q.y + q.tx * v; if (surAutreRue(zx, zy, a.src, 0)) continue; const g = new THREE.BoxGeometry(2.6, 0.025, 0.5); g.rotateY(ang); g.translate(q.x - q.ty * v, 0.135, -(q.y + q.tx * v)); bandes.push(g); } } }
  const blanc = new THREE.MeshStandardMaterial({ color: 0xfafaf7, roughness: 0.7 });
  if (tirets.length) scene.add(new THREE.Mesh(mergeGeometries(tirets), blanc));
  if (bandes.length) { const m = new THREE.Mesh(mergeGeometries(bandes), blanc); m.receiveShadow = true; scene.add(m); }
  if (lamp.length) {
    const o = new THREE.Object3D(), pied = new THREE.CylinderGeometry(0.07, 0.1, 6, 6); pied.translate(0, 3.1, 0); const tete = new THREE.BoxGeometry(0.9, 0.12, 0.3); tete.translate(0.35, 6.05, 0);
    const ip = new THREE.InstancedMesh(pied, new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6 }), lamp.length), it = new THREE.InstancedMesh(tete, new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffe2a0, emissiveIntensity: 0.6 }), lamp.length);
    lamp.forEach(([x, y, a], i) => { o.position.set(x, 0, -y); o.rotation.set(0, a, 0); o.updateMatrix(); ip.setMatrixAt(i, o.matrix); it.setMatrixAt(i, o.matrix); }); ip.castShadow = true; scene.add(ip, it);
  }
}

/* ---------- le réseau des rues : la ligne directrice de tout ce qui bouge ----------
   Chaque rue de la carte devient un « fil » échantillonné tous les 2 m, recentré sur la vraie chaussée dessinée
   (dans le quartier détaillé), avec sa demi-largeur. Les voitures, les bus et les chantiers suivent ces fils. */
let RESEAU = null;
function construireReseau(routes) {
  const aretes = [], noeuds = [], gN = new Map(), gS = new Map();
  const noeud = (x, y) => {
    const ix = Math.floor(x / 4), iy = Math.floor(y / 4);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const n of gN.get((ix + i) + "|" + (iy + j)) || []) if (Math.hypot(n.x - x, n.y - y) < 1.5) return n;
    const n = { x, y, a: [], id: noeuds.length }; noeuds.push(n); const k = ix + "|" + iy; (gN.get(k) || gN.set(k, []).get(k)).push(n); return n;
  };
  for (const r of routes) {
    const l = pts(r.p); if (l.length < 2) continue;
    if (r.w < 4) { if (l.length <= 12) { noeud(l[0][0], l[0][1]).bout = (noeud(l[0][0], l[0][1]).bout || 0) + 1; const f = l[l.length - 1]; noeud(f[0], f[1]).bout = (noeud(f[0], f[1]).bout || 0) + 1; } continue; }   // petites rues : pas de circulation, mais elles font des carrefours
    if (!l.some(([x, y]) => x * x + y * y < 650 * 650)) continue;
    const P = []; let t0 = 0;
    for (let i = 0; i < l.length - 1; i++) { const [x1, y1] = l[i], [x2, y2] = l[i + 1], L = Math.hypot(x2 - x1, y2 - y1); if (L < 0.01) continue;
      let t = t0; for (; t < L; t += 2) P.push([x1 + (x2 - x1) * t / L, y1 + (y2 - y1) * t / L]); t0 = t - L; }
    const fin = l[l.length - 1]; if (P.length && Math.hypot(P[P.length - 1][0] - fin[0], P[P.length - 1][1] - fin[1]) < 0.8) P.pop(); P.push(fin.slice());
    if (P.length < 2) continue;
    const n = P.length, c = new Float32Array(n), hw = new Float32Array(n).fill(r.w / 2), T = [];
    for (let k = 0; k < n; k++) { const a = P[Math.max(0, k - 1)], b = P[Math.min(n - 1, k + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; T.push([(b[0] - a[0]) / L, (b[1] - a[1]) / L]); }
    // recentrage sur la chaussée réellement dessinée (bordures du Grand Lyon) : on cherche, en travers, la bande de chaussée qui contient l'axe
    if (SOL) for (let k = 0; k < n; k++) { const [x, y] = P[k], nx = -T[k][1], ny = T[k][0]; if (Math.hypot(x, y) > RDETAIL - 4) continue;
      let best = null, a = null; const lim = r.w + 3;
      for (let v = -lim; v <= lim + 0.01; v += 0.4) { const dedans = cellSol(x + nx * v, y + ny * v) === 1;
        if (dedans && a === null) a = v; if ((!dedans || v + 0.4 > lim) && a !== null) { const b = dedans ? v : v - 0.4, d = Math.max(0, a - 0, 0 - b); if (b - a >= 2.8 && (!best || d < best.d)) best = { a, b, d }; a = null; } }
      if (best && best.d < 2.5) { c[k] = (best.a + best.b) / 2; hw[k] = (best.b - best.a) / 2; } }
    const lisse = (f) => { const g = f.slice(); for (let k = 0; k < n; k++) { let s = 0, m = 0; for (let j = Math.max(0, k - 3); j <= Math.min(n - 1, k + 3); j++) { s += f[j]; m++; } g[k] = s / m; } return g; };
    const cc = lisse(c), hh = lisse(hw);
    const p = P.map(([x, y], k) => [x - T[k][1] * cc[k], y + T[k][0] * cc[k]]);
    const cum = [0]; for (let k = 1; k < n; k++) cum.push(cum[k - 1] + Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]));
    const a = { src: r, p, cum, hw: hh, w: r.w, nom: r.n || "", L: cum[n - 1], ferme: new Int8Array(n), n0: noeud(l[0][0], l[0][1]), n1: noeud(fin[0], fin[1]), id: aretes.length };
    if (a.L < 1) continue;
    a.n0.a.push(a.id); a.n1.a.push(a.id); aretes.push(a);
    for (let k = 0; k < n; k++) { const key = Math.floor(p[k][0] / 20) + "|" + Math.floor(p[k][1] / 20); (gS.get(key) || gS.set(key, []).get(key)).push([a.id, k]); }
  }
  return { aretes, noeuds, gS };
}
function surArete(a, s) {   // position, direction et demi-largeur à la distance s le long d'une rue
  s = Math.max(0, Math.min(a.L, s)); const n = a.p.length;
  let k = Math.min(n - 2, Math.max(0, Math.floor(s / 2))); while (k > 0 && a.cum[k] > s) k--; while (k < n - 2 && a.cum[k + 1] < s) k++;
  const L = (a.cum[k + 1] - a.cum[k]) || 1, f = Math.max(0, Math.min(1, (s - a.cum[k]) / L)), [x1, y1] = a.p[k], [x2, y2] = a.p[k + 1];
  return { x: x1 + (x2 - x1) * f, y: y1 + (y2 - y1) * f, tx: (x2 - x1) / L, ty: (y2 - y1) / L, k, hw: a.hw[k] + (a.hw[k + 1] - a.hw[k]) * f };
}
function accrocher(x, y, max = 25) {   // le point de rue le plus proche
  if (!RESEAU) return null; let best = null;
  const r = Math.ceil(max / 20), ix = Math.floor(x / 20), iy = Math.floor(y / 20);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (const [e, k] of RESEAU.gS.get((ix + i) + "|" + (iy + j)) || []) {
    const a = RESEAU.aretes[e], [px, py] = a.p[k], d = Math.hypot(px - x, py - y); if (d < max && (!best || d < best.d)) best = { e, k, d }; }
  if (!best) return null;
  const a = RESEAU.aretes[best.e], k = best.k, k2 = k < a.p.length - 1 ? k + 1 : k - 1, [x1, y1] = a.p[Math.min(k, k2)], [x2, y2] = a.p[Math.max(k, k2)];
  const L = Math.hypot(x2 - x1, y2 - y1) || 1, f = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / (L * L)));
  return { e: best.e, s: a.cum[Math.min(k, k2)] + f * L, d: best.d };
}
function troncon(a, s0, s1) {   // les points d'une rue entre s0 et s1, dans le sens du trajet
  const out = [], q = surArete(a, s0); out.push([q.x, q.y, q.hw]);
  if (s1 > s0) { for (let k = 0; k < a.p.length; k++) if (a.cum[k] > s0 && a.cum[k] < s1) out.push([a.p[k][0], a.p[k][1], a.hw[k]]); }
  else { for (let k = a.p.length - 1; k >= 0; k--) if (a.cum[k] < s0 && a.cum[k] > s1) out.push([a.p[k][0], a.p[k][1], a.hw[k]]); }
  const r = surArete(a, s1); out.push([r.x, r.y, r.hw]); return out;
}
function cheminRue(A, B) {   // le plus court chemin par les rues, de A à B (points accrochés)
  const { aretes, noeuds } = RESEAU, ea = aretes[A.e], eb = aretes[B.e];
  if (A.e === B.e) return troncon(ea, A.s, B.s);
  const dist = new Map(), prev = new Map(), ouverts = new Set();
  const poser = (n, d, pr) => { if (!dist.has(n.id) || d < dist.get(n.id)) { dist.set(n.id, d); prev.set(n.id, pr); ouverts.add(n); } };
  poser(ea.n0, A.s, null); poser(ea.n1, ea.L - A.s, null);
  const fini = new Set();
  while (ouverts.size) { let n = null; for (const o of ouverts) if (!n || dist.get(o.id) < dist.get(n.id)) n = o; ouverts.delete(n); fini.add(n.id);
    const d = dist.get(n.id); if (d > 900) break;
    for (const e of n.a) { if (e === A.e) continue; const a = aretes[e], m = a.n0 === n ? a.n1 : a.n0; if (fini.has(m.id)) continue; poser(m, d + a.L, { n, e }); } }
  const c0 = dist.has(eb.n0.id) ? dist.get(eb.n0.id) + B.s : Infinity, c1 = dist.has(eb.n1.id) ? dist.get(eb.n1.id) + eb.L - B.s : Infinity;
  if (!Number.isFinite(Math.min(c0, c1))) return null;
  const entree = c0 <= c1 ? eb.n0 : eb.n1, seq = []; let n = entree;
  while (prev.get(n.id)) { const pr = prev.get(n.id); seq.unshift({ e: pr.e, de: pr.n }); n = pr.n; }
  const depart = n, out = troncon(ea, A.s, depart === ea.n0 ? 0 : ea.L);
  for (const { e, de } of seq) { const a = aretes[e]; out.push(...troncon(a, de === a.n0 ? 0 : a.L, de === a.n0 ? a.L : 0).slice(1)); }
  out.push(...troncon(eb, entree === eb.n0 ? 0 : eb.L, B.s).slice(1));
  return out;
}
// un trajet : points + longueurs cumulées ; position et direction à la distance d, décalé sur la voie de droite
function trajet(pts) { const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { pts, cum, L: cum[cum.length - 1] }; }
function surTrajet(tr, d, voie) {
  const { pts: P, cum } = tr; if (P.length === 1) return { x: P[0][0], y: P[0][1], tx: 0, ty: 0 };
  d = Math.max(0, Math.min(tr.L, d)); let i = 0; while (i < P.length - 2 && cum[i + 1] < d) i++;
  const L = (cum[i + 1] - cum[i]) || 1, f = (d - cum[i]) / L, x = P[i][0] + (P[i + 1][0] - P[i][0]) * f, y = P[i][1] + (P[i + 1][1] - P[i][1]) * f;
  // direction lissée (on regarde 3 m devant et derrière) : pas de virage sec, pas de « patinage »
  const av = pointA(tr, d + 3), ar = pointA(tr, d - 3); let tx = av[0] - ar[0], ty = av[1] - ar[1]; const n = Math.hypot(tx, ty) || 1; tx /= n; ty /= n;
  const hw = P[i][2] || 3, dec = voie != null ? voie : (hw >= 2.6 ? Math.min(hw / 2, 3.2) : 0);
  return { x: x + ty * dec, y: y - tx * dec, tx, ty };
}
function pointA(tr, d) { const { pts: P, cum } = tr; d = Math.max(0, Math.min(tr.L, d)); let i = 0; while (i < P.length - 2 && cum[i + 1] < d) i++; const L = (cum[i + 1] - cum[i]) || 1, f = (d - cum[i]) / L; return [P[i][0] + (P[i + 1][0] - P[i][0]) * f, P[i][1] + (P[i + 1][1] - P[i][1]) * f]; }

/* ---------- la circulation : des voitures qui roulent sur la voie de droite, qui suivent les rues,
   ralentissent aux chantiers (et passent sur l'autre voie si la leur est fermée), et gardent leurs distances ---------- */
const VOITURES = [];
function lancerCirculation() {
  if (!RESEAU) return; const { aretes, noeuds } = RESEAU;
  // grands axes partout ; petites rues seulement hors du quartier détaillé (là où il y a des voitures garées, on n'en fait pas rouler)
  const ok = aretes.map(a => a.w >= 9 || (a.w >= 5 && a.p.every(([x, y]) => Math.hypot(x, y) > RDETAIL + 5)));
  const pool = aretes.filter((a, i) => ok[i] && a.p.some(([x, y]) => Math.hypot(x, y) < 650));
  const total = pool.reduce((s, a) => s + a.L * (a.w >= 9 ? 2 : 0.6), 0), nb = Math.min(110, Math.round(total / 45));
  if (!nb) return;
  let graine = 4242; const alea = () => { graine = (graine * 1103515245 + 12345) & 0x7fffffff; return graine / 0x7fffffff; };
  const tire = () => { let r = alea() * total; for (const a of pool) { r -= a.L * (a.w >= 9 ? 2 : 0.6); if (r <= 0) return a; } return pool[pool.length - 1]; };
  const teintes = [0xf4f2ee, 0x2e3237, 0x9aa1a8, 0x6f7b86, 0xb8442f, 0x2f4d6e, 0xd9d4c7, 0x55606a, 0x8a1f2b, 0xe9e4d6];
  for (let i = 0; i < nb; i++) { const a = tire(); VOITURES.push({ e: a.id, s: alea() * a.L, dir: alea() < 0.5 ? 1 : -1, v: 6, vmax: (a.w >= 9 ? 11 : 8) * (0.85 + alea() * 0.3), off: null, x: 0, y: 0, ang: 0 }); }
  const caisse = new THREE.BoxGeometry(4.2, 0.78, 1.8); caisse.translate(0, 0.62, 0);
  const toit = new THREE.BoxGeometry(2.2, 0.55, 1.58); toit.translate(-0.25, 1.27, 0);
  const feux = new THREE.BoxGeometry(0.06, 0.16, 1.5); feux.translate(-2.12, 0.78, 0);
  const phares = new THREE.BoxGeometry(0.06, 0.14, 1.4); phares.translate(2.12, 0.72, 0);
  const ic = new THREE.InstancedMesh(caisse, new THREE.MeshStandardMaterial({ roughness: 0.4 }), nb);
  const it = new THREE.InstancedMesh(toit, new THREE.MeshStandardMaterial({ color: 0x27303a, roughness: 0.2 }), nb);
  const ifx = new THREE.InstancedMesh(feux, new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff2a2a, emissiveIntensity: 1.2 }), nb);
  const iph = new THREE.InstancedMesh(phares, new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff2c8, emissiveIntensity: 0.8 }), nb);
  const col = new THREE.Color(); for (let i = 0; i < nb; i++) { col.setHex(teintes[Math.floor(alea() * teintes.length)]); ic.setColorAt(i, col); }
  for (const m of [ic, it, ifx, iph]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; }
  ic.castShadow = true; scene.add(ic, it, ifx, iph);
  const o = new THREE.Object3D(); let avant = null;
  ANIMS.push(t => {
    const dt = avant == null ? 0 : Math.min(0.1, (t - avant) / 1000); avant = t;
    for (const c of VOITURES) {
      let a = aretes[c.e], q = surArete(a, c.s);
      const cote = c.dir > 0 ? -1 : 1, ferme = a.ferme[q.k];   // ma voie (côté droit) est-elle fermée par un chantier ?
      const cible = ferme === cote ? 2.5 : ferme ? 4 : c.vmax;
      c.v += Math.max(-6 * dt, Math.min(2.5 * dt, cible - c.v));
      c.s += c.v * dt * c.dir;
      if (c.s < 0 || c.s > a.L) {   // bout de la rue : on continue sur une autre rue du carrefour (jamais demi-tour sauf impasse)
        const n = c.dir > 0 ? a.n1 : a.n0, reste = c.dir > 0 ? c.s - a.L : -c.s, choix = n.a.filter(e => e !== c.e && ok[e]);
        if (choix.length) { const e = choix[Math.floor(alea() * choix.length)], b = aretes[e]; c.e = e; c.dir = b.n0 === n ? 1 : -1; c.s = c.dir > 0 ? reste : b.L - reste; }
        else { c.dir = -c.dir; c.s = Math.max(0, Math.min(a.L, c.s)); }
        a = aretes[c.e];
      }
    }
    // distances de sécurité : sur une même rue et dans le même sens, on ne rattrape pas la voiture de devant
    const files = new Map(); for (const c of VOITURES) { const k = c.e + (c.dir > 0 ? "+" : "-"); (files.get(k) || files.set(k, []).get(k)).push(c); }
    for (const [, f] of files) { f.sort((p, q) => (q.s - p.s) * q.dir); for (let i = 1; i < f.length; i++) { const dev = f[i - 1], c = f[i]; if ((dev.s - c.s) * c.dir < 7.5) { c.s = dev.s - 7.5 * c.dir; c.v = Math.min(c.v, dev.v); } } }
    VOITURES.forEach((c, i) => {
      const a = aretes[c.e], q = surArete(a, c.s), cote = c.dir > 0 ? -1 : 1, ferme = a.ferme[q.k];
      const voie = Math.min(q.hw / 2, 3.2) * (ferme === cote ? -0.6 : 1);
      c.off = c.off == null ? voie : c.off + (voie - c.off) * Math.min(1, dt * 1.5);
      const tx = q.tx * c.dir, ty = q.ty * c.dir, x = q.x + ty * c.off, y = q.y - tx * c.off;
      const ang = Math.atan2(ty, tx); let d = ang - c.ang; d = Math.atan2(Math.sin(d), Math.cos(d)); c.ang += d * Math.min(1, dt * 8);
      o.position.set(x, 0.12, -y); o.rotation.set(0, c.ang, 0); o.updateMatrix();
      ic.setMatrixAt(i, o.matrix); it.setMatrixAt(i, o.matrix); ifx.setMatrixAt(i, o.matrix); iph.setMatrixAt(i, o.matrix);
    });
    for (const m of [ic, it, ifx, iph]) m.instanceMatrix.needsUpdate = true;
  });
}

/* ---------- les chantiers : on prend l'info du Grand Lyon (où, jusqu'à quand, quelle gêne)
   et on simule le chantier SUR la rue de la carte : une voie fermée tout du long, barrières sur la ligne du milieu,
   barrières en travers aux deux bouts, rien sur les carrefours (on laisse 9 m libres), trottoirs jamais touchés. ---------- */
function poserChantiers(liste) {
  if (!RESEAU) return null; const { aretes } = RESEAU;
  const zones = [];
  for (const c of liste.filter(c => c.en_cours)) for (const f of c.l) { const p = pts(f); if (p.length < 4) continue;
    let b = [1e9, 1e9, -1e9, -1e9]; for (const [x, y] of p) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]; zones.push({ c, p, b }); }
  const dans = (x, y) => { for (let i = 0; i < zones.length; i++) { const z = zones[i]; if (x < z.b[0] || y < z.b[1] || x > z.b[2] || y > z.b[3]) continue; if (dansPoly(x, y, z.p)) return i; } return -1; };
  const libre = (a, s) => { const q = surArete(a, s);
    if ((s < 10 && a.n0.a.length + (a.n0.bout || 0) >= 3) || (a.L - s < 10 && a.n1.a.length + (a.n1.bout || 0) >= 3)) return false;
    return !(SOL && (SOL.zebras || SOL.passages || []).some(([px, py]) => Math.hypot(px - q.x, py - q.y) < 7.5)); };
  const runs = [];
  for (const a of aretes) {
    if (a.w < 5) continue;
    const n = a.p.length, z = new Int16Array(n).fill(-1), g = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const q = surArete(a, a.cum[k]), nx = -q.ty, ny = q.tx, [x, y] = a.p[k];
      if (!libre(a, a.cum[k])) continue;   // carrefours et passages piétons restent libres
      const zl = dans(x + nx * q.hw / 2, y + ny * q.hw / 2), zr = dans(x - nx * q.hw / 2, y - ny * q.hw / 2), zc = dans(x, y);
      const zi = zc >= 0 ? zc : zl >= 0 ? zl : zr; if (zi < 0) continue; z[k] = zi; g[k] = (zl >= 0 ? 1 : 0) - (zr >= 0 ? 1 : 0);
    }
    for (let k = 0; k < n;) { if (z[k] < 0) { k++; continue; } let j = k; let gg = 0; while (j < n && z[j] === z[k]) { gg += g[j]; j++; }
      if (a.cum[j - 1] - a.cum[k] >= 12) { const cote = gg > 0 ? 1 : gg < 0 ? -1 : (a.id % 2 ? 1 : -1); for (let m = k; m < j; m++) a.ferme[m] = cote;
        runs.push({ a, s0: a.cum[k], s1: a.cum[j - 1], cote, zone: zones[z[k]], d: Math.hypot(...a.p[(k + j) >> 1]) }); }
      k = j; }
  }
  runs.sort((p, q) => p.d - q.d);
  const barr = [], fins = [], cones = [], ateliers = [], Y = 0.14, etiquetees = new Set();
  const lat = (a, s, v) => { const q = surArete(a, s); return [q.x - q.ty * v, q.y + q.tx * v, Math.atan2(q.ty, q.tx), q.hw]; };   // v > 0 : à gauche de l'axe
  for (const r of runs) {
    const { a, s0, s1, cote } = r; if (barr.length > 2500) break;
    // barrières sur la ligne du milieu, tout du long, en suivant la courbe de la rue
    for (let s = s0 + 1; s <= s1 - 0.9; s += 2.1) { const [x, y, ang] = lat(a, s, cote * 0.35); barr.push([x, y, ang]); }
    // en travers aux deux bouts, jusqu'au bord du trottoir ; gyrophare au coin ; cônes en biais devant
    for (const [s, sens] of [[s0, -1], [s1, 1]]) { const hw = surArete(a, s).hw, n = Math.max(1, Math.round((hw - 0.7) / 2.1));
      for (let i = 0; i < n; i++) { const v = cote * (0.35 + (hw - 0.75) * (i + 0.5) / n), [x, y, ang] = lat(a, s, v); barr.push([x, y, ang + Math.PI / 2]); }
      const [fx, fy] = lat(a, s, cote * 0.35); fins.push([fx, fy]);
      for (let i = 1; i <= 4; i++) { const ss = s + sens * i * 2.4; if (ss < 0 || ss > a.L || !libre(a, ss)) break; const [x, y] = lat(a, ss, cote * (0.35 + (hw - 0.8) * (1 - i / 5))); cones.push([x, y]); } }
    // les ateliers : sur la voie fermée, tous les ~90 m, jamais deux trop près
    for (let s = s0 + 11; s <= s1 - 11 && ateliers.length < 10; s += 90) {
      const [x, y, ang, hw] = lat(a, s, cote * (surArete(a, s).hw / 2 + 0.15)); if (ateliers.some(t => Math.hypot(t.x - x, t.y - y) < 70)) continue;
      ateliers.push({ x, y, ang, hw, a, s, cote, zone: r.zone, r });
    }
    // panneau « travaux » sur le trottoir, 15 m avant le chantier, face aux voitures qui arrivent sur la voie fermée
    { const sp = cote < 0 ? s0 - 15 : s1 + 15; if (sp > 0 && sp < a.L) { const [x, y, ang, hw] = lat(a, sp, cote * (surArete(a, sp).hw + 0.7)); r.panneau = [x, y, ang]; } }
  }
  const o = new THREE.Object3D();
  if (barr.length) {
    const panneau = new THREE.BoxGeometry(2.0, 1.0, 0.22); panneau.translate(0, 0.75, 0);
    const pied = new THREE.BoxGeometry(0.3, 0.25, 0.9); pied.translate(-0.8, 0.12, 0); const pied2 = pied.clone(); pied2.translate(1.6, 0, 0);
    const ip = new THREE.InstancedMesh(panneau, new THREE.MeshStandardMaterial({ map: rayures(), roughness: 0.6 }), barr.length);
    const ie = new THREE.InstancedMesh(mergeGeometries([pied, pied2]), new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.8 }), barr.length);
    barr.forEach(([x, y, a], i) => { o.position.set(x, Y, -y); o.rotation.set(0, a, 0); o.updateMatrix(); ip.setMatrixAt(i, o.matrix); ie.setMatrixAt(i, o.matrix); });
    ip.castShadow = ie.castShadow = true; scene.add(ip, ie);
  }
  if (fins.length) {
    const feu = new THREE.MeshStandardMaterial({ color: 0xffa21a, emissive: 0xff8a00, emissiveIntensity: 1.5 });
    const g = new THREE.SphereGeometry(0.28, 12, 8); g.translate(0, 1.55, 0); const im = new THREE.InstancedMesh(g, feu, fins.length);
    fins.forEach(([x, y], i) => { o.position.set(x, Y, -y); o.rotation.set(0, 0, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); scene.add(im);
    ANIMS.push(t => { feu.emissiveIntensity = (Math.floor(t / 450) % 2) ? 2.2 : 0.2; });
  }
  if (cones.length) {
    const cg = new THREE.ConeGeometry(0.32, 0.85, 10); cg.translate(0, 0.45, 0); const bg = new THREE.CylinderGeometry(0.2, 0.25, 0.14, 10); bg.translate(0, 0.5, 0);
    const ic = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: 0xf06a1d, roughness: 0.6, emissive: 0xf06a1d, emissiveIntensity: 0.15 }), cones.length);
    const ib = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ color: 0xf6f6f2 }), cones.length);
    cones.forEach(([x, y], i) => { o.position.set(x, Y, -y); o.rotation.set(0, 0, 0); o.updateMatrix(); ic.setMatrixAt(i, o.matrix); ib.setMatrixAt(i, o.matrix); }); ic.castShadow = true; scene.add(ic, ib);
  }
  const triangle = new THREE.MeshStandardMaterial({ map: panneauTravaux(), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
  const blancM = new THREE.MeshStandardMaterial({ color: 0xf6f6f2 });
  for (const r of runs) if (r.panneau) { const [x, y, ang] = r.panneau;
    const pan = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), triangle); pan.position.set(x, Y + 1.9, -y); pan.rotation.y = ang + Math.PI / 2; scene.add(pan);
    const mat = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 6), blancM); mat.position.set(x, Y + 0.65, -y); scene.add(mat); }
  ateliers.forEach((at, k) => {
    const { a, s, cote } = at, grp = new THREE.Group(); scene.add(grp);
    const pose = (obj, ds, v, rot = 0, h = 0) => { const [x, y, ang] = lat(a, s + ds, v); obj.position.set(x, Y + h, -y); obj.rotation.y = ang + rot; grp.add(obj); };
    const vc = cote * (at.hw / 2 + 0.15);
    pose(new THREE.Mesh(new THREE.BoxGeometry(7, 0.08, Math.max(1.6, at.hw - 1.4)), new THREE.MeshStandardMaterial({ color: 0x6b5340, roughness: 1 })), 1, vc, 0, 0.03);
    pose(new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.3, 9), new THREE.MeshStandardMaterial({ color: 0x8a6c50, roughness: 1, flatShading: true })), 7, vc, 0, 0.65);
    const pel = pelleteuse(); pel.g.scale.setScalar(1.3); pose(pel.g, -5.5, vc, 0);
    const dec = k * 1.7;
    ANIMS.push(t => { const u = t / 1000 + dec, c = (Math.sin(u * 0.7) + 1) / 2;
      pel.tour.rotation.y = -0.1 + 0.5 * Math.max(0, Math.sin(u * 0.35)); pel.bras.rotation.z = 0.15 - 0.35 * c; pel.coude.rotation.z = -0.25 + 0.55 * c; });
    const o1 = ouvrier(0xf06a1d); o1.g.scale.setScalar(1.5); pose(o1.g, 2, vc + cote * 0.4, Math.PI / 2);
    const o2 = ouvrier(0xf2c100); o2.g.scale.setScalar(1.5); pose(o2.g, 4.5, cote * 1.0, -Math.PI / 2);
    ANIMS.push(t => { o1.bras.rotation.x = -0.6 + 0.6 * Math.sin(t / 420 + dec); });
    ANIMS.push(t => { o2.bras.rotation.z = 2.2 + 0.5 * Math.sin(t / 260 + dec); });
    const c = at.zone.c; if (!etiquetees.has(c)) { etiquetees.add(c);
      const fin = c.fin ? " · jusqu'au " + c.fin.slice(8, 10) + "/" + c.fin.slice(5, 7) : "";
      scene.add(etiquette("⚠ Travaux", "#f2b215", "#2b3138", { x: at.x, y: 7, z: -at.y }, 0.032, (c.gene || "Circulation perturbée") + fin)); }
  });
  return { troncons: runs.length, barrieres: barr.length, ateliers: ateliers.map(t => [Math.round(t.x), Math.round(t.y)]) };
}

/* ---------- toi, en direct (GPS du téléphone) ---------- */
let moiPoint = null;
function suivreMoi() {
  if (!navigator.geolocation || TEST) return;
  const g = new THREE.Group();
  const point = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.3, 24), new THREE.MeshStandardMaterial({ color: 0x2f7cf6, emissive: 0x2f7cf6, emissiveIntensity: 0.5 })); point.position.y = 0.4;
  const bord = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.25, 24), new THREE.MeshStandardMaterial({ color: 0xffffff })); bord.position.y = 0.32;
  const halo = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.2, 32), new THREE.MeshBasicMaterial({ color: 0x2f7cf6, transparent: true, opacity: 0.4, side: THREE.DoubleSide })); halo.rotation.x = -Math.PI / 2; halo.position.y = 0.35;
  g.add(bord, point, halo); g.visible = false; scene.add(g);
  ANIMS.push(t => { const s = 1 + ((t / 1400) % 1) * 1.6; halo.scale.set(s, s, 1); halo.material.opacity = 0.5 * (1 - ((t / 1400) % 1)); });
  navigator.geolocation.watchPosition(p => { const [x, y] = local(p.coords.latitude, p.coords.longitude, centre);
    if (x * x + y * y > 1500 * 1500) { g.visible = false; return; } g.visible = true; g.position.set(x, 0.12, -y); moiPoint = [x, y]; },
    () => { g.visible = false; }, { enableHighAccuracy: true, maximumAge: 5000 });
}

/* ---------- le panneau du bas : prochains passages ---------- */
function panneau(p) {
  const box = $("pas"); box.innerHTML = "";
  const min = g => { const d = (g.passages && g.passages[0] && g.passages[0].delai) || ""; return /proche/i.test(d) ? 0 : (parseInt(d) || 99); };
  const lignes = (p.liste || []).filter(g => g.arret === "Brossolette Genas").sort((a, b) => min(a) - min(b)).slice(0, 8);
  if (!lignes.length) box.innerHTML = '<div class="row"><span>' + (new Date().getHours() < 5 ? "Pas de bus la nuit : ils reprennent vers 5 h." : "Aucun passage annoncé pour l'instant.") + "</span></div>";
  for (const g of lignes) {
    const r = document.createElement("div"); r.className = "row";
    const c = COUL[g.ligne] || "#2b3138";
    r.innerHTML = `<b class="bl" style="background:${c};color:${/^#(D3D8|FFF)/i.test(c) ? "#2b3138" : "#fff"}">${g.ligne}</b><span>→ ${g.direction}</span><strong>${(g.passages || []).slice(0, 2).map(x => /proche/i.test(x.delai) ? "à l'approche" : x.delai).join(" · ")}</strong>`;
    box.append(r);
  }
  $("maj").textContent = new Date(p.lu_le || Date.now()).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (arretLabel && arretPos && lignes[0]) {
    const n = etiquette("Brossolette Genas", "#2b3138", "#f5f1e8", { x: arretPos[0], y: 9, z: -arretPos[1] }, 0.03, lignes.slice(0, 2).map(g => `${g.ligne} ${/proche/i.test(g.passages[0]?.delai) ? "arrive" : g.passages[0]?.delai || ""}`).join("  ·  "));
    scene.remove(arretLabel); arretLabel = n; scene.add(n);
  }
}

$("tete").addEventListener("click", () => { const o = $("panel").classList.toggle("ouvert"); $("plus").textContent = o ? "▾ réduire" : "▴ tout voir"; });
/* ---------- boucle ---------- */
function taille() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener("resize", taille); taille();
// « Chez moi » et « Travail » : on recentre si on y est déjà, sinon on change de quartier
const allerA = (lieu) => { if (lieu === LIEU) { controls.target.set(maisonCentre ? maisonCentre[0] : 0, 0, maisonCentre ? -maisonCentre[1] : 0); camera.position.set(-150, 190, 220); return; }
  const u = new URL(location.href); if (lieu === "usine") u.searchParams.set("lieu", "usine"); else u.searchParams.delete("lieu"); location.href = u.toString(); };
$("moi").addEventListener("click", () => allerA("maison"));
if ($("travail")) $("travail").addEventListener("click", () => allerA("usine"));
function boucle(t) {
  controls.update(); animerBus(t); for (const f of ANIMS) f(t);
  for (const a of anneaux) { const s = 1 + 0.04 * Math.sin(t / 700); a.scale.set(s, s, 1); a.material.opacity = 0.55 + 0.25 * Math.sin(t / 700); }
  renderer.render(scene, camera); requestAnimationFrame(boucle);
}

/* ---------- démarrage ---------- */
if (TEST || location.search.includes("regard")) Object.assign(window, { camera, controls, scene, THREE, majBus, BUS, VOITURES, RES: () => RESEAU, SOLX: () => SOL, dbg: () => ({ p: SOL && SOL.passages, c: SOL && cellSol(30, -22.3), r: surLaRue(30, -22.3, 15) }) });
try {
  const chezMoi = LIEU === "maison";   // les bus TCL suivis sont ceux du bas de chez toi
  if (!chezMoi) { $("panel").hidden = true; const t = document.querySelector(".bar b"); if (t) t.lastChild.textContent = "Ton travail en vrai"; }
  const [q, carte] = await Promise.all([fn("jarvis-quartier", { lieu: LIEU }), chezMoi ? fn("jarvis-tcl", { quoi: "carte" }) : null]);
  if (!q || q.erreur) throw new Error(q?.erreur || "quartier introuvable");
  centre = q.centre;
  construireQuartier(q);
  if (SOL) { if (TEST && TEST.passages) { SOL.passages = TEST.passages; } peindreMarquages(); poserPassages(); if (!TEST) chercherPassages(); }
  if (carte && carte.ok) poserLignes(carte);
  if (SOL) habiller(q.sol);   // après les abribus (les bancs se posent à côté)
  RESEAU = construireReseau(q.routes || []); habillerRues(); lancerCirculation();   // les rues de la carte : ce qui roule les suit
  $("msg").hidden = true;
  requestAnimationFrame(boucle);
  // les chantiers en cours (Grand Lyon) et ton point GPS
  (async () => { try { const ch = await fn("jarvis-quartier", { quoi: "chantiers", lieu: LIEU }); if (ch && ch.ok) window.__chantiers = poserChantiers(ch.liste || []); } catch (_) { /* tant pis : la carte reste sans chantiers */ } })();
  suivreMoi();
  const vivre = async () => { try { const v = await fn("jarvis-tcl", { quoi: "vehicules" }); if (v && v.ok) majBus(v.bus || []); } catch (_) { /* prochain tour */ } };
  const passages = async () => { try { const p = await fn("jarvis-tcl", { quoi: "passages" }); if (p && p.ok) panneau(p); } catch (_) { /* prochain tour */ } };
  if (chezMoi) { vivre(); passages(); setInterval(vivre, 15000); setInterval(passages, 30000); }
  window.__pret = true;
} catch (e) { $("msg").hidden = false; $("msg").textContent = "Le quartier ne se charge pas : " + (e.message || e); window.__pret = "erreur"; }
