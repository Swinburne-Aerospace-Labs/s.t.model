import process from 'node:process';
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import satelliteHandler from './api/satellites.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), 'SPACE_TRACK_'));
  return {
  plugins: [react(), {
    name: 'satellite-api',
    configureServer(server) {
      server.middlewares.use('/api/satellites', (req, res) => {
        res.status = code => { res.statusCode = code; return res; };
        res.json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
        satelliteHandler(req, res);
      });
    }
  }],
  server: {
    proxy: {
      '/api-celestrak': {
        target: 'https://celestrak.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-celestrak/, '')
      },
      '/api-amsat': {
        target: 'https://www.amsat.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-amsat/, '')
      }
    }
  }
  }
})
