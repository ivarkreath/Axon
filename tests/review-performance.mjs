// Run with: node --expose-gc tests/review-performance.mjs --output artifacts/review-performance
// Compare a preserved bundle with --bundle path/to/bench.cjs --label baseline.
// Several images: --scenarios 1000-image --image-count 3 --samples 3.
// These are Node microbenchmarks; browser frame timing is measured separately.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const output = path.resolve(option("--output", "artifacts/review-performance"));
const label = option("--label", "current");
const samples = Number(option("--samples", "7"));
const imageCount = Number(option("--image-count", "1"));
const selectedScenarios = new Set(
  option("--scenarios", "1000-mixed,5000-mixed,9000-mixed,1000-image").split(
    ",",
  ),
);
assert(Number.isInteger(samples) && samples >= 3);
assert(Number.isInteger(imageCount) && imageCount >= 1 && imageCount <= 3);
await mkdir(output, { recursive: true });
const preserved = option("--bundle", null);
const bundle = path.resolve(preserved ?? path.join(output, "bench.cjs"));
if (!preserved) {
  await build({
    stdin: {
      contents: `
        export * as documentModel from './src/model/document';
        export * as operations from './src/model/operations';
        export * as snapping from './src/model/snapping';
        export * as geometry from './src/model/geometry';
        export * as primitives from './src/rendering/primitives';
        export * as text from './src/rendering/text';
        export { Editor } from './src/editor/store';
        export { defaults } from './src/shared/contracts';
        export { FileWorkspace } from './electron/workspace';
        export { RecoveryWriter } from './electron/recovery';
        export { History } from './src/model/history';
      `,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundle,
  });
}
const api = createRequire(import.meta.url)(bundle);
const { documentModel: model } = api;
const font = async (name) =>
  new Uint8Array(await readFile(`public/fonts/${name}.ttf`)).buffer;
api.text.registerFonts(
  await font("NotoSans-Regular"),
  await font("NotoSansMono-Regular"),
);

// Distinct, deterministic and genuinely decodable PNGs with matching dimensions.
const assets = [];
const imageMetadata = [];
for (let imageIndex = 0; imageIndex < imageCount; imageIndex++) {
  const canvas = createCanvas(1024, 1024);
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(1024, 1024);
  let seed = 123456789 + imageIndex * 3456789;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels.data[i] = seed & 255;
    pixels.data[i + 1] = (seed >>> 8) & 255;
    pixels.data[i + 2] = (seed >>> 16) & 255;
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const png = canvas.toBuffer("image/png");
  const decoded = await loadImage(png);
  assert.equal(decoded.width, 1024);
  assert.equal(decoded.height, 1024);
  const asset = {
    id: imageIndex ? `review-image-${imageIndex}` : "review-image",
    mime: "image/png",
    data: png.toString("base64"),
    width: 1024,
    height: 1024,
  };
  assets.push(asset);
  imageMetadata.push({
    width: decoded.width,
    height: decoded.height,
    encodedBytes: png.length,
    base64Characters: asset.data.length,
    sha256: createHash("sha256").update(png).digest("hex"),
  });
}

function fixture(size, withImage = false) {
  const doc = {
    ...model.emptyDocument(),
    id: `review-${size}-${withImage ? "image" : "mixed"}`,
    title: `Review ${size}`,
  };
  const nodes = Math.floor(size * 0.75);
  for (let i = 0; i < nodes; i++) {
    const type = withImage && i >= nodes - assets.length ? "image" : "shape";
    const object = model.createObject(
      type,
      { x: (i % 60) * 240, y: Math.floor(i / 60) * 160 },
      doc.background,
    );
    object.id = `review-node-${i}`;
    if (type === "image") {
      const asset = assets[i - (nodes - assets.length)];
      object.assetId = asset.id;
      doc.assets[asset.id] = asset;
    } else {
      object.text = `Узел ${i} / Node`;
      if (i < 100) object.groupId = "review-group";
    }
    doc.objects.push(object);
  }
  for (let i = nodes; i < size; i++) {
    const connector = model.createObject(
      "connector",
      { x: 0, y: 0 },
      doc.background,
    );
    const from = ((i - nodes) * 2) % (nodes - 2);
    Object.assign(connector, {
      id: `review-link-${i - nodes}`,
      start: { type: "bound", nodeId: `review-node-${from}`, side: "right" },
      end: { type: "bound", nodeId: `review-node-${from + 1}`, side: "left" },
    });
    doc.objects.push(connector);
  }
  return model.parseDocument(doc);
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (q) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)];
  return {
    samples: values.length,
    medianMs: quantile(0.5),
    p95Ms: quantile(0.95),
    maxMs: sorted.at(-1),
    valuesMs: values,
  };
}
function measure(action, count = samples) {
  action();
  action();
  const values = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    action();
    values.push(performance.now() - start);
  }
  return summarize(values);
}
async function measureAsync(action, count = samples) {
  await action();
  const values = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    await action();
    values.push(performance.now() - start);
  }
  return summarize(values);
}
function session(document, savedContent) {
  return {
    sessionId: document.id,
    document,
    path: null,
    dirty: false,
    savedContent,
    preferences: api.defaults,
    recents: [],
    recovered: false,
  };
}
const report = {
  label,
  methodology:
    "Node microbenchmarks; 2 synchronous / 1 async warmups; elapsed wall clock; no timing thresholds. dirtyChanged edits the title; commit repeatedly compares one fixed before/after pair. movePreviewDirtyCommit varies the document each time. snap includes preparation; snapGesture reuses targets when supported. Save/open/recovery include filesystem I/O. UI/render/IPC costs are excluded.",
  bundleSha256: createHash("sha256")
    .update(await readFile(bundle))
    .digest("hex"),
  environment: {
    node: process.version,
    platform: process.platform,
    osRelease: os.release(),
    architecture: os.arch(),
    cpu: os.cpus()[0].model,
    logicalCPUs: os.cpus().length,
    totalRAMBytes: os.totalmem(),
    freeRAMBytes: os.freemem(),
  },
  image: imageMetadata[0],
  images: imageMetadata,
  scenarios: [],
};
for (const [size, withImage] of [
  [1000, false],
  [5000, false],
  [9000, false],
  [1000, true],
]) {
  const name = `${size}-${withImage ? "image" : "mixed"}`;
  if (!selectedScenarios.has(name)) continue;
  const doc = fixture(size, withImage);
  const serialized = model.serializeDocument(doc);
  const fixtureFile = path.join(output, `${name}.axon`);
  await writeFile(fixtureFile, serialized);
  const editor = new api.Editor();
  editor.load(session(doc, serialized));
  const moved = api.operations.moveObjects(doc, ["review-node-120"], {
    x: 1,
    y: 1,
  });
  const connectors = doc.objects.filter(
    (object) => object.type === "connector",
  );
  let revision = 0;
  const measurements = {};
  globalThis.gc?.();
  const memoryBefore = process.memoryUsage();
  measurements.dirtyUnchanged = measure(() => editor.isDirty());
  measurements.dirtyChanged = measure(() => {
    editor.preview({ ...doc, title: `Revision ${revision++}` });
    assert.equal(editor.isDirty(), true);
  });
  measurements.commit = measure(() => editor.commit(doc, moved));
  const gestureEditor = new api.Editor();
  gestureEditor.load(session(doc, serialized));
  measurements.movePreviewDirtyCommit = measure(() => {
    const before = gestureEditor.state.doc;
    const after = api.operations.moveObjects(before, ["review-node-120"], {
      x: 1,
      y: 1,
    });
    gestureEditor.preview(after);
    assert.equal(gestureEditor.isDirty(), true);
    gestureEditor.commit(before, after);
  });
  measurements.undoRedo = measure(() => {
    editor.undo();
    editor.redo();
  });
  measurements.move = measure(() =>
    api.operations.moveObjects(doc, ["review-node-120"], { x: 1, y: 1 }),
  );
  measurements.snap = measure(() =>
    api.snapping.snap(
      { x: 200, y: 150, w: 180, h: 100 },
      doc,
      ["review-node-120"],
      1,
      true,
      false,
    ),
  );
  const snapTargets = api.snapping.prepareSnap?.(doc, ["review-node-120"]);
  if (api.snapping.prepareSnap)
    measurements.prepareSnap = measure(() =>
      api.snapping.prepareSnap(doc, ["review-node-120"]),
    );
  measurements.snapGesture = measure(() =>
    api.snapping.snap(
      { x: 200, y: 150, w: 180, h: 100 },
      doc,
      ["review-node-120"],
      1,
      true,
      false,
      snapTargets,
    ),
  );
  measurements.expandSelection = measure(() =>
    api.operations.expandSelection(doc, ["review-node-0"]),
  );
  measurements.routeAll = measure(() => {
    for (const connector of connectors) api.geometry.route(connector, doc);
  });
  measurements.hitTestBoundsScan = measure(() => {
    const viewport = { x: 0, y: 0, w: 1920, h: 1080 };
    return doc.objects.filter((object) =>
      api.geometry.intersects(api.geometry.objectBounds(object, doc), viewport),
    ).length;
  });
  measurements.contentBounds = measure(() => api.primitives.contentBounds(doc));
  measurements.serialize = measure(() => model.serializeDocument(doc));
  measurements.parse = measure(() => model.parseDocument(serialized));
  const workspace = new api.FileWorkspace();
  const tab = workspace.add(doc, null, serialized);
  const saveFile = path.join(output, `${name}-saved.axon`);
  measurements.save = await measureAsync(() =>
    workspace.save(tab, saveFile, doc),
  );
  measurements.open = await measureAsync(() =>
    new api.FileWorkspace().open(saveFile),
  );
  workspace.add({ ...doc, id: `${doc.id}-tab-2`, title: "Second tab" });
  workspace.add({ ...doc, id: `${doc.id}-tab-3`, title: "Third tab" });
  const recovery = new api.RecoveryWriter(
    path.join(output, `${name}-recovery.json`),
    () => {},
  );
  measurements.recoveryThreeTabs = await measureAsync(() =>
    recovery.persist(() => workspace.snapshot()),
  );
  globalThis.gc?.();
  const scenario = {
    name,
    objectCount: doc.objects.length,
    connectorCount: connectors.length,
    assetCount: Object.keys(doc.assets).length,
    jsonBytes: Buffer.byteLength(serialized),
    memoryBefore,
    memoryAfter: process.memoryUsage(),
    measurements,
  };
  report.scenarios.push(scenario);
  await writeFile(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      name,
      milliseconds: Object.fromEntries(
        Object.entries(measurements).map(([key, value]) => [
          key,
          Number(value.medianMs.toFixed(3)),
        ]),
      ),
    }),
  );
}
assert(report.scenarios.length > 0, "Select at least one known scenario");
console.log(`Report: ${path.join(output, "report.json")}`);
