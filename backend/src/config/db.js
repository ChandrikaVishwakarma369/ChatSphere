
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

//for debugging purpose
// console.log("Prisma Notification Model:", !!prisma.notification);

const dbConnect = async () => {
  try {
    await prisma.$connect();
    console.log("Connected to PostgreSQL successfully on port 5432");
  } catch (error) {
    console.error("PostgreSQL connection error:", error);
    process.exit(1);
  }
};

module.exports = { prisma, dbConnect };
