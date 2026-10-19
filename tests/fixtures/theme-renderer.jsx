import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { ipcRenderer } from "electron";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import en from "../../src/shared/locales/en-US.json";
import { createUnifiedTheme } from "../../src/renderer/theme/index.js";
import {
  getThemeTokens,
  installThemeVariables,
} from "../../src/shared/themeTokens.js";
import { NotificationProvider } from "../../src/renderer/shared/notifications/NotificationContext.jsx";
import AIChatWindow from "../../src/renderer/features/ai/AIChatWindow.jsx";
import { aiClassName } from "../../src/renderer/features/ai/lib/aiClassName.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
window.terminalAPI = {
  loadAISettings: async () => ({ apis: [], currentApiId: null }),
};
window.addEventListener("error", (event) =>
  ipcRenderer.send("theme-result", {
    success: false,
    error: event.error?.stack || event.message,
  }),
);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
async function run() {
  await i18next.init({
    lng: "en-US",
    resources: { "en-US": en },
    interpolation: { escapeValue: false },
  });
  installThemeVariables(document);
  const root = createRoot(document.getElementById("root"));
  for (const dark of [false, true]) {
    document.body.classList.toggle("dark-theme", dark);
    document.body.classList.toggle("light-theme", !dark);
    document.body.setAttribute(
      "data-mui-color-scheme",
      dark ? "dark" : "light",
    );
    document.body.style.backgroundColor =
      getThemeTokens(dark)["--color-bg-default"];
    root.render(
      <I18nextProvider i18n={i18next}>
        <ThemeProvider theme={createUnifiedTheme(dark)}>
          <NotificationProvider>
            <AIChatWindow
              windowState="visible"
              onClose={() => {}}
              onMinimize={() => {}}
            />
          </NotificationProvider>
        </ThemeProvider>
      </I18nextProvider>,
    );
    let title;
    for (let attempt = 0; attempt < 100; attempt++) {
      await delay(20);
      title = document.querySelector(
        "." + CSS.escape(aiClassName("ai-chat-title")),
      );
      if (title) break;
    }
    assert(title, "AI chat title did not mount");
    await delay(250);
    const tokens = getThemeTokens(dark);
    const paper = document.querySelector(
      "." + CSS.escape(aiClassName("ai-chat-paper")),
    );
    const titleStyle = getComputedStyle(title),
      paperStyle = getComputedStyle(paper);
    const reference = document.createElement("span");
    reference.style.color = tokens["--color-text-primary"];
    document.body.append(reference);
    assert(
      titleStyle.fontSize === "13px",
      "AI title size must override MUI without !important: " +
        JSON.stringify({
          fontSize: titleStyle.fontSize,
          className: title.className,
          rules: [...document.styleSheets]
            .flatMap((sheet) => [...sheet.cssRules])
            .filter((rule) =>
              rule.selectorText?.includes(aiClassName("ai-chat-title")),
            )
            .map((rule) => rule.cssText),
        }),
    );
    assert(
      titleStyle.color === getComputedStyle(reference).color,
      "AI text must use the active theme token",
    );
    reference.style.backgroundColor = tokens["--color-bg-elevated"];
    assert(
      paperStyle.backgroundColor ===
        getComputedStyle(reference).backgroundColor,
      "AI paper must use the active elevated surface token",
    );
    assert(
      paperStyle.display === "flex" && paperStyle.overflow === "visible",
      "AI paper must retain its layout and resize handles",
    );
    reference.remove();
    await ipcRenderer.invoke("theme-capture", dark ? "dark" : "light");
  }
  root.unmount();
  ipcRenderer.send("theme-result", { success: true });
}
run().catch((error) =>
  ipcRenderer.send("theme-result", { success: false, error: error.stack }),
);
