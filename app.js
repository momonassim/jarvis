/* =========================================================
   Jarvis — l'app.
   Aucune donnée personnelle ici : tout arrive de Supabase
   après connexion, et seul le propriétaire peut les lire.
   ========================================================= */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createClient } from "@supabase/supabase-js";

const SB_URL = "https://uaprtibscyepsabyqcyl.supabase.co";
const SB_KEY = "sb_publishable_qjJRK71zrG1ETae5SBY4Dg_ofD8oeYl"; // clé publique, faite pour être dans une page web
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

const $ = id => document.getElementById(id);
const MOIS = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
const nb = t => typeof t === "string" ? t.replace(/ (€|%|h\b|kWh)/g, " $1").replace(/(\d) (\d)/g, "$1 $2") : t;
const eur = n => nb(Number(n).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €");
const frd = d => d ? d.slice(0, 10).split("-").reverse().join("/") : "";
const parisDay = (plus = 0) => new Date(Date.now() + plus * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const jour = d => new Date(d + "T12:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const hh = h => (h || "").replace(":", "h");
const quand = up => { const t = new Date(up); return t.toLocaleDateString("fr-FR", { day: "numeric", month: "long" }) + " à " + t.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); };
const prenomDe = n => (n || "").split(" ")[0];
const ctr = s => /brotteaux/i.test(s || "") ? "Lyon 6 Brotteaux" : "Villeurbanne";
let toastT; function toast(t) { const e = $("toast"); e.textContent = t; e.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove("on"), 3200); }

/* =========================================================
   Les lieux de la ville (vides tant que tu n'es pas connecté)
   ========================================================= */
const PLACES = [
  { id: "home", emoji: "🏠", color: "#ffd9c7", name: "Chez toi" },
  { id: "garage", emoji: "🚗", color: "#dcd6ea", name: "Ta voiture" },
  { id: "usine", emoji: "🏭", color: "#e8dccf", name: "Ton travail" },
  { id: "impots", emoji: "🏛️", color: "#c9d6e6", name: "Impôts et amendes" },
  { id: "clinique", emoji: "🩺", color: "#ffd0cb", name: "Ta santé" },
  { id: "mairie", emoji: "🪪", color: "#efe0c6", name: "Tes papiers" },
  { id: "banque", emoji: "💶", color: "#fbe7a6", name: "Ton argent" },
  { id: "medecin", emoji: "🍼", color: "#cdebd9", name: "Le bébé" },
  { id: "orange", emoji: "📱", color: "#ffd2ad", name: "Abonnements" },
  { id: "energie", emoji: "⚡", color: "#d9eec0", name: "Gaz et électricité" },
];
PLACES.forEach(p => Object.assign(p, { place: "", status: "…", say: "Je regarde…", facts: [], docs: [], live: "" }));
const byId = Object.fromEntries(PLACES.map(p => [p.id, p]));
const S = { sel: null, night: false, prenom: "", profil: "", patients: [], rdv: [], creneaux: [], loaded: false };

/* =========================================================
   Rendu 3D (la maquette)
   ========================================================= */
const small = Math.min(innerWidth, innerHeight) < 700;
const canvas = $("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xf6e8d8, 200, 420);
const camera = new THREE.PerspectiveCamera(36, 1, 1, 600);

const hemi = new THREE.HemisphereLight(0xfff4e6, 0xb48a6c, 1.15); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(-38, 62, 30); sun.castShadow = true;
sun.shadow.mapSize.set(small ? 2048 : 3072, small ? 2048 : 3072);
Object.assign(sun.shadow.camera, { left: -46, right: 46, top: 46, bottom: -46, near: 10, far: 180 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
scene.add(sun);

const MAT = {};
function mat(hex, o = {}) { const k = hex + JSON.stringify(o); if (!MAT[k]) MAT[k] = new THREE.MeshStandardMaterial({ color: hex, roughness: .82, metalness: 0, ...o }); return MAT[k]; }
const glowMats = [];
function glow(hex, day = 0, night = 1.6) { const m = new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: day, roughness: .5 }); m.userData = { day, night }; glowMats.push(m); return m; }

const root = new THREE.Group(); scene.add(root);
function add(mesh, parent = root) { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; }
function box(w, h, d, m, x, y, z, parent, rad = 0) {
  const g = rad > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(rad, w / 2 - .01, h / 2 - .01, d / 2 - .01)) : new THREE.BoxGeometry(w, h, d);
  const me = new THREE.Mesh(g, m); me.position.set(x, y, z); return add(me, parent);
}
function cyl(rt, rb, h, m, x, y, z, parent, seg = 20) { const me = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); me.position.set(x, y, z); return add(me, parent); }
function prism(w, h, d, m, x, y, z, parent, rotY = 0) {
  const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }); g.translate(0, 0, -d / 2);
  const me = new THREE.Mesh(g, m); me.position.set(x, y, z); me.rotation.y = rotY; return add(me, parent);
}

/* ---------- Le socle, avec le garage en coupe ---------- */
const HALF = 30, DEPTH = 4.4;
const topM = mat(0xefe3cf), soilM = mat(0xc2906e, { roughness: .95 }), soilDark = mat(0x9b6a50, { roughness: .95 });
function slab(x0, x1, z0, z1, y0 = -DEPTH, y1 = 0) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  const me = new THREE.Mesh(g, [soilM, soilM, topM, soilDark, soilM, soilM]); me.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  me.receiveShadow = true; me.castShadow = true; root.add(me); return me;
}
const GZ0 = -9, GZ1 = 5, GX0 = 22, RAMPZ1 = -6, RX0 = 14, GH = 3.6;
slab(-HALF, RX0, -HALF, HALF); slab(RX0, HALF, -HALF, GZ0); slab(RX0, HALF, GZ1, HALF); slab(RX0, GX0, RAMPZ1, GZ1);
slab(RX0, HALF, GZ0, GZ1, -DEPTH, -DEPTH + .4); slab(GX0, HALF, GZ0, GZ1, -.5, 0);
{ const len = Math.hypot(GX0 - RX0, GH), a = Math.atan2(GH, GX0 - RX0);
  const r = box(len, .3, RAMPZ1 - GZ0, mat(0x8d847d), (RX0 + GX0) / 2, -GH / 2 - .15, (GZ0 + RAMPZ1) / 2); r.rotation.z = -a;
  for (let i = 0; i < 5; i++) { const t = (i + .5) / 5; box(.35, .05, 2.4, mat(0xf1ead9), RX0 + t * (GX0 - RX0), -t * GH + .03, (GZ0 + RAMPZ1) / 2).rotation.z = -a; } }
box(.2, GH - .5, GZ1 - GZ0, mat(0xd8cdbd), GX0 + .1, -DEPTH + .4 + (GH - .5) / 2, (GZ0 + GZ1) / 2);
box(HALF - GX0, .05, GZ1 - GZ0, mat(0x5d5752), (GX0 + HALF) / 2, -DEPTH + .43, (GZ0 + GZ1) / 2);
for (let k = 0; k < 3; k++) box(HALF - GX0 - 1.2, .02, .12, mat(0xf6f0e4), (GX0 + HALF) / 2 + .3, -DEPTH + .47, -4.5 + k * 4.2);
[[-4.3], [2.2]].forEach(([z]) => box(.5, GH - .5, .5, mat(0xcfc3b2), 26.2, -DEPTH + .4 + (GH - .5) / 2, z));
const gLamp = glow(0xfff2cf, 1.4, 2.4);
for (let k = 0; k < 3; k++) box(4, .08, .25, gLamp, 26, -.62, -6 + k * 4.5);
const garageLight = new THREE.PointLight(0xffe7bf, 30, 14, 1.6); garageLight.position.set(27, -1.6, -1.5); root.add(garageLight);

/* ---------- Rues ---------- */
const roadM = mat(0x8f8780, { roughness: .9 }), lineM = mat(0xf6f0e4), walkM = mat(0xe2d4bf);
function road(x0, x1, z0, z1) { box(x1 - x0, .06, z1 - z0, roadM, (x0 + x1) / 2, .03, (z0 + z1) / 2); }
const R1 = 10, R2 = 14;
road(-R2, -R1, -HALF, HALF); road(R1, R2, -HALF, HALF);
road(-HALF, -R2, -R2, -R1); road(-R1, R1, -R2, -R1); road(R2, HALF, -R2, -R1);
road(-HALF, -R2, R1, R2); road(-R1, R1, R1, R2); road(R2, HALF, R1, R2);
{ const dashes = [];
  for (let t = -HALF + 1; t < HALF; t += 2.6) if (Math.abs(Math.abs(t) - 12) > 2.6) dashes.push([12, t, true], [-12, t, true], [t, 12, false], [t, -12, false]);
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, .02, .16), lineM, dashes.length), o = new THREE.Object3D();
  dashes.forEach((d, i) => { o.position.set(d[0], .07, d[1]); o.rotation.y = d[2] ? Math.PI / 2 : 0; o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); im.receiveShadow = true; root.add(im); }
{ const zebra = []; [-12, 12].forEach(cx => [-12, 12].forEach(cz => {
    for (let k = -3; k <= 3; k++) { zebra.push([cx + k * .55, cz + (cz > 0 ? -2.9 : 2.9), 0]); zebra.push([cx + (cx > 0 ? -2.9 : 2.9), cz + k * .55, 1]); } }));
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(.3, .02, 1.4), lineM, zebra.length), o = new THREE.Object3D();
  zebra.forEach((z, i) => { o.position.set(z[0], .07, z[1]); o.rotation.y = z[2] ? Math.PI / 2 : 0; o.updateMatrix(); im.setMatrixAt(i, o.matrix); }); root.add(im); }

/* ---------- Place centrale ---------- */
box(19.4, .12, 19.4, mat(0xb9cf97), 0, .06, 0);
cyl(5.2, 5.2, .16, walkM, 0, .1, 0, root, 48);
cyl(2.2, 2.4, .6, mat(0xf3ece0), 0, .4, 0, root, 40);
cyl(1.9, 1.9, .1, mat(0x8fc4c9, { roughness: .2 }), 0, .66, 0, root, 40);
cyl(.25, .35, 1.4, mat(0xf3ece0), 0, 1.2, 0, root, 16);
[[0, 1], [1, 0], [0, -1], [-1, 0]].forEach(([a, b]) => box(1.6, .13, 5.2, walkM, a * 7.4, .11, b * 7.4, root).rotation.y = a ? Math.PI / 2 : 0);

/* ---------- Arbres et fenêtres (en série) ---------- */
const TREES = [], WINS = [];
function tree(x, z, s = 1) { TREES.push([x, z, s * (.85 + Math.random() * .35)]); }
function windows(cx, cz, w, d, floors, fh, y0 = 0, opts = {}) {
  const ww = opts.ww || .9, wh = opts.wh || 1.2, gap = opts.gap || 2;
  for (let f = 0; f < floors; f++) { const y = y0 + f * fh + fh * .55;
    const nx = Math.max(1, Math.floor((w - .6) / gap)), nz = Math.max(1, Math.floor((d - .6) / gap));
    for (let i = 0; i < nx; i++) { const x = cx - w / 2 + (i + .5) * w / nx; if (!opts.skipFront) WINS.push([x, y, cz + d / 2 + .03, 0, ww, wh]); if (!opts.skipBack) WINS.push([x, y, cz - d / 2 - .03, 0, ww, wh]); }
    for (let i = 0; i < nz; i++) { const z = cz - d / 2 + (i + .5) * d / nz; WINS.push([cx + w / 2 + .03, y, z, 1, ww, wh]); WINS.push([cx - w / 2 - .03, y, z, 1, ww, wh]); }
  }
}

/* ---------- Les lieux ---------- */
const pickables = [];
function placeGroup(id, x, z, top, opts = {}) {
  const g = new THREE.Group(); g.position.set(x, 0, z); root.add(g);
  const p = byId[id]; p.group = g; p.anchor = new THREE.Vector3(x + (opts.ax || 0), top, z + (opts.az || 0)); p.focus = new THREE.Vector3(x + (opts.fx || 0), opts.fy ?? top * .4, z + (opts.fz || 0));
  p.dist = opts.dist || Math.max(26, top * 2.6); p.azim = opts.azim; p.polar = opts.polar;
  return g;
}
function tagPick(g, id) { g.traverse(o => { if (o.isMesh) { o.userData.place = id; pickables.push(o); } }); }

