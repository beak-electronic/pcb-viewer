// PCB Viewer – Anzeige von Altium Schaltplan + Leiterplatte (nur lesen)
'use strict';
const noExt = n => String(n || '').replace(/\.(schdoc|pcbdoc|prjpcb|zip)$/i, '');
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const bgr = c => { c = +c || 0; return '#' + [c & 255, c >> 8 & 255, c >> 16 & 255].map(v => v.toString(16).padStart(2, '0')).join(''); };
const f2 = v => Math.round(v * 1000) / 1000;
const S = { sheets: [], sheet: 0, pcb: null, prj: null, sel: null, dim: '2d', side: 'oben', hidden: new Set([35, 36, 37, 38]) };

// ---------------- Pan/Zoom ----------------
class Pan {
  constructor(svg, onClick) {
    this.svg = svg; this.vb = { x: 0, y: 0, w: 100, h: 100 }; this.bb = null; this.onClick = onClick; this.pts = new Map();
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.addEventListener('wheel', e => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))); }, { passive: false });
    svg.addEventListener('pointerdown', e => { svg.setPointerCapture(e.pointerId); this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.start = { x: e.clientX, y: e.clientY, moved: false, multi: this.pts.size > 1 }; this.pinch = null; });
    svg.addEventListener('pointermove', e => {
      const p = this.pts.get(e.pointerId); if (!p) return;
      if (this.pts.size === 1) { const k = this.k(); this.vb.x -= (e.clientX - p.x) * k; this.vb.y -= (e.clientY - p.y) * k; this.apply(); }
      else if (this.pts.size === 2) { const [a, b] = [...this.pts.values()]; const d0 = Math.hypot(a.x - b.x, a.y - b.y); p.x = e.clientX; p.y = e.clientY;
        const [c, d] = [...this.pts.values()]; const d1 = Math.hypot(c.x - d.x, c.y - d.y); if (d0 > 0) this.zoomAt((c.x + d.x) / 2, (c.y + d.y) / 2, d0 / d1); }
      p.x = e.clientX; p.y = e.clientY;
      if (this.start && Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y) > 5) { this.start.moved = true; svg.classList.add('zieht'); }
    });
    const up = e => { if (!this.pts.has(e.pointerId)) return; this.pts.delete(e.pointerId); svg.classList.remove('zieht');
      if (e.type === 'pointerup' && this.start && !this.start.moved && !this.start.multi && this.pts.size === 0) this.onClick(this.toData(e.clientX, e.clientY)); if (!this.pts.size) this.start = null; };
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
    svg.addEventListener('dblclick', () => this.fit());
    new ResizeObserver(() => this.resize()).observe(svg);
  }
  rect() { return this.svg.getBoundingClientRect(); }
  k() { const r = this.rect(); return r.width ? this.vb.w / r.width : 1; }
  apply() { this.prevW = this.rect().width; if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; const v = this.vb; this.svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`); }); }
  toData(cx, cy) { const r = this.rect(), k = this.k(); return { x: this.vb.x + (cx - r.left) * k, y: this.vb.y + (cy - r.top) * k }; }
  zoomAt(cx, cy, f) { const p = this.toData(cx, cy); const k = this.k() * f; if (k <= 0) return; const r = this.rect();
    this.vb.w = r.width * k; this.vb.h = r.height * k; this.vb.x = p.x - (cx - r.left) * k; this.vb.y = p.y - (cy - r.top) * k; this.apply(); }
  set(bb) { this.bb = bb; this.fit(); }
  fit() { const r = this.rect(), b = this.bb; if (!b || !r.width || !r.height) return; const m = 0.04;
    const k = Math.max((b.x2 - b.x1) * (1 + 2 * m) / r.width, (b.y2 - b.y1) * (1 + 2 * m) / r.height) || 1;
    this.vb = { w: r.width * k, h: r.height * k }; this.vb.x = (b.x1 + b.x2) / 2 - this.vb.w / 2; this.vb.y = (b.y1 + b.y2) / 2 - this.vb.h / 2; this.apply(); }
  ensure(b) { // nur verschieben, wenn nicht vollständig sichtbar – minimal, mit Rand
    const v = this.vb, mx = Math.min(v.w * 0.06, Math.max(0, (v.w - (b.x2 - b.x1)) / 2)), my = Math.min(v.h * 0.06, Math.max(0, (v.h - (b.y2 - b.y1)) / 2));
    let dx = 0, dy = 0;
    if (b.x1 < v.x) dx = b.x1 - mx - v.x; else if (b.x2 > v.x + v.w) dx = b.x2 + mx - (v.x + v.w);
    if (b.y1 < v.y) dy = b.y1 - my - v.y; else if (b.y2 > v.y + v.h) dy = b.y2 + my - (v.y + v.h);
    if (dx || dy) { v.x += dx; v.y += dy; } this.apply(); }
  center(b) { this.vb.x = (b.x1 + b.x2) / 2 - this.vb.w / 2; this.vb.y = (b.y1 + b.y2) / 2 - this.vb.h / 2; this.apply(); }
  show(b) { // Bauteil sichtbar machen: Zoom halten, nur verschieben; bei zu klein / zu groß anpassen
    const v = this.vb, bw = b.x2 - b.x1, bh = b.y2 - b.y1;
    if (bw > v.w * 0.9 || bh > v.h * 0.9) { const r = this.rect(); const k = Math.max(bw * 1.6 / r.width, bh * 1.6 / r.height); this.vb.w = r.width * k; this.vb.h = r.height * k; this.center(b); return; }
    this.ensure(b); }
  resize() { const r = this.rect(); if (!r.width || !r.height) return;
    if (!this.inited) { this.inited = true; return this.fit(); }
    const k = this.prevW ? this.vb.w / this.prevW : this.k(); const cx = this.vb.x + this.vb.w / 2, cy = this.vb.y + this.vb.h / 2;
    this.vb.w = r.width * k; this.vb.h = r.height * k; this.vb.x = cx - this.vb.w / 2; this.vb.y = cy - this.vb.h / 2;
    const sb = this.selBox && this.selBox(); if (sb) this.ensure(sb); else this.apply(); }
}

// ---------------- Schaltplan ----------------
const LW = [0.4, 1, 3, 5];
function renderSch(recs) {
  const sheet = recs[0] || {}, fonts = {};
  for (let i = 1; i <= +(sheet.FONTIDCOUNT || 0); i++) fonts[i] = { name: sheet['FONTNAME' + i] || 'Arial', size: +(sheet['SIZE' + i] || 10), bold: sheet['BOLD' + i] === 'T', italic: sheet['ITALIC' + i] === 'T' };
  const N = (r, k) => (+(r[k] || 0)) + (+(r[k + '_FRAC'] || 0)) / 1e5;
  const docParams = {}; recs.forEach(r => { if (r.RECORD === '41' && r.OWNERINDEX === undefined && r.NAME) docParams[r.NAME.toUpperCase()] = r.TEXT; });
  const special = t => { if (!t || t[0] !== '=') return t; const k = t.slice(1).toUpperCase();
    if (k === 'CURRENTDATE') return new Date().toLocaleDateString('de-DE'); if (k === 'CURRENTTIME') return new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return docParams[k] ?? t; };
  const ownerComp = r => { let o = r, g = 0; while (o && o.OWNERINDEX !== undefined && g++ < 20) { const p = recs[+o.OWNERINDEX]; if (!p) return null; if (p.RECORD === '1') return p; o = p; } return null; };
  const comps = {}; // des -> info
  const compOf = new Map();
  recs.forEach(r => { if (r.RECORD === '1') compOf.set(r.__i, { rec: r, des: null, els: [], bb: null, params: {}, model: '' }); });
  recs.forEach(r => { if (r.RECORD === '34' && compOf.has(+r.OWNERINDEX)) compOf.get(+r.OWNERINDEX).des = r.TEXT;
    if (r.RECORD === '41' && compOf.has(+r.OWNERINDEX) && r.NAME) compOf.get(+r.OWNERINDEX).params[r.NAME] = r.TEXT;
    if (r.RECORD === '45' && r.MODELTYPE === 'PCBLIB' && (r.ISCURRENT === 'T' || 1)) { const c = ownerComp(r); if (c && (!compOf.get(c.__i).model || r.ISCURRENT === 'T')) compOf.get(c.__i).model = r.MODELNAME; } });
  const items = []; const W = it => { items.push(it); return ` data-w="${items.length - 1}"`; };
  const under = [], over = [], all = { x1: 1e9, y1: 1e9, x2: -1e9, y2: -1e9 };
  const ext = (b, x, y) => { if (x < b.x1) b.x1 = x; if (y < b.y1) b.y1 = y; if (x > b.x2) b.x2 = x; if (y > b.y2) b.y2 = y; };
  const txt = (x, y, s, r, cls = '') => { const f = fonts[+r.FONTID] || { name: 'Arial', size: 10 }; const o = (+r.ORIENTATION || 0) & 3, j = +(r.JUSTIFICATION || 0);
    let jh = j % 3, jv = Math.floor(j / 3) % 3, oo = o; if (o >= 2) { oo = o - 2; jh = 2 - jh; jv = 2 - jv; } // 180°: lesbar wie in Altium
    const anc = ['start', 'middle', 'end'][jh], base = ['auto', 'central', 'hanging'][jv];
    return `<text class="f ${cls}" x="${f2(x)}" y="${f2(-y)}" font-family="${esc(f.name)}, Arial, sans-serif" font-size="${f.size * 0.88}"${f.bold ? ' font-weight="700"' : ''}${f.italic ? ' font-style="italic"' : ''} text-anchor="${anc}" dominant-baseline="${base}" fill="${bgr(r.COLOR)}"${oo ? ` transform="rotate(${-90 * oo} ${f2(x)} ${f2(-y)})"` : ''}>${esc(s)}</text>`; };
  const pts = r => { const a = []; for (let i = 1; i <= +(r.LOCATIONCOUNT || 0); i++) a.push([N(r, 'X' + i), N(r, 'Y' + i)]); return a; };
  const pl = a => a.map(p => `${f2(p[0])},${f2(-p[1])}`).join(' ');
  // Blattrahmen/Schriftfeld weglassen: alles unter einem Template-Record (39) und freie Grafik/Texte im Schriftfeldbereich unten rechts
  const inTmpl = r => { let o = r, g = 0; while (o && o.OWNERINDEX !== undefined && g++ < 20) { const p = recs[+o.OWNERINDEX]; if (!p) return false; if (p.RECORD === '39') return true; o = p; } return false; };
  const SW = { 0: 1150, 1: 1550, 2: 2230, 3: 3150, 4: 4460, 5: 950, 6: 1500, 7: 2000, 8: 3200, 9: 4200, 10: 1100, 11: 1400, 12: 1700, 13: 990, 14: 1540, 15: 2060, 16: 3030, 17: 4280 };
  const sheetW = sheet.USECUSTOMSHEET === 'T' ? +sheet.CUSTOMX || 1150 : SW[+(sheet.SHEETSTYLE || 0)] || 1150;
  const freeTB = r => r.OWNERINDEX === undefined && [3, 4, 6, 8, 10, 11, 12, 13, 14, 28, 30].includes(+r.RECORD) && N(r, 'LOCATION.X') > sheetW - 420 && N(r, 'LOCATION.Y') < 130 && (r.CORNER === undefined || N(r, 'CORNER.Y') < 130);
  const wireCol = bgr((recs.find(r => r.RECORD === '27') || {}).COLOR || '8388608'); // Junctions in Drahtfarbe wie Altium-Anzeige
  for (const r of recs) {
    const t = +r.RECORD; if (!t || t === 31 || t === 39 || inTmpl(r) || freeTB(r)) continue;
    const comp = ownerComp(r), ci = comp && compOf.get(comp.__i);
    if (comp) { if (+r.OWNERPARTID > 0 && +r.OWNERPARTID !== +(comp.CURRENTPARTID || 1)) continue; if ((+r.OWNERPARTDISPLAYMODE || 0) !== (+comp.DISPLAYMODE || 0)) continue; }
    const col = bgr(r.COLOR), w = LW[+(r.LINEWIDTH || 0)] ?? 1, fillc = bgr(r.AREACOLOR), solid = r.ISSOLID === 'T' && r.TRANSPARENT !== 'T';
    const x = N(r, 'LOCATION.X'), y = N(r, 'LOCATION.Y'), cx = N(r, 'CORNER.X'), cy = N(r, 'CORNER.Y');
    const geo = [], out = []; const dc = ci ? ` data-c="${comp.__i}"` : '';
    const S_ = (el, a = '') => out.push(`<${el} class="s"${dc} fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${a}/>`);
    switch (t) {
      case 2: { if (+r.PINCONGLOMERATE & 4) break; const rot = +r.PINCONGLOMERATE & 3, L = N(r, 'PINLENGTH'), d = [[1, 0], [0, 1], [-1, 0], [0, -1]][rot];
        const ex = x + d[0] * L, ey = y + d[1] * L; geo.push([x, y], [ex, ey]);
        const dot = r.SYMBOL_OUTEREDGE === '1', x0 = dot ? x + d[0] * 6 : x, y0 = dot ? y + d[1] * 6 : y;
        if (dot) out.push(`<circle class="s"${dc} cx="${f2(x + d[0] * 3)}" cy="${f2(-(y + d[1] * 3))}" r="3" fill="none" stroke="#000080" stroke-width="0.6"/>`);
        out.push(`<line class="s"${dc}${W({ pt: [ex, ey], key: ci && ci.des ? ci.des + ':' + (r.DESIGNATOR || '') : null })} x1="${f2(x0)}" y1="${f2(-y0)}" x2="${f2(ex)}" y2="${f2(-ey)}" stroke="${col}" stroke-width="1"/>`);
        const fz = 8, mx = x + d[0] * Math.min(8, Math.max(L / 2, L - 3)) + (dot ? d[0] * 2 : 0), my = y + d[1] * Math.min(8, Math.max(L / 2, L - 3)) + (dot ? d[1] * 2 : 0), vert = rot & 1;
        if (+r.PINCONGLOMERATE & 16 && r.DESIGNATOR) out.push(`<text class="f pin"${dc} x="${f2(mx + (vert ? -1.5 : 0))}" y="${f2(-my - (vert ? 0 : 1.5))}" font-size="${fz}" font-family="${esc((fonts[1] || {}).name || 'Times New Roman')}, Times New Roman, serif" text-anchor="middle" fill="${col}"${vert ? ` transform="rotate(-90 ${f2(mx - 1.5)} ${f2(-my)})"` : ''}>${esc(r.DESIGNATOR)}</text>`);
        if (+r.PINCONGLOMERATE & 8 && r.NAME) { const nx = x - d[0] * 3, ny = y - d[1] * 3; const anc = rot === 0 || rot === 1 ? 'end' : 'start';
          out.push(`<text class="f pin"${dc} x="${f2(nx)}" y="${f2(-ny)}" font-size="${fz + 1}" font-family="Arial" text-anchor="${anc}" dominant-baseline="central" fill="#000"${vert ? ` transform="rotate(-90 ${f2(nx)} ${f2(-ny)})"` : ''}>${esc(r.NAME.replace(/\\/g, ''))}</text>`); }
        break; }
      case 4: if (r.TEXT) out.push(txt(x, y, special(r.TEXT), r)); break;
      case 34: case 41: if (r.ISHIDDEN !== 'T' && r.TEXT && !(t === 41 && r.NAME === 'PinUniqueId')) { let s = r.TEXT; if (s[0] === '=' && ci) s = ci.params[s.slice(1)] ?? s; out.push(txt(x, y, special(s), r, t === 34 ? 'des' : '').replace('<text class="f', `<text${dc} class="f`)); } break;
      case 5: case 6: { const a = pts(r); a.forEach(p => geo.push(p)); S_('polyline', `points="${pl(a)}"`); break; }
      case 7: { const a = pts(r); a.forEach(p => geo.push(p)); out.push(`<polygon class="${r.ISSOLID === 'T' ? 'f ' : ''}s"${dc} points="${pl(a)}" fill="${r.ISSOLID === 'T' ? fillc : 'none'}" stroke="${col}" stroke-width="${w}"/>`); break; }
      case 8: { const rx = N(r, 'RADIUS'), ry = N(r, 'SECONDARYRADIUS') || rx; geo.push([x - rx, y - ry], [x + rx, y + ry]);
        out.push(`<ellipse class="s${solid ? ' f' : ''}"${dc} cx="${f2(x)}" cy="${f2(-y)}" rx="${rx}" ry="${ry}" fill="${solid ? fillc : 'none'}" stroke="${col}" stroke-width="${w}"/>`); break; }
      case 11: case 12: { const rr = N(r, 'RADIUS'), ry = t === 11 ? (N(r, 'SECONDARYRADIUS') || rr) : rr, sa = +(r.STARTANGLE || 0), ea = +(r.ENDANGLE ?? 360);
        let sw = ((ea - sa) % 360 + 360) % 360; if (sw === 0) sw = 360; geo.push([x - rr, y - ry], [x + rr, y + ry]);
        if (sw >= 359.99) { out.push(`<ellipse class="s"${dc} cx="${f2(x)}" cy="${f2(-y)}" rx="${rr}" ry="${ry}" fill="none" stroke="${col}" stroke-width="${w}"/>`); break; }
        const p1 = [x + rr * Math.cos(sa * Math.PI / 180), y + ry * Math.sin(sa * Math.PI / 180)], p2 = [x + rr * Math.cos(ea * Math.PI / 180), y + ry * Math.sin(ea * Math.PI / 180)];
        S_('path', `d="M${f2(p1[0])},${f2(-p1[1])} A${rr},${ry} 0 ${sw > 180 ? 1 : 0} 0 ${f2(p2[0])},${f2(-p2[1])}"`); break; }
      case 10: case 14: { const X1 = Math.min(x, cx), Y1 = Math.max(y, cy), W = Math.abs(cx - x), H = Math.abs(cy - y); geo.push([x, y], [cx, cy]);
        const rad = t === 10 ? ` rx="${N(r, 'CORNERXRADIUS')}" ry="${N(r, 'CORNERYRADIUS')}"` : '';
        const el = `<rect class="s${solid ? ' f' : ''}"${dc} x="${f2(X1)}" y="${f2(-Y1)}" width="${f2(W)}" height="${f2(H)}"${rad} fill="${solid ? fillc : 'none'}" stroke="${col}" stroke-width="${w}"/>`;
        if (!comp && solid) { under.push(el); continue; } out.push(el); break; }
      case 13: geo.push([x, y], [cx, cy]); S_('line', `x1="${f2(x)}" y1="${f2(-y)}" x2="${f2(cx)}" y2="${f2(-cy)}"`); break;
      case 37: S_('line', `x1="${f2(x)}" y1="${f2(-y)}" x2="${f2(cx)}" y2="${f2(-cy)}"`); break;
      case 26: case 27: { const a = pts(r); out.push(`<polyline class="s"${t === 27 ? W({ segs: a }) : ''} points="${pl(a)}" fill="none" stroke="${col}" stroke-width="${t === 26 ? 3 : w}" stroke-linejoin="round" stroke-linecap="round"/>`); break; }
      case 29: out.push(`<circle class="f"${W({ pt: [x, y] })} cx="${f2(x)}" cy="${f2(-y)}" r="2.2" fill="${wireCol}"/>`); break;
      case 22: out.push(`<path d="M${x - 3},${-y - 3}l6,6m0,-6l-6,6" stroke="#F00" stroke-width="1"/>`); break;
      case 25: out.push(txt(x, y, r.TEXT, r).replace('<text class="f', `<text${W({ pt: [x, y], name: r.TEXT })} class="f`)); break;
      case 17: { const o = (+r.ORIENTATION || 0) & 3, d = [[1, 0], [0, 1], [-1, 0], [0, -1]][o], st = +(r.STYLE || 0); const ex = x + d[0] * 10, ey = y + d[1] * 10, px = -d[1], py = d[0];
        let g = `<line x1="${f2(x)}" y1="${f2(-y)}" x2="${f2(ex)}" y2="${f2(-ey)}" stroke="${col}" stroke-width="1"/>`;
        if (st >= 4) { for (let i = 0; i < 3; i++) { const l = 7 - i * 2.5, bx = ex + d[0] * i * 2.5, by = ey + d[1] * i * 2.5; g += `<line x1="${f2(bx + px * l)}" y1="${f2(-(by + py * l))}" x2="${f2(bx - px * l)}" y2="${f2(-(by - py * l))}" stroke="${col}" stroke-width="1"/>`; } }
        else if (st === 0) g += `<circle cx="${f2(ex + d[0] * 2)}" cy="${f2(-(ey + d[1] * 2))}" r="2" fill="none" stroke="${col}"/>`;
        else g += `<line x1="${f2(ex + px * 6)}" y1="${f2(-(ey + py * 6))}" x2="${f2(ex - px * 6)}" y2="${f2(-(ey - py * 6))}" stroke="${col}" stroke-width="1.5"/>`;
        out.push(`<g class="pp"${W({ pt: [x, y], name: r.TEXT })}>` + g); if (r.SHOWNETNAME !== 'F' && st < 4) { const tx = ex + d[0] * 8, ty = ey + d[1] * 8; out.push(`<text class="f" x="${f2(tx)}" y="${f2(-ty)}" font-size="8" font-family="Arial" text-anchor="middle" dominant-baseline="central" fill="${col}">${esc(r.TEXT)}</text>`); } out.push('</g>'); break; }
      case 18: { const W_ = W({ pt: [x, y], name: r.NAME }), W = N(r, 'WIDTH') || 40, H = N(r, 'HEIGHT') || 10; out.push(`<polygon class="s"${W_} points="${f2(x)},${f2(-y)} ${f2(x + 5)},${f2(-y - H / 2)} ${f2(x + W)},${f2(-y - H / 2)} ${f2(x + W)},${f2(-y + H / 2)} ${f2(x + 5)},${f2(-y + H / 2)}" fill="${fillc}" stroke="${col}" stroke-width="1"/>`, `<text x="${f2(x + W / 2)}" y="${f2(-y)}" font-size="7" font-family="Arial" text-anchor="middle" dominant-baseline="central" fill="${bgr(r.TEXTCOLOR)}">${esc(r.NAME)}</text>`); break; }
      case 15: { const W = N(r, 'XSIZE'), H = N(r, 'YSIZE'); out.push(`<rect x="${f2(x)}" y="${f2(-y)}" width="${W}" height="${H}" fill="${fillc}" stroke="${col}"/>`); break; }
      case 28: { const X1 = Math.min(x, cx), Y1 = Math.max(y, cy); out.push(`<rect x="${f2(X1)}" y="${f2(-Y1)}" width="${f2(Math.abs(cx - x))}" height="${f2(Math.abs(cy - y))}" fill="${r.ISSOLID === 'T' ? fillc : 'none'}" stroke="${r.SHOWBORDER === 'T' ? col : 'none'}"/>`);
        (r.TEXT || '').split('~1').forEach((s, i) => out.push(`<text x="${f2(X1 + 2)}" y="${f2(-Y1 + 9 + i * 10)}" font-size="8" font-family="Arial" fill="${bgr(r.TEXTCOLOR)}">${esc(s)}</text>`)); break; }
      case 30: { const X1 = Math.min(x, cx), Y1 = Math.max(y, cy); out.push(`<rect x="${f2(X1)}" y="${f2(-Y1)}" width="${f2(Math.abs(cx - x))}" height="${f2(Math.abs(cy - y))}" fill="#F4F4F4" stroke="#BDB9BA" stroke-dasharray="2 2" stroke-width=".5"/>`); break; }
    }
    if (ci) { ci.els.push(...out); geo.forEach(p => { ci.bb = ci.bb || { x1: 1e9, y1: 1e9, x2: -1e9, y2: -1e9 }; ext(ci.bb, p[0], -p[1]); }); }
    else over.push(...out);
    const tpl = (() => { let o = r, g = 0; while (o && o.OWNERINDEX !== undefined && g++ < 20) { o = recs[+o.OWNERINDEX]; if (o && o.RECORD === '39') return true; } return false; })();
    if (!tpl) geo.concat(t === 27 || t === 26 ? pts(r) : []).forEach(p => ext(all, p[0], -p[1]));
    if (!tpl && (t === 4 || t === 25)) ext(all, x, -y);
  }
  // Netze im Schaltplan: Drähte, Pins, Netzlabels, Power-Ports verbinden
  const par = items.map((_, i) => i), find = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; }, uni = (i, j) => { i = find(i); j = find(j); if (i !== j) par[i] = j; };
  const onSeg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) < 0.05; };
  const wires = items.map((it, i) => it.segs ? i : -1).filter(i => i >= 0);
  const onWire = (p, wi) => { const s = items[wi].segs; for (let k = 1; k < s.length; k++) if (onSeg(p, s[k - 1], s[k])) return true; return false; };
  const ptMap = new Map(); items.forEach((it, i) => { const ps = it.pt ? [it.pt] : it.segs ? [it.segs[0], it.segs[it.segs.length - 1]] : [];
    for (const p of ps) { const k = Math.round(p[0] * 100) + ',' + Math.round(p[1] * 100); if (ptMap.has(k)) uni(i, ptMap.get(k)); else ptMap.set(k, i); for (const w of wires) if (w !== i && onWire(p, w)) uni(i, w); } });
  const byName = new Map(); items.forEach((it, i) => { if (it.name) { const n = it.name.toUpperCase(); if (byName.has(n)) uni(i, byName.get(n)); else byName.set(n, i); } });
  const groups = {}; items.forEach((it, i) => { const g = find(i); const G = groups[g] = groups[g] || { name: null, pins: new Set(), bb: { x1: 1e9, y1: 1e9, x2: -1e9, y2: -1e9 }, segs: [] };
    if (it.name && !G.name) G.name = it.name; if (it.key) G.pins.add(it.key); (it.pt ? [it.pt] : it.segs || []).forEach(p => ext(G.bb, p[0], -p[1]));
    if (it.segs) G.segs.push(it.segs); if (it.pt) G.segs.push([it.pt]); });
  const keyToGroup = new Map(); for (const g in groups) groups[g].pins.forEach(k => keyToGroup.set(k, +g));
  const fixW = s => s.replace(/data-w="(\d+)"/g, (m, k) => `data-g="${find(+k)}"`);
  let compSvg = '', hits = '';
  for (const [i, c] of compOf) { if (!c.bb) continue; const des = c.des || ('#' + i); c.bb.x1 -= 2; c.bb.y1 -= 2; c.bb.x2 += 2; c.bb.y2 += 2;
    (comps[des] = comps[des] || { des, parts: [], params: {}, rec: c.rec, model: c.model }).parts.push({ idx: i, bb: c.bb }); Object.assign(comps[des].params, c.params);
    compSvg += `<g data-des="${esc(des)}">${c.els.join('')}</g>`; }
  if (all.x1 > all.x2) Object.assign(all, { x1: 0, y1: -800, x2: 1100, y2: 0 });
  let grid = ''; if (all.x1 < all.x2) { const gx1 = Math.floor((all.x1 - 60) / 100) * 100, gx2 = Math.ceil((all.x2 + 60) / 100) * 100, gy1 = Math.floor((all.y1 - 60) / 100) * 100, gy2 = Math.ceil((all.y2 + 60) / 100) * 100;
    for (let g = gx1; g <= gx2; g += 100) grid += `M${g},${gy1 - 400}V${gy2 + 400}`; for (let g = gy1; g <= gy2; g += 100) grid += `M${gx1 - 400},${g}H${gx2 + 400}`; }
  return { svg: fixW(`<g class="unter">${under.join('')}</g><g class="drueber">${over.join('')}</g>${compSvg}<g id="sch-hl"></g>`), bb: all, comps, groups, keyToGroup };
}

