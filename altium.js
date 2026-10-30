// PCB Viewer – Altium-Parser (nur lesen): CFB/OLE-Container, SchDoc, PcbDoc
'use strict';
const Altium = (() => {
  // ---------- CFB ----------
  function cfb(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    if (dv.getUint32(0, true) !== 0xE011CFD0) throw new Error('Keine Altium-Binärdatei (OLE)');
    const ss = 1 << dv.getUint16(30, true), mss = 1 << dv.getUint16(32, true);
    const nFat = dv.getUint32(44, true), dirStart = dv.getUint32(48, true), cutoff = dv.getUint32(56, true);
    const miniFatStart = dv.getUint32(60, true), difStart = dv.getUint32(68, true);
    const off = s => (s + 1) * ss;
    const fatSecs = [];
    for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(76 + i * 4, true));
    let d = difStart;
    while (fatSecs.length < nFat && d < 0xFFFFFFFA) { const o = off(d); for (let i = 0; i < ss / 4 - 1 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(o + i * 4, true)); d = dv.getUint32(o + ss - 4, true); }
    const fat = []; for (const s of fatSecs) { const o = off(s); for (let i = 0; i < ss / 4; i++) fat.push(dv.getUint32(o + i * 4, true)); }
    const chain = (s, tab) => { const r = []; let g = 0; while (s < 0xFFFFFFFA && g++ < 1e6) { r.push(s); s = tab[s]; } return r; };
    const readBig = (s, size) => { const out = new Uint8Array(size); let p = 0; for (const c of chain(s, fat)) { const n = Math.min(ss, size - p); if (n <= 0) break; out.set(u8.subarray(off(c), off(c) + n), p); p += n; } return out; };
    const dirBytes = readBig(dirStart, chain(dirStart, fat).length * ss), ddv = new DataView(dirBytes.buffer);
    const ents = [];
    for (let o = 0; o + 128 <= dirBytes.length; o += 128) {
      const nl = ddv.getUint16(o + 64, true); let name = '';
      for (let i = 0; i < nl / 2 - 1; i++) name += String.fromCharCode(ddv.getUint16(o + i * 2, true));
      ents.push({ name, type: dirBytes[o + 66], l: ddv.getUint32(o + 68, true), r: ddv.getUint32(o + 72, true), c: ddv.getUint32(o + 76, true), start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true) });
    }
    const root = ents[0];
    const miniStream = readBig(root.start, root.size);
    const miniFat = []; if (miniFatStart < 0xFFFFFFFA) { const b = readBig(miniFatStart, chain(miniFatStart, fat).length * ss), v = new DataView(b.buffer); for (let i = 0; i < b.length / 4; i++) miniFat.push(v.getUint32(i * 4, true)); }
    const files = {};
    const walk = (i, path) => { if (i >= ents.length || i === 0xFFFFFFFF) return; const e = ents[i]; walk(e.l, path); walk(e.r, path);
      const p = path ? path + '/' + e.name : e.name;
      if (e.type === 2) files[p] = e; else if (e.type === 1) walk(e.c, p); };
    walk(root.c, '');
    return { list: () => Object.keys(files), get(p) { const e = files[p]; if (!e) return null;
      if (e.size < cutoff) { const out = new Uint8Array(e.size); let q = 0; for (const c of chain(e.start, miniFat)) { const n = Math.min(mss, e.size - q); if (n <= 0) break; out.set(miniStream.subarray(c * mss, c * mss + n), q); q += n; } return out; }
      return readBig(e.start, e.size); } };
  }
  const dec = new TextDecoder('windows-1252'), decU = new TextDecoder('utf-8');
  function props(bytes) {
    const s = dec.decode(bytes).replace(/\0+$/, ''), o = {};
    for (const part of s.split('|')) { const i = part.indexOf('='); if (i > 0) o[part.slice(0, i).toUpperCase()] = part.slice(i + 1); }
    for (const k in o) if (k.startsWith('%UTF8%')) { try { o[k.slice(6)] = decU.decode(Uint8Array.from(o[k], c => c.charCodeAt(0) & 255)); } catch (_) {} }
    return o;
  }
  // ---------- Schematic ----------
  function parseSch(buf) {
    const c = cfb(buf), d = c.get('FileHeader'); if (!d) throw new Error('SchDoc ohne FileHeader');
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength); let p = 0; const recs = [];
    while (p + 4 <= d.length) { const h = dv.getUint32(p, true), len = h & 0xFFFFFF, t = h >>> 24; const b = d.subarray(p + 4, p + 4 + len); p += 4 + len;
      if (t === 0) recs.push(props(b)); else if (t === 1 && b[0] === 2) recs.push(binPin(b)); else recs.push({}); }
    if (recs.length && recs[0].HEADER) recs.shift();
    return recs.map((r, i) => (r.__i = i, r));
  }
  function binPin(b) { // binärer Pin (neuere Versionen) – Grundfelder
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let p = 1; const o = { RECORD: '2' };
    o.OWNERPARTID = String(v.getInt16(p + 4, true)); p += 6; p += 1; o.ELECTRICAL = String(b[p++]); o.PINCONGLOMERATE = String(b[p++]); o.PINLENGTH = String(v.getInt16(p, true)); p += 2;
    o['LOCATION.X'] = String(v.getInt16(p, true)); o['LOCATION.Y'] = String(v.getInt16(p + 2, true)); p += 4; p += 4;
    const str = () => { const n = b[p++]; const s = dec.decode(b.subarray(p, p + n)); p += n; return s; };
    try { o.NAME = str(); o.DESIGNATOR = str(); } catch (_) {}
    o.BINARY = true; return o;
  }
  // ---------- PCB ----------
  function parsePcb(buf) {
    const c = cfb(buf), get = n => c.get(n + '/Data') || new Uint8Array(0);
    const I = 1e4; // interne Einheit -> mil
    const textRecs = d => { const out = []; const v = new DataView(d.buffer, d.byteOffset, d.byteLength); let p = 0; while (p + 4 <= d.length) { const l = v.getUint32(p, true); out.push(props(d.subarray(p + 4, p + 4 + l))); p += 4 + l; } return out; };
    const mil = s => parseFloat(String(s || '0')) || 0;
    const board = textRecs(get('Board6'))[0] || {};
    const outline = []; for (let i = 0; board['VX' + i] !== undefined; i++) outline.push({ k: +board['KIND' + i], x: mil(board['VX' + i]), y: mil(board['VY' + i]), cx: mil(board['CX' + i]), cy: mil(board['CY' + i]), r: mil(board['R' + i]), sa: +board['SA' + i], ea: +board['EA' + i] });
    const layerNames = {}; for (let i = 1; i <= 82; i++) if (board['LAYER' + i + 'NAME']) layerNames[i] = board['LAYER' + i + 'NAME'];
    const comps = textRecs(get('Components6')).map((r, i) => ({ i, des: r.SOURCEDESIGNATOR || ('#' + i), layer: r.LAYER, x: mil(r.X), y: mil(r.Y), rot: mil(r.ROTATION), heightRaw: r.HEIGHT, pattern: r.PATTERN, desc: r.SOURCEDESCRIPTION || r.FOOTPRINTDESCRIPTION || '', lib: r.SOURCELIBREFERENCE || '', nameOn: r.NAMEON !== 'FALSE', commentOn: r.COMMENTON === 'TRUE' }));
    const nets = textRecs(get('Nets6')).map(r => r.NAME);
    const polys = textRecs(get('Polygons6'));
    const binRecs = (d, fn) => { const out = []; const v = new DataView(d.buffer, d.byteOffset, d.byteLength); let p = 0; while (p + 5 <= d.length) { const t = d[p]; const st = p; try { p = fn(v, p, out, t); } catch (e) { console.warn(e); break; } if (p <= st) break; } return out; };
    const sub = (v, p) => { const l = v.getUint32(p, true); return [p + 4, l]; };
    const u16 = (v, o) => { const x = v.getUint16(o, true); return x === 0xFFFF ? -1 : x; };
    const tracks = binRecs(get('Tracks6'), (v, p, out) => { const [o, l] = sub(v, p + 1);
      out.push({ layer: v.getUint8(o), net: u16(v, o + 3), comp: u16(v, o + 7), x1: v.getInt32(o + 13, true) / I, y1: v.getInt32(o + 17, true) / I, x2: v.getInt32(o + 21, true) / I, y2: v.getInt32(o + 25, true) / I, w: v.getInt32(o + 29, true) / I }); return o + l; });
    const arcs = binRecs(get('Arcs6'), (v, p, out) => { const [o, l] = sub(v, p + 1);
      out.push({ layer: v.getUint8(o), net: u16(v, o + 3), comp: u16(v, o + 7), cx: v.getInt32(o + 13, true) / I, cy: v.getInt32(o + 17, true) / I, r: v.getInt32(o + 21, true) / I, sa: v.getFloat64(o + 25, true), ea: v.getFloat64(o + 33, true), w: v.getInt32(o + 41, true) / I }); return o + l; });
    const fills = binRecs(get('Fills6'), (v, p, out) => { const [o, l] = sub(v, p + 1);
      out.push({ layer: v.getUint8(o), net: u16(v, o + 3), comp: u16(v, o + 7), x1: v.getInt32(o + 13, true) / I, y1: v.getInt32(o + 17, true) / I, x2: v.getInt32(o + 21, true) / I, y2: v.getInt32(o + 25, true) / I, rot: v.getFloat64(o + 29, true) }); return o + l; });
    const vias = binRecs(get('Vias6'), (v, p, out) => { const [o, l] = sub(v, p + 1);
      out.push({ layer: 74, net: u16(v, o + 3), comp: -1, x: v.getInt32(o + 13, true) / I, y: v.getInt32(o + 17, true) / I, d: v.getInt32(o + 21, true) / I, hole: v.getInt32(o + 25, true) / I }); return o + l; });
    const pads = binRecs(get('Pads6'), (v, p, out) => { p += 1; let [o, l] = sub(v, p); const n = v.getUint8(o); const name = dec.decode(new Uint8Array(v.buffer, v.byteOffset + o + 1, n)); p = o + l;
      for (let k = 0; k < 3; k++) { [o, l] = sub(v, p); p = o + l; }
      [o, l] = sub(v, p); p = o + l;
      const pad = { name, layer: v.getUint8(o), net: u16(v, o + 3), comp: u16(v, o + 7), x: v.getInt32(o + 13, true) / I, y: v.getInt32(o + 17, true) / I,
        sx: v.getInt32(o + 21, true) / I, sy: v.getInt32(o + 25, true) / I, bx: v.getInt32(o + 37, true) / I, by: v.getInt32(o + 41, true) / I, hole: v.getInt32(o + 45, true) / I,
        shape: v.getUint8(o + 49), bshape: v.getUint8(o + 51), rot: v.getFloat64(o + 52, true), plated: v.getUint8(o + 60) };
      [o, l] = sub(v, p); p = o + l;
      if (l >= 596) { const q = o + 29 * 8 + 29 + 1 + 1 + 4 + 8 + 32 * 8 + 1; // KiCad APAD6_SIZE_AND_SHAPE
        const alt = [...new Uint8Array(v.buffer, v.byteOffset + q, 32)], cr = [...new Uint8Array(v.buffer, v.byteOffset + q + 32, 32)];
        if (alt[0] === 9) { pad.shape = 9; pad.cr = cr[0]; } if (alt[31] === 9) { pad.bshape = 9; pad.bcr = cr[31]; } }
      out.push(pad); return p; });
    const texts = binRecs(get('Texts6'), (v, p, out) => { let [o, l] = sub(v, p + 1); const t = { layer: v.getUint8(o), comp: u16(v, o + 7), x: v.getInt32(o + 13, true) / I, y: v.getInt32(o + 17, true) / I, h: v.getInt32(o + 21, true) / I, rot: v.getFloat64(o + 27, true), mirror: v.getUint8(o + 35) !== 0, sw: v.getInt32(o + 36, true) / I, isComment: l >= 123 && v.getUint8(o + 40) !== 0, isDesignator: l >= 123 && v.getUint8(o + 41) !== 0, stroke: l < 123 || v.getUint8(o + 43) === 0, sfont: v.getUint16(o + 25, true), bold: l >= 123 && v.getUint8(o + 44) !== 0, italic: l >= 123 && v.getUint8(o + 45) !== 0, font: l >= 123 ? new TextDecoder('utf-16le').decode(new Uint8Array(v.buffer, v.byteOffset + o + 46, 64)).split('\0')[0] : '' };
      p = o + l; [o, l] = sub(v, p); const n = v.getUint8(o); t.text = dec.decode(new Uint8Array(v.buffer, v.byteOffset + o + 1, Math.min(n, l - 1))); out.push(t); return o + l; });
    const regionRecs = (name, shape) => binRecs(get(name), (v, p, out) => { const [o, l] = sub(v, p + 1); const end = o + l;
      const r = { layer: v.getUint8(o), net: u16(v, o + 3), poly: u16(v, o + 5), comp: u16(v, o + 7), holes: [] }; const holeCount = v.getUint16(o + 14, true);
      const pl = v.getUint32(o + 18, true); const pr = props(new Uint8Array(v.buffer, v.byteOffset + o + 22, pl)); r.kind = +(pr.KIND || 0); r.p = pr; if (pr.V7_LAYER) r.layerName = pr.V7_LAYER;
      let q = o + 22 + pl; const n = v.getUint32(q, true); q += 4; r.pts = [];
      if (shape) { for (let i = 0; i <= n && q + 37 <= end; i++, q += 37) r.pts.push({ round: v.getUint8(q), x: v.getInt32(q + 1, true) / I, y: v.getInt32(q + 5, true) / I, cx: v.getInt32(q + 9, true) / I, cy: v.getInt32(q + 13, true) / I, r: v.getInt32(q + 17, true) / I, sa: v.getFloat64(q + 21, true), ea: v.getFloat64(q + 29, true) }); }
      else { for (let i = 0; i < n && q + 16 <= end; i++, q += 16) r.pts.push({ x: v.getFloat64(q, true) / I, y: v.getFloat64(q + 8, true) / I }); }
      for (let h = 0; h < holeCount && q + 4 <= end; h++) { const m = v.getUint32(q, true); q += 4; const hp = []; for (let i = 0; i < m && q + 16 <= end; i++, q += 16) hp.push({ x: v.getFloat64(q, true) / I, y: v.getFloat64(q + 8, true) / I }); r.holes.push(hp); }
      out.push(r); return end; });
    let regions = regionRecs('ShapeBasedRegions6', true); const regions6 = regionRecs('Regions6', false);
    // Regions6 enthält u. a. Bauteil-Regionen, ShapeBased die Polygon-Flächen: beide zeigen, Duplikate über Polygon-Index vermeiden
    const polyInSB = new Set(regions.filter(r => r.poly >= 0).map(r => r.poly));
    regions = regions.concat(regions6.filter(r => !(r.poly >= 0 && polyInSB.has(r.poly))));
    regions.forEach(r => { if (r.net < 0 && r.poly >= 0 && polys[r.poly] && polys[r.poly].NET !== undefined && polys[r.poly].NET !== '') { const n = +polys[r.poly].NET; if (n >= 0 && n < 65535) r.net = n; } });
    const bodies = regionRecs('ComponentBodies6', false).map(b => b);
    const models = textRecs(c.get('Models/Data') || new Uint8Array(0)).map((m, k) => ({ id: m.ID, name: m.NAME, checksum: m.CHECKSUM, rotx: +m.ROTX || 0, roty: +m.ROTY || 0, rotz: +m.ROTZ || 0, dz: (+m.DZ || 0) / I, raw: c.get('Models/' + k) }));
    const embedded = (c.get('EmbeddedBoards6/Data') ? textRecs(get('EmbeddedBoards6')) : []).map(e => ({ doc: e.DOCUMENTPATH || '', x1: parseFloat(e.X1) || 0, y1: parseFloat(e.Y1) || 0, x2: parseFloat(e.X2) || 0, y2: parseFloat(e.Y2) || 0, rows: +e.ROWCOUNT || 1, rot: parseFloat(e.ROTATION) || 0, mirror: e.MIRROR === 'TRUE', cols: +e.COLCOUNT || 1, rs: parseFloat(e.ROWSPACING) || 0, cs: parseFloat(e.COLSPACING) || 0 }));
    return { embedded, models, bodies, board, outline, layerNames, comps, nets, polys, tracks, arcs, fills, vias, pads, texts, regions };
  }
  return { cfb, parseSch, parsePcb, props };
})();
