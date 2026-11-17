import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/** Prisma 7: the URL lives here for the migrate CLI; the app passes it to the driver adapter. */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? 'file:./data/sidecarmaster.db' },
});