// ---------------- Leiterplatte 2D ----------------
const MECH = ['#C000C0', '#008080', '#808000', '#00A0C0', '#C08000', '#8080FF', '#40C040', '#FF8080'];
function layerColor(l) {
  const m = { 1: '#FF0000', 32: '#0000FF', 33: '#FFFF00', 34: '#808000', 35: '#808080', 36: '#800000', 37: '#800080', 38: '#FF00FF', 55: '#800000', 56: '#FF00FF', 73: '#FF002A', 74: '#C0C0C0', 901: '#3C3C3C' };
  if (l === 950) return '#808080'; if (l === 900) l = 57; // Platinenkontur = Farbe Mechanical 1
  if (m[l]) return m[l]; if (l >= 2 && l <= 31) return ['#BCBC00', '#00C0C0', '#C08040', '#80C000'][l % 4]; if (l >= 39 && l <= 54) return '#008000'; if (l >= 57 && l <= 72) return MECH[(l - 57) % 8]; return '#808080';
}
const LAYER_DE = { 950: 'Bauteile (3D)', 1: 'Top Layer (Kupfer oben)', 32: 'Bottom Layer (Kupfer unten)', 33: 'Top Overlay (Bestückungsdruck oben)', 34: 'Bottom Overlay (Bestückungsdruck unten)', 35: 'Top Paste', 36: 'Bottom Paste', 37: 'Top Solder (Lötstopp oben)', 38: 'Bottom Solder (Lötstopp unten)', 56: 'Keep-Out', 74: 'Multi-Layer (Pads)', 900: 'Platinenkontur', 901: 'Bohrungen' };
function padEl(p, sx, sy, shape, dc, grow = 0) {
  const x = p.x, y = -p.y; sx += grow * 2; sy += grow * 2; const tr = p.rot ? ` transform="rotate(${f2(-p.rot)} ${f2(x)} ${f2(y)})"` : '';
  if (shape === 1 && Math.abs(sx - sy) < 0.01) return `<circle class="f"${dc} cx="${f2(x)}" cy="${f2(y)}" r="${f2(sx / 2)}"/>`;
  if (shape === 3) { const a = Math.min(sx, sy) * 0.2929; const X = x - sx / 2, Y = y - sy / 2;
    return `<polygon class="f"${dc} points="${[[X + a, Y], [X + sx - a, Y], [X + sx, Y + a], [X + sx, Y + sy - a], [X + sx - a, Y + sy], [X + a, Y + sy], [X, Y + sy - a], [X, Y + a]].map(q => f2(q[0]) + ',' + f2(q[1])).join(' ')}"${tr}/>`; }
  const rr = shape === 1 ? Math.min(sx, sy) / 2 : shape === 9 ? Math.min(sx, sy) * (p.cr ?? p.bcr ?? 50) / 200 : 0;
  return `<rect class="f"${dc} x="${f2(x - sx / 2)}" y="${f2(y - sy / 2)}" width="${f2(sx)}" height="${f2(sy)}"${rr ? ` rx="${f2(rr)}"` : ''}${tr}/>`;
}
function cutPath(d) { return (d.cutouts || []).map(pts => 'M' + pts.map(p => f2(p.x) + ',' + f2(-p.y)).join('L') + 'Z').join(''); }
function outlinePath(ol) {
  if (!ol.length) return ''; let d = '';
  ol.forEach((v, i) => { d += (i ? 'L' : 'M') + f2(v.x) + ',' + f2(-v.y);
    if (v.k === 1 && v.r > 0) { let sa = v.sa, ea = v.ea; const nx = ol[(i + 1) % ol.length]; let sw = ((ea - sa) % 360 + 360) % 360;
      const ds = Math.hypot(v.cx + v.r * Math.cos(sa * Math.PI / 180) - v.x, v.cy + v.r * Math.sin(sa * Math.PI / 180) - v.y);
      const steps = Math.max(4, Math.ceil(sw / 5)); const dir = ds < v.r * 0.1 ? 1 : -1; const a0 = dir > 0 ? sa : ea; const span = dir > 0 ? sw : -sw;
      for (let s = 1; s <= steps; s++) { const a = (a0 + span * s / steps) * Math.PI / 180; d += 'L' + f2(v.cx + v.r * Math.cos(a)) + ',' + f2(-(v.cy + v.r * Math.sin(a))); } void nx; } });
  return d + 'Z';
}

