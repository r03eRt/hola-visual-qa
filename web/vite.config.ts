import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Isolated SPA build config (docs/features/dashboard-web-ui/SPEC.md). `base:
// '/app/'` so emitted asset URLs match the dashboard's static-server mount
// point. `modulePreload: false` avoids Vite injecting an inline bootstrap
// `<script>` into index.html, which would violate the strict
// `Content-Security-Policy: default-src 'self'` served by the dashboard.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    modulePreload: false
  }
});
