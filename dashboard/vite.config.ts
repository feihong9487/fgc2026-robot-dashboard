import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// FGC 2026 儀表板。所有依賴走 npm + Vite bundle，**禁止任何 CDN runtime 載入**
// 也不引入 web font —— 比賽現場沒有網路。
export default defineConfig({
  plugins: [react()],
  // 無頭截圖用的 Edge profile 目錄放在專案底下（.gitignore 已忽略），但 chokidar
  // 會去 watch 它的 GPU cache 而那些檔案是鎖著的 → EBUSY 直接把 dev server 打掛。
  // 監看範圍本來就只該是原始碼。
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/.edge-profile*/**", "**/screens/**", "**/dist/**"] },
  },
  // Tauri 打包時的靜態輸出
  build: { outDir: "dist", target: "es2021" },
  clearScreen: false,
});
