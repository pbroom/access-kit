import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@access-kit/api": fileURLToPath(new URL("./packages/api/src/index.ts", import.meta.url)),
      "@access-kit/connectors-aws": fileURLToPath(new URL("./packages/connectors-aws/src/index.ts", import.meta.url)),
      "@access-kit/connectors-mock": fileURLToPath(new URL("./packages/connectors-mock/src/index.ts", import.meta.url)),
      "@access-kit/connectors-microsoft-graph": fileURLToPath(new URL("./packages/connectors-microsoft-graph/src/index.ts", import.meta.url)),
      "@access-kit/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url))
    }
  },
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"]
  }
});
