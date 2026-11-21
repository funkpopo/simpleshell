import { useEffect, useRef, useState } from "react";

/** Host metadata depends on session membership, not transfer progress ticks. */
export default function useTransferHosts(transfers) {
  const sessionIds = JSON.stringify(
    [
      ...new Set(transfers.map((transfer) => transfer.tabId).filter(Boolean)),
    ].sort(),
  );
  const requestsRef = useRef(new Map());
  const [hosts, setHosts] = useState({});

  useEffect(() => {
    let active = true;
    const ids = JSON.parse(sessionIds);
    const requests = requestsRef.current;
    for (const id of requests.keys()) {
      if (!ids.includes(id)) requests.delete(id);
    }
    const load = async () => {
      const entries = await Promise.all(
        ids.map(async (id) => {
          if (!requests.has(id)) {
            requests.set(
              id,
              Promise.resolve().then(async () => {
                try {
                  const config = await window.terminalAPI?.getSSHConfig?.(id);
                  return config?.host || "";
                } catch {
                  return "";
                }
              }),
            );
          }
          return [id, await requests.get(id)];
        }),
      );
      if (active) setHosts(Object.fromEntries(entries));
    };
    void load();
    return () => {
      active = false;
    };
  }, [sessionIds]);

  return hosts;
}
