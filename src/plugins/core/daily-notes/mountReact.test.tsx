import { act, render, screen, within } from "@testing-library/react";
import { type ReactNode, useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Disposer } from "@/lib/plugins/types";
import { mountReact } from "./mountReact";

const cleanups: Disposer[] = [];

function mount(node: ReactNode): HTMLElement {
  const el = document.createElement("div");
  document.body.append(el);
  act(() => mountReact(el, node, (cleanup) => cleanups.push(cleanup)));
  return el;
}

function runCleanups(): void {
  act(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });
}

/** Reports when it unmounts, the way a store subscription is released. */
function Subscriber({ onGone }: { onGone: () => void }) {
  useEffect(() => onGone, [onGone]);
  return <p>Hello</p>;
}

/** The host's mount slot in miniature: cleanup runs in an effect teardown, inside a commit. */
function Slot({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const disposers: Disposer[] = [];
    mountReact(el, children, (cleanup) => disposers.push(cleanup));
    return () => {
      for (const cleanup of disposers) cleanup();
      el.replaceChildren();
    };
  }, [children]);
  return <div ref={ref} />;
}

afterEach(() => {
  runCleanups();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("mountReact", () => {
  it("renders into a child of the mount element that takes no box", () => {
    const el = mount(<p>Hello</p>);

    const container = el.firstElementChild as HTMLElement;
    expect(el.children).toHaveLength(1);
    expect(container.style.display).toBe("contents");
    expect(within(container).getByText("Hello")).toBeInTheDocument();
  });

  it("registers one cleanup, which empties the render and releases its components", () => {
    const onGone = vi.fn();
    const el = mount(<Subscriber onGone={onGone} />);
    expect(cleanups).toHaveLength(1);
    expect(onGone).not.toHaveBeenCalled();

    runCleanups();
    expect(within(el).queryByText("Hello")).toBeNull();
    expect(onGone).toHaveBeenCalledOnce();
  });

  it("cleans up from inside the host's commit, where React refuses a sync unmount", () => {
    const error = vi.spyOn(console, "error");
    const onGone = vi.fn();
    const { unmount } = render(
      <Slot>
        <Subscriber onGone={onGone} />
      </Slot>,
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();

    unmount();
    expect(onGone).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });
});
