import { defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "cloudflare-screenshot",
		compatibilityDate: "2025-02-04",
		entrypoint: "src/index.ts",
		observability: {
			enabled: true,
		},
	},
});
