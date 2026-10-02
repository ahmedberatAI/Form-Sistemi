import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Geliştirme vekilinin API hedefi: VITE_API_TARGET > http://localhost:${PORT || 4000}.
// API portu PORT ile değişebildiği için sabit 4000 olamaz (bulgular #87, #313, #341); scripts/dev.mjs aynı kuralı yazdırır.
const apiTarget = process.env.VITE_API_TARGET?.trim().replace(/\/+$/, "") || `http://localhost:${process.env.PORT?.trim() || 4000}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": apiTarget,
    },
  },
  build: {
    outDir: "dist",
  },
});
