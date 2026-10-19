// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createUnifiedTheme } from "../../src/renderer/theme/index.js";
import {
  getThemeTokens,
  buildThemeCss,
  installThemeVariables,
} from "../../src/shared/themeTokens.js";
import {
  getStartupBackgroundColor,
  applyStartupThemeToDocument,
  clearStartupThemeBootstrap,
} from "../../src/shared/startupTheme.js";
import { Z_INDEX } from "../../src/shared/constants/zIndex.js";

describe("shared visual tokens", () => {
  it("retains distinct light and dark surfaces", () => {
    expect(getThemeTokens(false)["--color-bg-default"]).not.toBe(
      getThemeTokens(true)["--color-bg-default"],
    );
    expect(getThemeTokens(false)["--color-text-primary"]).not.toBe(
      getThemeTokens(true)["--color-text-primary"],
    );
  });
  it.each([false, true])(
    "keeps CSS, MUI and the first frame aligned in dark mode %s",
    (dark) => {
      const tokens = getThemeTokens(dark);
      const theme = createUnifiedTheme(dark);
      expect(theme.palette.background.default).toBe(
        tokens["--color-bg-default"],
      );
      expect(theme.palette.primary.main).toBe(tokens["--color-primary-main"]);
      expect(theme.palette.success.main).toBe(tokens["--color-success"]);
      expect(getStartupBackgroundColor(dark)).toBe(
        theme.palette.background.default,
      );
      expect(theme.zIndex.modal).toBe(Z_INDEX.modal);
      expect(buildThemeCss()).toContain(
        `--color-bg-default:${theme.palette.background.default};`,
      );
    },
  );
  it("installs one token sheet and keeps it after startup cleanup", () => {
    installThemeVariables(document);
    applyStartupThemeToDocument(
      { darkMode: true, backgroundColor: getStartupBackgroundColor(true) },
      document,
    );
    installThemeVariables(document);
    clearStartupThemeBootstrap(document);
    expect(document.querySelectorAll("#ss-theme-tokens")).toHaveLength(1);
    expect(document.getElementById("ss-theme-tokens").textContent).toContain(
      `--z-lockscreen:${Z_INDEX.lockscreen};`,
    );
    expect(Z_INDEX.dragGhost).toBeLessThan(Z_INDEX.modal);
    expect(Z_INDEX.paneDropOverlay).toBeLessThan(Z_INDEX.floatWindow);
  });
});
