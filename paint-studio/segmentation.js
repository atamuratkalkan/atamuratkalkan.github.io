import { clamp, oklab, labDistance, linearRGB, fromLinear, valueRGB, hexToRgb, colorDistance } from './color.js';

export const DEFAULT_SETTINGS = Object.freeze({ stages: 5, detail: 3, simplification: 3,
  minRegion: 24, underpainting: 'tonal', ground: '#8a6f4d', method: 'mixed' });
export function validateSettings(raw = {}) {
  const number = (key, min, max) => {
    const v = Number(raw[key] ?? DEFAULT_SETTINGS[key]);
    if (!Number.isFinite(v) || v < min || v > max) throw new Error(`Invalid ${key} setting.`);
    return Math.round(v);
  };
  const ground = raw.ground ?? DEFAULT_SETTINGS.ground;
  hexToRgb(ground);
  return { stages: number('stages', 3, 8), detail: number('detail', 1, 5), simplification: number('simplification', 1, 5),
    minRegion: number('minRegion', 1, 500), underpainting: ['none', 'tonal', 'ground'].includes(raw.underpainting) ? raw.underpainting : 'tonal',
    ground, method: ['wet', 'separate', 'mixed'].includes(raw.method) ? raw.method : 'mixed' };
}
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const check = cancelled => { if (cancelled()) throw new DOMException('Stage generation cancelled', 'AbortError'); };

