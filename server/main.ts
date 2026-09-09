import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import { createApp } from "./app";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const isDevelopment = process.argv.includes("--dev");
const uiPort = Number(process.env.PORT ?? 3000);
const port = Number(
  process.env.CORE_PORT ?? (isDevelopment ? uiPort + 1 : uiPort),
);
const app = createApp();

if (!isDevelopment) {
  const dist = path.join(repositoryRoot, "dist");
  await access(dist).catch(() => {
    throw new Error(
      "The production UI has not been built. Run `npm run build` first.",
    );
  });
  await app.register(fastifyStatic, { root: dist, wildcard: false });
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply
        .code(404)
        .send({ error: "not_found", message: "Route not found" });
    }
    return reply.sendFile("index.html");
  });
}

await app.listen({ port, host: "127.0.0.1" });
console.log(
  isDevelopment
    ? `oh-my-maek core → http://127.0.0.1:${port}`
    : `oh-my-maek → http://127.0.0.1:${port}`,
);

let stopping: Promise<void> | undefined;
const stop = () => {
  stopping ??= app.close();
  return stopping;
};
const onSignal = () => {
  void stop().then(
    () => process.exit(0),
    (error) => {
      console.error("Failed to stop oh-my-maek:", error);
      process.exit(1);
    },
  );
};
process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);
