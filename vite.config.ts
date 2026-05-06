import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist/build',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        content: resolve(__dirname, 'src/content/content.ts'),
        background: resolve(__dirname, 'src/background/background.ts'),
        options: resolve(__dirname, 'options/options.ts')
      },
      output: {
        entryFileNames: '[name].js'
      }
    }
  }
});
