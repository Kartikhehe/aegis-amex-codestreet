import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The simulator runs beside the console (5002) and the member app (5003) so
// all three surfaces can be shown at once: an agent buys, the console sees the
// decision, the member answers it.
export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5004 },
  preview: { port: 5004 },
});
