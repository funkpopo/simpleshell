const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const output = process.argv[2];
app.setPath("userData", path.join(output, "profile"));
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    backgroundColor: "#121212",
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  const evaluate = (fn) => window.webContents.executeJavaScript(`(${fn})()`);
  const waitFor = async (fn) => {
    const started = Date.now();
    while (!(await evaluate(fn))) {
      if (Date.now() - started > 10000)
        throw new Error(`UI condition timed out: ${fn}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  try {
    await window.loadFile(path.join(output, "index.html"));
    await waitFor(() => document.body.textContent.includes("retained.bin"));
    await evaluate(() =>
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent === "Resume")
        .click(),
    );
    await waitFor(() =>
      window.sftpUi.calls.some((call) => call[0] === "resume"),
    );
    assert.deepEqual(await evaluate(() => window.sftpUi.calls[0]), [
      "resume",
      "fixture",
      "retained",
      { restart: false, algorithm: undefined },
    ]);
    await evaluate(() => {
      window.sftpUi.addTransferProgress("fixture", {
        transferId: "active",
        transferKey: "active-key",
        type: "download",
        fileName: "active.bin",
        progress: 10,
        totalBytes: 1024,
      });
    });
    await waitFor(
      () => !!document.querySelector('[aria-label="Task options"]'),
    );
    await evaluate(() =>
      document.querySelector('[aria-label="Task options"]').click(),
    );
    await waitFor(() =>
      [...document.querySelectorAll('[role="menuitem"]')].some((item) =>
        item.textContent.includes("MD5"),
      ),
    );
    await evaluate(() =>
      [...document.querySelectorAll('[role="menuitem"]')]
        .find((item) => item.textContent.includes("MD5"))
        .click(),
    );
    await waitFor(() =>
      window.sftpUi.calls.some((call) => call[0] === "verify"),
    );
    await evaluate(() => {
      window.sftpUi.applySftpTransferState({
        tabId: "fixture",
        transferKey: "active-key",
        status: "validating",
        progress: 99.9,
        algorithm: "md5",
        transferredBytes: 1024,
        totalBytes: 1024,
      });
      window.sftpUi.updateTransferProgress("fixture", "active", {
        progress: 100,
        statusText: "Download complete",
      });
      window.sftpUi.clearCompletedTransfersForAllTabs();
    });
    await waitFor(() => document.body.textContent.includes("Verifying…"));
    assert.ok(
      await evaluate(() =>
        window.sftpUi.allTransfers.some(
          (item) => item.transferId === "active" && item.progress < 100,
        ),
      ),
    );
    await evaluate(() =>
      window.sftpUi.applySftpTransferState({
        tabId: "fixture",
        transferKey: "active-key",
        status: "completed",
        progress: 100,
        algorithm: "md5",
        verified: true,
        transferredBytes: 1024,
        totalBytes: 1024,
      }),
    );
    await waitFor(() => document.body.textContent.includes("Verified ✓ · MD5"));
    await evaluate(() =>
      window.sftpUi.applySftpTransferState({
        tabId: "fixture",
        transferKey: "active-key",
        status: "error",
        progress: 99.9,
        algorithm: "md5",
        verified: false,
        error: "integrity mismatch: local=111, remote=222",
        errorKind: "integrity-mismatch",
      }),
    );
    await waitFor(() =>
      document.body.textContent.includes("local=111, remote=222"),
    );
    assert.ok(
      await evaluate(() => {
        const text = document.body.textContent;
        return (
          text.includes("Transfer failed") &&
          !text.includes("Download complete") &&
          !text.includes("Verified ✓")
        );
      }),
      "Integrity errors must replace stale completion and verification labels",
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const screenshot = await window.webContents.capturePage();
    fs.writeFileSync(
      path.join(output, "transfer-panel.png"),
      screenshot.toPNG(),
    );
    fs.writeFileSync(
      path.join(output, "result.json"),
      JSON.stringify(
        {
          success: true,
          checks: [
            "startup recovery listing",
            "one-click resume",
            "per-task MD5 menu",
            "validating survives stale progress and clear-completed",
            "verified algorithm label",
            "dual-hash error display",
            "integrity errors replace stale completion text",
          ],
        },
        null,
        2,
      ),
    );
    console.log("SFTP_UI PASS");
    app.exit(0);
  } catch (error) {
    console.error(
      "SFTP_UI FAIL",
      error.stack,
      await evaluate(() => ({
        text: document.body.textContent,
        state: window.sftpUi.allTransfers,
      })),
    );
    app.exit(1);
  }
});
