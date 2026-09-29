import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "axon-development-csp",
      transformIndexHtml(html, context) {
        // Only the local HMR preamble needs inline script; packaged CSP stays strict.
        return context.server
          ? html.replace(
              "script-src 'self'",
              "script-src 'self' 'unsafe-inline'",
            )
          : html;
      },
    },
  ],
  base: "./",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        "**/artifacts/**",
        "**/release/**",
        "**/.npm-cache/**",
        "**/.electron-cache/**",
        "**/.builder-cache/**",
      ],
    },
  },
  build: { target: "es2022" },
});
