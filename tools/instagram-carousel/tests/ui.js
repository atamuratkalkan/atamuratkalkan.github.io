const frame = document.getElementById("app"), list = document.getElementById("test-results"), status = document.getElementById("test-status");
let passed = 0, failed = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, message) {
  for (let i = 0; i < 400; i++) { if (fn()) return; await delay(25); }
  throw new Error(message);
}
function assert(value, message) { if (!value) throw new Error(message); }
async function test(name, action) {
  const li = document.createElement("li"); list.append(li);
  try { await action(); li.textContent = `PASS — ${name}`; passed++; }
  catch (e) { li.textContent = `FAIL — ${name}: ${e.message}`; li.className = "error"; failed++; }
}
await waitFor(() => frame.contentDocument?.querySelector("#dimensions")?.textContent.includes("1080"), "App did not load");
const win = frame.contentWindow, doc = frame.contentDocument, $ = id => doc.getElementById(id);
const change = (element, value) => {
  if (element.type === "checkbox") element.checked = value; else element.value = value;
  element.dispatchEvent(new win.Event("input", { bubbles: true }));
};
const done = () => waitFor(() => $("slide-list").children.length > 0 && $("workspace").getAttribute("aria-busy") === "false", "Generation did not finish");
const encode = (canvas, type) => new Promise(resolve => canvas.toBlob(resolve, type, .95));
async function upload(width, height, type = "image/png", drop = false) {
  const canvas = doc.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  const colours = ["#183f60", "#6c8072", "#bf6d48", "#e8ba58", "#3e5c6d", "#e0d3ae"];
  ctx.fillStyle = "#ede2ca"; ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 25; i++) {
    ctx.fillStyle = colours[i % colours.length];
    ctx.fillRect((i * 137) % width, (i * 197) % height, width * .42, height * .25);
  }
  const blob = await encode(canvas, type);
  const extension = type.split("/")[1];
  const file = new win.File([blob], `synthetic-${width}x${height}.${extension}`, { type });
  const transfer = new win.DataTransfer(); transfer.items.add(file);
  if (drop) $("dropzone").dispatchEvent(new win.DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  else { $("image-file").files = transfer.files; $("image-file").dispatchEvent(new win.Event("change", { bubbles: true })); }
  canvas.width = canvas.height = 1;
  await waitFor(() => $("source-name").textContent === file.name, "Image input did not load");
  await done();
}

