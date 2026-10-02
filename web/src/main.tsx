import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { ErrorBoundary } from "./components/system/ErrorBoundary";
import { applySavedTheme } from "./components/system/theme";
import { DetailLevelProvider } from "./lib/detailLevel";
import { setupNativeBackButton } from "./lib/native";
import { ToastProvider } from "./ui";
import "./styles.css";

applySavedTheme();
setupNativeBackButton();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DetailLevelProvider>
      <ErrorBoundary>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </ErrorBoundary>
    </DetailLevelProvider>
  </StrictMode>,
);
