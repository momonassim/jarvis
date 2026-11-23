/* =========================================================
   Jarvis — ESSAI « carte réelle » (page à part, l'app n'est pas touchée).
   Le vrai quartier autour de chez lui (bâtiments et routes de l'IGN, avec leurs vraies
   hauteurs), dans le style maquette de sa ville, avec les vrais bus TCL en direct.
   ========================================================= */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const $ = id => document.getElementById(id);
const TEST = window.__JARVIS_TEST || null;          // seulement pour les essais hors ligne

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
  for (const r of routes) { const l = pts(r.p); for (let i = 0; i < l.length - 1; i++) { const sg = [l[i][0], l[i][1], l[i + 1][0], l[i + 1][1], r.w];
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
function construireQuartier(q) {
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
      o.position.set(x, 0, -y); o.scale.set(1, ht + 0.3, 1); o.updateMatrix(); it.setMatrixAt(i, o.matrix);
    });
    im.castShadow = true; it.castShadow = true; scene.add(im, it);
  }
  // routes : rubans clairs, les grands axes un peu plus marqués
  const rg = [], rgGros = [];
  for (const r of q.routes || []) { const l = pts(r.p); (r.i <= 3 ? rgGros : rg).push(...ruban(l, r.w, r.i <= 3 ? 0.09 : 0.08)); }
  if (rg.length) { const m = new THREE.Mesh(mergeGeometries(rg), new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 1 })); m.receiveShadow = true; scene.add(m); }
  if (rgGros.length) { const m = new THREE.Mesh(mergeGeometries(rgGros), new THREE.MeshStandardMaterial({ color: 0xfbf9f4, roughness: 1 })); m.receiveShadow = true; scene.add(m); }
  // bâtiments : un seul volume chacun, toit compris ; le sien ressort
  const bg = []; let maison = null, maisonT = 0;
  const liste = (q.batiments || []).map(b => ({ ...b, pp: pts(b.p) })).filter(b => b.pp.length >= 4);
  let mb = liste.find(b => dansPoly(0, 0, b.pp));
  if (!mb) { let bd = 1e9; for (const b of liste) for (const [x, y] of b.pp) { const d = Math.hypot(x, y); if (d < bd) { bd = d; mb = b; } } }
  for (const b of liste) {
    const g = batiment(b.pp, Math.max(2.5, b.h), Math.max(b.h, b.t || b.h));
    if (b === mb) { maison = g; maisonPoly = b.pp; maisonH = Math.max(b.h, b.t || b.h); } else bg.push(g);
  }
  if (bg.length) {
    const all = mergeGeometries(bg.map(x => { if (!x.attributes.normal) x.computeVertexNormals(); return x; }));
    const m = new THREE.Mesh(all, new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.92 })); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(all, 25), new THREE.LineBasicMaterial({ color: 0xc8c0b3, transparent: true, opacity: 0.55 })));
  }
  if (maison) {
    const m = new THREE.Mesh(maison, new THREE.MeshStandardMaterial({ color: 0xf2c48a, roughness: 0.8 })); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(maison, 25), new THREE.LineBasicMaterial({ color: 0xb98a4f })));
    const [cx, cy] = maisonPoly.slice(0, -1).reduce((a, [x, y]) => [a[0] + x / (maisonPoly.length - 1), a[1] + y / (maisonPoly.length - 1)], [0, 0]);
    maisonCentre = [cx, cy];
    // l'anneau suit le pied de l'immeuble (un liseré autour des murs), au lieu d'un cercle qui traverse les voisins
    const ligne = new THREE.BufferGeometry().setFromPoints(maisonPoly.map(([x, y]) => new THREE.Vector3(x, 0.25, -y)));
    const anneau = new THREE.Line(ligne, new THREE.LineBasicMaterial({ color: 0xe9a23b, transparent: true, opacity: 0.9 })); scene.add(anneau);
    scene.add(etiquette("Chez toi", "#2b3138", "#f5f1e8", { x: cx, y: maisonH + 4, z: -cy }, 0.028));
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
      const flush = () => { if (seg.length > 1) (g[l.couleur] ||= []).push(...ruban(seg, 1.4, 0.14)); seg = []; };
      for (const [la, lo] of t) { let [x, y] = local(la, lo, centre); const r = surLaRue(x, y, 14); if (r) { x = r.x; y = r.y; } if (x * x + y * y < R * R) seg.push([x, y]); else flush(); }
      flush();
    }
  }
  for (const [c, gs] of Object.entries(g)) scene.add(new THREE.Mesh(mergeGeometries(gs), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.8 })));
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
    abri.add(toit, vitre, pot); abri.position.set(x, 0, -y); abri.rotation.y = ang; abri.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(abri);
    if (!vus.has(a.nom)) { vus.add(a.nom); if (a.nom === "Brossolette Genas") { arretLabel = etiquette("Brossolette Genas", "#2b3138", "#f5f1e8", { x, y: 9, z: -y }, 0.03, "…"); scene.add(arretLabel); arretPos = [x, y]; } }
  }
}
let arretLabel = null, arretPos = null;

