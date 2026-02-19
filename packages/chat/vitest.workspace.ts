import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
	{
		extends: "vitest.config.ts",
		test: {
			name: "client",
			environment: "happy-dom",
			include: ["src/client/**/__tests__/**/*.{test,spec}.{ts,tsx}"],
		},
	},
	{
		extends: "vitest.config.ts",
		test: {
			name: "server",
			environment: "node",
			include: ["src/server/**/__tests__/**/*.{test,spec}.{ts,tsx}"],
		},
	},
]);
