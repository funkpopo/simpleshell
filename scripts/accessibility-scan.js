const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const SOURCE_EXTENSIONS = new Set([".js", ".jsx"]);
const ALLOWED_NATIVE_DIALOG_FILES = new Set([
  path.normalize(path.join("src", "components", "AccessibleDialog.jsx")),
]);
const ALLOWED_NATIVE_ICON_BUTTON_FILES = new Set([
  path.normalize(path.join("src", "components", "AccessibleIconButton.jsx")),
]);

const readSourceFiles = (dir, output = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        continue;
      }
      readSourceFiles(fullPath, output);
      continue;
    }

    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      output.push(fullPath);
    }
  }
  return output;
};

const parseSource = (filePath) =>
  parser.parse(fs.readFileSync(filePath, "utf8"), {
    sourceType: "unambiguous",
    plugins: ["jsx", "classProperties", "optionalChaining"],
    errorRecovery: true,
  });

const getJsxName = (name) => {
  if (!name) {
    return "";
  }
  if (name.type === "JSXIdentifier") {
    return name.name;
  }
  if (name.type === "JSXMemberExpression") {
    return `${getJsxName(name.object)}.${getJsxName(name.property)}`;
  }
  return "";
};

const getAttribute = (openingElement, name) =>
  openingElement?.attributes?.find(
    (attribute) =>
      attribute.type === "JSXAttribute" &&
      getJsxName(attribute.name) === name,
  );

const unwrapExpression = (value) => {
  if (!value) {
    return null;
  }
  if (value.type === "JSXExpressionContainer") {
    return value.expression;
  }
  return value;
};

const isTranslationCall = (node) => {
  if (!node || node.type !== "CallExpression") {
    return false;
  }

  const callee = node.callee;
  return (
    (callee.type === "Identifier" && callee.name === "t") ||
    (callee.type === "MemberExpression" &&
      callee.property?.type === "Identifier" &&
      callee.property.name === "t")
  );
};

const isTranslatedExpression = (node) => {
  if (!node) {
    return false;
  }

  if (isTranslationCall(node)) {
    return true;
  }

  if (node.type === "ParenthesizedExpression") {
    return isTranslatedExpression(node.expression);
  }

  if (node.type === "ConditionalExpression") {
    return (
      isTranslatedExpression(node.consequent) &&
      isTranslatedExpression(node.alternate)
    );
  }

  if (node.type === "LogicalExpression") {
    return (
      isTranslatedExpression(node.left) && isTranslatedExpression(node.right)
    );
  }

  if (node.type === "TemplateLiteral") {
    return (
      node.quasis.every((quasi) => quasi.value.raw === "") &&
      node.expressions.length > 0 &&
      node.expressions.every(isTranslatedExpression)
    );
  }

  return false;
};

const isTranslatedAttribute = (attribute) => {
  if (!attribute?.value) {
    return false;
  }

  const value = unwrapExpression(attribute.value);
  return isTranslatedExpression(value);
};

const hasTranslatedTooltipAncestor = (pathRef) => {
  let parent = pathRef.parentPath;
  while (parent) {
    if (
      parent.node?.type === "JSXElement" &&
      new Set(["Tooltip", "SidebarTooltip"]).has(
        getJsxName(parent.node.openingElement.name),
      )
    ) {
      return isTranslatedAttribute(
        getAttribute(parent.node.openingElement, "title"),
      );
    }
    parent = parent.parentPath;
  }
  return false;
};

const collectImportedLocals = (ast, source) => {
  const locals = new Set();
  traverse(ast, {
    ImportDeclaration(importPath) {
      if (importPath.node.source.value !== source) {
        return;
      }
      for (const specifier of importPath.node.specifiers) {
        locals.add(specifier.local.name);
      }
    },
  });
  return locals;
};

const collectImportedLocalsByBasename = (ast, basename) => {
  const locals = new Set();
  traverse(ast, {
    ImportDeclaration(importPath) {
      const sourceValue = String(importPath.node.source.value || "");
      if (path.basename(sourceValue) !== basename) {
        return;
      }
      for (const specifier of importPath.node.specifiers) {
        locals.add(specifier.local.name);
      }
    },
  });
  return locals;
};

const main = () => {
  const issues = [];

  for (const filePath of readSourceFiles(SRC_DIR)) {
    const relativePath = path.normalize(path.relative(ROOT, filePath));
    const ast = parseSource(filePath);
    const accessibleIconButtonLocals = collectImportedLocalsByBasename(
      ast,
      "AccessibleIconButton.jsx",
    );
    const accessibleDialogLocals = collectImportedLocalsByBasename(
      ast,
      "AccessibleDialog.jsx",
    );
    const muiDialogLocals = collectImportedLocals(ast, "@mui/material/Dialog");

    traverse(ast, {
      ImportDeclaration(importPath) {
        if (
          importPath.node.source.value === "@mui/material" &&
          !ALLOWED_NATIVE_DIALOG_FILES.has(relativePath)
        ) {
          for (const specifier of importPath.node.specifiers) {
            if (
              specifier.type === "ImportSpecifier" &&
              specifier.imported.name === "Dialog"
            ) {
              issues.push(
                `${relativePath}:${specifier.loc?.start.line || 1} imports MUI Dialog directly; use AccessibleDialog`,
              );
            }
          }
        }

        if (
          importPath.node.source.value === "@mui/material/Dialog" &&
          !ALLOWED_NATIVE_DIALOG_FILES.has(relativePath)
        ) {
          issues.push(
            `${relativePath}:${importPath.node.loc?.start.line || 1} imports MUI Dialog directly; use AccessibleDialog`,
          );
        }
      },
      JSXOpeningElement(pathRef) {
        const name = getJsxName(pathRef.node.name);
        const line = pathRef.node.loc?.start.line || 1;

        if (accessibleIconButtonLocals.has(name)) {
          if (!isTranslatedAttribute(getAttribute(pathRef.node, "label"))) {
            issues.push(
              `${relativePath}:${line} AccessibleIconButton label must be t("...")`,
            );
          }
          return;
        }

        if (
          (name === "IconButton" || name === "Fab") &&
          !ALLOWED_NATIVE_ICON_BUTTON_FILES.has(relativePath)
        ) {
          if (!isTranslatedAttribute(getAttribute(pathRef.node, "aria-label"))) {
            issues.push(
              `${relativePath}:${line} ${name} requires a translated aria-label or AccessibleIconButton`,
            );
          }

          if (!hasTranslatedTooltipAncestor(pathRef)) {
            issues.push(
              `${relativePath}:${line} ${name} requires a translated tooltip or AccessibleIconButton`,
            );
          }
        }

        if (
          (name === "Dialog" && muiDialogLocals.has(name)) ||
          (name === "Dialog" && !accessibleDialogLocals.has(name))
        ) {
          if (!ALLOWED_NATIVE_DIALOG_FILES.has(relativePath)) {
            issues.push(
              `${relativePath}:${line} Dialog must be provided by AccessibleDialog`,
            );
          }
        }
      },
    });
  }

  if (issues.length > 0) {
    console.error("Accessibility scan failed:");
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }

  console.log("Accessibility scan passed");
};

main();
