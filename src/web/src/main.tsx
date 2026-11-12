import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { installAuthFetch } from "./lib/auth.ts";
import "./styles.css";

// 所有请求自动带上管理密码（若已登录）
installAuthFetch();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
