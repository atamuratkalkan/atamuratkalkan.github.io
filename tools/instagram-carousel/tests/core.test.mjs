import test from "node:test";
import assert from "node:assert/strict";
import { dimensions, geometry, validateSequence, filename } from "../core.js";
import { crc32, makeZip } from "../zip.js";

test("preset and custom output dimensions", () => {
  for (const [preset, height] of [["3:4", 1440], ["4:5", 1350], ["1:1", 1080], ["landscape", 566]]) {
    assert.deepEqual(dimensions({ preset }), { width: 1080, height, ratio: 1080 / height });
  }
  assert.equal(dimensions({ preset: "3:4", outputWidth: 2160 }).height, 2880);
  assert.equal(dimensions({ preset: "custom", customWidth: 9, customHeight: 16 }).height, 1920);
  assert.deepEqual(dimensions({ preset: "custom", customKind: "pixels", customWidth: 1200, customHeight: 700 }), { width: 1200, height: 700, ratio: 1200 / 700 });
  for (const bad of [0, -1, NaN, Infinity, ""]) assert.throws(() => dimensions({ preset: "custom", customWidth: bad, customHeight: 4 }));
  assert.throws(() => dimensions({ preset: "custom", customKind: "pixels", customWidth: 100.5, customHeight: 200 }));
});

test("geometry preserves proportions and reaches both edges", () => {
  for (const [sw, sh] of [[1000, 1000], [2400, 800], [800, 2400]]) {
    for (const mode of ["fit", "fill"]) {
      for (const zoom of [.5, 1, 2.5, 4]) {
        const f = { mode, zoom, x: 0, y: 0 };
        const g = geometry(sw, sh, 3240, 1440, f);
        assert.ok(Math.abs(g.width / g.height - sw / sh) < 1e-10);
        assert.equal(g.x, (3240 - g.width) / 2);
        assert.equal(g.y, (1440 - g.height) / 2);
        const a = geometry(sw, sh, 3240, 1440, { ...f, x: -1, y: -1 });
        const b = geometry(sw, sh, 3240, 1440, { ...f, x: 1, y: 1 });
        assert.ok(Math.abs(a.x + b.x - (3240 - g.width)) < 1e-8);
      }
    }
  }
});

test("safe canvas budget and exact partitions", () => {
  for (const count of [2, 3, 5, 10]) {
    const master = validateSequence(1080, 1440, count);
    assert.equal(master.width, 1080 * count);
    const ranges = Array.from({ length: count }, (_, i) => [i * 1080, (i + 1) * 1080]);
    for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i - 1][1], ranges[i][0]);
    assert.equal(ranges.at(-1)[1], master.width);
  }
  assert.throws(() => validateSequence(2160, 2880, 10));
  assert.throws(() => validateSequence(1080, 1440, 1));
});

test("numbered files with and without a cover", () => {
  assert.equal(filename(0, "cover", "image/jpeg"), "01-cover.jpg");
  assert.equal(filename(1, "detail", "image/png"), "02-detail.png");
  assert.equal(filename(0, "detail", "image/jpeg"), "01-detail.jpg");
  assert.equal(filename(10, "detail", "image/jpeg"), "11-detail.jpg");
});

test("ZIP local records, CRC, filenames and central directory", async () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const files = Array.from({ length: 4 }, (_, i) => ({ filename: filename(i, i ? "detail" : "cover", "image/png"), blob: new Blob([`test file ${i}`]) }));
  const archive = new Uint8Array(await (await makeZip(files)).arrayBuffer());
  const view = new DataView(archive.buffer);
  let cursor = 0;
  for (const file of files) {
    assert.equal(view.getUint32(cursor, true), 0x04034b50);
    const size = view.getUint32(cursor + 18, true), nameLength = view.getUint16(cursor + 26, true);
    assert.equal(new TextDecoder().decode(archive.slice(cursor + 30, cursor + 30 + nameLength)), file.filename);
    const data = archive.slice(cursor + 30 + nameLength, cursor + 30 + nameLength + size);
    assert.equal(crc32(data), view.getUint32(cursor + 14, true));
    assert.deepEqual(data, new Uint8Array(await file.blob.arrayBuffer()));
    cursor += 30 + nameLength + size;
  }
  assert.equal(view.getUint32(cursor, true), 0x02014b50);
  const end = archive.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 4);
  assert.equal(view.getUint32(end + 16, true), cursor);
});
