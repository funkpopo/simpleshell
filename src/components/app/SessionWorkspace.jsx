import { memo, useMemo } from "react";
import TerminalWorkspace from "../terminal-pane/TerminalWorkspace.jsx";
import AIChatWorkspace from "../AIChatWorkspace.jsx";
import { WebTerminalWithSuspense as WebTerminal } from "../LazyComponents.jsx";
import {
  useAppSelector,
  useTerminalSelector,
  useReconnectSelector,
  useDragSelector,
} from "../../store/AppContext.jsx";
import { shallowEqual } from "../../store/subscriptionStore.js";
import {
  getLiveSessionKeys,
  getSessionDescriptor,
} from "../../modules/terminal/paneLayout.js";

const selectSessionLayout = ({ tabs, panes, splitLayouts }) => ({
  tabs,
  panes,
  splitLayouts,
});
const equalSessions = (left, right) =>
  left.length === right.length &&
  left.every((session, index) => shallowEqual(session, right[index]));

function useLiveTerminalSessions(includeDetails = false) {
  const layout = useAppSelector(selectSessionLayout, shallowEqual);
  const keys = useMemo(
    () => getLiveSessionKeys(layout.tabs, layout.splitLayouts),
    [layout],
  );
  // Refresh tokens and unrelated registry entries do not change this list.
  return useTerminalSelector(
    (instances) =>
      keys
        .filter((id) => instances[id])
        .map((id) =>
          getSessionDescriptor(
            { ...layout, terminalInstances: includeDetails ? instances : {} },
            id,
          ),
        )
        .filter(Boolean),
    equalSessions,
  );
}

const SessionTerminal = memo(function SessionTerminal({
  session,
  isActive,
  allowWebgl,
}) {
  const { config, refreshKey } = useTerminalSelector(
    (instances) => ({
      config: instances[`${session.sessionKey}-config`],
      refreshKey: instances[`${session.sessionKey}-refresh`],
    }),
    shallowEqual,
  );
  const reconnectStatus = useReconnectSelector(
    (state) => state.reconnectStateByTabId[session.sessionKey] || null,
  );
  return (
    <WebTerminal
      tabId={session.sessionKey}
      sessionKey={session.sessionKey}
      refreshKey={refreshKey}
      reconnectStatus={reconnectStatus}
      sshConfig={session.type === "local" ? null : config}
      terminalType={session.type}
      localConfig={session.type === "local" ? config : null}
      isActive={isActive}
      allowWebgl={allowWebgl}
    />
  );
});

const renderTerminal = (session, options) => (
  <SessionTerminal session={session} {...options} />
);

export function SessionWorkspace(props) {
  const sessions = useLiveTerminalSessions();
  const paneDragOverId = useDragSelector((state) => state.paneDragOverId);
  return (
    <TerminalWorkspace
      {...props}
      paneDragOverId={paneDragOverId}
      sessions={sessions}
      renderTerminal={renderTerminal}
    />
  );
}

export function SessionAIChatWorkspace(props) {
  const sessions = useLiveTerminalSessions(true);
  return <AIChatWorkspace {...props} sessions={sessions} />;
}
