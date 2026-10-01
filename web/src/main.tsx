import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { applySavedTheme } from "./components/system/theme";
import { ToastProvider } from "./ui";
import "./styles.css";

applySavedTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);