// Altium-Strichschrift (Default Stroke Font), Raster 4 breit x 6 hoch, y nach oben
const STROKE = (() => { const g = {
  A: '0,0 0,4 2,6 4,4 4,0|0,3 4,3', B: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|3,3 4,2 4,1 3,0 0,0', C: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1', D: '0,0 0,6 3,6 4,5 4,1 3,0 0,0',
  E: '4,6 0,6 0,0 4,0|0,3 3,3', F: '4,6 0,6 0,0|0,3 3,3', G: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,3 2,3', H: '0,0 0,6|4,0 4,6|0,3 4,3', I: '1,6 3,6|2,6 2,0|1,0 3,0',
  J: '4,6 4,1 3,0 1,0 0,1', K: '0,0 0,6|4,6 0,2|1,3 4,0', L: '0,6 0,0 4,0', M: '0,0 0,6 2,3 4,6 4,0', N: '0,0 0,6 4,0 4,6', O: '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0',
  P: '0,0 0,6 3,6 4,5 4,4 3,3 0,3', Q: '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0|2,2 4,0', R: '0,0 0,6 3,6 4,5 4,4 3,3 0,3|2,3 4,0', S: '4,5 3,6 1,6 0,5 0,4 1,3 3,3 4,2 4,1 3,0 1,0 0,1',
  T: '0,6 4,6|2,6 2,0', U: '0,6 0,1 1,0 3,0 4,1 4,6', V: '0,6 2,0 4,6', W: '0,6 1,0 2,3 3,0 4,6', X: '0,0 4,6|0,6 4,0', Y: '0,6 2,3 4,6|2,3 2,0', Z: '0,6 4,6 0,0 4,0',
  0: '1,0 0,1 0,5 1,6 3,6 4,5 4,1 3,0 1,0|0,1 4,5', 1: '1,5 2,6 2,0', 2: '0,5 1,6 3,6 4,5 4,4 0,0 4,0', 3: '0,5 1,6 3,6 4,5 4,4 3,3 4,2 4,1 3,0 1,0 0,1|1,3 3,3', 4: '3,0 3,6 0,2 4,2',
  5: '4,6 0,6 0,3 3,3 4,2 4,1 3,0 1,0 0,1', 6: '4,5 3,6 1,6 0,5 0,1 1,0 3,0 4,1 4,2 3,3 0,3', 7: '0,6 4,6 1,0', 8: '1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3 1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3',
  9: '0,1 1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,4 1,3 4,3', '-': '1,3 3,3', '+': '0,3 4,3|2,1 2,5', '.': '2,0 2,0.01', ',': '2,0.5 1.5,-1', '/': '0,0 4,6', '_': '0,0 4,0', '=': '0,2 4,2|0,4 4,4',
  '(': '3,6 2,5 2,1 3,0', ')': '1,6 2,5 2,1 1,0', ':': '2,1 2,1.01|2,4 2,4.01', '%': '0,0 4,6|0.5,5 0.5,5.01|3.5,1 3.5,1.01', '#': '1,0 1,6|3,0 3,6|0,2 4,2|0,4 4,4', '*': '2,1 2,5|0,2 4,4|0,4 4,2',
  "'": '2,6 2,4', '"': '1,6 1,4|3,6 3,4', '<': '4,5 0,3 4,1', '>': '0,5 4,3 0,1', '?': '0,5 1,6 3,6 4,5 4,4 2,3 2,2|2,0 2,0.01', '!': '2,6 2,2|2,0 2,0.01', '&': '4,0 1,4 1,5 2,6 3,5 3,4 0,2 0,1 1,0 2,0 4,2', 'µ': '0,-2 0,4|0,1 1,0 3,0 4,1|4,4 4,0', 'Ω': '0,0 1,0 1,1 0,2 0,4 1,6 3,6 4,4 4,2 3,1 3,0 4,0', '°': '1,6 2,6 2,5 1,5 1,6',
}; const out = {}; for (const k in g) out[k] = g[k].split('|').map(s => s.split(' ').map(q => q.split(',').map(Number))); return out; })();
function strokeText(t, dc) { // Altium: Höhe = Zeichenhöhe inkl. Strichbreite, Ursprung unten links
  const sw = t.sw || t.h / 10, s = Math.max(t.h - sw, t.h * 0.5) / 6, sxw = s * 1.25, adv = 7.7 * s; let d = '', cx = 0;
  for (const ch of String(t.text)) { const gl = STROKE[ch] || STROKE[ch.toUpperCase()]; if (gl) { const lower = ch !== ch.toUpperCase(), k = lower ? 0.72 : 1;
      for (const pl of gl) d += 'M' + pl.map(([gx, gy]) => f2(cx + sw / 2 + gx * sxw) + ',' + f2(-(sw / 2 + gy * s * k))).join('L'); }
    cx += adv; }
  const x = t.x, y = -t.y; let tr = `translate(${f2(x)} ${f2(y)}) rotate(${f2(-t.rot)})`; if (t.mirror) tr += ' scale(-1 1)';
  return `<path class="s"${dc} d="${d}" fill="none" stroke-width="${f2(sw)}" stroke-linecap="round" stroke-linejoin="round" transform="${tr}"/>`;
}
function textEl(t, dc, extra = '') {
  if (t.stroke !== false) return strokeText(t, dc);
  const x = t.x, y = -t.y, fs = t.h * 1.3;
  let tr = `rotate(${f2(-t.rot)} ${f2(x)} ${f2(y)})`; if (t.mirror) tr += ` translate(${f2(2 * x)} 0) scale(-1 1)`;
  return `<text class="f"${dc} x="${f2(x)}" y="${f2(y)}" font-size="${f2(fs)}" font-family="${esc(t.font || 'Arial')}, Arial, sans-serif"${t.bold ? ' font-weight="700"' : ''}${t.italic ? ' font-style="italic"' : ''} transform="${tr}"${extra}>${esc(t.text)}</text>`;
}
function pcbLayers(d, opt = {}) { // -> Map layer -> [svg strings]
  const L = new Map(), add = (l, s) => { if (!L.has(l)) L.set(l, []); L.get(l).push(s); };
  const dc = (c, n) => (c >= 0 ? ` data-c="${c}"` : '') + (n >= 0 ? ` data-n="${n}"` : '');
  for (const t of d.tracks) add(t.layer, `<line class="s"${dc(t.comp, t.net)} x1="${f2(t.x1)}" y1="${f2(-t.y1)}" x2="${f2(t.x2)}" y2="${f2(-t.y2)}" stroke-width="${f2(t.w)}"/>`);
  for (const a of d.arcs) { let sw = ((a.ea - a.sa) % 360 + 360) % 360; if (sw === 0 && a.ea !== a.sa) sw = 360;
    if (sw >= 359.99 || (a.sa === 0 && a.ea === 360)) add(a.layer, `<circle class="s"${dc(a.comp, a.net)} cx="${f2(a.cx)}" cy="${f2(-a.cy)}" r="${f2(a.r)}" fill="none" stroke-width="${f2(a.w)}"/>`);
    else { const r = Math.PI / 180, p1 = [a.cx + a.r * Math.cos(a.sa * r), a.cy + a.r * Math.sin(a.sa * r)], p2 = [a.cx + a.r * Math.cos(a.ea * r), a.cy + a.r * Math.sin(a.ea * r)];
      add(a.layer, `<path class="s"${dc(a.comp, a.net)} d="M${f2(p1[0])},${f2(-p1[1])}A${f2(a.r)},${f2(a.r)} 0 ${sw > 180 ? 1 : 0} 0 ${f2(p2[0])},${f2(-p2[1])}" fill="none" stroke-width="${f2(a.w)}"/>`); } }
  for (const f of d.fills) { const cx = (f.x1 + f.x2) / 2, cy = -(f.y1 + f.y2) / 2;
    add(f.layer, `<rect class="f"${dc(f.comp, f.net)} x="${f2(Math.min(f.x1, f.x2))}" y="${f2(-Math.max(f.y1, f.y2))}" width="${f2(Math.abs(f.x2 - f.x1))}" height="${f2(Math.abs(f.y2 - f.y1))}"${f.rot ? ` transform="rotate(${f2(-f.rot)} ${f2(cx)} ${f2(cy)})"` : ''}/>`); }
  for (const r of d.regions) { if (r.kind !== 0 || r.pts.length < 3) continue;
    const ring = a => 'M' + a.map(p => f2(p.x) + ',' + f2(-p.y)).join('L') + 'Z';
    add(r.layer, `<path class="f"${dc(r.comp, r.net)} fill-rule="evenodd" d="${ring(r.pts)}${r.holes.map(ring).join('')}"/>`); }
  // Texte: Bezeichner/Kommentar je nach Bauteil-Einstellung
  const seen = {}; for (const t of d.texts) { if (!t.text) continue; let show = true;
    if (t.comp >= 0 && d.comps[t.comp]) { const c = d.comps[t.comp]; seen[t.comp] = (seen[t.comp] || 0) + 1;
      if (t.isDesignator) show = c.nameOn; else if (t.isComment) show = c.commentOn; else if (t.text === c.des) show = c.nameOn; else if (seen[t.comp] === 2 && t.isComment === undefined) show = c.commentOn; }
    if (show) add(t.layer, textEl(t, dc(t.comp))); }
  for (const v of d.vias) { add(74, `<circle class="f"${dc(-1, v.net)} cx="${f2(v.x)}" cy="${f2(-v.y)}" r="${f2(v.d / 2)}"/>`); add(901, `<circle cx="${f2(v.x)}" cy="${f2(-v.y)}" r="${f2(v.hole / 2)}"/>`); }
  for (const p of d.pads) { add(p.layer, padEl(p, p.sx, p.sy, p.shape, dc(p.comp, p.net)));
    if (p.layer === 74 || p.layer === 1) add(37, padEl(p, p.sx, p.sy, p.shape, dc(p.comp), 4));
    if (p.layer === 74 || p.layer === 32) add(38, padEl(p, p.layer === 74 ? p.bx : p.sx, p.layer === 74 ? p.by : p.sy, p.layer === 74 ? p.bshape : p.shape, dc(p.comp), 4));
    if (p.layer === 1) add(35, padEl(p, p.sx, p.sy, p.shape, dc(p.comp, p.net))); if (p.layer === 32) add(36, padEl(p, p.sx, p.sy, p.shape, dc(p.comp, p.net)));
    if (p.hole > 0) add(901, `<circle cx="${f2(p.x)}" cy="${f2(-p.y)}" r="${f2(p.hole / 2)}"/>`); }
  // Nutzen: eingebettete Platinen als Rahmen mit Dateiname (Originaldatei ist nicht Teil des Projekts)
  for (const e of (d.embedded || []).filter(e => !e.resolved)) { const w = (e.x2 - e.x1 - (e.cols - 1) * e.cs), h = (e.y2 - e.y1 - (e.rows - 1) * e.rs);
    for (let r = 0; r < e.rows; r++) for (let k = 0; k < e.cols; k++) { const x = e.x1 + k * e.cs, y = e.y1 + r * e.rs;
      add(57, `<rect class="s" x="${f2(x)}" y="${f2(-(y + h))}" width="${f2(w)}" height="${f2(h)}" fill="none" stroke-width="6" stroke-dasharray="30 20"/><text class="f" x="${f2(x + w / 2)}" y="${f2(-(y + h / 2))}" font-size="${f2(Math.min(h, w) * 0.09)}" text-anchor="middle" dominant-baseline="middle" font-family="Arial">${esc(e.doc.replace(/\.PcbDoc$/i, ''))}</text>`); } }
  return L;
}
function pcbBox(d) {
  const b = { x1: 1e9, y1: 1e9, x2: -1e9, y2: -1e9 }, e = (x, y) => { b.x1 = Math.min(b.x1, x); b.x2 = Math.max(b.x2, x); b.y1 = Math.min(b.y1, -y); b.y2 = Math.max(b.y2, -y); };
  d.outline.forEach(v => e(v.x, v.y)); if (b.x1 > b.x2) { d.pads.forEach(p => e(p.x, p.y)); d.tracks.forEach(t => { e(t.x1, t.y1); e(t.x2, t.y2); }); }
  return b;
}
// Nutzen: eingebettete Platinen auflösen (fehlende Datei -> normale Projekt-Platine) und Inhalt je Position kopieren
function expandPanels(list) {
  const normal = list.filter(p => !(p.data.embedded || []).length), base = n => noExt(String(n).split(/[\\/]/).pop()).toLowerCase();
  const sim = (a, b) => { const A = new Set(a.split(/[^a-z0-9]+/)), B = b.split(/[^a-z0-9]+/); return B.filter(w => w && A.has(w)).length; };
  for (const P of list) { const d = P.data; if (!(d.embedded || []).length) continue;
    for (const e of d.embedded) {
      let ch = normal.find(p => base(p.name) === base(e.doc)); if (!ch && normal.length) ch = normal.slice().sort((x, y) => sim(base(e.doc), base(y.name)) - sim(base(e.doc), base(x.name)))[0];
      if (!ch) continue; e.resolved = ch.name; const c = ch.data, ox = parseFloat(c.board.ORIGINX) || 0, oy = parseFloat(c.board.ORIGINY) || 0, rot = e.rot || 0, mir = !!e.mirror;
      const netMap = c.nets.map(n => { let i = d.nets.indexOf(n); if (i < 0) { d.nets.push(n); i = d.nets.length - 1; } return i; }), nm = n => n >= 0 ? netMap[n] : -1;
      d.models.push(...c.models.filter(m => !d.models.some(x => x.id === m.id)));
      for (let r = 0; r < e.rows; r++) for (let k = 0; k < e.cols; k++) {
        const tx = e.x1 + k * e.cs, ty = e.y1 + r * e.rs, ca = Math.cos(rot * Math.PI / 180), sa = Math.sin(rot * Math.PI / 180);
        const T = (x, y) => { let u = x - ox, v = y - oy; if (mir) u = -u; return [tx + u * ca - v * sa, ty + u * sa + v * ca]; }, R = a => (mir ? 180 - a : a) + rot;
        const coff = d.comps.length; const cm = i => i >= 0 ? i + coff : -1;
        c.comps.forEach(q => { const [x, y] = T(q.x, q.y); d.comps.push({ ...q, x, y, rot: R(q.rot || 0), i: d.comps.length }); });
        c.tracks.forEach(t => { const [x1, y1] = T(t.x1, t.y1), [x2, y2] = T(t.x2, t.y2); d.tracks.push({ ...t, x1, y1, x2, y2, comp: cm(t.comp), net: nm(t.net) }); });
        c.arcs.forEach(q => { const [cx, cy] = T(q.cx, q.cy); let sa2 = q.sa, ea2 = q.ea; if (mir) [sa2, ea2] = [180 - q.ea, 180 - q.sa]; d.arcs.push({ ...q, cx, cy, sa: sa2 + rot, ea: ea2 + rot, comp: cm(q.comp), net: nm(q.net) }); });
        c.fills.forEach(f => { const [x1, y1] = T(f.x1, f.y1), [x2, y2] = T(f.x2, f.y2); d.fills.push({ ...f, x1, y1, x2, y2, rot: (f.rot || 0) + rot, comp: cm(f.comp), net: nm(f.net) }); });
        const PT = p => { const [x, y] = T(p.x, p.y); return { ...p, x, y }; };
        c.regions.forEach(q => d.regions.push({ ...q, pts: q.pts.map(PT), holes: q.holes.map(h => h.map(PT)), comp: cm(q.comp), net: nm(q.net), poly: -1 }));
        c.pads.forEach(p => { const [x, y] = T(p.x, p.y); d.pads.push({ ...p, x, y, rot: R(p.rot || 0), comp: cm(p.comp), net: nm(p.net) }); });
        (c.cutouts || []).forEach(pts => (d.cutouts = d.cutouts || []).push(pts.map(PT)));
        c.vias.forEach(v => { const [x, y] = T(v.x, v.y); d.vias.push({ ...v, x, y, net: nm(v.net) }); });
        c.texts.forEach(t => { const [x, y] = T(t.x, t.y); d.texts.push({ ...t, x, y, rot: R(t.rot || 0), comp: cm(t.comp) }); });
        c.bodies.forEach(b => { const p = { ...b.p }; if (p['MODEL.2D.X'] !== undefined) { const [x, y] = T(parseFloat(p['MODEL.2D.X']), parseFloat(p['MODEL.2D.Y'])); p['MODEL.2D.X'] = x + 'mil'; p['MODEL.2D.Y'] = y + 'mil'; p['MODEL.2D.ROTATION'] = String(R(+(p['MODEL.2D.ROTATION'] || 0))); }
          d.bodies.push({ ...b, p, pts: b.pts.map(PT), comp: cm(b.comp) }); });
      } } }
}
function compBoxes(d) {
  const bx = d.comps.map(() => null), e = (i, x, y, r = 0) => { if (i < 0 || !bx[i] && !(bx[i] = { x1: 1e9, y1: 1e9, x2: -1e9, y2: -1e9 })) return; const b = bx[i]; b.x1 = Math.min(b.x1, x - r); b.x2 = Math.max(b.x2, x + r); b.y1 = Math.min(b.y1, -y - r); b.y2 = Math.max(b.y2, -y + r); };
  d.pads.forEach(p => e(p.comp, p.x, p.y, Math.max(p.sx, p.sy) / 2));
  d.tracks.forEach(t => { if (t.layer === 33 || t.layer === 34) { e(t.comp, t.x1, t.y1); e(t.comp, t.x2, t.y2); } });
  d.arcs.forEach(a => { if (a.layer === 33 || a.layer === 34) e(a.comp, a.cx, a.cy, a.r); });
  d.comps.forEach((c, i) => { if (!bx[i]) e(i, c.x, c.y, 20); const b = bx[i]; b.x1 -= 6; b.y1 -= 6; b.x2 += 6; b.y2 += 6; });
  return bx;
}
function drawOrder(side) {
  const mids = []; for (let i = 2; i <= 31; i++) mids.push(i); for (let i = 39; i <= 54; i++) mids.push(i);
  const mech = []; for (let i = 57; i <= 72; i++) mech.push(i);
  const top = [1, 35, 37, 33], bot = [32, 36, 38, 34];
  return side === 'unten' ? [...top, ...mids, ...bot, ...mech, 55, 56, 73, 74, 901, 902] : [...bot, ...mids, ...top, ...mech, 55, 56, 73, 74, 901, 902];
}
function renderPcb() {
  const d = S.pcb.data, L = S.pcb.layers; let s = '';
  for (const l of drawOrder(S.side)) {
    if (l === 902) { if ((d.cutouts || []).length) s += `<path class="ausschnitt" d="${cutPath(d)}" fill="#0A0A0A"/>`; continue; }
    if (!L.has(l)) continue; const c = layerColor(l), hole = l === 901;
    s += `<g data-l="${l}" fill="${hole ? '#101010' : c}" stroke="${c}" stroke-linecap="round" fill-opacity="${hole ? 1 : l === 37 || l === 38 ? 0.45 : 0.85}" stroke-opacity="${hole ? 1 : l === 37 || l === 38 ? 0.45 : 0.85}"${S.hidden.has(l) ? ' display="none"' : ''}>${L.get(l).join('')}</g>`;
  }
  s += '<g id="pcb-hl"></g>';
  $('#svg-pcb').innerHTML = `<g id="pcbwelt"${S.side === 'unten' ? ' transform="scale(-1 1)"' : ''}>${s}</g>`;
  const b = pcbBox(d); S.pcb.bb = S.side === 'unten' ? { x1: -b.x2, x2: -b.x1, y1: b.y1, y2: b.y2 } : b; pcbPan.bb = S.pcb.bb;
  highlight(false);
}
function buildLayerPanel() {
  const L = S.pcb.layers, have = [...new Set([...L.keys(), 950])].sort((a, b) => (a === 950 ? 999 : drawOrder('oben').indexOf(a)) - (b === 950 ? 999 : drawOrder('oben').indexOf(b)));
  $('#ebenen').innerHTML = '<div class="klein" style="font-weight:700;margin-bottom:4px">Ebenen anzeigen</div>' + have.map(l => `<label><input type="checkbox" data-l="${l}"${S.hidden.has(l) ? '' : ' checked'}><span class="farbe" style="background:${layerColor(l)}"></span>${esc(LAYER_DE[l] || S.pcb.data.layerNames[l] || ('Layer ' + l))}</label>`).join('')
    + '<div class="zeile" style="display:flex;gap:6px;margin-top:6px"><button class="klein" id="alleEb">Alle</button><button class="klein" id="kuEb">Nur Kupfer</button></div>';
}

