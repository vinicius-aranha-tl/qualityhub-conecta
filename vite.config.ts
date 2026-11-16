import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

export default defineConfig(({ command }) => ({
  server: { host: "127.0.0.1", port: 8080, proxy: { "/backend": { target: process.env["BACKEND_URL"] ?? "http://127.0.0.1:5080", changeOrigin: true, rewrite: (path) => path.replace(/^\/backend/, "") } } },
  resolve: { dedupe: ["react", "react-dom", "@tanstack/react-query", "@tanstack/query-core"] },
  plugins: [
    tailwindcss(), tsconfigPaths(),
    tanstackStart({ server: { entry: "server" } }),
    ...(command === "build" ? [nitro({ defaultPreset: "vercel" })] : []),
    react(),
  ],
}));
