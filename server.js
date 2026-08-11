const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_API_KEY, DEFAULT_MODEL } = require("./config");

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, "public");
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const ROOM_KEYS = ["bedroom", "bathroom", "kitchen", "living", "dining", "balcony", "store", "puja", "study", "garage"];
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jsx": "text/babel; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function send(res, code, obj) {
  const body = typeof obj === "string" ? obj : JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": typeof obj === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) { reject(new Error("payload too large")); req.destroy(); }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function extractSvg(text) {
  const cleaned = text.replace(/```(?:xml|svg|html)?/gi, "").trim();
  const start = cleaned.indexOf("<svg");
  if (start === -1) return null;
  const end = cleaned.indexOf("</svg>", start);
  if (end === -1) return null;
  return cleaned.slice(start, end + 6);
}

function validateSvg(svg) {
  if (!svg) return { ok: false, reason: "response did not contain a complete <svg>...</svg> element" };
  if (!/<(?:rect|path|line|polygon|circle)\b/i.test(svg)) return { ok: false, reason: "SVG has no geometry elements" };
  if ((svg.match(/<svg/g) || []).length > 1) return { ok: false, reason: "SVG contains multiple root elements" };
  return { ok: true };
}

const num = (v) => parseFloat(v) || 0;
const ink = (c) => /1b2430|^(?:#?)(?:000000|000|111|333|222|444)$/i.test((c || "").replace("#", ""));
const furn = (c) => /8a93a3|eef0f4|(?:888|999|aaa|bbb|cccccc|ddd|e5e5e5)/i.test((c || "").replace("#", ""));
const ID_M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const compose = (A, B) => ({
  a: A.a * B.a + A.c * B.b,
  b: A.b * B.a + A.d * B.b,
  c: A.a * B.c + A.c * B.d,
  d: A.b * B.c + A.d * B.d,
  e: A.a * B.e + A.c * B.f + A.e,
  f: A.b * B.e + A.d * B.f + A.f
});
function parseTransform(str) {
  let m = { ...ID_M };
  const ops = [];
  for (const g of (str || "").matchAll(/(translate|scale|matrix|rotate)\s*\(([^)]*)\)/g)) {
    const args = (g[2] || "").split(/[,\s]+/).filter(Boolean).map(parseFloat);
    if (g[1] === "translate") ops.push({ a: 1, b: 0, c: 0, d: 1, e: args[0] || 0, f: args[1] || 0 });
    else if (g[1] === "scale") {
      const sx = args[0] || 1, sy = args.length > 1 ? args[1] : sx;
      ops.push({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
    } else if (g[1] === "matrix") {
      if (args.length >= 6) ops.push({ a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] });
    } else if (g[1] === "rotate" && args.length === 1) {
      const th = (args[0] * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
      ops.push({ a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 });
    }
  }
  for (const op of ops) m = compose(m, op);
  return m;
}
function applyT(b, m) {
  const mx = (x, y) => m.a * x + m.c * y + m.e;
  const my = (x, y) => m.b * x + m.d * y + m.f;
  const xs = [mx(b.x, b.y), mx(b.x2, b.y), mx(b.x, b.y2), mx(b.x2, b.y2)];
  const ys = [my(b.x, b.y), my(b.x2, b.y), my(b.x, b.y2), my(b.x2, b.y2)];
  return { x: Math.min(...xs), y: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}
function parseAttrs(str) {
  const attrs = {};
  for (const a of (str || "").matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
  return attrs;
}
function bboxOf(e) {
  const a = e.attrs;
  if (e.tag === "text") {
    const x = num(a.x), y = num(a.y), fs = num(a["font-size"]) || 12;
    const w = (e.label || "A").length * fs * 0.6;
    return { x, y: y - fs, x2: x + w, y2: y + fs * 0.2 };
  }
  if (e.tag === "rect") {
    const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height);
    return { x, y, x2: x + w, y2: y + h };
  }
  if (e.tag === "circle") {
    const cx = num(a.cx), cy = num(a.cy), r = num(a.r);
    return { x: cx - r, y: cy - r, x2: cx + r, y2: cy + r };
  }
  if (e.tag === "ellipse") {
    const cx = num(a.cx), cy = num(a.cy), rx = num(a.rx), ry = num(a.ry);
    return { x: cx - rx, y: cy - ry, x2: cx + rx, y2: cy + ry };
  }
  if (e.tag === "line") {
    const x1 = num(a.x1), y1 = num(a.y1), x2 = num(a.x2), y2 = num(a.y2);
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2) };
  }
  if (e.tag === "polygon") {
    const xs = [], ys = [];
    for (const pair of (a.points || "").match(/[-+]?[\d.]+(?:e[-+]?\d+)?/gi) || []) {
      if (xs.length === ys.length) xs.push(parseFloat(pair)); else ys.push(parseFloat(pair));
    }
    if (!xs.length) return null;
    return { x: Math.min(...xs), y: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }
  {
    const d = (a.d || "").trim();
    if (!d) return null;
    const pts = [];
    let cx = 0, cy = 0, sx = 0, sy = 0, cmd = "";
    let i = 0;
    const num = () => {
      const m = /^[-+]?[\d.]+(?:e[-+]?\d+)?/i.exec(d.slice(i));
      if (!m) return null;
      i += m[0].length;
      while (d[i] === " " || d[i] === ",") i++;
      return parseFloat(m[0]);
    };
    while (i < d.length) {
      const c = d[i];
      if (/[A-Za-z]/.test(c)) { cmd = c; i++; while (d[i] === " " || d[i] === ",") i++; }
      const n = num();
      if (n === null) continue;
      const rel = cmd === cmd.toLowerCase();
      if (cmd.toUpperCase() === "H" || cmd.toUpperCase() === "V") {
        const v = rel ? (cmd.toUpperCase() === "H" ? cx + n : cy + n) : n;
        if (cmd.toUpperCase() === "H") { cx = v; } else { cy = v; }
        pts.push([cx, cy]);
        continue;
      }
      const a1 = rel ? cx + n : n;
      const a2 = num();
      if (a2 === null) continue;
      const a3 = rel ? cy + a2 : a2;
      switch (cmd.toUpperCase()) {
        case "M": case "L": case "T":
          pts.push([a1, a3]); cx = a1; cy = a3;
          if (cmd.toUpperCase() === "M") { sx = cx; sy = cy; cmd = "L"; }
          break;
        case "C": {
          const c1x = a1, c1y = a3;
          const c2x = num(), c2y = num();
          const ex = num(), ey = num();
          if (c2x === null || ey === null) break;
          const e2x = rel ? cx + c2x : c2x;
          const e2y = rel ? cy + c2y : c2y;
          pts.push([c1x, c1y], [e2x, e2y]);
          const e3x = rel ? cx + ex : ex;
          const e3y = rel ? cy + ey : ey;
          pts.push([e3x, e3y]); cx = e3x; cy = e3y;
          break;
        }
        case "S": case "Q": {
          const c1x = a1, c1y = a3;
          const ex = num(), ey = num();
          if (ex === null) break;
          const e2x = rel ? cx + ex : ex;
          const e2y = rel ? cy + ey : ey;
          pts.push([c1x, c1y], [e2x, e2y]); cx = e2x; cy = e2y;
          break;
        }
        case "A": {
          const ex = num(), ey = num();
          if (ex === null) break;
          const e2x = rel ? cx + ex : ex;
          const e2y = rel ? cy + ey : ey;
          pts.push([e2x, e2y]); cx = e2x; cy = e2y;
          break;
        }
        case "Z":
          cx = sx; cy = sy;
          break;
        default:
          break;
      }
      while (d[i] === " " || d[i] === ",") i++;
    }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    if (!xs.length) return null;
    return { x: Math.min(...xs), y: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }
}
function scanSvg(svg) {
  const tokens = [];
  const gStack = [];
  let last = 0;
  let cum = { ...ID_M };
  const re = /<(g|rect|line|circle|ellipse|polygon|path|text)\b([^>]*?)(\/?)>/g;
  const flush = (end) => {
    if (last >= end) return;
    let sk = svg.slice(last, end);
    let idx;
    while ((idx = sk.indexOf("</g>")) !== -1) {
      if (idx > 0) tokens.push(sk.slice(0, idx));
      tokens.push({ tag: "g-close", raw: "</g>" });
      gStack.pop();
      cum = gStack.length ? gStack[gStack.length - 1] : { ...ID_M };
      sk = sk.slice(idx + 4);
    }
    if (sk) tokens.push(sk);
    last = end;
  };
  let m;
  while ((m = re.exec(svg))) {
    flush(m.index);
    const tag = m[1], attrsStr = m[2], selfClose = m[3];
    if (tag === "text" && !selfClose) {
      const closeIdx = svg.indexOf("</text>", re.lastIndex);
      const content = closeIdx === -1 ? "" : svg.slice(re.lastIndex, closeIdx);
      last = closeIdx === -1 ? re.lastIndex : closeIdx + 7;
      tokens.push({ tag: "text", attrs: parseAttrs(attrsStr), raw: `<text${attrsStr}>${content}</text>`, label: content.replace(/<[^>]*>/g, "").trim(), t: cum });
      continue;
    }
    if (tag === "g" && !selfClose) {
      const t = parseTransform(attrsStr.match(/transform="([^"]*)"/)?.[1] || "");
      cum = compose(cum, t);
      gStack.push(cum);
      tokens.push({ tag: "g-open", raw: m[0], t });
      last = re.lastIndex;
      continue;
    }
    tokens.push({ tag, attrs: parseAttrs(attrsStr), raw: m[0], t: cum });
    last = re.lastIndex;
  }
  flush(svg.length);
  return tokens;
}
function rebuildSvg(svg, tokens, replace) {
  let out = "";
  for (const tk of tokens) {
    if (typeof tk === "string") { out += tk; continue; }
    if (tk.tag === "g-open" || tk.tag === "g-close") { out += tk.raw; continue; }
    const r = replace(tk);
    out += r === null ? tk.raw : r;
  }
  return out;
}
function deriveGrid(svg) {
  const scan = scanSvg(svg);
  const elems = scan.filter((t) => typeof t !== "string" && t.tag !== "g-open" && t.tag !== "g-close" && t.tag !== "text");
  const texts = scan.filter((t) => typeof t !== "string" && t.tag === "text");
  const geo = { scan, elems, texts, walls: [], cells: 0, exterior: null };
  geo.bboxT = (e) => {
    const b = bboxOf(e);
    return b ? applyT(b, e.t) : null;
  };
  const exterior = elems
    .filter((e) => e.tag === "rect" && ink(e.attrs.stroke))
    .map((e) => ({ e, b: geo.bboxT(e) }))
    .filter((p) => p.b)
    .sort((p, q) => q.b.x2 - q.b.x - (p.b.x2 - p.b.x))[0];
  if (!exterior) return geo;
  geo.exterior = exterior.b;
  const ex = geo.exterior;
  const iw = ex.x2 - ex.x - 16, ih = ex.y2 - ex.y - 16;
  const fullH = [], fullV = [];
  for (const e of elems) {
    if (e.tag !== "line" || !ink(e.attrs.stroke) || num(e.attrs["stroke-width"]) < 2) continue;
    const b = geo.bboxT(e);
    if (!b) continue;
    if (Math.abs(b.y - b.y2) < 0.01 && b.y > ex.y && b.y < ex.y2 && b.x2 - b.x >= iw * 0.9) fullH.push(b.y);
    if (Math.abs(b.x - b.x2) < 0.01 && b.x > ex.x && b.x < ex.x2 && b.y2 - b.y >= ih * 0.9) fullV.push(b.x);
  }
  fullH.sort((a, b) => a - b);
  fullV.sort((a, b) => a - b);
  const bands = [];
  let py = ex.y + 8;
  let pIdx = 0;
  for (const y of fullH) { bands.push([py, y, pIdx++]); py = y; }
  bands.push([py, ex.y2 - 8, pIdx]);
  for (const [y0, y1] of bands) {
    const cols = [];
    for (const e of elems) {
      if (e.tag !== "line" || !ink(e.attrs.stroke) || num(e.attrs["stroke-width"]) < 2) continue;
      const b = geo.bboxT(e);
      if (!b || Math.abs(b.x - b.x2) > 0.01) continue;
      const vx = b.x;
      if (vx <= ex.x + 1 || vx >= ex.x2 - 1) continue;
      if (b.y <= y0 + 1 && b.y2 >= y1 - 1) cols.push(vx);
    }
    const uniq = [...new Set(cols)].sort((a, b) => a - b);
    for (let c = 0; c <= uniq.length; c++) {
      const x0 = c === 0 ? ex.x + 8 : uniq[c - 1];
      const x1 = c === uniq.length ? ex.x2 - 8 : uniq[c];
      if (x1 - x0 > 8 && y1 - y0 > 8) {
        geo.cells++;
        geo.walls.push({ x0, y0, x1, y1 });
      }
    }
  }
  return geo;
}
function analyzeSvg(svg, s) {
  const problems = [];
  const g = deriveGrid(svg);
  if (!g.exterior) {
    problems.push("No rectangular exterior wall found - the building outline is missing or not rectangular.");
    return problems;
  }
  const ex = g.exterior;
  const expected = s.totalRooms + (s.numFloors > 1 ? 1 : 0);
  if (Math.abs(g.cells - expected) > 1) {
    problems.push(`Room count mismatch: your plan tiles into ${g.cells} rooms but ${expected} were required (${s.totalRooms} rooms${s.numFloors > 1 ? " + staircase" : ""}).`);
  }
  const swingRe = /A\s*-?[\d.]+,\s*-?[\d.]+(?:\s+[\d.-]+){2}\s+1\b/g;
  const swings = (svg.match(swingRe) || []).length;
  if (swings < 1) problems.push("No door swing arcs found - every room needs one.");
  else if (swings < g.cells - 1) problems.push(`Only ${swings} door swing arcs but ${g.cells} rooms exist.`);
  if (s.detail === "advanced" && !/ROOM SCHEDULE/i.test(svg)) {
    problems.push("The ROOM SCHEDULE table is missing.");
  }
  for (const e of g.elems) {
    if (!furn(e.attrs.fill) && !furn(e.attrs.stroke)) continue;
    const b = g.bboxT(e);
    if (!b) continue;
    for (const w of g.walls) {
      if (b.y < w.y0 && b.y2 > w.y0 && b.x2 - w.x0 > 4 && w.x1 - b.x > 4) {
        const pen = Math.min(w.y0 - b.y, b.y2 - w.y0);
        if (pen > 5) problems.push(`Furniture element ${e.tag} crosses a wall near y=${w.y0.toFixed(0)} (penetration ${pen.toFixed(0)} units).`);
        break;
      }
      if (b.x < w.x0 && b.x2 > w.x0 && b.y2 - w.y0 > 4 && w.y1 - b.y > 4) {
        const pen = Math.min(w.x0 - b.x, b.x2 - w.x0);
        if (pen > 5) problems.push(`Furniture element ${e.tag} crosses a wall near x=${w.x0.toFixed(0)} (penetration ${pen.toFixed(0)} units).`);
        break;
      }
    }
  }
  const seen = new Map();
  for (const e of g.elems) {
    const key = e.tag + e.raw.slice(e.raw.indexOf(" ") + 1, e.raw.length - 1).replace(/\s+/g, "");
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  let dups = 0;
  for (const [k, n] of seen) if (n > 1) dups += n - 1;
  if (dups > 2) problems.push(`${dups} duplicated elements found - the same element is drawn more than once.`);
  return problems;
}
function repairGeometry(svg) {
  const g = deriveGrid(svg);
  let clamped = 0, dropped = 0;
  if (!g.exterior || !g.walls.length) return { svg, clamped, dropped };
  const ex = g.exterior;
  const seen = new Set();
  const posOf = (b) => {
    const cx = (b.x + b.x2) / 2, cy = (b.y + b.y2) / 2;
    let best = null, bestScore = -1;
    for (const c of g.walls) {
      if (cx >= c.x0 + 1 && cx <= c.x1 - 1 && cy >= c.y0 + 1 && cy <= c.y1 - 1) return c;
      const ov = Math.max(0, Math.min(b.x2, c.x1) - Math.max(b.x, c.x0)) * Math.max(0, Math.min(b.y2, c.y1) - Math.max(b.y, c.y0));
      if (ov > bestScore) { bestScore = ov; best = c; }
    }
    return best;
  };
  const fitTx = (T, b0, ccx, ccy, sc) => {
    const b0cx = (b0.x + b0.x2) / 2, b0cy = (b0.y + b0.y2) / 2;
    const D = { a: sc, b: 0, c: 0, d: sc, e: ccx - b0cx * sc, f: ccy - b0cy * sc };
    let F;
    if (!(Math.abs(T.a - 1) < 1e-9 && Math.abs(T.d - 1) < 1e-9 && Math.abs(T.e) < 1e-9 && Math.abs(T.f) < 1e-9)) {
      if (Math.abs(T.b) > 1e-9 || Math.abs(T.c) > 1e-9) return null;
      const i = { a: 1 / (T.a || 1), b: 0, c: 0, d: 1 / (T.d || 1), e: -(T.e / (T.a || 1)), f: -(T.f / (T.d || 1)) };
      F = compose(D, i);
    } else {
      F = D;
    }
    if (Math.abs(F.b) < 1e-9 && Math.abs(F.c) < 1e-9) {
      if (Math.abs(F.a - F.d) < 1e-6) {
        const s = Math.abs(F.a - 1) > 1e-4 ? ` scale(${F.a.toFixed(3)})` : "";
        return `translate(${F.e.toFixed(2)} ${F.f.toFixed(2)})${s}`;
      }
      return `matrix(${F.a.toFixed(4)} 0 0 ${F.d.toFixed(4)} ${F.e.toFixed(2)} ${F.f.toFixed(2)})`;
    }
    return `matrix(${F.a.toFixed(4)} ${F.b.toFixed(4)} ${F.c.toFixed(4)} ${F.d.toFixed(4)} ${F.e.toFixed(2)} ${F.f.toFixed(2)})`;
  };
  const replace = (tk) => {
    if (tk.tag === "text") {
      const b = g.bboxT(tk);
      if (!b) return null;
      const cx = (b.x + b.x2) / 2, cy = (b.y + b.y2) / 2;
      if (cx < ex.x || cx > ex.x2 || cy < ex.y || cy > ex.y2) return null;
      let crossing = false;
      for (const w of g.walls) {
        if (b.y < w.y0 && b.y2 > w.y0 && b.x2 - w.x0 > 4 && w.x1 - b.x > 4 && Math.min(w.y0 - b.y, b.y2 - w.y0) > 2) { crossing = true; break; }
        if (b.x < w.x0 && b.x2 > w.x0 && b.y2 - w.y0 > 4 && w.y1 - b.y > 4 && Math.min(w.x0 - b.x, b.x2 - w.x0) > 2) { crossing = true; break; }
      }
      if (!crossing) return null;
      const c = posOf(b);
      if (!c) return null;
      const b0 = applyT(b, { a: 1 / (tk.t.a || 1), b: 0, c: 0, d: 1 / (tk.t.d || 1), e: -(tk.t.e / (tk.t.a || 1)), f: -(tk.t.f / (tk.t.d || 1)) });
      const ccx = (c.x0 + c.x1) / 2, ccy = (c.y0 + c.y1) / 2;
      const t = fitTx(tk.t, b0, ccx, ccy, 1);
      if (!t) return null;
      clamped++;
      return `<g transform="${t}">${tk.raw}</g>`;
    }
    if (!furn(tk.attrs.fill) && !furn(tk.attrs.stroke)) {
      const key = tk.tag + tk.raw.slice(tk.raw.indexOf(" ") + 1, tk.raw.length - 1).replace(/\s+/g, "");
      if (seen.has(key)) { dropped++; return ""; }
      seen.add(key);
      return null;
    }
    const key = tk.tag + tk.raw.slice(tk.raw.indexOf(" ") + 1, tk.raw.length - 1).replace(/\s+/g, "");
    if (seen.has(key)) { dropped++; return ""; }
    seen.add(key);
    const b = g.bboxT(tk);
    if (!b) return null;
    const cx = (b.x + b.x2) / 2, cy = (b.y + b.y2) / 2;
    if (cx > ex.x2 + 20 || cy > ex.y2 + 20) return null;
    if (Math.abs(tk.t.b) > 1e-9 || Math.abs(tk.t.c) > 1e-9) return null;
    const c = posOf(b);
    if (!c) return null;
    if (b.x >= c.x0 + 3 && b.x2 <= c.x1 - 3 && b.y >= c.y0 + 3 && b.y2 <= c.y1 - 3) return null;
    const mw = c.x1 - c.x0 - 6, mh = c.y1 - c.y0 - 6;
    const bw = b.x2 - b.x, bh = b.y2 - b.y;
    if (!bw || !bh) return null;
    let sc = Math.min(1, mw / bw, mh / bh);
    if (sc < 0.35) sc = 0.35;
    const ccx = (c.x0 + c.x1) / 2, ccy = (c.y0 + c.y1) / 2;
    const b0 = applyT(b, { a: 1 / (tk.t.a || 1), b: 0, c: 0, d: 1 / (tk.t.d || 1), e: -(tk.t.e / (tk.t.a || 1)), f: -(tk.t.f / (tk.t.d || 1)) });
    const t = fitTx(tk.t, b0, ccx, ccy, sc);
    if (!t) return null;
    clamped++;
    return `<g transform="${t}">${tk.raw}</g>`;
  };
  const out = rebuildSvg(svg, g.scan, replace);
  return { svg: out, clamped, dropped };
}
function buildRepairPrompt(s, previousSvg, problems, originalPrompt) {
  return `You are a professional architectural drafter. Your previous floor plan FAILED a geometric QA check. Fix it.

GEOMETRY QA REPORT (exact problems to fix):
${problems.map((p, i) => `${i + 1}. ${p}`).join("\n")}

The previous output is shown below as REFERENCE ONLY. DISCARD it and draw a brand-new, complete floor plan that satisfies EVERY requirement of the original drafting specification, which is included in full at the end of this message.

HARD FIX RULES:
- Rooms must form an exact axis-aligned rectangular grid that fully tiles the interior - shared wall lines only, no gaps, no overlaps, no extra rooms.
- Wall lines must end exactly where they meet another wall (shared endpoints), at right angles.
- Every furniture element must fit 100% inside its own room and never touch or cross a wall line.
- Never draw the same element more than once.
- Output ONLY the complete corrected raw SVG, and nothing else. The final characters must be "</svg>".

PREVIOUS FAILED PLAN (reference only):
${previousSvg}

ORIGINAL DRAFTING SPECIFICATION (follow completely):
${originalPrompt}`;
}

function sanitizeSpecs(raw) {
  const s = raw || {};
  const num = (v, d) => {
    const n = Number(v);
    return isFinite(n) && n > 0 ? n : d;
  };
  const floor = s.floor && typeof s.floor === "object" ? s.floor : {};
  const rooms = {};
  for (const k of ROOM_KEYS) rooms[k] = Math.max(0, Math.round(Number(floor.rooms && floor.rooms[k]) || 0));
  if (!Object.values(rooms).some((v) => v > 0)) rooms.bedroom = 1;
  const totalRooms = Object.values(rooms).reduce((a, b) => a + b, 0);
  return {
    apiKey: String(s.apiKey || "").trim(),
    model: String(s.model || "").trim() || DEFAULT_MODEL,
    project: String(s.projectTitle || "Untitled Residence").slice(0, 60),
    plotWidth: Math.max(5, Math.min(300, num(s.plotWidth, 30))),
    plotLength: Math.max(5, Math.min(300, num(s.plotLength, 40))),
    unit: s.unit === "m" ? "m" : "ft",
    label: String(floor.label || "Floor").slice(0, 30),
    floorIndex: Math.max(0, Math.round(Number(s.floorIndex)) || 0),
    numFloors: Math.max(1, Math.min(6, Math.round(Number(s.numFloors)) || 1)),
    notes: String(floor.notes || "").slice(0, 300),
    detail: s.detail === "basic" ? "basic" : "advanced",
    rooms,
    totalRooms
  };
}

function buildPromptNvidia(s) {
  const areaUnit = s.unit === "ft" ? "sq ft" : "sq m";
  const roomsList = ROOM_KEYS.filter((k) => s.rooms[k] > 0)
    .map((k) => `- ${s.rooms[k]} x ${ROOM_LABELS[k]}`)
    .join("\n") || "- 1 x Multipurpose Room";
  const staircase = s.numFloors > 1 ? "\n- 1 x Staircase (connects to the other floors, same position every floor)" : "";

  const base = `You are a professional architectural drafter. Generate a precise 2D top-down architectural floor plan as raw SVG code for the following floor of a building.

PROJECT: ${s.project}
PLOT SIZE: ${s.plotWidth} x ${s.plotLength} ${s.unit} (width x length)
FLOOR: ${s.label} (floor ${s.floorIndex + 1} of ${s.numFloors})

ROOMS REQUIRED ON THIS FLOOR:
${roomsList}${staircase}
${s.notes ? `ADDITIONAL NOTES: ${s.notes}` : ""}

STRICT REQUIREMENTS:
- Output ONLY raw SVG code. No markdown fences, no explanation, no comments, nothing before "<svg" or after "</svg>". The final characters of your reply must be "</svg>".
- viewBox="0 0 900 700". No external fonts, images, or scripts.
- Draw the exterior wall as a rectangle scaled proportionally to the plot's width:length ratio, wall thickness 6, stroke "#1B2430", fill "none".
- Divide the interior into exactly the rooms listed above using thinner partition walls (stroke-width 3, stroke "#1B2430"). Rooms must NOT overlap, must fully tile the interior, and must stay inside the exterior boundary. Fixed, consistent geometry, every corner a right angle.
- In every room: centered room-name text (font-family monospace, font-size 13, fill "#1B2430") and, on the line below, its approximate floor area in ${areaUnit} (font-size 10, fill "#5B6472").
- Leave a small gap (about 16 units wide) in one wall of each room as a schematic door opening. Do not draw a swing arc.
- Add exterior dimension numbers (e.g. "${Math.round(s.plotWidth)}") along the top and left edges of the building, font-family monospace, font-size 11, fill "#1B2430".
- Add a small north arrow (simple triangle plus the letter "N") in the top-right corner.
- Add small text "SCHEMATIC - NOT TO EXACT SCALE" near the bottom, font-size 9, fill "#5B6472".
- No gradients, shadows, filters, or decorative flourishes. Clean line drawing only.`;

  if (s.detail === "basic") return base;

  return base + `

ADVANCED DRAFTING REQUIREMENTS - draw in THIS exact order. Every numbered part is MANDATORY; a reviewer checks each one appears:
1. ROOMS: exterior wall (stroke-width 8) and partition walls (stroke-width 4) tiling the interior. Tiling must be a perfect axis-aligned rectangular grid: rooms share full wall lines, no gaps, no overlaps, no extra rooms; every wall line must end exactly at another wall (shared endpoints). Every room gets ONE door opening: a gap ~22 wide, a door-leaf line ~18 long from the jamb, and a 90-degree swing arc (radius ~18) drawn with a <path> using an arc command (e.g. "A18,18 0 0 1"). Every room must have exactly one swing. Never draw the same element twice.
2. WINDOWS: on exterior walls only, draw window symbols as two parallel thin lines crossing the wall (about 8 units apart), centered on the wall. Every bedroom, living room and kitchen gets at least one window; bathrooms and study at least one.
3. FURNITURE: light grey #8A93A3 thin 1px schematic symbols, small and neat, drawn FULLY INSIDE the room they belong to - the bounding box of a symbol must never touch a wall line (leave at least 6 units of clearance):
   - Bedroom: double bed = rectangle ~70x48 with two small pillow squares at the head; a wardrobe rectangle near one wall.
   - Bathroom: WC = ellipse (rx~10, ry~13) with a seat line; washbasin = small circle r=9 on a counter line.
   - Kitchen: counter strip along one wall (light fill #EEF0F4, stroke 1) with a sink circle r=9 and a 4-burner stove (small rect with 4 tiny circles).
   - Dining: table rectangle ~72x40 with four small chair squares.
   - Living: sofa rectangle ~64x28 with a backrest line, TV stand rect, small coffee table circle.
   - Study: desk rectangle ~64x26 and a chair square.
   - Puja: small shrine rectangle with a pointed arch top.
   - Garage: simple car = rounded rectangle ~90x44 with a cabin trapezoid line.
   - Balcony (if any): railing dashes along the outer edge (stroke-dasharray).
   - Staircase room: realistic stair symbol - interleaved step segments (stroke ~1.5) with a small UP arrow and handrail line. Same position on every floor (note this in <text>).
4. ROOM NUMBERS: small circle r=9 (stroke #5B6472, white fill) in the top-left corner of every room with the room number inside (monospace 9px).
5. DIMENSIONS: architectural dimension lines on ALL FOUR sides, OUTSIDE the building edges - an offset line ~16 from the wall with small 45-degree extension ticks at the ends, dimension text above it: overall width ${s.plotWidth} ${s.unit} on top and bottom, overall length ${s.plotLength} ${s.unit} on left and right, PLUS one internal division dimension per side. All dimensions must sit outside the walls, never inside a room.
6. ROOM SCHEDULE: a ruled table in the bottom-right of the canvas titled "ROOM SCHEDULE", columns NO | ROOM | AREA (${s.areaUnit}). CRITICAL: it must list EVERY room number exactly once - if the plan has ${s.totalRooms} rooms the table needs ${s.totalRooms}+2 rows including header (make the table tall enough). Match the room numbers from part 4 exactly. Realistic areas in ${s.areaUnit} based on the plotted room sizes. End the table with a TOTAL row summing all room areas.
7. ANNOTATION BLOCKS: LEGEND bottom-left (WALL = thick line, PARTITION = thin line, DOOR = arc, WINDOW = double line, FURNITURE = light line); segmented SCALE BAR (0-2-4-6 ${s.unit}) near the north arrow; north arrow top-right; "SCHEMATIC - NOT TO EXACT SCALE" centered near the bottom.
8. PLOT BOUNDARY: a thin dashed rectangle (stroke-dasharray "10 5") drawn around the whole building, offset about 24 units outside the exterior wall, labelled "PLOT" near its top edge. It must not touch the dimension lines or any other annotation.
9. SHEET PRESENTATION - the drawing must look like a professional architectural sheet:
   - Drawing frame: two thin rectangles inset ~10 and ~20 units from the canvas edge.
   - RENDER THE EXTERIOR WALL AS A DOUBLE LINE: an outer stroke ~8 thick plus an inner line ~6 units inside the wall, both in #1B2430 (the building outline reads as a real wall, not a single hairline).
   - Title block: a ruled strip along the bottom (y 620-676) spanning the full width with fields PROJECT, FLOOR, SCALE 1:100, SHEET (A-101, A-201...), DATE, all in uppercase monospace with small field captions.
   - All labels uppercase monospace; small centered note "SCHEMATIC - NOT TO EXACT SCALE" between the schedule/legend and the title block.
   - Grayscale hierarchy: walls #1B2430, annotations/dimensions #5B6472, furniture #8A93A3, white background.
Keep the remaining rules: compact output (one element per line, no HTML comments, no filler), everything within viewBox 900 700, no overlap between rooms, panels, schedule, legend, frame and title block. End with a closing </svg>.`;
}

const ROOM_LABELS = {
  bedroom: "Bedroom",
  bathroom: "Bathroom / Toilet",
  kitchen: "Kitchen",
  living: "Living Room",
  dining: "Dining Room",
  balcony: "Balcony",
  store: "Store Room",
  puja: "Puja / Prayer Room",
  study: "Study / Office",
  garage: "Garage / Parking"
};

async function callNvidia(apiKey, model, messages) {
  const controller = new AbortController();
  const hardTimer = setTimeout(() => controller.abort(), 540_000);
  const t0 = Date.now();
  try {
    const r = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: 24000, stream: true }),
      signal: controller.signal,
      headersTimeout: 600_000,
      bodyTimeout: 600_000
    });
    if (!r.ok || !r.body) {
      const text = await r.text();
      throw new Error(`NVIDIA API ${r.status}: ${(text || "empty response").slice(0, 300)}`);
    }
    let acc = "";
    try {
      for await (const chunk of r.body) {
        const lines = Buffer.from(chunk).toString("utf8").split("\n");
        for (const line of lines) {
          const data = line.trim();
          if (!data.startsWith("data:")) continue;
          const payload = data.slice(5).trim();
          if (payload === "[DONE]") continue;
          let json;
          try { json = JSON.parse(payload); } catch { continue; }
          const delta = json.choices && json.choices[0] && json.choices[0].delta;
          if (delta && typeof delta.content === "string") acc += delta.content;
          if (json.choices && json.choices[0] && json.choices[0].finish_reason) break;
          if (acc.includes("</svg>")) {
            console.log(`[nvidia] ${model} done in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${acc.length} chars`);
            await r.body.cancel().catch(() => {});
            return acc;
          }
        }
      }
    } catch (e) {
      if (e && e.name === "AbortError" && acc.includes("</svg>")) return acc;
      throw e;
    }
    console.log(`[nvidia] ${model} stream ended in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${acc.length} chars`);
    return acc;
  } finally {
    clearTimeout(hardTimer);
  }
}

const FILLS = {
  bedroom: "#E6F1FB",
  bathroom: "#E1F5EE",
  kitchen: "#FAEEDA",
  living: "#EAF4E4",
  dining: "#FBF0D9",
  balcony: "#EDEFF2",
  store: "#EFEFEF",
  puja: "#FBE9DC",
  study: "#EAE6F2",
  garage: "#E9E9E9"
};

function glyph(kind, x, y, w, h) {
  const u = Math.min(w, h);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const s = "#8A93A3";
  const f = (v) => v.toFixed(1);
  switch (kind) {
    case "bedroom": {
      const bw = u * 0.6, bh = u * 0.4;
      const bx = cx - bw / 2, by = cy - bh / 2;
      let g = `<rect x="${f(bx)}" y="${f(by)}" width="${f(bw)}" height="${f(bh)}" fill="none" stroke="${s}" stroke-width="1"/>`;
      g += `<rect x="${f(bx + 3)}" y="${f(by + 3)}" width="${f(bw * 0.28)}" height="${f(bh * 0.16)}" fill="none" stroke="${s}" stroke-width="1"/>`;
      g += `<rect x="${f(bx + bw - 3 - bw * 0.28)}" y="${f(by + 3)}" width="${f(bw * 0.28)}" height="${f(bh * 0.16)}" fill="none" stroke="${s}" stroke-width="1"/>`;
      return g;
    }
    case "bathroom": {
      let g = `<ellipse cx="${f(cx + u * 0.15)}" cy="${f(cy)}" rx="${f(u * 0.13)}" ry="${f(u * 0.17)}" fill="none" stroke="${s}" stroke-width="1"/>`;
      g += `<circle cx="${f(cx - u * 0.16)}" cy="${f(cy)}" r="${f(u * 0.1)}" fill="none" stroke="${s}" stroke-width="1"/>`;
      return g;
    }
    case "kitchen": {
      let g = `<rect x="${f(x + w * 0.12)}" y="${f(y + h * 0.6)}" width="${f(w * 0.76)}" height="${f(h * 0.2)}" fill="#EEF0F4" stroke="${s}" stroke-width="1"/>`;
      g += `<circle cx="${f(x + w * 0.3)}" cy="${f(y + h * 0.7)}" r="${f(u * 0.08)}" fill="none" stroke="${s}" stroke-width="1"/>`;
      const sx = x + w * 0.62, sy = y + h * 0.7;
      g += `<rect x="${f(sx)}" y="${f(sy - u * 0.09)}" width="${f(u * 0.18)}" height="${f(u * 0.18)}" fill="none" stroke="${s}" stroke-width="1"/>`;
      for (const [dx, dy] of [[3, 3], [3, -3], [-3, 3], [-3, -3]]) {
        g += `<circle cx="${f(sx + u * 0.09 + dx)}" cy="${f(sy + dy)}" r="1.6" fill="${s}"/>`;
      }
      return g;
    }
    case "dining": {
      const tw = u * 0.5, th = u * 0.26;
      let g = `<rect x="${f(cx - tw / 2)}" y="${f(cy - th / 2)}" width="${f(tw)}" height="${f(th)}" fill="none" stroke="${s}" stroke-width="1"/>`;
      const cs = u * 0.09;
      for (const [qx, qy] of [[cx - tw / 2 - cs, cy], [cx + tw / 2, cy], [cx, cy - th / 2 - cs], [cx, cy + th / 2]]) {
        g += `<rect x="${f(qx - cs / 2)}" y="${f(qy - cs / 2)}" width="${f(cs)}" height="${f(cs)}" fill="none" stroke="${s}" stroke-width="1"/>`;
      }
      return g;
    }
    case "living": {
      const sw = u * 0.6, sh = u * 0.24;
      const sx = cx - sw / 2, sy = cy - sh / 2;
      let g = `<rect x="${f(sx)}" y="${f(sy)}" width="${f(sw)}" height="${f(sh)}" fill="none" stroke="${s}" stroke-width="1"/>`;
      g += `<line x1="${f(sx)}" y1="${f(sy + sh)}" x2="${f(sx + sw)}" y2="${f(sy + sh)}" stroke="${s}" stroke-width="1" stroke-dasharray="4 3"/>`;
      g += `<circle cx="${f(cx + u * 0.18)}" cy="${f(cy + sh / 2 + u * 0.12)}" r="${f(u * 0.09)}" fill="none" stroke="${s}" stroke-width="1"/>`;
      return g;
    }
    case "study": {
      const dw = u * 0.56, dt = u * 0.2;
      let g = `<rect x="${f(cx - dw / 2)}" y="${f(cy - dt / 2)}" width="${f(dw)}" height="${f(dt)}" fill="none" stroke="${s}" stroke-width="1"/>`;
      g += `<rect x="${f(cx - dw / 2 + u * 0.2)}" y="${f(cy + dt / 2 - 2)}" width="${f(u * 0.1)}" height="${f(u * 0.1)}" fill="none" stroke="${s}" stroke-width="1"/>`;
      return g;
    }
    case "puja": {
      const pw = u * 0.26, ph = u * 0.34;
      const px = cx - pw / 2, py = cy - ph / 2;
      let g = `<path d="M${f(px)},${f(py + ph)} L${f(px)},${f(py + ph * 0.55)} Q${f(cx)},${f(py - ph * 0.25)} ${f(px + pw)},${f(py + ph * 0.55)} L${f(px + pw)},${f(py + ph)} Z" fill="none" stroke="${s}" stroke-width="1"/>`;
      g += `<circle cx="${f(cx)}" cy="${f(py + ph * 0.7)}" r="1.8" fill="${s}"/>`;
      return g;
    }
    case "garage": {
      const cw = u * 0.6, ch = u * 0.26;
      const cxx = cx - cw / 2, cyy = cy - ch / 2;
      let g = `<rect x="${f(cxx)}" y="${f(cyy)}" width="${f(cw)}" height="${f(ch)}" rx="${f(u * 0.07)}" fill="none" stroke="${s}" stroke-width="1"/>`;
      g += `<path d="M${f(cxx + cw * 0.28)},${f(cyy)} L${f(cxx + cw * 0.42)},${f(cyy - ch * 0.28)} L${f(cxx + cw * 0.72)},${f(cyy - ch * 0.28)} L${f(cxx + cw * 0.78)},${f(cyy)}" fill="none" stroke="${s}" stroke-width="1"/>`;
      return g;
    }
    case "balcony":
      return `<line x1="${f(x + w * 0.08)}" y1="${f(y)}" x2="${f(x + w * 0.92)}" y2="${f(y)}" stroke="${s}" stroke-width="1" stroke-dasharray="6 4"/>`;
    case "store": {
      let g = "";
      for (const sy of [h * 0.3, h * 0.5, h * 0.7]) {
        g += `<rect x="${f(x + w * 0.18)}" y="${f(y + sy)}" width="${f(w * 0.64)}" height="${f(h * 0.1)}" fill="none" stroke="${s}" stroke-width="1"/>`;
        g += `<line x1="${f(x + w * 0.18 + w * 0.32)}" y1="${f(y + sy)}" x2="${f(x + w * 0.18 + w * 0.32)}" y2="${f(y + sy + h * 0.1)}" stroke="${s}" stroke-width="0.8"/>`;
      }
      return g;
    }
    default:
      return "";
  }
}

function fallbackBasic(s, names) {
  const n = names.length;
  const plotW = s.plotWidth;
  const plotL = s.plotLength;
  const scale = Math.min(640 / plotW, 440 / plotL);
  const ew = plotW * scale;
  const eh = plotL * scale;
  const ox = (900 - ew) / 2;
  const oy = (700 - eh) / 2;
  const cols = Math.ceil(Math.sqrt((n * ew) / eh));
  const rows = Math.ceil(n / cols);
  const cw = ew / cols;
  const ch = eh / rows;
  let out = `<svg viewBox="0 0 900 700" width="900" height="700" xmlns="http://www.w3.org/2000/svg" font-family="monospace">
  <rect x="0" y="0" width="900" height="700" fill="#ffffff"/>
  <rect x="10" y="10" width="880" height="680" fill="none" stroke="#1B2430" stroke-width="1.5"/>
  <rect x="20" y="20" width="860" height="660" fill="none" stroke="#5B6472" stroke-width="0.75"/>
  <text x="330" y="36" text-anchor="middle" font-size="9" letter-spacing="3" fill="#5B6472">SCHEMATIC FLOOR PLAN</text>
  <rect x="${ox.toFixed(1)}" y="${oy.toFixed(1)}" width="${ew.toFixed(1)}" height="${eh.toFixed(1)}" fill="none" stroke="#1B2430" stroke-width="6"/>`;
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = ox + c * cw;
    const y = oy + r * ch;
    out += `\n  <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" fill="none" stroke="#1B2430" stroke-width="3"/>`;
    out += `\n  <text x="${(x + cw / 2).toFixed(1)}" y="${(y + ch / 2 - 3).toFixed(1)}" text-anchor="middle" font-size="13" fill="#1B2430">${names[i]}</text>`;
    out += `\n  <text x="${(x + cw / 2).toFixed(1)}" y="${(y + ch / 2 + 13).toFixed(1)}" text-anchor="middle" font-size="10" fill="#5B6472">~${s.perRoom} ${s.areaUnit}</text>`;
  }
  out += `\n  <text x="${(ox + ew / 2).toFixed(1)}" y="${(oy - 14).toFixed(1)}" text-anchor="middle" font-size="11" fill="#1B2430">${plotW}</text>`;
  out += `\n  <text x="${(ox - 16).toFixed(1)}" y="${(oy + eh / 2).toFixed(1)}" text-anchor="middle" font-size="11" fill="#1B2430" transform="rotate(-90 ${(ox - 16).toFixed(1)} ${(oy + eh / 2).toFixed(1)})">${plotL}</text>`;
  out += `\n  <g transform="translate(830,${oy + 8})">
    <path d="M0,0 L-5,9 L5,9 Z" fill="#1B2430"/>
    <line x1="0" y1="0" x2="0" y2="-16" stroke="#1B2430" stroke-width="2"/>
    <text x="0" y="-22" text-anchor="middle" font-size="11" fill="#1B2430">N</text>
  </g>`;
  out += `\n  <line x1="20" y1="610" x2="880" y2="610" stroke="#1B2430" stroke-width="1.5"/>`;
  out += `\n  <line x1="20" y1="676" x2="880" y2="676" stroke="#1B2430" stroke-width="1.5"/>`;
  out += `\n  <line x1="20" y1="656" x2="880" y2="656" stroke="#5B6472" stroke-width="0.75"/>`;
  for (const sx of [300, 480, 610, 730]) out += `\n  <line x1="${sx}" y1="610" x2="${sx}" y2="676" stroke="#5B6472" stroke-width="0.75"/>`;
  const tb = [
    ["PROJECT", String(s.project).toUpperCase().slice(0, 28), 26],
    ["FLOOR", String(s.label).toUpperCase().slice(0, 18), 306],
    ["SCALE", "NTS", 486],
    ["SHEET", `A-10${s.floorIndex + 1}`, 616],
    ["DATE", new Date().toLocaleDateString("en-US"), 736]
  ];
  for (const [k, v, tx] of tb) {
    out += `\n  <text x="${tx}" y="632" font-size="7" letter-spacing="2" fill="#5B6472">${k}</text>`;
    out += `\n  <text x="${tx}" y="642" font-size="10" font-weight="bold" fill="#1B2430">${v}</text>`;
  }
  out += `\n  <text x="450" y="669" text-anchor="middle" font-size="8" letter-spacing="1" fill="#5B6472">SCHEMATIC - NOT TO EXACT SCALE &middot; DRAFT FOR APPROVAL</text>
</svg>`;
  return out;
}

function fallbackAdvanced(s, names, kinds) {
  const n = names.length;
  const plotW = s.plotWidth;
  const plotL = s.plotLength;
  const scale = Math.min(440 / plotW, 460 / plotL);
  const ew = plotW * scale;
  const eh = plotL * scale;
  const ox = 60;
  const oy = 70;
  const cols = Math.ceil(Math.sqrt((n * ew) / eh));
  const rows = Math.ceil(n / cols);
  const cw = ew / cols;
  const ch = eh / rows;
  const ink = "#1B2430";
  const mid = "#5B6472";
  const f = (v) => v.toFixed(1);
  const line = (x1, y1, x2, y2, c = mid, w = 1) => `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${c}" stroke-width="${w}"/>`;
  let out = `<svg viewBox="0 0 900 700" width="900" height="700" xmlns="http://www.w3.org/2000/svg" font-family="monospace">
  <defs>
    <pattern id="bath" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="8" stroke="#C9D6D2" stroke-width="1"/>
    </pattern>
  </defs>
  <rect x="0" y="0" width="900" height="700" fill="#ffffff"/>
  <rect x="10" y="10" width="880" height="680" fill="none" stroke="${ink}" stroke-width="1.5"/>
  <rect x="20" y="20" width="860" height="660" fill="none" stroke="${mid}" stroke-width="0.75"/>
  <text x="330" y="36" text-anchor="middle" font-size="9" letter-spacing="3" fill="${mid}">SCHEMATIC FLOOR PLAN</text>`;
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = ox + c * cw;
    const y = oy + r * ch;
    const fill = FILLS[kinds[i]] || "#F5F5F5";
    const bathFill = kinds[i] === "bathroom" ? "url(#bath)" : fill;
    out += `\n  <rect x="${f(x)}" y="${f(y)}" width="${f(cw)}" height="${f(ch)}" fill="${bathFill}" stroke="${ink}" stroke-width="3"/>`;
    out += `\n  <rect x="${f(x)}" y="${f(y)}" width="${f(cw)}" height="3" fill="${ink}"/>`;
    out += `\n  <circle cx="${f(x + 17)}" cy="${f(y + 17)}" r="9" fill="#ffffff" stroke="${mid}" stroke-width="1"/>`;
    out += `\n  <text x="${f(x + 17)}" y="${f(y + 20)}" text-anchor="middle" font-size="9" fill="${ink}">${i + 1}</text>`;
    out += `\n  <text x="${f(x + cw / 2)}" y="${f(y + ch / 2 - (ch > 78 ? 16 : 10))}" text-anchor="middle" font-size="12" fill="${ink}">${names[i]}</text>`;
    if (ch > 78) out += `\n  <text x="${f(x + cw / 2)}" y="${f(y + ch / 2 + 2)}" text-anchor="middle" font-size="10" fill="${mid}">~${s.perRoom} ${s.areaUnit}</text>`;
    out += glyph(kinds[i], x, y, cw, ch);
    const dg = 12;
    out += `\n  <rect x="${f(x + cw / 2 - dg / 2)}" y="${f(y + ch - 1.5)}" width="${dg}" height="3" fill="#ffffff"/>`;
    out += `\n  <path d="M${f(x + cw / 2 - dg / 2)},${f(y + ch)} A${f(dg / 2)},${f(dg / 2)} 0 0 1 ${f(x + cw / 2)},${f(y + ch - dg / 2)}" fill="none" stroke="${mid}" stroke-width="1"/>`;
    if (r === 0 && cw > 60) {
      const wx = x + cw * 0.3;
      out += line(wx, y - 4, wx + cw * 0.4, y - 4, mid, 1.5);
      out += line(wx, y + 4, wx + cw * 0.4, y + 4, mid, 1.5);
    }
  }
  out += line(ox, oy - 16, ox + ew, oy - 16);
  out += line(ox, oy - 22, ox + 9, oy - 11);
  out += line(ox + ew, oy - 22, ox + ew - 9, oy - 11);
  const v1 = Math.round(plotW * (cw / ew));
  out += line(ox, oy - 34, ox + cw, oy - 34);
  out += line(ox, oy - 40, ox + 9, oy - 29);
  out += line(ox + cw, oy - 40, ox + cw - 9, oy - 29);
  out += `\n  <text x="${f(ox + ew / 2)}" y="${f(oy - 22)}" text-anchor="middle" font-size="10" fill="${mid}">${plotW}</text>`;
  out += `\n  <text x="${f(ox + cw / 2)}" y="${f(oy - 40)}" text-anchor="middle" font-size="9" fill="${mid}">${v1}</text>`;
  out += line(ox, oy + eh + 16, ox + ew, oy + eh + 16);
  out += line(ox, oy + eh + 11, ox + 9, oy + eh + 21);
  out += line(ox + ew, oy + eh + 11, ox + ew - 9, oy + eh + 21);
  out += `\n  <text x="${f(ox + ew / 2)}" y="${f(oy + eh + 30)}" text-anchor="middle" font-size="10" fill="${mid}">${plotW}</text>`;
  out += line(ox - 16, oy, ox - 16, oy + eh);
  out += line(ox - 22, oy, ox - 11, oy + 9);
  out += line(ox - 22, oy + eh, ox - 11, oy + eh - 9);
  const v2 = Math.round(plotL * (ch / eh));
  out += line(ox - 34, oy, ox - 34, oy + ch);
  out += line(ox - 40, oy, ox - 29, oy + 9);
  out += line(ox - 40, oy + ch, ox - 29, oy + ch - 9);
  out += `\n  <text x="${f(ox - 24)}" y="${f(oy + eh / 2)}" text-anchor="middle" font-size="10" fill="${mid}" transform="rotate(-90 ${f(ox - 24)} ${f(oy + eh / 2)})">${plotL}</text>`;
  out += `\n  <text x="${f(ox - 42)}" y="${f(oy + ch / 2)}" text-anchor="middle" font-size="9" fill="${mid}" transform="rotate(-90 ${f(ox - 42)} ${f(oy + ch / 2)})">${v2}</text>`;
  out += line(ox + ew + 16, oy, ox + ew + 16, oy + eh);
  out += line(ox + ew + 11, oy, ox + ew + 21, oy + 9);
  out += line(ox + ew + 11, oy + eh, ox + ew + 21, oy + eh - 9);
  out += `\n  <text x="${f(ox + ew + 26)}" y="${f(oy + eh / 2)}" text-anchor="middle" font-size="10" fill="${mid}" transform="rotate(90 ${f(ox + ew + 26)} ${f(oy + eh / 2)})">${plotL}</text>`;
  out += `\n  <g transform="translate(845,46)">
    <path d="M0,0 L-5,9 L5,9 Z" fill="${ink}"/>
    <line x1="0" y1="0" x2="0" y2="-16" stroke="${ink}" stroke-width="2"/>
    <text x="0" y="-22" text-anchor="middle" font-size="11" fill="${ink}">N</text>
  </g>`;
  const sry = 76;
  out += line(700, sry, 820, sry, ink, 2);
  for (const off of [0, 40, 80, 120]) {
    out += line(700 + off, sry - 5, 700 + off, sry + 5, ink, 2);
  }
  out += `\n  <text x="702" y="${f(sry - 9)}" font-size="9" fill="${mid}">0</text>`;
  out += `\n  <text x="738" y="${f(sry - 9)}" font-size="9" fill="${mid}">2</text>`;
  out += `\n  <text x="776" y="${f(sry - 9)}" font-size="9" fill="${mid}">4</text>`;
  out += `\n  <text x="814" y="${f(sry - 9)}" font-size="9" fill="${mid}">6</text>`;
  out += `\n  <text x="824" y="${f(sry + 3)}" font-size="9" fill="${mid}">${s.unit.trim()}</text>`;
  let sy = 130;
  out += `\n  <text x="580" y="${f(sy - 22)}" font-size="11" font-weight="bold" fill="${ink}">ROOM SCHEDULE</text>`;
  out += `\n  <text x="580" y="${f(sy - 10)}" font-size="8" fill="${mid}">${s.label} &middot; ${n} SPACES</text>`;
  out += line(580, sy, 878, sy, ink, 1.5);
  out += line(580, sy + 16, 580, sy + 8 + 16 + Math.min(n, 13) * 14 + 34, ink, 1);
  out += line(616, sy + 16, 616, sy + 8 + 16 + Math.min(n, 13) * 14 + 34, ink, 1);
  out += line(766, sy + 16, 766, sy + 8 + 16 + Math.min(n, 13) * 14 + 34, ink, 1);
  out += line(878, sy + 16, 878, sy + 8 + 16 + Math.min(n, 13) * 14 + 34, ink, 1);
  out += `\n  <text x="584" y="${f(sy + 22)}" font-size="9" fill="${ink}">NO</text>`;
  out += `\n  <text x="622" y="${f(sy + 22)}" font-size="9" fill="${mid}">ROOM</text>`;
  out += `\n  <text x="872" y="${f(sy + 22)}" text-anchor="end" font-size="9" fill="${mid}">AREA (${s.areaUnit})</text>`;
  line(580, sy + 26, 878, sy + 26);
  for (let i = 0; i < Math.min(n, 13); i++) {
    const ry = sy + 40 + i * 14;
    out += `\n  <text x="598" y="${f(ry)}" text-anchor="middle" font-size="9" fill="${ink}">${i + 1}</text>`;
    out += `\n  <text x="622" y="${f(ry)}" font-size="9" fill="${ink}">${names[i]}</text>`;
    out += `\n  <text x="872" y="${f(ry)}" text-anchor="end" font-size="9" fill="${ink}">${s.perRoom}</text>`;
    out += line(580, ry + 7, 878, ry + 7, mid, 0.5);
  }
  const totalY = sy + 40 + Math.min(n, 13) * 14;
  out += line(580, totalY + 3, 878, totalY + 3, ink, 1.5);
  out += `\n  <text x="622" y="${f(totalY + 11)}" font-size="9" font-weight="bold" fill="${ink}">TOTAL</text>`;
  out += `\n  <text x="872" y="${f(totalY + 11)}" text-anchor="end" font-size="9" font-weight="bold" fill="${ink}">${s.perRoom * Math.min(n, 13)}</text>`;
  out += `\n  <text x="580" y="400" font-size="11" font-weight="bold" fill="${ink}">LEGEND</text>`;
  const lx = 584;
  let ly = 414;
  const leg = [
    () => [`<line x1="${f(lx)}" y1="${f(ly - 1)}" x2="${f(lx + 28)}" y2="${f(ly - 1)}" stroke="${ink}" stroke-width="4"/>`, "WALL"],
    () => [`<line x1="${f(lx)}" y1="${f(ly - 1)}" x2="${f(lx + 28)}" y2="${f(ly - 1)}" stroke="${ink}" stroke-width="2"/>`, "PARTITION"],
    () => [`<path d="M${f(lx + 2)},${f(ly + 4)} A7,7 0 0 1 ${f(lx + 16)},${f(ly - 3)}" fill="none" stroke="${mid}" stroke-width="1"/>`, "DOOR"],
    () => [`<line x1="${f(lx)}" y1="${f(ly - 2)}" x2="${f(lx + 28)}" y2="${f(ly - 2)}" stroke="${mid}" stroke-width="1.5"/>`, "WINDOW"],
    () => [`<rect x="${f(lx)}" y="${f(ly - 6)}" width="14" height="9" fill="none" stroke="${mid}" stroke-width="1"/>`, "FURNITURE"],
    () => [`<line x1="${f(lx)}" y1="${f(ly - 1)}" x2="${f(lx + 28)}" y2="${f(ly - 1)}" stroke="${mid}" stroke-width="1" stroke-dasharray="6 4"/>`, "PLOT"]
  ];
  for (const item of leg) {
    const [mk, lb] = item();
    out += "\n  " + mk;
    out += `\n  <text x="${f(lx + 34)}" y="${f(ly + 1)}" font-size="9" fill="${mid}">${lb}</text>`;
    ly += 15;
  }
  out += `\n  <line x1="20" y1="610" x2="880" y2="610" stroke="${ink}" stroke-width="1.5"/>`;
  out += `\n  <line x1="20" y1="676" x2="880" y2="676" stroke="${ink}" stroke-width="1.5"/>`;
  out += `\n  <line x1="20" y1="656" x2="880" y2="656" stroke="${mid}" stroke-width="0.75"/>`;
  for (const sx of [300, 480, 610, 730]) out += line(sx, 610, sx, 676, mid, 0.75);
  const tb = [
    ["PROJECT", String(s.project).toUpperCase().slice(0, 28), 26, 632, 642],
    ["FLOOR", String(s.label).toUpperCase().slice(0, 18), 306, 632, 642],
    ["SCALE", "NTS", 486, 632, 642],
    ["SHEET", `A-10${s.floorIndex + 1}`, 616, 632, 642],
    ["DATE", new Date().toLocaleDateString("en-US"), 736, 632, 642]
  ];
  for (const [k, v, tx, ky, vy] of tb) {
    out += `\n  <text x="${f(tx)}" y="${f(ky)}" font-size="7" letter-spacing="2" fill="${mid}">${k}</text>`;
    out += `\n  <text x="${f(tx)}" y="${f(vy)}" font-size="10" font-weight="bold" fill="${ink}">${v}</text>`;
  }
  out += `\n  <text x="450" y="669" text-anchor="middle" font-size="8" letter-spacing="1" fill="${mid}">SCHEMATIC - NOT TO EXACT SCALE &middot; DRAFT FOR APPROVAL</text>
</svg>`;
  return out;
}

function localFallback(s) {
  const label = (rt) => ROOM_LABELS[rt].split(" / ")[0];
  const names = [];
  const kinds = [];
  for (const k of ROOM_KEYS) {
    for (let i = 0; i < s.rooms[k]; i++) {
      names.push(i === 0 ? label(k) : `${label(k)} ${i + 1}`);
      kinds.push(k);
    }
  }
  const n = Math.min(Math.max(names.length, 1), 20);
  names.length = n;
  kinds.length = n;
  const perRoom = Math.round((s.plotWidth * s.plotLength) / n);
  const areaUnit = s.unit === "ft" ? "sq ft" : "sq m";
  s.perRoom = perRoom;
  s.areaUnit = areaUnit;
  return s.detail === "advanced" ? fallbackAdvanced(s, names, kinds) : fallbackBasic(s, names);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "POST" && url.pathname === "/api/generate") {
      const t0Request = Date.now();
      const body = JSON.parse((await readBody(req)) || "{}");
      const s = sanitizeSpecs(body.specs || {});
      const key = s.apiKey || DEFAULT_API_KEY;
      let svg = null;
      let raw = "";
      let attempts = 0;
      if (!body.local) {
        const tryNvidia = () => attempts < 3 && Date.now() - t0Request < 380_000;
        while (tryNvidia()) {
          attempts++;
          raw = await callNvidia(key, s.model, [{ role: "user", content: buildPromptNvidia(s) }]);
          svg = extractSvg(raw);
          if (svg) break;
          console.log(`[retry] attempt ${attempts} produced no <svg>, retrying...`);
        }
      }
      const check = validateSvg(svg);
      if (svg && !check.ok) return send(res, 502, { ok: false, error: check.reason, raw: raw.slice(0, 2000) });
      const fromNvidia = attempts > 0 && !!svg;
      if (!svg) {
        if (body.local || body.useFallback) svg = localFallback(s);
        else return send(res, 502, { ok: false, error: check.reason, raw: raw ? raw.slice(0, 2000) : "" });
      }
      let issues = [];
      let repaired = false;
      if (fromNvidia && body.autoFix !== false) {
        let rounds = 0;
        const g1 = repairGeometry(svg);
        if (g1.clamped || g1.dropped) console.log(`[geom] clamped ${g1.clamped} element(s) into their rooms, dropped ${g1.dropped} duplicate(s)`);
        svg = g1.svg;
        issues = analyzeSvg(svg, s);
        while (issues.length && rounds < 2 && Date.now() - t0Request < 460_000) {
          console.log(`[repair] QA round ${rounds + 1} found ${issues.length} problems:\n${issues.map((p) => "  - " + p).join("\n")}`);
          const raw2 = await callNvidia(key, s.model, [{ role: "user", content: buildRepairPrompt(s, svg, issues, buildPromptNvidia(s)) }]);
          const svg2 = extractSvg(raw2);
          const check2 = validateSvg(svg2);
          if (!svg2 || !check2.ok) {
            console.log(`[repair] repair output invalid (${svg2 ? check2.reason : "no svg"}), keeping previous plan`);
            break;
          }
          svg = svg2;
          repaired = true;
          rounds++;
          const g2 = repairGeometry(svg);
          if (g2.clamped || g2.dropped) console.log(`[geom] clamped ${g2.clamped} element(s) into their rooms, dropped ${g2.dropped} duplicate(s)`);
          svg = g2.svg;
          issues = analyzeSvg(svg, s);
          console.log(`[repair] done, remaining issues: ${issues.length}`);
        }
      }
      console.log(`[done] request complete in ${((Date.now() - t0Request) / 1000).toFixed(0)}s, ${svg.length} bytes, repaired=${repaired}, remaining issues=${issues.length}`);
      return send(res, 200, { ok: true, svg, local: !fromNvidia, repaired, issues });
    }

    let fp = path.join(PUB, url.pathname === "/" ? "index.html" : url.pathname);
    fp = path.normalize(fp);
    if (!fp.startsWith(PUB)) return send(res, 403, "forbidden");
    if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return send(res, 404, "not found");
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    return res.end(fs.readFileSync(fp));
  } catch (e) {
    const msg = e.message || String(e);
    console.error(`[request] ${url.pathname} failed: ${msg}`);
    if (/abort/i.test(msg)) return send(res, 504, { ok: false, error: "NVIDIA API timed out after 540s - try again or use the local fallback" });
    send(res, 500, { ok: false, error: msg });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`ARCH SVG server running at http://localhost:${PORT}`);
  });
}

module.exports = { buildPromptNvidia, sanitizeSpecs, localFallback, extractSvg, validateSvg, analyzeSvg, buildRepairPrompt, repairGeometry, deriveGrid };