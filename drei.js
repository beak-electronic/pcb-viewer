// PCB Viewer – 3D-Ansicht (three.js lokal, offline). Platine extrudiert, Lagen als Texturen, Bauteile als Körper.
import * as THREE from './three.module.min.js';
import { OrbitControls } from './OrbitControls.js';
const bgrHex = c => { c = +c || 0; return ((c & 255) << 16) | (c & 0xFF00) | ((c >> 16) & 255); };
const mil = s => parseFloat(String(s || '0')) || 0;
let R = null;
// ---- STEP: Worker-Pool (occt-import-js), Dedupe per Inhalts-Hash, IndexedDB-Cache, gemeinsame Geometrie/Materialien ----
const STEP_PARAMS = { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.004, angularDeflection: 0.6 };
const PKEY = 'v2|' + JSON.stringify(STEP_PARAMS);
let pool = null; let jobId = 0; const waiting = new Map();
let wasmP = null; const wasmMod = () => wasmP || (wasmP = (async () => { try { return await WebAssembly.compileStreaming(fetch('./occt-import-js.wasm')); } catch (_) { try { return await WebAssembly.compile(await (await fetch('./occt-import-js.wasm')).arrayBuffer()); } catch (e) { return null; } } })());
const POOLMAX = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
function addWorker() { const w = new Worker('./step-worker.js'); w.onmessage = ev => { const j = waiting.get(ev.data.id); waiting.delete(ev.data.id); pool.busy.delete(w); pump(); if (j) (ev.data.ok ? j.res(ev.data) : j.rej(new Error(ev.data.err))); }; w.onerror = ev => { console.warn('step-worker', ev.message); };
  w.ready = wasmMod().then(m => { if (m) w.postMessage({ mod: m }); }); pool.ws.push(w); return w; }
function getPool() { if (pool) return pool; pool = { ws: [], q: [], busy: new Set() }; addWorker(); return pool; }
function pump() { const p = pool; while (p.q.length > p.ws.length - p.busy.size && p.ws.length < POOLMAX) addWorker(); for (const w of p.ws) { if (!p.q.length) return; if (p.busy.has(w)) continue; const j = p.q.shift(); p.busy.add(w); waiting.set(j.id, j); w.ready.then(() => w.postMessage({ id: j.id, raw: j.raw, params: STEP_PARAMS }, j.raw ? [j.raw.buffer] : [])); } }
const runJob = raw => new Promise((res, rej) => { getPool().q.push({ id: ++jobId, raw, res, rej }); pump(); });
// IndexedDB
let dbP = null;
const db = () => dbP || (dbP = new Promise(res => { try { const r = indexedDB.open('beak-pcbv-3d', 1); r.onupgradeneeded = () => r.result.createObjectStore('step'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (_) { res(null); } }));
const idbGet = async k => { const d = await db(); if (!d) return null; return new Promise(res => { try { const q = d.transaction('step').objectStore('step').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (_) { res(null); } }); };
const idbPut = async (k, v) => { const d = await db(); if (!d) return; try { d.transaction('step', 'readwrite').objectStore('step').put(v, k); } catch (_) {} };
async function hashOf(raw) { try { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', raw)); return Array.from(h, b => b.toString(16).padStart(2, '0')).join(''); } catch (_) { let h = 2166136261; for (let i = 0; i < raw.length; i++) h = Math.imul(h ^ raw[i], 16777619); return 'f' + (h >>> 0).toString(16) + '_' + raw.length; } }
const geoCache = new Map(); // hash -> Promise<[{geo, mat}]>
const matCache = new Map();
const matFor = c => { const k = c.join(','); if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: new THREE.Color(c[0], c[1], c[2]), roughness: 0.5, metalness: 0.15 })); return matCache.get(k); };
const PINK = new THREE.MeshStandardMaterial({ color: 0xD80373, emissive: 0xD80373, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.15 });
const toParts = parts => parts.map(p => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p.pos, 3)); g.setIndex(new THREE.BufferAttribute(p.idx, 1)); if (p.nrm) g.setAttribute('normal', new THREE.BufferAttribute(p.nrm, 3)); else g.computeVertexNormals(); g.computeBoundingSphere(); return { geo: g, mat: matFor(p.color) }; });
export const stats = { worker: 0, idb: 0, mem: 0, ms: 0 };
function modelParts(model) {
  const mk = model.id + '|' + model.checksum;
  if (model._hp) return model._hp;
  return (model._hp = (async () => {
    const raw = model.raw instanceof Uint8Array ? model.raw : new Uint8Array(model.raw); const h = (await hashOf(raw)) + '|' + PKEY;
    if (geoCache.has(h)) { stats.mem++; return geoCache.get(h); }
    const pr = (async () => { const c = await idbGet(h); if (c) { stats.idb++; return toParts(c); }
      const r = await runJob(raw.slice()); stats.worker++; stats.ms += r.ms || 0; idbPut(h, r.parts.map(p => ({ color: p.color, pos: p.pos, nrm: p.nrm, idx: p.idx }))); return toParts(r.parts); })();
    geoCache.set(h, pr); pr.catch(() => geoCache.delete(h)); void mk; return pr; })()); }
