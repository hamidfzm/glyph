// Minimal ANSI (SGR) escape-sequence parser for notebook stream output and
// tracebacks. Jupyter colourises stderr, rich reprs, and exception tracebacks
// with the standard CSI `ESC[…m` codes; rendering them raw shows garbage like
// `[0;31m`. We translate the subset that actually appears in notebooks —
// the 16 named colours, 256-colour and truecolour, bold/italic/underline — into
// styled segments. Named colours map to CSS classes (theme-aware via
// notebook.css); 256/truecolour map to inline `color` so any RGB is exact.
// Non-SGR control sequences are stripped.

const COLOR_NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];

export interface AnsiSegment {
  text: string;
  /** CSS class names (e.g. `ansi-fg-red`, `ansi-bold`). */
  classes: string[];
  /** Inline styles for 256/truecolour, which have no fixed class. */
  style: { color?: string; backgroundColor?: string };
}

interface AnsiState {
  fgClass?: string;
  bgClass?: string;
  fgColor?: string;
  bgColor?: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

function emptyState(): AnsiState {
  return {
    fgClass: undefined,
    bgClass: undefined,
    fgColor: undefined,
    bgColor: undefined,
    bold: false,
    italic: false,
    underline: false,
  };
}

/** Reset all attributes in place (SGR 0). Clears colour fields too. */
function resetState(state: AnsiState): void {
  state.fgClass = undefined;
  state.bgClass = undefined;
  state.fgColor = undefined;
  state.bgColor = undefined;
  state.bold = false;
  state.italic = false;
  state.underline = false;
}

/** Convert an xterm 256-colour index to a `#rrggbb` string. */
function xterm256ToHex(n: number): string {
  if (n < 16) {
    // Standard + bright palette approximations.
    const base = [
      "#000000",
      "#800000",
      "#008000",
      "#808000",
      "#000080",
      "#800080",
      "#008080",
      "#c0c0c0",
      "#808080",
      "#ff0000",
      "#00ff00",
      "#ffff00",
      "#0000ff",
      "#ff00ff",
      "#00ffff",
      "#ffffff",
    ];
    return base[n];
  }
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    const h = v.toString(16).padStart(2, "0");
    return `#${h}${h}${h}`;
  }
  const i = n - 16;
  const r = Math.floor(i / 36);
  const g = Math.floor((i % 36) / 6);
  const b = i % 6;
  const channel = (c: number) => (c === 0 ? 0 : 55 + c * 40).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Apply one parsed SGR parameter list to the running state (mutates `state`). */
function applyCodes(state: AnsiState, codes: number[]): void {
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) {
      resetState(state);
    } else if (code === 1) {
      state.bold = true;
    } else if (code === 3) {
      state.italic = true;
    } else if (code === 4) {
      state.underline = true;
    } else if (code === 22) {
      state.bold = false;
    } else if (code === 23) {
      state.italic = false;
    } else if (code === 24) {
      state.underline = false;
    } else if (code >= 30 && code <= 37) {
      state.fgClass = `ansi-fg-${COLOR_NAMES[code - 30]}`;
      state.fgColor = undefined;
    } else if (code >= 90 && code <= 97) {
      state.fgClass = `ansi-fg-bright-${COLOR_NAMES[code - 90]}`;
      state.fgColor = undefined;
    } else if (code === 39) {
      state.fgClass = undefined;
      state.fgColor = undefined;
    } else if (code >= 40 && code <= 47) {
      state.bgClass = `ansi-bg-${COLOR_NAMES[code - 40]}`;
      state.bgColor = undefined;
    } else if (code >= 100 && code <= 107) {
      state.bgClass = `ansi-bg-bright-${COLOR_NAMES[code - 100]}`;
      state.bgColor = undefined;
    } else if (code === 49) {
      state.bgClass = undefined;
      state.bgColor = undefined;
    } else if (code === 38 || code === 48) {
      // Extended colour: 38;5;n / 38;2;r;g;b (and 48;* for background).
      const isFg = code === 38;
      const mode = codes[i + 1];
      if (mode === 5) {
        const idx = codes[i + 2];
        const hex = xterm256ToHex(Math.max(0, Math.min(255, idx ?? 0)));
        if (isFg) {
          state.fgColor = hex;
          state.fgClass = undefined;
        } else {
          state.bgColor = hex;
          state.bgClass = undefined;
        }
        i += 2;
      } else if (mode === 2) {
        const [r, g, b] = [codes[i + 2] ?? 0, codes[i + 3] ?? 0, codes[i + 4] ?? 0];
        const rgb = `rgb(${r}, ${g}, ${b})`;
        if (isFg) {
          state.fgColor = rgb;
          state.fgClass = undefined;
        } else {
          state.bgColor = rgb;
          state.bgClass = undefined;
        }
        i += 4;
      }
    }
    // Other codes (blink, reverse, etc.) are ignored.
  }
}

function segmentFor(state: AnsiState, text: string): AnsiSegment {
  const classes: string[] = [];
  if (state.bold) classes.push("ansi-bold");
  if (state.italic) classes.push("ansi-italic");
  if (state.underline) classes.push("ansi-underline");
  if (state.fgClass) classes.push(state.fgClass);
  if (state.bgClass) classes.push(state.bgClass);
  const style: AnsiSegment["style"] = {};
  if (state.fgColor) style.color = state.fgColor;
  if (state.bgColor) style.backgroundColor = state.bgColor;
  return { text, classes, style };
}

// Matches any CSI sequence: ESC [ <params> <final-byte>. We only act on the
// `m` (SGR) final byte; every other CSI sequence is consumed and discarded.
// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC (0x1b) is the ANSI marker we must match
const CSI = /\x1b\[([0-9;]*)([A-Za-z])/g;

/**
 * Parse a string containing ANSI escape codes into styled segments. Segments
 * with no styling still carry empty `classes`/`style`, so callers can render
 * each as a `<span>` uniformly.
 */
export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  const state = emptyState();
  let lastIndex = 0;
  CSI.lastIndex = 0;
  let match: RegExpExecArray | null = CSI.exec(input);
  while (match !== null) {
    if (match.index > lastIndex) {
      segments.push(segmentFor(state, input.slice(lastIndex, match.index)));
    }
    if (match[2] === "m") {
      const params = match[1] === "" ? [0] : match[1].split(";").map((p) => Number(p) || 0);
      applyCodes(state, params);
    }
    lastIndex = match.index + match[0].length;
    match = CSI.exec(input);
  }
  if (lastIndex < input.length) {
    segments.push(segmentFor(state, input.slice(lastIndex)));
  }
  return segments;
}

/** True when the text contains at least one ANSI escape sequence. */
export function hasAnsi(input: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is the ANSI marker
  return /\x1b\[/.test(input);
}
