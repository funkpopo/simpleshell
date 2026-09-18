import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

export default function useStoreSelector(store, selector, isEqual = Object.is) {
  const committed = useRef({ hasValue: false, value: undefined });
  const getSelection = useMemo(() => {
    // Keep the cache local to this render's selector so concurrent renders
    // with different selectors cannot overwrite each other's snapshots.
    let hasSnapshot = false;
    let snapshot;
    let selection;
    return () => {
      const nextSnapshot = store.getSnapshot();
      if (hasSnapshot && Object.is(snapshot, nextSnapshot)) return selection;
      const nextSelection = selector(nextSnapshot);
      const previous = hasSnapshot ? selection : committed.current.value;
      const canReuse = hasSnapshot || committed.current.hasValue;
      snapshot = nextSnapshot;
      hasSnapshot = true;
      selection =
        canReuse && isEqual(previous, nextSelection) ? previous : nextSelection;
      return selection;
    };
  }, [store, selector, isEqual]);
  const value = useSyncExternalStore(
    store.subscribe,
    getSelection,
    getSelection,
  );
  useEffect(() => {
    committed.current = { hasValue: true, value };
  }, [value]);
  return value;
}
