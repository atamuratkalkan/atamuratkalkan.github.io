// All RGB values at this module boundary are sRGB bytes, not paint quantities.
export const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
export const srgbToLinear = v => (v /= 255) <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
export const linearToSrgb = v => Math.round(255 * clamp(v <= .0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - .055));
export const linearRGB = rgb => rgb.map(srgbToLinear);
export const fromLinear = rgb => rgb.map(linearToSrgb);
export function hexToRgb(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error('Use a six-digit hex colour, such as #425b75.');
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}
export const rgbToHex = rgb => '#' + rgb.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
export function oklab(rgb) {
  const [r, g, b] = linearRGB(rgb);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .808675766 * s];
}
export const labDistance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;
export const colorDistance = (a, b) => labDistance(oklab(a), oklab(b));
export function valueRGB(rgb) {
  const [r, g, b] = linearRGB(rgb);
  const v = linearToSrgb(.2126 * r + .7152 * g + .0722 * b);
  return [v, v, v];
}
export function samplePixels(data, width, height, x, y, radius = 0) {
  x = Math.floor(clamp(x, 0, width - 1));
  y = Math.floor(clamp(y, 0, height - 1));
  radius = Math.round(clamp(radius, 0, 12));
  const sum = [0, 0, 0];
  let count = 0;
  for (let py = Math.max(0, y - radius); py <= Math.min(height - 1, y + radius); py++) {
    for (let px = Math.max(0, x - radius); px <= Math.min(width - 1, x + radius); px++) {
      const i = (py * width + px) * 4;
      for (let c = 0; c < 3; c++) sum[c] += srgbToLinear(data[i + c]);
      count++;
    }
  }
  return fromLinear(sum.map(v => v / count));
}
