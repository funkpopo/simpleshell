import {
  clearGeometryFor,
  processCache,
  terminalCache,
} from "./terminalSessionStore.js";
import { setupSimulatedTerminal } from "../lib/simulatedTerminal.js";
import {
  formatTerminalConnectionError,
  normalizeTerminalConnectResult,
} from "../lib/terminalConnection.js";

/**
 * Starts the backing process for a freshly created terminal (local shell,
 * SSH/Telnet/Serial/Mosh) and binds it once connected; without a config it
 * falls back to the simulated welcome terminal. Late results for a terminal
 * that is no longer cached are discarded (and late processes killed).
 */
export function startTerminalSession({
  term,
  sessionKey,
  terminalType,
  sshConfig,
  localConfig,
  languageRef,
  tRef,
  currentProcessId,
  terminalDisposables,
  ensureTerminalMailbox,
  observeMoshStatus,
  setupDataListenerRef,
  setupCommandDetectionRef,
  pendingSystemShortcutRecoveryRef,
  scheduleTerminalLayoutSyncRef,
  lifecycleManager,
}) {
  const isLocalTerminal = terminalType === "local";
  const hasTerminalConfig = isLocalTerminal ? localConfig : sshConfig;

  if (hasTerminalConfig && window.terminalAPI) {
    const localizedSshConfig = sshConfig
      ? {
          ...sshConfig,
          language: languageRef.current,
        }
      : null;
    const localizedLocalConfig = localConfig
      ? {
          ...localConfig,
          // 主进程契约字段名保持 tabId，值使用会话键（窗格即轻量会话）
          tabId: sessionKey,
        }
      : null;

    const translate = (...args) => tRef.current(...args);

    if (isLocalTerminal) {
      term.writeln(
        `Starting ${localizedLocalConfig?.name || "local terminal"}...`,
      );
    } else if (localizedSshConfig.splitReconnect) {
      term.writeln(
        translate("webTerminal.runtime.reconnecting", {
          host: localizedSshConfig.host,
        }),
      );
    } else {
      term.writeln(
        translate("webTerminal.runtime.connecting", {
          host: localizedSshConfig.host,
        }),
      );
    }

    const formatConnectionError = (error) =>
      formatTerminalConnectionError(error, {
        isLocalTerminal,
        localizedSshConfig,
        translate,
      });

    try {
      let connectPromise;
      if (isLocalTerminal) {
        connectPromise =
          window.terminalAPI.startLocalTerminal(localizedLocalConfig);
      } else {
        const connectProtocol = localizedSshConfig.protocol || "ssh";
        connectPromise =
          connectProtocol === "telnet"
            ? window.terminalAPI.startTelnet(localizedSshConfig)
            : connectProtocol === "serial"
              ? window.terminalAPI.startSerial(localizedSshConfig)
              : connectProtocol === "mosh"
                ? window.terminalAPI.startMosh(localizedSshConfig)
                : window.terminalAPI.startSSH(localizedSshConfig);
      }

      connectPromise
        .then((result) => {
          const { processId, error } = normalizeTerminalConnectResult(result);
          if (terminalCache[sessionKey] !== term) {
            // 连接可能在关闭窗格之后才成功；结束迟到的进程，禁止重新填充缓存。
            if (processId)
              void window.terminalAPI
                .killProcess(processId)
                .catch((closeError) => console.warn(closeError));
            return;
          }
          if (error) {
            term.__connectionFailed = true;
            term.writeln(formatConnectionError(error));
            return;
          }
          if (processId) {
            term.__connectionFailed = false;
            currentProcessId.current = processId;

            const previousProcessId = processCache[sessionKey];
            if (previousProcessId) {
              clearGeometryFor(previousProcessId, sessionKey);
            }
            processCache[sessionKey] = processId;
            clearGeometryFor(processId, sessionKey);

            const event = new CustomEvent("terminalProcessIdUpdated", {
              detail: {
                terminalId: sessionKey,
                processId,
                protocol: isLocalTerminal
                  ? "local"
                  : localizedSshConfig.protocol || "ssh",
                terminalType: isLocalTerminal ? "local" : "remote",
                splitReconnect: localizedSshConfig?.splitReconnect || false,
              },
            });

            window.dispatchEvent(event);

            console.debug(
              `[WebTerminal] Clearing old event listeners before rebinding for sessionKey=${sessionKey}, old count=${terminalDisposables.length}`,
            );
            terminalDisposables.forEach((disposable) => {
              try {
                if (disposable && typeof disposable.dispose === "function") {
                  disposable.dispose();
                }
              } catch (disposeError) {
                console.error(
                  `[WebTerminal] Failed to dispose event listener:`,
                  disposeError,
                );
              }
            });
            terminalDisposables.length = 0;

            ensureTerminalMailbox(term);
            setupDataListenerRef.current(processId, term);
            observeMoshStatus(term, processId);

            console.debug(
              `[WebTerminal] Setting up command detection for sessionKey=${sessionKey}, processId=${processId}`,
            );
            setupCommandDetectionRef.current(
              term,
              processId,
              false,
              terminalDisposables,
              { pendingSystemShortcutRecoveryRef },
            );

            scheduleTerminalLayoutSyncRef.current("connection-ready");

            if (localizedSshConfig?.splitReconnect) {
              term.writeln(
                `\r\n${translate("webTerminal.runtime.newConnectionEstablished")}`,
              );

              lifecycleManager.setTimeout(() => {
                if (term.refresh) {
                  term.refresh(0, term.rows - 1);
                }
              }, 300);
            }
          } else {
            const errorMsg = localizedSshConfig?.splitReconnect
              ? translate("webTerminal.runtime.reconnectFailed", {
                  error: translate("webTerminal.runtime.noProcessId"),
                })
              : isLocalTerminal
                ? "Local terminal failed to start: no process id"
                : translate("webTerminal.runtime.connectionFailed", {
                    error: translate("webTerminal.runtime.noProcessId"),
                  });
            term.writeln(errorMsg);
            term.__connectionFailed = true;
          }
        })
        .catch((error) => {
          if (terminalCache[sessionKey] !== term) {
            return;
          }
          term.__connectionFailed = true;
          term.writeln(formatConnectionError(error));
        });
    } catch (error) {
      term.__connectionFailed = true;
      term.writeln(formatConnectionError(error));
    }
  } else {
    term.writeln(tRef.current("webTerminal.runtime.welcome"));
    term.writeln(tRef.current("webTerminal.runtime.helpHint"));
    term.writeln("");
    term.write("$ ");

    setupSimulatedTerminal(term);
  }
}
