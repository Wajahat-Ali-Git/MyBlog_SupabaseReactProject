/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/react') ||
            id.includes('node_modules/react-dom') ||
            id.includes('react-router-dom')
          ) {
            return 'react';
          }

          if (
            id.includes('node_modules/@mui') ||
            id.includes('node_modules/@emotion')
          ) {
            return 'mui';
          }

          if (id.includes('node_modules/@supabase')) {
            return 'supabase';
          }
        },
      },
    },
  },
})
