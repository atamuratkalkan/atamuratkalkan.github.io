import * as vendored from './vendor/spectral-3.0.0.js';
import { hexToRgb, oklab, labDistance, clamp } from './color.js';
import { paletteSignature } from './palette.js';

// The unmodified pinned UMD vendor exposes globalThis.spectral in the browser,
// and a CommonJS default when these pure modules are exercised by Node.
const spectral = globalThis.spectral || vendored.default;
const colorCache = new Map();
const gcd = (a, b) => b ? gcd(b, a % b) : a;
export function simpleParts(parts) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 3 || parts.some(v => !Number.isFinite(v) || v < 0) || !parts.some(v => v > 0)) throw new Error('Use positive amounts of at most three tubes, including white.');
  const sum = parts.reduce((a, b) => a + b, 0), weights = parts.map(v => v / sum);
  let best, bestError = Infinity;
  for (let total = parts.length; total <= 18; total++) {
    const candidate = weights.map(w => w === 0 ? 0 : Math.max(1, Math.round(w * total)));
    const n = candidate.reduce((a, b) => a + b, 0);
    const err = weights.reduce((s, w, i) => s + (w - candidate[i] / n) ** 2, 0) + n * .000008;
    if (err < bestError) { bestError = err; best = candidate; }
  }
  const divisor = best.reduce(gcd);
  return best.map(v => v / divisor);
}
function spectralColor(paint) {
  const key = `${paint.hex}/${paint.tintingStrength}`;
  if (!colorCache.has(key)) {
    const c = new spectral.Color(hexToRgb(paint.hex));
    c.tintingStrength = paint.tintingStrength ?? 1;
    colorCache.set(key, c);
    if (colorCache.size > 256) colorCache.delete(colorCache.keys().next().value);
  }
  return colorCache.get(key);
}
export function forwardMix(paints, ids, parts) {
  if (!ids.length || ids.length > 3 || ids.length !== parts.length || new Set(ids).size !== ids.length) throw new Error('Recipes must contain one to three different tubes. White counts as a tube.');
  if (parts.some(v => !Number.isFinite(v) || v < 0) || !parts.some(v => v > 0)) throw new Error('Mix amounts must be nonnegative, with a positive total.');
  const tubes = ids.map(id => {
    const p = paints.find(p => p.id === id && p.enabled);
    if (!p) throw new Error('This recipe contains a paint that is not enabled.');
    return p;
  });
  const sum = parts.reduce((a, b) => a + b, 0);
  const weights = parts.map(v => v / sum);
  const mixed = spectral.mix(...tubes.map((p, i) => [spectralColor(p), weights[i]])).toGamut({ method: 'clip' });
  return { rgb: mixed.sRGB.map(v => Math.round(clamp(v, 0, 255))), weights };
}
export function evaluateRecipe(paints, target, ids, rawParts) {
  const parts = simpleParts(rawParts);
  const mixed = forwardMix(paints, ids, parts);
  const error = labDistance(oklab(target), oklab(mixed.rgb));
  return { ids: [...ids], parts, ...mixed, error, score: error + .32 * (ids.length - 1) + .012 * parts.reduce((a, b) => a + b, 0) };
}
const candidateKey = r => r.ids.join('|') + ':' + r.parts.join(':');
const waitTurn = () => new Promise(resolve => setTimeout(resolve, 0));
export class RecipeSearch {
  constructor() { this.signature = ''; this.bank = []; this.results = new Map(); }
  async prepare(paints, { cancelled = () => false, progress = () => {} } = {}) {
    const signature = paletteSignature(paints);
    if (this.signature === signature && this.bank.length) return;
    const enabled = paints.filter(p => p.enabled);
    if (!enabled.length) throw new Error('Enable at least one paint in My paints.');
    if (enabled.length > 24) throw new Error('Enable at most 24 paints.');
    const bank = [], seen = new Set();
    let processed = 0;
    const total = enabled.length + enabled.length * (enabled.length - 1) / 2 * 35 + enabled.length * (enabled.length - 1) * (enabled.length - 2) / 6 * 10;
    const add = (ids, parts) => {
      const d = parts.reduce(gcd), reduced = parts.map(p => p / d);
      const key = ids.join('|') + ':' + reduced.join(':');
      if (seen.has(key)) return;
      seen.add(key);
      const mixed = forwardMix(paints, ids, reduced);
      bank.push({ ids, parts: reduced, rgb: mixed.rgb, weights: mixed.weights, lab: oklab(mixed.rgb) });
    };
    for (let a = 0; a < enabled.length; a++) {
      add([enabled[a].id], [1]);
      for (let b = a + 1; b < enabled.length; b++) {
        for (let i = 1; i <= 6; i++) for (let j = 1; j <= 6; j++) add([enabled[a].id, enabled[b].id], [i, j]);
        for (let c = b + 1; c < enabled.length; c++) {
          for (let i = 1; i <= 4; i++) for (let j = 1; j < 6 - i; j++) add([enabled[a].id, enabled[b].id, enabled[c].id], [i, j, 6 - i - j]);
        }
      }
      processed = bank.length;
      progress(Math.min(.75, processed / Math.max(1, total) * .75), 'Preparing enabled-paint combinations');
      await waitTurn();
      if (cancelled()) throw new DOMException('Recipe search cancelled', 'AbortError');
    }
    this.bank = bank; this.signature = signature; this.results.clear();
  }
  async search(paints, target, options = {}) {
    await this.prepare(paints, options);
    const { cancelled = () => false, progress = () => {} } = options;
    const key = target.join(',');
    if (this.results.has(key)) return structuredClone(this.results.get(key));
    const lab = oklab(target);
    const ranked = this.bank.map(r => {
      const error = labDistance(lab, r.lab);
      return { ...r, error, score: error + .32 * (r.ids.length - 1) + .012 * r.parts.reduce((a, b) => a + b, 0) };
    }).sort((a, b) => a.score - b.score || candidateKey(a).localeCompare(candidateKey(b)));
    const candidates = ranked.slice(0, 60), refined = new Set();
    // Refine the best distinct tube sets on a finer integer simplex. Every
    // candidate is rescored AFTER reduction to the displayed practical parts.
    for (const base of ranked) {
      const set = base.ids.join('|');
      if (refined.has(set) || base.ids.length === 1) continue;
      refined.add(set);
      if (base.ids.length === 2) {
        for (let i = 1; i < 18; i++) candidates.push(evaluateRecipe(paints, target, base.ids, [i, 18 - i]));
      } else {
        for (let i = 1; i < 12; i++) for (let j = 1; j < 12 - i; j++) candidates.push(evaluateRecipe(paints, target, base.ids, [i, j, 12 - i - j]));
      }
      if (refined.size >= 12) break;
      await waitTurn();
      if (cancelled()) throw new DOMException('Recipe search cancelled', 'AbortError');
      progress(.75 + refined.size / 12 * .24, 'Refining practical ratios');
    }
    candidates.sort((a, b) => a.score - b.score || candidateKey(a).localeCompare(candidateKey(b)));
    const result = [], used = new Set();
    for (const r of candidates) {
      const set = r.ids.join('|');
      if (used.has(set)) continue;
      used.add(set);
      const { ids, parts, rgb, weights, error, score } = r;
      result.push({ ids, parts, rgb, weights, error, score, closest: error > 5 });
      if (result.length === 3) break;
    }
    this.results.set(key, result);
    if (this.results.size > 256) this.results.delete(this.results.keys().next().value);
    progress(1, 'Mix search complete');
    return structuredClone(result);
  }
}
export function recipeInstructions(recipe, paints) {
  const components = recipe.ids.map((id, i) => ({ paint: paints.find(p => p.id === id), parts: recipe.parts[i] })).sort((a, b) => b.parts - a.parts);
  return components.map(({ paint, parts }, i) => `${i ? 'Add' : 'Start with'} ${parts} approximate ${parts === 1 ? 'part' : 'parts'} ${paint.name}${i && paint.tintingStrength > 1.3 ? ' gradually, working up to this full amount' : ''}.`);
}
