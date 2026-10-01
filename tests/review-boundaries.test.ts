import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sources(name)
      : /\.tsx?$/.test(name)
        ? [name]
        : [];
  });
}
function imports(file: string) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  return source.statements.flatMap((node) =>
    ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)
      ? [node.moduleSpecifier.text]
      : [],
  );
}

describe("review: platform import boundaries", () => {
  it("keeps Electron and Node imports out of renderer sources", () => {
    for (const file of sources("src"))
      expect(
        imports(file).filter(
          (name) =>
            /^(electron|node:)/.test(name) || name.includes("/electron/"),
        ),
        file,
      ).toEqual([]);
  });
  it("keeps React and editor UI dependencies out of model and shared contracts", () => {
    for (const file of [...sources("src/model"), ...sources("src/shared")])
      expect(
        imports(file).filter(
          (name) => /^react(?:\/|$)/.test(name) || /\/(editor|ui)\//.test(name),
        ),
        file,
      ).toEqual([]);
  });
  it("registers thematic Electron handlers only through the guarded registrar", () => {
    for (const file of ["electron/workspace-ipc.ts", "electron/media-ipc.ts"])
      expect(readFileSync(file, "utf8")).not.toMatch(/ipcMain\s*\.\s*handle/);
    expect(readFileSync("electron/main.ts", "utf8")).toContain("ipc.dispose()");
  });
});
