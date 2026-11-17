import { prisma } from "../src/lib/db";
import { seedDatabase } from "../src/lib/seed";

seedDatabase({ reset: true })
  .then((summary) => {
    console.log("Seeded RELAY demo data:", summary);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
