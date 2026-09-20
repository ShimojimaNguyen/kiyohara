import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

// TanStack Start 1.168 chạy qua Vite plugin (không còn vinxi).
export default defineConfig({
  server: { host: "0.0.0.0", port: 8080 },
  plugins: [tailwindcss(), tanstackStart(), viteReact()],
});
