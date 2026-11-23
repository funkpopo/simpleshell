import { scanTerminalSearchMatches } from "../model/searchResults.js";

const SCAN_BUDGET_MS = 3.5;
const HIGHLIGHT_LIMIT = 1000;

const shouldYieldWithMessageChannel = () =>
  typeof MessageChannel === "function" &&
  typeof globalThis.vi === "undefined" &&
  !Object.prototype.hasOwnProperty.call(setTimeout, "clock");

/** Search the complete xterm buffer in cancellable slices, retaining positions
 * rather than a second copy of the terminal text. Navigation reuses the index. */
export class TerminalSearchAddon {
  constructor() {
    this.listeners = new Set();
    this.subscriptions = [];
    this.decorations = [];
    this.activeDecorations = [];
    this.matches = [];
    this.job = null;
    this.refreshTimer = null;
    this.cacheKey = null;
    this.lastSearch = null;
    this.navigationRequest = 0;
  }

  activate(term) {
    this.term = term;
    const invalidate = () => {
      if (
        !this.job &&
        !this.cacheKey &&
        !this.lastSearch &&
        this.matches.length === 0 &&
        this.activeDecorations.length === 0 &&
        !this.refreshTimer
      ) {
        return;
      }
      this.cancelScan();
      this.cacheKey = null;
      this.matches = [];
      this.clearHighlights();
      clearTimeout(this.refreshTimer);
      if (this.lastSearch) {
        // Coalesce output bursts; never restart a full scan for every line.
        this.refreshTimer = setTimeout(() => {
          this.refreshTimer = null;
          const search = this.lastSearch;
          if (search) {
            this.search(search.term, search.options, "next", true).catch(() => {
              this.clearDecorations();
            });
          }
        }, 200);
      }
    };
    this.subscriptions.push(
      term.onWriteParsed(invalidate),
      term.onResize(invalidate),
    );
    if (term.buffer.onBufferChange) {
      this.subscriptions.push(term.buffer.onBufferChange(invalidate));
    }
  }

  onDidChangeResults(listener) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  fireResults(index = -1) {
    const result = { resultCount: this.matches.length, resultIndex: index };
    this.listeners.forEach((listener) => listener(result));
  }

  closeJobYield(job) {
    if (!job) return;
    if (job.timer !== null) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    if (job.channel) {
      job.channel.port1.onmessage = null;
      job.channel.port1.close();
      job.channel.port2.close();
      job.channel = null;
    }
  }

  cancelScan() {
    if (!this.job) return;
    const job = this.job;
    this.job = null;
    this.closeJobYield(job);
    job.resolve(null);
  }

  getMatches(term, options) {
    const key = JSON.stringify([
      term,
      !!options.caseSensitive,
      !!options.regex,
      !!options.wholeWord,
    ]);
    if (this.cacheKey === key) return Promise.resolve(this.matches);
    if (this.job?.key === key) return this.job.promise;
    this.cancelScan();
    this.clearHighlights();
    this.matches = [];
    this.cacheKey = null;
    const scanner = scanTerminalSearchMatches(this.term, term, options);
    const channel = shouldYieldWithMessageChannel()
      ? new MessageChannel()
      : null;
    const job = { key, matches: [], timer: null, channel };
    job.promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    this.job = job;
    const scheduleNext = (stepFn) => {
      if (job.channel) {
        job.channel.port2.postMessage(null);
      } else {
        job.timer = setTimeout(stepFn, 0);
      }
    };
    const step = () => {
      if (this.job !== job) return;
      try {
        const start = performance.now();
        while (true) {
          const item = scanner.next();
          if (item.done) {
            this.job = null;
            this.closeJobYield(job);
            this.matches = job.matches;
            this.cacheKey = key;
            this.renderHighlights(options.decorations);
            job.resolve(this.matches);
            return;
          }
          if (item.value) {
            job.matches.push(item.value);
          } else if (performance.now() - start >= SCAN_BUDGET_MS) {
            break;
          }
        }
        scheduleNext(step);
      } catch (error) {
        this.job = null;
        this.closeJobYield(job);
        this.cacheKey = null;
        job.reject(error);
      }
    };
    if (job.channel) {
      job.channel.port1.onmessage = step;
    }
    scheduleNext(step);
    return job.promise;
  }

