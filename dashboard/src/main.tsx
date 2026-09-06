import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
// tokens.css 必須在 styles.css 之後：同特異度時後載入者贏，
// 而 FGC 的三層 token 是全案真相（styles.css 的 10 個 VMX 變數只是相容層）。
import "./fgc/styles/tokens.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
