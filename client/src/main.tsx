import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./host";
import "./shared/design/css/index.css";
import "./workspace.css";
import "katex/dist/katex.min.css";
import App from "./App";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