// Vorwärmen: Worker + WASM starten und Modelle der Platinen im Hintergrund konvertieren (Cache)
export function warm(pcbs) { try { getPool(); runJob(null).catch(() => {}); (pcbs || []).forEach(pc => (pc.data.models || []).forEach(m => { if (m.raw) modelParts(m).catch(() => {}); })); } catch (e) { console.warn(e); } }
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
    if (R && R.pcb === pcb) { R.H = H; this.setSide(H.side); R.running = true; R.dirty = true; R.loop(); return; }
    const T0 = performance.now(); this.stop(); if (R) { R.dead = true; R.renderer.dispose(); box.innerHTML = ''; }
    const d = pcb.data, C = cfg3d(d.board), T = thickness(d.board);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, logarithmicDepthBuffer: false }); MAXT = Math.min(8192, renderer.capabilities.maxTextureSize || 4096); renderer.setPixelRatio(Math.min(2, devicePixelRatio)); box.appendChild(renderer.domElement);
    const prog = document.createElement('div'); prog.className = 'lade3d'; prog.innerHTML = '<div class="lt">Lade 3D-Ansicht …</div><div class="lb"><i></i></div>'; box.appendChild(prog);
    const setP = (txt, f) => { prog.querySelector('.lt').textContent = txt; prog.querySelector('i').style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; };
    const yieldUI = () => new Promise(r => setTimeout(r, 0));
    setP('Erzeuge Platine …', 0.03); await yieldUI();
    const scene = new THREE.Scene(); scene.background = new THREE.Color(document.documentElement.classList.contains('ist-dunkel') ? 0x000000 : 0xffffff);
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
    (d.models || []).forEach(m => { if (m.raw) modelParts(m).catch(() => {}); }); // Konvertierung parallel zur Textur
    setP('Erzeuge Oberflächen …', 0.08); await yieldUI(); await buildFaces();
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
      const parts = await modelParts(mdl); if (R0.dead) return; const inner = new THREE.Group(); parts.forEach(pt => { const m = new THREE.Mesh(pt.geo, pt.mat); m.userData.m0 = pt.mat; inner.add(m); }); inner.scale.setScalar(MM);
      const r = THREE.MathUtils.degToRad, rx = +(b.p['MODEL.3D.ROTX'] ?? mdl.rotx), ry = +(b.p['MODEL.3D.ROTY'] ?? mdl.roty), rz = +(b.p['MODEL.3D.ROTZ'] ?? mdl.rotz);
      const mR = new THREE.Group(); mR.add(inner); mR.rotation.set(r(rx), r(ry), r(rz), 'ZYX');
      const pl = new THREE.Group(); pl.add(mR); pl.rotation.z = r(+(b.p['MODEL.2D.ROTATION'] || 0)); const dz = mil(b.p['MODEL.3D.DZ']);
      const outer = new THREE.Group(); outer.add(pl); outer.position.set(mil(b.p['MODEL.2D.X']) - ox, mil(b.p['MODEL.2D.Y']) - oy, bot ? -dz : T + dz); if (bot) outer.rotation.x = Math.PI; // Unterseite gespiegelt
      outer.userData.comp = b.comp; outer.traverse(n => { n.userData.comp = b.comp; }); world.add(outer);
      const ms = []; outer.traverse(n => { if (n.isMesh) ms.push(n); }); compMeshes.set(b.comp, (compMeshes.get(b.comp) || []).concat(ms));
      if (R0.selDes && d.comps[b.comp]?.des === R0.selDes) ms.forEach(m => { m.material = PINK; }); R0.dirty = true; };
    const stepFail = [];
    // Platine sofort zeigen, Modelle streamen
    const sel = new THREE.Group(); scene.add(sel);
    const R0 = R = { dirty: true, world, pcb, H, renderer, scene, cam, ctl, box, compMeshes, sel, T, size: Math.max(w, h), buildFaces, running: true, side: 'oben', selDes: null };
    const resize = () => { const r = box.getBoundingClientRect(); if (!r.width || !r.height) return; renderer.setSize(r.width, r.height, false); cam.aspect = r.width / r.height; cam.updateProjectionMatrix(); if (R) R.dirty = true; };
    R.ro = new ResizeObserver(resize); R.ro.observe(box); resize();
    const span = Math.hypot(w, h); R.loop = () => { if (!R0.running || R !== R0) return; const moved = ctl.update();
      // Tiefenbereich an Abstand + Platinengröße anpassen (sonst Z-Fighting/Moiré bei großen Nutzen)
      const dist = cam.position.distanceTo(ctl.target), nr = Math.max(0.5, (dist - span) * 0.5, dist / 200), fr = dist + span * 2; if (Math.abs(cam.near - nr) > nr * 0.05 || Math.abs(cam.far - fr) > fr * 0.05) { cam.near = nr; cam.far = fr; cam.updateProjectionMatrix(); cam.userData.nf = true; }
      if (moved || R0.dirty || cam.userData.nf) { R0.dirty = false; cam.userData.nf = false; renderer.render(scene, cam); } requestAnimationFrame(R.loop); };
    R.world.visible = !H.hidden.has(950); this.setSide(H.side, true); R.loop(); R0.t = { platine: Math.round(performance.now() - T0) };
    if (stepJobs.length) { prog.classList.add('strom'); let done = 0; setP(`Lade 3D-Modelle … 0 von ${stepJobs.length}`, 0.2);
      const all = stepJobs.map(j => placeStep(j).catch(e => { console.warn(e); stepFail.push(d.comps[j[0].comp]?.des); has.delete(j[0].comp); }).then(() => { done++; setP(`Lade 3D-Modelle … ${done} von ${stepJobs.length}`, 0.2 + 0.8 * done / stepJobs.length); }));
      Promise.all(all).then(() => { R0.t.modelle = Math.round(performance.now() - T0); pcb.stepInfo = { ok: stepJobs.length - stepFail.length, fail: stepFail }; R0.modelsDone = true; prog.classList.add('fertig'); setTimeout(() => prog.remove(), 250); }); }
    else { R0.t.modelle = R0.t.platine; R0.modelsDone = true; prog.classList.add('fertig'); setTimeout(() => prog.remove(), 250); }
    // Klick = Auswahl
    let down = null; renderer.domElement.addEventListener('pointerdown', e => (down = { x: e.clientX, y: e.clientY }));
    renderer.domElement.addEventListener('pointerup', e => { if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; const r = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), cam);
      const hit = world.visible ? ray.intersectObjects(world.children, true)[0] : null; let des = hit ? d.comps[hit.object.userData.comp]?.des : null;
      if (!hit) { const f = ray.intersectObjects(faces.children)[0]; if (f && R.H.onPickAt) { R.H.onPickAt(f.point.x + ox, f.point.y + oy); return; } if (f) { const x = f.point.x + ox, y = -(f.point.y + oy); let best = null, ba = Infinity; pcb.boxes.forEach((b, i) => { if (b && x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2) { const a = (b.x2 - b.x1) * (b.y2 - b.y1); if (a < ba) { ba = a; best = d.comps[i].des; } } }); des = best; } }
      R.H.onPick(des); });
  },
  setSide(side, force) { if (!R) return; if (R.side === side && !force) return; R.side = side; const D = R.size * 2.4; R.cam.up.set(0, 1, 0);
    if (side === 'unten') R.cam.position.set(0, -D * 0.25, -D); else R.cam.position.set(0, -D * 0.25, D + R.T); R.ctl.target.set(0, 0, R.T / 2); R.cam.updateProjectionMatrix(); R.ctl.update(); R.dirty = true; },
  fit() { if (R) this.setSide(R.side, true); },
  theme() { if (!R || !R.scene) return; R.scene.background = new THREE.Color(document.documentElement.classList.contains('ist-dunkel') ? 0x000000 : 0xffffff); R.dirty = true; },
  select(des) { if (!R) return; const d = R.pcb.data; R.selDes = des;
    R.compMeshes.forEach((ms, i) => { const on = d.comps[i].des === des; ms.forEach(m => { if (!m.userData.m0) m.userData.m0 = m.material; m.material = on ? PINK : m.userData.m0; }); }); R.dirty = true; },
  async layers(hidden) { if (!R) return; R.H.hidden = hidden; R.world.visible = !hidden.has(950); R.sel.visible = R.world.visible; await R.buildFaces(); R.dirty = true; },
  stop() { if (R) R.running = false; }
};
