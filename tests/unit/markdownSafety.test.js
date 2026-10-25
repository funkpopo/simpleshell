import { describe, expect, it } from "vitest";
import { normalizeSafeMarkdownHref } from "../../src/renderer/shared/lib/markdownLinks.js";
import {
  createApiResponseError,
  formatBriefApiError,
} from "../../src/renderer/features/ai/lib/aiApiErrors.js";

describe("shared markdown link allowlist", () => {
  it("only keeps http, https and mailto links within the length limit", () => {
    expect(normalizeSafeMarkdownHref(" https://example.com/a ")).toBe(
      "https://example.com/a",
    );
    expect(normalizeSafeMarkdownHref("mailto:dev@example.com")).toBe(
      "mailto:dev@example.com",
    );
    expect(normalizeSafeMarkdownHref("javascript:alert(1)")).toBeNull();
    expect(normalizeSafeMarkdownHref("file:///etc/passwd")).toBeNull();
    expect(normalizeSafeMarkdownHref("/relative")).toBeNull();
    expect(
      normalizeSafeMarkdownHref(`https://example.com/${"a".repeat(2048)}`),
    ).toBeNull();
    expect(normalizeSafeMarkdownHref(null)).toBeNull();
  });
});

describe("AI API error summaries", () => {
  it("prefixes the status code once and compacts long messages", () => {
    expect(
      formatBriefApiError(
        { statusCode: 429, message: "API request failed: 429: slow down" },
        "fallback",
      ),
    ).toBe("API 429: slow down");
    const long = formatBriefApiError("x ".repeat(200), "fallback");
    expect(long.length).toBe(180);
    expect(long.endsWith("...")).toBe(true);
    expect(formatBriefApiError(null, "fallback")).toBe("fallback");
  });

  it("keeps the raw response and status on created errors", () => {
    const response = { status: 401, error: "bad key" };
    const error = createApiResponseError(response, "fallback");
    expect(error.message).toBe("bad key");
    expect(error.statusCode).toBe(401);
    expect(error.raw).toBe(response);
  });
});
