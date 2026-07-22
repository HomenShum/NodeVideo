import nodekitCaseflow from '@homenshum/nodekit/convex.config.js';
import { defineApp } from 'convex/server';

const app = defineApp();

// NodeKit owns its lifecycle tables inside an isolated component namespace.
// NodeVideo owns auth, projects, media, workers, and domain records.
app.use(nodekitCaseflow);

export default app;
