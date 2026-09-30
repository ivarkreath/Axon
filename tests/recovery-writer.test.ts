import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecoveryWriter } from "../electron/recovery";

const io = vi.hoisted(() => ({
  write: vi.fn(async (_file: string, _data: string | Uint8Array) => {}),
  remove: vi.fn(async () => {}),
}));
vi.mock("../electron/storage", () => ({ atomicWrite: io.write }));
vi.mock("node:fs/promises", () => ({ rm: io.remove }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  io.write.mockReset().mockResolvedValue(undefined);
  io.remove.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("recovery writes", () => {
  it("debounces edits and reads the latest snapshot only when writing", async () => {
    const notify = vi.fn();
    const recovery = new RecoveryWriter("recovery.json", notify);
    let title = "first";
    const snapshot = vi.fn(() => ({ title }));
    recovery.schedule(snapshot);
    await vi.advanceTimersByTimeAsync(500);
    title = "second";
    recovery.schedule(snapshot);
    await vi.advanceTimersByTimeAsync(799);
    expect(snapshot).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(io.write).toHaveBeenCalledExactlyOnceWith(
      "recovery.json",
      JSON.stringify({ title: "second" }),
    );
    expect(notify).toHaveBeenLastCalledWith({
      state: "saved",
      time: expect.any(String),
    });
  });

  it("serializes discard after slow writes and never revives the removed tab", async () => {
    const slow = deferred();
    io.write.mockImplementationOnce(() => slow.promise);
    const recovery = new RecoveryWriter("recovery.json", vi.fn());
    let tabs = ["discarded", "kept"];
    const snapshot = () => ({ tabs });
    recovery.schedule(snapshot);
    await vi.advanceTimersByTimeAsync(800);
    // This autosave is queued behind the slow write and must be cancelled.
    recovery.schedule(snapshot);
    await vi.advanceTimersByTimeAsync(800);
    const discard = recovery.persist(() => ({ tabs: ["kept"] }));
    // The renderer can still publish an update while closeTab is awaiting I/O.
    recovery.schedule(snapshot);
    await vi.advanceTimersByTimeAsync(1600);
    expect(io.write).toHaveBeenCalledTimes(1);
    slow.resolve();
    await discard;
    tabs = ["kept"];
    expect(
      io.write.mock.calls.map(([, data]) => JSON.parse(String(data))),
    ).toEqual([{ tabs: ["discarded", "kept"] }, { tabs: ["kept"] }]);
    await vi.advanceTimersByTimeAsync(800);
    expect(io.write).toHaveBeenCalledTimes(3);
    expect(io.write).toHaveBeenLastCalledWith(
      "recovery.json",
      JSON.stringify({ tabs: ["kept"] }),
    );
  });

  it("removes recovery after the active write and cancels queued autosaves", async () => {
    const slow = deferred();
    io.write.mockImplementationOnce(() => slow.promise);
    const recovery = new RecoveryWriter("recovery.json", vi.fn());
    recovery.schedule(() => ({ title: "first" }));
    await vi.advanceTimersByTimeAsync(800);
    recovery.schedule(() => ({ title: "second" }));
    await vi.advanceTimersByTimeAsync(800);
    const removing = recovery.persist(null);
    expect(io.remove).not.toHaveBeenCalled();
    slow.resolve();
    await removing;
    await vi.advanceTimersByTimeAsync(1600);
    expect(io.write).toHaveBeenCalledTimes(1);
    expect(io.remove).toHaveBeenCalledOnce();
  });

  it("cancels a pending timer immediately while settings are still being saved", async () => {
    const recovery = new RecoveryWriter("recovery.json", vi.fn());
    recovery.schedule(() => ({ title: "disabled" }));
    recovery.cancel();
    await vi.advanceTimersByTimeAsync(1600);
    expect(io.write).not.toHaveBeenCalled();
  });

  it("suppresses stale completion status after recovery has been disabled", async () => {
    const slow = deferred();
    io.write.mockImplementationOnce(() => slow.promise);
    const notify = vi.fn();
    const recovery = new RecoveryWriter("recovery.json", notify);
    recovery.schedule(() => ({ title: "edit" }));
    await vi.advanceTimersByTimeAsync(800);
    recovery.cancel();
    notify.mockClear();
    slow.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(notify).not.toHaveBeenCalled();
    await recovery.persist(null);
  });

  it("retains a new autosave when recovery is enabled during removal", async () => {
    const slow = deferred();
    io.remove.mockImplementationOnce(() => slow.promise);
    const recovery = new RecoveryWriter("recovery.json", vi.fn());
    const removing = recovery.persist(null);
    await vi.advanceTimersByTimeAsync(0);
    recovery.schedule(() => ({ title: "enabled again" }));
    await vi.advanceTimersByTimeAsync(1600);
    expect(io.write).not.toHaveBeenCalled();
    slow.resolve();
    await removing;
    await vi.advanceTimersByTimeAsync(800);
    expect(io.write).toHaveBeenCalledExactlyOnceWith(
      "recovery.json",
      JSON.stringify({ title: "enabled again" }),
    );
  });

  it("reports autosave failures and permits a later explicit retry", async () => {
    io.write.mockRejectedValueOnce(new Error("disk unavailable"));
    const notify = vi.fn();
    const recovery = new RecoveryWriter("recovery.json", notify);
    recovery.schedule(() => ({ title: "edit" }));
    await vi.advanceTimersByTimeAsync(800);
    expect(notify).toHaveBeenLastCalledWith({
      state: "error",
      message: "Не удалось записать рабочую копию",
    });
    await recovery.persist(() => ({ title: "retry" }));
    expect(io.write).toHaveBeenLastCalledWith(
      "recovery.json",
      JSON.stringify({ title: "retry" }),
    );
  });

  it.each([
    () => {
      throw new Error("snapshot unavailable");
    },
    () => ({ unsupported: 1n }),
  ])(
    "reports snapshot and serialization failures through backup status",
    async (snapshot) => {
      const notify = vi.fn();
      const recovery = new RecoveryWriter("recovery.json", notify);
      recovery.schedule(snapshot);
      await vi.advanceTimersByTimeAsync(800);
      expect(io.write).not.toHaveBeenCalled();
      expect(notify).toHaveBeenLastCalledWith({
        state: "error",
        message: "Не удалось записать рабочую копию",
      });
      await recovery.persist(() => ({ title: "retry" }));
      expect(io.write).toHaveBeenCalledOnce();
    },
  );

  it("orders concurrent explicit operations and retains only the latest deferred autosave", async () => {
    const removing = deferred();
    const writing = deferred();
    io.remove.mockImplementationOnce(() => removing.promise);
    io.write.mockImplementationOnce(() => writing.promise);
    const recovery = new RecoveryWriter("recovery.json", vi.fn());
    const remove = recovery.persist(null);
    recovery.schedule(() => ({ title: "obsolete" }));
    const persist = recovery.persist(() => ({ title: "explicit" }));
    recovery.schedule(() => ({ title: "latest" }));
    await vi.advanceTimersByTimeAsync(1600);
    expect(io.remove).toHaveBeenCalledOnce();
    expect(io.write).not.toHaveBeenCalled();
    removing.resolve();
    await remove;
    await vi.advanceTimersByTimeAsync(1600);
    expect(io.write).toHaveBeenCalledExactlyOnceWith(
      "recovery.json",
      JSON.stringify({ title: "explicit" }),
    );
    writing.resolve();
    await persist;
    await vi.advanceTimersByTimeAsync(800);
    expect(io.write).toHaveBeenCalledTimes(2);
    expect(io.write).toHaveBeenLastCalledWith(
      "recovery.json",
      JSON.stringify({ title: "latest" }),
    );
  });

  it("rejects a failed final write and recovers the queue for the next attempt", async () => {
    io.write.mockRejectedValueOnce(new Error("disk unavailable"));
    const recovery = new RecoveryWriter("recovery.json", vi.fn());
    await expect(recovery.persist(() => ({ tabs: [] }))).rejects.toThrow(
      "disk unavailable",
    );
    await recovery.persist(() => ({ tabs: ["retained"] }));
    expect(io.write).toHaveBeenCalledTimes(2);
  });
});
