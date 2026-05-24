import { defineConfig } from '@prisma/config';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export default defineConfig({
  earlyAccess: true,
  schema: "prisma/schema.prisma",
  migrations: "prisma/migrations",
  migrate: {
    url: process.env["POSTGRES_URL"] || "postgresql://postgres:postgres@localhost:5432/pipeline",
  },
  studio: {
    url: process.env["POSTGRES_URL"] || "postgresql://postgres:postgres@localhost:5432/pipeline",
  },
  introspect: {
    url: process.env["POSTGRES_URL"] || "postgresql://postgres:postgres@localhost:5432/pipeline",
  },
  datasource: {
    url: process.env["POSTGRES_URL"] || "postgresql://postgres:postgres@localhost:5432/pipeline",
  },
});
