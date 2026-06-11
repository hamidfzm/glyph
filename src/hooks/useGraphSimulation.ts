import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceGraph } from "@/lib/graph";
import {
  capturePositions,
  createGraphLayout,
  type GraphLayout,
  LAYOUT_MAX_TICKS,
  type NodePosition,
  tickLayout,
} from "@/lib/graphSimulation";

export interface UseGraphSimulationOptions {
  /** Simulation steps per animation frame. Tuned for 60fps; tests raise it. */
  ticksPerFrame?: number;
  /** Hard cap on total steps per layout pass. */
  maxTicks?: number;
}

export interface GraphSimulationState {
  layout: GraphLayout;
  /** Bumped once per animation frame while the layout is moving. */
  version: number;
  /** True once the current layout pass has finished. */
  settled: boolean;
}

const DEFAULT_TICKS_PER_FRAME = 10;

/**
 * Runs the d3-force layout for `graph` in requestAnimationFrame batches so
 * the UI thread stays responsive while big graphs settle. Node positions live
 * inside `layout.nodes` (mutated in place by d3); `version` ticks up each
 * frame so consumers know when to redraw without copying thousands of
 * positions through React state.
 *
 * Positions are remembered across graph changes, so a watcher-driven re-index
 * reheats the existing shape instead of replaying the whole layout.
 */
export function useGraphSimulation(
  graph: WorkspaceGraph,
  options?: UseGraphSimulationOptions,
): GraphSimulationState {
  const ticksPerFrame = options?.ticksPerFrame ?? DEFAULT_TICKS_PER_FRAME;
  const maxTicks = options?.maxTicks ?? LAYOUT_MAX_TICKS;
  const previousPositions = useRef<Map<string, NodePosition> | null>(null);
  const [version, setVersion] = useState(0);
  const [settled, setSettled] = useState(false);

  const layout = useMemo(
    () => createGraphLayout(graph, previousPositions.current ?? undefined),
    [graph],
  );

  useEffect(() => {
    setSettled(false);
    let elapsed = 0;
    let frame = 0;

    const step = () => {
      const done = tickLayout(layout, ticksPerFrame);
      elapsed += ticksPerFrame;
      previousPositions.current = capturePositions(layout);
      setVersion((v) => v + 1);
      if (done || elapsed >= maxTicks) {
        setSettled(true);
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame);
      layout.simulation.stop();
    };
  }, [layout, ticksPerFrame, maxTicks]);

  return { layout, version, settled };
}
