import { describe, expect, it } from "vitest";
import { releaseMetadata } from "../scripts/macos-release.mjs";

describe("macOS release metadata", () => {
  it.each(["push", "pull_request", "workflow_dispatch"])(
    "builds without publishing on %s when no release tag is supplied",
    (event) => {
      expect(
        releaseMetadata("2.0.0", {
          GITHUB_EVENT_NAME: event,
          GITHUB_REF_TYPE: "branch",
          GITHUB_REF_NAME: "test",
        }),
      ).toEqual({ version: "2.0.0", tag: "" });
    },
  );
  it.each(["v2.0.0", "2.0.0", "v2.0.0-macos"])(
    "publishes matching tag %s",
    (tag) => {
      expect(
        releaseMetadata("2.0.0", {
          GITHUB_EVENT_NAME: "push",
          GITHUB_REF_TYPE: "tag",
          GITHUB_REF_NAME: tag,
        }).tag,
      ).toBe(tag);
    },
  );
  it("accepts a manual release tag", () => {
    expect(
      releaseMetadata("2.0.0", {
        GITHUB_EVENT_NAME: "workflow_dispatch",
        RELEASE_TAG: "v2.0.0-macos",
      }).tag,
    ).toBe("v2.0.0-macos");
  });
  it.each([
    "v0.1.0",
    "v2.0.00",
    "v2.0.0\ntag=injected",
    "--help",
    "v2.0.0/other",
  ])("rejects mismatched or unsafe tag %s", (tag) => {
    expect(() =>
      releaseMetadata("2.0.0", {
        GITHUB_EVENT_NAME: "workflow_dispatch",
        RELEASE_TAG: tag,
      }),
    ).toThrow();
  });
  it("never publishes a pull request even if tag variables are set", () => {
    expect(
      releaseMetadata("2.0.0", {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_REF_TYPE: "tag",
        GITHUB_REF_NAME: "v2.0.0",
        RELEASE_TAG: "v2.0.0",
      }).tag,
    ).toBe("");
  });
});
