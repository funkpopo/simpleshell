import { memo } from "react";
import { createRoot } from "react-dom/client";
import { GlobalErrorBoundary } from "./shared/ui/ErrorBoundary.jsx";
import { AppProvider } from "./app/state/AppContext.jsx";
import { NotificationProvider } from "./shared/notifications/NotificationContext.jsx";
import AppShell from "./app/AppShell.jsx";
import "./i18n/i18n";
import "./styles/index.css";
import "./styles/theme-switch-animation.css";
function App() {
  return (
    <AppProvider>
      <NotificationProvider>
        <AppShell />
      </NotificationProvider>
    </AppProvider>
  );
}
const MemoizedApp = memo(App);
MemoizedApp.displayName = "App";
const root = createRoot(document.getElementById("root"));
root.render(
  <GlobalErrorBoundary>
    <MemoizedApp />
  </GlobalErrorBoundary>,
);
