import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "./host";
import "./shared/design/css/index.css";
import "./workspace.css";
import "katex/dist/katex.min.css";
import App from "./App";
import { queryClient } from "./app/query-client";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
