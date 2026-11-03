const db = require("../data");

async function getUsers(request, reply) {
  return reply.send(db.users);
}

async function createUser(request, reply) {
  const { name, email } = request.body || {};
  if (!name || !email) {
    return reply.code(400).send({ message: "name and email are required" });
  }
  const user = { id: db.nextId++, name, email };
  db.users.push(user);
  return reply.code(201).send(user);
}

module.exports = { getUsers, createUser };