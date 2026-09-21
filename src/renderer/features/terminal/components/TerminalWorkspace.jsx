import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import PaneGrid from "./PaneGrid.jsx";
import { getSinglePaneLayout } from "../model/paneLayout.js";

// 每个会话拥有固定 portal 容器。移动容器只改变 DOM 位置，React 组件、
// xterm、输入队列、重连及 zmodem hook 均保持同一次挂载。
const SessionSurface = ({
  session,
  slots,
  renderTerminal,
  isActive,
  allowWebgl,
  onFocusPane,
}) => {
  const [container] = useState(() => {
    const node = document.createElement("div");
    node.style.cssText = "width:100%;height:100%;position:relative";
    node.dataset.terminalSession = session.sessionKey;
    return node;
  });
  useLayoutEffect(() => {
    const slot = slots.current.get(session.sessionKey);
    if (slot && container.parentElement !== slot) {
      slot.appendChild(container);
      if (isActive)
        container
          .querySelector(".xterm-helper-textarea")
          ?.focus({ preventScroll: true });
    }
  });
  useLayoutEffect(() => () => container.remove(), [container]);
  return createPortal(
    <div
      style={{ width: "100%", height: "100%" }}
      onMouseDown={() => onFocusPane(session.parentTabId, session.sessionKey)}
      onFocusCapture={() =>
        onFocusPane(session.parentTabId, session.sessionKey)
      }
    >
      {renderTerminal(session, { isActive, allowWebgl })}
    </div>,
    container,
  );
};

SessionSurface.propTypes = {
  session: PropTypes.object.isRequired,
  slots: PropTypes.object.isRequired,
  renderTerminal: PropTypes.func.isRequired,
  isActive: PropTypes.bool.isRequired,
  allowWebgl: PropTypes.bool.isRequired,
  onFocusPane: PropTypes.func.isRequired,
};

const SessionSlot = ({ sessionKey, slots }) => {
  const register = useCallback(
    (node) => {
      if (node) slots.current.set(sessionKey, node);
      return () => {
        if (slots.current.get(sessionKey) === node)
          slots.current.delete(sessionKey);
      };
    },
    [sessionKey, slots],
  );
  return <div ref={register} style={{ width: "100%", height: "100%" }} />;
};
SessionSlot.propTypes = {
  sessionKey: PropTypes.string.isRequired,
  slots: PropTypes.object.isRequired,
};

export default function TerminalWorkspace({
  tabs,
  layouts,
  sessions,
  activeTabId,
  renderTerminal,
  onFocusPane,
  onClosePane,
  onSetRatios,
  ...dragProps
}) {
  const slots = useRef(new Map());
  return (
    <>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          style={{
            position: "absolute",
            inset: 0,
            visibility: tab.id === activeTabId ? "visible" : "hidden",
            pointerEvents: tab.id === activeTabId ? "auto" : "none",
          }}
        >
          <PaneGrid
            tabId={tab.id}
            layout={layouts[tab.id] ?? getSinglePaneLayout(tab.id)}
            isActive={tab.id === activeTabId}
            renderPaneTerminal={(id) => (
              <SessionSlot sessionKey={id} slots={slots} />
            )}
            getPaneLabel={(id) =>
              sessions.find((session) => session.sessionKey === id)?.label
            }
            onFocusPane={(id) => onFocusPane(tab.id, id)}
            onClosePane={(id) => onClosePane(tab.id, id)}
            canClosePane={() => true}
            onSetRatios={(ratios) => onSetRatios(tab.id, ratios)}
            {...dragProps}
          />
        </div>
      ))}
      {sessions.map((session) => {
        const layout = layouts[session.parentTabId];
        const visible = session.parentTabId === activeTabId;
        return (
          <SessionSurface
            key={session.sessionKey}
            session={session}
            slots={slots}
            renderTerminal={renderTerminal}
            onFocusPane={onFocusPane}
            isActive={
              visible &&
              (!layout || layout.focusedPaneId === session.sessionKey)
            }
            allowWebgl={visible && (layout?.panes.length ?? 1) <= 2}
          />
        );
      })}
    </>
  );
}

TerminalWorkspace.propTypes = {
  tabs: PropTypes.array.isRequired,
  layouts: PropTypes.object.isRequired,
  sessions: PropTypes.array.isRequired,
  activeTabId: PropTypes.string,
  renderTerminal: PropTypes.func.isRequired,
  onFocusPane: PropTypes.func.isRequired,
  onClosePane: PropTypes.func.isRequired,
  onSetRatios: PropTypes.func.isRequired,
};
