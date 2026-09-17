import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages はサブパス配信になるため、base を合わせておく必要がある。
  // これが無いと公開 URL でアセットが 404 になり、画面が真っ白になる。
  base: '/kansen-game/',
  plugins: [react()],
  server: { host: true },
});
