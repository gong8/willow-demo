import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			// Only measure coverage for JS/TS files in this package if there are any,
			// excluding auto-generated NAPI bindings.
			exclude: ["index.js", "index.d.ts", "**/*.test.ts"],
		},
	},
});
