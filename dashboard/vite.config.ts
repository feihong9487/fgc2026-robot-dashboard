import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const here = dirname(fileURLToPath(import.meta.url));

// 開發伺服器端點:VisionPanel 的「匯出 C++ 標頭」把產生的內容 POST 進來,
// 直接覆寫 src/main/include/vision/BallVisionParams.h(瀏覽器無法寫絕對路徑,故走 dev server)。
function exportVisionHeaderPlugin(): Plugin {
  const target = resolve(here, "../src/main/include/vision/BallVisionParams.h");
  return {
    name: "export-vision-header",
    configureServer(server) {
      server.middlewares.use("/api/export-vision-header", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("method not allowed");
          return;
        }
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            await writeFile(target, body, "utf8");
            res.statusCode = 200;
            res.end(target);
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

// 同上,LinePanel 的「匯出 C++ 標頭」覆寫 src/main/include/vision/LineVisionParams.h。
function exportLineHeaderPlugin(): Plugin {
  const target = resolve(here, "../src/main/include/vision/LineVisionParams.h");
  return {
    name: "export-line-header",
    configureServer(server) {
      server.middlewares.use("/api/export-line-header", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("method not allowed");
          return;
        }
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            await writeFile(target, body, "utf8");
            res.statusCode = 200;
            res.end(target);
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

// 同上,LockerPanel 的「匯出 C++ 標頭」覆寫 src/main/include/vision/LockerVisionParams.h。
function exportLockerHeaderPlugin(): Plugin {
  const target = resolve(here, "../src/main/include/vision/LockerVisionParams.h");
  return {
    name: "export-locker-header",
    configureServer(server) {
      server.middlewares.use("/api/export-locker-header", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("method not allowed");
          return;
        }
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
          try {
            await writeFile(target, body, "utf8");
            res.statusCode = 200;
            res.end(target);
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), exportVisionHeaderPlugin(), exportLineHeaderPlugin(), exportLockerHeaderPlugin()],
  server: { port: 5173, strictPort: true },
  // Tauri 打包時的靜態輸出
  build: { outDir: "dist", target: "es2021" },
  clearScreen: false,
});
