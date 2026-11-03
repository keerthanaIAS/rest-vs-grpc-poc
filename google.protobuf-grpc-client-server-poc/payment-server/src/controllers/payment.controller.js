const db = require("../data");

async function getPayments(request, reply) {
  return reply.send(db.payments);
}

async function createTransfer(request, reply) {
  const { amount, currency = "INR" } = request.body || {};
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return reply.code(400).send({ message: "amount must be a positive number" });
  }
  const payment = { id: db.nextId++, amount, currency, status: "COMPLETED" };
  db.payments.push(payment);
  return reply.code(201).send(payment);
}

module.exports = { getPayments, createTransfer };