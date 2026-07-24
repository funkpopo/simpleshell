const DEFAULT_SEARCH_OPTIONS = Object.freeze({
  caseSensitive: false,
  regex: false,
  wholeWord: false,
});

const normalizeSearchOptions = (options = {}) => ({
  ...DEFAULT_SEARCH_OPTIONS,
  ...options,
  caseSensitive: Boolean(options.caseSensitive),
  regex: Boolean(options.regex),
  wholeWord: Boolean(options.wholeWord),
});

const isWordBoundaryChar = (char) => {
  if (!char) {
    return true;
  }
  return !/[0-9A-Za-z_]/.test(char);
};

const isWholeWordMatch = (lineText, startIndex, matchLength) => {
  const before = startIndex > 0 ? lineText.charAt(startIndex - 1) : "";
  const after =
    startIndex + matchLength < lineText.length
      ? lineText.charAt(startIndex + matchLength)
      : "";
  return isWordBoundaryChar(before) && isWordBoundaryChar(after);
};

const buildRegex = (term, options) => {
  if (!term) {
    return null;
  }

  try {
    const source = options.regex
      ? term
      : term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flags = options.caseSensitive ? "g" : "gi";
    return new RegExp(source, flags);
  } catch {
    return null;
  }
};

const findNextMatchIndex = (searchText, term, options, fromIndex = 0) => {
  if (!term || !searchText) {
    return -1;
  }

  if (options.regex) {
    const regex = buildRegex(term, options);
    if (!regex) {
      return -1;
    }
    regex.lastIndex = Math.max(0, fromIndex);
    const match = regex.exec(searchText);
    if (!match || match[0] === "") {
      return -1;
    }
    if (
      options.wholeWord &&
      !isWholeWordMatch(searchText, match.index, match[0].length)
    ) {
      return findNextMatchIndex(
        searchText,
        term,
        options,
        match.index + Math.max(1, match[0].length),
      );
    }
    return match.index;
  }

  const haystack = options.caseSensitive
    ? searchText
    : searchText.toLowerCase();
  const needle = options.caseSensitive ? term : term.toLowerCase();
  let index = haystack.indexOf(needle, fromIndex);
  while (index !== -1) {
    if (!options.wholeWord || isWholeWordMatch(searchText, index, needle.length)) {
      return index;
    }
    index = haystack.indexOf(needle, index + 1);
  }
  return -1;
};

const getMatchLength = (searchText, term, options, matchIndex) => {
  if (options.regex) {
    const regex = buildRegex(term, options);
    if (!regex) {
      return 0;
    }
    regex.lastIndex = matchIndex;
    const match = regex.exec(searchText);
    if (!match || match.index !== matchIndex) {
      return 0;
    }
    return match[0].length;
  }

  return term.length;
};

const translateBufferLineToStringWithWrap = (buffer, startRow, trimRight) => {
  const strings = [];
  const lineOffsets = [0];
  let row = startRow;
  let line = buffer.getLine(row);

  while (line) {
    const nextLine = buffer.getLine(row + 1);
    const lineWrapsToNext = Boolean(nextLine && nextLine.isWrapped);
    let text = line.translateToString(!lineWrapsToNext && trimRight);

    if (lineWrapsToNext && nextLine) {
      const lastCell = line.getCell(line.length - 1);
      if (
        lastCell &&
        lastCell.getCode() === 0 &&
        lastCell.getWidth() === 1 &&
        nextLine.getCell(0)?.getWidth() === 2
      ) {
        text = text.slice(0, -1);
      }
    }

    strings.push(text);

    if (!lineWrapsToNext) {
      break;
    }

    lineOffsets.push(lineOffsets[lineOffsets.length - 1] + text.length);
    row += 1;
    line = nextLine;
  }

  return {
    text: strings.join(""),
    lineCount: strings.length,
    lineOffsets,
  };
};

const stringLengthToBufferSize = (buffer, row, stringLength) => {
  const line = buffer.getLine(row);
  if (!line) {
    return 0;
  }

  let bufferSize = stringLength;
  for (let index = 0; index < bufferSize; index += 1) {
    const cell = line.getCell(index);
    if (!cell) {
      break;
    }

    const chars = cell.getChars();
    if (chars.length > 1) {
      bufferSize -= chars.length - 1;
    }

    const nextCell = line.getCell(index + 1);
    if (nextCell && nextCell.getWidth() === 0) {
      bufferSize += 1;
    }
  }

  return bufferSize;
};

