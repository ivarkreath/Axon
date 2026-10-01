// Build first, then run after review-performance.mjs has generated fixtures.
// Uses production dist in the development Electron runtime, without Vite/HMR.
// Use --two-tabs-only for two simultaneous 9000-object documents.
// --memory-only runs two open/gesture/switch/close cycles with diagnostic renderer GC.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { _electron as electron } from "playwright";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const fixtures = path.resolve(
  option("--fixtures", "artifacts/review-performance"),
);
const output = path.resolve(
  option("--output", "artifacts/review-performance-desktop"),
);
const label = option("--label", "current");
const appRoot = path.resolve(option("--app-root", "."));
const memoryOnly = args.includes("--memory-only");
const twoTabsOnly = args.includes("--two-tabs-only");
const scenarioNames = option(
  "--scenarios",
  twoTabsOnly || memoryOnly
    ? "9000-mixed"
    : "1000-mixed,5000-mixed,9000-mixed,1000-image",
).split(",");
await mkdir(output, { recursive: true });
const report = {
  label,
  runtime:
    "Production dist, development Electron runtime; no HMR/profiling build",
  applicationRoot: appRoot,
  methodology: memoryOnly
    ? "Retained-renderer-memory diagnostic (runtime variant identified by label/applicationRoot): HeapProfiler.collectGarbage after settling each stage; two cycles opening two 9000-object tabs, dragging, switching and closing through UI. No timing or heap-size threshold; main-process memory is not measured."
    : "One continuous sample per action; requestAnimationFrame intervals and DOM mutations. Frame timing includes Playwright input pacing, rendering and IPC. DOM mutation counts are not React render counts. 30 input steps; no performance pass/fail threshold.",
  environment: {
    platform: process.platform,
    osRelease: os.release(),
    cpu: os.cpus()[0].model,
    totalRAMBytes: os.totalmem(),
    freeRAMBytes: os.freemem(),
  },
  scenarios: [],
};
for (const name of scenarioNames) {
  assert(
    ["1000-mixed", "5000-mixed", "9000-mixed", "1000-image"].includes(name),
  );
  const documentFile = path.join(fixtures, `${name}.axon`);
  const documentValue = JSON.parse(await readFile(documentFile, "utf8"));
  const env = {
    ...process.env,
    AXON_TEST_DATA: path.join(output, `${name}-data-${Date.now()}`),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.AXON_DEV_URL;
  let app;
  const scenario = {
    name,
    objects: documentValue.objects.length,
    measurements: [],
    errors: [],
  };
  try {
    app = await electron.launch({
      args: [appRoot, documentFile],
      cwd: process.cwd(),
      env,
    });
    const page = await app.firstWindow();
    page.on("pageerror", (error) => scenario.errors.push(error.message));
    await page.getByRole("button", { name: "Файл", exact: true }).waitFor();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setContentSize(1920, 1080);
      window.webContents.setBackgroundThrottling(false);
      window.show();
      window.focus();
    });
    await page.waitForTimeout(1000);
    const session = await page.evaluate(() => window.axon.init());
    assert.equal(session.document.objects.length, documentValue.objects.length);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    async function metrics() {
      const result = await cdp.send("Performance.getMetrics");
      return Object.fromEntries(
        result.metrics.map(({ name, value }) => [name, value]),
      );
    }
    async function measure(actionName, action) {
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        window.show();
        window.focus();
      });
      await page.bringToFront();
      const visibilityBefore = await page.evaluate(() => ({
        visibility: document.visibilityState,
        focused: document.hasFocus(),
      }));
      const before = await metrics();
      await page.evaluate(() => {
        const state = {
          frames: [],
          mutations: 0,
          active: true,
          last: performance.now(),
        };
        const observer = new window.MutationObserver((records) => {
          state.mutations += records.length;
        });
        observer.observe(document.querySelector(".canvas"), {
          subtree: true,
          attributes: true,
          childList: true,
          characterData: true,
        });
        window.__reviewMeasurement = { state, observer };
        const tick = (now) => {
          state.frames.push(now - state.last);
          state.last = now;
          if (state.active) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await action();
      await page.waitForTimeout(100);
      const result = await page.evaluate(() => {
        const { state, observer } = window.__reviewMeasurement;
        state.active = false;
        observer.disconnect();
        return {
          frames: state.frames.slice(2),
          mutations: state.mutations,
          visibilityAfter: document.visibilityState,
          focusedAfter: document.hasFocus(),
        };
      });
      const after = await metrics();
      const sorted = result.frames.sort((a, b) => a - b);
      scenario.measurements.push({
        action: actionName,
        visibilityBefore,
        visibilityAfter: result.visibilityAfter,
        focusedAfter: result.focusedAfter,
        samples: sorted.length,
        medianFrameMs: sorted[Math.floor(sorted.length * 0.5)] ?? null,
        p95FrameMs:
          sorted[
            Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
          ] ?? null,
        maxFrameMs: sorted.at(-1) ?? null,
        framesOver50ms: sorted.filter((value) => value > 50).length,
        domMutations: result.mutations,
        jsHeapUsedBytes: after.JSHeapUsedSize,
        domNodes: after.Nodes,
        taskDurationMs: (after.TaskDuration - before.TaskDuration) * 1000,
        layoutDurationMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
        scriptDurationMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      });
      console.log(`Measured ${name}: ${actionName}`);
    }
    if (memoryOnly) {
      assert.equal(name, "9000-mixed");
      const secondFile = path.join(output, "9000-second.axon");
      await writeFile(secondFile, JSON.stringify(documentValue));
      // Discard only these synthetic test documents if a final gesture is still dirty.
      await app.evaluate(({ dialog }) => {
        dialog.showMessageBox = async () => ({ response: 1 });
      });
      scenario.memory = [];
      async function memorySample(stage, expectedLargeTabs) {
        await page.waitForTimeout(1200);
        const counts = await page.evaluate(async () => {
          const current = await window.axon.init();
          return {
            tabCount: current.tabs.length,
            largeTabCount: current.tabs.filter(
              (tab) => tab.document.objects.length === 9000,
            ).length,
            dirtyTabCount: current.tabs.filter((tab) => tab.dirty).length,
          };
        });
        assert.equal(counts.largeTabCount, expectedLargeTabs);
        assert.equal(await page.getByRole("tab").count(), counts.tabCount);
        await cdp.send("HeapProfiler.collectGarbage");
        const values = await metrics();
        assert(
          Number.isFinite(values.JSHeapUsedSize) && values.JSHeapUsedSize > 0,
        );
        const sample = {
          stage,
          ...counts,
          rendererHeapUsedBytes: values.JSHeapUsedSize,
          rendererHeapTotalBytes: values.JSHeapTotalSize,
          domNodes: values.Nodes,
        };
        scenario.memory.push(sample);
        console.log(JSON.stringify(sample));
      }
      async function closeFixture(file) {
        const filename = path.basename(file);
        await page
          .getByRole("button", {
            name: `Закрыть вкладку ${filename}`,
            exact: true,
          })
          .click();
        await page
          .getByRole("tab", { name: filename, exact: true })
          .waitFor({ state: "detached" });
      }
      async function openFixture(file) {
        await app.evaluate(({ dialog }, target) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [target],
          });
        }, file);
        await page.getByRole("button", { name: "Файл", exact: true }).click();
        await page.getByRole("menuitem", { name: "Открыть…" }).click();
        await page
          .getByRole("tab", { name: path.basename(file), exact: true })
          .waitFor();
      }
      await closeFixture(documentFile);
      await memorySample("initial-closed", 0);
      for (let cycle = 1; cycle <= 2; cycle++) {
        await openFixture(documentFile);
        await openFixture(secondFile);
        await memorySample(`cycle-${cycle}-opened`, 2);
        for (let turn = 0; turn < 4; turn++) {
          const file = turn % 2 ? secondFile : documentFile;
          await page
            .getByRole("tab", { name: path.basename(file), exact: true })
            .click();
          const { box } = await visibleNode();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(
            box.x + box.width / 2 + 30,
            box.y + box.height / 2 + 15,
            { steps: 12 },
          );
          await page.mouse.up();
          await page.keyboard.press("Control+z");
        }
        await memorySample(`cycle-${cycle}-after-gestures`, 2);
        await closeFixture(documentFile);
        await closeFixture(secondFile);
        await memorySample(`cycle-${cycle}-closed`, 0);
      }
      assert.deepEqual(scenario.errors, []);
      continue;
    }
    if (twoTabsOnly) {
      assert.equal(name, "9000-mixed");
      const secondFile = path.join(output, "9000-second.axon");
      await writeFile(secondFile, JSON.stringify(documentValue));
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [file],
        });
      }, secondFile);
      const beforeOpen = performance.now();
      await measure("open-second-9000-tab", async () => {
        await page.getByRole("button", { name: "Файл", exact: true }).click();
        await page.getByRole("menuitem", { name: "Открыть…" }).click();
        await page
          .getByRole("tab", { name: "9000-second.axon", exact: true })
          .waitFor();
      });
      scenario.secondTabOpenWallMs = performance.now() - beforeOpen;
      const twoTabs = await page.evaluate(() => window.axon.init());
      const largeTabs = twoTabs.tabs.filter(
        (tab) => tab.document.objects.length === 9000,
      );
      assert.equal(largeTabs.length, 2);
      scenario.largeTabs = largeTabs.map((tab) => ({
        sessionId: tab.sessionId,
        objects: tab.document.objects.length,
      }));
      await measure("switch-two-9000-tabs", async () => {
        for (let i = 0; i < 6; i++) {
          await page
            .getByRole("tab", {
              name: i % 2 ? "9000-second.axon" : "9000-mixed.axon",
              exact: true,
            })
            .click();
          await page.waitForTimeout(50);
        }
      });
      const bounds = await page.locator(".canvas").boundingBox();
      await page.mouse.move(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      await measure("pan-two-9000-tabs", async () => {
        for (let i = 0; i < 30; i++) {
          await page.mouse.wheel(i < 15 ? 8 : -8, 0);
          await page.waitForTimeout(16);
        }
      });
      assert.deepEqual(scenario.errors, []);
      continue;
    }
    const canvas = await page.locator(".canvas").boundingBox();
    await page.mouse.move(
      canvas.x + canvas.width / 2,
      canvas.y + canvas.height / 2,
    );
    await measure("pan", async () => {
      for (let i = 0; i < 30; i++) {
        await page.mouse.wheel(i < 15 ? 8 : -8, 0);
        await page.waitForTimeout(16);
      }
    });
    await measure("zoom", async () => {
      await page.keyboard.down("Control");
      for (let i = 0; i < 30; i++) {
        await page.mouse.wheel(0, i < 15 ? -4 : 4);
        await page.waitForTimeout(16);
      }
      await page.keyboard.up("Control");
    });
    async function visibleNode() {
      const id = await page.evaluate(() => {
        const bounds = document
          .querySelector(".canvas")
          .getBoundingClientRect();
        return [
          ...document.querySelectorAll('[data-object-id^="review-node-"]'),
        ]
          .find((element) => {
            const rect = element.getBoundingClientRect();
            const index = Number(
              element
                .getAttribute("data-object-id")
                .replace("review-node-", ""),
            );
            return (
              index >= 100 &&
              rect.width > 3 &&
              rect.x > bounds.x + 50 &&
              rect.right < bounds.right - 200 &&
              rect.y > bounds.y + 80 &&
              rect.bottom < bounds.bottom - 100
            );
          })
          ?.getAttribute("data-object-id");
      });
      assert(id, "A standalone fixture node must be visible");
      const locator = page.locator(`[data-object-id="${id}"]`).first();
      return { locator, box: await locator.boundingBox() };
    }
    for (const snapping of [true, false]) {
      const { box } = await visibleNode();
      await measure(snapping ? "drag-snap-on" : "drag-snap-off", async () => {
        if (!snapping) await page.keyboard.down("Alt");
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(
          box.x + box.width / 2 + 90,
          box.y + box.height / 2 + 45,
          { steps: 30 },
        );
        await page.mouse.up();
        if (!snapping) await page.keyboard.up("Alt");
      });
      await page.keyboard.press("Control+z");
    }
    await measure("selection", async () => {
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Control+a");
        await page.keyboard.press("Escape");
      }
    });
    const { box } = await visibleNode();
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    const text = page.getByRole("textbox", { name: "Текст объекта" });
    await text.waitFor();
    await measure("text-edit", async () => {
      await text.press("End");
      await text.pressSequentially(" review typing", { delay: 30 });
      await text.press("Escape");
    });
    await measure("undo-redo", async () => {
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Control+z");
        await page.keyboard.press("Control+Shift+z");
      }
    });
    assert.deepEqual(scenario.errors, []);
  } catch (error) {
    scenario.failure = String(error);
  } finally {
    report.scenarios.push(scenario);
    await writeFile(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(scenario));
    await app?.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
}
assert.equal(
  report.scenarios.filter((scenario) => scenario.failure).length,
  0,
  "All desktop scenarios must complete; see report.json for failures",
);
