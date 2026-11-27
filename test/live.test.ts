import { describe, it, expect, vi } from "vitest";
import { LiveRuns } from "../src/live.ts";

describe("LiveRuns", () => {
  it("gives a new watcher the output so far, then new output", () => {
    const live = new LiveRuns();
    live.start(1);
    live.append(1, "hello ");
    const onText = vi.fn();

    live.watch(1, onText, () => {});
    live.append(1, "world");

    expect(onText.mock.calls).toEqual([["hello "], ["world"]]);
  });

  it("does not send empty text to a new watcher", () => {
    const live = new LiveRuns();
    live.start(1);
    const onText = vi.fn();

    live.watch(1, onText, () => {});

    expect(onText).not.toHaveBeenCalled();
  });

  it("tells watchers when the run ends", () => {
    const live = new LiveRuns();
    live.start(1);
    const onEnd = vi.fn();
    live.watch(1, () => {}, onEnd);

    live.finish(1);

    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("returns undefined when the run is not live", () => {
    const live = new LiveRuns();

    expect(live.watch(1, () => {}, () => {})).toBeUndefined();
  });

  it("forgets a run once it has finished", () => {
    const live = new LiveRuns();
    live.start(1);
    live.finish(1);

    expect(live.watch(1, () => {}, () => {})).toBeUndefined();
  });

  it("stops sending to a watcher after it unsubscribes", () => {
    const live = new LiveRuns();
    live.start(1);
    const onText = vi.fn();
    const onEnd = vi.fn();
    const unwatch = live.watch(1, onText, onEnd)!;

    unwatch();
    live.append(1, "more");
    live.finish(1);

    expect(onText).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("keeps runs apart", () => {
    const live = new LiveRuns();
    live.start(1);
    live.start(2);
    const onText = vi.fn();
    live.watch(1, onText, () => {});

    live.append(2, "other run");

    expect(onText).not.toHaveBeenCalled();
  });
});