{ const g = placeGroup("home", 23.5, 0, 17.6, { fy: 7, dist: 44, azim: 1.05, polar: 1.05 });
  const facade = mat(0xf2ae8a), white = mat(0xfaf4ea);
  box(9, 16, 8, facade, 0, 8, 0, g, .25);
  box(9.6, .5, 8.6, white, 0, 16.2, 0, g, .15);
  for (let f = 1; f < 5; f++) { box(9.4, .18, 1.1, white, 0, f * 3.2, 4.5, g, .05); box(9.4, .6, .08, white, 0, f * 3.2 + .4, 5.02, g); }
  box(2.2, 2.6, .3, mat(0x7a5b48), 0, 1.3, 4.05, g, .05);
  box(3.4, .2, 1.4, white, 0, 2.8, 4.6, g, .05);
  windows(g.position.x, g.position.z, 9, 8, 5, 3.2, 0, { gap: 2.2 });
  box(1.3, 1.6, .12, glow(0x3fd39a, .9, 2.2), -2.2, 3 * 3.2 + 1.7, 4.08, g);
  box(1.5, 1.2, 1.2, mat(0xe9ddcb), 2.5, 16.9, -1.5, g, .1);
  tagPick(g, "home");
  const ga = placeGroup("garage", 26, -2, -.2, { fy: -2.2, fx: 0, dist: 30, azim: Math.PI / 2 + .28, polar: 1.32, ax: 1.5, az: 1.5 });
  const car = new THREE.Group(); car.position.set(26.2, -DEPTH + .45, -.2); root.add(car);
  const body = mat(0x8d93a3, { roughness: .4 });
  box(4.6, .95, 2, body, 0, .75, 0, car, .4);
  box(2.6, .8, 1.8, body, -.2, 1.5, 0, car, .35);
  box(2.5, .62, 1.84, mat(0x2c2f36, { roughness: .15 }), -.2, 1.52, 0, car, .25);
  [[-1.5, .95], [1.5, .95], [-1.5, -.95], [1.5, -.95]].forEach(([a, b]) => { const w = cyl(.42, .42, .3, mat(0x2a2624), a, .42, b, car, 18); w.rotation.x = Math.PI / 2; });
  const hl = glow(0xfff4d6, .6, 1.8); box(.1, .18, .5, hl, 2.31, .95, .6, car); box(.1, .18, .5, hl, 2.31, .95, -.6, car);
  car.rotation.y = Math.PI / 2; car.position.z = -1.4;
  tagPick(car, "garage"); ga.add(new THREE.Object3D());
  box(.15, 1.8, .15, mat(0x5d5752), 14.6, .9, -9.6); box(1.2, .7, .08, mat(0x3e74c9), 14.6, 2, -9.6, root, .05);
  tree(17, 8.5); tree(29, 8); tree(17, -12.4, .8);
}
{ const g = placeGroup("banque", 22, -22, 9.2, { fy: 3 });
  const c = mat(0xf7e2a3), w = mat(0xfbf5e8);
  box(11, 1, 8, w, 0, .5, 0, g, .1); box(10, 6.4, 6.6, c, 0, 4.2, -.4, g, .15);
  for (let i = 0; i < 6; i++) cyl(.32, .36, 5.4, w, -4.2 + i * 1.68, 3.7, 3.4, g, 16);
  box(11, .6, 8.2, w, 0, 7.4, 0, g, .1); prism(11, 1.9, 1.4, w, 0, 7.7, 3.4, g); box(10, 1.6, 5, c, 0, 8.4, -1, g, .1);
  box(1.6, 2.6, .2, mat(0x7a5b48), 0, 2.3, 2.9, g);
  windows(g.position.x, g.position.z - .4, 10, 6.6, 2, 2.8, 1.4, { skipFront: true, gap: 2.4 });
  tagPick(g, "banque"); tree(16.5, -17); tree(27.5, -17.2); tree(28, -27.5, .9);
}
{ const g = placeGroup("impots", 22.5, 22, 14, { fy: 4 });
  const c = mat(0xe8e3da), roof = mat(0x6c7a84);
  box(12, 7, 8, c, 0, 3.5, 0, g, .15); prism(12.6, 2.6, 8.6, roof, 0, 7, 0, g, Math.PI / 2);
  box(12.4, .4, .5, mat(0xfaf6ee), 0, 7, 4.1, g); box(2.4, 3, .25, mat(0x55606a), 0, 1.5, 4.05, g, .05); box(4.4, .25, 1.6, mat(0xfaf6ee), 0, 3.2, 4.7, g, .05);
  windows(g.position.x, g.position.z, 12, 8, 2, 3.2, 0, { gap: 2.3 });
  cyl(.08, .08, 5, mat(0xdcd6cc), 5.3, 9.5, 4, g, 8);
  [0x2f55a4, 0xf6f3ee, 0xe0453a].forEach((col, i) => box(.7, 1.4, .06, mat(col), 5.3 + .35 + i * .7, 11.2, 4, g));
  tagPick(g, "impots"); tree(16.6, 27.6); tree(28, 17); tree(28.2, 27.8, .9);
}
{ const g = placeGroup("mairie", 0, 22.5, 16.4, { fy: 5 });
  const c = mat(0xefdcc0), w = mat(0xfaf3e7), roof = mat(0xbd6b52);
  box(14, 6, 7, c, 0, 3, 0, g, .15); prism(14.4, 2.4, 7.4, roof, 0, 6, 0, g, Math.PI / 2);
  box(3.6, 10.5, 3.6, w, 0, 5.25, 1.2, g, .15);
  const face = cyl(1.2, 1.2, .15, mat(0xfffbf2), 0, 8.6, 3.06, g, 32); face.rotation.x = Math.PI / 2;
  box(.12, .9, .06, mat(0x3a302a), 0, 8.95, 3.16, g); box(.6, .1, .06, mat(0x3a302a), .25, 8.6, 3.16, g);
  prism(4.2, 3, 4.2, roof, 0, 10.5, 1.2, g); box(1.8, 2.6, .2, mat(0x7a5b48), 0, 1.3, 3.05, g);
  windows(g.position.x, g.position.z, 14, 7, 2, 2.8, 0, { gap: 2.6 });
  tagPick(g, "mairie"); tree(-6, 27.8); tree(6.5, 27.8); tree(-8.5, 17, .9); tree(8.5, 17, .9);
}
{ const g = placeGroup("orange", -21.5, -2.5, 10.6, { fy: 2.5, dist: 30 });
  const c = mat(0xf7efe5), o = mat(0xff7a1a, { roughness: .6 });
  box(8, 4.6, 6, c, 0, 2.3, 0, g, .2); box(8.4, .5, 6.4, mat(0x3b322d), 0, 4.75, 0, g, .1);
  const aw = box(7.6, .15, 1.8, o, 0, 3.2, 3.7, g); aw.rotation.x = .32;
  box(6.4, 2, .12, mat(0x2c3a40, { roughness: .15 }), 0, 1.5, 3.02, g); box(2.4, .9, .15, o, 2.4, 4.2, 3.1, g, .05);
  cyl(.1, .16, 5.4, mat(0xdcd3c8), -2.4, 7.7, -1.2, g, 8);
  for (let k = 0; k < 3; k++) { const a = k * 2.1; box(.3, 1.1, .12, mat(0xf6f2ea), -2.4 + Math.cos(a) * .35, 9.4, -1.2 + Math.sin(a) * .35, g).rotation.y = -a; }
  tagPick(g, "orange"); tree(-16.8, 3.5); tree(-28, -8.6); tree(-16.6, -8.4, .9);
}
{ const g = placeGroup("clinique", -22, -22.5, 13.4, { fy: 5 });
  const w = mat(0xf7f4ee);
  box(12, 9, 8, w, 0, 4.5, 0, g, .2); box(6, 4, 5, w, -3, 11, -.5, g, .2); box(12.4, .35, 8.4, mat(0xd9e4e6), 0, 9.1, 0, g, .1);
  cyl(2.2, 2.2, .12, mat(0x5e6a70), 2.6, 9.35, -1, g, 32);
  box(2.2, .04, .4, mat(0xf6f2ea), 2.6, 9.43, -1, g); box(.4, .04, 1.6, mat(0xf6f2ea), 1.7, 9.43, -1, g); box(.4, .04, 1.6, mat(0xf6f2ea), 3.5, 9.43, -1, g);
  const cr = glow(0xe0473a, .2, 1.8); box(.7, 2.2, .15, cr, -3, 11.2, 2.06, g); box(2.2, .7, .15, cr, -3, 11.2, 2.06, g);
  box(3, 2.8, .2, mat(0x9fc2cc, { roughness: .2 }), 0, 1.4, 4.05, g); box(5, .25, 2, w, 0, 3, 4.9, g, .05);
  windows(g.position.x, g.position.z, 12, 8, 3, 2.9, 0, { gap: 2.2 });
  tagPick(g, "clinique"); tree(-16.7, -16.8); tree(-27.8, -16.8, .9); tree(-27.6, -28, .9);
}
{ const g = placeGroup("medecin", -3.5, -21.5, 8.2, { fy: 2.6, dist: 28 });
  box(7, 4.2, 6, mat(0xe6efe4), 0, 2.1, 0, g, .2); prism(7.6, 2.4, 6.6, mat(0x6f9a7c), 0, 4.2, 0, g, Math.PI / 2);
  const gc = glow(0x2fa36b, .25, 1.8); box(.4, 1.3, .12, gc, 2.4, 3.2, 3.08, g); box(1.3, .4, .12, gc, 2.4, 3.2, 3.08, g);
  box(1.5, 2.4, .2, mat(0x6f553f), -1, 1.2, 3.05, g);
  windows(g.position.x, g.position.z, 7, 6, 1, 3, 0, { gap: 2.5 });
  tagPick(g, "medecin"); tree(-8.5, -17.5); tree(1.5, -27.5, .9); tree(-8.5, -27.5, .8);
}
{ const g = placeGroup("usine", -21.5, 22, 21.5, { fy: 5, dist: 40 });
  const c = mat(0xd7c8b6), roof = mat(0x8c7f72), w = mat(0xf6f1e8), red = mat(0xd2513e);
  box(13, 6, 9, c, 0, 3, 0, g, .15);
  for (let i = 0; i < 4; i++) { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(3.25, 0); s.lineTo(3.25, 2.2); s.lineTo(0, 0);
    const ge = new THREE.ExtrudeGeometry(s, { depth: 9, bevelEnabled: false }); ge.translate(-6.5 + i * 3.25, 6, -4.5);
    add(new THREE.Mesh(ge, roof), g); box(.08, 2, 8.6, glow(0xffd79a, .15, 1.4), -6.5 + (i + 1) * 3.25 - .06, 7.1, 0, g); }
  box(3.2, 3.6, .2, mat(0x6d6a66), -3, 1.8, 4.55, g); box(3.2, 3.6, .2, mat(0x6d6a66), 2.5, 1.8, 4.55, g);
  box(1.6, 1, .1, glow(0xff8a3a, .9, 2.4), 5.4, 2, 4.56, g);
  for (let k = 0; k < 5; k++) cyl(.95 - k * .04, 1 - k * .04, 2.8, k % 2 ? red : w, 4.4, 6 + k * 2.8 + 1.4, -2.3, g, 20);
  windows(g.position.x, g.position.z, 13, 9, 1, 4.2, .6, { gap: 2.6, skipFront: true, ww: 1.4, wh: 1.4 });
  tagPick(g, "usine"); tree(-27.8, 16.6); tree(-16.6, 28, .9);
}
let rotor;
{ const g = placeGroup("energie", 6, -23, 14.5, { fy: 5, dist: 34, fx: 0 });
  box(3.2, 2.6, 2.4, mat(0xe7e1d6), -2.2, 1.3, 2.5, g, .12); box(.5, .9, .1, glow(0xf2c230, .25, 1.6), -2.2, 1.6, 3.75, g);
  cyl(.25, .45, 12, mat(0xfbf8f2), 1, 6, 0, g, 16); box(.8, .8, 1.6, mat(0xfbf8f2), 1, 12.2, .4, g, .3);
  rotor = new THREE.Group(); rotor.position.set(1, 12.2, 1.3); g.add(rotor);
  for (let k = 0; k < 3; k++) { const b = box(.35, 5.6, .12, mat(0xfbf8f2), 0, 2.8, 0, rotor, .12); const piv = new THREE.Group(); piv.rotation.z = k * Math.PI * 2 / 3; piv.add(b); rotor.add(piv); }
  tagPick(g, "energie"); tree(-5, -28, .8);
}

/* ---------- Le reste de la ville ---------- */
const pastel = [0xf3cfb3, 0xe9d9bb, 0xf5dfaa, 0xe6bfae, 0xdfe3c8, 0xf0e2cf, 0xe8c9b9], roofs = [0xc76e56, 0xb4634e, 0x8f7a6a, 0xd38a5c];
function house(x, z, rot = 0, big = false) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; root.add(g);
  const w = big ? 5 : 3.6, d = big ? 4.6 : 3.4, h = big ? 6.5 : 2.8;
  box(w, h, d, mat(pastel[(Math.random() * pastel.length) | 0]), 0, h / 2, 0, g, .15);
  if (big) box(w + .3, .35, d + .3, mat(0xf7efe3), 0, h + .17, 0, g, .08);
  else prism(w + .5, 1.6, d + .4, mat(roofs[(Math.random() * roofs.length) | 0]), 0, h, 0, g, Math.PI / 2);
  box(.9, 1.6, .12, mat(0x7d604c), 0, .8, d / 2 + .02, g);
  g.updateMatrixWorld(true);
  const p = new THREE.Vector3();
  for (let f = 0; f < (big ? 2 : 1); f++) for (let s = -1; s <= 1; s += 2) {
    p.set(s * w * .28, f * 3 + 1.9, d / 2 + .03); g.localToWorld(p); WINS.push([p.x, p.y, p.z, rot ? 1 : 0, .7, .9]);
    p.set(s * w * .28, f * 3 + 1.9, -d / 2 - .03); g.localToWorld(p); WINS.push([p.x, p.y, p.z, rot ? 1 : 0, .7, .9]); }
}
house(-7.5, -26.8); house(-27.2, 4.5, Math.PI / 2); house(-27.2, -5.5, Math.PI / 2, true); house(-16.8, -4.8, -Math.PI / 2);
house(-27.4, 9.2, Math.PI / 2); house(-6, 16.8, Math.PI, true); house(6, 16.6, Math.PI); house(-27.5, -12.5);
house(17.5, -27.2, 0, true); house(27.5, -12.6, 0); house(17, 26.8, 0); house(-8.7, 26.6, Math.PI, false);
house(9.3, 26.8, Math.PI); house(-17, 17.3, Math.PI / 2); house(16.6, 17, 0); house(27.2, 12.4, Math.PI);
house(16.8, -17.4, -Math.PI / 2, true); house(28.4, -21.5, Math.PI / 2);
for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 + .3, r = 7.2 + ((k % 2) ? .6 : 0); if (Math.abs(Math.sin(a)) > .2 && Math.abs(Math.cos(a)) > .2) tree(Math.cos(a) * r, Math.sin(a) * r, .9); }
[[-8, -8], [8, -8], [-8, 8], [8, 8], [-4, -8.4], [4, 8.4], [-8.4, 4], [8.4, -4]].forEach(([x, z]) => tree(x, z, 1.05));
for (let t = -26; t <= 26; t += 6.5) if (Math.abs(t) > 15) { tree(t, -29, .75); tree(-29, t, .75); }