/* ---------- les bus : une petite maquette par bus, à sa vraie position GPS ---------- */
const BUS = new Map();
function maquetteBus(ligne) {
  const g = new THREE.Group(), coul = new THREE.Color(COUL[ligne] || "#2b3138");
  const caisse = new THREE.Mesh(new THREE.BoxGeometry(2.55, 2.7, 12), new THREE.MeshStandardMaterial({ color: coul, roughness: 0.6 })); caisse.position.y = 1.75;
  const toit = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 11.4), new THREE.MeshStandardMaterial({ color: 0xf5f3ee })); toit.position.y = 3.22;
  const vitres = new THREE.Mesh(new THREE.BoxGeometry(2.62, 1.0, 10.6), new THREE.MeshStandardMaterial({ color: 0x27303a, roughness: 0.3 })); vitres.position.y = 2.35;
  const avant = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.3, 0.1), new THREE.MeshStandardMaterial({ color: 0x27303a })); avant.position.set(0, 2.25, -6.02);
  const roues = new THREE.CylinderGeometry(0.5, 0.5, 2.6, 10); roues.rotateZ(Math.PI / 2);
  for (const z of [-4, 3.6]) { const r = new THREE.Mesh(roues, new THREE.MeshStandardMaterial({ color: 0x22262b })); r.position.set(0, 0.5, z); g.add(r); }
  g.add(caisse, toit, vitres, avant);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  // taille réelle : un bus de 12 m tient dans sa voie
  return g;
}
function majBus(liste) {
  const vu = new Set(), t = performance.now();
  for (const b of liste) {
    let [x, y] = local(b.lat, b.lon, centre); if (x * x + y * y > 1100 * 1100) continue;
    const rr = surLaRue(x, y, 25); if (rr) { x = rr.x; y = rr.y; if (!Number.isFinite(b.cap)) b.cap = 90 - rr.ang * 180 / Math.PI; }
    const id = b.id || `${b.ligne}|${b.vers}|${Math.round(x / 60)}|${Math.round(y / 60)}`;
    // on rattache au bus le plus proche de la même ligne (les identifiants ne sont pas toujours fournis)
    let k = null, dmin = 260;
    for (const [kk, o] of BUS) { if (o.ligne !== b.ligne || vu.has(kk)) continue; const d = Math.hypot(o.cible[0] - x, o.cible[1] - y); if (d < dmin) { dmin = d; k = kk; } }
    if (!k) { k = id + "|" + Math.random(); const m = maquetteBus(b.ligne); m.position.set(x, 0, -y); scene.add(m);
      const lab = etiquette(b.ligne, COUL[b.ligne] || "#2b3138", /^#(D3D8|FFF)/i.test(COUL[b.ligne] || "") ? "#2b3138" : "#ffffff", { x: 0, y: 4.5, z: 0 }, 0.018); m.add(lab);
      BUS.set(k, { ligne: b.ligne, m, depart: [x, y], cible: [x, y], t0: t, cap: b.cap }); }
    const o = BUS.get(k); vu.add(k);
    o.depart = [o.m.position.x, -o.m.position.z]; o.cible = [x, y]; o.t0 = t;
    if (Number.isFinite(b.cap)) o.cap = b.cap;
  }
  for (const [k, o] of BUS) if (!vu.has(k)) { scene.remove(o.m); BUS.delete(k); }
}
function animerBus(t) {
  for (const o of BUS.values()) {
    const a = Math.min(1, (t - o.t0) / 15000), e = a * a * (3 - 2 * a);
    const x = o.depart[0] + (o.cible[0] - o.depart[0]) * e, y = o.depart[1] + (o.cible[1] - o.depart[1]) * e;
    o.m.position.set(x, 0, -y);
    const vise = -THREE.MathUtils.degToRad(o.cap || 0) + Math.PI;  // cap 0 = nord ; l'avant du bus est vers -z
    let d = vise - o.m.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); o.m.rotation.y += d * 0.08;
  }
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
$("moi").addEventListener("click", () => { controls.target.set(maisonCentre ? maisonCentre[0] : 0, 0, maisonCentre ? -maisonCentre[1] : 0); camera.position.set(-150, 190, 220); });
function boucle(t) {
  controls.update(); animerBus(t);
  for (const a of anneaux) { const s = 1 + 0.04 * Math.sin(t / 700); a.scale.set(s, s, 1); a.material.opacity = 0.55 + 0.25 * Math.sin(t / 700); }
  renderer.render(scene, camera); requestAnimationFrame(boucle);
}

/* ---------- démarrage ---------- */
if (TEST) Object.assign(window, { camera, controls });
try {
  const [q, carte] = await Promise.all([fn("jarvis-quartier", {}), fn("jarvis-tcl", { quoi: "carte" })]);
  if (!q || q.erreur) throw new Error(q?.erreur || "quartier introuvable");
  centre = q.centre;
  construireQuartier(q);
  if (carte && carte.ok) poserLignes(carte);
  $("msg").hidden = true;
  requestAnimationFrame(boucle);
  const vivre = async () => { try { const v = await fn("jarvis-tcl", { quoi: "vehicules" }); if (v && v.ok) majBus(v.bus || []); } catch (_) { /* prochain tour */ } };
  const passages = async () => { try { const p = await fn("jarvis-tcl", { quoi: "passages" }); if (p && p.ok) panneau(p); } catch (_) { /* prochain tour */ } };
  vivre(); passages(); setInterval(vivre, 15000); setInterval(passages, 30000);
  window.__pret = true;
} catch (e) { $("msg").hidden = false; $("msg").textContent = "Le quartier ne se charge pas : " + (e.message || e); window.__pret = "erreur"; }
