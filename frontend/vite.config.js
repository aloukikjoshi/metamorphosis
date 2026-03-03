import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/gateway": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
    },
  },
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      crypto: 'crypto-browserify',
      buffer: 'buffer',
      process: 'process',
      util: 'util',
    },
  },
  optimizeDeps: {
    include: [
      '@polkadot/api',
      '@polkadot/types',
      '@storagehub-sdk/core',
      '@storagehub-sdk/msp-client',
      'crypto-browserify',
      'buffer',
      'util',
    ],
    exclude: ['process'],
  },
});