// ---------------- Auswahl ----------------
const schPan = new Pan($('#svg-sch'), p => pick('sch', p)), pcbPan = new Pan($('#svg-pcb'), p => pick('pcb', p));
const area = b => (b.x2 - b.x1) * (b.y2 - b.y1), inside = (b, p) => p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2;
function curSheet() { return S.sheets[S.sheet]; }
function pcbHitAt(x, y) { // x, y in mil (y nach oben)
  const d = S.pcb.data, vis = l => !S.hidden.has(l);
  for (const p of d.pads) { if (!vis(p.layer)) continue; const r = -(p.rot || 0) * Math.PI / 180, dx = x - p.x, dy = y - p.y, u = dx * Math.cos(r) - dy * Math.sin(r), v = dx * Math.sin(r) + dy * Math.cos(r);
    if (Math.abs(u) <= p.sx / 2 && Math.abs(v) <= p.sy / 2) return { kind: 'pad', net: p.net, comp: p.comp }; }
  for (const v of d.vias) if (Math.hypot(x - v.x, y - v.y) <= v.d / 2) return { kind: 'via', net: v.net };
  const segD = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0; return Math.hypot(x - ax - t * dx, y - ay - t * dy); };
  for (const t of d.tracks) if (t.net >= 0 && vis(t.layer) && segD(t.x1, t.y1, t.x2, t.y2) <= Math.max(t.w / 2, 4)) return { kind: 'track', net: t.net };
  for (const a of d.arcs) if (a.net >= 0 && vis(a.layer) && Math.abs(Math.hypot(x - a.cx, y - a.cy) - a.r) <= Math.max(a.w / 2, 4)) return { kind: 'track', net: a.net };
  const inPoly = pts => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
  for (const f of d.fills) if (f.net >= 0 && vis(f.layer) && x >= Math.min(f.x1, f.x2) && x <= Math.max(f.x1, f.x2) && y >= Math.min(f.y1, f.y2) && y <= Math.max(f.y1, f.y2)) return { kind: 'fill', net: f.net };
  for (const r of d.regions) if (r.net >= 0 && r.kind === 0 && vis(r.layer) && inPoly(r.pts) && !r.holes.some(inPoly)) return { kind: 'region', net: r.net };
  return null;
}
function schGroupAt(p) { const s = curSheet(); if (!s) return null; let best = null, bd = 3;
  for (const g in s.r.groups) for (const sg of s.r.groups[g].segs) { if (sg.length === 1) { const dd = Math.hypot(p.x - sg[0][0], p.y + sg[0][1]); if (dd < Math.max(bd, 6) && dd < (best ? bd : 99)) { bd = dd; best = +g; } continue; }
    for (let k = 1; k < sg.length; k++) { const a = sg[k - 1], b = sg[k], ax = a[0], ay = -a[1], dx = b[0] - ax, dy = -b[1] - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / l2)) : 0, dd = Math.hypot(p.x - ax - t * dx, p.y - ay - t * dy); if (dd < bd) { bd = dd; best = +g; } } }
  return best; }
