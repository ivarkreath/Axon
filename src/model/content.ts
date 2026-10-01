import type { AxonDocument } from "./document";

// Internal documents are immutable, plain persisted values. Reference equality
// skips unchanged branches; optional undefined fields serialize like absent ones.
function equalValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => equalValue(value, b[index]))
    );
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  if (
    keys.length !==
    Object.keys(right).filter((key) => right[key] !== undefined).length
  )
    return false;
  return keys.every(
    (key) => Object.hasOwn(right, key) && equalValue(left[key], right[key]),
  );
}

function sameMetadata(a: AxonDocument, b: AxonDocument) {
  return (
    a.format === b.format &&
    a.version === b.version &&
    a.id === b.id &&
    a.title === b.title &&
    a.background === b.background
  );
}

export function documentContentEqual(a: AxonDocument, b: AxonDocument) {
  return (
    a === b ||
    (sameMetadata(a, b) &&
      equalValue(a.objects, b.objects) &&
      equalValue(a.assets, b.assets))
  );
}

/** Maintains exact saved-content differences outside render/dirty reads.
 * An ordinary edit scans object references, then compares only changed values.
 * The saved snapshot remains independent of history pruning and new branches.
 */
export class DocumentContentState {
  private differentObjects = new Set<number>();
  private differentAssets = new Set<string>();
  private changed = false;
  private saved: AxonDocument | null = null;

  constructor(
    private current: AxonDocument,
    saved: AxonDocument | null,
  ) {
    this.markSaved(saved);
  }

  get dirty() {
    return this.changed;
  }

  update(document: AxonDocument) {
    const previous = this.current;
    if (document === previous) return;
    this.current = document;
    const saved = this.saved;
    if (!saved) return;
    if (document === saved) {
      this.differentObjects.clear();
      this.differentAssets.clear();
    } else {
      if (document.objects !== previous.objects)
        for (
          let i = 0;
          i < Math.max(previous.objects.length, document.objects.length);
          i++
        )
          if (previous.objects[i] !== document.objects[i])
            this.setDifference(
              this.differentObjects,
              i,
              !equalValue(document.objects[i], saved.objects[i]),
            );
      if (document.assets !== previous.assets)
        for (const key of new Set([
          ...Object.keys(previous.assets),
          ...Object.keys(document.assets),
        ]))
          if (previous.assets[key] !== document.assets[key])
            this.setDifference(
              this.differentAssets,
              key,
              !equalValue(document.assets[key], saved.assets[key]),
            );
    }
    this.changed =
      !sameMetadata(document, saved) ||
      this.differentObjects.size > 0 ||
      this.differentAssets.size > 0;
  }

  markSaved(saved: AxonDocument | null) {
    this.saved = saved;
    this.differentObjects.clear();
    this.differentAssets.clear();
    this.changed = saved === null;
    if (!saved || saved === this.current) return;
    for (
      let i = 0;
      i < Math.max(this.current.objects.length, saved.objects.length);
      i++
    )
      if (!equalValue(this.current.objects[i], saved.objects[i]))
        this.differentObjects.add(i);
    for (const key of new Set([
      ...Object.keys(this.current.assets),
      ...Object.keys(saved.assets),
    ]))
      if (!equalValue(this.current.assets[key], saved.assets[key]))
        this.differentAssets.add(key);
    this.changed =
      !sameMetadata(this.current, saved) ||
      this.differentObjects.size > 0 ||
      this.differentAssets.size > 0;
  }

  private setDifference<K>(set: Set<K>, key: K, different: boolean) {
    if (different) set.add(key);
    else set.delete(key);
  }
}
