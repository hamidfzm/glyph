import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { restoreMatchMedia, stubMatchMedia } from "@/test/matchMedia";
import { restoreRaf, stubRaf } from "@/test/raf";
import { useSpringPresence } from "./useSpringPresence";

function Probe({ open }: { open: boolean }) {
  const presence = useSpringPresence(open);
  if (!presence.mounted) return null;
  return <div data-testid="surface" ref={presence.ref} />;
}

afterEach(() => {
  restoreRaf();
  restoreMatchMedia();
});

describe("useSpringPresence", () => {
  it("renders nothing while closed", () => {
    stubRaf();
    render(<Probe open={false} />);
    expect(screen.queryByTestId("surface")).not.toBeInTheDocument();
  });

  it("mounts hidden and springs open to 1", () => {
    const raf = stubRaf();
    render(<Probe open />);
    const surface = screen.getByTestId("surface");
    expect(surface.style.getPropertyValue("--presence")).toBe("0");
    act(() => raf.settle());
    expect(surface.style.getPropertyValue("--presence")).toBe("1");
    expect(surface.hasAttribute("inert")).toBe(false);
  });

  it("keeps the node mounted through the exit, then unmounts", () => {
    const raf = stubRaf();
    const { rerender } = render(<Probe open />);
    act(() => raf.settle());

    rerender(<Probe open={false} />);
    const surface = screen.getByTestId("surface");
    expect(surface.hasAttribute("inert")).toBe(true);
    act(() => raf.frame());
    expect(screen.getByTestId("surface")).toBeInTheDocument();
    act(() => raf.settle());
    expect(screen.queryByTestId("surface")).not.toBeInTheDocument();
  });

  it("reopening mid-close reverses in place without unmounting", () => {
    const raf = stubRaf();
    const { rerender } = render(<Probe open />);
    act(() => raf.settle());

    rerender(<Probe open={false} />);
    act(() => {
      raf.frame();
      raf.frame();
    });
    const midway = Number(screen.getByTestId("surface").style.getPropertyValue("--presence"));
    expect(midway).toBeLessThan(1);

    rerender(<Probe open />);
    const surface = screen.getByTestId("surface");
    expect(surface.hasAttribute("inert")).toBe(false);
    act(() => raf.frame());
    const resumed = Number(surface.style.getPropertyValue("--presence"));
    expect(Math.abs(resumed - midway)).toBeLessThan(0.2);
    act(() => raf.settle());
    expect(surface.style.getPropertyValue("--presence")).toBe("1");
  });

  it("opens and closes instantly under reduced motion", () => {
    stubRaf();
    stubMatchMedia(true);
    const { rerender } = render(<Probe open />);
    expect(screen.getByTestId("surface").style.getPropertyValue("--presence")).toBe("1");

    rerender(<Probe open={false} />);
    expect(screen.queryByTestId("surface")).not.toBeInTheDocument();
  });
});
