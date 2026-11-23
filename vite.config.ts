import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // Build and packaging tools briefly lock these outputs on Windows.
      ignored: ['**/src-tauri/target/**', '**/.tauri-*-target/**', '**/releases/**', '**/zixi.exe'],
    },
  },
})
