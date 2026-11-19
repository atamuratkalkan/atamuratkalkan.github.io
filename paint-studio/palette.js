import { hexToRgb } from './color.js';

export const PALETTE_VERSION = 1;
export const MAX_PAINTS = 32;
const text = (s, max = 160) => typeof s === 'string' ? s.trim().slice(0, max) : '';
const sourceURL = s => {
  const value = text(s, 1000);
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
};
export function validatePalette(input) {
  const entries = Array.isArray(input) ? input : input?.paints;
  if (!Array.isArray(entries) || !entries.length || entries.length > MAX_PAINTS) throw new Error(`A palette must contain 1–${MAX_PAINTS} paints.`);
  const ids = new Set();
  const paints = entries.map((p, i) => {
    if (!p || typeof p !== 'object') throw new Error(`Paint ${i + 1} is not an object.`);
    const id = text(p.id, 60), name = text(p.name, 100);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id) || !name) throw new Error(`Paint ${i + 1} needs a name and a unique simple id.`);
    ids.add(id);
    hexToRgb(p.hex);
    const strength = p.tintingStrength == null ? 1 : Number(p.tintingStrength);
    if (!Number.isFinite(strength) || strength < .1 || strength > 5) throw new Error(`${name}: strength must be 0.1–5.`);
    const provenance = { kind: text(p.provenance?.kind, 80) || 'user-estimate', note: text(p.provenance?.note, 500) };
    for (const key of ['source', 'swatchSource', 'pigmentSource']) if (sourceURL(p.provenance?.[key])) provenance[key] = sourceURL(p.provenance[key]);
    for (const key of ['reference', 'referencePigments', 'method', 'checked']) if (text(p.provenance?.[key], 500)) provenance[key] = text(p.provenance[key], 500);
    // Reserved calibration records are preserved, never silently interpreted as measured spectra.
    let calibration = null;
    if (p.calibration != null) {
      if (typeof p.calibration !== 'object') throw new Error(`${name}: invalid calibration record.`);
      calibration = { source: text(p.calibration.source, 300), method: text(p.calibration.method, 300), note: text(p.calibration.note, 500) };
      if (p.calibration.reflectance != null) {
        const r = p.calibration.reflectance;
        if (!Array.isArray(r) || r.length !== 38 || !r.every(v => Number.isFinite(v) && v > 0 && v <= 1)) throw new Error(`${name}: reflectance needs 38 values in (0, 1].`);
        calibration.reflectance = [...r];
        calibration.wavelengths = '380–750 nm, 10 nm steps';
      }
    }
    return { id, name, brand: text(p.brand) || null, series: text(p.series) || null,
      pigments: text(p.pigments) || null, hex: p.hex.toLowerCase(), enabled: p.enabled !== false,
      transparency: ['unknown', 'transparent', 'semi-transparent', 'opaque'].includes(p.transparency) ? p.transparency : 'unknown',
      tintingStrength: strength, isWhite: p.isWhite === true, provenance, calibration };
  });
  return paints;
}

// Upgrade only the exact original, untouched starter. Saved custom inventories,
// enabled flags, tube identities and calibration records always take precedence.
const originalStarter = [
  ['titanium-white', 'Titanium White', '#f3f1e7'], ['ivory-black', 'Ivory Black', '#242424'],
  ['yellow-ochre', 'Yellow Ochre', '#b58b32'], ['yellow', 'Warm Yellow', '#f3ca21'],
  ['warm-red', 'Warm Red', '#c4422e'], ['cool-red', 'Cool Red', '#942644'],
  ['ultramarine', 'Ultramarine Blue', '#283d8d'], ['phthalo-blue', 'Phthalo Blue', '#105a70'],
  ['burnt-sienna', 'Burnt Sienna', '#8f492e'], ['burnt-umber', 'Burnt Umber', '#514035'],
  ['green', 'Cool Green', '#285b4c']
];
export function isOriginalStarter(input) {
  const paints = validatePalette(input);
  return paints.length === originalStarter.length && paints.every((p, i) => {
    const [id, name, hex] = originalStarter[i];
    return p.id === id && p.name === name && p.hex === hex && p.enabled === (id !== 'green') &&
      !p.brand && !p.series && !p.pigments && !p.calibration && p.transparency === 'unknown' &&
      p.tintingStrength === 1 && p.isWhite === (id === 'titanium-white') &&
      p.provenance.kind === 'generic-estimate' &&
      p.provenance.note === (id === 'titanium-white' ? 'Unmeasured generic sRGB colour; strength defaults to a neutral assumption.' : '') &&
      Object.keys(p.provenance).length === 2;
  });
}
export function selectInitialPalette(starter, saved) {
  const current = validatePalette(starter);
  if (!saved) return current;
  const inventory = validatePalette(saved);
  return isOriginalStarter(inventory) ? current : inventory;
}
export const paletteFile = paints => ({ schema: 'paint-studio-palette', version: PALETTE_VERSION,
  quantityBasis: 'Relative model factors; approximate parts, not calibrated mass or volume.', paints: validatePalette(paints) });
export const paletteSignature = paints => JSON.stringify(paints.filter(p => p.enabled).map(p => [p.id, p.hex, p.tintingStrength]));
