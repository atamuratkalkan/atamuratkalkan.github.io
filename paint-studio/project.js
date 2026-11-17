import { validatePalette } from './palette.js';
import { validateSettings } from './segmentation.js';

export const PROJECT_VERSION = 1;
export const MAX_PROJECT_BYTES = 50 * 1024 ** 2;
const plain = (s, max = 160) => typeof s === 'string' ? s.slice(0, max) : '';
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const rgbValid = rgb => Array.isArray(rgb) && rgb.length === 3 && rgb.every(v => integer(v, 0, 255));
const pointValid = p => p && Number.isFinite(p.x) && p.x >= 0 && p.x <= 1 && Number.isFinite(p.y) && p.y >= 0 && p.y <= 1;
export function encodeLabels(labels) {
  const result = [];
  for (let i = 0; i < labels.length;) { const id = labels[i]; let end = i + 1; while (end < labels.length && labels[end] === id) end++; result.push(id, end - i); i = end; }
  return result;
}
export function decodeLabels(runs, count) {
  if (!Array.isArray(runs) || !runs.length || runs.length % 2 || runs.length > count * 2) throw new Error('Invalid stage region encoding.');
  const labels = new Int32Array(count); let offset = 0;
  for (let i = 0; i < runs.length; i += 2) {
    if (!integer(runs[i], 0, 1e8) || !integer(runs[i + 1], 1, count) || offset + runs[i + 1] > count) throw new Error('Invalid stage region run.');
    labels.fill(runs[i], offset, offset + runs[i + 1]); offset += runs[i + 1];
  }
  if (offset !== count) throw new Error('The stage region map is incomplete.');
  return labels;
}
export function serializeProject(state) {
  if (!state.reference) throw new Error('Upload a reference before saving a project.');
  const { name, dataURL, width, height, originalWidth, originalHeight } = state.reference;
  const plan = state.plan ? { width: state.plan.width, height: state.plan.height, settings: state.plan.settings,
    focalPoints: state.plan.focalPoints, manualMerges: state.plan.manualMerges,
    stages: state.plan.stages.map(({ labels, ...stage }) => ({ ...stage, runs: encodeLabels(labels) })) } : null;
  return { schema: 'paint-studio-project', version: PROJECT_VERSION, id: state.projectId,
    name: plain(state.projectName) || 'Untitled study', savedAt: new Date().toISOString(),
    reference: { name, dataURL, width, height, originalWidth, originalHeight }, paints: state.paints,
    settings: state.settings, focalPoints: state.focalPoints, plan, stageIndex: state.stageIndex,
    picks: state.picks.slice(-100), favorites: state.favorites.slice(-100) };
}
function validateRecipe(recipe, paints) {
  if (!recipe) return null;
  if (!Array.isArray(recipe.ids) || !integer(recipe.ids.length, 1, 3) || new Set(recipe.ids).size !== recipe.ids.length || !recipe.ids.every(id => paints.some(p => p.id === id && p.enabled))) throw new Error('A saved recipe uses unavailable paints.');
  if (!Array.isArray(recipe.parts) || recipe.parts.length !== recipe.ids.length || !recipe.parts.every(v => integer(v, 1, 100))) throw new Error('Invalid saved recipe quantities.');
  if (!rgbValid(recipe.rgb) || !Number.isFinite(recipe.error)) throw new Error('Invalid saved recipe colour.');
  const total = recipe.parts.reduce((a, b) => a + b, 0);
  return { ids: [...recipe.ids], parts: [...recipe.parts], rgb: [...recipe.rgb], error: recipe.error,
    weights: recipe.parts.map(v => v / total), closest: recipe.error > 5 };
}
function validatePicks(picks, stages, withRecipes) {
  if (!Array.isArray(picks) || picks.length > 100) throw new Error('Too many saved picks.');
  return picks.map(p => {
    if (!pointValid(p) || !rgbValid(p.target) || !integer(p.stage, 0, Math.max(0, stages - 1)) || !['original', 'stage'].includes(p.source)) throw new Error('Invalid saved image pick.');
    const result = { id: plain(p.id, 80), name: plain(p.name, 120), x: p.x, y: p.y, target: [...p.target], stage: p.stage,
      source: p.source, values: p.values === true, radius: integer(p.radius, 0, 12) ? p.radius : 0, needsRefresh: p.needsRefresh === true };
    if (withRecipes) { result.paintsSnapshot = validatePalette(p.paintsSnapshot); result.recipe = validateRecipe(p.recipe, result.paintsSnapshot); }
    return result;
  });
}
export function validateProject(input) {
  if (input?.schema !== 'paint-studio-project' || input.version !== PROJECT_VERSION) throw new Error('Unsupported Paint Studio project version.');
  const r = input.reference;
  if (!r || typeof r.dataURL !== 'string' || r.dataURL.length > MAX_PROJECT_BYTES || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(r.dataURL) || !integer(r.width, 1, 2200) || !integer(r.height, 1, 2200) || !integer(r.originalWidth, 1, 100000) || !integer(r.originalHeight, 1, 100000) || r.originalWidth * r.originalHeight > 100e6) throw new Error('Invalid project reference image.');
  const paints = validatePalette(input.paints), settings = validateSettings(input.settings);
  const focals = input.focalPoints || [];
  if (!Array.isArray(focals) || focals.length > 12 || !focals.every(p => pointValid(p) && Number.isFinite(p.radius) && p.radius >= .005 && p.radius <= .2)) throw new Error('Invalid focal-detail marks.');
  let plan = null;
  if (input.plan) {
    const raw = input.plan;
    const scale = Math.min(1, 512 / Math.max(r.width, r.height));
    if (raw.width !== Math.max(1, Math.round(r.width * scale)) || raw.height !== Math.max(1, Math.round(r.height * scale)) || !Array.isArray(raw.stages) || !integer(raw.stages.length, 3, 8)) throw new Error('Invalid project painting stages.');
    const total = raw.width * raw.height;
    const stages = raw.stages.map((s, i) => {
      if (!Array.isArray(s.regions) || !s.regions.length || s.regions.length > total) throw new Error('Invalid stage regions.');
      const labels = decodeLabels(s.runs, total), ids = new Set(), counts = new Map();
      const regions = s.regions.map(region => {
        if (!integer(region.id, 0, 1e8) || ids.has(region.id) || !rgbValid(region.rgb) || !pointValid(region) || !integer(region.area, 1, total) || !(region.parentId == null || integer(region.parentId, 0, 1e8))) throw new Error('Invalid stage colour region.');
        ids.add(region.id);
        return { id: region.id, rgb: [...region.rgb], area: region.area, x: region.x, y: region.y, parentId: region.parentId ?? null };
      });
      for (const id of labels) { if (!ids.has(id)) throw new Error('A stage label has no matching region.'); counts.set(id, (counts.get(id) || 0) + 1); }
      if (regions.some(region => counts.get(region.id) !== region.area)) throw new Error('Region areas do not match the stage image.');
      return { title: plain(s.title, 100) || `Stage ${i + 1}`, explanation: plain(s.explanation, 1400), labels, regions };
    });
    for (let s = 1; s < stages.length; s++) {
      const parents = new Map(stages[s].regions.map(region => [region.id, region.parentId]));
      for (let p = 0; p < total; p++) if (parents.get(stages[s].labels[p]) !== stages[s - 1].labels[p]) throw new Error('Stage parent/child relationships are inconsistent.');
    }
    const merges = raw.manualMerges || [];
    if (!Array.isArray(merges) || merges.length > 100 || !merges.every(m => integer(m.stage, 0, stages.length - 1) && pointValid(m.a) && pointValid(m.b))) throw new Error('Invalid manual corrections.');
    const generatedFocals = raw.focalPoints || [];
    if (!Array.isArray(generatedFocals) || generatedFocals.length > 12 || !generatedFocals.every(p => pointValid(p) && Number.isFinite(p.radius) && p.radius >= .005 && p.radius <= .2)) throw new Error('Invalid generated focal-detail marks.');
    const generatedSettings = validateSettings(raw.settings);
    if (generatedSettings.stages !== stages.length) throw new Error('The stage count does not match the generated plan.');
    plan = { width: raw.width, height: raw.height, stages, settings: generatedSettings, focalPoints: structuredClone(generatedFocals), manualMerges: structuredClone(merges) };
  }
  return { schema: 'paint-studio-project', version: 1, id: plain(input.id, 80) || crypto.randomUUID(),
    name: plain(input.name) || 'Untitled study', savedAt: plain(input.savedAt, 60), reference: { name: plain(r.name), dataURL: r.dataURL, width: r.width, height: r.height, originalWidth: r.originalWidth, originalHeight: r.originalHeight },
    paints, settings, focalPoints: structuredClone(focals), plan, stageIndex: integer(input.stageIndex, 0, Math.max(0, (plan?.stages.length || 1) - 1)) ? input.stageIndex : 0,
    picks: validatePicks(input.picks || [], plan?.stages.length || 1, false), favorites: validatePicks(input.favorites || [], plan?.stages.length || 1, true) };
}