{ const n = TREES.length, o = new THREE.Object3D(), col = new THREE.Color();
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(.16, .22, 1.4, 8), mat(0x8b6a52), n);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.25, 2), mat(0xffffff, { roughness: .9 }), n);
  const greens = [0x86b06f, 0x9cbc78, 0x739f63, 0xa8c27f];
  TREES.forEach(([x, z, s], i) => { o.position.set(x, .7 * s, z); o.scale.set(s, s, s); o.rotation.set(0, 0, 0); o.updateMatrix(); trunk.setMatrixAt(i, o.matrix);
    o.position.set(x, 2.1 * s, z); o.scale.set(s, s * 1.12, s); o.rotation.y = Math.random() * 6; o.updateMatrix(); crown.setMatrixAt(i, o.matrix);
    crown.setColorAt(i, col.setHex(greens[i % greens.length])); });
  [trunk, crown].forEach(m => { m.castShadow = true; m.receiveShadow = true; root.add(m); }); }
const winDay = new THREE.Color(0x5d6a70), winLit = new THREE.Color(0xffd28a), winOff = new THREE.Color(0x3c3a3e);
const winMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, .06), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .25, metalness: .1 }), WINS.length);
const winLitFlags = WINS.map(() => Math.random() < .55);
{ const o = new THREE.Object3D(); WINS.forEach(([x, y, z, side, w, h], i) => { o.position.set(x, y, z); o.rotation.set(0, side ? Math.PI / 2 : 0, 0); o.scale.set(w, h, 1); o.updateMatrix(); winMesh.setMatrixAt(i, o.matrix); winMesh.setColorAt(i, winDay); }); root.add(winMesh); }
const winGlowMat = new THREE.MeshBasicMaterial({ color: 0xffc977, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
const litIdx = WINS.map((w, i) => i).filter(i => winLitFlags[i]);
{ const winGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), winGlowMat, litIdx.length), o = new THREE.Object3D();
  litIdx.forEach((wi, i) => { const [x, y, z, side, w, h] = WINS[wi]; o.position.set(x, y, z); o.rotation.set(0, side ? Math.PI / 2 : 0, 0); o.scale.set(w * .92, h * .92, 1); o.updateMatrix(); winGlow.setMatrixAt(i, o.matrix); });
  root.add(winGlow); }

/* ---------- Lampadaires ---------- */
const lampHead = glow(0xffe2a8, 0, 2.2), lamps = [];
for (let t = -26; t <= 26; t += 8) { if (Math.abs(Math.abs(t) - 12) < 3) continue; lamps.push([9.4, t], [-9.4, t], [t, 9.4], [t, -9.4]); }
lamps.forEach(([x, z]) => { cyl(.07, .09, 3.2, mat(0x4b4440), x, 1.6, z, root, 6); cyl(.3, .22, .25, lampHead, x, 3.25, z, root, 10); });
const haloTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d"); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,220,160,.9)"); g.addColorStop(.35, "rgba(255,200,130,.35)"); g.addColorStop(1, "rgba(255,190,120,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const haloMat = new THREE.SpriteMaterial({ map: haloTex, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending });
lamps.forEach(([x, z]) => { const s = new THREE.Sprite(haloMat); s.position.set(x, 3.3, z); s.scale.set(3, 3, 1); root.add(s); });
{ const s = new THREE.Sprite(haloMat); s.position.set(27, -.9, -1.5); s.scale.set(9, 4, 1); root.add(s); }

/* ---------- Jarvis, au-dessus de la place ---------- */
const jarvis = new THREE.Group(); jarvis.position.set(0, 8.5, 0); root.add(jarvis);
{ const core = new THREE.Mesh(new THREE.SphereGeometry(1.05, 40, 24), new THREE.MeshStandardMaterial({ color: 0xffc56b, emissive: 0xff9a3d, emissiveIntensity: 1.3, roughness: .3 }));
  jarvis.add(core); core.userData.place = "jarvis"; pickables.push(core);
  const ringM = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: .75 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, .04, 8, 90), ringM); ring.rotation.x = Math.PI / 2.3; jarvis.add(ring); jarvis.userData.ring = ring;
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.4, .025, 8, 90), ringM); ring2.rotation.x = Math.PI / 1.8; ring2.rotation.y = .6; jarvis.add(ring2); jarvis.userData.ring2 = ring2;
  const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, transparent: true, depthWrite: false, opacity: .9, blending: THREE.AdditiveBlending })); h.scale.set(7, 7, 1); jarvis.add(h);
  const jl = new THREE.PointLight(0xffb062, 40, 22, 1.7); jarvis.add(jl); jarvis.userData.light = jl; }

/* ---------- Voitures qui circulent ---------- */
const cars = [], carCols = [0xd9574a, 0xf2efe6, 0x4d7bc2, 0xf2b544, 0x6aa37d, 0x3d3a3a];
function makeCar(c) { const g = new THREE.Group(); const m = mat(c, { roughness: .4, metalness: .2 });
  box(2.4, .7, 1.2, m, 0, .55, 0, g, .25); box(1.3, .55, 1.05, m, -.15, 1.1, 0, g, .22); box(1.25, .42, 1.1, mat(0x2a2d33, { roughness: .15 }), -.15, 1.12, 0, g, .15);
  const hl = glow(0xfff2cc, 0, 2); box(.06, .14, .3, hl, 1.2, .6, .33, g); box(.06, .14, .3, hl, 1.2, .6, -.33, g);
  root.add(g); return g; }
function loopPos(t, L) { const s = t % 4, k = s % 1; let x, z, ang;
  if (s < 1) { x = -L + 2 * L * k; z = -L; ang = 0; } else if (s < 2) { x = L; z = -L + 2 * L * k; ang = -Math.PI / 2; } else if (s < 3) { x = L - 2 * L * k; z = L; ang = Math.PI; } else { x = -L; z = L - 2 * L * k; ang = Math.PI / 2; }
  return [x, z, ang]; }
for (let i = 0; i < 6; i++) cars.push({ g: makeCar(carCols[i]), t: i / 6 * 4, r: i % 2 ? 11.1 : 12.9, dir: i % 2 ? -1 : 1, v: .045 + .01 * (i % 3) });

/* ---------- Jour et nuit ---------- */
const SKY = {
  day: { s1: "#f2dcc3", s2: "#fbf2e7", fog: 0xf6e8d8, hemi: 1.15, sun: 2.6, sunC: 0xfff1dc, exp: 1.05, win: 0, halo: 0, pos: [-38, 62, 30], theme: "#f1dcc4" },
  night: { s1: "#1c1512", s2: "#3a2a22", fog: 0x2b1f1a, hemi: .32, sun: .55, sunC: 0xb8c4ff, exp: 1.15, win: 1, halo: .9, pos: [30, 50, -20], theme: "#1c1512" },
};
function applySky(night) {
  S.night = night; const k = night ? SKY.night : SKY.day;
  document.body.style.setProperty("--sky1", k.s1); document.body.style.setProperty("--sky2", k.s2);
  document.body.classList.toggle("night", night);
  document.querySelector('meta[name="theme-color"]').setAttribute("content", k.theme);
  scene.fog.color.setHex(k.fog); hemi.intensity = k.hemi; hemi.color.setHex(night ? 0x8f8fb8 : 0xfff4e6); hemi.groundColor.setHex(night ? 0x3a2a22 : 0xb48a6c);
  sun.intensity = k.sun; sun.color.setHex(k.sunC); sun.position.set(...k.pos); renderer.toneMappingExposure = k.exp;
  winGlowMat.opacity = k.win; haloMat.opacity = k.halo;
  WINS.forEach((w, i) => winMesh.setColorAt(i, night ? (winLitFlags[i] ? winLit : winOff) : winDay)); winMesh.instanceColor.needsUpdate = true;
  glowMats.forEach(m => m.emissiveIntensity = night ? m.userData.night : m.userData.day);
  garageLight.intensity = night ? 45 : 30; jarvis.userData.light.intensity = night ? 60 : 25;
  $("skyIc").innerHTML = night ? '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>'
    : '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>';
}
{ const h = new Date().getHours(); applySky(h < 7 || h >= 19); }
$("sky").addEventListener("click", () => applySky(!S.night));

/* =========================================================
   Caméra libre : un doigt pour tourner, deux pour zoomer et glisser.
   Elle ne bouge seule que quand tu touches un lieu.
   ========================================================= */
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = .09;
controls.rotateSpeed = .55; controls.zoomSpeed = .9; controls.panSpeed = .9;
controls.minDistance = 9; controls.maxDistance = 230;
controls.minPolarAngle = .18; controls.maxPolarAngle = 1.42;
controls.screenSpacePanning = false; controls.zoomToCursor = true;
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
const overviewDist = () => innerHeight > innerWidth ? 196 : 110;
const distK = () => { const a = innerWidth / innerHeight; return a < 1 ? Math.min(1.9, .8 / a) : 1; };
camera.position.set(-70, 120, 150); controls.target.set(0, 0, 0); controls.update();

let fly = null;
const tmpS = new THREE.Spherical();
function flyTo(target, dist, azim, polar, dur = 1.15) {
  const s0 = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  const a1 = azim ?? s0.theta; let d = a1 - s0.theta; d = Math.atan2(Math.sin(d), Math.cos(d));
  fly = { t: 0, dur, t0: controls.target.clone(), t1: target.clone(), r0: s0.radius, r1: dist, a0: s0.theta, a1: s0.theta + d, p0: s0.phi, p1: polar ?? Math.min(Math.max(s0.phi, .75), 1.1) };
}
controls.addEventListener("start", () => { fly = null; });
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function stepFly(dt) {
  if (!fly) return; fly.t += dt / fly.dur; const k = ease(Math.min(1, fly.t));
  controls.target.lerpVectors(fly.t0, fly.t1, k);
  tmpS.set(fly.r0 + (fly.r1 - fly.r0) * k, fly.p0 + (fly.p1 - fly.p0) * k, fly.a0 + (fly.a1 - fly.a0) * k);
  camera.position.setFromSpherical(tmpS).add(controls.target);
  if (fly.t >= 1) fly = null;
}
function clampTarget() { const t = controls.target; t.x = Math.max(-34, Math.min(34, t.x)); t.z = Math.max(-34, Math.min(34, t.z)); t.y = Math.max(-3, Math.min(14, t.y)); }
function overview() { flyTo(new THREE.Vector3(0, 0, 0), overviewDist(), -.5, .92, 1.3); }
let viewShift = 0, viewShiftGoal = 0;
function layout() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = h > w ? 42 : 34; camera.updateProjectionMatrix(); }
addEventListener("resize", layout); layout();

/* =========================================================
   Repères sur les lieux
   ========================================================= */
