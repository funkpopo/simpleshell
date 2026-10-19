import { Decoration } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { formatAbsoluteDateTime } from "../../../shared/lib/formatters.js";

export const formatSnapshotDate = (value) =>
  formatAbsoluteDateTime(value, { fallback: String(value || "") });

const splitTextLines = (value) => String(value ?? "").split("\n");

const diffLineSequences = (currentLines, snapshotLines) => {
  const currentLength = currentLines.length;
  const snapshotLength = snapshotLines.length;
  const max = currentLength + snapshotLength;
  const trace = [];
  let vertices = new Map([[1, 0]]);

  for (let distance = 0; distance <= max; distance += 1) {
    trace.push(new Map(vertices));

    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const leftVertex = vertices.get(diagonal - 1);
      const rightVertex = vertices.get(diagonal + 1);

      let currentIndex;
      if (
        diagonal === -distance ||
        (diagonal !== distance &&
          (leftVertex ?? Number.NEGATIVE_INFINITY) <
            (rightVertex ?? Number.NEGATIVE_INFINITY))
      ) {
        currentIndex = rightVertex ?? 0;
      } else {
        currentIndex = (leftVertex ?? 0) + 1;
      }

      let snapshotIndex = currentIndex - diagonal;

      while (
        currentIndex < currentLength &&
        snapshotIndex < snapshotLength &&
        currentLines[currentIndex] === snapshotLines[snapshotIndex]
      ) {
        currentIndex += 1;
        snapshotIndex += 1;
      }

      vertices.set(diagonal, currentIndex);

      if (currentIndex >= currentLength && snapshotIndex >= snapshotLength) {
        const operations = [];
        let currentPointer = currentLength;
        let snapshotPointer = snapshotLength;

        for (
          let traceIndex = trace.length - 1;
          traceIndex >= 0;
          traceIndex -= 1
        ) {
          const traceVertices = trace[traceIndex];
          const traceDiagonal = currentPointer - snapshotPointer;

          let previousDiagonal;
          if (
            traceDiagonal === -traceIndex ||
            (traceDiagonal !== traceIndex &&
              (traceVertices.get(traceDiagonal - 1) ??
                Number.NEGATIVE_INFINITY) <
                (traceVertices.get(traceDiagonal + 1) ??
                  Number.NEGATIVE_INFINITY))
          ) {
            previousDiagonal = traceDiagonal + 1;
          } else {
            previousDiagonal = traceDiagonal - 1;
          }

          const previousCurrent = traceVertices.get(previousDiagonal) ?? 0;
          const previousSnapshot = previousCurrent - previousDiagonal;

          while (
            currentPointer > previousCurrent &&
            snapshotPointer > previousSnapshot
          ) {
            operations.push({
              type: "equal",
              currentText: currentLines[currentPointer - 1],
              snapshotText: snapshotLines[snapshotPointer - 1],
            });
            currentPointer -= 1;
            snapshotPointer -= 1;
          }

          if (traceIndex === 0) {
            break;
          }

          if (currentPointer === previousCurrent) {
            operations.push({
              type: "insert",
              snapshotText: snapshotLines[snapshotPointer - 1],
            });
            snapshotPointer -= 1;
          } else {
            operations.push({
              type: "delete",
              currentText: currentLines[currentPointer - 1],
            });
            currentPointer -= 1;
          }
        }

        return operations.reverse();
      }
    }
  }

  return [];
};

export const buildSnapshotDiffData = (baseContent, currentContent) => {
  const baseLines = splitTextLines(baseContent);
  const currentLines = splitTextLines(currentContent);
  const operations = diffLineSequences(baseLines, currentLines);
  const rows = [];
  const summary = {
    changed: 0,
    added: 0,
    removed: 0,
  };

  let operationIndex = 0;
  let baseLineNumber = 1;
  let currentLineNumber = 1;

  while (operationIndex < operations.length) {
    const operation = operations[operationIndex];

    if (operation.type === "equal") {
      rows.push({
        type: "equal",
        baseLineNumber,
        baseText: operation.currentText ?? "",
        currentLineNumber,
        currentText: operation.snapshotText ?? "",
      });
      baseLineNumber += 1;
      currentLineNumber += 1;
      operationIndex += 1;
      continue;
    }

    const removedRows = [];
    const addedRows = [];

    while (
      operationIndex < operations.length &&
      operations[operationIndex].type !== "equal"
    ) {
      const blockOperation = operations[operationIndex];
      if (blockOperation.type === "delete") {
        removedRows.push({
          lineNumber: baseLineNumber,
          text: blockOperation.currentText ?? "",
        });
        baseLineNumber += 1;
      } else if (blockOperation.type === "insert") {
        addedRows.push({
          lineNumber: currentLineNumber,
          text: blockOperation.snapshotText ?? "",
        });
        currentLineNumber += 1;
      }
      operationIndex += 1;
    }

    const blockLength = Math.max(removedRows.length, addedRows.length);
    for (let rowIndex = 0; rowIndex < blockLength; rowIndex += 1) {
      const removedRow = removedRows[rowIndex] || null;
      const addedRow = addedRows[rowIndex] || null;

      if (removedRow && addedRow) {
        summary.changed += 1;
        rows.push({
          type: "changed",
          baseLineNumber: removedRow.lineNumber,
          baseText: removedRow.text,
          currentLineNumber: addedRow.lineNumber,
          currentText: addedRow.text,
        });
      } else if (removedRow) {
        summary.removed += 1;
        rows.push({
          type: "removed",
          baseLineNumber: removedRow.lineNumber,
          baseText: removedRow.text,
          currentLineNumber: null,
          currentText: "",
        });
      } else if (addedRow) {
        summary.added += 1;
        rows.push({
          type: "added",
          baseLineNumber: null,
          baseText: "",
          currentLineNumber: addedRow.lineNumber,
          currentText: addedRow.text,
        });
      }
    }
  }

  return {
    rows,
    summary,
    hasChanges: summary.changed > 0 || summary.added > 0 || summary.removed > 0,
  };
};

const getDiffPaneRole = (rowType, side) => {
  if (rowType === "equal") {
    return "equal";
  }

  if (side === "base") {
    if (rowType === "changed" || rowType === "removed") {
      return "removed";
    }
    if (rowType === "added") {
      return "empty";
    }
  }

  if (side === "current") {
    if (rowType === "changed" || rowType === "added") {
      return "added";
    }
    if (rowType === "removed") {
      return "empty";
    }
  }

  return "equal";
};

export const buildDiffPaneData = (rows, side) => {
  const lines = rows.map((row) =>
    side === "base" ? (row.baseText ?? "") : (row.currentText ?? ""),
  );

  return {
    value: lines.join("\n"),
    lineNumbers: rows.map((row) =>
      side === "base"
        ? (row.baseLineNumber ?? "")
        : (row.currentLineNumber ?? ""),
    ),
    lineRoles: rows.map((row) => getDiffPaneRole(row.type, side)),
  };
};

export const buildDiffLineDecorations = (paneData) => {
  const builder = new RangeSetBuilder();
  const lines = paneData.value.split("\n");
  let offset = 0;

  paneData.lineRoles.forEach((role, index) => {
    if (role !== "equal") {
      builder.add(
        offset,
        offset,
        Decoration.line({
          attributes: {
            class: `cm-diffLine cm-diffLine--${role}`,
          },
        }),
      );
    }

    const lineLength = lines[index]?.length ?? 0;
    offset += lineLength;
    if (index < lines.length - 1) {
      offset += 1;
    }
  });

  return builder.finish();
};
