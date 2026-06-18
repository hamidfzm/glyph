import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  /** Warm the simulation back up and resume animating (used while dragging a
   *  node). Resets the per-pass tick budget so an interaction is never cut off
   *  by the anti-spin cap. */
  reheat: (alpha?: number) => void;
}

const DEFAULT_TICKS_PER_FRAME = 10;
const REHEAT_ALPHA = 0.5;

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
  // rAF handle + whether a loop is in flight, so reheat can resume a settled
  // simulation without ever stacking two loops.
  const frameRef = useRef(0);
  const runningRef = useRef(false);
  // Remaining tick budget for the current pass; reheat refills it.
  const budgetRef = useRef(maxTicks);

  const layout = useMemo(
    () => createGraphLayout(graph, previousPositions.current ?? undefined),
    [graph],
  );

  const runLoop = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setSettled(false);

    const step = () => {
      const done = tickLayout(layout, ticksPerFrame);
      budgetRef.current -= ticksPerFrame;
      previousPositions.current = capturePositions(layout);
      setVersion((v) => v + 1);
      if (done || budgetRef.current <= 0) {
        runningRef.current = false;
        setSettled(true);
        return;
      }
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
  }, [layout, ticksPerFrame]);

  // Fresh layout (mount or graph change): refill the budget and run.
  useEffect(() => {
    budgetRef.current = maxTicks;
    runLoop();
    return () => {
      cancelAnimationFrame(frameRef.current);
      runningRef.current = false;
      layout.simulation.stop();
    };
  }, [layout, maxTicks, runLoop]);

  const reheat = useCallback(
    (alpha = REHEAT_ALPHA) => {
      const sim = layout.simulation;
      sim.alpha(Math.max(sim.alpha(), alpha));
      // Refill the budget so a sustained drag keeps animating, then resume.
      budgetRef.current = maxTicks;
      runLoop();
    },
    [layout, maxTicks, runLoop],
  );

  return { layout, version, settled, reheat };
}
