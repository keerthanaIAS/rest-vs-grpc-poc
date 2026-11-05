
const Fastify = require("fastify");
const cors = require("@fastify/cors");

const app = Fastify({ logger: true });

app.register(cors, { origin: "http://localhost:3000" });

let users = [
  { id: 1, name: "Arun", email: "arun@example.com" },
  { id: 2, name: "Priya", email: "priya@example.com" }
];

app.get("/users", async () => {
  return {
    success: true,
    data: users
  };
});

app.post("/users", async (request, reply) => {
  const { name, email } = request.body || {};

  if (!name || !email) {
    return reply.code(400).send({
      success: false,
      message: "Name and email are required"
    });
  }

  const user = {
    id: Date.now(),
    name,
    email
  };

  users.push(user);

  return reply.code(201).send({
    success: true,
    data: user
  });
});

async function start() {
  try {
    await app.listen({ port: 4001, host: "0.0.0.0" });
    console.log("User Server running on port 4001");
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
