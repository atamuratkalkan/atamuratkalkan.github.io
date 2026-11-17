import test from "node:test";
import assert from "node:assert/strict";
import { dimensions, geometry, validateSequence, gridTiles, filename, INSTAGRAM_CAROUSEL_LIMIT } from "../core.js";
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
  assert.throws(() => validateSequence(1080, 1440, 0));
  assert.throws(() => validateSequence(1080, 1440, 3, 0));
  assert.throws(() => validateSequence(1080, 1440, 3, 1.5));
  assert.throws(() => validateSequence(64, 2000, 1, 10));
});

test("3×1, 3×2, 3×3 and 2×2 partitions cover both axes in reading order", () => {
  for (const [columns, rows] of [[3, 1], [3, 2], [3, 3], [2, 2], [1, 1], [1, 3]]) {
    // Odd tile sizes catch any rounding or boundary overlap introduced later.
    const width = 301, height = 403;
    const master = validateSequence(width, height, columns, rows);
    const cuts = gridTiles(width, height, columns, rows);
    assert.equal(cuts.length, columns * rows);
    assert.equal(cuts.reduce((area, tile) => area + tile.width * tile.height, 0), master.width * master.height);
    cuts.forEach((cut, index) => {
      assert.deepEqual([cut.row, cut.column], [Math.floor(index / columns), index % columns]);
      assert.equal(cut.x, cut.column * width);
      assert.equal(cut.y, cut.row * height);
      if (cut.column) assert.equal(cuts[index - 1].x + width, cut.x);
      if (cut.row) assert.equal(cuts[index - columns].y + height, cut.y);
    });
    assert.equal(cuts.at(-1).x + width, master.width);
    assert.equal(cuts.at(-1).y + height, master.height);
  }
});

test("row-major order never snakes and the slide-limit warning is separate from memory limits", () => {
  assert.deepEqual(gridTiles(108, 144, 3, 2).map(cut => [cut.row, cut.column]), [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]);
  assert.equal(INSTAGRAM_CAROUSEL_LIMIT, 20);
  assert.doesNotThrow(() => validateSequence(540, 720, 3, 7));
  assert.deepEqual(validateSequence(1080, 1440, 3, 3), { width: 3240, height: 4320 });
});

test("numbered files with and without a cover", () => {
  assert.equal(filename(0, "cover", "image/jpeg"), "01-cover.jpg");
  assert.equal(filename(1, "slide", "image/png"), "02-slide.png");
  assert.equal(filename(0, "slide", "image/jpeg"), "01-slide.jpg");
  assert.equal(filename(10, "slide", "image/jpeg"), "11-slide.jpg");
  const largeSet = Array.from({ length: 101 }, (_, i) => filename(i, i ? "slide" : "cover", "image/png", 3));
  assert.deepEqual([...largeSet].sort(), largeSet);
});

test("ZIP local records, CRC, filenames and central directory", async () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const files = Array.from({ length: 7 }, (_, i) => ({ filename: filename(i, i ? "slide" : "cover", "image/png"), blob: new Blob([`test file ${i}`]) }));
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
  assert.equal(view.getUint16(end + 10, true), 7);
  assert.equal(view.getUint32(end + 16, true), cursor);
});
