// Force-directed layout for the workspace graph, built on d3-force (physics
// only, no DOM). The simulation runs in world coordinates centered on (0, 0);
// the canvas camera decides where that lands on screen, so window resizes
// never trigger a re-layout. Pure module — the rAF pacing lives in
// `useGraphSimulation`.

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { WorkspaceGraph } from "./graph";

export interface LayoutNode extends SimulationNodeDatum {
  id: string;
  degree: number;
  orphan: boolean;
  label: string;
}

/** A link whose endpoints d3 has already swapped from ids to node objects. */
export interface LayoutLink {
  source: LayoutNode;
  target: LayoutNode;
}

export interface GraphLayout {
  nodes: LayoutNode[];
  links: LayoutLink[];
  simulation: Simulation<LayoutNode, SimulationLinkDatum<LayoutNode>>;
}

export interface NodePosition {
  x: number;
  y: number;
}

// ~300 ticks is where d3's default alpha decay reaches alphaMin anyway; the
// cap is a hard stop so a pathological graph can't keep a rAF loop alive.
export const LAYOUT_MAX_TICKS = 300;

// When most nodes carry a seeded position (an incremental update from the
// folder watcher, not a fresh open), reheat gently instead of replaying the
// whole layout, so the existing shape stays put.
const RESEED_ALPHA = 0.3;

export function createGraphLayout(
  graph: WorkspaceGraph,
  previousPositions?: ReadonlyMap<string, NodePosition>,
): GraphLayout {
  let seeded = 0;
  const nodes: LayoutNode[] = graph.nodes.map((n) => {
    const prev = previousPositions?.get(n.id);
    if (prev) seeded += 1;
    return {
      id: n.id,
      degree: n.degree,
      orphan: n.orphan,
      label: n.label,
      x: prev?.x,
      y: prev?.y,
    };
  });
  const links = graph.edges.map((e) => ({ source: e.source, target: e.target }));

  const simulation = forceSimulation(nodes)
    .force(
      "link",
      forceLink<LayoutNode, SimulationLinkDatum<LayoutNode>>(links)
        .id((d) => d.id)
        .distance(60),
    )
    // distanceMax keeps the n-body pass local, which is what makes a
    // multi-thousand-node layout affordable.
    .force("charge", forceManyBody().strength(-160).distanceMax(480))
    .force("x", forceX(0).strength(0.05))
    .force("y", forceY(0).strength(0.05))
    .force("collide", forceCollide(16))
    .stop();

  if (nodes.length > 0 && seeded >= nodes.length / 2) {
    simulation.alpha(RESEED_ALPHA);
  }

  // forceLink swapped each link's string endpoints for node references.
  return { nodes, links: links as unknown as LayoutLink[], simulation };
}

/**
 * Advance the simulation by up to `ticks` steps. Returns true once the
 * simulation has cooled below its alpha floor (i.e. the layout settled).
 */
export function tickLayout(layout: GraphLayout, ticks: number): boolean {
  const sim = layout.simulation;
  for (let i = 0; i < ticks; i += 1) {
    if (sim.alpha() < sim.alphaMin()) return true;
    sim.tick();
  }
  return sim.alpha() < sim.alphaMin();
}

/** Pin a node to a fixed world position so the simulation holds it there
 *  (used while the user drags it). d3 honours fx/fy on every tick. */
export function pinNode(node: LayoutNode, x: number, y: number): void {
  node.fx = x;
  node.fy = y;
}

/** Release a pinned node back into the flow of the simulation. */
export function releaseNode(node: LayoutNode): void {
  node.fx = null;
  node.fy = null;
}

/** Snapshot node positions, used to seed the next layout pass. */
export function capturePositions(layout: GraphLayout): Map<string, NodePosition> {
  const out = new Map<string, NodePosition>();
  for (const node of layout.nodes) {
    out.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
  }
  return out;
}
