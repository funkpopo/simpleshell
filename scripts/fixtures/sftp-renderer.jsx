import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import en from "../../src/i18n/locales/en-US.json";
import TransferSidebar from "../../src/components/TransferSidebar.jsx";
import GlobalTransferBar from "../../src/components/GlobalTransferBar.jsx";
import {
  useAllGlobalTransfers,
  applySftpTransferState,
  clearCompletedTransfersForAllTabs,
} from "../../src/store/globalTransferStore";

const calls = [];
let recovery = [
  {
    id: "retained",
    tabId: "fixture",
    fileName: "retained.bin",
    host: "127.0.0.1",
    username: "fixture",
    direction: "download",
    localPath: "/retained.bin",
    totalBytes: 1024,
  },
];
window.terminalAPI = {
  listResumableTransfers: async () => ({ success: true, tasks: recovery }),
  resumeTransfer: async (...args) => {
    calls.push(["resume", ...args]);
    recovery = [];
    return { success: true };
  },
  discardResumableTransfer: async (...args) => {
    calls.push(["discard", ...args]);
    recovery = [];
    return { success: true };
  },
  setTransferIntegrity: async (...args) => {
    calls.push(["verify", ...args]);
    return { success: true };
  },
  cancelTransfer: async (...args) => {
    calls.push(["pause", ...args]);
    return { success: true };
  },
  getProcessInfo: async () => ({ config: { host: "fixture" } }),
};
window.__hardwareAccelerationEnabled = false;
const i18n = i18next.createInstance();
await i18n.init({
  lng: "en-US",
  resources: { "en-US": en },
  interpolation: { escapeValue: false },
});

function Fixture() {
  const store = useAllGlobalTransfers();
  window.sftpUi = {
    ...store,
    calls,
    applySftpTransferState,
    clearCompletedTransfersForAllTabs,
  };
  return (
    <>
      <GlobalTransferBar
        onOpenFloat={() => {}}
        onToggleFloat={() => {}}
        isFloatOpen={false}
      />
      <TransferSidebar
        open={true}
        onClose={() => {}}
        zIndex={1300}
        onFocus={() => {}}
      />
    </>
  );
}
createRoot(document.getElementById("root")).render(
  <I18nextProvider i18n={i18n}>
    <ThemeProvider theme={createTheme({ palette: { mode: "dark" } })}>
      <Fixture />
    </ThemeProvider>
  </I18nextProvider>,
);
