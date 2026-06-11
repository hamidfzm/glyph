import { describe, expect, it } from "vitest";
import type { CanvasBoardModel } from "@/lib/canvas/exportModel";
import { buildCanvasPdf } from "./canvasPdf";

const MODEL: CanvasBoardModel = {
  width: 500,
  height: 400,
  cards: [
    {
      kind: "group",
      x: 10,
      y: 10,
      width: 480,
      height: 380,
      borderColor: "rgb(200, 200, 205)",
      background: "rgba(245, 245, 247, 0.6)",
      label: "Planning",
    },
    {
      kind: "card",
      x: 48,
      y: 48,
      width: 200,
      height: 100,
      borderColor: "rgb(48, 209, 88)",
      background: "rgb(255, 255, 255)",
      html: "<h1>Card</h1><p>☑ done</p>",
    },
    {
      kind: "card",
      x: 48,
      y: 200,
      width: 200,
      height: 60,
      borderColor: "rgb(200, 200, 205)",
      background: "rgb(255, 255, 255)",
      linkUrl: "https://jsoncanvas.org",
    },
    {
      kind: "card",
      x: 280,
      y: 200,
      width: 200,
      height: 60,
      borderColor: "rgb(200, 200, 205)",
      background: "rgb(255, 255, 255)",
      fileName: "plan.md",
    },
    // An unlabelled group and an empty card draw only their rectangles, and
    // fully transparent colours fall back to the visible defaults.
    {
      kind: "group",
      x: 300,
      y: 10,
      width: 100,
      height: 80,
      borderColor: "rgba(0, 0, 0, 0)",
      background: "rgba(0, 0, 0, 0)",
    },
    {
      kind: "card",
      x: 350,
      y: 300,
      width: 100,
      height: 50,
      borderColor: "rgba(0, 0, 0, 0)",
      background: "rgba(0, 0, 0, 0)",
    },
  ],
  edgesSvg:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 400" width="500" height="400">' +
    '<path d="M100 100 C 150 100, 150 200, 200 200" fill="none" stroke="#8e8e93" stroke-width="2"/>' +
    '<polygon points="200,200 192,196 192,204" fill="#8e8e93"/>' +
    '<text x="150" y="150" text-anchor="middle" dominant-baseline="central" font-size="12" fill="#636366">spec</text>' +
    "</svg>",
};

describe("buildCanvasPdf", () => {
  it("produces a valid PDF with the board-sized page", async () => {
    const bytes = await buildCanvasPdf(MODEL, { title: "board", author: "me" });
    expect(bytes.length).toBeGreaterThan(1000);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
    // The custom page size survives into the produced document.
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("/MediaBox [0 0 500 400]");
  });

  it("renders an empty board (no cards, bare svg) without throwing", async () => {
    const bytes = await buildCanvasPdf(
      {
        width: 100,
        height: 100,
        cards: [],
        edgesSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>',
      },
      { title: "empty" },
    );
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
  });
});
