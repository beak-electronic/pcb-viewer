// PCB Viewer – 3D-Ansicht (three.js lokal, offline). Platine extrudiert, Lagen als Texturen, Bauteile als Körper.
import * as THREE from './three.module.min.js';
import { OrbitControls } from './OrbitControls.js';
const bgrHex = c => { c = +c || 0; return ((c & 255) << 16) | (c & 0xFF00) | ((c >> 16) & 255); };
const mil = s => parseFloat(String(s || '0')) || 0;
let R = null;
// ---- STEP (occt-import-js, lokal) ----
let occtP = null; const stepCache = new Map();
function occt() { if (!occtP) occtP = new Promise((res, rej) => { const go = () => window.occtimportjs({ locateFile: f => './' + f }).then(res, rej);
  if (window.occtimportjs) return go(); const sc = document.createElement('script'); sc.src = './occt-import-js.js'; sc.onload = go; sc.onerror = () => rej(new Error('occt-import-js fehlt')); document.head.appendChild(sc); }); return occtP; }
async function inflate(raw) { try { return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()); } catch (_) { return raw; } }
async function stepGroup(model) { // -> THREE.Group in mm (Modellkoordinaten), gecacht
  const key = model.id + model.checksum; if (stepCache.has(key)) return stepCache.get(key).clone();
  const oc = await occt(); const data = await inflate(model.raw);
  const res = oc.ReadStepFile(data, { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.002, angularDeflection: 0.5 });
  if (!res || !res.success) throw new Error('STEP nicht lesbar: ' + model.name);
  const g = new THREE.Group();
  for (const m of res.meshes) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
    if (m.attributes.normal) geo.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3)); geo.setIndex(m.index.array); if (!m.attributes.normal) geo.computeVertexNormals();
    const base = m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : new THREE.Color(0x9a9a9a); const mats = [new THREE.MeshStandardMaterial({ color: base, roughness: 0.5, metalness: 0.15 })];
    if (m.brep_faces && m.brep_faces.some(f => f.color)) { const ci = new Map(); for (const f of m.brep_faces) { let mi = 0; if (f.color) { const k = f.color.join(','); if (!ci.has(k)) { ci.set(k, mats.length); mats.push(new THREE.MeshStandardMaterial({ color: new THREE.Color(...f.color), roughness: 0.5, metalness: 0.15 })); } mi = ci.get(k); } geo.addGroup(f.first * 3, (f.last - f.first + 1) * 3, mi); } }
    g.add(new THREE.Mesh(geo, mats.length > 1 && geo.groups.length ? mats : mats[0])); }
  stepCache.set(key, g); return g.clone(); }
