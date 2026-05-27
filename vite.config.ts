import { defineConfig } from 'vite';

// GitHub Pages serves project sites at /<repo-name>/
export default defineConfig({
  base: '/brott-island/',
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
});
