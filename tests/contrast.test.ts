import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
function luminance(hex: string) {
  const values = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
it("keeps real theme text, icons and focus indicators at required contrast", () => {
  const css = readFileSync("src/styles.css", "utf8");
  const blocks = [
    css.match(/:root\s*\{([^}]+)\}/)![1],
    css.match(/:root\[data-theme=?["']?light["']?\]\s*\{([^}]+)\}/)![1],
  ];
  for (const block of blocks) {
    const vars = Object.fromEntries(
      [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)].map((m) => [
        m[1],
        m[2].trim(),
      ]),
    );
    for (const text of ["--text-primary", "--text-secondary", "--text-muted"])
      for (const bg of [
        "--surface-panel",
        "--surface-raised",
        "--surface-input",
      ])
        expect(
          contrast(vars[text], vars[bg]),
          `${text} on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(vars["--accent-text"], vars["--accent"]),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(vars["--accent"], vars["--selection"]),
    ).toBeGreaterThanOrEqual(3);
    expect(
      contrast(vars["--text-secondary"], vars["--surface-hover"]),
    ).toBeGreaterThanOrEqual(3);
  }
  for (const background of [
    "#F1D58A",
    "#B7DAB7",
    "#AACFEA",
    "#EDB2AE",
    "#CEBCEB",
    "#CDD1D5",
  ])
    expect(contrast("#29251C", background)).toBeGreaterThanOrEqual(4.5);
  expect(contrast("#146CA4", "#F7F8FA")).toBeGreaterThanOrEqual(3);
  expect(contrast("#75C8FF", "#181C22")).toBeGreaterThanOrEqual(3);
});