await test("Image input: PNG square, automatic cover + 3 detail slides", async () => {
  await upload(960, 960);
  assert($("slide-list").children.length === 4, "Expected 4 slides");
  assert(doc.querySelector('[data-editor="cover"] [data-control="mode"]').value === "fit", "Cover should fit the full image");
  assert(doc.querySelector(".slide-file p").textContent === "01-cover.jpg", "Cover filename incorrect");
  assert($("columns").value === "3" && $("rows").value === "1", "Grid defaults changed");
  assert(!$("grid-panel").hidden && $("results").hidden, "Initial grid preview should be visible");
  $("carousel-mode").click(); assert(!$("results").hidden, "Carousel preview did not open");
});
await test("Zoom, keyboard position, dirty-state clearing and regeneration", async () => {
  const zoom = doc.querySelector('[data-editor="detail"] [data-control="zoom"]');
  change(zoom, 2);
  assert($("results").hidden && $("carousel").children.length === 0, "Old downloads were not cleared");
  assert(!$("carousel-pending").hidden, "Regeneration guidance missing");
  $("grid-mode").click();
  assert(doc.querySelector('[data-editor="detail"] [data-value="zoom"]').textContent === "200%", "Zoom did not update");
  $("detail-stage").dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  assert(Number(doc.querySelector('[data-editor="detail"] [data-control="x"]').value) > 0, "Keyboard pan did not update");
  $("generate").click(); await done();
});
await test("No cover, PNG, 2 / 3 / 5 slides and exact output dimensions", async () => {
  change($("include-cover"), false); change($("file-format"), "image/png");
  assert($("cover-panel").hidden && $("quality").disabled, "Cover or JPEG quality state incorrect");
  for (const count of [2, 3, 5]) {
    change($("columns"), count); $("generate").click(); await done();
    assert($("slide-list").children.length === count, "Detail count wrong");
    assert(doc.querySelector(".slide-file p").textContent === "01-slide.png", "No-cover numbering wrong");
    for (const img of $("carousel").querySelectorAll("img")) { await img.decode(); assert(img.naturalWidth === 1080 && img.naturalHeight === 1440, "Wrong encoded dimensions"); }
  }
});
await test("Carousel arrows and keyboard change active slide", async () => {
  $("next").click(); await waitFor(() => $("slide-counter").textContent.startsWith("2 /"), "Next did not navigate");
  $("carousel").dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
  await waitFor(() => $("slide-counter").textContent.startsWith("3 /"), "Arrow key did not navigate");
});
await test("Download buttons and ZIP use correctly numbered generated files", async () => {
  let download = null;
  const capture = event => {
    const link = event.target.closest("a[download]");
    if (link) { event.preventDefault(); download = { name: link.download, href: link.href }; }
  };
  doc.addEventListener("click", capture, true);
  try {
    doc.querySelector(".slide-file button").click();
    assert(download?.name === "01-slide.png" && download.href.startsWith("blob:"), "Individual download wrong");
    download = null; $("download-zip").click();
    await waitFor(() => download?.name === "artwork-carousel.zip", "ZIP download did not start");
    const blob = await (await fetch(download.href)).blob();
    assert(blob.type === "application/zip" && blob.size > 100, "ZIP empty");
    await waitFor(() => $("workspace").getAttribute("aria-busy") === "false", "ZIP UI stayed busy");
  } finally { doc.removeEventListener("click", capture, true); }
});
await test("JPEG landscape via drag-and-drop and 4:5 format", async () => {
  change($("preset"), "4:5"); change($("columns"), 3); change($("file-format"), "image/jpeg");
  await upload(1400, 700, "image/jpeg", true);
  assert($("dimensions").textContent.includes("1080 × 1350"), "4:5 dimensions wrong");
});
await test("WebP portrait via file input and square format", async () => {
  change($("preset"), "1:1"); await upload(700, 1300, "image/webp");
  assert($("dimensions").textContent.includes("1080 × 1080"), "Square dimensions wrong");
});
await test("Custom outside-range warning allows export; memory and invalid-input errors are useful", async () => {
  change($("preset"), "custom"); change($("custom-width"), 9); change($("custom-height"), 16);
  assert(!$("ratio-warning").hidden && !$("generate").disabled, "Unsupported ratio should warn, not block");
  $("generate").click(); await done();
  change($("resolution"), "2160"); change($("columns"), 10);
  assert($("generate").disabled && !$("size-error").hidden, "Unsafe canvas not blocked");
  change($("custom-width"), 0);
  assert($("generate").disabled && $("size-error").textContent.includes("positive"), "Invalid dimensions not explained");
  change($("resolution"), "1080"); change($("columns"), 3); change($("preset"), "3:4"); change($("include-cover"), true);
  $("generate").click(); await done();
});
await test("Unsupported file errors do not destroy the previous artwork", async () => {
  const transfer = new win.DataTransfer(); transfer.items.add(new win.File(["not an image"], "test.gif", { type: "image/gif" }));
  $("image-file").files = transfer.files; $("image-file").dispatchEvent(new win.Event("change", { bubbles: true }));
  assert(!$("error").hidden && $("error").textContent.includes("JPEG"), "Unsupported file error missing");
  assert(!$("results").hidden, "Previous results unexpectedly lost");
});
await test("3×1, 3×2, 3×3, 2×2: live totals, numbered grid, preview switching and exported order", async () => {
  change($("file-format"), "image/png");
  for (const [columns, rows] of [[3, 1], [3, 2], [3, 3], [2, 2]]) {
    change($("columns"), columns); change($("rows"), rows); change($("include-cover"), true);
    $("grid-mode").click();
    await waitFor(() => $("cut-lines").children.length === columns * rows, "Grid overlay not updated");
    assert($("tile-total").textContent.includes(`${columns} × ${rows} = ${columns * rows} grid tiles`), "Live total wrong");
    assert($("cut-lines").firstElementChild.dataset.label === "02", "Cover should not be in the grid");
    assert($("cut-lines").lastElementChild.dataset.label === String(columns * rows + 1).padStart(2, "0"), "Grid labels wrong");
    assert($("cut-lines").style.gridTemplateRows.includes(String(rows)), "Vertical grid lines not configured");
    $("generate").click(); await done();
    assert(!$("results").hidden && $("grid-panel").hidden, "Generate should open Carousel Preview");
    assert($("slide-list").children.length === columns * rows + 1, "Wrong exported total");
    const images = $("carousel").querySelectorAll("img");
    assert(images[0].alt.includes("independent"), "Cover identity missing");
    for (let i = 0; i < columns * rows; i++) assert(images[i + 1].alt.includes(`row ${Math.floor(i / columns) + 1}, column ${i % columns + 1}`), "Visual carousel order is not row-major");
    const url = images[0].src;
    $("grid-mode").click(); $("carousel-mode").click();
    assert($("carousel").querySelector("img").src === url, "Preview switch should preserve generated files");
  }
});
await test("Row break appears before and after a new row, without snake navigation", async () => {
  change($("columns"), 3); change($("rows"), 2); change($("include-cover"), false);
  $("generate").click(); await done();
  $("carousel-dots").children[2].click();
  await waitFor(() => $("slide-context").textContent.includes("Column 3 of 3"), "End of first row not reached");
  assert(!$("row-transition").hidden && $("row-transition").textContent.includes("next slide jumps"), "End-of-row explanation missing");
  $("next").click();
  await waitFor(() => $("slide-context").textContent.includes("Row 2 of 2 · Column 1 of 3"), "Second row should start at the left, not at the right");
  assert(!$("row-transition").hidden && $("row-transition").textContent.includes("intentional jump"), "Row-start explanation missing");
  $("next").click();
  await waitFor(() => $("slide-context").textContent.includes("Column 2 of 3"), "Second row not navigable");
  assert($("row-transition").hidden, "A normal within-row transition should not be marked a row break");
  $("grid-mode").click(); await delay(100); $("carousel-mode").click(); await delay(100);
  assert($("slide-counter").textContent.startsWith("5 /"), "Switching preview modes lost the active slide");
});
await test("Instagram limit includes the cover, warns above 20, and still permits safe exports", async () => {
  change($("resolution"), "custom"); change($("output-width"), 540);
  change($("columns"), 4); change($("rows"), 5); change($("include-cover"), true);
  assert($("tile-total").textContent.includes("21 exported slides"), "Cover not included in total");
  assert(!$("carousel-limit-warning").hidden && !$("generate").disabled, "Count warning should not block a safe canvas");
  $("generate").click(); await done();
  assert($("slide-list").children.length === 21, "Warning unexpectedly prevented export");
  change($("include-cover"), false);
  assert($("carousel-limit-warning").hidden && $("tile-total").textContent.includes("20 exported slides"), "Limit warning should clear at 20");
  change($("resolution"), "1080"); change($("columns"), 3); change($("rows"), 3); change($("include-cover"), true);
  $("generate").click(); await done();
});
await test("Fit/crop, independent cover controls and reset remain available with multiple rows", async () => {
  $("grid-mode").click();
  const gridMode = doc.querySelector('[data-editor="detail"] [data-control="mode"]');
  const coverZoom = doc.querySelector('[data-editor="cover"] [data-control="zoom"]');
  change(coverZoom, 1.5); change(gridMode, "fit");
  change(doc.querySelector('[data-editor="detail"] [data-control="zoom"]'), 1.75);
  assert(Number(coverZoom.value) === 1.5, "Grid adjustment changed cover zoom");
  doc.querySelector('[data-editor="detail"] [data-action="reset"]').click();
  assert(gridMode.value === "fill" && Number(doc.querySelector('[data-editor="detail"] [data-control="zoom"]').value) === 1, "Grid reset failed");
  assert(Number(coverZoom.value) === 1.5, "Grid reset changed the cover");
  doc.querySelector('[data-editor="cover"] [data-action="reset"]').click();
  assert(Number(coverZoom.value) === 1, "Cover reset failed");
  $("generate").click(); await done();
});
await test("Desktop, tablet and mobile retain usable controls without page overflow", async () => {
  for (const width of [1440, 768, 390]) {
    frame.style.width = `${width}px`; await delay(120);
    assert(win.innerWidth === width, "Test viewport wrong");
    assert(doc.documentElement.scrollWidth <= width + 1, `Page overflows at ${width}px`);
    assert(win.getComputedStyle($("detail-stage")).touchAction === "none", "Touch framing not enabled");
    assert(win.getComputedStyle($("carousel")).scrollSnapType.includes("mandatory"), "Swipe snapping missing");
    $("grid-mode").click(); await delay(60);
    assert(doc.documentElement.scrollWidth <= width + 1, `Grid preview overflows at ${width}px`);
    const box = $("detail-stage").getBoundingClientRect();
    assert(box.width > 0 && Math.abs(box.width / box.height - .75) < .01, "Grid preview aspect ratio distorted");
    $("carousel-mode").click();
  }
});
for (const [id, width] of [["mobile", 390], ["tablet", 768], ["desktop", 1440]]) document.getElementById(id).addEventListener("click", () => { frame.style.width = `${width}px`; });
status.textContent = `${passed} passed, ${failed} failed.`; status.dataset.state = failed ? "failed" : "passed";
document.title = `${failed ? "FAIL" : "PASS"} — Carousel Studio interaction checks`;
