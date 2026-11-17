import { canvas2D } from './image.js';
import { stagePixels } from './segmentation.js';
import { rgbToHex } from './color.js';
import { recipeInstructions } from './mixing.js';

const urls = new Set();
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob); urls.add(url);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 1200);
}
export const downloadJSON = (value, filename) => downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), filename);
export function renderStageCanvas(plan, index, values = false, edge = 1600) {
  const small = canvas2D(plan.width, plan.height);
  small.context.putImageData(new ImageData(stagePixels(plan, index, { values }), plan.width, plan.height), 0, 0);
  const scale = edge / Math.max(plan.width, plan.height), result = canvas2D(Math.round(plan.width * scale), Math.round(plan.height * scale));
  result.context.imageSmoothingEnabled = false; result.context.drawImage(small.canvas, 0, 0, result.canvas.width, result.canvas.height);
  small.canvas.width = small.canvas.height = 1;
  return result.canvas;
}
export async function exportStage(plan, index, values) {
  const canvas = renderStageCanvas(plan, index, values);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  canvas.width = canvas.height = 1;
  if (!blob) throw new Error('The browser could not export the stage.');
  downloadBlob(blob, `paint-studio-stage-${index + 1}${values ? '-values' : ''}.png`);
}
function element(tag, text, className) { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; }
export function buildPrintSheet(container, state, recipes) {
  container.replaceChildren();
  container.append(element('h1', state.projectName || 'Paint Studio study'), element('p', 'Estimated mixes — test a small amount first. Visual stages are not physical coats of paint.'));
  const stages = element('div', null, 'print-stages');
  state.plan.stages.forEach((stage, i) => {
    const figure = element('figure'), canvas = renderStageCanvas(state.plan, i, false, 480), image = element('img');
    image.src = canvas.toDataURL('image/png'); image.alt = stage.title;
    figure.append(element('h2', `${i + 1}. ${stage.title}`), image, element('figcaption', stage.explanation)); stages.append(figure);
    canvas.width = canvas.height = 1;
  });
  container.append(stages, element('h2', 'Colour notes & approximate parts'));
  for (const entry of recipes) {
    const section = element('section', null, 'print-recipe');
    section.append(element('h3', entry.name), element('p', `Source: ${entry.source}. Target ${rgbToHex(entry.target)} · predicted ${rgbToHex(entry.recipe.rgb)} · ΔE OK ${entry.recipe.error.toFixed(1)}.`));
    const swatches = element('div', null, 'print-swatches');
    for (const [name, color] of [['Target', entry.target], ['Estimated mix', entry.recipe.rgb]]) { const swatch = element('span', name); swatch.style.backgroundColor = rgbToHex(color); swatches.append(swatch); }
    section.append(swatches, element('p', recipeInstructions(entry.recipe, entry.paints).join(' '))); container.append(section);
  }
  container.append(element('p', 'Paint Studio · local sRGB reference · Spectral.js 3.0.0 (MIT). Generic/user-estimated tube colours are not measured pigment spectra. Approximate parts are model factors, not exact grams or millilitres.'));
}
export function releaseDownloads() { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); }
