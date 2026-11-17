import { clamp } from './color.js';

export const initialView = () => ({ zoom: 1, x: .5, y: .5 });
export const fitScale = (box, image) => Math.min(box.width / image.width, box.height / image.height);
export function imageToScreen(point, view, box, image) {
  const scale = fitScale(box, image) * view.zoom;
  return { x: box.width / 2 + (point.x - view.x) * image.width * scale,
    y: box.height / 2 + (point.y - view.y) * image.height * scale };
}
export function screenToImage(point, view, box, image) {
  const scale = fitScale(box, image) * view.zoom;
  return { x: view.x + (point.x - box.width / 2) / (image.width * scale),
    y: view.y + (point.y - box.height / 2) / (image.height * scale) };
}
export function zoomAt(view, zoom, anchor, box, image) {
  const before = screenToImage(anchor, view, box, image), next = { ...view, zoom: clamp(zoom, 1, 12) };
  const after = screenToImage(anchor, next, box, image);
  next.x += before.x - after.x; next.y += before.y - after.y;
  return constrainView(next, box, image);
}
export function constrainView(view, box, image) {
  const scale = fitScale(box, image) * view.zoom;
  const limitX = Math.min(.5, box.width / (2 * image.width * scale));
  const limitY = Math.min(.5, box.height / (2 * image.height * scale));
  return { zoom: clamp(view.zoom, 1, 12), x: clamp(view.x, limitX, 1 - limitX), y: clamp(view.y, limitY, 1 - limitY) };
}
export function panBy(view, dx, dy, box, image) {
  const scale = fitScale(box, image) * view.zoom;
  return constrainView({ ...view, x: view.x - dx / (scale * image.width), y: view.y - dy / (scale * image.height) }, box, image);
}