const pinsEl = $("pins");
PLACES.forEach(p => {
  const b = document.createElement("button"); b.className = "pin"; b.style.setProperty("--c", p.color);
  b.innerHTML = '<span class="bub"><span class="ic"></span><span class="tx"><b></b><span></span></span></span><span class="stem"></span><span class="foot"></span>';
  b.querySelector(".ic").textContent = p.emoji; b.querySelector(".tx b").textContent = p.name; p.statusEl = b.querySelector(".tx span");
  b.addEventListener("click", e => { e.stopPropagation(); select(p); }); pinsEl.append(b); p.pin = b;
});
function refreshPins() { PLACES.forEach(p => { p.pin.classList.toggle("urgent", !!p.urgent); p.statusEl.textContent = p.status; p.pin.setAttribute("aria-label", p.name + ", " + p.status); }); }
const v3 = new THREE.Vector3();
let talkOpen = false;
function placePins() {
  const W = innerWidth, H = innerHeight, items = [];
  PLACES.forEach(p => {
    v3.copy(p.anchor); const dist = camera.position.distanceTo(v3); v3.project(camera);
    const x = (v3.x + 1) / 2 * W, y = (1 - v3.y) / 2 * H;
    items.push({ p, x, y, dist, onScreen: v3.z < 1 && x > -40 && x < W + 40 && y > -40 && y < H + 40,
      compact: dist > (small ? 78 : 95) && S.sel !== p && !p.urgent, prio: (S.sel === p ? 0 : (p.urgent ? 1 : 2)) * 1000 + dist });
  });
  items.sort((a, b) => a.prio - b.prio);
  const taken = [], topLimit = 110, botLimit = H - (S.sel || talkOpen || bookOpen || setOpen ? H * .46 : 84);
  items.forEach(it => {
    const el = it.p.pin; el.classList.toggle("compact", it.compact); el.classList.toggle("sel", S.sel === it.p);
    const bub = el.firstChild, w = bub.offsetWidth || 42, h = (bub.offsetHeight || 42) + 22;
    let dx = 0; const L = it.x - w / 2, Rr = it.x + w / 2; if (L < 8) dx = 8 - L; else if (Rr > W - 8) dx = W - 8 - Rr;
    bub.style.transform = dx ? `translateX(${dx}px)` : "";
    let ok = false, lift = 0;
    if (it.onScreen && it.y < botLimit + 20) for (const k of [0, 1, 2]) {
      const L2 = k * (h - 10), r = { x0: it.x - w / 2 + dx, x1: it.x + w / 2 + dx, y0: it.y - h - L2, y1: it.y - L2 };
      if (r.y0 < topLimit - 30) break;
      if (!taken.some(t => r.x0 < t.x1 + 4 && r.x1 > t.x0 - 4 && r.y0 < t.y1 + 2 && r.y1 > t.y0 - 2)) { ok = true; lift = L2; taken.push(r); break; }
    }
    el.querySelector(".stem").style.height = (14 + lift) + "px";
    el.classList.toggle("hide", !ok);
    el.style.transform = `translate(${it.x}px,${it.y}px) translate(-50%,-100%)`;
    el.style.zIndex = String(5000 - Math.round(it.prio % 1000));
  });
}

/* =========================================================
   Fiche d'un lieu
   ========================================================= */
const sheet = $("sheet");
function select(p) {
  S.sel = p; closeTalk(true); closeBook(true); closeSettings(true);
  flyTo(p.focus, p.dist * distK(), p.azim, p.polar);
  viewShiftGoal = 1;
  $("card").style.setProperty("--c", p.color); $("pIc").style.setProperty("--c", p.color); $("pIc").textContent = p.emoji;
  $("pPlace").textContent = p.place; $("pName").textContent = p.name;
  renderSheet(p);
  sheet.classList.add("open"); $("ask").classList.add("away");
}
function renderSheet(p) {
  $("pSay").textContent = p.say;
  const f = $("pFacts"); f.innerHTML = "";
  p.facts.forEach(([a, b]) => { const d = document.createElement("div"); d.className = "fact"; const x = document.createElement("b"); x.textContent = a; const y = document.createElement("span"); y.textContent = b; d.append(x, y); f.append(d); });
  const box = $("pDocs"); box.innerHTML = ""; const docs = p.docs || [];
  const dh = document.createElement("div"); dh.className = "dh"; dh.innerHTML = "<b>Rangés ici</b><span></span>";
  dh.querySelector("span").textContent = docs.length ? docs.length + (docs.length > 1 ? " papiers" : " papier") : ""; box.append(dh);
  if (!docs.length) { const e = document.createElement("div"); e.className = "empty"; e.textContent = "Rien pour l’instant"; box.append(e); }
  docs.forEach(d => { const b = document.createElement("button"); b.className = "doc" + (d.future ? " soon" : "");
    b.innerHTML = '<span class="pg"></span><span class="dt"><b></b><span></span></span><span class="dv"></span><span class="chev">›</span>';
    b.querySelector(".dt b").textContent = d.t; b.querySelector(".dt span").textContent = d.d; b.querySelector(".dv").textContent = d.v || "";
    b.addEventListener("click", () => openDoc(p, d)); box.append(b); });
  $("pNote").textContent = p.live || "";
  $("card").scrollTop = 0;
  const acts = $("pActs"); acts.innerHTML = "";
  const mk = (t, c, fn) => { const b = document.createElement("button"); b.className = "btn " + c; b.textContent = t; b.addEventListener("click", fn); acts.append(b); return b; };
  if (p.id === "clinique") {
    mk("Prendre rendez-vous", "main", () => openBook());
    const u = mk("Mettre à jour", "soft", async () => { u.disabled = true; u.textContent = "Je regarde…"; await medin({ action: "sync" }, true); u.disabled = false; u.textContent = "Mettre à jour"; });
  } else mk("Demander à Jarvis", "main", () => openTalk(p));
}
function deselect() { if (!S.sel) return; S.sel = null; sheet.classList.remove("open"); $("ask").classList.remove("away"); viewShiftGoal = 0; }
$("pClose").addEventListener("click", deselect);
$("home").addEventListener("click", () => { deselect(); closeTalk(); closeBook(); closeSettings(); overview(); });
function swipeClose(el, fn) { let y0 = null;
  el.addEventListener("pointerdown", e => { if (e.target.closest("button,input,a,.msgs,.chips,.slots")) return; y0 = e.clientY; });
  el.addEventListener("pointerup", e => { if (y0 !== null && e.clientY - y0 > 50 && !el.scrollTop) fn(); y0 = null; });
  el.addEventListener("pointercancel", () => y0 = null); }
swipeClose($("card"), deselect);

/* ---------- Un papier ---------- */
async function openDoc(p, d) {
  $("paper").style.setProperty("--c", p.color); $("dD").textContent = p.name + (d.d ? " · " + d.d : ""); $("dT").textContent = d.t;
  $("dV").textContent = d.v || ""; $("dV").hidden = !d.v;
  const L = $("dL"); L.innerHTML = "";
  (d.lines || []).forEach(([a, b]) => { const r = document.createElement("div"); r.className = "row"; const x = document.createElement("span"); x.textContent = a; const y = document.createElement("b"); y.textContent = b; r.append(x, y); L.append(r); });
  $("dW").textContent = (/Mac|Téléchargements/.test(d.where || "") ? "Sur ton Mac : " : "Rangé dans : ") + (d.where || "Jarvis");
  const pdf = $("dPdf"), x = $("dX");
  pdf.hidden = true; x.hidden = true; x.textContent = "Annuler ce rendez-vous"; x.dataset.step = "";
  if (d.tel) { pdf.hidden = false; pdf.href = "tel:" + d.tel.replace(/\s/g, ""); pdf.textContent = "Appeler " + d.tel; pdf.removeAttribute("target"); }
  if (d.path) {
    pdf.hidden = false; pdf.textContent = "Je prépare le PDF…"; pdf.removeAttribute("href"); pdf.classList.add("wait"); pdf.target = "_blank";
    const { data, error } = await sb.storage.from("papiers").createSignedUrl(d.path, 600);
    pdf.classList.remove("wait");
    if (error || !data) pdf.textContent = "PDF introuvable";
    else { pdf.href = data.signedUrl; pdf.textContent = "Ouvrir le PDF"; }
  }
  if (d.cancelId) { x.hidden = false; x.dataset.id = d.cancelId; }
  $("paperwrap").classList.add("open");
}
$("dX").addEventListener("click", async e => {
  e.preventDefault(); const x = $("dX");
  if (x.dataset.step !== "sure") { x.dataset.step = "sure"; x.textContent = "Touche encore pour confirmer l’annulation"; x.classList.add("danger"); return; }
  x.dataset.step = "busy"; x.textContent = "J’annule sur MédinLyon…"; x.classList.remove("danger");
  const r = await medin({ action: "annuler", id: x.dataset.id });
  x.textContent = r && r.ok ? "Annulé ✓" : "Pas annulé";
  if (r && r.ok) setTimeout(() => $("paperwrap").classList.remove("open"), 1200);
});
$("dClose").addEventListener("click", () => $("paperwrap").classList.remove("open"));
$("paperwrap").addEventListener("click", e => { if (e.target.id === "paperwrap") $("paperwrap").classList.remove("open"); });

/* ---------- Le mot du haut ---------- */
function updateBrief() {
  const h = new Date().getHours(), n = PLACES.reduce((a, p) => a + (p.docs || []).length, 0);
  $("hello").textContent = (h >= 5 && h < 18 ? "Bonjour" : "Bonsoir") + (S.prenom ? " " + S.prenom : "") + (n ? " · " + n + " papiers rangés" : "");
  const u = PLACES.filter(p => p.urgent);
  $("brief").classList.toggle("calm", !u.length);
  $("briefTxt").textContent = !S.loaded ? "Je charge ta ville…" : u.length ? (u.length === 1 ? u[0].name + " : " + u[0].status : u.length + " choses à regarder") : (S.next || "Tout est en ordre");
}
$("brief").addEventListener("click", () => { const u = PLACES.find(p => p.urgent); select(u || (S.nextPlace && byId[S.nextPlace]) || byId.home); });

/* ---------- Toucher un bâtiment ---------- */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null, touches = 0;
canvas.addEventListener("pointerdown", e => { touches++; down = { x: e.clientX, y: e.clientY, t: performance.now(), multi: touches > 1 }; });
const up = () => { touches = Math.max(0, touches - 1); };
canvas.addEventListener("pointercancel", up);
canvas.addEventListener("pointerup", e => {
  up(); if (!down) return; const d = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t, multi = down.multi; down = null;
  if (d > 8 || dt > 350 || multi) return;
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(pickables, false)[0]; if (!hit) return;
  const id = hit.object.userData.place;
  if (id === "jarvis") openTalk(null); else select(byId[id]);
});

/* =========================================================
   Les données (Supabase, en direct)
   ========================================================= */
function applyMac(rows) {
  rows.filter(r => r.kind === "lieu").forEach(r => {
    const p = byId[r.label]; if (!p) return; const d = r.data || {};
    if (r.label === "clinique") { p.macDocs = d.docs || []; return; }
    if (r.label === "home" || r.label === "energie") { p.macDocs = d.docs || []; p.docs = [...p.macDocs]; return; }
    Object.assign(p, { place: d.place || p.place, status: d.status || p.status, say: d.say || p.say, facts: d.facts || [], docs: d.docs || [],
      live: (d.docs || []).length ? "D’après tes papiers trouvés sur ton Mac" : "Pas encore branché" });
  });
  const prof = rows.find(r => r.source === "jarvis" && r.kind === "profil");
  if (prof) { S.prenom = prof.data?.prenom || ""; S.profil = prof.data?.texte || ""; }
}
const stamp = (rows, qui) => { const up = rows.map(r => r.updated_at).filter(Boolean).sort().pop(); return up ? "En direct · " + qui + " le " + quand(up) : ""; };

function applyEnergie(rows) {
  const e = byId.energie; if (!rows.length) { e.status = "À brancher"; e.say = "Plenitude n’est pas encore relu."; return; }
  const today = new Date().toISOString().slice(0, 10), ENS = ["Gaz", "Électricité"];
  const conso = Object.fromEntries(rows.filter(r => r.kind === "conso").map(r => [r.label, r.data]));
  const plan = Object.fromEntries(rows.filter(r => r.kind === "echeancier").map(r => [r.label, r]));
  const sorted = k => rows.filter(r => r.kind === k && r.date).sort((a, b) => a.date.localeCompare(b.date));
  const pay = sorted("paiement"), ech = sorted("echeance").filter(r => r.date >= today);
  const next = {}; ENS.forEach(n => next[n] = ech.find(r => r.label === n));
  const tot = ENS.reduce((a, n) => a + (next[n] ? Number(next[n].amount) : 0), 0);
  const dern = {}; ENS.forEach(n => dern[n] = pay.filter(r => r.label === n).slice(-1)[0]);
  const mois = d => MOIS[Number(d.slice(5, 7)) - 1];
  e.place = "Plenitude";
  e.status = tot ? eur(tot) + " par mois" : "—";
  let say = tot ? `À partir de ${mois(next.Gaz?.date || next["Électricité"].date)}, tu paies ${eur(tot)} par mois : ${next.Gaz ? eur(next.Gaz.amount) + " de gaz" : ""}${next.Gaz && next["Électricité"] ? " et " : ""}${next["Électricité"] ? eur(next["Électricité"].amount) + " d’électricité" : ""}.` : "Pas d’échéancier Plenitude relu.";
  if (dern.Gaz && next.Gaz && Number(dern.Gaz.amount) > Number(next.Gaz.amount) + 1) {
    const hauts = pay.filter(r => r.label === "Gaz" && Number(r.amount) > Number(next.Gaz.amount) + 1);
    const trop = hauts.reduce((a, r) => a + Number(r.amount) - Number(next.Gaz.amount), 0);
    say += ` Le gaz a été prélevé à ${eur(dern.Gaz.amount)} en ${hauts.map(r => mois(r.date)).join(" et ")} : environ ${eur(trop)} de plus que l’échéancier. À surveiller sur la prochaine facture.`;
  }
  e.say = nb(say);
  const pf = (plan.Gaz || plan["Électricité"])?.data?.prochaine_facture;
  e.facts = [["Gaz", next.Gaz ? eur(next.Gaz.amount) + " par mois" : "—"], ["Électricité", next["Électricité"] ? eur(next["Électricité"].amount) + " par mois" : "—"], ["Prochaine facture", pf ? frd(pf) : "—"]];
  const d = [];
  ENS.forEach(n => { const p = plan[n], l = ech.filter(r => r.label === n); if (!l.length) return;
    d.push({ t: "Échéancier " + n.toLowerCase(), d: `${mois(l[0].date)} ${l[0].date.slice(0, 4)} → ${mois(l.slice(-1)[0].date)} ${l.slice(-1)[0].date.slice(0, 4)}`, v: eur(l[0].amount), where: "Espace client Plenitude",
      lines: [["Offre", p?.data?.offre || "—"], ["Consommation estimée", p?.data?.conso_annuelle_kwh ? nb(p.data.conso_annuelle_kwh.toLocaleString("fr-FR") + " kWh par an") : "—"], ...l.map(r => [frd(r.date), eur(r.amount)])] }); });
  ENS.forEach(n => { const l = pay.filter(r => r.label === n).reverse(); if (!l.length) return;
    d.push({ t: "Prélèvements " + n.toLowerCase(), d: "Déjà payés", v: eur(l[0].amount), where: "Espace client Plenitude", lines: l.map(r => [frd(r.date), eur(r.amount)]) }); });
  const el = conso["Électricité"], gz = conso["Gaz"];
  if (el) d.push({ t: "Consommation électricité", d: (el.mois || []).join(" et "), v: nb(el.kwh.slice(-1)[0] + " kWh"), where: "Espace client Plenitude", lines: (el.mois || []).map((m, i) => [m, nb(el.kwh[i] + " kWh")]) });
  if (gz) d.push({ t: "Consommation gaz", d: (gz.mois || []).join(" et "), v: nb(gz.kwh.slice(-1)[0] + " kWh"), where: "Espace client Plenitude", lines: (gz.mois || []).map((m, i) => [m, nb(gz.kwh[i] + " kWh")]) });
  e.docs = [...d, ...(e.macDocs || [])]; e.live = stamp(rows, "relu chez Plenitude");
}

