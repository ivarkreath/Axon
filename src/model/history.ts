import type { AxonDocument } from "./document";
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
    if (before === after || JSON.stringify(before) === JSON.stringify(after))
      return;
    this.past.push(before);
    if (this.past.length > 100) this.past.shift();
    this.future = [];
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
