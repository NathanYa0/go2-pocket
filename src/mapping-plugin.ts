import type { Plugin } from 'vite';
// @ts-expect-error The shared Node service is also exercised directly by node:test.
import { createMappingService } from '../scripts/mapping-service.mjs';

export function mappingPlugin(): Plugin {
  return {
    name: 'pocket-mapping',
    configureServer(server) {
      const service = createMappingService({ root: server.config.root });
      server.middlewares.use(service.middleware);
      server.httpServer?.once('close', service.close);
      process.once('SIGTERM', service.close);
      process.once('SIGINT', service.close);
    },
    configurePreviewServer(server) {
      const service = createMappingService({ root: server.config.root });
      server.middlewares.use(service.middleware);
      server.httpServer.once('close', service.close);
      process.once('SIGTERM', service.close);
      process.once('SIGINT', service.close);
    },
  };
}
