import { Suspense, lazy, memo, useMemo } from "react";
import {
  WebTerminalWithSuspense as WebTerminal,
  AIChatWindowWithSuspense,
} from "./LazyComponents.jsx";

const TerminalWorkspace = lazy(
  () => import("../features/terminal/components/TerminalWorkspace.jsx"),
);
const AIChatWorkspace = lazy(
  () => import("../features/ai/AIChatWorkspace.jsx"),
);
import {
  useShellSelector,
  useTerminalSelector,
  useReconnectSelector,
  useDragSelector,
} from "./state/AppContext.jsx";
import { shallowEqual } from "./state/subscriptionStore.js";
import {
  getLiveSessionKeys,
  getSessionDescriptor,
} from "../features/terminal/model/paneLayout.js";

const selectSessionLayout = ({ tabs, panes, splitLayouts }) => ({
  tabs,
  panes,
  splitLayouts,
});
const equalSessions = (left, right) =>
  left.length === right.length &&
  left.every((session, index) => shallowEqual(session, right[index]));

function useLiveTerminalSessions(includeDetails = false) {
  const layout = useShellSelector(selectSessionLayout, shallowEqual);
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
  if (sessions.length === 0) {
    return null;
  }
  return (
    <Suspense fallback={null}>
      <TerminalWorkspace
        {...props}
        paneDragOverId={paneDragOverId}
        sessions={sessions}
        renderTerminal={renderTerminal}
      />
    </Suspense>
  );
}

export function SessionAIChatWorkspace(props) {
  const sessions = useLiveTerminalSessions(true);
  return (
    <Suspense fallback={null}>
      <AIChatWorkspace
        {...props}
        sessions={sessions}
        chatComponent={AIChatWindowWithSuspense}
      />
    </Suspense>
  );
}
