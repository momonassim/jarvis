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
const V = (x, y) => new THREE.Vector2(x, -y);
const pts = flat => { const a = []; for (let i = 0; i < flat.length; i += 2) a.push([flat[i], flat[i + 1]]); return a; };

/* ---------- construction du quartier ---------- */
function dansPoly(x, y, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }

function ruban(ligne, largeur, hauteur) {
  // un ruban plat le long d'une ligne + un disque à chaque coude (pas de trou entre les morceaux)
  const g = [];
  for (let i = 0; i < ligne.length - 1; i++) {
    const [x1, y1] = ligne[i], [x2, y2] = ligne[i + 1], dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy); if (L < 0.2) continue;
    const s = new THREE.PlaneGeometry(L, largeur); s.rotateX(-Math.PI / 2); s.rotateY(-Math.atan2(dy, dx));
    s.translate((x1 + x2) / 2, hauteur, -(y1 + y2) / 2); g.push(s);
  }
  for (const [x, y] of ligne) { const d = new THREE.CircleGeometry(largeur / 2, 12); d.rotateX(-Math.PI / 2); d.translate(x, hauteur, -y); g.push(d); }
  return g;
}

let maisonPoly = null, maisonH = 15, maisonGeo = null, maisonCentre = null;
const arbresReels = [];
function construireQuartier(q) {
  for (const a of q.arbres || []) arbresReels.push(a);
  // verdure : taches vert sauge + arbres simples
  const vg = [], arbres = [];
  for (const v of q.verdure || []) {
    const p = pts(v.p); if (p.length < 3) continue;
    const sh = new THREE.Shape(p.map(([x, y]) => V(x, y))); const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2); g.translate(0, 0.05, 0); vg.push(g);
    // arbres dans la tache
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9; p.forEach(([x, y]) => { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); });
    const n = Math.min(60, Math.floor((maxx - minx) * (maxy - miny) / 260));
    for (let k = 0; k < n * 3 && arbres.length < 1400; k++) { const x = minx + Math.random() * (maxx - minx), y = miny + Math.random() * (maxy - miny); if (dansPoly(x, y, p)) arbres.push([x, y]); }
  }
  if (vg.length) { const m = new THREE.Mesh(mergeGeometries(vg), new THREE.MeshStandardMaterial({ color: 0xd3dcc6, roughness: 1 })); m.receiveShadow = true; scene.add(m); }
  const vrais = arbresReels;
  if (arbres.length || vrais.length) {
    const geo = new THREE.IcosahedronGeometry(3.2, 0); geo.translate(0, 5.2, 0);
    const tronc = new THREE.CylinderGeometry(0.35, 0.45, 2.6, 5); tronc.translate(0, 1.3, 0);
    const N = arbres.length + vrais.length;
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xa9bb98, roughness: 1, flatShading: true }), N);
    const it = new THREE.InstancedMesh(tronc, new THREE.MeshStandardMaterial({ color: 0x9c8b78, roughness: 1 }), N);
    const o = new THREE.Object3D();
    arbres.forEach(([x, y], i) => { const s = 0.75 + Math.random() * 0.6; o.position.set(x, 0, -y); o.scale.set(s, s * (0.9 + Math.random() * 0.4), s); o.rotation.y = Math.random() * 6; o.updateMatrix(); im.setMatrixAt(i, o.matrix); it.setMatrixAt(i, o.matrix); });
    // les vrais arbres de la rue : leur hauteur et leur couronne mesurées par la Métropole
    vrais.forEach(([x, y, h, r], j) => { const sx = Math.max(0.5, r / 3.2), sy = Math.max(0.6, h / 8.4); o.position.set(x, 0, -y); o.scale.set(sx, sy, sx); o.rotation.y = Math.random() * 6; o.updateMatrix(); im.setMatrixAt(arbres.length + j, o.matrix); it.setMatrixAt(arbres.length + j, o.matrix); });
    im.castShadow = true; it.castShadow = true; scene.add(im, it);
  }
  // routes : rubans clairs, les grands axes un peu plus marqués
  const rg = [], rgGros = [];
  for (const r of q.routes || []) { const l = pts(r.p); (r.i <= 3 ? rgGros : rg).push(...ruban(l, Math.max(3, Math.min(r.w, 16)), r.i <= 3 ? 0.09 : 0.08)); }
  if (rg.length) { const m = new THREE.Mesh(mergeGeometries(rg), new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 1 })); m.receiveShadow = true; scene.add(m); }
  if (rgGros.length) { const m = new THREE.Mesh(mergeGeometries(rgGros), new THREE.MeshStandardMaterial({ color: 0xfbf9f4, roughness: 1 })); m.receiveShadow = true; scene.add(m); }
  // bâtiments : maquette blanche, vraies hauteurs ; le sien ressort
  const bg = [];
  let maison = null;
  for (const b of q.batiments || []) {
    const p = pts(b.p); if (p.length < 3) continue;
    const sh = new THREE.Shape(p.map(([x, y]) => V(x, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(2.5, b.h), bevelEnabled: false }); g.rotateX(-Math.PI / 2);
    if (!maison && dansPoly(0, 0, p)) { maison = g; maisonPoly = p; maisonH = Math.max(2.5, b.h); continue; }
    bg.push(g);
  }
  if (!maison) { // la maison tombe parfois dans une cour : on prend le bâtiment le plus proche
    let best = null, bd = 1e9; (q.batiments || []).forEach(b => { const p = pts(b.p); const [cx, cy] = p.reduce((a, [x, y]) => [a[0] + x / p.length, a[1] + y / p.length], [0, 0]); const d = Math.hypot(cx, cy); if (d < bd) { bd = d; best = b; } });
    if (best) { maisonPoly = pts(best.p); maisonH = Math.max(2.5, best.h); }
  }
  // toits du Grand Lyon : chaque morceau monte à sa hauteur de façade, les toits en pente finissent en pointe douce
  const tg = [], maisonParts = [];
  const toits = (q.toits || []).map(t => ({ ...t, pp: pts(t.p) })).filter(t => t.pp.length >= 3);
  // l'immeuble de la maison : le morceau de toit qui contient la maison, puis tous ceux qui le touchent (même bâtiment)
  const k = (x, y) => `${Math.round(x * 2)}|${Math.round(y * 2)}`;
  const parSommet = new Map(); toits.forEach((t, i) => t.pp.forEach(([x, y]) => { const kk = k(x, y); (parSommet.get(kk) || parSommet.set(kk, []).get(kk)).push(i); }));
  const depart = toits.findIndex(t => dansPoly(0, 0, t.pp)); const aMaison = new Set();
  if (depart >= 0) { const pile = [depart]; while (pile.length && aMaison.size < 40) { const i = pile.pop(); if (aMaison.has(i)) continue; aMaison.add(i); toits[i].pp.forEach(([x, y]) => (parSommet.get(k(x, y)) || []).forEach(j => { if (!aMaison.has(j)) pile.push(j); })); } }
  toits.forEach((t, i) => {
    const sh = new THREE.Shape(t.pp.map(([x, y]) => V(x, y)));
    const hf = Math.max(2.5, t.hf), ht = Math.max(hf, t.ht);
    const g = new THREE.ExtrudeGeometry(sh, { depth: hf, bevelEnabled: false }); g.rotateX(-Math.PI / 2);
    const parts = [g.index ? g.toNonIndexed() : g];
    if (t.t === 1 && ht > hf + 0.4 && t.pp.length <= 24) {   // toit en pente : une pointe vers le centre
      const [cx, cy] = t.pp.reduce((a, [x, y]) => [a[0] + x / t.pp.length, a[1] + y / t.pp.length], [0, 0]);
      const v = [];
      for (let j = 0; j < t.pp.length - 1; j++) { const [x1, y1] = t.pp[j], [x2, y2] = t.pp[j + 1]; v.push(x1, hf, -y1, x2, hf, -y2, cx, ht, -cy); }
      const r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.Float32BufferAttribute(v, 3)); r.computeVertexNormals();
      r.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(v.length / 3 * 2).fill(0), 2));
      parts.push(r);
    }
    const one = parts.length > 1 ? mergeGeometries(parts.map(x => { const y = x.index ? x.toNonIndexed() : x; y.deleteAttribute("uv"); y.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(y.attributes.position.count * 2).fill(0), 2)); return y; })) : parts[0];
    if (aMaison.has(i)) { maisonParts.push(one); maisonH = Math.max(maisonH === 15 ? 0 : maisonH, ht); } else tg.push(one);
  });
  if (maisonParts.length) {
    maison = null; maisonPoly = toits[depart].pp;
    const g = mergeGeometries(maisonParts.map(x => { const y = x.index ? x.toNonIndexed() : x; if (!y.attributes.normal) y.computeVertexNormals(); return y; }));
    maisonGeo = g;
    // centre de l'immeuble entier (tous ses morceaux)
    let sx = 0, sy = 0, n = 0; aMaison.forEach(i => toits[i].pp.forEach(([x, y]) => { sx += x; sy += y; n++; })); maisonCentre = [sx / n, sy / n];
  }
  bg.push(...tg);
  if (q.bordures && q.bordures.length) {
    const v = []; for (const l of q.bordures) { const p = pts(l); for (let j = 0; j < p.length - 1; j++) v.push(p[j][0], 0.16, -p[j][1], p[j + 1][0], 0.16, -p[j + 1][1]); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xcfc7b9, transparent: true, opacity: 0.9 })));
  }
  if (bg.length) {
    const norm = bg.map(x => { const y = x.index ? x.toNonIndexed() : x; if (!y.attributes.normal) y.computeVertexNormals(); if (!y.attributes.uv) y.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(y.attributes.position.count * 2).fill(0), 2)); return y; });
    const all = mergeGeometries(norm);
    const m = new THREE.Mesh(all, new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.92 })); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(all, 25), new THREE.LineBasicMaterial({ color: 0xc8c0b3, transparent: true, opacity: 0.55 })); scene.add(e);
  }
  if (maisonPoly) {
    const h = maisonH;
    const g = maisonGeo || maison || new THREE.ExtrudeGeometry(new THREE.Shape(maisonPoly.map(([x, y]) => V(x, y))), { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xf2c48a, roughness: 0.8 })); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), new THREE.LineBasicMaterial({ color: 0xb98a4f })));
    // un anneau doux au pied de l'immeuble
    const anneau = new THREE.Mesh(new THREE.RingGeometry(26, 27.2, 64), new THREE.MeshBasicMaterial({ color: 0xe9a23b, transparent: true, opacity: 0.8 }));
    anneau.rotation.x = -Math.PI / 2; anneau.position.y = 0.2;
    const [cx, cy] = maisonCentre || maisonPoly.reduce((a, [x, y]) => [a[0] + x / maisonPoly.length, a[1] + y / maisonPoly.length], [0, 0]);
    anneau.position.x = cx; anneau.position.z = -cy; scene.add(anneau); anneaux.push(anneau);
    scene.add(etiquette("Chez toi", "#2b3138", "#f5f1e8", { x: cx, y: h + 8, z: -cy }, 0.028));
  }
}
const anneaux = [];

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
      const flush = () => { if (seg.length > 1) (g[l.couleur] ||= []).push(...ruban(seg, 1.6, 0.14)); seg = []; };
      for (const [la, lo] of t) { const [x, y] = local(la, lo, centre); if (x * x + y * y < R * R) seg.push([x, y]); else flush(); }
      flush();
    }
  }
  for (const [c, gs] of Object.entries(g)) scene.add(new THREE.Mesh(mergeGeometries(gs), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.8 })));
  // abribus : petit toit + poteau, aux vrais emplacements
  const vus = new Set();
  for (const a of carte.arrets || []) {
    const [x, y] = local(a.lat, a.lon, centre);
    const abri = new THREE.Group();
    const toit = new THREE.Mesh(new THREE.BoxGeometry(5, 0.25, 1.8), new THREE.MeshStandardMaterial({ color: 0x2b3138 })); toit.position.y = 2.6;
    const vitre = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 0.12), new THREE.MeshStandardMaterial({ color: 0xcfe0e6, transparent: true, opacity: 0.55 })); vitre.position.set(0, 1.3, -0.8);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.6, 6), new THREE.MeshStandardMaterial({ color: 0x2b3138 })); pot.position.set(3.2, 1.8, 0);
    abri.add(toit, vitre, pot); abri.position.set(x, 0, -y); abri.traverse(o => { if (o.isMesh) o.castShadow = true; });
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
  g.scale.setScalar(1.5); // un peu plus grand que nature, pour qu'on les voie de loin (effet maquette)
  return g;
}
function majBus(liste) {
  const vu = new Set(), t = performance.now();
  for (const b of liste) {
    const [x, y] = local(b.lat, b.lon, centre); if (x * x + y * y > 1100 * 1100) continue;
    const id = b.id || `${b.ligne}|${b.vers}|${Math.round(x / 60)}|${Math.round(y / 60)}`;
    // on rattache au bus le plus proche de la même ligne (les identifiants ne sont pas toujours fournis)
    let k = null, dmin = 260;
    for (const [kk, o] of BUS) { if (o.ligne !== b.ligne || vu.has(kk)) continue; const d = Math.hypot(o.cible[0] - x, o.cible[1] - y); if (d < dmin) { dmin = d; k = kk; } }
    if (!k) { k = id + "|" + Math.random(); const m = maquetteBus(b.ligne); m.position.set(x, 0, -y); scene.add(m);
      const lab = etiquette(b.ligne, COUL[b.ligne] || "#2b3138", /^#(D3D8|FFF)/i.test(COUL[b.ligne] || "") ? "#2b3138" : "#ffffff", { x: 0, y: 4.5, z: 0 }, 0.018); lab.scale.multiplyScalar(1 / 1.5); m.add(lab);
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
$("moi").addEventListener("click", () => { controls.target.set(0, 0, 0); camera.position.set(-150, 190, 220); });
function boucle(t) {
  controls.update(); animerBus(t);
  for (const a of anneaux) { const s = 1 + 0.04 * Math.sin(t / 700); a.scale.set(s, s, 1); a.material.opacity = 0.55 + 0.25 * Math.sin(t / 700); }
  renderer.render(scene, camera); requestAnimationFrame(boucle);
}

/* ---------- démarrage ---------- */
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
