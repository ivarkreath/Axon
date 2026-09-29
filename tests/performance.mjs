import { _electron as electron } from "playwright";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const env = {
  ...process.env,
  AXON_TEST_DATA: path.resolve("artifacts/performance-data-" + Date.now()),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.AXON_DEV_URL;
const app = await electron.launch({
  args: [".", path.resolve("artifacts/stress.axon")],
  cwd: process.cwd(),
  env,
});
const page = await app.firstWindow();
const results = [];
async function measure(name, action) {
  await page.evaluate(() => {
    window.__frames = [];
    window.__measuring = true;
    let last = performance.now();
    function tick(now) {
      window.__frames.push(now - last);
      last = now;
      if (window.__measuring) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
  await action();
  const frames = await page.evaluate(() => {
    window.__measuring = false;
    return window.__frames.slice(2);
  });
  frames.sort((a, b) => a - b);
  results.push({
    name,
    samples: frames.length,
    medianFrameMs: frames[Math.floor(frames.length * 0.5)],
    p95FrameMs: frames[Math.floor(frames.length * 0.95)],
    maxFrameMs: frames.at(-1),
  });
}
try {
  await page.getByRole("button", { name: "Файл", exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(1920, 1080);
    win.webContents.setBackgroundThrottling(false);
  });
  await page.waitForTimeout(300);
  await measure("zoom-400", async () => {
    await page.mouse.move(720, 420);
    await page.keyboard.down("Control");
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, -6);
      await page.waitForTimeout(16);
    }
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, 6);
      await page.waitForTimeout(16);
    }
    await page.keyboard.up("Control");
  });
  await page
    .getByRole("button", { name: "Показать всё · Shift + 1", exact: true })
    .click();
  await page.waitForTimeout(300);
  const box = await page
    .locator('[data-object-id="stress-210"]')
    .first()
    .boundingBox();
  await measure("drag-400", async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 150,
      box.y + box.height / 2 + 60,
      { steps: 50 },
    );
    await page.mouse.up();
  });
  await measure("selection-400", async () => {
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Control+a");
      await page.keyboard.press("Escape");
    }
  });
  const report = {
    platform: os.platform(),
    osRelease: os.release(),
    cpu: os.cpus()[0].model,
    logicalCPUs: os.cpus().length,
    totalRAMGB: Math.round(os.totalmem() / 1024 ** 3),
    window: "1920×1080 CSS",
    objects: 400,
    backgroundThrottling: false,
    results,
  };
  await writeFile(
    "artifacts/performance-detail.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
