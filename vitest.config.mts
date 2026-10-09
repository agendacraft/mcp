/// <reference types="vitest" />

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: [...configDefaults.exclude, "src/**/*.e2e.test.ts"],
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
  },
});
