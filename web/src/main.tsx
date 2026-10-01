import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { applySavedTheme } from "./components/system/theme";
import { setupNativeBackButton } from "./lib/native";
import { ToastProvider } from "./ui";
import "./styles.css";

applySavedTheme();
setupNativeBackButton();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);