function applyFoncia(rows) {
  const h = byId.home; if (!rows.length) { h.status = "À brancher"; return; }
  const by = k => rows.filter(r => r.kind === k);
  const per = l => { const m = l.match(/(\d{2})[ _-](\d{2})[ _-](\d{4})/); return m ? MOIS[Number(m[2]) - 1] + " " + m[3] : ""; };
  const nice = (l, cat) => { const b = l.replace(/\.pdf$/i, "").replace(/_/g, " ");
    if (/^quittance/i.test(b)) return "Quittance · " + per(l);
    if (/^avis d.?[ée]ch[ée]ance/i.test(b)) return "Avis d’échéance · " + per(l);
    if (/^AS \d{4}(\d{2})/.test(b)) { const m = b.match(/^AS (\d{4})(\d{2})/); return "Avis d’échéance · " + MOIS[Number(m[2]) - 1] + " " + m[1]; }
    if (/r[ée]gularisation/i.test(b)) { const y = b.match(/(\d{4})\D+(\d{4})/); return "Régularisation des charges" + (y ? " " + y[1] + "-" + y[2] : ""); }
    if (/^r[ée]vision loyer/i.test(b)) return "Révision de loyer · " + (b.match(/(\d{4})/) || [""])[0];
    if (/ASSURIMO|assurance/i.test(b)) return "Assurance habitation";
    if (/^dpe/i.test(b)) return "Diagnostic de performance énergétique";
    if (/^plan$/i.test(b)) return "Plan du logement";
    if (/^FACT/i.test(b)) return "Facture Foncia";
    return cat ? cat + " · " + b.slice(0, 30) : b; };
  const ops = by("operation").filter(r => r.date).sort((a, b) => b.date.localeCompare(a.date));
  const appels = ops.filter(r => /^APPEL/i.test(r.label));
  const prel = by("paiement").filter(r => r.date).sort((a, b) => b.date.localeCompare(a.date));
  const solde = by("compte")[0], gest = (by("contact")[0] || {}).data || {}, lots = by("lot");
  const loyer = appels[0] ? Math.abs(Number(appels[0].amount)) : null;
  const docs = by("document").sort((a, b) => (b.data?.ajoute_le || "").split("/").reverse().join("").localeCompare((a.data?.ajoute_le || "").split("/").reverse().join("")));
  const quitt = docs.filter(d => /quittance/i.test(d.label));
  const sold = solde && solde.amount != null ? Number(solde.amount) : null;
  h.urgent = sold != null && sold < 0;
  const res = ((by("logement")[0] || {}).data || {}).residence;
  h.place = "Foncia" + (res ? " · " + res.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()) : "");
  h.status = loyer ? `Loyer ${eur(loyer)} · ${sold === 0 ? "à jour" : sold < 0 ? "à régler" : "en avance"}` : "À jour";
  h.say = nb(`Ton loyer est de ${eur(loyer || 0)} par mois${prel[0] ? `, le dernier prélèvement est passé le ${frd(prel[0].date)}` : ""}. ${sold === 0 ? "Tu es à jour." : sold < 0 ? `Il reste ${eur(-sold)} à payer.` : ""} J’ai rangé tes ${docs.length} papiers Foncia${quitt[0] ? `, dont la quittance de ${per(quitt[0].label)}` : ""}.`.replace(/\s+/g, " ").trim());
  h.facts = [["Loyer + charges", loyer ? eur(loyer) + " par mois" : "—"], ["Solde du compte", sold != null ? eur(sold) + (sold === 0 ? ", à jour" : "") : "—"]];
  const d = [];
  if (gest.nom) d.push({ t: "Ton gestionnaire", d: gest.agence || "Foncia", v: gest.nom, where: "MyFoncia", lines: [["Nom", gest.nom], ["Agence", gest.agence || "—"], ["Adresse", gest.adresse || "—"], ["Téléphone", gest.telephone || "—"]], tel: gest.telephone });
  if (lots.length) d.push({ t: "Ton logement", d: `${lots.length} lots`, v: "", where: "MyFoncia", lines: lots.map(l => [l.label, l.data?.tantiemes || ""]) });
  if (ops.length) d.push({ t: "Comptabilité", d: `${ops.length} opérations`, v: loyer ? eur(loyer) : "", where: "MyFoncia", lines: ops.slice(0, 10).map(r => [frd(r.date) + " · " + r.label.toLowerCase().replace(/^./, c => c.toUpperCase()).slice(0, 34), (Number(r.amount) > 0 ? "+" : "") + eur(r.amount)]) });
  by("intervention").forEach(r => d.push({ t: "Intervention", d: frd(r.date), v: r.data?.statut || "", where: "MyFoncia", lines: [["Objet", r.label.toLowerCase().replace(/^./, c => c.toUpperCase())], ["Statut", r.data?.statut || "—"]] }));
  docs.forEach(r => d.push({ t: nice(r.label, r.data?.categorie).slice(0, 60), d: "Ajouté le " + (r.data?.ajoute_le || "—"), v: "PDF", where: "Jarvis › papiers › Foncia",
    lines: [["Catégorie", r.data?.categorie || "—"], ["Ajouté le", r.data?.ajoute_le || "—"]], path: r.data?.path ? "foncia/" + r.data.path : null }));
  h.docs = [...d, ...(h.macDocs || [])]; h.live = stamp(rows, "relu par ton iPhone");
}

function applySante(rows) {
  const p = byId.clinique;
  const rdv = rows.filter(r => r.kind === "rdv").map(r => r.data).filter(r => r && r.statut !== "annule")
    .map(r => ({ ...r, statut: r.date >= parisDay() ? "a_venir" : "passe" }))
    .sort((a, b) => (b.date + b.heure).localeCompare(a.date + a.heure));
  S.rdv = rdv;
  S.creneaux = rows.filter(r => r.kind === "creneaux");
  S.patients = ((rows.find(r => r.kind === "patients") || {}).data || {}).liste || [];
  const fut = rdv.filter(r => r.statut === "a_venir").sort((a, b) => (a.date + a.heure).localeCompare(b.date + b.heure));
  const nxt = fut[0], last = rdv.find(r => r.statut === "passe");
  p.place = "MédinLyon · Villeurbanne et Brotteaux";
  p.status = nxt ? `RDV ${nxt.date === parisDay() ? "aujourd’hui" : nxt.date === parisDay(1) ? "demain" : jour(nxt.date)} à ${hh(nxt.heure)}` : "Aucun rendez-vous prévu";
  p.say = nxt ? `Prochain rendez-vous : ${nxt.patient}, ${jour(nxt.date)} à ${hh(nxt.heure)}, centre ${ctr(nxt.centre)}.${fut.length > 1 ? ` Et ${fut.length - 1} autre${fut.length > 2 ? "s" : ""} après.` : ""}`
    : `Aucun rendez-vous prévu pour la famille.${last ? ` Le dernier, c’était ${prenomDe(last.patient)} le ${frd(last.date)}.` : ""} Touche « Prendre rendez-vous » : je te demande pour qui, où et quand, et je réserve après ta confirmation.`;
  p.facts = [["Rendez-vous", `${fut.length} à venir · ${rdv.length - fut.length} passés`], ["Famille sur le compte", (S.patients.length || new Set(rdv.map(r => r.patient)).size) + " personnes"]];
  const d = [];
  fut.forEach(r => d.push({ t: "Rendez-vous · " + r.patient, d: frd(r.date) + " à " + hh(r.heure), v: "À venir", future: true, where: "MédinLyon",
    lines: [["Pour", r.patient], ["Quand", jour(r.date) + " à " + hh(r.heure)], ["Centre", ctr(r.centre)]], path: r.chemin || null, cancelId: r.id }));
  rdv.filter(r => r.statut === "passe").forEach(r => d.push({ t: (r.chemin ? "Justificatif · " : "Consultation · ") + r.patient, d: frd(r.date) + " à " + hh(r.heure), v: r.chemin ? "PDF" : "", where: "MédinLyon",
    lines: [["Pour", r.patient], ["Centre", ctr(r.centre)], ["Statut", "Terminé"], ["Justificatif", r.chemin ? "PDF rangé ici" : "Plus gardé par MédinLyon"]], path: r.chemin || null }));
  p.docs = [...d, ...(p.macDocs || [])];
  p.live = stamp(rows.filter(r => r.kind === "rdv"), "MédinLyon relu") || "MédinLyon pas encore relu";
  if (nxt) { S.next = p.status; S.nextPlace = "clinique"; }
}


/* ---------- Ton travail : le planning 5x8 envoyé par Mon Planning ---------- */
const POSTE_J = { M: "Matin · 4h–12h", A: "Après-midi · 12h–20h", N: "Nuit · 20h–4h", R: "Repos", J: "Poste à fixer par le chef" };
const lc = t => t.charAt(0).toLowerCase() + t.slice(1);
function ditJ(o) {
  if (!o) return "—"; const f = o.ferie ? ` (${o.ferie})` : "";
  if (o.g === "conge") return "Congé payé" + f; if (o.g === "rc") return "Récup" + f; if (o.g === "maladie") return "Maladie" + f;
  if (o.sup) return "Jour sup · " + (POSTE_J[o.poste] || o.poste) + f;
  if (o.poste === "R") return (o.rem ? "Repos · remonte" : "Repos") + f;
  return (POSTE_J[o.poste] || o.poste) + f;
}
function applyPlanning(rows) {
  S.planningTxt = "";
  const r = rows.find(x => x.source === "planning" && x.kind === "etat"), P = r && r.data; if (!P || !(P.jours || []).length) return;
  const p = byId.usine, m = (rows.find(x => x.source === "mac" && x.kind === "lieu" && x.label === "usine") || {}).data || {};
  const J = Object.fromEntries(P.jours.map(o => [o.d, o])), td = parisDay(), fut = P.jours.filter(o => o.d > td), auj = J[td], dem = J[parisDay(1)];
  let say = `Aujourd’hui : ${lc(ditJ(auj))}. Demain : ${lc(ditJ(dem))}.`;
  const facts = [["Aujourd’hui", ditJ(auj)], ["Demain", ditJ(dem)]];
  if (auj && auj.rem) { const fin = fut.find(o => !o.rem && o.poste !== "R" && !["conge", "rc", "maladie"].includes(o.g)); if (fin) { say += ` Tu es en remonte, reprise ${jour(fin.d)}.`; facts.push(["Reprise", jour(fin.d) + " · " + lc(ditJ(fin))]); } }
  else { const rem = fut.find(o => o.rem); if (rem) facts.push(["Prochaine remonte", "à partir du " + jour(rem.d)]); }
  const sup = fut.filter(o => o.sup); if (sup.length) facts.push(["Jours sup prévus", sup.slice(0, 4).map(o => frd(o.d).slice(0, 5)).join(", ")]);
  const MO = ["janv.", "févr.", "mars", "avril", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const mois = td.slice(0, 7), pm = (P.payes || []).find(x => x.mois === mois), pn = (P.payes || []).find(x => x.mois > mois);
  if (P.base_ok && pm) { facts.push(["Paye estimée fin " + MO[+mois.slice(5) - 1], eur(pm.net) + " net"]); if (pn) facts.push(["Paye estimée fin " + MO[+pn.mois.slice(5) - 1], eur(pn.net) + " net"]); }
  const c = P.compteurs || {}; facts.push(["Compteurs", `${c.cp ?? "?"} CP · ${c.cor ?? "?"} COR`]);
  p.status = "Aujourd’hui : " + lc(ditJ(auj).split(" · ")[0]);
  p.say = say + (m.say ? " " + m.say : "");
  p.facts = [...facts, ...(m.facts || [])];
  p.live = "En direct · Mon Planning le " + quand(r.updated_at);
  S.planningTxt = fut.slice(0, 21).map(o => `${jour(o.d)} : ${lc(ditJ(o))}`).join("\n");
}
let loading = null;
async function loadAll() {
  if (loading) return loading;
  loading = (async () => {
    const { data, error } = await sb.from("jarvis_items").select("source,kind,label,date,amount,data,updated_at").not("kind", "in", "(debug,reperage)").limit(5000);
    if (error) { toast("Je n’arrive pas à lire tes données : " + error.message); return; }
    const rows = data || [];
    S.next = ""; S.nextPlace = "";
    applyMac(rows.filter(r => r.source === "mac" || r.source === "jarvis"));
    applyPlanning(rows.filter(r => r.source === "planning" || r.source === "mac"));
    applyEnergie(rows.filter(r => r.source === "plenitude"));
    applyFoncia(rows.filter(r => r.source === "foncia"));
    applySante(rows.filter(r => r.source === "medinlyon"));
    PLACES.forEach(p => {
      if (p.status === "…") { p.status = "À brancher"; p.say = "Je n’ai encore rien pour ce lieu. Dès qu’une source est branchée, je le remplis."; p.live = "Pas encore branché"; }
      p.say = nb(p.say); p.status = nb(p.status); });
    S.loaded = true; refreshPins(); updateBrief(); if (S.sel) renderSheet(S.sel);
  })();
  try { await loading; } finally { loading = null; }
}
let liveCh = null, liveT = null;
function goLive() {
  if (liveCh) return;
  liveCh = sb.channel("jarvis-items").on("postgres_changes", { event: "*", schema: "public", table: "jarvis_items" }, () => {
    clearTimeout(liveT); liveT = setTimeout(loadAll, 900);
  }).subscribe();
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.loaded) loadAll(); });

