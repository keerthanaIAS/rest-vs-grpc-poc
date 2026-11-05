
const Fastify = require("fastify");
const cors = require("@fastify/cors");

const app = Fastify({ logger: true });

app.register(cors, { origin: "http://localhost:3000" });

let transactions = [
  { id: "TXN-1001", userId: 1, amount: 500, type: "FUND_TRANSFER", status: "SUCCESS" },
  { id: "TXN-1002", userId: 2, amount: 1000, type: "FUND_TRANSFER", status: "PENDING" }
];

app.get("/transactions", async () => {
  return {
    success: true,
    data: transactions
  };
});

app.post("/transactions", async (request, reply) => {
  const { userId, amount, type } = request.body || {};

  if (!userId || !Number.isFinite(amount) || amount <= 0 || !type) {
    return reply.code(400).send({
      success: false,
      message: "Invalid transaction details"
    });
  }

  const transaction = {
    id: `TXN-${Date.now()}`,
    userId,
    amount,
    type,
    status: "PENDING"
  };

  transactions.push(transaction);

  return reply.code(201).send({
    success: true,
    message: "Transaction created",
    data: transaction
  });
});

async function start() {
  try {
    await app.listen({ port: 4003, host: "0.0.0.0" });
    console.log("Transaction Server running on port 4003");
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
