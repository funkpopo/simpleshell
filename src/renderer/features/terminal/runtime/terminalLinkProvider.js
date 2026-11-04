import { isCtrlLeftMouseClick } from "./terminalDom.js";
import {
  createTerminalUrlRegex,
  isValidExternalUrl,
  normalizeExternalUrl,
} from "../lib/terminalUrls.js";

/**
 * Opens a terminal link through the main process; failures are reported in
 * the terminal itself. `tRef` is read at call time so language changes apply.
 */
export function createExternalUrlOpener(term, tRef) {
  return async (uri) => {
    try {
      if (!window.terminalAPI?.openExternal) {
        throw new Error("terminalAPI.openExternal is unavailable");
      }

      const result = await window.terminalAPI.openExternal(uri, {
        source: "terminal",
      });
      if (
        result &&
        typeof result === "object" &&
        "success" in result &&
        !result.success
      ) {
        throw new Error(
          result.error ||
            tRef.current("webTerminal.runtime.openExternalFailed"),
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : tRef.current("webTerminal.runtime.openExternalFailed");
      console.error(`Failed to open external link: ${uri}`, error);

      if (typeof term.writeln === "function") {
        term.writeln(`\r\n[Link Error] ${message}`);
        term.writeln(`[Link Error] ${uri}`);
      }
    }
  };
}

/**
 * Ctrl+click URL/IPv4 link provider. Wrapped rows are joined (bounded to 128
 * rows / 16 KiB) so links spanning rows are detected on each visible row.
 */
export function createTerminalLinkProvider(term, openExternalUrl) {
  const simpleUrlRegex = createTerminalUrlRegex();
  return {
    provideLinks: (y, callback) => {
      const buffer = term.buffer.active;
      const targetLineIndex = y - 1;
      const targetLine = buffer.getLine(targetLineIndex);
      if (!targetLine) {
        callback([]);
        return;
      }

      let blockStart = targetLineIndex;
      while (blockStart > 0) {
        const current = buffer.getLine(blockStart);
        if (!current || !current.isWrapped) {
          break;
        }
        // Auto-linking must not read an entire scrollback-sized logical
        // line on mouse movement. This only bounds detection, not output.
        if (targetLineIndex - blockStart >= 128) {
          callback([]);
          return;
        }
        blockStart -= 1;
      }

      let blockEnd = targetLineIndex;
      let searchingWrappedLines = true;
      while (searchingWrappedLines) {
        const next = buffer.getLine(blockEnd + 1);
        if (!next || !next.isWrapped) {
          searchingWrappedLines = false;
          continue;
        }
        if (blockEnd - blockStart >= 128) {
          callback([]);
          return;
        }
        blockEnd += 1;
      }

      const segments = [];
      let offset = 0;
      for (let lineIndex = blockStart; lineIndex <= blockEnd; lineIndex++) {
        const line = buffer.getLine(lineIndex);
        if (!line) {
          continue;
        }
        const text = line.translateToString(true);
        segments.push({
          lineIndex,
          text,
          startOffset: offset,
          endOffset: offset + text.length,
        });
        offset += text.length;
        if (offset > 16384) {
          callback([]);
          return;
        }
      }

      const fullText = segments.map((seg) => seg.text).join("");
      const links = [];
      let match = null;

      simpleUrlRegex.lastIndex = 0;
      while ((match = simpleUrlRegex.exec(fullText)) !== null) {
        const rawUrl = match[0];
        const trimmedUrl = rawUrl.replace(/[),.;!?]+$/g, "");
        if (!trimmedUrl) {
          continue;
        }

        const fullUrl = trimmedUrl;
        const globalStart = match.index;
        const externalUrl = normalizeExternalUrl(fullUrl);
        if (!isValidExternalUrl(fullUrl, externalUrl)) {
          if (trimmedUrl.length !== rawUrl.length) {
            simpleUrlRegex.lastIndex = globalStart + trimmedUrl.length;
          }
          continue;
        }
        const globalEndExclusive = globalStart + fullUrl.length;

        for (const seg of segments) {
          if (seg.lineIndex !== targetLineIndex) {
            continue;
          }

          const intersectStart = Math.max(globalStart, seg.startOffset);
          const intersectEndExclusive = Math.min(
            globalEndExclusive,
            seg.endOffset,
          );
          if (intersectStart >= intersectEndExclusive) {
            continue;
          }

          const localStart = intersectStart - seg.startOffset;
          const localEndExclusive = intersectEndExclusive - seg.startOffset;

          links.push({
            text: fullUrl,
            range: {
              start: { x: localStart + 1, y },
              end: { x: localEndExclusive, y },
            },
            activate: (event) => {
              event?.preventDefault?.();
              if (!isCtrlLeftMouseClick(event)) {
                return;
              }
              void openExternalUrl(externalUrl);
            },
          });
        }

        if (trimmedUrl.length !== rawUrl.length) {
          simpleUrlRegex.lastIndex = globalStart + trimmedUrl.length;
        }
      }

      callback(links);
    },
  };
}
