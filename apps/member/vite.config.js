import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The member surface runs on its own port so it can be demoed side by side
// with the console on a phone-sized window.
export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5003 },
  preview: { port: 5003 },
});
