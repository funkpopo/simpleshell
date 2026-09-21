import { useEffect, useState } from "react";

// Only the visible menu needs a ticking clock. Badges and terminal notices use
// event snapshots and never subscribe to the countdown.
export default function useReconnectCountdown(status, open) {
  const [now, setNow] = useState(Date.now);
  const nextRetryAt = status?.nextRetryAt;
  const windowExpiresAt = status?.windowExpiresAt;
  const state = status?.state;
  useEffect(() => {
    if (
      !open ||
      (!nextRetryAt && !windowExpiresAt) ||
      !["pending", "reconnecting"].includes(state)
    )
      return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, nextRetryAt, windowExpiresAt, state]);
  return now;
}
