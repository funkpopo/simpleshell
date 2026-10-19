const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const output = process.argv[2];
app.setPath("userData", path.join(output, "profile"));
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1000,
    height: 800,
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
      if (Date.now() - started > 10000) throw new Error(`UI timeout: ${fn}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  };
  try {
    await window.loadFile(path.join(output, "index.html"));
    await waitFor(
      () => !!document.querySelector('[aria-label="新增转发规则"]'),
    );
    await evaluate(() =>
      document.querySelector('[aria-label="新增转发规则"]').click(),
    );
    await waitFor(() => !!document.querySelector('[role="dialog"] input'));
    assert.deepEqual(
      await evaluate(() =>
        ["listenHost", "targetHost"].map((key) => {
          const label = [
            ...document.querySelectorAll('[role="dialog"] label'),
          ].find(
            (node) =>
              node.textContent === window.pfUi.t(`portForwarding.${key}`),
          );
          return document.getElementById(label.htmlFor).value;
        }),
      ),
      ["127.0.0.1", "ssh-target.internal"],
      "new local rule should use the SSH host and listen on local loopback",
    );
    await evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const values = {
        ruleName: "新建后应显示的数据库隧道",
        listenHost: "localhost",
        listenPort: "15432",
        targetPort: "5432",
      };
      Object.entries(values).forEach(([key, value]) => {
        const label = [...dialog.querySelectorAll("label")].find(
          (node) => node.textContent === window.pfUi.t(`portForwarding.${key}`),
        );
        const input = document.getElementById(label.htmlFor);
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
    await evaluate(() =>
      [...document.querySelectorAll('[role="dialog"] button')]
        .find((button) => button.textContent === "保存")
        .click(),
    );
    await waitFor(
      () =>
        !!document.querySelector(
          '[role="group"][aria-label="新建后应显示的数据库隧道"]',
        ),
    );
    assert.ok(
      await evaluate(() =>
        document
          .querySelector('[role="group"]')
          .textContent.includes("ssh-target.internal:5432"),
      ),
    );
    await waitFor(() => !document.querySelector('[role="dialog"]'));
    await evaluate(() => window.pfUi.addLongRules());
    await waitFor(
      () => document.querySelectorAll('[role="group"]').length === 6,
    );
    const measurements = [];
    for (const language of ["zh-CN", "en-US"]) {
      await window.webContents.executeJavaScript(
        `window.pfUi.language('${language}').then(() => true)`,
      );
      for (const width of [240, 280, 400]) {
        await window.webContents.executeJavaScript(
          `document.getElementById('preview').style.width = '${width}px'`,
        );
        await evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const result = await evaluate(() => {
          const cards = [...document.querySelectorAll('[role="group"]')];
          const list = cards[0].parentElement;
          list.scrollTop = 0;
          const listRect = list.getBoundingClientRect();
          const labelRect = document
            .getElementById("pf-session-select-label")
            .getBoundingClientRect();
          const clipped = cards.flatMap((card) => {
            const bounds = card.getBoundingClientRect();
            return [...card.querySelectorAll(".MuiTypography-root,button")]
              .filter((node) => {
                const rect = node.getBoundingClientRect();
                return (
                  rect.left < bounds.left ||
                  rect.right > bounds.right ||
                  rect.bottom > bounds.bottom ||
                  node.scrollWidth > node.clientWidth + 1
                );
              })
              .map(
                (node) => node.textContent || node.getAttribute("aria-label"),
              );
          });
          list.scrollTop = list.scrollHeight;
          return {
            clipped,
            horizontalOverflow: list.scrollWidth > list.clientWidth + 1,
            scrolls: list.scrollHeight > list.clientHeight,
            labelClipped: labelRect.top < listRect.top,
            lastVisible:
              cards.at(-1).getBoundingClientRect().bottom <=
              listRect.bottom + 1,
          };
        });
        assert.deepEqual(
          result.clipped,
          [],
          `${language}/${width} text clipped`,
        );
        assert.equal(result.horizontalOverflow, false);
        assert.equal(result.labelClipped, false);
        assert.equal(result.scrolls, true);
        assert.equal(result.lastVisible, true);
        measurements.push({ language, width, ...result });
      }
    }
    await window.webContents.executeJavaScript(
      "window.pfUi.language('zh-CN'); document.getElementById('preview').style.width = '280px'; document.querySelector('[role=group]').parentElement.scrollTop = 0",
    );
    await evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    fs.writeFileSync(
      path.join(output, "sidebar.png"),
      (
        await window.webContents.capturePage({
          x: 0,
          y: 0,
          width: 280,
          height: 520,
        })
      ).toPNG(),
    );
    fs.writeFileSync(
      path.join(output, "measurements.json"),
      JSON.stringify(measurements, null, 2),
    );
    await evaluate(() => window.pfUi.markRunning("pf-saved"));
    await waitFor(() => {
      const card = document.querySelector(
        '[role="group"][aria-label="新建后应显示的数据库隧道"]',
      );
      return !!card.querySelector(
        `[aria-label="${window.pfUi.t("portForwarding.stop")}"]`,
      );
    });
    await evaluate(() => {
      const card = document.querySelector(
        '[role="group"][aria-label="新建后应显示的数据库隧道"]',
      );
      card
        .querySelector(
          `[aria-label="${window.pfUi.t("portForwarding.delete")}"]`,
        )
        .click();
    });
    await waitFor(
      () =>
        !document.querySelector(
          '[role="group"][aria-label="新建后应显示的数据库隧道"]',
        ),
    );
    assert.equal(await evaluate(() => window.pfUi.deletionPending()), true);
    assert.equal(
      await evaluate(() => document.querySelectorAll('[role="group"]').length),
      5,
    );
    await evaluate(() => window.pfUi.finishDelete());
    console.log(
      "PORT_FORWARD_UI PASS running row disappears before delete cleanup resolves; other rows remain visible",
    );
    console.log(
      "PORT_FORWARD_UI PASS automatic SSH target, save-to-list and uncut text/labels/scrolling at 240, 280, 400 px in Chinese and English",
    );
    app.exit(0);
  } catch (error) {
    console.error("PORT_FORWARD_UI FAIL", error.stack);
    fs.writeFileSync(
      path.join(output, "failure.html"),
      await evaluate(() => document.body.innerHTML),
    );
    fs.writeFileSync(
      path.join(output, "failure.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    app.exit(1);
  }
});