function compAt(where, q, sideOnly) { let best = null, ba = Infinity; const vis = c => !sideOnly || (S.side === 'unten' ? c.layer === 'BOTTOM' : c.layer !== 'BOTTOM');
  if (where === 'sch') for (const c of Object.values(curSheet().r.comps)) for (const pt of c.parts) if (inside(pt.bb, q) && area(pt.bb) < ba) { ba = area(pt.bb); best = c.des; }
  if (where === 'pcb') S.pcb.boxes.forEach((b, i) => { if (b && vis(S.pcb.data.comps[i]) && inside(b, q) && area(b) < ba) { ba = area(b); best = S.pcb.data.comps[i].des; } });
  return best; }
function pick(where, p) {
  if (where === 'sch' && curSheet()) { const g = schGroupAt(p); if (g !== null) { S.sel = null; setNet({ sheet: S.sheet, g }, 'sch'); return select(null, 'sch', true); } setNet(null); return select(compAt('sch', p), 'sch'); }
  if ((where === 'pcb' || where === '3d') && S.pcb) { const q = where === 'pcb' && S.side === 'unten' ? { x: -p.x, y: p.y } : p; const h = pcbHitAt(q.x, -q.y);
    // Priorität: innerhalb einer Bauteilfläche (sichtbare Seite) immer nur das Bauteil
    const cd = compAt('pcb', q, true); if (cd) { setNet(null); return select(cd, where); }
    if (h && h.kind === 'pad') { setNet(h.net >= 0 ? { n: h.net } : null, 'pcb'); return select(null, where, true); }
    if (h) { setNet({ n: h.net }, 'pcb'); return select(null, where, true); }
    setNet(null); return select(compAt('pcb', q), where); }
  setNet(null); select(null, where);
}
function setNet(spec, from) {
  if (!spec) { S.net = null; return; }
  const d = S.pcb?.data; let n = spec.n ?? -1, name = n >= 0 && d ? d.nets[n] : null, keys = new Set();
  if (spec.g !== undefined) { const G = S.sheets[spec.sheet].r.groups[spec.g]; G.pins.forEach(k => keys.add(k)); name = G.name;
    if (d) { const pad = d.pads.find(p => p.net >= 0 && p.comp >= 0 && keys.has(d.comps[p.comp].des + ':' + p.name)); n = pad ? pad.net : (name ? d.nets.findIndex(x => x && x.toUpperCase() === name.toUpperCase()) : -1); if (n >= 0) name = d.nets[n] || name; } }
  if (n >= 0 && d) d.pads.forEach(p => { if (p.net === n && p.comp >= 0) keys.add(d.comps[p.comp].des + ':' + p.name); });
  const sheets = new Map(); S.sheets.forEach((s, i) => { const set = new Set(); keys.forEach(k => { const g = s.r.keyToGroup.get(k); if (g !== undefined) set.add(g); });
    if (name) for (const g in s.r.groups) if (s.r.groups[g].name && s.r.groups[g].name.toUpperCase() === String(name).toUpperCase()) set.add(+g);
    if (spec.g !== undefined && i === spec.sheet) set.add(spec.g); if (set.size) sheets.set(i, set); });
  if (!name && spec.g !== undefined) { const ks = [...keys]; name = ks.length ? 'Net' + ks[0].replace(':', '_') : 'Netz'; }
  S.net = { n, name: name || '(ohne Namen)', sheets, from };
}
function netSchBox() { const set = S.net?.sheets.get(S.sheet); if (!set) return null; const b = { x1: 1e9, y1: 1e9, x2: -1e9, y2: -1e9 }; set.forEach(g => { const q = curSheet().r.groups[g].bb; b.x1 = Math.min(b.x1, q.x1); b.y1 = Math.min(b.y1, q.y1); b.x2 = Math.max(b.x2, q.x2); b.y2 = Math.max(b.y2, q.y2); }); return b.x1 < b.x2 || b.y1 < b.y2 ? b : null; }
function netPcbBox() { if (!S.net || S.net.n < 0 || !S.pcb) return null; const d = S.pcb.data, n = S.net.n, b = { x1: 1e9, y1: 1e9, x2: -1e9, y2: -1e9 }, e = (x, y) => { b.x1 = Math.min(b.x1, x); b.x2 = Math.max(b.x2, x); b.y1 = Math.min(b.y1, -y); b.y2 = Math.max(b.y2, -y); };
  d.pads.forEach(p => { if (p.net === n) e(p.x, p.y); }); d.tracks.forEach(t => { if (t.net === n) { e(t.x1, t.y1); e(t.x2, t.y2); } }); if (b.x1 > b.x2) return null;
  return S.side === 'unten' ? { x1: -b.x2, x2: -b.x1, y1: b.y1, y2: b.y2 } : b; }
