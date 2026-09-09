// Backwards-compatible entry point. The product runtime itself never imports
// Vite; development UI and filesystem lifecycles stay independent.
await import("./main");
