import { appReducer, initialState } from "./appReducer.js";
import { createSubscription, shallowEqual } from "./subscriptionStore.js";

function splitState(state) {
  const {
    draggedTabIndex,
    dragOverTabIndex,
    dragInsertPosition,
    paneDropZone,
    paneDragId,
    paneDragOverId,
    terminalInstances,
    ...shell
  } = state;
  return {
    shell,
    drag: {
      draggedTabIndex,
      dragOverTabIndex,
      dragInsertPosition,
      paneDropZone,
      paneDragId,
      paneDragOverId,
    },
    terminal: terminalInstances,
  };
}

export function createAppStore(seed = initialState) {
  let state = seed;
  let domains = splitState(state);
  const all = createSubscription(() => state);
  const shell = createSubscription(() => domains.shell);
  const drag = createSubscription(() => domains.drag);
  const terminal = createSubscription(() => domains.terminal);
  const subscriptions = { shell, drag, terminal };
  return {
    ...all,
    ...subscriptions,
    getState: () => state,
    dispatch(action) {
      const next = appReducer(state, action);
      if (Object.is(state, next)) return;
      const candidates = splitState(next);
      const changed = Object.keys(subscriptions).filter(
        (key) => !shallowEqual(domains[key], candidates[key]),
      );
      // Publish all domains before notifying, including cross-domain actions
      // such as closing/adopting tabs and forgetting sessions.
      state = next;
      domains = { ...domains };
      changed.forEach((key) => {
        domains[key] = candidates[key];
      });
      changed.forEach((key) => subscriptions[key].notify());
      all.notify();
    },
  };
}
