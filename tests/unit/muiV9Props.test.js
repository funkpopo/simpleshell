import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import * as mui from "@mui/material";

// MUI v9 removed deprecated props, system props on Box/Stack/Typography and
// several CSS classes. Removed props are silently ignored at runtime, so this
// guard keeps them out of the renderer.
const traverse = traverseModule.default || traverseModule;
const ROOT = path.resolve(__dirname, "../../src/renderer");

const SYSTEM_PROPS = new Set(
  (
    "m mt mr mb ml mx my p pt pr pb pl px py margin padding display overflow " +
    "visibility whiteSpace flexBasis flexDirection flexWrap justifyContent " +
    "alignItems alignContent order flex flexGrow flexShrink alignSelf " +
    "justifyItems justifySelf gap rowGap columnGap gridColumn gridRow " +
    "gridTemplateColumns gridTemplateRows gridArea position zIndex top right " +
    "bottom left bgcolor border borderTop borderRight borderBottom borderLeft " +
    "borderColor borderRadius width maxWidth minWidth height maxHeight " +
    "minHeight boxSizing fontFamily fontSize fontStyle fontWeight " +
    "letterSpacing lineHeight textAlign textTransform boxShadow"
  ).split(" "),
);
const SYSTEM_COMPONENTS = new Set(["Box", "Stack", "Typography"]);
const LEGACY_NAME =
  /(Props|Component)$|^(components|componentsProps|paragraph|light|inputRef|imgProps)$/;

const propNames = (name) => {
  const component = mui[name];
  const types =
    component?.propTypes ||
    component?.render?.propTypes ||
    component?.type?.propTypes ||
    component?.type?.render?.propTypes;
  return types ? new Set(Object.keys(types)) : null;
};

const classNames = (component) =>
  mui[`${component[0].toLowerCase()}${component.slice(1)}Classes`];

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.jsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function scan(file) {
  const code = fs.readFileSync(file, "utf8");
  const ast = parse(code, { sourceType: "module", plugins: ["jsx"] });
  const local = new Map();
  for (const node of ast.program.body) {
    if (node.type !== "ImportDeclaration") continue;
    if (node.source.value === "@mui/material") {
      for (const s of node.specifiers)
        if (s.type === "ImportSpecifier")
          local.set(s.local.name, s.imported.name);
    }
    const deep = node.source.value.match(/^@mui\/material\/([A-Z]\w+)$/);
    if (deep)
      for (const s of node.specifiers)
        if (s.type === "ImportDefaultSpecifier") local.set(s.local.name, deep[1]);
  }

  const problems = [];
  const where = (node) =>
    `${path.relative(ROOT, file)}:${node.loc.start.line}`;
  const checkClasses = (node, text) => {
    for (const [, component, key] of text.matchAll(
      /Mui([A-Z]\w*)-([A-Za-z0-9]+)/g,
    )) {
      const classes = classNames(component);
      if (classes && !(key in classes))
        problems.push(`${where(node)} removed class Mui${component}-${key}`);
    }
  };
  traverse(ast, {
    JSXOpeningElement({ node }) {
      if (node.name.type !== "JSXIdentifier") return;
      const component = local.get(node.name.name);
      if (!component) return;
      const allowed = propNames(component);
      for (const attr of node.attributes) {
        if (attr.type !== "JSXAttribute") continue;
        const prop = attr.name.name;
        if (allowed?.has(prop)) continue;
        if (LEGACY_NAME.test(prop))
          problems.push(`${where(attr)} <${component}> ${prop}`);
        else if (
          SYSTEM_COMPONENTS.has(component) &&
          SYSTEM_PROPS.has(prop) &&
          !(component === "Typography" && prop === "color")
        )
          problems.push(`${where(attr)} <${component}> system prop ${prop}`);
      }
    },
    StringLiteral({ node }) {
      checkClasses(node, node.value);
    },
    TemplateElement({ node }) {
      checkClasses(node, node.value.raw);
    },
  });
  return problems;
}

describe("MUI v9 API usage", () => {
  it("uses no removed props, system props or classes in the renderer", () => {
    const problems = sourceFiles(ROOT).flatMap(scan);
    expect(problems).toEqual([]);
  });
});
