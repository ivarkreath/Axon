type NamedSession = { path: string | null; untitledName?: string };
export function documentName(session?: NamedSession) {
  return (
    session?.path?.split(/[\\/]/).at(-1) ||
    session?.untitledName ||
    "Без названия"
  );
}
export function nextUntitledName(sessions: Iterable<NamedSession>) {
  const used = new Set(Array.from(sessions, (s) => s.untitledName));
  for (let i = 1; ; i++) {
    const name = i === 1 ? "Без названия" : `Без названия ${i}`;
    if (!used.has(name)) return name;
  }
}
