import { defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "cloudflare-ogp",
		compatibilityDate: "2025-02-04",
		entrypoint: "src/index.tsx",
		observability: {
			enabled: true,
		},
	},
});