function schBox(des) { const c = curSheet()?.r.comps[des]; if (!c) return null; const b = { x1: 1e9, y1: 1e9, x2: -1e9, y2: -1e9 }; c.parts.forEach(p => { b.x1 = Math.min(b.x1, p.bb.x1); b.y1 = Math.min(b.y1, p.bb.y1); b.x2 = Math.max(b.x2, p.bb.x2); b.y2 = Math.max(b.y2, p.bb.y2); }); return b; }
function pcbIdxAll(des) { return S.pcb ? S.pcb.data.comps.map((c, i) => c.des === des ? i : -1).filter(i => i >= 0) : []; }
function pcbIdx(des) { return S.pcb ? S.pcb.data.comps.findIndex(c => c.des === des) : -1; }
function pcbSelBox(des) { const i = pcbIdx(des); if (i < 0) return null; const b = S.pcb.boxes[i]; return S.side === 'unten' ? { x1: -b.x2, x2: -b.x1, y1: b.y1, y2: b.y2 } : b; }
schPan.selBox = () => S.sel && schBox(S.sel); pcbPan.selBox = () => S.sel && pcbSelBox(S.sel);
function select(des, from, keepNet) {
  if (!keepNet) S.net = null;
  S.sel = des;
  if (S.net && from !== 'sch' && !S.net.sheets.has(S.sheet) && S.net.sheets.size) { S.sheet = [...S.net.sheets.keys()][0]; showSheet(true); }
  if (des && from !== 'sch') { const si = S.sheets.findIndex(s => s.r.comps[des]); if (si >= 0 && si !== S.sheet) { S.sheet = si; showSheet(true); } }
  if (des && from !== 'pcb' && from !== '3d' && S.pcbs && pcbIdx(des) < 0) { const bi = S.pcbs.findIndex(p => p.data.comps.some(c => c.des === des)); if (bi >= 0) switchPcb(bi, false); }
  highlight(true, from); info(); if (window.Drei && S.dim === '3d') window.Drei.select(des);
  $('#suche').value = des || '';
}
function highlight(pan, from) {
  const des = S.sel, st = document.getElementById('hlstyle') || document.head.appendChild(Object.assign(document.createElement('style'), { id: 'hlstyle' }));
  const P = '#D80373'; let css = '';
  if (des) {
    const e = CSS.escape(des);
    css += `#svg-sch g[data-des="${e}"] .s{stroke:${P}!important} #svg-sch g[data-des="${e}"] .f{fill:${P}!important} #svg-sch g[data-des="${e}"] .s.f{fill:#FBE6F0!important}`;
    const sb = schBox(des); if (sb && pan && from !== 'sch') schPan.show(sb);
    const i = pcbIdx(des); for (const j of pcbIdxAll(des)) css += `#svg-pcb [data-c="${j}"].s{stroke:${P}!important} #svg-pcb [data-c="${j}"].f{fill:${P}!important} #svg-pcb g[data-l]:has([data-c="${j}"]){opacity:1}`; if (i >= 0) {
      if (pan && from !== 'pcb' && from !== '3d') pcbPan.show(pcbSelBox(des)); }
  }
  if (S.net) {
    const set = S.net.sheets.get(S.sheet); if (set) set.forEach(g => { css += `#svg-sch [data-g="${g}"].s,#svg-sch [data-g="${g}"] .s,#svg-sch [data-g="${g}"] line,#svg-sch [data-g="${g}"] circle{stroke:${P}!important} #svg-sch [data-g="${g}"].f,#svg-sch [data-g="${g}"] text,#svg-sch circle[data-g="${g}"]{fill:${P}!important}`; });
    if (S.net.n >= 0) css += `#svg-pcb [data-n="${S.net.n}"].s{stroke:${P}!important} #svg-pcb [data-n="${S.net.n}"].f{fill:${P}!important} #svg-pcb g[data-l]:has([data-n="${S.net.n}"]){opacity:1}`;
    if (pan && !des) { if (S.net.from !== 'sch') { const b = netSchBox(); if (b) schPan.show(b); } if (S.net.from !== 'pcb') { const b = netPcbBox(); if (b) pcbPan.show(b); } }
  }
  // Abdunkeln: alles außer Auswahl auf 30 %
  const keepS = [], keepP = [];
  if (des) { const e = CSS.escape(des); keepS.push(`g[data-des="${e}"] *`); pcbIdxAll(des).forEach(j => keepP.push(`[data-c="${j}"]`)); }
  if (S.net) { (S.net.sheets.get(S.sheet) || []).forEach(g => keepS.push(`[data-g="${g}"]`, `[data-g="${g}"] *`)); if (S.net.n >= 0) keepP.push(`[data-n="${S.net.n}"]`); }
  const L = ':is(line,polyline,polygon,rect,circle,ellipse,path,text)';
  void L; st.textContent = css;
  // Abdunkeln als Ganzes: Overlay über die fertige Zeichnung, Auswahl als Kopie obenauf
  const ob = b => b ? `x="${b.x1 - 2000}" y="${b.y1 - 2000}" width="${b.x2 - b.x1 + 4000}" height="${b.y2 - b.y1 + 4000}"` : 'x="-1e5" y="-1e5" width="2e5" height="2e5"', BIG = ob(S.pcb && S.pcb.bb), BIGS = ob(curSheet() && curSheet().r.bb), shl = document.getElementById('sch-hl'), phl = document.getElementById('pcb-hl');
  if (shl) { shl.innerHTML = ''; if (des || S.net) { shl.insertAdjacentHTML('beforeend', `<rect ${BIGS} fill="#fff" opacity=".7" pointer-events="none"/>`);
    const top = document.createElementNS('http://www.w3.org/2000/svg', 'g'); top.setAttribute('pointer-events', 'none');
    if (des) document.querySelectorAll(`#svg-sch g[data-des="${CSS.escape(des)}"]`).forEach(g => { if (!shl.contains(g)) top.appendChild(g.cloneNode(true)); });
    (S.net?.sheets.get(S.sheet) || []).forEach(g => document.querySelectorAll(`#svg-sch [data-g="${g}"]`).forEach(n => { if (!shl.contains(n)) top.appendChild(n.cloneNode(true)); }));
    shl.appendChild(top); } }
  if (phl) { phl.innerHTML = ''; if ((des || S.net) && keepP.length) { phl.insertAdjacentHTML('beforeend', `<rect ${BIG} fill="#000" opacity=".7" pointer-events="none"/>`);
    const sel = keepP.join(','); document.querySelectorAll('#svg-pcb g[data-l]').forEach(g => { if (g.getAttribute('display') === 'none') return; const ms = g.querySelectorAll(sel); if (!ms.length) return;
      const c = g.cloneNode(false); c.setAttribute('fill-opacity', '1'); c.setAttribute('stroke-opacity', '1'); c.setAttribute('pointer-events', 'none'); ms.forEach(m => c.appendChild(m.cloneNode(true))); phl.appendChild(c); }); const h = document.querySelector('#svg-pcb g[data-l="901"]'); if (h && h.getAttribute('display') !== 'none') { const c = h.cloneNode(true); c.setAttribute('pointer-events', 'none'); phl.appendChild(c); } }
    else if (des || S.net) phl.insertAdjacentHTML('beforeend', `<rect ${BIG} fill="#000" opacity=".7" pointer-events="none"/>`); }
}
function info() {
  const des = S.sel, el = $('#info');
  const netTxt = S.net ? S.net.name : '';
  el.hidden = !des && !S.net; if (!des) { if (S.net) el.innerHTML = `<div class="einzeile" title="Netz: ${esc(netTxt)}"><label>Netz</label> <b class="bk">${esc(netTxt)}</b></div>`; else el.innerHTML = ''; return; }
  const sc = S.sheets.map(s => s.r.comps[des]).find(Boolean), i = pcbIdx(des), pc = i >= 0 ? S.pcb.data.comps[i] : null;
  const rec = sc?.rec || {}, params = sc?.params || {};
  const beak = params.Description || rec.COMPONENTDESCRIPTION || pc?.desc || '–';
  const comment = (params.Comment && params.Comment[0] === '=' ? params[params.Comment.slice(1)] : params.Comment) || params.Value || '–';
  const lib = rec.LIBREFERENCE || pc?.lib || '';
  const bez = [...new Set([comment !== '–' ? comment : '', lib].filter(Boolean))].join(' · ') || '–';
  const nr = /^\d{4}$/.test(beak) ? beak[0] + '.' + beak.slice(1) : beak;
  const full = `${des} · ${bez}` + (netTxt ? ` · Netz: ${netTxt}` : '') + ` · ${nr}`;
  const h = `<div class="einzeile zeile2" title="${esc(full)}"><span class="links"><span class="nr">${esc(des)}</span><span class="bez">${esc(bez)}</span>${netTxt ? `<span class="netz"> · Netz: <b>${esc(netTxt)}</b></span>` : ''}</span><b class="bk">${esc(nr)}</b></div>`;
  el.innerHTML = h; el.hidden = false;
}

