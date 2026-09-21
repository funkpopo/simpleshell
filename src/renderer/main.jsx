import { memo } from "react";
import { createRoot } from "react-dom/client";
import { GlobalErrorBoundary } from "./components/ErrorBoundary.jsx";
import { AppProvider } from "./store/AppContext.jsx";
import { NotificationProvider } from "./contexts/NotificationContext.jsx";
import AppShell from "./components/app/AppShell.jsx";
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
