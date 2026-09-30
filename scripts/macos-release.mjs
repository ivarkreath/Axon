import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function releaseMetadata(version, env) {
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  const tag =
    env.GITHUB_EVENT_NAME === "workflow_dispatch"
      ? env.RELEASE_TAG || ""
      : env.GITHUB_EVENT_NAME === "push" && env.GITHUB_REF_TYPE === "tag"
        ? env.GITHUB_REF_NAME
        : "";
  if (tag) {
    assert.match(tag, /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    const taggedVersion = tag.replace(/^v/, "");
    assert.ok(
      taggedVersion === version || taggedVersion.startsWith(`${version}-`),
      `Release tag ${tag} must match package.json version ${version}`,
    );
  }
  return { version, tag };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  const metadata = releaseMetadata(version, process.env);
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `version=${metadata.version}\ntag=${metadata.tag}\n`,
    );
  console.log(JSON.stringify(metadata));
}
