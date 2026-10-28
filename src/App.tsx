import { isTauri } from "./utils/tauri";
import { applyAppTheme } from "./utils/appTheme";
import { ContextMenuProvider } from "./components/ContextMenuProvider";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { WorkbenchLayout } from "./layouts/WorkbenchLayout";
import { useTranslation } from "./i18n";
import "./styles/global.css";

applyAppTheme("dark");

function BrowserFallback() {
  const { t } = useTranslation();

  return (
    <div className="browser-fallback">
      <h1>{t("browser.title")}</h1>
      <p>{t("browser.p1")}</p>
      <p>{t("browser.p2")}</p>
      <style>{`
        .browser-fallback {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 32px;
          text-align: center;
          color: var(--text);
        }
        .browser-fallback p {
          max-width: 520px;
          line-height: 1.6;
          color: var(--text-muted);
        }
        .browser-fallback code {
          background: var(--bg-elevated);
          padding: 2px 6px;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
}

function App() {
  if (!isTauri()) {
    return <BrowserFallback />;
  }

  return (
    <AppErrorBoundary>
      <ContextMenuProvider>
        <WorkbenchLayout />
      </ContextMenuProvider>
    </AppErrorBoundary>
  );
}

export default App;
