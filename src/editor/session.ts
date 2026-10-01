import { parseDocument } from "../model/document";
import { DocumentContentState } from "../model/content";
import { History } from "../model/history";
import type { TabSession } from "../shared/contracts";
import type { EditorState } from "./store";

function savedDocument(session: TabSession) {
  if (!session.dirty) return session.document;
  return session.savedContent ? parseDocument(session.savedContent) : null;
}

// One owner for a tab's immutable snapshots, history and successful-save baseline.
export class DocumentSession {
  readonly history = new History();
  readonly content: DocumentContentState;

  constructor(
    public state: EditorState,
    public session: TabSession,
  ) {
    this.content = new DocumentContentState(state.doc, savedDocument(session));
  }

  accept(session: TabSession) {
    if (session.savedContent !== this.session.savedContent)
      this.content.markSaved(savedDocument(session));
    this.session = session;
  }

  update(state: EditorState) {
    this.content.update(state.doc);
    this.state = state;
  }
}
