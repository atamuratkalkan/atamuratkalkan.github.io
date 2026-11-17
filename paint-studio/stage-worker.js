import { generatePlan } from './segmentation.js';
let latest = 0;
self.onmessage = async ({ data }) => {
  if (data.type === 'cancel') { latest++; return; }
  const token = ++latest, id = data.id;
  try {
    const plan = await generatePlan(data.input, {
      cancelled: () => token !== latest,
      progress: (value, message) => { if (token === latest) self.postMessage({ id, type: 'progress', value, message }); }
    });
    if (token === latest) self.postMessage({ id, type: 'result', plan }, plan.stages.map(s => s.labels.buffer));
  } catch (error) {
    if (token === latest && error.name !== 'AbortError') self.postMessage({ id, type: 'error', message: error.message });
  }
};
