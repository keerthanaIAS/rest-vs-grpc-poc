
const Fastify = require("fastify");
const cors = require("@fastify/cors");
const axios = require("axios");

const app = Fastify({ logger: true });

app.register(cors, { origin: "http://localhost:3000" });

const TRANSACTION_URL =
  process.env.TRANSACTION_SERVICE_URL || "http://localhost:4003";

let payments = [
  { id: 1, userId: 1, amount: 500, status: "SUCCESS" },
  { id: 2, userId: 2, amount: 1000, status: "PENDING" }
];

app.get("/payments", async () => {
  return {
    success: true,
    data: payments
  };
});

app.post("/transfer", async (request, reply) => {
  const { userId, amount } = request.body || {};

  if (!userId || !Number.isFinite(amount) || amount <= 0) {
    return reply.code(400).send({
      success: false,
      message: "Valid userId and positive amount are required"
    });
  }

  try {
    // Payment Server calls Transaction Server using REST.
    const transactionResponse = await axios.post(
      `${TRANSACTION_URL}/transactions`,
      {
        userId,
        amount,
        type: "FUND_TRANSFER"
      },
      { timeout: 5000 }
    );

    const payment = {
      id: Date.now(),
      userId,
      amount,
      status: "ACCEPTED",
      transactionId: transactionResponse.data.data.id
    };

    payments.push(payment);

    return reply.code(201).send({
      success: true,
      message: "Payment initiated",
      data: payment
    });
  } catch (error) {
    request.log.error(error);

    return reply.code(502).send({
      success: false,
      message: "Transaction service unavailable"
    });
  }
});

async function start() {
  try {
    await app.listen({ port: 4002, host: "0.0.0.0" });
    console.log("Payment Server running on port 4002");
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
