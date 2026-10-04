import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vitest/config';

// `--mode lan` serves over HTTPS on all interfaces: WebGPU needs a secure context, which a plain
// http:// LAN address is not.
export default defineConfig(({ mode }) => ({
  plugins: mode === 'lan' ? [basicSsl()] : [],
  server: mode === 'lan' ? { host: true } : {},
  preview: mode === 'lan' ? { host: true } : {},
  test: { include: ['test/**/*.test.ts'] },
}));
