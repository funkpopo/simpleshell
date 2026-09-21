export function shallowEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        Object.is(left[key], right[key]),
    )
  );
}

// Context carries only the stable store. Publishing never renders the provider.
export function createSubscription(getSnapshot) {
  const listeners = new Set();
  return {
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify() {
      [...listeners].forEach((listener) => listener());
    },
  };
}
