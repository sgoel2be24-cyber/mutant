import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Kept separate so `vitest` never depends on the app build config.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