  findNext(term, options = {}) {
    return this.search(term, options, "next");
  }

  findPrevious(term, options = {}) {
    return this.search(term, options, "previous");
  }

  async search(term, options, direction, noScroll = false) {
    if (!this.term || !term) {
      this.clearDecorations();
      return false;
    }
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.lastSearch = { term, options };
    const request = ++this.navigationRequest;
    const matches = await this.getMatches(term, options);
    if (!matches || !this.term || request !== this.navigationRequest)
      return false;
    if (!matches.length) {
      this.term.clearSelection();
      this.fireResults();
      return false;
    }
    const selection = this.term.getSelectionPosition()?.start;
    const row = selection?.y ?? this.term.buffer.active.viewportY;
    const col = selection?.x ?? 0;
    // Lower bound makes repeated navigation independent of history size.
    let low = 0;
    let high = matches.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const match = matches[mid];
      if (match.row < row || (match.row === row && match.col < col))
        low = mid + 1;
      else high = mid;
    }
    const atSelection =
      selection && matches[low]?.row === row && matches[low]?.col === col;
    let index = direction === "previous" ? low - 1 : low;
    if (
      direction === "next" &&
      atSelection &&
      !options.incremental &&
      !noScroll
    )
      index++;
    index = (index + matches.length) % matches.length;
    const match = matches[index];
    this.term.select(match.col, match.row, match.size);
    this.disposeHighlights(this.activeDecorations);
    this.decorateMatch(
      match,
      options.decorations,
      true,
      this.activeDecorations,
    );
    if (
      !noScroll &&
      (match.row < this.term.buffer.active.viewportY ||
        match.row >= this.term.buffer.active.viewportY + this.term.rows)
    ) {
      this.term.scrollToLine(
        Math.max(0, match.row - Math.floor(this.term.rows / 2)),
      );
    }
    this.fireResults(index);
    return true;
  }

  decorateMatch(match, options, active, target) {
    if (!options || !this.term.registerDecoration || !this.term.registerMarker)
      return;
    let row = match.row;
    let col = match.col;
    let remaining = match.size;
    while (remaining > 0 && target.length < HIGHLIGHT_LIMIT) {
      const width = Math.min(this.term.cols - col, remaining);
      if (width <= 0) break;
      const buffer = this.term.buffer.active;
      const marker = this.term.registerMarker(
        row - buffer.baseY - buffer.cursorY,
      );
      if (!marker) break;
      const decoration = this.term.registerDecoration({
        marker,
        x: col,
        width,
        layer: active ? "top" : "bottom",
        overviewRulerOptions: {
          color: active
            ? options.activeMatchColorOverviewRuler
            : options.matchOverviewRuler,
          position: "center",
        },
      });
      if (decoration) {
        decoration.onRender((element) => {
          element.classList.add("xterm-find-result-decoration");
          if (active)
            element.classList.add("xterm-find-active-result-decoration");
        });
        decoration.onDispose(() => marker.dispose());
        target.push(decoration);
      } else marker.dispose();
      remaining -= width;
      col = 0;
      row++;
    }
  }

  renderHighlights(options) {
    if (!options) return;
    for (const match of this.matches) {
      if (this.decorations.length >= HIGHLIGHT_LIMIT) break;
      this.decorateMatch(match, options, false, this.decorations);
    }
  }

  disposeHighlights(items) {
    items.splice(0).forEach((item) => item.dispose());
  }

  clearHighlights() {
    this.disposeHighlights(this.decorations);
    this.disposeHighlights(this.activeDecorations);
  }

  clearDecorations() {
    ++this.navigationRequest;
    this.cancelScan();
    clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.lastSearch = null;
    this.cacheKey = null;
    this.matches = [];
    this.clearHighlights();
    this.fireResults();
  }

  dispose() {
    this.clearDecorations();
    this.subscriptions.splice(0).forEach((item) => item.dispose());
    this.listeners.clear();
    this.term = null;
  }
}
