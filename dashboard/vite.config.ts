import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// FGC 2026 儀表板。所有依賴走 npm + Vite bundle，**禁止任何 CDN runtime 載入**
// 也不引入 web font —— 比賽現場沒有網路。
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  // Tauri 打包時的靜態輸出
  build: { outDir: "dist", target: "es2021" },
  clearScreen: false,
});