const getSearchableBufferLength = (term, buffer) => {
  const limit =
    Number.isFinite(buffer?.baseY) && Number.isFinite(term?.rows)
      ? buffer.baseY + term.rows
      : buffer?.length;

  if (!Number.isFinite(limit)) {
    return 0;
  }

  if (!Number.isFinite(buffer?.length)) {
    return Math.max(0, limit);
  }

  return Math.max(0, Math.min(limit, buffer.length));
};

const collectTerminalSearchMatches = (term, rawTerm, options = {}) => {
  const buffer = term?.buffer?.active;
  if (!buffer) {
    return [];
  }

  const searchOptions = normalizeSearchOptions(options);
  const searchTerm = typeof rawTerm === "string" ? rawTerm : "";
  if (!searchTerm) {
    return [];
  }

  // Invalid regex should yield no matches (matches SearchAddon behavior).
  if (searchOptions.regex && !buildRegex(searchTerm, searchOptions)) {
    return [];
  }

  const terminalCols = Number.isFinite(term?.cols) ? term.cols : 0;
  const searchableBufferLength = getSearchableBufferLength(term, buffer);
  const matches = [];

  for (let row = 0; row < searchableBufferLength; row += 1) {
    const line = buffer.getLine(row);
    if (!line) {
      continue;
    }

    if (line.isWrapped) {
      continue;
    }

    const { text, lineCount, lineOffsets } =
      translateBufferLineToStringWithWrap(buffer, row, true);

    let resultIndex = findNextMatchIndex(text, searchTerm, searchOptions, 0);
    while (resultIndex !== -1) {
      const matchLength = getMatchLength(
        text,
        searchTerm,
        searchOptions,
        resultIndex,
      );
      if (matchLength <= 0) {
        break;
      }

      let startRowOffset = 0;
      while (
        startRowOffset < lineOffsets.length - 1 &&
        resultIndex >= lineOffsets[startRowOffset + 1]
      ) {
        startRowOffset += 1;
      }

      let endRowOffset = startRowOffset;
      while (
        endRowOffset < lineOffsets.length - 1 &&
        resultIndex + matchLength >= lineOffsets[endRowOffset + 1]
      ) {
        endRowOffset += 1;
      }

      const startColOffset = resultIndex - lineOffsets[startRowOffset];
      const endColOffset =
        resultIndex + matchLength - lineOffsets[endRowOffset];
      const startCol = stringLengthToBufferSize(
        buffer,
        row + startRowOffset,
        startColOffset,
      );
      const endCol = stringLengthToBufferSize(
        buffer,
        row + endRowOffset,
        endColOffset,
      );

      matches.push({
        term: rawTerm,
        row: row + startRowOffset,
        col: startCol,
        size:
          endCol -
          startCol +
          terminalCols * Math.max(0, endRowOffset - startRowOffset),
      });

      resultIndex = findNextMatchIndex(
        text,
        searchTerm,
        searchOptions,
        resultIndex + Math.max(1, matchLength),
      );
    }

    row += lineCount - 1;
  }

  return matches;
};

const getSelectionStart = (selectionRange) => {
  if (!selectionRange || typeof selectionRange !== "object") {
    return null;
  }

  const start = selectionRange.start || selectionRange;
  const x = Number.isFinite(start?.x)
    ? start.x
    : Number.isFinite(selectionRange.startX)
      ? selectionRange.startX
      : null;
  const y = Number.isFinite(start?.y)
    ? start.y
    : Number.isFinite(selectionRange.startY)
      ? selectionRange.startY
      : null;

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
};

const findSelectedTerminalSearchMatchIndex = (term, matches = []) => {
  if (!Array.isArray(matches) || matches.length === 0) {
    return -1;
  }

  const selectionStart = getSelectionStart(term?.getSelectionPosition?.());
  if (!selectionStart) {
    return -1;
  }

  return matches.findIndex(
    (match) =>
      match && match.row === selectionStart.y && match.col === selectionStart.x,
  );
};

module.exports = {
  collectTerminalSearchMatches,
  findSelectedTerminalSearchMatchIndex,
};