/* ---------- Télécommande : Claude (via le connecteur) pilote l'écran ----------
   Le connecteur écrit un ordre dans jarvis_ecran ; l'app ouverte l'exécute tout de suite. */
const LIEU_APP = { logement: "home", energie: "energie", sante: "clinique", travail: "usine", impots: "impots", voiture: "garage", papiers: "mairie", banque: "banque", bebe: "medecin", abonnements: "orange" };
const sansAccent = t => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function fermerTout() { deselect(); closeTalk(); closeBook(); closeSettings(); $("paperwrap").classList.remove("open"); }
function bougerCamera(a) {
  fly = null; const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  let theta = s.theta, r = s.radius, phi = s.phi;
  if (a.tourner) theta += (Number(a.tourner) || 0) * Math.PI / 180;
  if (a.zoom === "avant") r *= .6; else if (a.zoom === "arriere") r *= 1.6;
  if (a.vue === "dessus") phi = .35; else if (a.vue === "rasante") phi = 1.2;
  r = Math.max(controls.minDistance, Math.min(controls.maxDistance, r));
  flyTo(controls.target.clone(), r, theta, phi, 1.2);
}
async function ordreEcran(o) {
  const a = o.args || {};
  if (o.action === "lieu") { const p = byId[LIEU_APP[a.lieu] || a.lieu]; if (p) { $("paperwrap").classList.remove("open"); select(p); } }
  else if (o.action === "document") {
    const p = byId[LIEU_APP[a.lieu] || a.lieu]; if (!p) return;
    select(p); const q = sansAccent(a.titre).split(/\s+/).filter(Boolean);
    const d = (p.docs || []).find(x => q.every(m => sansAccent(x.t + " " + x.d).includes(m))) || (p.docs || []).find(x => q.some(m => sansAccent(x.t + " " + x.d).includes(m)));
    if (d) setTimeout(() => openDoc(p, d), 700); else toast("Je ne trouve pas « " + a.titre + " » ici.");
  }
  else if (o.action === "ensemble") { fermerTout(); overview(); }
  else if (o.action === "camera") bougerCamera(a);
  else if (o.action === "ciel") applySky(a.mode === "nuit");
  else if (o.action === "fermer") fermerTout();
  else if (o.action === "message" && a.texte) toast(String(a.texte).slice(0, 160));
}
let ecranCh = null;
function goTelecommande() {
  if (ecranCh) return;
  ecranCh = sb.channel("jarvis-ecran").on("postgres_changes", { event: "INSERT", schema: "public", table: "jarvis_ecran" }, ({ new: o }) => {
    if (!o || Date.now() - new Date(o.created_at).getTime() > 60000) return; // ordre trop vieux : ignoré
    ordreEcran(o).catch(() => {});
  }).subscribe();
}

/* ---------- Appeler les robots du serveur ---------- */
async function medin(body, quiet) {
  try {
    const { data, error } = await sb.functions.invoke("medinlyon", { body });
    if (error) { let m = "Le robot MédinLyon ne répond pas."; try { const j = await error.context.json(); m = j.message || m; } catch (_) {} toast(m); return { ok: false, message: m }; }
    if (data && data.message && (!quiet || !data.ok)) toast(data.message);
    if (data && data.ok && body.action === "sync") toast(`MédinLyon relu : ${data.a_venir} à venir, ${data.rdv} au total`);
    if (body.action !== "creneaux") await loadAll();
    return data;
  } catch (e) { toast("Pas de réseau ?"); return { ok: false, message: "Pas de réseau." }; }
}

/* =========================================================
   Prendre rendez-vous (dans Jarvis, sans sortir)
   pour qui → où → quand → l'heure → confirmation → PDF
   ========================================================= */
let bookOpen = false;
const B = {};
const CENTRES = { "1": "Villeurbanne", "2": "Lyon 6 Brotteaux" };
function openBook() {
  if (S.sel) { S.sel = null; sheet.classList.remove("open"); }
  closeTalk(true); closeSettings(true);
  bookOpen = true; viewShiftGoal = 1; $("book").classList.add("open"); $("ask").classList.add("away");
  Object.keys(B).forEach(k => delete B[k]); stepWho();
}
function closeBook(keep) { if (!bookOpen) return; bookOpen = false; $("book").classList.remove("open"); if (!keep) { viewShiftGoal = 0; $("ask").classList.remove("away"); } }
$("bClose").addEventListener("click", () => closeBook());
swipeClose($("book").querySelector(".card"), () => closeBook());
function bookStep(title, sub) { $("bQ").textContent = title; $("bSub").textContent = sub || ""; const o = $("bBody"); o.innerHTML = ""; return o; }
function choice(o, label, sub, fn, cls = "") { const b = document.createElement("button"); b.className = "opt " + cls; b.innerHTML = "<b></b><span></span>"; b.querySelector("b").textContent = label; b.querySelector("span").textContent = sub || ""; b.addEventListener("click", fn); o.append(b); return b; }
function back(o, fn) { const b = document.createElement("button"); b.className = "btn soft wide back"; b.textContent = "‹ Retour"; b.addEventListener("click", fn); o.append(b); }
function stepWho() {
  const o = bookStep("Pour qui ?", "La famille enregistrée sur ton compte MédinLyon");
  let list = S.patients;
  if (!list.length) list = [...new Set(S.rdv.map(r => r.patient))].map(n => ({ id: "", nom: n }));
  if (!list.length) { o.innerHTML = '<p class="empty">Je ne connais pas encore la famille. Touche « Mettre à jour » dans Ta santé.</p>'; return; }
  const counts = {}; S.rdv.forEach(r => counts[r.patient] = (counts[r.patient] || 0) + 1);
  list.slice().sort((a, b) => (counts[b.nom] || 0) - (counts[a.nom] || 0)).forEach(p => choice(o, p.nom, counts[p.nom] ? counts[p.nom] + " rendez-vous passés" : "", () => { B.patient = p; stepWhere(); }, "who"));
}
function stepWhere() {
  const o = bookStep("Où ?", "Pour " + B.patient.nom);
  const lastC = (S.rdv.find(r => r.patient === B.patient.nom) || {}).centre;
  Object.entries(CENTRES).forEach(([id, n]) => choice(o, n, lastC && ctr(lastC) === n ? "Là où il va d’habitude" : "", () => { B.centre = id; stepWhen(); }));
  back(o, stepWho);
}
function stepWhen() {
  const o = bookStep("Quand ?", B.patient.nom + " · " + CENTRES[B.centre]);
  [[parisDay(), "Aujourd’hui"], [parisDay(1), "Demain"]].forEach(([d, n]) => {
    const c = S.creneaux.find(x => x.date === d && x.data && x.data.centre === B.centre);
    choice(o, n, jour(d) + (c ? " · " + (c.data.nb ? c.data.nb + " créneaux vus" : "complet au dernier relevé") : ""), () => { B.date = d; stepSlot(); });
  });
  const hint = document.createElement("p"); hint.className = "hint"; hint.textContent = "MédinLyon ne propose que le jour même et le lendemain."; o.append(hint);
  back(o, stepWhere);
}
async function stepSlot() {
  const o = bookStep("À quelle heure ?", jour(B.date) + " · " + CENTRES[B.centre]);
  o.innerHTML = '<p class="empty">Je regarde les créneaux libres…</p>';
  const r = await medin({ action: "creneaux", centre: B.centre, date: B.date }, true);
  if (!bookOpen) return;
  o.innerHTML = "";
  let list = r && r.ok ? r.creneaux : null;
  if (!list) { const c = S.creneaux.find(x => x.date === B.date && x.data && x.data.centre === B.centre); list = (c && c.data.creneaux) || []; }
  if (!list.length) { o.innerHTML = '<p class="empty">Plus aucun créneau libre ce jour-là.</p>'; back(o, stepWhen); return; }
  const g = document.createElement("div"); g.className = "slots"; o.append(g);
  list.forEach(s => { const b = document.createElement("button"); b.className = "slot" + (s.supplement ? " plus" : ""); b.innerHTML = "<b></b>" + (s.supplement ? "<span>+≈23 €</span>" : "");
    b.querySelector("b").textContent = hh(s.heure); b.addEventListener("click", () => { B.slot = s; stepConfirm(); }); g.append(b); });
  if (list.some(s => s.supplement)) { const h = document.createElement("p"); h.className = "hint"; h.textContent = "+≈23 € : soir et week-end, dépassement facturé par le médecin (environ 32 € à régler, remboursé selon ta mutuelle)."; o.append(h); }
  back(o, stepWhen);
}
function stepConfirm() {
  const o = bookStep("Je réserve ?", "Dernière vérification");
  const c = document.createElement("div"); c.className = "recap";
  [["Pour", B.patient.nom], ["Où", CENTRES[B.centre]], ["Quand", jour(B.date) + " à " + hh(B.slot.heure)], ["Tarif", B.slot.supplement ? "Dépassement ≈23 € (soir / week-end)" : "Tarif normal, tiers payant avec la carte Vitale"]]
    .forEach(([a, b]) => { const r = document.createElement("div"); r.className = "row"; const x = document.createElement("span"); x.textContent = a; const y = document.createElement("b"); y.textContent = b; r.append(x, y); c.append(r); });
  o.append(c);
  const go = document.createElement("button"); go.className = "btn main wide"; go.textContent = "Oui, réserver"; o.append(go);
  if (!B.patient.id) { go.disabled = true; go.textContent = "Mets d’abord MédinLyon à jour"; }
  go.addEventListener("click", async () => {
    go.disabled = true; go.textContent = "Je réserve sur MédinLyon…";
    const r = await medin({ action: "reserver", patient: B.patient.id, centre: B.centre, date: B.date, creneau: B.slot.id }, true);
    stepDone(r);
  });
  back(o, stepSlot);
}
function stepDone(r) {
  const ok = r && r.ok;
  const o = bookStep(ok ? "C’est réservé ✓" : "Pas réservé", ok ? B.patient.nom + " · " + jour(B.date) + " à " + hh(B.slot.heure) : (r && r.message) || "MédinLyon n’a pas répondu.");
  if (ok && r.rdv && r.rdv.chemin) {
    const a = document.createElement("a"); a.className = "btn main wide pdf"; a.textContent = "Je prépare le PDF…"; a.target = "_blank"; o.append(a);
    sb.storage.from("papiers").createSignedUrl(r.rdv.chemin, 600).then(({ data }) => { if (data) { a.href = data.signedUrl; a.textContent = "Voir la confirmation (PDF)"; } else a.textContent = "PDF pas encore prêt"; });
  } else if (ok) { const p = document.createElement("p"); p.className = "hint"; p.textContent = "Le PDF de confirmation arrivera dans Ta santé dès que MédinLyon le donne."; o.append(p); }
  const b = document.createElement("button"); b.className = "btn soft wide"; b.textContent = ok ? "Voir Ta santé" : "Réessayer"; o.append(b);
  b.addEventListener("click", () => { if (ok) { closeBook(true); select(byId.clinique); } else stepSlot(); });
}

/* =========================================================
   Parler à Jarvis (API Claude via ton serveur)
   ========================================================= */