// ---------------- Laden ----------------
async function unzip(buf) {
  const u = new Uint8Array(buf), v = new DataView(buf), out = []; let e = u.length - 22; while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--; if (e < 0) throw new Error('ZIP defekt');
  let p = v.getUint32(e + 16, true); const n = v.getUint16(e + 10, true);
  for (let k = 0; k < n; k++) { const meth = v.getUint16(p + 10, true), cs = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
    const name = new TextDecoder(v.getUint16(p + 8, true) & 0x800 ? 'utf-8' : 'ibm437').decode(u.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
    const ds = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true); const raw = u.slice(ds, ds + cs);
    if (name.endsWith('/')) continue; let data = raw.buffer;
    if (meth === 8) data = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    out.push({ name: name.split('/').pop(), buf: data }); }
  return out;
}
async function load(files) {
  const msg = $('#meldung'); msg.className = 'meldung'; msg.textContent = 'Lade …';
  try {
    let list = []; for (const f of files) { const buf = f.buf || await f.arrayBuffer(); if (/\.zip$/i.test(f.name)) list.push(...await unzip(buf)); else list.push({ name: f.name, buf }); }
    const sch = list.filter(f => /\.schdoc$/i.test(f.name)), pcbList = list.filter(f => /\.pcbdoc$/i.test(f.name)), pcb = pcbList[0], prj = list.find(f => /\.prjpcb$/i.test(f.name));
    if (!sch.length && !pcb) { if (prj) throw new Error('Die Projektdatei verweist nur auf die Dokumente – bitte die .SchDoc und .PcbDoc mit auswählen (oder die ZIP).'); throw new Error('Keine .SchDoc / .PcbDoc gefunden.'); }
    if (prj) { const t = new TextDecoder('windows-1252').decode(prj.buf); const docs = [...t.matchAll(/\[Document(\d+)\][^\[]*?DocumentPath=([^\r\n]*)/g)].sort((x, y) => x[1] - y[1]).map(m => m[2].trim());
      const order = n => { const i = docs.findIndex(d => d.toLowerCase().endsWith(n.toLowerCase())); return i < 0 ? 999 : i; }; sch.sort((a, b) => order(a.name) - order(b.name)); pcbList.sort((a, b) => order(a.name) - order(b.name));
      S.prj = prj.name.replace(/\.prjpcb$/i, ''); } else S.prj = (pcb || sch[0]).name.replace(/\.\w+$/, '');
    S.sheets = sch.map(f => ({ name: f.name, r: renderSch(Altium.parseSch(f.buf)) }));
    const parsed = pcbList.map(f => ({ name: f.name, data: Altium.parsePcb(f.buf) })); expandPanels(parsed);
    S.pcbs = parsed.map(({ name, data }) => ({ name, data, layers: pcbLayers(data), boxes: compBoxes(data) })); S.pcb = S.pcbs[0] || null;
    S.sheet = 0; S.sel = null; msg.textContent = '';
    show();
  } catch (e) { console.error(e); msg.className = 'meldung fehler'; msg.textContent = 'Fehler: ' + e.message; if ($('#v-start').hidden) alert(e.message); }
}
function pcbTitle() { const pt = $('#pcbTitel'), multi = (S.pcbs || []).length > 1; pt.textContent = S.pcb ? noExt(S.pcb.name) + (multi ? ' ▾' : '') : 'Leiterplatte';
  pt.classList.toggle('klickbar', multi); pt.title = S.pcb ? noExt(S.pcb.name) + (multi ? ' – Leiterplatte wählen' : '') : '';
  $('#platMenu').innerHTML = (S.pcbs || []).map((p, i) => `<button data-i="${i}"${p === S.pcb ? ' class="an"' : ''}>${esc(noExt(p.name))}</button>`).join(''); }
function switchPcb(i, keep = true) { if (!S.pcbs[i] || S.pcbs[i] === S.pcb) return; S.pcb = S.pcbs[i]; pcbTitle(); buildLayerPanel(); renderPcb(); pcbPan.fit();
  if (S.dim === '3d') start3d(); if (keep) { highlight(true, 'sch'); info(); if (window.Drei && S.dim === '3d') window.Drei.select(S.sel); } }
function showSheet(fit = true) { const s = curSheet(); $('#schTitel').textContent = s ? noExt(s.name) + (S.sheets.length > 1 ? ' ▾' : '') : 'Schaltplan'; const multi = S.sheets.length > 1; $('#schTitel').classList.toggle('klickbar', multi); $('#schTitel').setAttribute('role', multi ? 'button' : 'heading'); $('#schTitel').title = s ? noExt(s.name) + (multi ? ' – Blatt wählen' : '') : ''; $('#blattMenu').innerHTML = S.sheets.map((x, i) => `<button data-i="${i}"${i === S.sheet ? ' class="an"' : ''}>${i + 1}. ${esc(x.name.replace(/\.schdoc$/i, ''))}</button>`).join(''); $('#svg-sch').innerHTML = s ? s.r.svg : ''; $('#leer-sch').hidden = !!s; if (s) { schPan.bb = s.r.bb; if (fit) schPan.fit(); } highlight(false); }
function show() {
  $('#v-start').hidden = true; $('#v-view').hidden = false; $('#ansichtTabs').hidden = false; $('#sucheWrap').hidden = false;
  $('#projekt').textContent = S.prj || ''; $('#projekt').title = [...S.sheets.map(s => noExt(s.name)), noExt(S.pcb?.name)].filter(Boolean).join('\n');
  const all = new Set(); S.sheets.forEach(s => Object.keys(s.r.comps).forEach(d => all.add(d))); (S.pcbs || []).forEach(p => p.data.comps.forEach(c => all.add(c.des)));
  $('#desListe').innerHTML = [...all].sort((a, b) => a.localeCompare(b, 'de', { numeric: true })).map(d => `<option value="${esc(d)}">`).join('');
  requestAnimationFrame(() => {
    showSheet(true);
    pcbTitle();
    $('#leer-pcb').hidden = !!S.pcb; $('#ebenenKnopf').disabled = !S.pcb;
    if (S.pcb) { buildLayerPanel(); renderPcb(); pcbPan.fit(); if (S.dim === '3d') start3d(); }
    info();
  });
}
// ---------------- 3D ----------------
async function start3d() {
  if (!S.pcb) return; const box = $('#drei'); box.hidden = false; $('#svg-pcb').style.visibility = 'hidden';
  try { if (!window.Drei) { const m = await import('./drei.js'); window.Drei = m.Drei; }
    await window.Drei.show(box, S.pcb, { onPick: des => { S.net = null; select(des, '3d'); }, onPickAt: (x, y) => pick('3d', { x, y: -y }), side: S.side, hidden: S.hidden, pcbLayers, layerColor, outlinePath, textEl, padEl });
    window.Drei.select(S.sel);
  } catch (e) { console.error(e); alert('3D-Ansicht nicht verfügbar: ' + e.message); set2d(); }
}
function set2d() { S.dim = '2d'; $('#drei').hidden = true; $('#svg-pcb').style.visibility = ''; $$('#dim button').forEach(b => b.classList.toggle('an', b.dataset.d === '2d')); window.Drei?.stop?.(); }

// ---------------- Bedienung ----------------
['#datei', '#datei2'].forEach(s => $(s).addEventListener('change', e => { if (e.target.files.length) load([...e.target.files]); e.target.value = ''; }));
const abl = $('#ablage');
document.addEventListener('dragover', e => { e.preventDefault(); abl.classList.add('drueber'); });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) abl.classList.remove('drueber'); });
document.addEventListener('drop', e => { e.preventDefault(); abl.classList.remove('drueber'); if (e.dataTransfer.files.length) load([...e.dataTransfer.files]); });
$('#beispiel').addEventListener('click', async () => {
  const names = ['BNC Adapter.PrjPcb', 'BNC Adapter.SchDoc', 'BNC Adapter.PcbDoc', 'BNC Adapter (Nutzen).PcbDoc'];
  try { const files = await Promise.all(names.map(async n => { const r = await fetch('beispiel/' + encodeURIComponent(n)); if (!r.ok) throw new Error(n); return { name: n, buf: await r.arrayBuffer() }; })); load(files); }
  catch (e) { $('#meldung').className = 'meldung fehler'; $('#meldung').textContent = 'Beispiel nicht gefunden: ' + e.message; }
});
$('#anzeigeKnopf').addEventListener('click', e => { e.stopPropagation(); $('#anzeigeMenu').hidden = !$('#anzeigeMenu').hidden; });
document.addEventListener('click', e => { if (!e.target.closest('#ansichtTabs')) $('#anzeigeMenu').hidden = true; });
$$('#anzeigeMenu button').forEach(b => b.addEventListener('click', () => { $$('#anzeigeMenu button').forEach(x => x.classList.toggle('an', x === b)); const v = $('#v-view'); v.classList.remove('sch', 'pcb', 'beide'); v.classList.add(b.dataset.a); $('#anzeigeMenu').hidden = true; }));
$$('[data-fit]').forEach(b => b.addEventListener('click', () => { if (b.dataset.fit === 'sch') schPan.fit(); else if (S.dim === '3d') window.Drei?.fit(); else pcbPan.fit(); }));
$('#pcbTitel').addEventListener('click', e => { if ((S.pcbs || []).length < 2) return; e.stopPropagation(); $('#platMenu').hidden = !$('#platMenu').hidden; });
document.addEventListener('click', e => { if (!e.target.closest('#platWrap')) $('#platMenu').hidden = true; });
$('#platMenu').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b) return; switchPcb(+b.dataset.i); $('#platMenu').hidden = true; });
$('#schTitel').addEventListener('click', e => { if (S.sheets.length < 2) return; e.stopPropagation(); $('#blattMenu').hidden = !$('#blattMenu').hidden; });
document.addEventListener('click', e => { if (!e.target.closest('#blattWrap')) $('#blattMenu').hidden = true; });
$('#blattMenu').addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b) return; S.sheet = +b.dataset.i; showSheet(true); $('#blattMenu').hidden = true; });
$$('#seite button').forEach(b => b.addEventListener('click', () => { S.side = b.dataset.s; $$('#seite button').forEach(x => x.classList.toggle('an', x === b)); if (!S.pcb) return;
  const k = pcbPan.k(); renderPcb(); const sb = S.sel && pcbSelBox(S.sel); if (sb) pcbPan.center(sb); else { pcbPan.vb.x = -pcbPan.vb.x - pcbPan.vb.w; pcbPan.apply(); } void k; window.Drei?.setSide?.(S.side); }));
