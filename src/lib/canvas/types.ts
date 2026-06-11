// Normalized JSON Canvas model (spec 1.0 — https://jsoncanvas.org/spec/1.0/).
// A `.canvas` file is an infinite board of positioned `nodes` connected by
// `edges`. The on-disk JSON is permissive about optional fields, so `parse`
// fills in defaults and drops malformed entries, leaving the shapes below for
// the renderer to consume without re-checking the wire format.
//
// Unlike notebooks, canvas documents are editable, so the model round-trips:
// `parse` reads the file and `serialize` writes it back in spec-valid form.

/** A canvas colour: a hex string (`#FF0000`) or a preset index `"1"`–`"6"`. */
export type CanvasColor = string;

/** The side of a node an edge attaches to. */
export type NodeSide = "top" | "right" | "bottom" | "left";

/** The terminal style at an edge endpoint. */
export type EdgeEnd = "none" | "arrow";

/** How a group node's background image is scaled. */
export type BackgroundStyle = "cover" | "ratio" | "repeat";

/** Fields shared by every node type. */
export interface BaseNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
}

/** A card holding inline markdown. */
export interface TextNode extends BaseNode {
  type: "text";
  text: string;
}

/** A card embedding another file (markdown, image, etc.). */
export interface FileNode extends BaseNode {
  type: "file";
  file: string;
  /** Optional in-file anchor; always begins with `#`. */
  subpath?: string;
}

/** A card pointing at an external URL. */
export interface LinkNode extends BaseNode {
  type: "link";
  url: string;
}

/** A labelled background region that visually contains other nodes. */
export interface GroupNode extends BaseNode {
  type: "group";
  label?: string;
  background?: string;
  backgroundStyle?: BackgroundStyle;
}

export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode;

/** A directed connection between two nodes. */
export interface CanvasEdge {
  id: string;
  fromNode: string;
  fromSide?: NodeSide;
  /** Defaults to `"none"` per spec. */
  fromEnd?: EdgeEnd;
  toNode: string;
  toSide?: NodeSide;
  /** Defaults to `"arrow"` per spec. */
  toEnd?: EdgeEnd;
  color?: CanvasColor;
  label?: string;
}

/** A whole canvas document. */
export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/** Thrown when a file is not valid canvas JSON. */
export class CanvasParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasParseError";
  }
}
