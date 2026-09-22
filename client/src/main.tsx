import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "./shared/api";
import "./shared/design/css/index.css";
import "./workspace.css";
import "katex/dist/katex.min.css";
import App from "./app/AppShell";
import { queryClient } from "./app/query-client";
import { GlobalTooltip } from "./shared/components/GlobalTooltip";
if (location.hostname === "localhost") {
  location.replace(
    `${location.protocol}//127.0.0.1:${location.port}${location.pathname}${location.search}${location.hash}`,
  );
} else {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
        <GlobalTooltip />
      </QueryClientProvider>
    </StrictMode>,
  );
}
