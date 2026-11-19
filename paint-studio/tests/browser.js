import { decodeReference, disposeReference, sampleReferenceFile, canvas2D } from '../image.js';
import { samplePixels, colorDistance } from '../color.js';
import { validateProject } from '../project.js';
import { forwardMix } from '../mixing.js';
import * as storage from '../storage.js';

const frame = document.getElementById('app'), results = document.getElementById('test-results');
document.getElementById('browser-info').textContent = navigator.userAgent;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message = 'Assertion failed') => { if (!condition) throw new Error(message); };
async function wait(fn, message, timeout = 20000) { const start = performance.now(); while (!fn()) { if (performance.now() - start > timeout) throw new Error(message); await pause(40); } }
let passed = 0, failed = 0, win, doc, record, initialInventory, testProjectID;
const downloads = [], errors = [];
async function test(name, fn) {
  const li = document.createElement('li'); li.textContent = `${name} — running`; results.append(li);
  try { await fn(); li.textContent = `PASS — ${name}`; passed++; }
  catch (error) { li.textContent = `FAIL — ${name}: ${error.message}`; li.style.color = '#8e362c'; failed++; }
  document.getElementById('test-status').textContent = `${passed} passed · ${failed} failed · running…`;
}
const get = id => doc.getElementById(id);
async function readyMix() { await pause(40); await wait(() => !get('favorite-recipe').disabled, `Mix did not finish: ${get('status').textContent}`); }
async function setFile(id, file) {
  const transfer = new win.DataTransfer();
  transfer.items.add(new win.File([await file.arrayBuffer()], file.name, { type: file.type }));
  get(id).files = transfer.files; get(id).dispatchEvent(new win.Event('change', { bubbles: true }));
  await pause(80);
}
function change(id, value, type = 'change') { get(id).value = value; get(id).dispatchEvent(new win.Event(type, { bubbles: true })); }
async function generate() { get('generate').click(); await pause(50); await wait(() => !get('stage-panel').hidden && !get('generate').disabled, `Generation failed: ${get('status').textContent}`); }
function captureDownloads() {
  const createURL = win.URL.createObjectURL.bind(win.URL), blobs = new Map();
  win.URL.createObjectURL = blob => { const url = createURL(blob); blobs.set(url, blob); return url; };
  const nativeClick = win.HTMLAnchorElement.prototype.click;
  win.HTMLAnchorElement.prototype.click = function () { if (this.download && blobs.has(this.href)) downloads.push({ name: this.download, blob: blobs.get(this.href) }); else nativeClick.call(this); };
}
function pointer(type, id, x, y, pointerType = 'touch') {
  const box = get('viewer').getBoundingClientRect();
  get('viewer').dispatchEvent(new win.PointerEvent(type, { bubbles: true, pointerId: id, pointerType, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: box.left + x, clientY: box.top + y }));
}
async function removeOwnTestState() {
  const db = await new Promise((resolve, reject) => { const request = indexedDB.open('ata-paint-studio', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['projects', 'preferences'], 'readwrite');
    if (testProjectID) tx.objectStore('projects').delete(testProjectID);
    if (initialInventory) tx.objectStore('preferences').put(initialInventory, 'inventory-v1'); else tx.objectStore('preferences').delete('inventory-v1');
    tx.oncomplete = resolve; tx.onerror = reject;
  }); db.close();
}
try {
  initialInventory = await storage.loadInventory();
  await wait(() => frame.contentDocument?.getElementById('paint-count')?.textContent.includes('available'), 'The app did not load');
  win = frame.contentWindow; doc = frame.contentDocument;
  win.addEventListener('error', event => errors.push(event.message)); win.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  captureDownloads();
  await test('26 researched paints load through a cancellable, accessible replacement dialog', async () => {
    get('paints-panel').open = true;
    const before = get('paint-count').textContent;
    get('load-researched-palette').click(); assert(get('palette-dialog').open);
    assert(get('palette-dialog').getAttribute('aria-labelledby') === 'palette-title');
    get('palette-dialog').querySelector('[value=cancel]').click(); assert(!get('palette-dialog').open);
    assert(get('paint-count').textContent === before, 'Cancel changed the inventory');
    get('load-researched-palette').click(); get('apply-researched-palette').click();
    await wait(() => get('paint-count').textContent === '26 available', 'Researched palette did not load');
    assert(get('paint-list').children.length === 26);
    const sevres = [...get('paint-list').children].find(e => e.textContent.includes('Sèvres Blue'));
    assert(sevres.textContent.includes('PB15, PW6') && sevres.textContent.includes('No measured spectra.'));
    assert(sevres.querySelector('a').href.startsWith('https://www.royaltalens.com/'));
    get('paints-panel').open = false;
  });
  await test('Direct static route, private local assets, return link and footer entry', async () => {
    assert(doc.title === 'Paint Studio | Ata Murat Kalkan');
    assert(new URL(doc.querySelector('.studio-header nav a').href).pathname === '/');
    const home = new DOMParser().parseFromString(await (await fetch('../../')).text(), 'text/html');
    assert(home.querySelector('.site-footer a[href="paint-studio/"]')); assert(home.querySelector('.site-footer a[href="tools/instagram-carousel/"]'));
    assert(!home.querySelector('script[src*="paint-studio"]')); assert((await fetch('../../tools/instagram-carousel/')).ok);
  });
  await test('JPEG, PNG, WebP and EXIF clockwise orientation use the same sRGB sampling path', async () => {
    const { canvas, context } = canvas2D(120, 80); context.fillStyle = '#d62820'; context.fillRect(0, 0, 60, 80); context.fillStyle = '#2040d6'; context.fillRect(60, 0, 60, 80);
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, type, .95)); assert(blob?.type === type, `${type} encoder unavailable`);
      const ref = await decodeReference(new File([blob], 'fixture', { type })); assert(ref.width === 120 && ref.height === 80);
      assert(samplePixels(ref.pixels.data, ref.width, ref.height, 20, 40)[0] > 170); disposeReference(ref);
    }
    const jpeg = new Uint8Array(await (await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .95))).arrayBuffer());
    const exif = new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
    const oriented = await decodeReference(new File([jpeg.slice(0, 2), exif, jpeg.slice(2)], 'rotated.jpg', { type: 'image/jpeg' }));
    assert(oriented.width === 80 && oriented.height === 120, 'EXIF orientation not applied');
    const top = samplePixels(oriented.pixels.data, 80, 120, 40, 20), bottom = samplePixels(oriented.pixels.data, 80, 120, 40, 100);
    assert(top[0] > top[2] && bottom[2] > bottom[0], 'oriented picking is wrong'); disposeReference(oriented);
  });
  await test('Invalid upload leaves a usable workspace and explains unsupported formats', async () => {
    await setFile('image-file', new File(['not a supported image'], 'bad.heic', { type: 'image/heic' }));
    await wait(() => get('status').classList.contains('is-error'), 'No upload error'); assert(get('status').textContent.includes('HEIC'));
    assert(get('empty-state').hidden === false);
  });
  await test('Large reference is downscaled for analysis without distorting its aspect ratio', async () => {
    const { canvas, context } = canvas2D(4000, 3000); context.fillStyle = '#63909a'; context.fillRect(0, 0, 4000, 3000);
    const file = new File([await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))], 'large.png', { type: 'image/png' });
    await setFile('image-file', file); await wait(() => get('reference-info').textContent.includes('2200 × 1650'), 'Large upload did not finish');
    assert(get('reference-info').textContent.includes('512 × 384')); canvas.width = canvas.height = 1;
  });
  await test('Actual stage worker generates five connected stages and live thumbnail navigation', async () => {
    await setFile('image-file', await sampleReferenceFile());
    await wait(() => get('project-name').value === 'Synthetic bird study', 'Synthetic upload did not finish');
    get('plan-panel').open = true; await generate();
    assert(get('stage-strip').children.length === 5, 'Wrong thumbnail count');
    assert(get('view-stage').getAttribute('aria-pressed') === 'true', 'Stage view not selected');
    get('next-stage').click(); await wait(() => get('stage-number').textContent.startsWith('Stage 2'), 'Next stage did not advance');
    change('stage-slider', 4, 'input'); await wait(() => get('stage-title').textContent === 'Details & accents', 'Stage slider did not select the last stage');
  });
  await test('Stage/original/value targets are explicit; the real mix worker returns editable recipes', async () => {
    get('pick-center').click(); await readyMix();
    assert(get('pick-label').textContent.startsWith('Stage 5')); assert(get('mix-parts').querySelectorAll('input').length <= 3);
    const stageTarget = get('target-hex').textContent;
    get('view-original').click(); await readyMix(); assert(get('pick-label').textContent.startsWith('Original'));
    get('values').checked = true; get('values').dispatchEvent(new win.Event('change')); await readyMix();
    const value = get('target-hex').textContent; assert(value.slice(1, 3) === value.slice(3, 5) && value.slice(3, 5) === value.slice(5));
    assert(get('pick-label').textContent.includes('values')); assert(stageTarget.startsWith('#'));
    const input = get('mix-parts').querySelector('input'), old = Number(input.value); change(input.id, old + 3); await pause(50);
    assert(get('mix-instructions').textContent.includes(`${old + 3} approximate`));
    get('favorite-recipe').click(); assert(get('favorite-count').textContent === '1', 'Favourite was not added');
  });
  await test('Small-area controls, wheel/keyboard zoom, pan and synthetic pinch distinguish drags from picks', async () => {
    change('sample-mode', 'area'); change('sample-radius', '4'); await readyMix(); assert(get('pick-label').textContent.includes('radius 4'));
    get('zoom-in').click(); assert(get('zoom-label').textContent === '125%');
    get('viewer').dispatchEvent(new win.KeyboardEvent('keydown', { key: '+', bubbles: true })); assert(Number.parseInt(get('zoom-label').textContent) > 125);
    const canvas = get('viewer'), nativeCapture = canvas.setPointerCapture; canvas.setPointerCapture = () => {}; // Untrusted test pointer IDs cannot acquire native capture.
    const rect = canvas.getBoundingClientRect(), x = rect.width / 2, y = rect.height / 2, beforePick = get('pick-label').textContent;
    pointer('pointerdown', 1, x, y, 'mouse'); pointer('pointermove', 1, x + 45, y + 15, 'mouse'); pointer('pointerup', 1, x + 45, y + 15, 'mouse'); assert(get('pick-label').textContent === beforePick);
    const zoom = Number.parseInt(get('zoom-label').textContent);
    pointer('pointerdown', 2, x - 35, y); pointer('pointerdown', 3, x + 35, y); pointer('pointermove', 2, x - 70, y); pointer('pointermove', 3, x + 70, y); pointer('pointerup', 2, x - 70, y); pointer('pointerup', 3, x + 70, y);
    assert(Number.parseInt(get('zoom-label').textContent) > zoom); assert(get('pick-label').textContent === beforePick);
    canvas.setPointerCapture = nativeCapture; get('fit-view').click(); assert(get('zoom-label').textContent === '100%');
  });
  await test('Focal marking, regenerate, adjacent merge and undo update the current plan', async () => {
    get('values').checked = false; get('values').dispatchEvent(new win.Event('change')); get('view-stage').click();
    await pause(40); get('protect-mode').click(); get('pick-center').click(); await wait(() => get('status').textContent.includes('1 focal marks'), 'Focal mark did not get added');
    await generate();
    get('export-project').click(); await wait(() => downloads.length > 0, 'No project download');
    const raw = JSON.parse(await downloads.at(-1).blob.text()), project = validateProject(raw); assert(project.focalPoints.length === 1);
    const stage = project.plan.stages[project.stageIndex]; let a, b;
    for (let p = 0; p < stage.labels.length - 1; p++) if (p % project.plan.width < project.plan.width - 1 && stage.labels[p] !== stage.labels[p + 1]) { a = { x: (p % project.plan.width + .5) / project.plan.width, y: (Math.floor(p / project.plan.width) + .5) / project.plan.height }; b = { ...a, x: a.x + 1 / project.plan.width }; break; }
    assert(a && b);
    const canvas = get('viewer'), rect = canvas.getBoundingClientRect(), scale = Math.min(rect.width / raw.reference.width, rect.height / raw.reference.height), left = (rect.width - raw.reference.width * scale) / 2, top = (rect.height - raw.reference.height * scale) / 2;
    const nativeCapture = canvas.setPointerCapture; canvas.setPointerCapture = () => {};
    get('merge-mode').click();
    for (const [i, p] of [a, b].entries()) { const x = left + p.x * raw.reference.width * scale, y = top + p.y * raw.reference.height * scale; pointer('pointerdown', 40 + i, x, y, 'mouse'); pointer('pointerup', 40 + i, x, y, 'mouse'); await pause(160); }
    canvas.setPointerCapture = nativeCapture;
    try { await wait(() => !get('undo-merge').disabled, 'The adjacent merge did not update the plan', 2000); }
    catch { throw new Error(`Merge did not update: ${get('status').textContent}; ${get('correction-note').textContent}; points ${JSON.stringify([a, b])}`); }
    get('undo-merge').click(); await wait(() => !get('generate').disabled && get('undo-merge').disabled, 'Undo did not regenerate');
    get('paints-panel').open = true;
    const checkbox = get('paint-list').querySelector('input[type=checkbox]'); checkbox.checked = false; checkbox.dispatchEvent(new win.Event('change'));
    await wait(() => get('favorite-list').textContent.includes('Refresh required'), 'Changed inventory did not mark the old estimate');
  });
  await test('PNG export and reference-sheet print use actual stage colours and recipes', async () => {
    get('pick-center').click(); await readyMix();
    const before = downloads.length; get('export-stage').click(); await wait(() => downloads.length > before, 'No PNG export');
    const image = await createImageBitmap(downloads.at(-1).blob); assert(Math.max(image.width, image.height) === 1600); image.close();
    let printed = false; win.print = () => { printed = true; }; get('print-sheet').click(); await wait(() => printed, 'No print request');
    assert(get('print-sheet-content').querySelectorAll('.print-stages img').length === 5);
    assert(get('print-sheet-content').textContent.includes('approximate parts'));
  });
  await test('Save, portable export/import and IndexedDB retain reference, inventory, maps and recipe snapshots', async () => {
    get('project-name').value = 'Paint Studio temporary verification'; get('project-name').dispatchEvent(new win.Event('input'));
    get('save-project').click(); await wait(() => get('status').textContent.includes('Study saved locally'), 'No save confirmation');
    const before = downloads.length; get('export-project').click(); await wait(() => downloads.length > before, 'No portable export');
    record = JSON.parse(await downloads.at(-1).blob.text()); testProjectID = record.id; const restored = validateProject(record);
    assert(restored.reference.dataURL.startsWith('data:image/png')); assert(restored.plan.stages.length === 5); assert(restored.favorites.length === 1);
    const saved = validateProject(await storage.loadProject(record.id)); assert(saved.reference.dataURL === restored.reference.dataURL); assert(saved.paints.length === restored.paints.length);
    const recipe = saved.favorites[0].recipe, calculated = forwardMix(saved.favorites[0].paintsSnapshot, recipe.ids, recipe.parts);
    assert(colorDistance(calculated.rgb, recipe.rgb) < .01);
    await setFile('project-file', new File([JSON.stringify(record)], 'roundtrip.json', { type: 'application/json' }));
    await wait(() => get('status').textContent.includes('Project restored'), 'Project import did not finish');
    assert(get('stage-strip').children.length === 5); assert(get('favorite-count').textContent === '1');
    const bad = { ...record, version: 99 }; await setFile('project-file', new File([JSON.stringify(bad)], 'invalid.json', { type: 'application/json' }));
    assert(get('status').classList.contains('is-error')); assert(get('stage-strip').children.length === 5, 'Invalid import destroyed existing project');
  });
  await test('1600 / 768 / 390 px layouts fit the viewport and preserve useful image space', async () => {
    for (const width of [1600, 768, 390]) {
      frame.style.width = `${width}px`; await pause(120);
      assert(doc.documentElement.scrollWidth <= width + 2, `Horizontal overflow at ${width}px: ${doc.documentElement.scrollWidth}`);
      const rect = get('viewer').getBoundingClientRect(); assert(rect.width >= Math.min(330, width - 32) && rect.height >= 300, `Canvas too small at ${width}`);
      const recipe = doc.querySelector('.recipe-area').getBoundingClientRect(); assert(recipe.right <= width + 2, `Recipe clipped at ${width}`);
    }
    frame.style.width = '1600px';
  });
  await test('Cancelled stage jobs cannot replace the last completed plan', async () => {
    const oldPreview = get('stage-strip').querySelector('canvas').toDataURL();
    change('detail', 5, 'input'); get('generate').click();
    await wait(() => !get('cancel-job').hidden, 'The cancel control did not appear'); get('cancel-job').click();
    await pause(350); assert(!get('generate').disabled); assert(get('status').textContent.includes('cancelled'));
    assert(get('stage-strip').querySelector('canvas').toDataURL() === oldPreview, 'A cancelled plan replaced the completed one');
  });
  await test('Custom tubes, plain-text identity and palette import/export drive enabled-only poor matches', async () => {
    get('paints-panel').open = true; get('add-paint').click(); await pause(40);
    const last = get('paint-list').lastElementChild, nameInput = last.querySelector('input[type=text]');
    nameInput.value = '<img src=x onerror=alert(1)> custom tube'; nameInput.dispatchEvent(new win.Event('change'));
    assert(last.querySelector('.paint-top span').textContent.startsWith('<img')); assert(!last.querySelector('img'));
    const before = downloads.length; get('export-palette').click(); await wait(() => downloads.length > before, 'No palette export');
    const palette = JSON.parse(await downloads.at(-1).blob.text()), custom = palette.paints.at(-1); assert(custom.brand === null && custom.pigments === null);
    palette.paints.forEach(p => { p.enabled = p.id === custom.id; }); custom.hex = '#222222';
    await setFile('palette-file', new File([JSON.stringify(palette)], 'one-paint.json', { type: 'application/json' }));
    await wait(() => get('paint-count').textContent === '1 available', 'Palette import did not apply enabled flags');
    get('pick-center').click(); await readyMix(); assert(get('mix-parts').querySelectorAll('input').length === 1); assert(get('match-state').textContent.includes('Closest available mix'));
    await setFile('project-file', new File([JSON.stringify(record)], 'restore.json', { type: 'application/json' }));
    await wait(() => get('status').textContent.includes('Project restored'), 'Could not restore the test workspace');
  });
  await test('Native dialogs retain accessible names; no unhandled app/worker errors', async () => {
    get('help-open').click(); assert(get('help-dialog').open); assert(get('help-dialog').getAttribute('aria-labelledby') === 'help-title'); get('help-dialog').close();
    assert(errors.length === 0, errors.join('; '));
  });
} catch (error) { failed++; results.append(Object.assign(document.createElement('li'), { textContent: `FATAL — ${error.message}` })); }
finally {
  try { await pause(450); await removeOwnTestState(); } catch (error) { failed++; results.append(Object.assign(document.createElement('li'), { textContent: `FAIL — Test-state cleanup: ${error.message}` })); }
  document.getElementById('test-status').textContent = `${passed} passed · ${failed} failed · complete`;
  document.body.dataset.testResult = failed ? 'failed' : 'passed';
}
for (const [id, width] of [['mobile', 390], ['tablet', 768], ['desktop', 1600]]) document.getElementById(id).addEventListener('click', () => { frame.style.width = `${width}px`; });
