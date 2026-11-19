import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validatePalette, paletteSignature, paletteFile, isOriginalStarter, selectInitialPalette, MAX_PAINTS } from '../palette.js';
import { forwardMix, RecipeSearch, evaluateRecipe, recipeInstructions, simpleParts } from '../mixing.js';
import { colorDistance, samplePixels, valueRGB } from '../color.js';
import { generatePlan, stagePixels, focalMask, applyManualMerge, regionsAdjacent, regionAt } from '../segmentation.js';
import { imageToScreen, screenToImage, initialView, zoomAt, panBy } from '../viewport.js';
import { encodeLabels, decodeLabels, serializeProject, validateProject } from '../project.js';

const researched = validatePalette(JSON.parse(await readFile(new URL('../data/paints.json', import.meta.url))));
// Stable synthetic inventory for model regression tests, independent of catalogue updates.
const paints = validatePalette([
  ['titanium-white', 'Titanium White', '#f3f1e7'], ['ivory-black', 'Ivory Black', '#242424'],
  ['yellow-ochre', 'Yellow Ochre', '#b58b32'], ['yellow', 'Warm Yellow', '#f3ca21'],
  ['warm-red', 'Warm Red', '#c4422e'], ['cool-red', 'Cool Red', '#942644'],
  ['ultramarine', 'Ultramarine Blue', '#283d8d'], ['phthalo-blue', 'Phthalo Blue', '#105a70'],
  ['burnt-sienna', 'Burnt Sienna', '#8f492e'], ['burnt-umber', 'Burnt Umber', '#514035'],
  ['green', 'Cool Green', '#285b4c']
].map(([id, name, hex]) => ({id, name, hex, enabled: id !== 'green', isWhite: id === 'titanium-white', provenance: {kind:'generic-estimate', note: id === 'titanium-white' ? 'Unmeasured generic sRGB colour; strength defaults to a neutral assumption.' : ''}})));
function fixture(width = 96, height = 72) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let rgb = y < height * .6 ? [125 + x / 5, 159, 150] : [60, 100 + y / 4, 95];
    if (((x - width * .5) / (width * .34)) ** 2 + ((y - height * .53) / (height * .24)) ** 2 < 1) rgb = [212 + x / 8, 178 + y / 5, 110];
    if ((x - width * .67) ** 2 + (y - height * .4) ** 2 < (width * .025) ** 2) rgb = [20, 25, 28];
    data.set([...rgb, 255], (y * width + x) * 4);
  }
  return { data, width, height };
}
function assertConnected(plan) {
  for (const stage of plan.stages) {
    const visited = new Uint8Array(stage.labels.length), ids = new Set();
    for (let p = 0; p < visited.length; p++) if (!visited[p]) {
      const id = stage.labels[p]; assert.ok(!ids.has(id), `region ${id} disconnected`); ids.add(id);
      const queue = [p]; visited[p] = 1;
      for (let head = 0; head < queue.length; head++) {
        const q = queue[head], x = q % plan.width;
        for (const r of [x ? q - 1 : -1, x < plan.width - 1 ? q + 1 : -1, q - plan.width, q + plan.width]) if (r >= 0 && r < visited.length && !visited[r] && stage.labels[r] === id) { visited[r] = 1; queue.push(r); }
      }
    }
    assert.equal(ids.size, stage.regions.length);
  }
}
function assertParents(plan) {
  for (let s = 1; s < plan.stages.length; s++) {
    const ids = new Map(plan.stages[s].regions.map(r => [r.id, r.parentId]));
    for (let p = 0; p < plan.width * plan.height; p++) assert.equal(ids.get(plan.stages[s].labels[p]), plan.stages[s - 1].labels[p]);
  }
}
const focal = { x: .67, y: .4, radius: .055 };
const plan = await generatePlan({ ...fixture(), settings: { stages: 5, minRegion: 12 }, focalPoints: [focal] });

