import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // Rust links DLLs atomically on Windows; watching target can crash Vite with EBUSY.
      ignored: ['**/src-tauri/target/**', '**/.tauri-*-target/**'],
    },
  },
})