let history = [], busy = false;
const msgs = $("msgs"), input = $("input");
function bubble(c, t) { const d = document.createElement("div"); d.className = "m " + c; d.textContent = t; msgs.append(d); msgs.scrollTop = msgs.scrollHeight; return d; }
function openTalk(p) {
  if (S.sel) { S.sel = null; sheet.classList.remove("open"); }
  closeBook(true); closeSettings(true);
  talkOpen = true; viewShiftGoal = 1; $("talk").classList.add("open"); $("ask").classList.add("away");
  if (!msgs.children.length) bubble("j", p ? "On parle de " + p.name.toLowerCase() + " ? Je t’écoute." : "Je t’écoute. Pose-moi une question sur ton argent, tes papiers, ta santé ou ton planning.");
  else if (p) bubble("j", "On parle de " + p.name.toLowerCase() + " ?");
  const chips = $("chips"); chips.innerHTML = "";
  ["Qu’est-ce que je dois payer ce mois-ci ?", "Prends un rendez-vous médical", "Qu’est-ce qui manque ?"].forEach(q => { const b = document.createElement("button"); b.className = "chip"; b.textContent = q;
    b.addEventListener("click", () => { if (/rendez-vous/.test(q)) { openBook(); return; } input.value = q; send(); }); chips.append(b); });
}
function closeTalk(keep) { if (!talkOpen) return; talkOpen = false; $("talk").classList.remove("open"); input.blur(); stopListen(); voix.stop(); if (!keep) { viewShiftGoal = 0; $("ask").classList.remove("away"); } }
$("ask").addEventListener("click", () => openTalk(null));
$("tClose").addEventListener("click", () => closeTalk());
swipeClose($("talk").querySelector(".card"), () => closeTalk());
function context() {
  const lines = PLACES.map(p => `${p.name} (${p.place}) : ${p.say} ${p.facts.map(f => f[0] + " : " + f[1]).join(" ; ")}${p.urgent ? " [à regarder]" : ""}`).join("\n");
  const papiers = PLACES.map(p => (p.docs || []).slice(0, 25).map(d => `${p.name} : ${d.t} ${d.d} ${d.v || ""} (${(d.lines || []).map(l => l.join(" ")).join(", ")})`).join("\n")).filter(Boolean).join("\n");
  return `Tu es Jarvis, l’assistant personnel de ${S.prenom || "ton propriétaire"}. ${S.profil}
Tu vois ses comptes, ses papiers, sa santé et ses abonnements. Tu anticipes et tu proposes, mais tu n’agis jamais sans sa confirmation, et pour l’argent tu conseilles seulement.
Réponds en français parlé (ta réponse peut être lue à voix haute), très simple, sans jargon, en 1 à 3 phrases courtes, sans listes ni titres, avec des chiffres concrets.
Avant de proposer un moment pour un rendez-vous ou une démarche, regarde son planning de travail et choisis un moment où il ne travaille pas. Pour prendre ou annuler un rendez-vous médical, dis-lui de toucher « Ta santé » puis « Prendre rendez-vous » : c’est là que Jarvis réserve après sa confirmation.
Ce qui n’est pas encore branché (banque, mails, Ameli, Orange), dis-le simplement sans inventer de chiffre.
Nous sommes le ${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, il est ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.
Situation :
${lines}
Papiers :
${papiers}${S.planningTxt ? `
Son planning de travail des 3 prochaines semaines (Mon Planning ; une nuit compte pour le jour où elle commence) :
${S.planningTxt}` : ""}`;
}
async function send() {
  const t = input.value.trim(); if (!t || busy) return; input.value = ""; bubble("me", t); history.push({ role: "user", content: t });
  const out = bubble("j", "…"); busy = true; $("send").disabled = true; let text = "", said = 0;
  const parle = voiceMode || lireToujours();
  if (parle) voix.stop();
  try {
    const { data: { session } } = await sb.auth.getSession();
    const r = await fetch(SB_URL + "/functions/v1/jarvis-chat", { method: "POST",
      headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: "Bearer " + (session ? session.access_token : "") },
      body: JSON.stringify({ system: context(), messages: history }) });
    if (!r.ok) { let j = {}; try { j = await r.json(); } catch (_) {}
      throw new Error(j.error === "cle_absente" ? "Il me manque ta clé Claude : touche la roue ⚙️ en haut, colle-la dans « Clé Claude » et je te réponds." : j.error === "interdit" ? "Reconnecte-toi, je ne te reconnais plus." :
        /workspace/i.test(j.detail || "") ? "Ta clé Claude n’est rattachée à aucun espace (workspace). Crée une clé dans un espace sur platform.claude.com, puis colle-la dans les Réglages ⚙️." :
        /credit|balance|billing/i.test(j.detail || "") ? "Ta clé Claude n’a plus de crédit. Vérifie Billing sur platform.claude.com." :
        /invalid x-api-key|authentication/i.test(j.detail || "") ? "Ta clé Claude est refusée. Recolle-la dans les Réglages ⚙️." :
        "Je n’arrive pas à joindre Claude (" + (j.status || r.status) + ")."); }
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
    for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue; try { const ev = JSON.parse(line.slice(5)); if (ev.type === "content_block_delta" && ev.delta && ev.delta.text) { text += ev.delta.text; out.textContent = text; msgs.scrollTop = msgs.scrollHeight; } } catch (_) {} }
      // Jarvis commence à parler dès la première phrase finie, sans attendre la fin
      if (parle) { const m = text.slice(said).match(/^[\s\S]*?[.!?…:](?=\s)/); if (m) { voix.dire(m[0]); said += m[0].length; } } }
    if (!text) throw new Error("Je n’ai rien reçu, réessaie.");
    history.push({ role: "assistant", content: text });
    if (parle && text.slice(said).trim()) voix.dire(text.slice(said));
  } catch (e) { out.textContent = e.message || "Je n’arrive pas à répondre là, réessaie."; history.pop(); if (parle) voix.dire(out.textContent); }
  finally { busy = false; $("send").disabled = false; voix.finPossible(); }
}
$("send").addEventListener("click", send);
input.addEventListener("keydown", e => { voiceMode = false; convo = false; if (e.key === "Enter") send(); });

/* ---------- La voix : vraie conversation, mains libres ----------
   Tu touches le micro une fois : tu parles, Jarvis répond à voix haute,
   puis il t'écoute de nouveau. Touche le micro pour arrêter.
   Le cerveau, c'est Claude. La voix, c'est la meilleure voix française de ton appareil. */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const micBtn = $("mic"), vhint = $("vhint");
let rec = null, listening = false, voiceMode = false, convo = false, heard = "";
const store = { get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };
const lireToujours = () => store.get("jarvis.lire") === "1";
const HINT = SR ? "Touche le micro pour parler avec Jarvis" : "Pour dicter, touche le micro du clavier";
if (SR) micBtn.hidden = false;
vhint.textContent = HINT;

const voix = {
  attente: 0,
  liste() { return ("speechSynthesis" in window) ? speechSynthesis.getVoices().filter(v => /^fr/i.test(v.lang)) : []; },
  note(v) { return (/premium/i.test(v.name) ? 6 : 0) + (/enhanced|amélioré|améliorée|natural|neural/i.test(v.name) ? 4 : 0) + (/fr-FR/i.test(v.lang) ? 2 : 0) + (v.localService ? 1 : 0)
    + (/^(Amélie|Thomas|Audrey|Aurélie|Marie|Daniel|Jacques)/i.test(v.name) ? 1 : 0) - (/compact|eloquence|grandma|grandpa|rocko|shelley|sandy|flo|reed|eddy/i.test(v.name) ? 5 : 0); },
  choisie() { const l = this.liste(), n = store.get("jarvis.voix"); return l.find(v => v.name === n) || l.sort((a, b) => this.note(b) - this.note(a))[0] || null; },
  dire(t) {
    t = (t || "").replace(/[*_#`>]/g, "").replace(/\s+/g, " ").trim(); if (!t || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(t); const v = this.choisie(); if (v) u.voice = v; u.lang = v ? v.lang : "fr-FR"; u.rate = 1.0; u.pitch = 1.0;
    this.attente++; micBtn.classList.add("talking"); vhint.textContent = convo ? "Jarvis parle… touche le micro pour l’arrêter" : "Jarvis parle…";
    u.onend = u.onerror = () => { this.attente = Math.max(0, this.attente - 1); this.finPossible(); };
    speechSynthesis.speak(u);
  },
  stop() { this.attente = 0; if ("speechSynthesis" in window) speechSynthesis.cancel(); micBtn.classList.remove("talking"); },
  finPossible() {
    if (this.attente || busy) return;
    micBtn.classList.remove("talking");
    if (convo && talkOpen) setTimeout(() => { if (convo && talkOpen && !listening && !busy && !this.attente) ecouter(); }, 250);
    else vhint.textContent = HINT;
  },
};
if ("speechSynthesis" in window) speechSynthesis.addEventListener?.("voiceschanged", () => {});

function stopListen() { convo = false; if (rec && listening) { try { rec.abort(); } catch (_) {} } listening = false; micBtn.classList.remove("on"); }
function ecouter() {
  if (!SR) return;
  rec = new SR(); rec.lang = "fr-FR"; rec.interimResults = true; rec.continuous = false;
  heard = ""; input.value = ""; voiceMode = true;
  rec.onstart = () => { listening = true; micBtn.classList.add("on"); vhint.textContent = "Je t’écoute…"; };
  rec.onresult = e => { let t = ""; for (const r of e.results) t += r[0].transcript; heard = t; input.value = t; };
  rec.onerror = e => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") { convo = false; vhint.textContent = "Micro refusé : autorise-le pour Safari dans les réglages de l’iPhone"; }
    else if (e.error === "no-speech" && convo) vhint.textContent = "Je n’ai rien entendu… touche le micro pour reprendre";
  };
  rec.onend = () => {
    listening = false; micBtn.classList.remove("on");
    if (heard.trim()) { send(); return; }
    if (convo) { convo = false; vhint.textContent = "Je n’ai rien entendu. Touche le micro pour reprendre"; }
  };
  try { rec.start(); } catch (_) { convo = false; vhint.textContent = "Touche le micro pour me répondre"; }
}
micBtn.addEventListener("click", () => {
  // en pleine conversation : un toucher arrête tout
  if (convo || listening || voix.attente) {
    const parlait = voix.attente > 0; voix.stop();
    if (listening) { try { rec.stop(); } catch (_) {} convo = false; return; } // il envoie ce que tu as dit
    convo = false; vhint.textContent = parlait ? "D’accord, je me tais. Touche le micro pour reprendre" : HINT; return;
  }
  if ("speechSynthesis" in window) { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u); } // débloque la voix sur iPhone
  convo = true; ecouter();
});

/* =========================================================
   Réglages : tes codes, rangés dans le coffre chiffré de Supabase.
   L'app peut les écrire, jamais les relire.
   ========================================================= */
const REGLAGES = [
  { name: "ANTHROPIC_API_KEY", label: "Clé Claude", help: "Pour parler avec Jarvis. Elle commence par « sk-ant- » (platform.claude.com › API keys).", type: "password", ph: "sk-ant-…" },
  { name: "MEDINLYON_EMAIL", label: "MédinLyon · e-mail", help: "Pour prendre et annuler les rendez-vous de la famille.", type: "email", ph: "ton e-mail MédinLyon" },
  { name: "MEDINLYON_PASSWORD", label: "MédinLyon · mot de passe", help: "", type: "password", ph: "ton mot de passe MédinLyon" },
];
let setOpen = false;
async function openSettings() {
  deselect(); closeTalk(true); closeBook(true);
  setOpen = true; viewShiftGoal = 1; $("setsheet").classList.add("open"); $("ask").classList.add("away");
  const o = $("sBody"); o.innerHTML = '<p class="empty">Je regarde ce qui est déjà rangé…</p>';
  const { data, error } = await sb.rpc("jarvis_secret_status");
  const etat = Object.fromEntries((data || []).map(r => [r.name, r]));
  o.innerHTML = "";
  if (error) { o.innerHTML = '<p class="empty">Je n’arrive pas à ouvrir le coffre. Reconnecte-toi.</p>'; return; }
  REGLAGES.forEach(r => {
    const c = document.createElement("div"); c.className = "set";
    c.innerHTML = '<div class="stop"><b></b><span></span></div><div class="row2"><input autocomplete="off" autocapitalize="off" spellcheck="false"><button class="btn main" type="button">Enregistrer</button></div><small></small>';
    const st = c.querySelector(".stop span"), inp = c.querySelector("input"), b = c.querySelector("button");
    c.querySelector(".stop b").textContent = r.label; c.querySelector("small").textContent = r.help;
    inp.type = r.type; inp.placeholder = etat[r.name]?.rempli ? "•••••••• déjà rangé" : r.ph;
    const show = ok => { st.textContent = ok ? "Enregistré ✓" : "À ajouter"; st.className = ok ? "ok" : ""; };
    show(!!etat[r.name]?.rempli);
    b.addEventListener("click", async () => {
      const v = inp.value.trim(); if (!v) { inp.focus(); return; }
      b.disabled = true; b.textContent = "…";
      const { error: e } = await sb.rpc("jarvis_set_secret", { p_name: r.name, p_value: v });
      b.disabled = false; b.textContent = "Enregistrer";
      if (e) { toast("Pas enregistré : " + e.message); return; }
      inp.value = ""; inp.placeholder = "•••••••• déjà rangé"; show(true); toast(r.label + " enregistré ✓");
    });
    inp.addEventListener("keydown", e => { if (e.key === "Enter") b.click(); });
    o.append(c);
  });
  o.append(blocPapiers());
  o.append(blocVoix());
  o.append(blocConnecteur());
}

/* ---------- Ajouter mes papiers (depuis le Mac ou l'iPhone) ----------
   Jarvis lit le papier (fonction jarvis-trier) et le range tout seul au bon lieu.
   Papiers jamais acceptés : ceux qui portent un numéro de sécu, un IBAN, une pièce d'identité,
   un papier de préfecture ou le papier d'une autre personne. */
