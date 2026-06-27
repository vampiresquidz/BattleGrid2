import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, open: false },
  build: { target: 'es2022' },
  // Solana/Metaplex web3 libs expect Node globals in the browser
  define: { global: 'globalThis' },
});
