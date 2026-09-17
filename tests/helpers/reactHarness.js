import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

export async function renderHook(useHook, initialProps = {}, Wrapper) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let current;
  let props = initialProps;
  function Probe() {
    current = useHook(props);
    return null;
  }
  const render = () => {
    const probe = createElement(Probe);
    root.render(Wrapper ? createElement(Wrapper, null, probe) : probe);
  };
  await act(async () => render());
  return {
    get current() {
      return current;
    },
    async rerender(nextProps) {
      props = nextProps;
      await act(async () => render());
    },
    async unmount() {
      await act(() => root.unmount());
      host.remove();
    },
  };
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
