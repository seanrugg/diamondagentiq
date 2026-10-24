#!/usr/bin/env tsx
/** npm start: serve the web page and API on 127.0.0.1 (DIQ_PORT, default 8787). */
import { startServer } from "../server.js";

// One Ctrl+C (SIGINT) or `docker stop` (SIGTERM) exits right away. In a container
// the app runs as process 1, which ignores these signals unless it handles them.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\nDiamondAgentIQ stopped (${signal}).`);
    process.exit(0);
  });
}

startServer();
