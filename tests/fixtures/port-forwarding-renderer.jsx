import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import zh from "../../src/shared/locales/zh-CN.json";
import en from "../../src/shared/locales/en-US.json";
import PortForwardingDialog from "../../src/renderer/features/connections/PortForwardingDialog.jsx";

let rules = [];
let notify;
let finishDelete;
const runtimeStatus = {};
const snapshot = () => structuredClone({ rules, runtimeStatus });
window.terminalAPI = {
  getPortForwardRules: async () => snapshot(),
  getPortForwardActiveSessions: async () => [
    {
      tabId: "tab:fixture",
      host: "ssh-target.internal",
      label: "administrator@a-very-long-production-server.internal.example",
      port: 22,
    },
  ],
  onPortForwardStatusUpdated: (callback) => {
    notify = callback;
    return () => {
      notify = null;
    };
  },
  savePortForwardRule: async (rule) => {
    const saved = { ...rule, id: "pf-saved" };
    rules = [saved];
    notify(snapshot());
    return saved;
  },
  deletePortForwardRule: async (id) => {
    const cleanup = new Promise((resolve) => {
      finishDelete = resolve;
    });
    rules = rules.filter((rule) => rule.id !== id);
    delete runtimeStatus[id];
    notify(snapshot());
    await cleanup;
    return true;
  },
};
const i18n = i18next.createInstance();
await i18n.init({
  lng: "zh-CN",
  resources: { "zh-CN": zh, "en-US": en },
  interpolation: { escapeValue: false },
});
window.pfUi = {
  t: (key) => i18n.t(key),
  markRunning(id) {
    runtimeStatus[id] = { status: "running" };
    notify(snapshot());
  },
  deletionPending: () => Boolean(finishDelete),
  finishDelete() {
    finishDelete();
    finishDelete = null;
  },
  addLongRules() {
    rules.push(
      ...Array.from({ length: 5 }, (_, n) => ({
        id: `long-${n}`,
        name: `生产数据库只读副本转发-${n}-long-unbroken-name-for-a-narrow-sidebar`,
        type: "local",
        listenHost: "localhost",
        listenPort: 20000 + n,
        remoteHost: "a-very-long-database-server.internal.production.example",
        remotePort: 5432,
      })),
    );
    for (const rule of rules.slice(1))
      runtimeStatus[rule.id] = {
        status: "error",
        error:
          "连接失败：请检查此主机的代理设置。connection-failed-with-a-long-error-message-without-spaces",
      };
    notify(snapshot());
  },
  language: (value) => i18n.changeLanguage(value),
};
createRoot(document.getElementById("root")).render(
  <I18nextProvider i18n={i18n}>
    <ThemeProvider theme={createTheme()}>
      <CssBaseline />
      <div id="preview" style={{ width: 280, height: 520 }}>
        <PortForwardingDialog open onClose={() => {}} />
      </div>
    </ThemeProvider>
  </I18nextProvider>,
);
