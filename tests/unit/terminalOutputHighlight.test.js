import { describe, expect, it } from "vitest";
import outputProcessor from "../../src/main/terminal/output-processor.js";
import highlightRules from "../../src/shared/domain/highlight-configs.js";

// The previous quadratic selection, kept as the reference behavior.
const selectByScanningAll = (candidates) => {
  const sorted = [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    const lengthDelta = b.end - b.start - (a.end - a.start);
    if (lengthDelta) return lengthDelta;
    if (a.order !== b.order) return a.order - b.order;
    return a.start - b.start;
  });
  const selected = [];
  for (const candidate of sorted) {
    if (
      !selected.some(
        (existing) =>
          candidate.start < existing.end && existing.start < candidate.end,
      )
    ) {
      selected.push(candidate);
    }
  }
  return selected.sort((a, b) => a.start - b.start);
};

describe("terminal output highlighting", () => {
  it("selects the same non-overlapping ranges as a full overlap scan", () => {
    let seed = 42;
    const random = (limit) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % limit;
    };
    for (let round = 0; round < 300; round++) {
      const candidates = Array.from({ length: 1 + random(80) }, () => {
        const start = random(200);
        return {
          start,
          end: start + 1 + random(12),
          priority: random(4),
          order: random(6),
        };
      });
      expect(outputProcessor.selectStableHighlightRanges(candidates)).toEqual(
        selectByScanningAll(candidates),
      );
    }
  });

  it("keeps IPv6 matches after the prefilter and skips other colon text", () => {
    const rule = highlightRules.find((item) => item.id === "ipv6");
    const regex = new RegExp(rule.pattern, rule.flags);
    const matches = (text) => text.match(regex) || [];

    for (const address of [
      "2001:db8::ff00:42:8329",
      "fe80::1",
      "1:2:3:4:5:6:7:8",
      "abcd:ef01:2345:6789:abcd:ef01:2345:6789",
    ]) {
      expect(matches(`addr ${address} up`)).toEqual([address]);
    }
    expect(matches("2026-10-25 12:00:01 key: value")).toEqual([]);
  });

  it("highlights large log batches without dropping or reordering text", () => {
    const line =
      "2026-10-25 12:00:01 ERROR pid=1234 GET /var/log/app.log from 192.168.1.10:8080 status 500\r\n";
    const output = line.repeat(2000);
    const highlighted = outputProcessor.applySyntaxHighlighting(output);
    const visibleText = highlighted.replace(/\x1b\[[0-9;]*m/g, "");
    expect(visibleText).toBe(output);
    expect(highlighted.length).toBeGreaterThan(output.length);
  });
});
