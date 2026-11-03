const controller = require("../controllers/user.controller");

async function userRoutes(fastify) {
  fastify.get("/users", controller.getUsers);
  fastify.post("/users", controller.createUser);
}

module.exports = userRoutes;