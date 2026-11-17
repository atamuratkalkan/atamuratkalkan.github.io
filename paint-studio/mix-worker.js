import { RecipeSearch } from './mixing.js';
import { validatePalette } from './palette.js';
const engine = new RecipeSearch();
let latest = 0;
self.onmessage = async ({ data }) => {
  if (data.type === 'cancel') { latest++; return; }
  const token = ++latest;
  const { id } = data;
  try {
    const paints = validatePalette(data.paints);
    const results = await engine.search(paints, data.target, {
      cancelled: () => token !== latest,
      progress: (value, message) => { if (token === latest) self.postMessage({ id, type: 'progress', value, message }); }
    });
    if (token === latest) self.postMessage({ id, type: 'result', results });
  } catch (error) {
    if (token === latest && error.name !== 'AbortError') self.postMessage({ id, type: 'error', message: error.message });
  }
};
