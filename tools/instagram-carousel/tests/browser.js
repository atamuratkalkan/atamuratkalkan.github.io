import { drawComposition, context2d, generateSequence, dimensions } from "../core.js";
import { makeZip, crc32 } from "../zip.js";

const list = document.getElementById("test-results"), status = document.getElementById("test-status");
let passed = 0, failed = 0;
function assert(ok, message) { if (!ok) throw new Error(message); }
async function test(name, fn) {
  const li = document.createElement("li"); list.append(li);
  try { await fn(); li.textContent = `PASS — ${name}`; passed++; }
  catch (e) { li.textContent = `FAIL — ${name}: ${e.message}`; li.className = "error"; failed++; }
}

function source(width, height) {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = context2d(canvas);
  ctx.fillStyle = "#172f50"; ctx.fillRect(0, 0, width, height);
  for (let y = 0; y < height; y += 23) for (let x = 0; x < width; x += 31) {
    ctx.fillStyle = `rgb(${(x * 7 + y) % 256}, ${(y * 11 + x) % 256}, ${(x + y * 3) % 256})`;
    ctx.fillRect(x, y, 25, 17);
  }
  return canvas;
}

async function decode(blob) {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const url = URL.createObjectURL(blob), img = new Image(); img.src = url; await img.decode(); URL.revokeObjectURL(url); return img;
}

const fit = { mode: "fit", zoom: 1, x: 0, y: 0 }, fill = { mode: "fill", zoom: 1.23, x: .27, y: -.41 };
async function checkSequence(sw, sh, width, height, count, includeCover, format = "image/png") {
  const art = source(sw, sh), master = document.createElement("canvas"), reconstructed = document.createElement("canvas");
  const options = { source: art, width, height, count, includeCover, cover: fit, detail: fill, background: "#e8decd", format, quality: .94 };
  const files = await generateSequence(options);
  assert(files.length === count + Number(includeCover), "Wrong number of files");
  assert(files[0].filename === (includeCover ? "01-cover" : "01-detail") + (format === "image/png" ? ".png" : ".jpg"), "Wrong first filename");
  reconstructed.width = width * count; reconstructed.height = height;
  const ctx = context2d(reconstructed);
  for (const [index, file] of files.entries()) {
    assert(file.blob.type === format, "Incorrect image MIME type");
    const image = await decode(file.blob);
    assert(image.width === width && image.height === height, "Slides do not share exact dimensions");
    if (file.kind === "detail") ctx.drawImage(image, (index - Number(includeCover)) * width, 0);
    image.close?.();
  }
  if (format === "image/png") {
    drawComposition(master, art, width * count, height, fill, options.background);
    const expected = context2d(master).getImageData(0, 0, master.width, master.height).data;
    const actual = ctx.getImageData(0, 0, master.width, master.height).data;
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== actual[i]) throw new Error(`Master mismatch at byte ${i} — a cut, gap or overlap is incorrect`);
    }
  }
  master.width = master.height = reconstructed.width = reconstructed.height = art.width = art.height = 1;
  return files;
}

await test("Square artwork → 3:4 at 1080 × 1440; cover + 3 details; every PNG pixel reconstructs the master", () => checkSequence(900, 900, 1080, 1440, 3, true));
await test("Landscape artwork → 4:5; two seamless slides", () => checkSequence(640, 300, 108, 135, 2, false));
await test("Portrait artwork → 1:1; five seamless slides", () => checkSequence(300, 700, 108, 108, 5, false));
await test("Custom 9:16 outside feed range still exports", () => checkSequence(300, 700, 90, 160, 3, false));
await test("JPEG encoding and dimensions; cover + three details", () => checkSequence(400, 400, 108, 144, 3, true, "image/jpeg"));
await test("PNG and JPEG ZIP filenames, bytes, dimensions and CRC", async () => {
  for (const format of ["image/png", "image/jpeg"]) {
    const files = await checkSequence(400, 300, 108, 144, 3, true, format);
    const zip = new Uint8Array(await (await makeZip(files)).arrayBuffer()), view = new DataView(zip.buffer);
    let cursor = 0;
    for (const file of files) {
      assert(view.getUint32(cursor, true) === 0x04034b50, "ZIP record missing");
      const len = view.getUint16(cursor + 26, true), size = view.getUint32(cursor + 18, true);
      assert(new TextDecoder().decode(zip.slice(cursor + 30, cursor + 30 + len)) === file.filename, "ZIP filename mismatch");
      const bytes = zip.slice(cursor + 30 + len, cursor + 30 + len + size);
      assert(crc32(bytes) === view.getUint32(cursor + 14, true), "ZIP CRC mismatch");
      const original = new Uint8Array(await file.blob.arrayBuffer());
      assert(original.every((value, i) => value === bytes[i]), "ZIP changed file contents");
      cursor += 30 + len + size;
    }
    assert(view.getUint32(cursor, true) === 0x02014b50, "ZIP directory missing");
  }
});
await test("Custom exact dimensions are not overridden by resolution", () => {
  const d = dimensions({ preset: "custom", customKind: "pixels", customWidth: 1200, customHeight: 700, outputWidth: 2160 });
  assert(d.width === 1200 && d.height === 700, "Custom dimensions changed");
});
await test("Abort cancels export without returning a partial sequence", async () => {
  const controller = new AbortController(); controller.abort(); let aborted = false;
  const art = source(100, 100);
  try { await generateSequence({ source: art, width: 100, height: 100, count: 2, includeCover: false, detail: fill, cover: fit, background: "#ffffff", format: "image/png", quality: 1, signal: controller.signal }); }
  catch (e) { aborted = e.name === "AbortError"; }
  assert(aborted, "Export ignored cancellation"); art.width = art.height = 1;
});

status.textContent = `${passed} passed, ${failed} failed.`;
status.dataset.state = failed ? "failed" : "passed";
document.title = `${failed ? "FAIL" : "PASS"} — Carousel Studio browser checks`;
