import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/pipeline' });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding test database...');

  // 1. Seed Sources
  const arxiv = await prisma.source.upsert({
    where: { name: 'arxiv' },
    update: {},
    create: { name: 'arxiv' },
  });

  const pubmed = await prisma.source.upsert({
    where: { name: 'pubmed' },
    update: {},
    create: { name: 'pubmed' },
  });

  // 2. Seed a mock author
  const author = await prisma.author.upsert({
    where: { name: 'Test Author' },
    update: {},
    create: { name: 'Test Author' },
  });

  // 3. Seed a mock paper with an embedding
  const paper = await prisma.paper.upsert({
    where: { url: 'https://arxiv.org/abs/0000.00000' },
    update: {},
    create: {
      title: 'Test Quantum Paper',
      abstract: 'This is a seeded test paper.',
      url: 'https://arxiv.org/abs/0000.00000',
      sourceId: arxiv.id,
      embeddingStatus: 'GENERATED',
      authors: {
        create: [{ authorId: author.id }]
      }
    },
  });

  // 4. Update the vector manually using raw SQL (Prisma doesn't support pgvector inserts in create)
  const vectorStr = `[${Array(768).fill(0.1).join(',')}]`;
  await prisma.$executeRawUnsafe(
    `UPDATE "Paper" SET "embedding" = $1::vector WHERE "id" = $2`,
    vectorStr,
    paper.id
  );

  console.log('Test database seeded successfully.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    throw e;
  });
