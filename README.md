# Axon

Axon is a desktop canvas for diagrams, mind maps, and visual notes. Arrange ideas, connect them, and save editable documents or export them for sharing.

The interface is currently in Russian.

## Download for macOS

Download a DMG from [GitHub Releases](https://github.com/ivarkreath/Axon/releases): choose `mac-arm64` for Apple Silicon (M1 and newer) or `mac-x64` for Intel. Open the DMG and drag Axon to Applications. No Node.js installation is needed.

The app currently uses ad-hoc signing, without Apple notarization. If macOS blocks the first launch, use **System Settings → Privacy & Security → Open Anyway** for Axon after trying to open it. See [Apple's instructions](https://support.apple.com/en-us/102445).

## Features

- Freeform canvas with pan, zoom, a grid, and snapping guides.
- Shapes, text, sticky notes, freehand drawing, and embedded PNG/JPEG images.
- Straight, orthogonal, and curved connectors with labels and endpoint markers.
- Mind maps with branches and automatic layout.
- Multiple document tabs and a local working folder.
- Grouping, alignment, locking, copy/paste, and undo/redo.
- Light, dark, and system themes, with an independent canvas background.
- PNG, SVG, and PDF export of the whole document or a selection; copy as PNG.

## Requirements

For development and builds:

- Node.js 24 and npm. The release workflow uses Node.js 24; dependencies are locked in `package-lock.json`.
- Git to clone the repository.
- Windows x64 for the Windows packaging pipeline, or macOS for the macOS build.

Internet access is needed to download dependencies and build tools. A packaged application does not require Node.js.

## Running from source

In PowerShell on Windows or a terminal on macOS:

```sh
git clone https://github.com/ivarkreath/Axon.git
cd Axon
npm ci
npm run dev
```

If installation scripts were disabled and the Electron runtime is missing, run `npm run setup:electron` before starting. Restart the development app after changing Electron main/preload code.

## Getting started

1. Choose a tool in the bottom toolbar and place shapes, text, or a mind map on the canvas.
2. Use the connector tool or a shape's side handles to connect ideas. Hold Space and drag to pan; use Ctrl/Cmd + mouse wheel to zoom.
3. Save an editable `.axon` file with Ctrl/Cmd + S. Open or create other documents in separate tabs.
4. Use the export button to share a PNG, SVG, or PDF.

## Development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite and Electron for development |
| `npm run typecheck` | Check TypeScript types |
| `npm run lint` | Run ESLint |
| `npm test` | Run the Vitest suite |
| `npm run build` | Build the renderer and Electron code into `dist/` and `dist-electron/` |
| `npm start` | Run the last build with the development Electron runtime |

## Build

### Windows

Run on Windows x64 after installing dependencies. Save your work and close Axon first:

```sh
npm run dist:win
```

This runs checks, builds and verifies the application, and replaces `release/win-unpacked/`. Launch **`release/win-unpacked/Axon.exe`**. Keep the whole folder together: the EXE needs its accompanying resources. The current pipeline produces an unsigned application folder, without an installer. `npm run package:win` is an alias for the same command.

### macOS

Run on macOS with dependencies installed there:

```sh
npm run dist:mac
```

DMG and ZIP files appear in **`release/`**, named `Axon-<version>-mac-<arch>.dmg` and `.zip`. Open the DMG and drag Axon to Applications, or extract the ZIP and move `Axon.app` there.

The [macOS CI and release workflow](.github/workflows/macos-release.yml) builds and checks Apple Silicon (`arm64`) and Intel (`x64`) packages on pushes to `main`, `test`, and `develope`, and pull requests to `main`. Download build-only DMG/ZIP files from the run's **Artifacts**. Push a version tag (for example `v2.0.0-macos`) or run the workflow manually with a new `release_tag` to publish a GitHub prerelease after both architectures pass. The tag must match `package.json`; existing releases are never overwritten. Leave the manual tag empty to build without publishing. See [release setup](docs/development.md#macos-cicd).

## Data

Documents are local, self-contained `.axon` files with embedded images. No account or cloud service is required. Settings and recovery copies use Electron's application data folder; undo history stays in memory.

## Documentation

Technical documentation (Russian): [development](docs/development.md), [architecture](docs/architecture.md), [document format](docs/document-format.md), [editor behavior](docs/editor-model.md), and [design system](docs/design-system.md).

Dependency and font licenses: [third-party notices](THIRD_PARTY_NOTICES.md) and [Noto font license](public/fonts/OFL.txt).
