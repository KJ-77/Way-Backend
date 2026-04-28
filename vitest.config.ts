import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Look for test files anywhere under src/
    include: ["src/**/*.test.ts"],
  },
})
