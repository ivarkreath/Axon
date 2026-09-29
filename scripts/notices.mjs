import { readFile, writeFile, readdir } from "node:fs/promises";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const notices = [
  "# Third-party notices — Axon\n\nRuntime dependencies are bundled locally. No CDN resources are required. Electron/Chromium notices are included with the packaged runtime.\n",
];
for (const [location, metadata] of Object.entries(lock.packages)) {
  if (!location || metadata.dev) continue;
  let pkg;
  try {
    pkg = JSON.parse(await readFile(`${location}/package.json`, "utf8"));
  } catch {
    continue;
  }
  notices.push(
    `\n## ${pkg.name} ${pkg.version}\n\nLicense: ${typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license)}\n`,
  );
  const names = await readdir(location);
  const licenses = names.filter((name) =>
    /^licen[cs]e|^copying|^notice/i.test(name),
  );
  for (const name of licenses)
    try {
      notices.push(
        "\n" + (await readFile(`${location}/${name}`, "utf8")) + "\n",
      );
    } catch {
      /* A license directory is not a text file. */
    }
}
notices.push(
  "\n## Noto Sans and Noto Sans Mono\n\n" +
    (await readFile("public/fonts/OFL.txt", "utf8")),
);
await writeFile("THIRD_PARTY_NOTICES.md", notices.join("\n"));