const cloneMats = o => o.traverse(n => { if (n.isMesh) n.material = Array.isArray(n.material) ? n.material.map(m => m.clone()) : n.material.clone(); });
function cfg3d(board) {
  const raw = board['3DCONFIGURATION'] || ''; const o = {};
  raw.split('`').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).toUpperCase()] = p.slice(i + 1); });
  const col = (k, def) => (o['CFG3D.' + k] !== undefined ? bgrHex(o['CFG3D.' + k]) : def);
  const op = (k, def) => (o['CFG3D.' + k + 'OPACITY'] !== undefined ? +o['CFG3D.' + k + 'OPACITY'] : def);
  return { maskTop: col('TOPSOLDERMASKCOLOR', 0x1E7B34), maskTopO: op('TOPSOLDERMASKCOLOR', 0.85), maskBot: col('BOTSOLDERMASKCOLOR', 0x1E7B34), maskBotO: op('BOTSOLDERMASKCOLOR', 0.85),
    copper: col('COPPERCOLOR', 0xE0B532), silkTop: col('TOPSILKSCREENCOLOR', 0xFFFFFF), silkBot: col('BOTSILKSCREENCOLOR', 0xFFFFFF), core: col('BOARDCORECOLOR', 0xC8C080), coreO: op('BOARDCORECOLOR', 1) };
}
function thickness(board) { let t = 0; for (const k in board) if (/^V9_STACK_LAYER\d+_(DIELHEIGHT|COPTHICK)$/.test(k)) t += mil(board[k]); return t > 5 ? t : 62.99; }
const hex = n => '#' + n.toString(16).padStart(6, '0');
function sideSvg(pcb, side, C, H, bb, hidden) {
  const L = pcb.layers, top = side === 'oben';
  const cu = top ? [1] : [32], mask = top ? 37 : 38, silk = top ? 33 : 34, mi = H.outlinePath(pcb.data.outline);
  const g = l => (L.get(l) || []).join('');
  const mo = top ? C.maskTopO : C.maskBotO, mc = top ? C.maskTop : C.maskBot;
  const w = bb.x2 - bb.x1, h = bb.y2 - bb.y1;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bb.x1} ${bb.y1} ${w} ${h}" width="${TW(w, h)[0]}" height="${TW(w, h)[1]}">`;
  s += `<defs><mask id="m"><rect x="${bb.x1}" y="${bb.y1}" width="${w}" height="${h}" fill="#fff"/><g fill="#000" stroke="#000">${g(mask)}</g></mask><clipPath id="c"><path clip-rule="evenodd" d="${mi}${(pcb.data.cutouts || []).map(c => 'M' + c.map(p => p.x + ',' + (-p.y)).join('L') + 'Z').join('')}"/></clipPath></defs><g clip-path="url(#c)">`;
  if (!hidden.has(cu[0])) s += `<g fill="${hex(C.copper)}" stroke="${hex(C.copper)}" stroke-linecap="round">${cu.map(g).join('')}${hidden.has(74) ? '' : g(74)}</g>`;
  if (!hidden.has(mask) || true) s += `<rect x="${bb.x1}" y="${bb.y1}" width="${w}" height="${h}" fill="${hex(mc)}" fill-opacity="${mo}" mask="url(#m)"/>`;
  if (!hidden.has(silk)) s += `<g fill="${hex(C.silkTop)}" stroke="${hex(C.silkTop)}" stroke-linecap="round">${g(silk)}</g>`;
  s += `<g fill="#111">${g(901)}</g></g></svg>`;
  return s;
}
// Texturauflösung nach Größe (ca. 1 mil/px, max. 8192 bzw. GPU-Limit)
let MAXT = 4096; const TW = (w, h) => { const s = Math.min(MAXT / Math.max(w, h), Math.max(2048 / Math.max(w, h), 1)); return [Math.round(w * s), Math.round(h * s)]; };
function tex(svg) { return new Promise((res, rej) => { const img = new Image(); const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0); URL.revokeObjectURL(url);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; res(t); }; img.onerror = rej; img.src = url; }); }
function shapeFrom(pts, ox, oy) { const s = new THREE.Shape(); pts.forEach((p, i) => (i ? s.lineTo(p.x - ox, p.y - oy) : s.moveTo(p.x - ox, p.y - oy))); return s; }
function outlinePts(ol) { const a = []; ol.forEach(v => { a.push({ x: v.x, y: v.y }); if (v.k === 1 && v.r > 0) { const sw = ((v.ea - v.sa) % 360 + 360) % 360 || 360; const n = Math.ceil(sw / 5); for (let i = 1; i < n; i++) { const t = (v.sa + sw * i / n) * Math.PI / 180; a.push({ x: v.cx + v.r * Math.cos(t), y: v.cy + v.r * Math.sin(t) }); } } }); return a; }
export const Drei = { _R: () => R,
  async show(box, pcb, H) {
    if (R && R.pcb === pcb) { R.H = H; this.setSide(H.side); R.running = true; R.loop(); return; }
    this.stop(); if (R) { R.renderer.dispose(); box.innerHTML = ''; }
    const d = pcb.data, C = cfg3d(d.board), T = thickness(d.board);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, logarithmicDepthBuffer: false }); MAXT = Math.min(8192, renderer.capabilities.maxTextureSize || 4096); renderer.setPixelRatio(Math.min(2, devicePixelRatio)); box.appendChild(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xffffff);
    const cam = new THREE.PerspectiveCamera(35, 1, 1, 1e6); const ctl = new OrbitControls(cam, renderer.domElement); ctl.enableDamping = true; ctl.screenSpacePanning = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6)); const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(1, -1.5, 3); scene.add(dl); const dl2 = new THREE.DirectionalLight(0xffffff, 0.6); dl2.position.set(-1, 1, -3); scene.add(dl2);
    let pts = outlinePts(d.outline); if (pts.length < 3) { const b = H.outlinePath ? null : null; void b; const xs = d.pads.map(p => p.x), ys = d.pads.map(p => p.y); const x1 = Math.min(...xs) - 50, x2 = Math.max(...xs) + 50, y1 = Math.min(...ys) - 50, y2 = Math.max(...ys) + 50; pts = [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }]; }
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y), bb0 = { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) };
    const ox = (bb0.x1 + bb0.x2) / 2, oy = (bb0.y1 + bb0.y2) / 2, shape = shapeFrom(pts, ox, oy);
    // Material = Kontur minus Board-Cutouts (achsparallele Cutouts per Zellzerlegung, damit sich überlappende Schlitze sauber schneiden), minus Bohrungen
    const drills = d.pads.concat(d.vias).filter(p => p.hole > 0);
    const isRect = c => { const u = c.filter((p, k) => k === 0 || p.x !== c[k - 1].x || p.y !== c[k - 1].y); const xs2 = new Set(u.map(p => Math.round(p.x * 100))), ys2 = new Set(u.map(p => Math.round(p.y * 100))); return xs2.size <= 2 && ys2.size <= 2; };
    const cuts = (d.cutouts || []).filter(c => c.length >= 3), cutBB = cuts.map(c => ({ x1: Math.min(...c.map(p => p.x)), x2: Math.max(...c.map(p => p.x)), y1: Math.min(...c.map(p => p.y)), y2: Math.max(...c.map(p => p.y)) }));
    const inPoly = (P, x, y) => { let r = false; for (let a2 = 0, b2 = P.length - 1; a2 < P.length; b2 = a2++) { const A = P[a2], B = P[b2]; if ((A.y > y) !== (B.y > y) && x < (B.x - A.x) * (y - A.y) / (B.y - A.y) + A.x) r = !r; } return r; };
    const addDrills = (s, test) => drills.forEach(p => { if (test(p)) { const hh = new THREE.Path(); hh.absarc(p.x - ox, p.y - oy, p.hole / 2, 0, Math.PI * 2, true); s.holes.push(hh); } });
    let matShapes;
    if (cuts.length && cuts.every(isRect)) {
      const X = [...new Set([bb0.x1, bb0.x2, ...cutBB.flatMap(b => [b.x1, b.x2])].map(v => Math.min(bb0.x2, Math.max(bb0.x1, v))))].sort((p, q) => p - q);
      const Y = [...new Set([bb0.y1, bb0.y2, ...cutBB.flatMap(b => [b.y1, b.y2])].map(v => Math.min(bb0.y2, Math.max(bb0.y1, v))))].sort((p, q) => p - q);
      matShapes = [];
      for (let yi = 0; yi < Y.length - 1; yi++) { let run = null; const flush = () => { if (!run) return; const s = new THREE.Shape(); s.moveTo(run.x1 - ox, Y[yi] - oy); s.lineTo(run.x2 - ox, Y[yi] - oy); s.lineTo(run.x2 - ox, Y[yi + 1] - oy); s.lineTo(run.x1 - ox, Y[yi + 1] - oy);
          const r0 = { ...run }; addDrills(s, p => p.x - p.hole / 2 > r0.x1 && p.x + p.hole / 2 < r0.x2 && p.y - p.hole / 2 > Y[yi] && p.y + p.hole / 2 < Y[yi + 1]); matShapes.push(s); run = null; };
        for (let xi = 0; xi < X.length - 1; xi++) { const cx = (X[xi] + X[xi + 1]) / 2, cy = (Y[yi] + Y[yi + 1]) / 2;
          const mat = X[xi + 1] - X[xi] > 1e-6 && Y[yi + 1] - Y[yi] > 1e-6 && inPoly(pts, cx, cy) && !cutBB.some(b => cx > b.x1 && cx < b.x2 && cy > b.y1 && cy < b.y2);
          if (mat) { if (run && run.x2 === X[xi]) run.x2 = X[xi + 1]; else { flush(); run = { x1: X[xi], x2: X[xi + 1] }; } } else flush(); }
        flush(); }
    } else { const s = shapeFrom(pts, ox, oy); addDrills(s, () => true); cuts.forEach(c => { const hh = new THREE.Path(); c.forEach((p, k) => (k ? hh.lineTo(p.x - ox, p.y - oy) : hh.moveTo(p.x - ox, p.y - oy))); s.holes.push(hh); }); matShapes = [s]; }
    const core = new THREE.Mesh(new THREE.ExtrudeGeometry(matShapes, { depth: T, bevelEnabled: false, curveSegments: 24 }), new THREE.MeshStandardMaterial({ color: C.core, transparent: C.coreO < 1, opacity: C.coreO, roughness: 0.8 }));
    scene.add(core);
    const world = new THREE.Group(); scene.add(world);
    // Lagen-Texturen (SVG-Koordinaten: y gespiegelt)
    const bbS = { x1: bb0.x1, x2: bb0.x2, y1: -bb0.y2, y2: -bb0.y1 }; const w = bb0.x2 - bb0.x1, h = bb0.y2 - bb0.y1;
    const faceGeo = () => { const g = new THREE.ShapeGeometry(matShapes, 24); const uv = g.attributes.uv, pos = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + ox - bb0.x1) / w, (pos.getY(i) + oy - bb0.y1) / h); return g; };
    const mkFace = async (side) => { const t = await tex(sideSvg(pcb, side, C, H, bbS, H.hidden)); const m = new THREE.Mesh(faceGeo(), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.position.z = side === 'oben' ? T + 0.6 : -0.6; return m; };
    const faces = new THREE.Group(); scene.add(faces);
    const buildFaces = async () => { const [a, b] = await Promise.all([mkFace('oben'), mkFace('unten')]); faces.clear(); faces.add(a, b); };
    await buildFaces();
    // Bauteile
    const compMeshes = new Map(); const has = new Set();
    const MM = 39.3700787; const stepJobs = [];
    for (const b of d.bodies) { if (b.comp < 0 || b.pts.length < 3) continue;
      const mdl = b.p.MODELID && d.models.find(m => m.id === b.p.MODELID); if (mdl && mdl.raw && b.p['MODEL.MODELTYPE'] === '1') { has.add(b.comp); stepJobs.push([b, mdl]); continue; } const c = d.comps[b.comp]; const bot = c && c.layer === 'BOTTOM';
      const so = Math.max(0, mil(b.p.STANDOFFHEIGHT)), oh = Math.max(so + 5, mil(b.p.OVERALLHEIGHT));
      const g = new THREE.ExtrudeGeometry(shapeFrom(b.pts, ox, oy), { depth: oh - so, bevelEnabled: false });
      const mat = new THREE.MeshStandardMaterial({ color: b.p.BODYCOLOR3D !== undefined ? bgrHex(b.p.BODYCOLOR3D) : 0x808080, transparent: +(b.p.BODYOPACITY3D || 1) < 1, opacity: +(b.p.BODYOPACITY3D || 1), roughness: 0.6 });
      const m = new THREE.Mesh(g, mat); m.position.z = bot ? -so - (oh - so) : T + so; m.userData.comp = b.comp; world.add(m); has.add(b.comp);
      if (!compMeshes.has(b.comp)) compMeshes.set(b.comp, []); compMeshes.get(b.comp).push(m); }
    const placeStep = async ([b, mdl]) => { const c = d.comps[b.comp], bot = c && c.layer === 'BOTTOM';
      const inner = await stepGroup(mdl); cloneMats(inner); inner.scale.setScalar(MM);
      const r = THREE.MathUtils.degToRad, rx = +(b.p['MODEL.3D.ROTX'] ?? mdl.rotx), ry = +(b.p['MODEL.3D.ROTY'] ?? mdl.roty), rz = +(b.p['MODEL.3D.ROTZ'] ?? mdl.rotz);
      const mR = new THREE.Group(); mR.add(inner); mR.rotation.set(r(rx), r(ry), r(rz), 'ZYX');
      const pl = new THREE.Group(); pl.add(mR); pl.rotation.z = r(+(b.p['MODEL.2D.ROTATION'] || 0)); const dz = mil(b.p['MODEL.3D.DZ']);
      const outer = new THREE.Group(); outer.add(pl); outer.position.set(mil(b.p['MODEL.2D.X']) - ox, mil(b.p['MODEL.2D.Y']) - oy, bot ? -dz : T + dz); if (bot) outer.rotation.x = Math.PI; // Unterseite gespiegelt
      outer.userData.comp = b.comp; outer.traverse(n => { n.userData.comp = b.comp; }); world.add(outer);
      const ms = []; outer.traverse(n => { if (n.isMesh) ms.push(n); }); compMeshes.set(b.comp, (compMeshes.get(b.comp) || []).concat(ms)); };
    const stepFail = [];
    await Promise.all(stepJobs.map(j => placeStep(j).catch(e => { console.warn(e); stepFail.push(d.comps[j[0].comp]?.des); has.delete(j[0].comp); })));
    pcb.stepInfo = { ok: stepJobs.length - stepFail.length, fail: stepFail };
    // keine Ersatz-Quader: nur Bauteile mit echtem 3D-Modell (STEP oder Body aus der Datei)
    const sel = new THREE.Group(); scene.add(sel);
    R = { world, pcb, H, renderer, scene, cam, ctl, box, compMeshes, sel, T, size: Math.max(w, h), buildFaces, running: true, side: 'oben' };
    const resize = () => { const r = box.getBoundingClientRect(); if (!r.width || !r.height) return; renderer.setSize(r.width, r.height, false); cam.aspect = r.width / r.height; cam.updateProjectionMatrix(); };
    R.ro = new ResizeObserver(resize); R.ro.observe(box); resize();
    const span = Math.hypot(w, h); R.loop = () => { if (!R.running) return; ctl.update();
      // Tiefenbereich an Abstand + Platinengröße anpassen (sonst Z-Fighting/Moiré bei großen Nutzen)
      const dist = cam.position.distanceTo(ctl.target), nr = Math.max(0.5, (dist - span) * 0.5, dist / 200), fr = dist + span * 2; if (Math.abs(cam.near - nr) > nr * 0.05 || Math.abs(cam.far - fr) > fr * 0.05) { cam.near = nr; cam.far = fr; cam.updateProjectionMatrix(); }
      renderer.render(scene, cam); requestAnimationFrame(R.loop); };
    // Klick = Auswahl
    let down = null; renderer.domElement.addEventListener('pointerdown', e => (down = { x: e.clientX, y: e.clientY }));
    renderer.domElement.addEventListener('pointerup', e => { if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; const r = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), cam);
      const hit = world.visible ? ray.intersectObjects(world.children, true)[0] : null; let des = hit ? d.comps[hit.object.userData.comp]?.des : null;
      if (!hit) { const f = ray.intersectObjects(faces.children)[0]; if (f && R.H.onPickAt) { R.H.onPickAt(f.point.x + ox, f.point.y + oy); return; } if (f) { const x = f.point.x + ox, y = -(f.point.y + oy); let best = null, ba = Infinity; pcb.boxes.forEach((b, i) => { if (b && x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2) { const a = (b.x2 - b.x1) * (b.y2 - b.y1); if (a < ba) { ba = a; best = d.comps[i].des; } } }); des = best; } }
      R.H.onPick(des); });
    R.world.visible = !H.hidden.has(950); this.setSide(H.side, true); R.loop();
  },
  setSide(side, force) { if (!R) return; if (R.side === side && !force) return; R.side = side; const D = R.size * 2.4; R.cam.up.set(0, 1, 0);
    if (side === 'unten') R.cam.position.set(0, -D * 0.25, -D); else R.cam.position.set(0, -D * 0.25, D + R.T); R.ctl.target.set(0, 0, R.T / 2); R.cam.updateProjectionMatrix(); R.ctl.update(); },
  fit() { if (R) this.setSide(R.side, true); },
  select(des) { if (!R) return; const d = R.pcb.data; R.compMeshes.forEach((ms, i) => ms.forEach(m => { const on = d.comps[i].des === des; (Array.isArray(m.material) ? m.material : [m.material]).forEach(mt => { if (!mt.userData.c0) mt.userData.c0 = mt.color.clone(); mt.color.copy(on ? new THREE.Color(0xD80373) : mt.userData.c0); mt.emissive = new THREE.Color(on ? 0xD80373 : 0x000000); mt.emissiveIntensity = on ? 0.35 : 0; }); }));
    R.sel.clear(); const i = d.comps.findIndex(c => c.des === des); if (i < 0) return; const b = R.pcb.boxes[i]; const ms = R.compMeshes.get(i) || [];
    const bx = new THREE.Box3(); ms.forEach(m => bx.expandByObject(m)); if (bx.isEmpty()) return; bx.expandByScalar(8);
    void b; },
  async layers(hidden) { if (!R) return; R.H.hidden = hidden; R.world.visible = !hidden.has(950); R.sel.visible = R.world.visible; await R.buildFaces(); },
  stop() { if (R) R.running = false; }
};
