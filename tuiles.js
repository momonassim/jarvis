/* =========================================================
   Jarvis — la carte « GPS » : partout, comme Waze ou TomTom.
   Autour du quartier détaillé, la carte se charge par morceaux (tuiles OpenStreetMap d'OpenFreeMap,
   gratuites, sans clé) là où regarde la caméra, et se décharge quand on s'éloigne.
   Même style que le quartier : bitume au grain, trottoirs clairs, marquages, passages piétons,
   bâtiments blancs à leur vraie hauteur, verdure sauge, eau.
   ========================================================= */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const Z = 14;   // une tuile ≈ 1,7 km de côté à Lyon
const LARG = { motorway: 13, trunk: 11, primary: 10, secondary: 9, tertiary: 8, minor: 6.5, service: 4 };

export function creerTuiles({ scene, centre, exclu = () => false, rayonRues = 0, grain }) {
  let VT = null, Pbf = null, URL_T = null, pret = null;
  const charger = () => pret || (pret = (async () => {
    const [a, b, tj] = await Promise.all([
      import("https://esm.sh/@mapbox/vector-tile@2.0.3"), import("https://esm.sh/pbf@4.0.1"),
      fetch("https://tiles.openfreemap.org/planet").then(r => r.json())]);
    VT = a.VectorTile; Pbf = b.default; URL_T = tj.tiles[0];
  })());

  const kx = Math.cos(centre.lat * Math.PI / 180) * 111320, ky = 110574;
  const versLocal = (lon, lat) => [(lon - centre.lon) * kx, (lat - centre.lat) * ky];
  const versLonLat = (x, y) => [centre.lon + x / kx, centre.lat + y / ky];
  const n2 = 2 ** Z;
  const tuileDe = (lon, lat) => { const r = lat * Math.PI / 180; return [Math.floor((lon + 180) / 360 * n2), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n2)]; };
  const coinLonLat = (tx, ty) => [tx / n2 * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n2))) * 180 / Math.PI];

  const M = {
    chaussee: new THREE.MeshStandardMaterial({ map: grain(0xa4a4a2, 14), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }),
    trottoir: new THREE.MeshStandardMaterial({ map: grain(0xebe7e0, 6), roughness: 1 }),
    blanc: new THREE.MeshStandardMaterial({ color: 0xfafaf7, roughness: 0.7 }),
    bati: new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.92 }),
    trait: new THREE.LineBasicMaterial({ color: 0xc8c0b3, transparent: true, opacity: 0.55 }),
    vert: new THREE.MeshStandardMaterial({ color: 0xd3dcc6, roughness: 1 }),
    bois: new THREE.MeshStandardMaterial({ color: 0xc3d0b2, roughness: 1 }),
    eau: new THREE.MeshStandardMaterial({ color: 0xbcd0d8, roughness: 0.35 }),
    rail: new THREE.MeshStandardMaterial({ color: 0xb9b4ab, roughness: 1 }),
  };
  const TUILES = new Map(); let enCours = 0;

  /* --- petites briques de géométrie (écrites à la main : beaucoup plus léger que des centaines d'objets) --- */
  function plat() { return { p: [], uv: [] }; }
  function quad(G, a, b, c, d, h) { for (const q of [a, b, c, a, c, d]) { G.p.push(q[0], h, -q[1]); G.uv.push(q[0] / 6, -q[1] / 6); } }
  function disque(G, x, y, r, h, n = 10) { for (let i = 0; i < n; i++) { const a1 = i / n * 6.2832, a2 = (i + 1) / n * 6.2832;
    for (const q of [[x, y], [x + Math.cos(a2) * r, y + Math.sin(a2) * r], [x + Math.cos(a1) * r, y + Math.sin(a1) * r]]) { G.p.push(q[0], h, -q[1]); G.uv.push(q[0] / 6, -q[1] / 6); } } }
  function ruban(G, l, w, h) { const hw = w / 2;
    for (let i = 0; i < l.length - 1; i++) { const [x1, y1] = l[i], [x2, y2] = l[i + 1], L = Math.hypot(x2 - x1, y2 - y1); if (L < 0.05) continue;
      const nx = -(y2 - y1) / L * hw, ny = (x2 - x1) / L * hw; quad(G, [x1 - nx, y1 - ny], [x2 - nx, y2 - ny], [x2 + nx, y2 + ny], [x1 + nx, y1 + ny], h); }
    // un disque seulement aux bouts et dans les vrais virages (sinon inutile : les morceaux se touchent déjà)
    for (let i = 0; i < l.length; i++) { const A = l[i - 1], P = l[i], B = l[i + 1];
      if (A && B) { const a1 = Math.atan2(P[1] - A[1], P[0] - A[0]), a2 = Math.atan2(B[1] - P[1], B[0] - P[0]); let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d; if (d < 0.12) continue; }
      disque(G, P[0], P[1], hw, h, w > 8 ? 10 : 6); } }
  function boiteSol(G, x, y, ang, lx, ly, h) { const c = Math.cos(ang), s = Math.sin(ang), P = (a, b) => [x + c * a - s * b, y + s * a + c * b];
    quad(G, P(-lx / 2, -ly / 2), P(lx / 2, -ly / 2), P(lx / 2, ly / 2), P(-lx / 2, ly / 2), h); }
  function maillage(G, mat, ombre = false) {
    if (!G.p.length) return null; const g = new THREE.BufferGeometry();
    // chaque triangle tourné du bon côté (vers sa normale) : sinon il est éclairé « par dessous » et paraît sombre
    const P = G.p, U = G.uv;
    for (let t = 0; t < P.length; t += 9) { const ax = P[t + 3] - P[t], ay = P[t + 4] - P[t + 1], az = P[t + 5] - P[t + 2], bx = P[t + 6] - P[t], by = P[t + 7] - P[t + 1], bz = P[t + 8] - P[t + 2];
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx, d = G.n ? cx * G.n[t] + cy * G.n[t + 1] + cz * G.n[t + 2] : cy;
      if (d < 0) { for (let k = 0; k < 3; k++) { const q = P[t + 3 + k]; P[t + 3 + k] = P[t + 6 + k]; P[t + 6 + k] = q; }
        const u = t / 3 * 2; for (let k = 0; k < 2; k++) { const q = U[u + 2 + k]; U[u + 2 + k] = U[u + 4 + k]; U[u + 4 + k] = q; } } }
    g.setAttribute("position", new THREE.Float32BufferAttribute(G.p, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(G.uv, 2));
    if (G.n) g.setAttribute("normal", new THREE.Float32BufferAttribute(G.n, 3)); else if (ombre) g.computeVertexNormals(); else { const n = new Float32Array(G.p.length); for (let i = 1; i < n.length; i += 3) n[i] = 1; g.setAttribute("normal", new THREE.BufferAttribute(n, 3)); }
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = ombre; return m; }
  const aire = r => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return s / 2; };
  function polygones(rings) {   // anneaux → [contour, ...trous]
    const out = []; let sg = 0;
    for (const r of rings) { const a = aire(r); if (Math.abs(a) < 0.5) continue; if (!sg) sg = Math.sign(a);
      if (Math.sign(a) === sg || !out.length) out.push([r]); else out[out.length - 1].push(r); }
    return out; }
  function surface(G, poly, h) {   // un polygone plat (avec ses trous)
    const [ext, ...trous] = poly.map(r => { const q = r.slice(); if (q.length > 1 && q[0][0] === q[q.length - 1][0] && q[0][1] === q[q.length - 1][1]) q.pop(); return q; });
    if (ext.length < 3) return; const V = ext.map(([x, y]) => new THREE.Vector2(x, y)), H = trous.filter(t => t.length >= 3).map(t => t.map(([x, y]) => new THREE.Vector2(x, y)));
    const tri = THREE.ShapeUtils.triangulateShape(V, H), all = [...V, ...H.flat()];
    for (const [a, b, c] of tri) for (const k of [a, c, b]) { const v = all[k]; G.p.push(v.x, h, -v.y); G.uv.push(v.x / 6, -v.y / 6); } }

  /* --- une tuile : on lit, on dessine, on range --- */
  async function construire(tx, ty) {
    const url = URL_T.replace("{z}", Z).replace("{x}", tx).replace("{y}", ty);
    const buf = await (await fetch(url)).arrayBuffer(); const vt = new VT(new Pbf(buf));
    const [lo0, la0] = coinLonLat(tx, ty), [lo1, la1] = coinLonLat(tx + 1, ty + 1);
    const conv = (ext) => ([px, py]) => versLocal(lo0 + (lo1 - lo0) * px / ext, la0 + (la1 - la0) * py / ext);
    const dansTuile = (px, py, ext) => px >= 0 && px < ext && py >= 0 && py < ext;
    const rueExclue = (x, y) => Math.abs(x) < rayonRues && Math.abs(y) < rayonRues;   // le quartier a déjà ses rues (identiques : pas de raccord visible)
    const groupe = new THREE.Group();
    const lire = (nom, f) => { const L = vt.layers[nom]; if (!L) return; const c = conv(L.extent); for (let i = 0; i < L.length; i++) { const ft = L.feature(i); f(ft, ft.loadGeometry().map(r => r.map(p => [p.x, p.y])), c, L.extent); } };

    // eau, verdure
    const eau = plat(), vert = plat(), bois = plat();
    lire("water", (ft, rings, c) => { if (ft.type !== 3 || ft.properties.class === "swimming_pool") return; for (const p of polygones(rings.map(r => r.map(c)))) surface(eau, p, 0.06); });
    const vertOk = { grass: vert, park: vert, wood: bois, forest: bois, meadow: vert, farmland: vert, cemetery: vert };
    for (const nom of ["landcover", "park", "landuse"]) lire(nom, (ft, rings, c, ext) => { if (ft.type !== 3) return; const G = nom === "park" ? vert : vertOk[ft.properties.class]; if (!G) return;
      for (const p of polygones(rings.map(r => r.map(c)))) { const [x, y] = p[0][0]; if (exclu(x, y)) continue; surface(G, p, 0.05); } });

    // rues : chaussée, trottoirs, tirets du milieu, passages piétons aux carrefours
    const ch = plat(), tr = plat(), mq = plat(), rail = plat(), rues = [];
    lire("transportation", (ft, rings, c, ext) => {
      const p = ft.properties; if (ft.type !== 2 || p.brunnel === "tunnel") return;
      if (p.class === "rail" || p.class === "transit") { for (const r of rings) { const l = r.map(c); if (l.length > 1) ruban(rail, l, 1.6, 0.09); } return; }
      const w = LARG[p.class]; if (!w) return;
      for (const r of rings) { let seg = [], segPx = [];
        const vider = () => { if (seg.length > 1) rues.push({ l: seg, px: segPx, w, cl: p.class }); seg = []; segPx = []; };
        for (let i = 0; i < r.length - 1; i++) { const a = r[i], b = r[i + 1], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], A = c(a), B = c(b), mm = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
          if (dansTuile(m[0], m[1], ext) && !rueExclue(mm[0], mm[1])) { if (!seg.length) { seg.push(A); segPx.push(a); } seg.push(B); segPx.push(b); } else vider(); }
        vider(); } });
    for (const r of rues) { ruban(ch, r.l, r.w, 0.125); if (r.w >= 6 && r.cl !== "motorway" && r.cl !== "trunk") ruban(tr, r.l, r.w + 4.4, 0.118); }
    // tirets du milieu sur les rues à deux voies
    for (const r of rues) { if (r.w < 8) continue; let reste = 4;
      for (let i = 0; i < r.l.length - 1; i++) { const [x1, y1] = r.l[i], [x2, y2] = r.l[i + 1], L = Math.hypot(x2 - x1, y2 - y1); if (L < 0.1) continue; const ang = Math.atan2(y2 - y1, x2 - x1);
        let s = reste; for (; s < L - 1.5; s += 8) boiteSol(mq, x1 + (x2 - x1) * (s + 1.5) / L, y1 + (y2 - y1) * (s + 1.5) / L, ang, 3, 0.15, 0.135); reste = s - L; } }
    // carrefours : là où au moins 3 branches se rejoignent (points partagés des rues)
    const noeuds = new Map(), cle = ([x, y]) => x + "|" + y;
    rues.forEach((r, k) => r.px.forEach((q, i) => { const n = noeuds.get(cle(q)) || noeuds.set(cle(q), { x: r.l[i][0], y: r.l[i][1], b: [] }).get(cle(q));
      if (i > 0) n.b.push({ r, i, sens: -1 }); if (i < r.px.length - 1) n.b.push({ r, i, sens: 1 }); }));
    for (const n of noeuds.values()) { if (n.b.length < 3) continue; const large = Math.max(...n.b.map(b => b.r.w)) / 2 + 2.2;
      for (const { r, i, sens } of n.b) { if (r.w < 6 || r.cl === "motorway" || r.cl === "trunk") continue;
        const [bx, by] = r.l[i + sens], L = Math.hypot(bx - n.x, by - n.y); if (L < large + 5) continue;
        const ux = (bx - n.x) / L, uy = (by - n.y) / L, cx = n.x + ux * large, cy = n.y + uy * large, ang = Math.atan2(uy, ux), hw = r.w / 2;
        for (let v = -hw + 0.45; v <= hw - 0.3; v += 1) boiteSol(mq, cx - uy * v, cy + ux * v, ang, 2.6, 0.5, 0.136); } }

    // bâtiments : murs à leur vraie hauteur, toit plat, liserés comme dans le quartier
    const B = { p: [], uv: [], n: [] }, T = [];
    lire("building", (ft, rings, c, ext) => {
      if (ft.type !== 3) return; const h = Math.max(3, +ft.properties.render_height || 6), h0 = +ft.properties.render_min_height || 0;
      for (const poly of polygones(rings)) { let sx = 0, sy = 0; for (const [x, y] of poly[0]) { sx += x; sy += y; } sx /= poly[0].length; sy /= poly[0].length;
        if (!dansTuile(sx, sy, ext)) continue; const P = poly.map(r => r.map(c)); const [cx, cy] = c([sx, sy]); if (exclu(cx, cy)) continue;
        const n0 = B.p.length; surface(B, P, h); for (let k = n0; k < B.p.length; k += 3) B.n.push(0, 1, 0);   // toit : vers le ciel
        const sens = aire(P[0]) > 0 ? 1 : -1;   // murs : normale vers l'extérieur (sinon ombres en rayures)
        for (const r of P) for (let i = 0; i < r.length - 1; i++) { const [x1, y1] = r[i], [x2, y2] = r[i + 1]; if (x1 === x2 && y1 === y2) continue;
          const L = Math.hypot(x2 - x1, y2 - y1), nx = (y2 - y1) / L * sens, nz = (x2 - x1) / L * sens;
          for (const q of [[x1, h0, y1], [x2, h0, y2], [x2, h, y2], [x1, h0, y1], [x2, h, y2], [x1, h, y1]]) { B.p.push(q[0], q[1], -q[2]); B.uv.push(0, 0); B.n.push(nx, 0, nz); }
          T.push(x1, h, -y1, x2, h, -y2); if (h - h0 > 4) T.push(x1, h0 + 0.15, -y1, x1, h, -y1); } } });

    for (const [G, m, o] of [[eau, M.eau], [vert, M.vert], [bois, M.bois], [rail, M.rail], [tr, M.trottoir], [ch, M.chaussee], [mq, M.blanc], [B, M.bati, true]]) { const me = maillage(G, m, o); if (me) groupe.add(me); }
    if (T.length) { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(T, 3)); groupe.add(new THREE.LineSegments(g, M.trait)); }
    return groupe;
  }

  /* --- ce qu'il faut charger : les tuiles autour de ce que regarde la caméra --- */
  let dernier = 0, actif = true;
  function maj(cible, distance) {
    if (!actif) return; const t = performance.now(); if (t - dernier < 400) return; dernier = t;
    if (!URL_T) { charger().catch(e => { console.warn("carte GPS", e); actif = false; }); return; }
    const [lon, lat] = versLonLat(cible.x, -cible.z), [cx, cy] = tuileDe(lon, lat);
    // seulement les tuiles à portée de vue (le brouillard cache tout au-delà de ~1,5 km)
    const portee = Math.max(1200, Math.min(2600, distance * 1.3 + 600));
    const ecart = (x, y) => { const [lo0, la0] = coinLonLat(x, y), [lo1, la1] = coinLonLat(x + 1, y + 1), [x0, y1] = versLocal(lo0, la0), [x1, y0] = versLocal(lo1, la1);
      const px = cible.x, py = -cible.z; return Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1)); };
    const voulues = [];
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) { const d = ecart(cx + dx, cy + dy); if (d < portee) voulues.push([cx + dx, cy + dy, d]); }
    voulues.sort((a, b) => a[2] - b[2]);
    for (const [x, y] of voulues) { const k = x + "/" + y; if (TUILES.has(k) || enCours >= 2) continue;
      enCours++; TUILES.set(k, { x, y, g: null });
      construire(x, y).then(g => { const e = TUILES.get(k); if (e) { e.g = g; scene.add(g); } }).catch(e => { console.warn("tuile", k, e); TUILES.delete(k); }).finally(() => enCours--); }
    for (const [k, e] of TUILES) if (e.g && ecart(e.x, e.y) > portee + 1200) {   // trop loin : on libère la mémoire
      scene.remove(e.g); e.g.traverse(o => o.geometry && o.geometry.dispose()); TUILES.delete(k); }
  }
  return { maj, M };
}
