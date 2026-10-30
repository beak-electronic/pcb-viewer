// PCB Viewer – STEP-Konvertierung im Web Worker (occt-import-js, offline). Ergebnis: je Farbe ein zusammengeführtes Netz (Float32/Uint32, übertragen).
importScripts('./occt-import-js.js');
let occtP = null, wasmMod = null;
const occt = () => occtP || (occtP = self.occtimportjs(wasmMod ? { instantiateWasm: (imports, ok) => { WebAssembly.instantiate(wasmMod, imports).then(inst => ok(inst)); return {}; } } : { locateFile: f => './' + f }));
async function inflate(raw) { try { return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()); } catch (_) { return raw; } }
function merge(res) { // nach Farbe gruppieren, Dreiecke zusammenführen
  const by = new Map();
  for (const m of res.meshes) {
    const P = m.attributes.position.array, N = m.attributes.normal ? m.attributes.normal.array : null, I = m.index.array, base = m.color ? m.color.join(',') : '0.6,0.6,0.6';
    const faceCol = new Array(I.length / 3).fill(base);
    if (m.brep_faces) for (const f of m.brep_faces) if (f.color) for (let t = f.first; t <= f.last; t++) faceCol[t] = f.color.join(',');
    const local = new Map();
    for (let t = 0; t < I.length / 3; t++) { const k = faceCol[t]; let e = by.get(k); if (!e) by.set(k, e = { pos: [], nrm: [], idx: [], hasN: !!N }); let lm = local.get(k); if (!lm) local.set(k, lm = new Map());
      for (let c = 0; c < 3; c++) { const v = I[t * 3 + c]; let ni = lm.get(v); if (ni === undefined) { ni = e.pos.length / 3; lm.set(v, ni); e.pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); if (N) e.nrm.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]); else e.hasN = false; } e.idx.push(ni); } }
  }
  const parts = [], tr = [];
  for (const [k, e] of by) { const pos = new Float32Array(e.pos), idx = new Uint32Array(e.idx), nrm = e.hasN ? new Float32Array(e.nrm) : null; parts.push({ color: k.split(',').map(Number), pos, nrm, idx }); tr.push(pos.buffer, idx.buffer); if (nrm) tr.push(nrm.buffer); }
  return { parts, tr };
}
self.onmessage = async ev => { if (ev.data.mod) { wasmMod = ev.data.mod; occt(); return; } const { id, raw, params } = ev.data;
  try { const oc = await occt(); if (!raw) return self.postMessage({ id, ok: true });
    const t0 = performance.now(); const res = oc.ReadStepFile(await inflate(raw), params);
    if (!res || !res.success) throw new Error('STEP nicht lesbar');
    const { parts, tr } = merge(res); self.postMessage({ id, ok: true, parts, ms: performance.now() - t0 }, tr);
  } catch (e) { self.postMessage({ id, ok: false, err: String(e && e.message || e) }); } };