$$('#dim button').forEach(b => b.addEventListener('click', () => { $$('#dim button').forEach(x => x.classList.toggle('an', x === b)); if (b.dataset.d === '3d') { S.dim = '3d'; start3d(); } else set2d(); }));
$('#ebenenKnopf').addEventListener('click', () => { $('#ebenen').hidden = !$('#ebenen').hidden; });
$('#ebenen').addEventListener('change', e => { const l = +e.target.dataset.l; if (e.target.checked) S.hidden.delete(l); else S.hidden.add(l); const g = $(`#svg-pcb g[data-l="${l}"]`); if (g) g.style.display = e.target.checked ? '' : 'none'; if (S.dim === '3d') window.Drei?.layers?.(S.hidden); });
$('#ebenen').addEventListener('click', e => { if (e.target.id !== 'alleEb' && e.target.id !== 'kuEb') return; const keep = e.target.id === 'kuEb' ? new Set([1, 32, 74, 901, ...Array.from({ length: 46 }, (_, i) => i + 2).filter(i => i <= 31 || (i >= 39 && i <= 54))]) : null;
  S.hidden = new Set(); if (keep) S.pcb.layers.forEach((_, l) => { if (!keep.has(l)) S.hidden.add(l); }); buildLayerPanel(); renderPcb(); if (S.dim === '3d') window.Drei?.layers?.(S.hidden); });
const sucheAus = () => { const e = { target: $('#suche') }; const v = e.target.value.trim(); if (!v) return select(null); const all = [...$('#desListe').options].map(o => o.value); let m = all.find(d => d.toLowerCase() === v.toLowerCase()); if (!m) { const c = all.filter(d => d.toLowerCase().startsWith(v.toLowerCase())); if (c.length === 1) m = c[0]; } if (m) { e.target.value = m; select(m, 'suche'); } };
$('#suche').addEventListener('change', sucheAus);
$('#sucheWrap').addEventListener('submit', e => { e.preventDefault(); sucheAus(); $('#suche').blur(); });
$('#suche').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sucheAus(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape') select(null); });
const TH = ['system', 'light', 'dark'], THN = { system: 'Anzeige: System', light: 'Anzeige: Hell', dark: 'Anzeige: Dunkel' };
$('#thema').addEventListener('click', () => { const t = TH[(TH.indexOf(window.beakTheme()) + 1) % 3]; window.beakTheme(t); $('#thema').title = THN[t]; });
$('#thema').title = THN[window.beakTheme()];
// Trenner
(() => { const tr = $('#trenner'), panes = $('#panes'); let v = +localStorage.getItem('beak-pcbv-split') || 50; const setv = x => { v = Math.min(85, Math.max(15, x)); panes.style.setProperty('--split', v + '%'); };
  setv(v); let drag = false, x0 = 0, moved = false;
  tr.addEventListener('pointerdown', e => { drag = true; moved = false; x0 = e.clientX; tr.setPointerCapture(e.pointerId); tr.classList.add('zieht'); });
  tr.addEventListener('pointermove', e => { if (!drag) return; if (!moved && Math.abs(e.clientX - x0) < 4) return; moved = true; const r = panes.getBoundingClientRect(); setv((e.clientX - r.left) / r.width * 100); });
  const end = e => { if (!drag) return; drag = false; tr.classList.remove('zieht'); if (e && e.type === 'pointerup' && !moved) setv(50); try { localStorage.setItem('beak-pcbv-split', String(v)); } catch (_) {} };
  tr.addEventListener('pointerup', end); tr.addEventListener('pointercancel', end);
})();
// Dateien über „Öffnen mit“ (installierte App, File Handling API)
if ('launchQueue' in window) window.launchQueue.setConsumer(async p => { if (p.files?.length) load(await Promise.all(p.files.map(h => h.getFile()))); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.PCBV = { S, select, load };

// Responsive Werkzeugleisten: Hamburger, wenn die Knöpfe nicht in eine Zeile passen
(() => {
  const HB = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
  document.querySelectorAll('.pane > .leiste').forEach(l => {
    const f = l.querySelector('.fuell'); if (!f) return;
    const w = document.createElement('div'); w.className = 'werkzeuge';
    while (f.nextSibling) w.appendChild(f.nextSibling);
    const hb = document.createElement('button'); hb.className = 'klein icon hamburger'; hb.title = 'Menü'; hb.setAttribute('aria-label', 'Menü'); hb.setAttribute('aria-expanded', 'false'); hb.innerHTML = HB; hb.hidden = true;
    l.append(hb, w);
    let voll = 0;
    const zu = () => { l.classList.remove('offen'); hb.setAttribute('aria-expanded', 'false'); hb.classList.remove('an'); };
    hb.addEventListener('click', e => { e.stopPropagation(); const o = !l.classList.contains('offen'); l.classList.toggle('offen', o); hb.classList.toggle('an', o); hb.setAttribute('aria-expanded', String(o)); });
    document.addEventListener('pointerdown', e => { if (l.classList.contains('offen') && !w.contains(e.target) && !hb.contains(e.target)) zu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') zu(); });
    const pruefe = () => {
      if (!l.classList.contains('eng')) voll = w.scrollWidth;
      const t = l.querySelector('.titelWrap'), cs = getComputedStyle(l);
      const platz = l.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (t ? t.offsetWidth : 0) - 16;
      const eng = voll > platz;
      if (eng !== l.classList.contains('eng')) { l.classList.toggle('eng', eng); hb.hidden = !eng; if (!eng) zu(); }
    };
    new ResizeObserver(pruefe).observe(l); pruefe();
  });
})();

$('#wversion').textContent = 'PCB Viewer · Version ' + (self.PCBV_VERSION || '');