class Heap {
  constructor() { this.a = []; }
  push(v) {
    const a = this.a; let i = a.length; a.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].cost < v.cost || a[p].cost === v.cost && a[p].key <= v.key) break; a[i] = a[p]; i = p; }
    a[i] = v;
  }
  pop() {
    const a = this.a, first = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= a.length) break;
        if (c + 1 < a.length && (a[c + 1].cost < a[c].cost || a[c + 1].cost === a[c].cost && a[c + 1].key < a[c].key)) c++;
        if (last.cost < a[c].cost || last.cost === a[c].cost && last.key <= a[c].key) break;
        a[i] = a[c]; i = c;
      }
      a[i] = last;
    }
    return first;
  }
}
function connectedLabels(labels, width, height) {
  const n = labels.length, result = new Int32Array(n).fill(-1), queue = new Int32Array(n);
  let next = 0;
  for (let start = 0; start < n; start++) {
    if (result[start] !== -1) continue;
    const old = labels[start]; let head = 0, tail = 1; queue[0] = start; result[start] = next;
    while (head < tail) {
      const p = queue[head++], x = p % width;
      const visit = q => { if (q >= 0 && q < n && result[q] === -1 && labels[q] === old) { result[q] = next; queue[tail++] = q; } };
      if (x) visit(p - 1); if (x + 1 < width) visit(p + 1);
      visit(p - width); visit(p + width);
    }
    next++;
  }
  return { labels: result, count: next };
}
export function focalMask(width, height, points = []) {
  const mask = new Uint8Array(width * height);
  for (const point of points) {
    const cx = point.x * width, cy = point.y * height;
    const r = (point.radius ?? .045) * Math.min(width, height);
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(height - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(width - 1, Math.ceil(cx + r)); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) mask[y * width + x] = 1;
      }
    }
  }
  return mask;
}
async function superpixels(data, width, height, settings, focal, progress, cancelled) {
  const n = width * height, labs = new Float32Array(n * 3), linear = new Float32Array(n * 3);
  for (let p = 0; p < n; p++) {
    const rgb = [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]];
    labs.set(oklab(rgb), p * 3); linear.set(linearRGB(rgb), p * 3);
  }
  const spacing = 15 - settings.detail * 1.7;
  const seeds = [];
  const gradient = (x, y) => {
    const p = (y * width + x) * 3, q = (y * width + Math.min(width - 1, x + 1)) * 3, r = (Math.min(height - 1, y + 1) * width + x) * 3;
    return Math.abs(labs[p] - labs[q]) + Math.abs(labs[p] - labs[r]);
  };
  const seedAt = (x, y, protect = false) => {
    x = clamp(Math.round(x), 0, width - 1); y = clamp(Math.round(y), 0, height - 1);
    if (!protect) {
      let best = gradient(x, y), bx = x, by = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const px = clamp(x + dx, 0, width - 1), py = clamp(y + dy, 0, height - 1), g = gradient(px, py);
        if (g < best) { best = g; bx = px; by = py; }
      }
      x = bx; y = by;
    }
    const i = (y * width + x) * 3;
    seeds.push({ x, y, l: labs[i], a: labs[i + 1], b: labs[i + 2] });
  };
  for (let y = spacing / 2; y < height; y += spacing) for (let x = spacing / 2; x < width; x += spacing) seedAt(x, y);
  if (!seeds.length) seedAt(width / 2, height / 2);
  for (let y = 1; y < height; y += 3) for (let x = 1; x < width; x += 3) if (focal[y * width + x]) seedAt(x, y, true);
  const labels = new Int32Array(n), distances = new Float32Array(n);
  const spatialWeight = (.065 + settings.simplification * .012) ** 2 / spacing ** 2;
  for (let iteration = 0; iteration < 6; iteration++) {
    distances.fill(Infinity);
    for (let s = 0; s < seeds.length; s++) {
      const seed = seeds[s], reach = Math.ceil(spacing * 2);
      for (let y = Math.max(0, Math.floor(seed.y - reach)); y <= Math.min(height - 1, Math.ceil(seed.y + reach)); y++) {
        for (let x = Math.max(0, Math.floor(seed.x - reach)); x <= Math.min(width - 1, Math.ceil(seed.x + reach)); x++) {
          const p = y * width + x, i = p * 3;
          const d = (labs[i] - seed.l) ** 2 + (labs[i + 1] - seed.a) ** 2 + (labs[i + 2] - seed.b) ** 2 + ((x - seed.x) ** 2 + (y - seed.y) ** 2) * spatialWeight;
          if (d < distances[p]) { distances[p] = d; labels[p] = s; }
        }
      }
    }
    const sums = new Float64Array(seeds.length * 6);
    for (let p = 0; p < n; p++) {
      const i = labels[p] * 6;
      sums[i] += p % width; sums[i + 1] += Math.floor(p / width);
      sums[i + 2] += labs[p * 3]; sums[i + 3] += labs[p * 3 + 1]; sums[i + 4] += labs[p * 3 + 2]; sums[i + 5]++;
    }
    seeds.forEach((s, k) => { const i = k * 6, count = sums[i + 5]; if (count) Object.assign(s, { x: sums[i] / count, y: sums[i + 1] / count, l: sums[i + 2] / count, a: sums[i + 3] / count, b: sums[i + 4] / count }); });
    progress(.05 + iteration * .065, `Finding connected forms (${iteration + 1}/6)`);
    await turn(); check(cancelled);
  }
  return { ...connectedLabels(labels, width, height), labs, linear, spacing };
}
function edgeCost(a, b, edge, settings, baseArea) {
  const color = labDistance(a.lab, b.lab);
  const boundary = edge.sum / Math.max(1, edge.count) * 100;
  const scale = .55 + Math.min(2, Math.sqrt(Math.min(a.area, b.area) / baseArea)) * .45;
  // Protect small marked features from being swallowed by larger neighbours.
  const protection = !!a.protected !== !!b.protected ? 90 : 0;
  return (color + boundary * (1.05 - settings.simplification * .12)) * scale + protection;
}
function mergeNodes(nodes, aID, bID) {
  const a = nodes[aID], b = nodes[bID], area = a.area + b.area, id = nodes.length;
  const sum = a.sum.map((v, i) => v + b.sum[i]);
  const node = { id, children: [aID, bID], parent: -1, area, sum, rgb: fromLinear(sum.map(v => v / area)),
    x: a.x + b.x, y: a.y + b.y, protected: a.protected + b.protected, active: true, neighbours: new Map() };
  node.lab = oklab(node.rgb);
  for (const old of [a, b]) for (const [other, edge] of old.neighbours) {
    if (other === aID || other === bID || !nodes[other].active) continue;
    const previous = node.neighbours.get(other) || { sum: 0, count: 0 };
    node.neighbours.set(other, { sum: previous.sum + edge.sum, count: previous.count + edge.count });
    nodes[other].neighbours.delete(aID); nodes[other].neighbours.delete(bID);
  }
  a.active = false; b.active = false; a.parent = id; b.parent = id;
  a.neighbours.clear(); b.neighbours.clear();
  for (const [other, edge] of node.neighbours) nodes[other].neighbours.set(id, edge);
  nodes.push(node);
  return node;
}
function earlyColor(rgb, settings) {
  if (settings.underpainting === 'none') return rgb;
  const v = valueRGB(rgb)[0] / 255;
  const band = v < .36 ? .19 : v < .68 ? .49 : .81;
  if (settings.underpainting === 'tonal') return [Math.round(band * 255), Math.round(band * 255), Math.round(band * 255)];
  const ground = linearRGB(hexToRgb(settings.ground));
  return fromLinear(ground.map(c => band < .5 ? c * (band / .5) ** 1.7 : c + (1 - c) * (band - .5) * 1.8));
}
export function stageExplanation(index, count, settings) {
  const t = index / (count - 1);
  const title = index === 0 ? settings.underpainting === 'none' ? 'Large colour masses' : 'Tonal foundation' : index === count - 1 ? 'Details & accents' : t < .35 ? 'Broad colour block-in' : t < .65 ? 'Developing the forms' : 'Smaller forms & variations';
  const action = index === 0 ? 'Establish the major light, middle and dark shapes. Keep the composition simple.' : t < .4 ? 'Place broad colour families and the main silhouette. Compare adjacent masses before refining.' : t < .75 ? 'Subdivide the larger forms. Look for structural colour shifts and light–shadow relationships.' : 'Refine selected edges and small focal features. Keep less important passages broad.';
  const method = settings.method === 'wet' ? 'These are visual checkpoints: continue wet-on-wet where useful, without requiring a dried coat at each step.' : settings.method === 'separate' ? 'Use a new session when the actual paint film is ready. Drying varies by pigment, thickness, medium and conditions; no fixed waiting time is implied.' : 'Combine wet passages and later sessions as appropriate. Visual stages are not a prescription for separate paint layers.';
  return { title, explanation: action + ' ' + method };
}
export async function generatePlan({ data, width, height, settings: raw, focalPoints = [], manualMerges = [] }, { progress = () => {}, cancelled = () => false } = {}) {
  if (!(width > 0 && height > 0 && width <= 512 && height <= 512) || data.length !== width * height * 4) throw new Error('Invalid working image.');
  const settings = validateSettings(raw), focal = focalMask(width, height, focalPoints);
  const { labels, count, labs, linear, spacing } = await superpixels(data, width, height, settings, focal, progress, cancelled);
  const nodes = Array.from({ length: count }, (_, id) => ({ id, children: [], parent: -1, area: 0, sum: [0, 0, 0], x: 0, y: 0, protected: 0, active: true, neighbours: new Map() }));
  for (let p = 0; p < labels.length; p++) {
    const node = nodes[labels[p]]; node.area++; node.x += p % width; node.y += Math.floor(p / width); node.protected += focal[p];
    for (let c = 0; c < 3; c++) node.sum[c] += linear[p * 3 + c];
    for (const q of [p % width < width - 1 ? p + 1 : -1, p + width < labels.length ? p + width : -1]) {
      if (q < 0 || labels[p] === labels[q]) continue;
      const a = nodes[labels[p]], b = nodes[labels[q]], edge = a.neighbours.get(b.id) || { sum: 0, count: 0 };
      edge.sum += Math.hypot(labs[p * 3] - labs[q * 3], labs[p * 3 + 1] - labs[q * 3 + 1], labs[p * 3 + 2] - labs[q * 3 + 2]); edge.count++;
      a.neighbours.set(b.id, edge); b.neighbours.set(a.id, edge);
    }
  }
  for (const n of nodes) { n.rgb = fromLinear(n.sum.map(v => v / n.area)); n.lab = oklab(n.rgb); }
  const cost = (a, b, edge) => edgeCost(a, b, edge, settings, spacing ** 2);
  // First remove connected noise islands. Focal regions are exempt.
  for (let id = 0; id < nodes.length; id++) {
    const node = nodes[id];
    if (!node.active || node.protected || node.area >= settings.minRegion || !node.neighbours.size) continue;
    let best = -1, bestCost = Infinity;
    for (const [other, edge] of node.neighbours) { const c = cost(node, nodes[other], edge); if (c < bestCost) { bestCost = c; best = other; } }
    if (best >= 0) mergeNodes(nodes, id, best);
  }
  // Flat superpixels are an analysis aid, not meaningful final details. Remove
  // invisible subdivisions before choosing stage cuts (including inside a
  // protected circle), so the last stage does not merely split identical paint.
  for (let id = 0; id < nodes.length; id++) {
    const node = nodes[id];
    if (!node.active) continue;
    for (const [other, edge] of node.neighbours) {
      if (edge.sum / edge.count < .008 && node.rgb.every((v, i) => v === nodes[other].rgb[i])) { mergeNodes(nodes, id, other); break; }
    }
  }
  const cleanedThreshold = nodes.length - 1, activeCount = nodes.filter(n => n.active).length;
  const heap = new Heap();
  const pushEdges = node => { for (const [other, edge] of node.neighbours) {
    const a = Math.min(node.id, other), b = Math.max(node.id, other);
    heap.push({ a, b, key: a * 100000 + b, cost: cost(node, nodes[other], edge) });
  } };
  for (const n of nodes) if (n.active) pushEdges(n);
  let remaining = activeCount, merged = 0;
  while (remaining > 1 && heap.a.length) {
    const e = heap.pop();
    if (!nodes[e.a].active || !nodes[e.b].active || !nodes[e.a].neighbours.has(e.b)) continue;
    const n = mergeNodes(nodes, e.a, e.b); pushEdges(n); remaining--; merged++;
    if (merged % 200 === 0) { progress(.45 + merged / activeCount * .36, 'Building the coarse-to-fine region hierarchy'); await turn(); check(cancelled); }
  }
  const fineCount = Math.min(activeCount, Math.round((70 + settings.detail * 62) / (.7 + settings.simplification * .13)));
  const coarseCount = Math.min(fineCount, 5 + settings.detail * 2);
  const stages = [];
  for (let s = 0; s < settings.stages; s++) {
    const desired = Math.max(1, Math.round(coarseCount * (Math.max(1, fineCount) / coarseCount) ** (s / (settings.stages - 1))));
    const threshold = cleanedThreshold + activeCount - desired;
    const mapping = new Int32Array(count);
    for (let i = 0; i < count; i++) { let id = i; while (nodes[id].parent !== -1 && nodes[id].parent <= threshold) id = nodes[id].parent; mapping[i] = id; }
    const stageLabels = Int32Array.from(labels, id => mapping[id]);
    const ids = [...new Set(stageLabels)], regions = ids.map(id => ({ id, rgb: s === 0 ? earlyColor(nodes[id].rgb, settings) : nodes[id].rgb, area: nodes[id].area,
      x: nodes[id].x / nodes[id].area / width, y: nodes[id].y / nodes[id].area / height, parentId: null }));
    stages.push({ ...stageExplanation(s, settings.stages, settings), labels: stageLabels, regions });
    progress(.83 + .1 * (s + 1) / settings.stages, 'Rendering nested painting stages'); await turn(); check(cancelled);
  }
  const plan = { width, height, settings, stages, focalPoints: structuredClone(focalPoints), manualMerges: [] };
  updateParents(plan);
  for (const operation of manualMerges) applyManualMerge(plan, operation, true);
  progress(1, 'Painting plan ready');
  return plan;
}
export function updateParents(plan) {
  for (let s = 0; s < plan.stages.length; s++) {
    const stage = plan.stages[s], ids = new Map(stage.regions.map(r => [r.id, r]));
    for (const r of stage.regions) r.parentId = null;
    if (!s) continue;
    for (let p = 0; p < stage.labels.length; p++) {
      const r = ids.get(stage.labels[p]);
      if (r.parentId === null) r.parentId = plan.stages[s - 1].labels[p];
    }
  }
}
export function regionsAdjacent(labels, width, a, b) {
  for (let p = 0; p < labels.length; p++) if (labels[p] === a) {
    if (p % width && labels[p - 1] === b || p % width < width - 1 && labels[p + 1] === b || p >= width && labels[p - width] === b || p + width < labels.length && labels[p + width] === b) return true;
  }
  return false;
}
const pointPixel = (point, width, height) => Math.min(height - 1, Math.floor(clamp(point.y) * height)) * width + Math.min(width - 1, Math.floor(clamp(point.x) * width));
export function applyManualMerge(plan, operation, replay = false) {
  const stage = plan.stages[operation.stage];
  if (!stage) { if (replay) return false; throw new Error('Select a stage first.'); }
  const a = stage.labels[pointPixel(operation.a, plan.width, plan.height)], b = stage.labels[pointPixel(operation.b, plan.width, plan.height)];
  if (a === b) return false;
  if (!regionsAdjacent(stage.labels, plan.width, a, b)) { if (replay) return false; throw new Error('Choose a neighbouring region; disconnected regions cannot be merged.'); }
  const mask = Uint8Array.from(stage.labels, id => id === a || id === b ? 1 : 0);
  let next = Math.max(...plan.stages.flatMap(s => s.regions.map(r => r.id))) + 1;
  for (const current of plan.stages) {
    const selected = new Set();
    for (let p = 0; p < mask.length; p++) if (mask[p]) selected.add(current.labels[p]);
    if (selected.size < 2) continue;
    const regions = current.regions.filter(r => selected.has(r.id)), area = regions.reduce((sum, r) => sum + r.area, 0);
    const color = [0, 0, 0]; let x = 0, y = 0;
    for (const r of regions) { const linear = linearRGB(r.rgb); for (let c = 0; c < 3; c++) color[c] += linear[c] * r.area; x += r.x * r.area; y += r.y * r.area; }
    const id = next++;
    current.labels = Int32Array.from(current.labels, old => selected.has(old) ? id : old);
    current.regions = current.regions.filter(r => !selected.has(r.id));
    current.regions.push({ id, area, rgb: fromLinear(color.map(v => v / area)), x: x / area, y: y / area, parentId: null });
  }
  plan.manualMerges.push(structuredClone(operation)); updateParents(plan);
  return true;
}
export function stagePixels(plan, index, { values = false, added = false } = {}) {
  const stage = plan.stages[index], previous = plan.stages[Math.max(0, index - 1)];
  const colors = new Map(stage.regions.map(r => [r.id, values ? valueRGB(r.rgb) : r.rgb]));
  const prior = new Map(previous.regions.map(r => [r.id, values ? valueRGB(r.rgb) : r.rgb]));
  const changes = new Map();
  const data = new Uint8ClampedArray(plan.width * plan.height * 4);
  for (let p = 0; p < stage.labels.length; p++) {
    const current = colors.get(stage.labels[p]); let rgb = current;
    if (added && index) {
      const old = prior.get(previous.labels[p]), key = stage.labels[p] + '/' + previous.labels[p];
      if (!changes.has(key)) changes.set(key, colorDistance(current, old) > 3);
      const boundary = p % plan.width && stage.labels[p - 1] !== stage.labels[p] && previous.labels[p - 1] === previous.labels[p] || p >= plan.width && stage.labels[p - plan.width] !== stage.labels[p] && previous.labels[p - plan.width] === previous.labels[p];
      if (!changes.get(key) && !boundary) rgb = old.map(v => Math.round(v * .28 + 245 * .72));
    }
    data.set(rgb, p * 4); data[p * 4 + 3] = 255;
  }
  return data;
}
export function regionAt(plan, index, x, y) {
  const stage = plan.stages[index], id = stage.labels[pointPixel({ x, y }, plan.width, plan.height)];
  return stage.regions.find(r => r.id === id);
}