test('palette is explicitly estimated; identity stays unknown; custom calibration is preserved, not invented', () => {
  assert.ok(paints.every(p => p.provenance.kind === 'generic-estimate' && p.brand === null && p.pigments === null));
  const p = validatePalette([{ id: 'custom', name: '<img onerror=bad>', hex: '#123456', calibration: { source: 'user', reflectance: Array(38).fill(.3) } }])[0];
  assert.equal(p.name, '<img onerror=bad>'); assert.equal(p.calibration.reflectance.length, 38);
  assert.throws(() => validatePalette([{ ...p, hex: 'red' }]));
  assert.throws(() => validatePalette([p, p]));
  assert.throws(() => validatePalette(Array.from({ length: MAX_PAINTS + 1 }, (_, i) => ({ ...p, id: `p${i}` }))));
});
test('26 sourced estimates distinguish confirmed tubes from named catalogue references and survive export', () => {
  assert.equal(researched.length, 26); assert.ok(researched.every(p => p.enabled && p.tintingStrength === 1 && !p.calibration));
  assert.ok(researched.every(p => p.provenance.kind === 'web-swatch-estimate' && p.provenance.source.startsWith('https:') && p.provenance.swatchSource && p.provenance.method && p.provenance.checked === '2026-11-19'));
  assert.equal(researched.filter(p => p.brand === 'boesner').length, 9);
  assert.ok(researched.filter(p => p.brand === 'boesner').every(p => p.series === 'Öl Studio' && !p.pigments && !p.provenance.referencePigments));
  const sevres = researched.find(p => p.id === 'sevres-blue');
  assert.equal(sevres.brand, 'Royal Talens'); assert.equal(sevres.pigments, 'PB15, PW6'); assert.equal(sevres.hex, '#2c9abe');
  assert.ok(researched.filter(p => !p.brand).every(p => !p.series && !p.pigments && p.provenance.referencePigments && p.provenance.pigmentSource));
  assert.ok(researched.find(p => p.id === 'alizarin-crimson').provenance.reference.includes('Van Gogh'));
  assert.ok(researched.some(p => p.id === 'boesner-echtgelb-zitron') && researched.some(p => p.id === 'lemon-yellow'));
  assert.deepEqual(validatePalette(paletteFile(researched)), researched);
  const unsafe = validatePalette([{ ...sevres, provenance: {kind:'user-estimate',source:'javascript:alert(1)',pigmentSource:'https://user:secret@example.com/'}}])[0];
  assert.equal(unsafe.provenance.source, undefined); assert.equal(unsafe.provenance.pigmentSource, undefined);
});
test('only the untouched original starter upgrades; saved edits and project inventories are preserved', () => {
  assert.equal(isOriginalStarter(paints), true);
  assert.deepEqual(selectInitialPalette(researched, null), researched);
  assert.deepEqual(selectInitialPalette(researched, paints), researched);
  for (const edit of [{name:'My white'}, {hex:'#ffffff'}, {enabled:false}, {brand:'My brand'}, {pigments:'PW6'}, {tintingStrength:1.2}, {calibration:{source:'measured by user'}}, {provenance:{kind:'user-estimate',note:'My note'}}]) {
    const saved = validatePalette(paints.map((p, i) => i ? p : {...p,...edit}));
    assert.equal(isOriginalStarter(saved), false); assert.deepEqual(selectInitialPalette(researched, saved), saved);
  }
});
test('the full 26-colour inventory mixes, cancels and caches without the old 24-tube limit', async () => {
  const engine = new RecipeSearch(), target = [123, 117, 92], results = await engine.search(researched, target);
  assert.ok(results.length && results.every(r => r.ids.length <= 3));
  for (const r of results) assert.deepEqual(r.rgb, forwardMix(researched, r.ids, r.parts).rgb);
  assert.deepEqual(await engine.search(researched, target), results);
  const full = validatePalette(Array.from({length:32}, (_,i)=>({...researched[i%26],id:`tube-${i}`})));
  await assert.rejects(() => new RecipeSearch().search(full,target,{cancelled:()=>true}), {name:'AbortError'});
});
test('point and small-area sampling average linear light, including edges', () => {
  const rgb = samplePixels(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]), 2, 1, 0, 0, 1);
  assert.ok(rgb.every(v => v >= 187 && v <= 188));
  assert.deepEqual(samplePixels(new Uint8ClampedArray([12, 25, 50, 255]), 1, 1, 7, -2, 12), [12, 25, 50]);
  assert.ok(new Set(valueRGB([100, 20, 200])).size === 1);
});
test('forward mixer is subtractive and enforces enabled tubes and maximum three including white', () => {
  const mix = forwardMix(paints, ['yellow', 'ultramarine'], [1, 1]);
  assert.ok(mix.rgb[1] > mix.rgb[0] && mix.rgb[1] > mix.rgb[2]);
  assert.ok(Math.abs(mix.weights.reduce((a, b) => a + b) - 1) < 1e-12);
  assert.throws(() => forwardMix(paints, ['green'], [1]));
  assert.throws(() => forwardMix(paints, ['yellow', 'ultramarine', 'warm-red', 'titanium-white'], [1, 1, 1, 1]));
  assert.throws(() => forwardMix(paints, ['yellow'], [-1]));
  assert.throws(() => forwardMix(paints, ['yellow'], [0]));
  assert.throws(() => forwardMix(paints, ['yellow', 'yellow'], [1, 1]));
});
test('recipe search is reproducible, uses available paints and rescoring matches displayed simplified parts', async () => {
  const inventory = paints.filter(p => ['titanium-white', 'warm-red', 'ultramarine', 'yellow', 'burnt-umber'].includes(p.id));
  const target = [131, 103, 123], a = await new RecipeSearch().search(inventory, target), b = await new RecipeSearch().search(inventory, target);
  assert.deepEqual(a, b); assert.equal(a.length, 3);
  for (const r of a) {
    assert.ok(r.ids.length <= 3 && r.ids.every(id => inventory.some(p => p.id === id && p.enabled)));
    assert.ok(r.parts.every(v => Number.isInteger(v) && v > 0)); assert.ok(r.weights.every(v => v >= 0));
    const predicted = forwardMix(inventory, r.ids, r.parts);
    assert.deepEqual(r.rgb, predicted.rgb); assert.ok(Math.abs(r.error - colorDistance(target, predicted.rgb)) < 1e-10);
    assert.ok(Math.abs(r.weights.reduce((x, y) => x + y) - 1) < 1e-12);
  }
  const r = evaluateRecipe(inventory, target, ['warm-red', 'titanium-white'], [.31735, .68265]);
  assert.deepEqual(r.rgb, forwardMix(inventory, r.ids, r.parts).rgb);
  assert.ok(r.parts.every(Number.isInteger)); assert.deepEqual(simpleParts([2, 2]), [1, 1]);
  const instructions = recipeInstructions(a[0], inventory).join(' ');
  for (let i = 0; i < a[0].ids.length; i++) assert.ok(instructions.includes(`${a[0].parts[i]} approximate`));
});
test('cache invalidates with enabled inventory; empty and poor palettes fail gracefully', async () => {
  const engine = new RecipeSearch(), p = paints.filter(p => p.id === 'ivory-black');
  const poor = await engine.search(p, [255, 0, 255]); assert.equal(poor[0].closest, true); assert.ok(poor[0].error > 5);
  assert.deepEqual(await engine.search(p, [255, 0, 255]), poor);
  assert.notEqual(paletteSignature(p), paletteSignature(p.map(p => ({ ...p, enabled: false }))));
  await assert.rejects(() => engine.search(p.map(p => ({ ...p, enabled: false })), [0, 0, 0]), /Enable/);
  await assert.rejects(() => new RecipeSearch().search(paints, [10, 10, 10], { cancelled: () => true }), { name: 'AbortError' });
});
test('stages are distinct, coarse-to-fine, connected and share consistent parents', () => {
  assert.equal(plan.stages.length, 5); assertConnected(plan); assertParents(plan);
  for (let i = 1; i < plan.stages.length; i++) {
    assert.ok(plan.stages[i].regions.length > plan.stages[i - 1].regions.length);
    assert.notDeepEqual(stagePixels(plan, i), stagePixels(plan, i - 1));
  }
  assert.ok(plan.stages[0].regions.every(r => new Set(r.rgb).size === 1));
  assert.notDeepEqual(stagePixels(plan, 3, { added: true }), stagePixels(plan, 3));
});
test('focal detail survives and unprotected tiny noise is removed', () => {
  const region = regionAt(plan, 4, focal.x, focal.y);
  assert.ok(region.rgb.every(v => v < 80), 'protected dark eye should remain distinct');
  const mask = focalMask(plan.width, plan.height, [focal]), protectedIDs = new Set();
  plan.stages[4].labels.forEach((id, i) => { if (mask[i]) protectedIDs.add(id); });
  assert.ok(plan.stages[4].regions.every(r => r.area >= 12 || protectedIDs.has(r.id)));
});
test('ground foundation targets equal rendered colours and stage generation is deterministic', async () => {
  const p = await generatePlan({ ...fixture(), settings: { stages: 3, underpainting: 'ground', ground: '#805c35' } });
  const q = await generatePlan({ ...fixture(), settings: { stages: 3, underpainting: 'ground', ground: '#805c35' } });
  assert.deepEqual(p.stages, q.stages);
  assert.ok(p.stages[0].regions.some(r => new Set(r.rgb).size > 1));
  const rgb = regionAt(p, 0, .5, .5).rgb, pixel = (Math.floor(.5 * p.height) * p.width + Math.floor(.5 * p.width)) * 4;
  assert.deepEqual([...stagePixels(p, 0).slice(pixel, pixel + 3)], rgb);
});
test('three and eight stages, cancellation and tiny flat references remain well formed', async () => {
  const p = await generatePlan({ ...fixture(), settings: { stages: 8, underpainting: 'none', detail: 5, simplification: 1 } });
  assert.equal(p.stages.length, 8); assertConnected(p); assertParents(p);
  const flat = await generatePlan({ width: 1, height: 1, data: new Uint8ClampedArray([70, 90, 110, 255]), settings: { stages: 3 } });
  assert.equal(flat.stages.length, 3); assert.ok(flat.stages.every(s => s.regions.length === 1));
  await assert.rejects(() => generatePlan({ ...fixture(), settings: { stages: 5 } }, { cancelled: () => true }), { name: 'AbortError' });
});
test('adjacent manual merge updates descendants, colours and parent consistency', () => {
  const p = structuredClone(plan), stage = p.stages[2]; let operation;
  for (let i = 0; i < stage.labels.length - 1; i++) if (i % p.width < p.width - 1 && stage.labels[i] !== stage.labels[i + 1]) {
    operation = { stage: 2, a: { x: (i % p.width + .5) / p.width, y: (Math.floor(i / p.width) + .5) / p.height }, b: { x: (i % p.width + 1.5) / p.width, y: (Math.floor(i / p.width) + .5) / p.height } }; break;
  }
  assert.ok(operation); assert.ok(applyManualMerge(p, operation));
  assert.ok(p.stages[2].regions.length < plan.stages[2].regions.length); assertConnected(p); assertParents(p);
  for (let s = 2; s < p.stages.length; s++) assert.equal(regionAt(p, s, operation.a.x, operation.a.y).id, regionAt(p, s, operation.b.x, operation.b.y).id);
  assert.equal(p.manualMerges.length, 1);
  const ids = plan.stages[4].regions.map(r => r.id), a = ids[0], b = ids.find(id => id !== a && !regionsAdjacent(plan.stages[4].labels, plan.width, a, id));
  assert.ok(b != null);
});
test('zoom, pan, anchor and resized picking use one invertible coordinate mapping', () => {
  const image = { width: 2000, height: 1400 };
  for (const box of [{ width: 900, height: 600 }, { width: 390, height: 360 }, { width: 750, height: 500 }]) {
    const view = panBy(zoomAt(initialView(), 3, { x: box.width / 2, y: box.height / 2 }, box, image), -45, 17, box, image);
    for (const point of [{ x: .3, y: .4 }, { x: .7, y: .65 }]) {
      const back = screenToImage(imageToScreen(point, view, box, image), view, box, image);
      assert.ok(Math.abs(back.x - point.x) < 1e-12 && Math.abs(back.y - point.y) < 1e-12);
    }
    const anchor = { x: box.width * .55, y: box.height * .5 }, before = screenToImage(anchor, view, box, image);
    const after = screenToImage(anchor, zoomAt(view, 4, anchor, box, image), box, image);
    assert.ok(Math.abs(before.x - after.x) < 1e-12 && Math.abs(before.y - after.y) < 1e-12);
  }
});
test('portable project round trip keeps image, inventory, maps, picks and recipes; rejects corrupt input', async () => {
  const recipe = (await new RecipeSearch().search(paints.slice(0, 4), [100, 110, 120]))[0];
  const selection = { id: 'pick-1', name: 'A note', x: .5, y: .5, source: 'stage', stage: 2, radius: 0, values: false, target: [100, 110, 120] };
  const state = { reference: { name: 'Reference', dataURL: 'data:image/png;base64,AA==', width: 96, height: 72, originalWidth: 384, originalHeight: 288 }, projectId: 'test', projectName: '<script>not markup</script>', settings: plan.settings, paints: paints.slice(0, 4), focalPoints: [focal], plan, stageIndex: 2, picks: [selection], favorites: [{ ...selection, recipe, paintsSnapshot: paints.slice(0, 4), needsRefresh: false }] };
  const portable = JSON.parse(JSON.stringify(serializeProject(state))), restored = validateProject(portable);
  assert.deepEqual(restored.plan.stages, plan.stages); assert.deepEqual(restored.paints, state.paints); assert.equal(restored.reference.dataURL, state.reference.dataURL); assert.equal(restored.name, state.projectName); assert.deepEqual(restored.favorites[0].recipe.parts, recipe.parts);
  assert.deepEqual(decodeLabels(encodeLabels(plan.stages[4].labels), plan.width * plan.height), plan.stages[4].labels);
  assert.throws(() => validateProject({ ...portable, version: 100 }));
  assert.throws(() => validateProject({ ...portable, reference: { ...portable.reference, dataURL: 'javascript:alert(1)' } }));
  assert.throws(() => decodeLabels([1, 9], 10));
  const bad = structuredClone(portable); bad.plan.stages[1].regions[0].parentId = 999999; assert.throws(() => validateProject(bad), /parent/);
  const badRecipe = structuredClone(portable); badRecipe.favorites[0].recipe.ids.push('invented'); assert.throws(() => validateProject(badRecipe));
});
