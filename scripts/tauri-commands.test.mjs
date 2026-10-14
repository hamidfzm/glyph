import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.join(import.meta.dirname, "..");
const relative = (file) => path.relative(ROOT, file).replaceAll(path.sep, "/");

// Tests are left out: they reach `invoke` through mocks that accept any name.
const callers = readdirSync(path.join(ROOT, "src"), { recursive: true })
  .map((file) => path.join(ROOT, "src", file))
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
  .filter((file) => !relative(file).startsWith("src/test/"))
  .filter((file) => readFileSync(file, "utf8").includes("@tauri-apps/api/core"));

// Imports stay unresolved, so a name that comes from another module reads as unknown.
const program = ts.createProgram(callers, { noResolve: true, noLib: true, types: [] });
const checker = program.getTypeChecker();

const invoked = new Map();
const unreadable = [];
for (const source of program.getSourceFiles()) {
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "invoke"
    ) {
      const [command] = node.arguments;
      const line = source.getLineAndCharacterOfPosition(command.getStart()).line + 1;
      const site = `${relative(source.fileName)}:${line}`;
      const type = checker.getTypeAtLocation(command);
      const members = type.isUnion() ? type.types : [type];
      if (members.every((member) => member.isStringLiteral())) {
        for (const { value } of members) if (!invoked.has(value)) invoked.set(value, site);
      } else {
        unreadable.push(`${site} ${command.getText()}: ${checker.typeToString(type)}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const lib = readFileSync(path.join(ROOT, "src-tauri/src/lib.rs"), "utf8");
const registered = new Set(
  [...lib.matchAll(/generate_handler!\[([\s\S]*?)\]\)/g)]
    .flatMap(([, entries]) => entries.replace(/#\[[^\]]*\]|\/\/.*|\/\*[\s\S]*?\*\//g, "").split(","))
    .map((entry) => entry.trim().split("::").pop())
    .filter(Boolean),
);

describe("Tauri commands", () => {
  it("are invoked by names the type checker can read", () => {
    expect(unreadable).toEqual([]);
  });

  // Tauri rejects an unknown name at runtime, and some callers take the rejection as an answer.
  it("are invoked only by names the backend registers", () => {
    const unknown = [...invoked].filter(([name]) => !registered.has(name));
    expect(unknown.map(([name, site]) => `${name} (${site})`)).toEqual([]);
  });

  // The renderer can reach every registered command, whether the app calls it or not.
  it("are each invoked somewhere", () => {
    expect([...registered].filter((name) => !invoked.has(name))).toEqual([]);
  });
});
