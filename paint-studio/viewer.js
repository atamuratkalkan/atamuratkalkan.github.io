import { initialView, fitScale, imageToScreen, screenToImage, zoomAt, panBy, constrainView } from './viewport.js';
import { valueRGB } from './color.js';
import { stagePixels } from './segmentation.js';
import { canvas2D } from './image.js';

export class ImageViewer {
  constructor(canvas, onPick, onChange = () => {}) {
    this.canvas = canvas; this.context = canvas.getContext('2d', { colorSpace: 'srgb' });
    this.onPick = onPick; this.onChange = onChange; this.view = initialView(); this.pointers = new Map();
    this.box = { width: 1, height: 1 }; this.scene = null; this.selected = null; this.cacheKey = '';
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(canvas.parentElement);
    const local = event => { const r = canvas.getBoundingClientRect(); return { x: event.clientX - r.left, y: event.clientY - r.top }; };
    canvas.addEventListener('pointerdown', event => {
      if (!this.scene || event.button !== 0) return;
      canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId);
      const p = local(event); this.pointers.set(event.pointerId, { ...p, startX: p.x, startY: p.y });
      if (this.pointers.size === 1) this.moved = false;
      if (this.pointers.size > 1) this.moved = true;
      this.lastGesture = this.gesture();
    });
    canvas.addEventListener('pointermove', event => {
      if (!this.pointers.has(event.pointerId) || !this.scene) return;
      const p = this.pointers.get(event.pointerId), next = local(event), previous = this.lastGesture;
      Object.assign(p, next);
      if (Math.hypot(p.x - p.startX, p.y - p.startY) > 6) this.moved = true;
      const gesture = this.gesture();
      if (this.pointers.size > 1) {
        this.view = panBy(this.view, gesture.x - previous.x, gesture.y - previous.y, this.box, this.imageSize());
        this.view = zoomAt(this.view, this.view.zoom * gesture.distance / Math.max(1, previous.distance), gesture, this.box, this.imageSize());
      } else if (this.moved) this.view = panBy(this.view, gesture.x - previous.x, gesture.y - previous.y, this.box, this.imageSize());
      this.lastGesture = gesture; this.render(); this.onChange(this.view);
    });
    const finish = event => {
      if (!this.pointers.has(event.pointerId)) return;
      const p = local(event), pick = !this.moved && this.pointers.size === 1 && event.type === 'pointerup';
      this.pointers.delete(event.pointerId); this.lastGesture = this.gesture();
      if (pick) this.pick(p);
    };
    canvas.addEventListener('pointerup', finish); canvas.addEventListener('pointercancel', finish);
    canvas.addEventListener('lostpointercapture', event => this.pointers.delete(event.pointerId));
    canvas.addEventListener('wheel', event => {
      if (!this.scene) return;
      event.preventDefault(); this.zoom(this.view.zoom * Math.exp(-event.deltaY * .0015), local(event));
    }, { passive: false });
    canvas.addEventListener('keydown', event => {
      if (!this.scene) return;
      const center = { x: this.box.width / 2, y: this.box.height / 2 };
      if (event.key === '+' || event.key === '=') this.zoom(this.view.zoom * 1.25, center);
      else if (event.key === '-') this.zoom(this.view.zoom / 1.25, center);
      else if (event.key === '0') this.fit();
      else if (event.key === 'Enter' || event.key === ' ') this.pick(center);
      else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        const step = event.shiftKey ? 90 : 30;
        this.view = panBy(this.view, event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0,
          event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0, this.box, this.imageSize());
        this.render();
      } else return;
      event.preventDefault(); this.onChange(this.view);
    });
  }
  imageSize() { return this.scene.reference; }
  gesture() {
    const p = [...this.pointers.values()];
    return p.length > 1 ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, distance: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) } : p[0] ? { x: p[0].x, y: p[0].y, distance: 1 } : null;
  }
  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect(), dpr = Math.min(3, devicePixelRatio || 1);
    this.box = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    this.canvas.width = Math.round(this.box.width * dpr); this.canvas.height = Math.round(this.box.height * dpr);
    if (this.scene) this.view = constrainView(this.view, this.box, this.imageSize());
    this.render();
  }
  setScene(scene, reset = false) {
    if (this.grayReference && this.grayReference !== scene?.reference) { this.grayCanvas.width = this.grayCanvas.height = 1; this.grayCanvas = this.grayReference = null; }
    this.scene = scene; this.cacheKey = ''; this.stageCanvas = null;
    if (reset) this.view = initialView();
    this.render(); this.onChange(this.view);
  }
  setSelection(pick) { this.selected = pick; this.render(); }
  fit() { this.view = initialView(); this.render(); this.onChange(this.view); }
  zoom(amount, anchor = { x: this.box.width / 2, y: this.box.height / 2 }) {
    if (!this.scene) return;
    this.view = zoomAt(this.view, amount, anchor, this.box, this.imageSize()); this.render(); this.onChange(this.view);
  }
  pick(screen) {
    if (!this.scene) return;
    const p = screenToImage(screen, this.view, this.box, this.imageSize());
    if (p.x >= 0 && p.x < 1 && p.y >= 0 && p.y < 1) this.onPick(p);
  }
  render() {
    const c = this.context, canvas = this.canvas;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.scene) return;
    const { reference, plan, stageIndex, mode, values, focalPoints } = this.scene;
    let source = reference.canvas;
    if (mode !== 'original' && plan) {
      const key = `${stageIndex}/${mode}/${values}`;
      if (key !== this.cacheKey) {
        const { canvas, context } = canvas2D(plan.width, plan.height);
        context.putImageData(new ImageData(stagePixels(plan, stageIndex, { values, added: mode === 'added' }), plan.width, plan.height), 0, 0);
        this.stageCanvas = canvas; this.cacheKey = key;
      }
      source = this.stageCanvas;
    } else if (values) {
      if (this.grayReference !== reference) {
        const { canvas, context } = canvas2D(reference.width, reference.height), pixels = new Uint8ClampedArray(reference.pixels.data);
        for (let p = 0; p < pixels.length; p += 4) pixels.set(valueRGB([pixels[p], pixels[p + 1], pixels[p + 2]]), p);
        context.putImageData(new ImageData(pixels, reference.width, reference.height), 0, 0);
        this.grayCanvas = canvas; this.grayReference = reference;
      }
      source = this.grayCanvas;
    }
    const dpr = canvas.width / this.box.width, origin = imageToScreen({ x: 0, y: 0 }, this.view, this.box, reference);
    const scale = fitScale(this.box, reference) * this.view.zoom;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.imageSmoothingEnabled = mode === 'original';
    c.drawImage(source, origin.x, origin.y, reference.width * scale, reference.height * scale);
    if (this.selected && plan && mode !== 'original') {
      const stage = plan.stages[stageIndex], x = Math.min(plan.width - 1, Math.floor(this.selected.x * plan.width)), y = Math.min(plan.height - 1, Math.floor(this.selected.y * plan.height));
      const id = stage.labels[y * plan.width + x], sx = reference.width * scale / plan.width, sy = reference.height * scale / plan.height;
      c.fillStyle = 'rgba(255,255,255,.8)';
      for (let p = 0; p < stage.labels.length; p++) if (stage.labels[p] === id && (p % plan.width === 0 || p < plan.width || p % plan.width === plan.width - 1 || p + plan.width >= stage.labels.length || stage.labels[p - 1] !== id || stage.labels[p + 1] !== id || stage.labels[p - plan.width] !== id || stage.labels[p + plan.width] !== id)) c.fillRect(origin.x + p % plan.width * sx, origin.y + Math.floor(p / plan.width) * sy, Math.max(1, sx), Math.max(1, sy));
    }
    for (const point of focalPoints || []) {
      const p = imageToScreen(point, this.view, this.box, reference), r = point.radius * Math.min(reference.width, reference.height) * scale;
      c.strokeStyle = '#fff'; c.lineWidth = 2; c.setLineDash([4, 4]); c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    }
    if (this.selected) {
      const p = imageToScreen(this.selected, this.view, this.box, reference);
      c.strokeStyle = '#252525'; c.lineWidth = 4; c.beginPath(); c.arc(p.x, p.y, 7, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
    }
  }
  destroy() { this.observer.disconnect(); this.pointers.clear(); this.scene = null; this.stageCanvas = this.grayCanvas = this.grayReference = null; }
}
