const controller = require("../controllers/payment.controller");

async function paymentRoutes(fastify) {
  fastify.get("/payments", controller.getPayments);
  fastify.post("/transfer", controller.createTransfer);
}

module.exports = paymentRoutes;