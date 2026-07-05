import { defineConfig } from "vite";
import { resolve } from "node:path";

const OWLBEAR_ORIGIN = "https://www.owlbear.rodeo";

function owlBearLocalCors() {
  return {
    name: "owlbear-local-cors",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        res.setHeader("Access-Control-Allow-Origin", OWLBEAR_ORIGIN);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Access-Control-Allow-Private-Network", "true");

        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [owlBearLocalCors()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    cors: {
      origin: OWLBEAR_ORIGIN,
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        background: resolve(__dirname, "background.html"),
      },
    },
  },
});