const INTERDITS = [
  [/permis|identit|passeport|sajalni/i, "pièce d’identité"],
  [/s[ée]jour|prolongation|pr[ée]fecture/i, "papier de préfecture"],
  [/attestation ?de ?droits|ameli|attestationpaiement|carsat/i, "contient un n° de sécu"],
  [/cession|carte.?grise|carte-g|cerfa|signee/i, "papier de vente ou carte grise : contient l’identité d’autres personnes"],
  [/billet|tunisair/i, "papier d’une autre personne"],
  [/\brib\b|iban/i, "relevé bancaire (IBAN)"],
];
const LIEUX_PAPIERS = { home: "Chez toi", energie: "Gaz et électricité", garage: "Voiture", impots: "Impôts et amendes", clinique: "Santé", usine: "Travail", mairie: "Papiers", banque: "Banque", orange: "Abonnements", medecin: "Bébé" };
function blocPapiers() {
  const c = document.createElement("div"); c.className = "set";
  c.innerHTML = '<div class="stop"><b>Ajouter mes papiers</b><span></span></div>'
    + '<small>Choisis tes PDF (par exemple dans Téléchargements), autant que tu veux. Jarvis les lit, les range tout seul au bon lieu et leur donne un nom clair. Tes bulletins de paie vont dans Travail. Il refuse les pièces d’identité et les autres papiers qui portent ton n° de sécu ou ton IBAN.</small>'
    + '<div class="row2"><button class="btn main" type="button" style="flex:1">Choisir des PDF…</button></div>'
    + '<input type="file" accept="application/pdf,.pdf" multiple hidden><div class="dep"></div>';
  const btn = c.querySelector(".btn"), inp = c.querySelector("input"), out = c.querySelector(".dep"), st = c.querySelector(".stop span");
  btn.addEventListener("click", () => inp.click());
  const ligne = (t, cls) => { const e = document.createElement("small"); e.textContent = t; if (cls) e.className = cls; out.append(e); return e; };
  inp.addEventListener("change", async () => {
    const files = [...inp.files]; inp.value = ""; out.textContent = ""; if (!files.length) return;
    let ok = 0; st.textContent = "Je lis…"; st.className = "";
    const { data: { session } } = await sb.auth.getSession();
    const un = async (f) => {
      const n = f.name, ban = INTERDITS.find(([re]) => re.test(n));
      if (ban) { ligne("✕ " + n + " — pas rangé (" + ban[1] + ")"); return; }
      if (f.size > 20e6) { ligne("✕ " + n + " — trop lourd"); return; }
      const slug = n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.]+/g, "-").toLowerCase();
      const path = "mac/a-trier/" + slug;
      const l = ligne("… " + n + " — je le lis");
      const { error } = await sb.storage.from("papiers").upload(path, f, { upsert: true, contentType: "application/pdf" });
      if (error) { l.textContent = "✕ " + n + " — envoi raté : " + error.message; return; }
      try {
        const r = await fetch(SB_URL + "/functions/v1/jarvis-trier", { method: "POST",
          headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: "Bearer " + (session ? session.access_token : "") },
          body: JSON.stringify({ path }) });
        const j = await r.json().catch(() => ({}));
        if (j.refus) { l.textContent = "✕ " + n + " — pas rangé (" + j.refus + ")"; return; }
        if (!r.ok) { l.textContent = "✕ " + n + " — " + (j.error === "cle_absente" ? "il me manque ta clé Claude (Réglages ⚙️)" : "je n’ai pas réussi à le lire"); return; }
        l.textContent = "✓ " + j.titre + (j.sous ? " (" + j.sous + ")" : "") + " → " + (LIEUX_PAPIERS[j.lieu] || j.lieu); ok++;
      } catch (_) { l.textContent = "✕ " + n + " — pas de connexion"; }
    };
    // 4 papiers lus en même temps
    const file = [...files]; await Promise.all(Array.from({ length: Math.min(4, file.length) }, async () => { while (file.length) await un(file.shift()); }));
    st.textContent = ok ? ok + " rangé" + (ok > 1 ? "s" : "") + " ✓" : ""; st.className = ok ? "ok" : "";
    if (ok) loadAll();
  });
  return c;
}
function blocConnecteur() {
  const URL_MCP = SB_URL + "/functions/v1/jarvis-mcp";
  const c = document.createElement("div"); c.className = "set";
  c.innerHTML = '<div class="stop"><b>Connecteur Claude</b><span></span></div>'
    + '<small>Pour parler à Jarvis avec la vraie voix de l’app Claude (iPhone, Mac). Adresse du connecteur :</small>'
    + '<div class="row2"><input readonly class="url"><button class="btn soft" type="button">Copier</button></div>'
    + '<div class="row2"><button class="btn main gen" type="button" style="flex:1">Créer ma clé</button></div>'
    + '<div class="tok" hidden><small><b>Ta clé (affichée une seule fois) :</b></small><div class="row2"><input readonly class="tk"><button class="btn soft" type="button">Copier</button></div></div>'
    + '<small>Dans Claude : Personnaliser › Connecteurs › + › Ajouter un connecteur personnalisé. Nom : Jarvis. Colle l’adresse. Authentification : « Pas de connexion ». En-têtes de requête : nom <b>Authorization</b>, valeur <b>Bearer</b> + espace + ta clé.</small>';
  const st = c.querySelector(".stop span"), url = c.querySelector(".url"), gen = c.querySelector(".gen"), box = c.querySelector(".tok"), tk = c.querySelector(".tk");
  url.value = URL_MCP;
  const copier = (v, quoi) => { (navigator.clipboard?.writeText(v) || Promise.reject()).then(() => toast(quoi + " copiée ✓"), () => toast("Touche longtemps le champ pour copier")); };
  c.querySelectorAll(".row2 .btn.soft")[0].addEventListener("click", () => copier(URL_MCP, "Adresse"));
  c.querySelectorAll(".row2 .btn.soft")[1].addEventListener("click", () => copier("Bearer " + tk.value, "Valeur « Bearer + clé »"));
  sb.rpc("jarvis_mcp_token_status").then(({ data }) => { if (data) { st.textContent = "Clé créée ✓"; st.className = "ok"; gen.textContent = "Remplacer ma clé"; } else st.textContent = "Pas encore de clé"; });
  gen.addEventListener("click", async () => {
    if (gen.textContent.startsWith("Remplacer") && gen.dataset.sure !== "1") { gen.dataset.sure = "1"; gen.textContent = "Touche encore : l’ancienne clé ne marchera plus"; return; }
    gen.disabled = true;
    const { data, error } = await sb.rpc("jarvis_new_mcp_token");
    gen.disabled = false; gen.dataset.sure = "";
    if (error || !data) { toast("Pas créée : " + (error ? error.message : "")); return; }
    tk.value = data; box.hidden = false; st.textContent = "Clé créée ✓"; st.className = "ok"; gen.textContent = "Remplacer ma clé";
    toast("Clé créée. Copie-la maintenant, elle ne sera plus affichée.");
  });
  return c;
}
function blocVoix() {
  const c = document.createElement("div"); c.className = "set";
  c.innerHTML = '<div class="stop"><b>Voix de Jarvis</b><span></span></div><div class="row2"><select></select><button class="btn main" type="button">Écouter</button></div>'
    + '<label class="tog"><input type="checkbox"> Lire aussi les réponses quand j’écris</label>'
    + '<small>Pour une voix naturelle, télécharge une fois une voix française « Premium » (gratuit) : Réglages de l’iPhone › Accessibilité › Contenu énoncé › Voix › Français, par exemple « Amélie (Premium) » ou « Thomas (amélioré) ». Puis reviens ici et choisis-la.</small>';
  const sel = c.querySelector("select"), b = c.querySelector("button"), st = c.querySelector(".stop span"), tog = c.querySelector(".tog input");
  tog.checked = lireToujours(); tog.addEventListener("change", () => store.set("jarvis.lire", tog.checked ? "1" : "0"));
  const remplir = () => {
    const l = voix.liste().sort((a, b) => voix.note(b) - voix.note(a)), cur = voix.choisie();
    sel.innerHTML = "";
    if (!l.length) { const o = document.createElement("option"); o.textContent = "Aucune voix française trouvée"; sel.append(o); sel.disabled = true; st.textContent = ""; return; }
    sel.disabled = false;
    l.forEach(v => { const o = document.createElement("option"); o.value = v.name; o.textContent = v.name.replace(/\s*\(.*?\)\s*$/, "") + (/premium/i.test(v.name) ? " · Premium" : /enhanced|amélior/i.test(v.name) ? " · Améliorée" : "") + (/fr-CA/i.test(v.lang) ? " (Canada)" : /fr-BE/i.test(v.lang) ? " (Belgique)" : /fr-CH/i.test(v.lang) ? " (Suisse)" : ""); if (cur && v.name === cur.name) o.selected = true; sel.append(o); });
    const top = voix.note(l[0]) >= 6; st.textContent = top ? "Voix naturelle ✓" : "Voix de base"; st.className = top ? "ok" : "";
  };
  remplir(); if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = remplir;
  sel.addEventListener("change", () => store.set("jarvis.voix", sel.value));
  b.addEventListener("click", () => { voix.stop(); voix.dire("Bonjour" + (S.prenom ? " " + S.prenom : "") + ", c’est Jarvis. Je suis là quand tu as besoin de moi."); setTimeout(() => voix.finPossible(), 50); });
  return c;
}
function closeSettings(keep) { if (!setOpen) return; setOpen = false; $("setsheet").classList.remove("open"); document.activeElement?.blur?.(); if (!keep) { viewShiftGoal = 0; $("ask").classList.remove("away"); } }
$("gear").addEventListener("click", () => setOpen ? closeSettings() : openSettings());
$("sClose").addEventListener("click", () => closeSettings());
swipeClose($("setsheet").querySelector(".card"), () => closeSettings());
$("sOut").addEventListener("click", async () => { closeSettings(); await sb.auth.signOut(); });

/* =========================================================
   La porte d'entrée
   ========================================================= */
const gate = $("gate"), gmsg = $("gmsg");
function showGate(msg) { gate.hidden = false; if (msg) gmsg.textContent = msg; }
async function enter(session) {
  if (!session) { showGate(); return; }
  const { data: ok } = await sb.rpc("jarvis_is_owner");
  if (ok !== true) { showGate(session.user && !session.user.email_confirmed_at ? "Confirme d’abord ton e-mail (lien reçu), puis reviens ici." : "Cette ville est privée."); return; }
  gate.hidden = true;
  await loadAll(); goLive(); goTelecommande();
}
$("gform").addEventListener("submit", async e => {
  e.preventDefault(); const email = $("gmail").value.trim(), password = $("gpass").value;
  $("gin").disabled = true; gmsg.textContent = "J’ouvre…";
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  $("gin").disabled = false;
  if (error) { gmsg.textContent = /confirm/i.test(error.message) ? "Confirme d’abord ton e-mail : touche le lien que tu as reçu." : "E-mail ou mot de passe incorrect."; return; }
  enter(data.session);
});
$("gnew").addEventListener("click", async () => {
  const email = $("gmail").value.trim(), password = $("gpass").value;
  if (!email || password.length < 8) { gmsg.textContent = "Écris ton e-mail et choisis un mot de passe d’au moins 8 caractères, puis touche ce bouton."; return; }
  $("gnew").disabled = true;
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  $("gnew").disabled = false;
  if (error) { gmsg.textContent = /registered|exists/i.test(error.message) ? "Ce compte existe déjà : touche « Entrer »." : "Ça n’a pas marché : " + error.message; return; }
  if (data.session) enter(data.session);
  else gmsg.textContent = "C’est fait. Je t’ai envoyé un e-mail : touche le lien pour confirmer, puis reviens ici et touche « Entrer ».";
});
sb.auth.onAuthStateChange((ev, session) => { if (ev === "SIGNED_OUT") { showGate("Connecte-toi pour ouvrir ta ville."); } });
sb.auth.getSession().then(({ data }) => enter(data.session));

/* =========================================================
   La boucle
   ========================================================= */
let last = performance.now(), clock = 0;
refreshPins(); updateBrief();
flyTo(new THREE.Vector3(0, 0, 0), overviewDist(), -.5, .92, 2.2);
function frame(now) {
  const dt = Math.min((now - last) / 1000, .05); last = now; clock += dt;
  stepFly(dt); controls.update(); clampTarget();
  viewShift += (viewShiftGoal - viewShift) * (1 - Math.pow(.002, dt));
  const W = innerWidth, H = innerHeight;
  if (viewShift > .001) camera.setViewOffset(W, H, 0, H * .2 * viewShift, W, H); else camera.clearViewOffset();
  cars.forEach(c => { c.t = (c.t + c.dir * c.v * dt + 4) % 4; const [x, z, a] = loopPos(c.t, c.r); c.g.position.set(x, .08, z); c.g.rotation.y = a + (c.dir < 0 ? Math.PI : 0); });
  if (rotor) rotor.rotation.z -= dt * .6;
  jarvis.position.y = 8.5 + Math.sin(clock * .6) * .25;
  jarvis.userData.ring.rotation.z += dt * .25; jarvis.userData.ring2.rotation.z -= dt * .18;
  renderer.render(scene, camera);
  placePins();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
