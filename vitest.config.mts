import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
  resolve: {
    alias: {
      // Mirrors the "@/*" path alias in tsconfig.json.
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
