import { clamp, samplePixels, valueRGB, rgbToHex, colorDistance } from './color.js';
import { validatePalette, paletteFile, paletteSignature, selectInitialPalette } from './palette.js';
import { DEFAULT_SETTINGS, validateSettings, applyManualMerge, regionAt, stagePixels } from './segmentation.js';
import { forwardMix, recipeInstructions } from './mixing.js';
import { decodeReference, referenceFromRecord, analysisImage, disposeReference, sampleReferenceFile } from './image.js';
import { ImageViewer } from './viewer.js';
import { serializeProject, validateProject, MAX_PROJECT_BYTES } from './project.js';
import * as storage from './storage.js';
import { downloadJSON, exportStage, renderStageCanvas, buildPrintSheet, releaseDownloads } from './exports.js';

const $ = id => document.getElementById(id);
const uid = () => crypto.randomUUID();
const state = { reference: null, analysis: null, paints: [], settings: { ...DEFAULT_SETTINGS }, plan: null,
  focalPoints: [], stageIndex: 0, mode: 'original', values: false, interaction: 'pick',
  selection: null, recipe: null, recipes: [], picks: [], favorites: [], projectId: uid(), projectName: 'Untitled study' };
let imageVersion = 0, stageVersion = 0, printVersion = 0, paletteSaveTimer, sampleCache = new WeakMap();
let researchedPaints = [];
const jobs = new Map();
function announce(message, error = false) { $('status').textContent = message; $('status').classList.toggle('is-error', error); }
function job(kind, value, message) {
  jobs.set(kind, { value, message });
  const active = ['upload', 'stages', 'print', 'mix'].map(k => jobs.get(k)).find(Boolean);
  announce(active.message); $('job-progress').hidden = false; $('job-progress').value = active.value;
  $('cancel-job').hidden = jobs.has('upload');
}
function finishJob(kind, message) {
  jobs.delete(kind);
  if (jobs.size) { const [k, v] = [...jobs][0]; job(k, v.value, v.message); }
  else { $('job-progress').hidden = true; $('cancel-job').hidden = true; if (message) announce(message); }
}
function fail(error) { if (error.name !== 'AbortError') announce(error.message || 'Something went wrong. Please try again.', true); }
const safe = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(fail);
class WorkerJob {
  constructor(path) { this.path = path; this.serial = 0; this.pending = null; }
  ensure() {
    if (this.worker) return;
    this.worker = new Worker(new URL(this.path, import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      const p = this.pending; if (!p || data.id !== p.id) return;
      if (data.type === 'progress') p.progress(data.value, data.message);
      else { this.pending = null; if (data.type === 'error') p.reject(new Error(data.message)); else p.resolve(data); }
    };
    this.worker.onerror = event => { this.pending?.reject(new Error(`A processing worker failed: ${event.message || 'try reloading this page'}`)); this.pending = null; this.worker.terminate(); this.worker = null; };
  }
  run(payload, progress = () => {}) {
    this.cancel(); this.ensure(); const id = ++this.serial;
    return new Promise((resolve, reject) => { this.pending = { id, progress, resolve, reject }; this.worker.postMessage({ ...payload, id }); });
  }
  cancel() { if (this.pending) { this.pending.reject(new DOMException('Cancelled', 'AbortError')); this.pending = null; } this.worker?.postMessage({ type: 'cancel' }); }
  destroy() { this.cancel(); this.worker?.terminate(); this.worker = null; }
}
const stageJob = new WorkerJob('./stage-worker.js'), mixJob = new WorkerJob('./mix-worker.js');
const viewer = new ImageViewer($('viewer'), safe(handlePick), view => { $('zoom-label').textContent = `${Math.round(view.zoom * 100)}%`; });

function textElement(tag, text, className) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (className) e.className = className; return e; }
function setPressed(id, yes) { $(id).setAttribute('aria-pressed', String(yes)); }
function syncAvailability() {
  const has = !!state.reference, plan = !!state.plan;
  for (const id of ['generate', 'save-project', 'export-project', 'zoom-in', 'zoom-out', 'fit-view', 'pick-center', 'protect-mode', 'clear-focals']) $(id).disabled = !has;
  for (const id of ['view-stage', 'view-added', 'merge-mode']) $(id).disabled = !plan;
  $('generate').disabled = !has || jobs.has('stages');
  $('undo-merge').disabled = !plan || !state.plan.manualMerges.length || jobs.has('stages');
  $('empty-state').hidden = has;
  $('reference-info').textContent = has ? `${state.reference.width} × ${state.reference.height} sRGB reference · ${state.analysis.width} × ${state.analysis.height} analysis` : 'sRGB · local processing';
  $('viewer').setAttribute('aria-label', has ? `${state.mode === 'original' ? 'Original reference' : `Painting stage ${state.stageIndex + 1}`}. ${state.values ? 'Grayscale values. ' : ''}Tap to sample, or use Enter to sample the centre.` : 'Painting reference canvas. Choose a reference to begin.');
}
function showScene(reset = false) {
  if (!state.reference) return;
  for (const mode of ['original', 'stage', 'added']) setPressed(`view-${mode}`, state.mode === mode);
  $('values').checked = state.values;
  $('sample-source').textContent = `Source: ${state.mode === 'original' ? 'original reference' : `stage ${state.stageIndex + 1}${state.mode === 'added' ? ' (unmuted colours)' : ''}`}${state.values ? ' · values' : ''}`;
  $('added-note').hidden = state.mode !== 'added';
  viewer.setScene({ reference: state.reference, plan: state.plan, stageIndex: state.stageIndex, mode: state.mode, values: state.values, focalPoints: state.focalPoints }, reset);
  viewer.setSelection(state.selection); syncAvailability();
}
function readSettings() {
  return validateSettings({ stages: $('stage-count').value, detail: $('detail').value, simplification: $('simplification').value,
    minRegion: $('min-region').value, underpainting: $('underpainting').value, ground: $('ground').value, method: $('method').value });
}
function writeSettings() {
  for (const [key, id] of Object.entries({ stages: 'stage-count', detail: 'detail', simplification: 'simplification', minRegion: 'min-region', underpainting: 'underpainting', ground: 'ground', method: 'method' })) $(id).value = state.settings[key];
  syncSettingsLabels();
}
function syncSettingsLabels() {
  for (const id of ['stage-count', 'detail', 'simplification']) $(`${id}-output`).value = $(id).value;
  $('ground-label').hidden = $('underpainting').value !== 'ground';
}
function setInteraction(mode) {
  if (mode === 'merge' && (!state.plan || state.mode === 'original')) { announce('Switch to a painting stage and select a region before merging.'); return; }
  state.interaction = mode;
  setPressed('protect-mode', mode === 'protect'); setPressed('merge-mode', mode === 'merge');
  $('correction-note').textContent = mode === 'protect' ? 'Tap to add a focal mark, or tap an existing mark to remove it. Then regenerate.' : mode === 'merge' ? 'Select the first region, then tap a touching neighbour. The merge is applied through the hierarchy.' : 'Tap a marked feature in focal mode to remove it. Protection takes effect when you regenerate.';
  state.mergeStart = null;
}
function renderPalette() {
  const list = $('paint-list'); list.replaceChildren();
  for (const paint of state.paints) {
    const entry = textElement('div', null, 'paint-entry'), top = textElement('div', null, 'paint-top');
    const label = textElement('label'), checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = paint.enabled;
    checkbox.setAttribute('aria-label', `Available: ${paint.name}`);
    const name = textElement('span', paint.name); label.append(checkbox, name);
    const swatch = document.createElement('input'); swatch.type = 'color'; swatch.value = paint.hex; swatch.setAttribute('aria-label', `Estimated colour of ${paint.name}`);
    top.append(label, swatch); entry.append(top);
    const details = textElement('details', null, 'paint-edit'); details.append(textElement('summary', 'Edit tube information'));
    const fields = [ ['name', 'Paint name', 'text'], ['brand', 'Brand (optional)', 'text'], ['series', 'Series (optional)', 'text'], ['pigments', 'Pigment codes (optional)', 'text'], ['tintingStrength', 'Estimated tinting strength (1 = neutral assumption)', 'number'], ['transparency', 'Transparency (record only)', 'select'] ];
    const change = (key, value, input) => {
      const updated = state.paints.map(p => p.id === paint.id ? { ...p, [key]: value,
        provenance: ['hex', 'tintingStrength'].includes(key) ? { kind: 'user-estimate', note: 'Edited in Paint Studio; not a measured spectral calibration.' } : p.provenance } : p);
      try {
        state.paints = validatePalette(updated);
        if (key === 'name') { name.textContent = value; checkbox.setAttribute('aria-label', `Available: ${value}`); }
        paletteChanged();
      } catch (error) { input.value = state.paints.find(p => p.id === paint.id)[key] ?? ''; if (input.type === 'checkbox') input.checked = state.paints.find(p => p.id === paint.id).enabled; fail(error); }
    };
    checkbox.addEventListener('change', () => change('enabled', checkbox.checked, checkbox));
    swatch.addEventListener('change', () => change('hex', swatch.value, swatch));
    for (const [key, title, type] of fields) {
      const field = textElement('label', title), input = document.createElement(type === 'select' ? 'select' : 'input');
      if (type === 'select') for (const value of ['unknown', 'opaque', 'semi-transparent', 'transparent']) { const option = textElement('option', value); option.value = value; input.append(option); }
      else { input.type = type; if (type === 'text') input.maxLength = key === 'name' ? 100 : 160; if (type === 'number') { input.min = '.1'; input.max = '5'; input.step = '.1'; } }
      input.value = paint[key] ?? ''; input.setAttribute('aria-label', `${title} — ${paint.name}`);
      input.addEventListener('change', () => change(key, type === 'number' ? Number(input.value) : input.value, input));
      field.append(input); details.append(field);
    }
    details.append(textElement('p', `${paint.provenance.kind}. ${paint.provenance.note} ${paint.calibration ? 'Calibration record preserved; forward mixing still uses the estimated swatch.' : 'No measured spectra.'}`, 'small-note'));
    if (paint.provenance.reference) details.append(textElement('p', `Catalogue reference: ${paint.provenance.reference}`, 'small-note'));
    if (paint.provenance.referencePigments) details.append(textElement('p', `Reference pigments (not a verified tube formula): ${paint.provenance.referencePigments}`, 'small-note'));
    if (paint.provenance.method) details.append(textElement('p', paint.provenance.method, 'small-note'));
    for (const [key, title] of [['source', 'Colour reference source'], ['pigmentSource', 'Reference pigment source']]) if (paint.provenance[key]) {
      const link = textElement('a', title); link.href = paint.provenance[key];
      details.append(link);
    }
    const remove = textElement('button', 'Remove tube'); remove.type = 'button';
    remove.addEventListener('click', () => { if (state.paints.length === 1) return announce('Keep at least one paint entry, or import another palette.', true); state.paints = state.paints.filter(p => p.id !== paint.id); renderPalette(); paletteChanged(); });
    details.append(remove); entry.append(details); list.append(entry);
  }
  updatePaintCount();
}
function updatePaintCount() { $('paint-count').textContent = `${state.paints.filter(p => p.enabled).length} available`; }
function paletteChanged() {
  updatePaintCount(); clearTimeout(paletteSaveTimer);
  const snapshot = structuredClone(state.paints);
  paletteSaveTimer = setTimeout(() => storage.saveInventory(snapshot).catch(fail), 350);
  refreshNotes(); renderFavorites();
  if (state.selection) requestMix();
}
function resetRecipe() { state.recipe = null; state.recipes = []; $('recipe-content').hidden = true; $('recipe-empty').hidden = false; $('favorite-recipe').disabled = true; }
async function loadImage(file) {
  const token = ++imageVersion; stageVersion++; stageJob.cancel(); mixJob.cancel(); printVersion++; jobs.clear();
  job('upload', .1, 'Decoding and orienting your local reference…');
  let reference;
  try {
    reference = await decodeReference(file);
    if (token !== imageVersion) { disposeReference(reference); return; }
    disposeReference(state.reference); state.reference = reference; state.analysis = analysisImage(reference);
    Object.assign(state, { plan: null, stageIndex: 0, mode: 'original', selection: null, focalPoints: [], picks: [], favorites: [], projectId: uid(), values: false });
    state.projectName = file.name.replace(/\.[^.]+$/, '') || 'Untitled study'; $('project-name').value = state.projectName;
    sampleCache = new WeakMap(); setInteraction('pick'); resetRecipe(); renderStages(); renderFavorites(); showScene(true);
    finishJob('upload', 'Reference ready. Check My paints, mark important details if needed, then generate your stages.');
  } catch (error) { if (token === imageVersion) { finishJob('upload'); fail(error); syncAvailability(); } }
}
async function generateStages({ manualMerges = state.plan?.manualMerges || [] } = {}) {
  if (!state.reference) return;
  const settings = readSettings(); state.settings = settings;
  mixJob.cancel(); jobs.delete('mix'); printVersion++;
  const token = imageVersion, generation = ++stageVersion;
  const operations = manualMerges.filter(m => m.stage < settings.stages);
  job('stages', 0, 'Preparing the connected region hierarchy…'); syncAvailability();
  try {
    const { plan } = await stageJob.run({ input: { ...state.analysis, settings, focalPoints: state.focalPoints, manualMerges: operations } }, (value, message) => job('stages', value, message));
    if (token !== imageVersion || generation !== stageVersion) return;
    state.plan = plan; state.stageIndex = clamp(state.stageIndex, 0, plan.stages.length - 1); state.mode = 'stage';
    state.interaction = 'pick'; setInteraction('pick'); sampleCache = new WeakMap();
    refreshNotes(); renderStages(); renderFavorites(); showScene();
    const omitted = manualMerges.length - plan.manualMerges.length;
    $('plan-notice').textContent = `${plan.stages.length} nested stages ready. The first stage has ${plan.stages[0].regions.length} forms; the last has ${plan.stages.at(-1).regions.length}.${omitted ? ` ${omitted} earlier corrections no longer matched adjacent forms with these settings; review the plan.` : ''}`;
    finishJob('stages', 'Painting stages ready. Tap a region for its displayed colour and a mix.');
    if (state.selection) await pickAt(state.selection, false);
  } catch (error) { if (generation === stageVersion) { finishJob('stages'); fail(error); } }
  finally { if (generation === stageVersion) syncAvailability(); }
}
function renderStages() {
  const panel = $('stage-panel'), strip = $('stage-strip'); panel.hidden = !state.plan; strip.replaceChildren();
  if (!state.plan) return;
  state.plan.stages.forEach((stage, i) => {
    const button = textElement('button', null, 'stage-thumb'); button.type = 'button'; button.setAttribute('aria-label', `Stage ${i + 1}: ${stage.title}`); button.setAttribute('aria-pressed', String(i === state.stageIndex));
    const canvas = renderStageCanvas(state.plan, i, state.values, 180); canvas.setAttribute('aria-hidden', 'true');
    button.append(canvas, textElement('span', `${i + 1}. ${stage.title}`)); button.addEventListener('click', safe(() => selectStage(i))); strip.append(button);
  });
  $('stage-slider').max = state.plan.stages.length - 1; updateStageText();
}
function updateStageText() {
  if (!state.plan) return;
  const stage = state.plan.stages[state.stageIndex];
  $('stage-slider').value = state.stageIndex; $('stage-number').textContent = `Stage ${state.stageIndex + 1} of ${state.plan.stages.length} · ${stage.regions.length} connected forms`;
  $('stage-title').textContent = stage.title; $('stage-explanation').textContent = stage.explanation;
  $('previous-stage').disabled = state.stageIndex === 0; $('next-stage').disabled = state.stageIndex === state.plan.stages.length - 1;
  [...$('stage-strip').children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === state.stageIndex)));
}
async function selectStage(index) {
  if (!state.plan) return;
  state.stageIndex = clamp(index, 0, state.plan.stages.length - 1); if (state.mode === 'original') state.mode = 'stage';
  state.mergeStart = null; updateStageText(); showScene();
  if (state.selection) await pickAt(state.selection, false);
}
function targetAt(point, source = state.mode === 'original' ? 'original' : 'stage', index = state.stageIndex, values = state.values, radius = $('sample-mode').value === 'point' ? 0 : Number($('sample-radius').value)) {
  let color;
  if (source === 'original') color = samplePixels(state.reference.pixels.data, state.reference.width, state.reference.height, point.x * state.reference.width, point.y * state.reference.height, radius);
  else {
    if (!state.plan?.stages[index]) throw new Error('Generate this stage before sampling it.');
    const stage = state.plan.stages[index];
    if (!radius) color = [...regionAt(state.plan, index, point.x, point.y).rgb];
    else {
      if (!sampleCache.has(stage)) sampleCache.set(stage, stagePixels(state.plan, index));
      color = samplePixels(sampleCache.get(stage), state.plan.width, state.plan.height, point.x * state.plan.width, point.y * state.plan.height, radius);
    }
  }
  return values ? valueRGB(color) : color;
}
function refreshNotes() {
  if (!state.reference) return;
  for (const pick of state.picks) {
    pick.stage = Math.min(pick.stage, Math.max(0, (state.plan?.stages.length || 1) - 1));
    if (pick.source === 'original' || state.plan) pick.target = targetAt(pick, pick.source, pick.stage, pick.values, pick.radius);
  }
  for (const note of state.favorites) {
    if (note.stage >= (state.plan?.stages.length || 1)) { note.stage = Math.max(0, (state.plan?.stages.length || 1) - 1); note.needsRefresh = true; }
    if (note.source === 'stage' && !state.plan || paletteSignature(state.paints) !== paletteSignature(note.paintsSnapshot)) note.needsRefresh = true;
    else if (colorDistance(note.target, targetAt(note, note.source, note.stage, note.values, note.radius)) > .05) note.needsRefresh = true;
  }
}
async function handlePick(point) {
  if (!state.reference || jobs.has('stages')) return;
  if (state.interaction === 'protect') {
    const i = state.focalPoints.findIndex(p => Math.hypot((p.x - point.x) * state.reference.width, (p.y - point.y) * state.reference.height) <= p.radius * Math.min(state.reference.width, state.reference.height));
    if (i >= 0) state.focalPoints.splice(i, 1);
    else { if (state.focalPoints.length >= 12) return announce('Use at most 12 focal marks.'); state.focalPoints.push({ x: point.x, y: point.y, radius: Number($('focal-radius').value) / 100 }); }
    showScene(); $('plan-notice').textContent = 'Focal marks changed. Generate again to update the protected forms.';
    announce(`${state.focalPoints.length} focal marks. Regenerate to apply them.`); return;
  }
  if (state.interaction === 'merge') {
    if (!state.plan || state.mode === 'original') return;
    if (!state.mergeStart) { state.mergeStart = point; await pickAt(point); announce('First region selected. Tap a touching neighbour to merge.'); return; }
    const operation = { stage: state.stageIndex, a: state.mergeStart, b: point };
    if (state.plan.manualMerges.length >= 100) return announce('This plan already has 100 manual corrections.');
    const changed = applyManualMerge(state.plan, operation);
    if (!changed) return announce('That is the same region. Choose a touching neighbour.');
    sampleCache = new WeakMap(); state.mergeStart = null; refreshNotes(); renderStages(); renderFavorites(); showScene();
    await pickAt(operation.a, false); announce('Neighbouring forms merged across the plan. The colour target and recipe have been refreshed.'); return;
  }
  await pickAt(point);
}
async function pickAt(point, addHistory = true) {
  const source = state.mode === 'original' ? 'original' : 'stage', radius = $('sample-mode').value === 'point' ? 0 : Number($('sample-radius').value);
  state.selection = { id: uid(), x: point.x, y: point.y, stage: state.stageIndex, source, values: state.values, radius, target: targetAt(point, source, state.stageIndex, state.values, radius), name: '' };
  if (addHistory) { state.picks.push(structuredClone(state.selection)); if (state.picks.length > 100) state.picks.shift(); }
  viewer.setSelection(state.selection); await requestMix();
}
function pickDescription(pick) { return `${pick.source === 'original' ? 'Original reference' : `Stage ${pick.stage + 1}: ${state.plan?.stages[pick.stage]?.title || 'saved stage'}`}${pick.values ? ' · values' : ''}${pick.radius ? ` · linear-light area average, radius ${pick.radius} source px` : ' · point sample'}`; }
async function requestMix() {
  if (!state.selection || !state.paints.length) return;
  const selection = state.selection;
  state.recipe = null; state.recipes = [];
  renderRecipe(); job('mix', 0, 'Searching enabled paints for a practical mix…');
  try {
    const { results } = await mixJob.run({ paints: state.paints, target: selection.target }, (value, message) => job('mix', value, message));
    if (state.selection !== selection) return;
    state.recipes = results; state.recipe = structuredClone(results[0]); renderRecipe();
    finishJob('mix', state.recipe.closest ? 'Closest available mix found. Compare the target and estimate; test a small amount first.' : 'Estimated mix ready. Test a small amount first.');
  } catch (error) {
    // A newer pick owns the progress panel; an obsolete request must not clear it.
    if (state.selection === selection && error.name !== 'AbortError') { finishJob('mix'); $('match-state').textContent = error.message; fail(error); }
  }
}
function renderRecipe() {
  const pick = state.selection, recipe = state.recipe;
  $('recipe-content').hidden = !pick; $('recipe-empty').hidden = !!pick; if (!pick) return;
  $('pick-label').textContent = pickDescription(pick);
  $('target-swatch').style.backgroundColor = rgbToHex(pick.target); $('target-hex').textContent = rgbToHex(pick.target);
  $('mix-swatch').style.backgroundColor = recipe ? rgbToHex(recipe.rgb) : 'transparent'; $('mix-hex').textContent = recipe ? rgbToHex(recipe.rgb) : 'Searching…';
  $('match-state').textContent = recipe ? recipe.closest ? 'Closest available mix — target beyond this estimate’s useful range.' : 'A practical estimated starting point.' : 'Looking for a mix from your enabled tubes…';
  $('match-state').classList.toggle('is-poor', !!recipe?.closest);
  $('mix-error').textContent = recipe ? `Screen colour distance: ΔE OK ${recipe.error.toFixed(1)} (lower is closer).` : '';
  $('favorite-recipe').disabled = !recipe;
  $('mix-parts').replaceChildren(); $('mix-instructions').replaceChildren(); $('alternatives').replaceChildren();
  if (!recipe) return;
  recipe.ids.forEach((id, i) => {
    const paint = state.paints.find(p => p.id === id), row = textElement('div', null, 'mix-part'), swatch = textElement('span', null, 'mini-swatch'); swatch.style.backgroundColor = paint.hex;
    const label = textElement('label', paint.name), input = document.createElement('input'); input.type = 'number'; input.min = '1'; input.max = '100'; input.step = '1'; input.value = recipe.parts[i]; input.setAttribute('aria-label', `Approximate parts of ${paint.name}`); label.htmlFor = `parts-${i}`; input.id = `parts-${i}`;
    input.addEventListener('change', safe(() => {
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < 1 || value > 100) { input.value = state.recipe.parts[i]; throw new Error('Use 1–100 whole approximate parts.'); }
      state.recipe.parts[i] = value;
      const mixed = forwardMix(state.paints, state.recipe.ids, state.recipe.parts); Object.assign(state.recipe, mixed);
      state.recipe.error = colorDistance(state.selection.target, mixed.rgb); state.recipe.closest = state.recipe.error > 5; renderRecipe();
      $('parts-' + i)?.focus({ preventScroll: true }); announce('Mix recalculated from the displayed parts.');
    }));
    row.append(swatch, label, input); $('mix-parts').append(row);
  });
  $('mix-parts').append(textElement('p', `Final ratio ${recipe.parts.join(' : ')} · ${recipe.ids.length} ${recipe.ids.length === 1 ? 'tube' : 'tubes'}`, 'small-note'));
  for (const instruction of recipeInstructions(recipe, state.paints)) $('mix-instructions').append(textElement('li', instruction));
  const alternatives = state.recipes.filter(r => r.ids.join('|') !== recipe.ids.join('|') || r.parts.join(':') !== recipe.parts.join(':')).slice(0, 3);
  for (const r of alternatives) {
    const button = textElement('button', null, 'alternative'); button.type = 'button';
    const swatch = textElement('span', null, 'mini-swatch'); swatch.style.backgroundColor = rgbToHex(r.rgb);
    button.append(swatch, textElement('span', `${r.ids.map((id, i) => `${r.parts[i]} ${state.paints.find(p => p.id === id).name}`).join(' + ')} · ΔE OK ${r.error.toFixed(1)}`));
    button.addEventListener('click', () => { state.recipe = structuredClone(r); renderRecipe(); }); $('alternatives').append(button);
  }
}
function renderFavorites() {
  const list = $('favorite-list'); list.replaceChildren(); $('favorite-count').textContent = state.favorites.length;
  $('favorites-empty').hidden = !!state.favorites.length;
  for (const note of state.favorites) {
    const row = textElement('div', null, 'favorite-item'), open = textElement('button'); open.type = 'button';
    open.append(textElement('span', note.name), textElement('small', note.needsRefresh ? 'Refresh required — saved estimate retained' : `${note.source === 'original' ? 'Original' : `Stage ${note.stage + 1}`} · ${note.recipe.parts.join(' : ')}`));
    open.addEventListener('click', safe(async () => {
      state.stageIndex = Math.min(note.stage, (state.plan?.stages.length || 1) - 1); state.mode = note.source; state.values = note.values;
      $('sample-mode').value = note.radius ? 'area' : 'point'; $('sample-radius').value = note.radius || 2; syncSampleControls();
      setInteraction('pick'); updateStageText(); showScene(); await pickAt(note, false);
      if (note.needsRefresh) announce('This colour was re-sampled and searched with the current plan and inventory. Save it as a new note to keep the update.');
    }));
    const remove = textElement('button', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${note.name}`);
    remove.addEventListener('click', () => { state.favorites = state.favorites.filter(p => p !== note); renderFavorites(); }); row.append(open, remove); list.append(row);
  }
}
function saveFavorite() {
  if (!state.recipe || !state.selection) return;
  if (state.favorites.length >= 100) return announce('You have 100 colour notes. Remove one before adding another.');
  const pick = structuredClone(state.selection);
  state.favorites.push({ ...pick, id: uid(), name: `${pick.source === 'original' ? 'Original' : `Stage ${pick.stage + 1}`} · ${rgbToHex(pick.target)}${pick.values ? ' · values' : ''}`,
    recipe: structuredClone(state.recipe), paintsSnapshot: structuredClone(state.paints), needsRefresh: false });
  renderFavorites(); announce('Colour note saved in this workspace. Save or export the project to keep it.');
}
function syncSampleControls() {
  $('sample-radius-label').hidden = $('sample-mode').value === 'point'; $('sample-radius-output').value = $('sample-radius').value;
}
async function restoreProject(raw) {
  const project = validateProject(raw), token = ++imageVersion;
  stageVersion++; stageJob.cancel(); mixJob.cancel(); printVersion++; jobs.clear(); job('upload', .1, 'Restoring the local project and reference…');
  try {
    const reference = await referenceFromRecord(project.reference);
    if (token !== imageVersion) { disposeReference(reference); return; }
    disposeReference(state.reference); state.reference = reference; state.analysis = analysisImage(reference);
    Object.assign(state, { paints: project.paints, settings: project.settings, plan: project.plan, focalPoints: project.focalPoints,
      stageIndex: project.stageIndex, projectId: project.id, projectName: project.name, picks: project.picks, favorites: project.favorites,
      mode: project.plan ? 'stage' : 'original', values: false, selection: null });
    $('project-name').value = project.name; sampleCache = new WeakMap(); writeSettings(); setInteraction('pick'); renderPalette(); renderStages(); refreshNotes(); renderFavorites(); resetRecipe(); showScene(true);
    finishJob('upload', 'Project restored, including its reference, inventory, painting stages and colour notes.');
  } catch (error) { finishJob('upload'); fail(error); }
}
async function readJSON(file, limit = MAX_PROJECT_BYTES) {
  if (!file || file.size > limit) throw new Error(`Choose a JSON file below ${Math.round(limit / 1024 ** 2)} MB.`);
  try { return JSON.parse(await file.text()); } catch { throw new Error('This is not valid JSON. Check commas, brackets and quotation marks.'); }
}
async function saveCurrentProject() {
  state.projectName = $('project-name').value.trim() || 'Untitled study';
  await storage.saveProject(serializeProject(state)); announce('Study saved locally in this browser. Export a portable project for a separate backup.');
}
async function openSavedProjects() {
  const dialog = $('projects-dialog'), list = $('project-list'); list.replaceChildren(textElement('p', 'Reading local studies…')); dialog.showModal();
  try {
    const projects = (await storage.listProjects()).sort((a, b) => b.savedAt.localeCompare(a.savedAt)); list.replaceChildren();
    if (!projects.length) list.append(textElement('p', 'No saved studies in this browser yet.'));
    for (const project of projects) {
      const row = textElement('div', null, 'project-item'), button = textElement('button'); button.type = 'button';
      button.append(textElement('span', project.name), textElement('small', new Date(project.savedAt).toLocaleString()));
      button.addEventListener('click', safe(async () => { const raw = await storage.loadProject(project.id); dialog.close(); await restoreProject(raw); })); row.append(button); list.append(row);
    }
  } catch (error) { list.replaceChildren(textElement('p', error.message)); }
}
async function printReference() {
  if (!state.plan) return;
  const token = ++printVersion, plan = state.plan, entries = [];
  if (state.recipe) entries.push({ name: 'Current colour note', source: pickDescription(state.selection), target: state.selection.target, recipe: state.recipe, paints: state.paints });
  for (const favorite of state.favorites.filter(n => !n.needsRefresh).slice(0, 6)) entries.push({ name: favorite.name, source: pickDescription(favorite), target: favorite.target, recipe: favorite.recipe, paints: favorite.paintsSnapshot });
  try {
    if (!entries.length) {
      const regions = [...plan.stages[state.stageIndex].regions].sort((a, b) => b.area - a.area).slice(0, 3);
      for (let i = 0; i < regions.length; i++) {
        job('print', i / regions.length, `Finding mixes for the reference sheet (${i + 1}/${regions.length})…`);
        const { results } = await mixJob.run({ paints: state.paints, target: regions[i].rgb });
        if (token !== printVersion || state.plan !== plan) return;
        entries.push({ name: `Stage ${state.stageIndex + 1} · form ${regions[i].id}`, source: `Current stage ${state.stageIndex + 1}`, target: regions[i].rgb, recipe: results[0], paints: state.paints });
      }
    }
    if (token !== printVersion || state.plan !== plan) return;
    buildPrintSheet($('print-sheet-content'), state, entries);
    finishJob('print', 'Reference sheet ready. Use your browser’s Print to PDF or print controls.');
    window.print();
  } catch (error) { finishJob('print'); fail(error); }
}

// File controls. Imported names are always inserted with textContent, never HTML.
for (const id of ['upload-open', 'empty-upload']) $(id).addEventListener('click', () => $('image-file').click());
$('image-file').addEventListener('change', safe(async () => { const file = $('image-file').files[0]; $('image-file').value = ''; if (file) await loadImage(file); }));
$('sample-reference').addEventListener('click', safe(async () => loadImage(await sampleReferenceFile())));
$('drop-zone').addEventListener('dragover', event => { event.preventDefault(); $('drop-zone').classList.add('is-dragging'); });
$('drop-zone').addEventListener('dragleave', () => $('drop-zone').classList.remove('is-dragging'));
$('drop-zone').addEventListener('drop', safe(async event => { event.preventDefault(); $('drop-zone').classList.remove('is-dragging'); const file = event.dataTransfer.files[0]; if (file) await loadImage(file); }));
$('project-name').addEventListener('input', () => { state.projectName = $('project-name').value; });
$('save-project').addEventListener('click', safe(saveCurrentProject));
$('open-project').addEventListener('click', safe(openSavedProjects));
$('export-project').addEventListener('click', safe(() => { const record = serializeProject(state), blob = new Blob([JSON.stringify(record)]); if (blob.size > MAX_PROJECT_BYTES) throw new Error('This project is larger than 50 MB. Save locally or use a smaller reference for portable export.'); downloadJSON(record, 'paint-studio-project.json'); announce('Portable project exported, including the reference image.'); }));
$('import-project').addEventListener('click', () => $('project-file').click());
$('project-file').addEventListener('change', safe(async () => { const file = $('project-file').files[0]; $('project-file').value = ''; if (file) await restoreProject(await readJSON(file)); }));
$('import-palette').addEventListener('click', () => $('palette-file').click());
$('palette-file').addEventListener('change', safe(async () => { const file = $('palette-file').files[0]; $('palette-file').value = ''; if (file) { const raw = await readJSON(file, 1024 ** 2); if (raw.version && raw.version !== 1) throw new Error('Unsupported palette version.'); state.paints = validatePalette(raw); renderPalette(); paletteChanged(); announce('Palette imported. Only enabled tubes will be used.'); } }));
$('export-palette').addEventListener('click', safe(() => downloadJSON(paletteFile(state.paints), 'my-paints.json')));
$('load-researched-palette').addEventListener('click', () => $('palette-dialog').showModal());
$('apply-researched-palette').addEventListener('click', safe(() => {
  state.paints = validatePalette(structuredClone(researchedPaints));
  renderPalette(); paletteChanged();
  announce(`Researched palette loaded: ${state.paints.length} website colour estimates. Test physical mixes before painting.`);
}));
$('add-paint').addEventListener('click', safe(() => {
  if (state.paints.length >= 32) throw new Error('A palette can contain at most 32 paints.');
  state.paints = validatePalette([...state.paints, { id: `custom-${uid()}`, name: 'My new paint', hex: '#80715a', enabled: false, provenance: { kind: 'user-estimate', note: 'Add your actual tube information. This starting swatch is not a measurement.' } }]);
  renderPalette(); paletteChanged(); const last = $('paint-list').lastElementChild; last.querySelector('details').open = true; last.scrollIntoView({ block: 'nearest' }); last.querySelector('input[type=text]').focus();
}));
for (const id of ['stage-count', 'detail', 'simplification', 'min-region', 'underpainting', 'ground', 'method']) $(id).addEventListener('input', safe(() => {
  syncSettingsLabels(); state.settings = readSettings();
  if (jobs.has('stages')) { stageVersion++; stageJob.cancel(); finishJob('stages', 'Settings changed. Generate again when ready.'); syncAvailability(); }
  $('plan-notice').textContent = state.plan ? 'Settings changed. The visible plan is unchanged until you regenerate.' : 'Ready to generate a broad-to-detail interpretation.';
}));
$('generate').addEventListener('click', safe(() => generateStages()));
$('protect-mode').addEventListener('click', () => setInteraction(state.interaction === 'protect' ? 'pick' : 'protect'));
$('merge-mode').addEventListener('click', () => setInteraction(state.interaction === 'merge' ? 'pick' : 'merge'));
$('focal-radius').addEventListener('input', () => { $('focal-radius-output').value = `${$('focal-radius').value}%`; });
$('clear-focals').addEventListener('click', () => { state.focalPoints = []; showScene(); $('plan-notice').textContent = 'Focal marks cleared. Regenerate to update the forms.'; });
$('undo-merge').addEventListener('click', safe(() => generateStages({ manualMerges: state.plan.manualMerges.slice(0, -1) })));
for (const mode of ['original', 'stage', 'added']) $(`view-${mode}`).addEventListener('click', safe(async () => { state.mode = mode; state.mergeStart = null; if (mode === 'original' && state.interaction === 'merge') setInteraction('pick'); showScene(); if (state.selection) await pickAt(state.selection, false); }));
$('values').addEventListener('change', safe(async () => { state.values = $('values').checked; renderStages(); showScene(); if (state.selection) await pickAt(state.selection, false); }));
for (const id of ['sample-mode', 'sample-radius']) $(id).addEventListener('change', safe(async () => { syncSampleControls(); if (state.selection) await pickAt(state.selection, false); }));
$('sample-radius').addEventListener('input', syncSampleControls);
$('zoom-in').addEventListener('click', () => viewer.zoom(viewer.view.zoom * 1.25));
$('zoom-out').addEventListener('click', () => viewer.zoom(viewer.view.zoom / 1.25));
$('fit-view').addEventListener('click', () => viewer.fit());
$('pick-center').addEventListener('click', safe(() => viewer.pick({ x: viewer.box.width / 2, y: viewer.box.height / 2 })));
$('previous-stage').addEventListener('click', safe(() => selectStage(state.stageIndex - 1)));
$('next-stage').addEventListener('click', safe(() => selectStage(state.stageIndex + 1)));
$('stage-slider').addEventListener('input', safe(() => selectStage(Number($('stage-slider').value))));
$('favorite-recipe').addEventListener('click', saveFavorite);
$('export-stage').addEventListener('click', safe(() => exportStage(state.plan, state.stageIndex, state.values)));
$('print-sheet').addEventListener('click', safe(printReference));
$('cancel-job').addEventListener('click', () => { stageVersion++; stageJob.cancel(); mixJob.cancel(); printVersion++; jobs.clear(); finishJob('all', 'Processing cancelled. Your current reference and completed stages are unchanged.'); if (state.selection && !state.recipe) { $('match-state').textContent = 'Search cancelled. Tap the image again to find a mix.'; $('mix-hex').textContent = '—'; } syncAvailability(); });
$('help-open').addEventListener('click', () => $('help-dialog').showModal());
for (const id of ['help-dialog', 'projects-dialog', 'palette-dialog']) $(id).addEventListener('click', event => { if (event.target === $(id)) { const r = $(id).getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $(id).close(); } });
window.addEventListener('pagehide', () => { stageJob.destroy(); mixJob.destroy(); releaseDownloads(); });
window.addEventListener('pageshow', event => { if (event.persisted) showScene(); });
if (matchMedia('(max-width: 720px)').matches) $('plan-panel').open = false;

try {
  const response = await fetch('data/paints.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('Could not load the starter paint inventory. Serve this folder through HTTP.');
  researchedPaints = validatePalette(await response.json());
  state.paints = structuredClone(researchedPaints);
  try { state.paints = selectInitialPalette(researchedPaints, await storage.loadInventory()); } catch (error) { fail(error); }
  $('load-researched-palette').disabled = false;
  renderPalette(); writeSettings(); syncAvailability(); renderFavorites();
} catch (error) { fail(error); }
