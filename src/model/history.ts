import type { AxonDocument } from "./document";
import { documentContentEqual } from "./content";
import { MAX_HISTORY_ENTRIES } from "../shared/limits";
export class History {
  private past: AxonDocument[] = [];
  private future: AxonDocument[] = [];
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  commit(before: AxonDocument, after: AxonDocument) {
    if (documentContentEqual(before, after)) return false;
    this.past.push(before);
    if (this.past.length > MAX_HISTORY_ENTRIES) this.past.shift();
    this.future = [];
    return true;
  }
  undo(current: AxonDocument) {
    const p = this.past.pop();
    if (!p) return current;
    this.future.push(current);
    return p;
  }
  redo(current: AxonDocument) {
    const n = this.future.pop();
    if (!n) return current;
    this.past.push(current);
    return n;
  }
  clear() {
    this.past = [];
    this.future = [];
  }
}
