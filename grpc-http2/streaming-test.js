
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const definition = protoLoader.loadSync("calculator.proto", {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const calculator = grpc.loadPackageDefinition(definition).calculator;
const client = new calculator.Calculator(
  "127.0.0.1:3003",
  grpc.credentials.createInsecure()
);

// Unary: the client waits for one response.
// Server streaming: the client receives five separate messages for one request.
// Client streaming: the server receives three messages and returns one final result.
// Bidirectional streaming: both sides can exchange multiple messages independently while the stream remains open.

function unary() {
  return new Promise((resolve, reject) => {
    client.Add({ a: 10, b: 20 }, (err, response) => {
      if (err) return reject(err);
      console.log("1. Unary result:", response.result);
      resolve();
    });
  });
}

function serverStreaming() {
  return new Promise((resolve, reject) => {
    const call = client.CountUp({ start: 1, end: 5 });

    call.on("data", response => {
      console.log("2. Server stream:", response.number);
    });

    call.on("error", reject);
    call.on("end", resolve);
  });
}

function clientStreaming() {
  return new Promise((resolve, reject) => {
    const call = client.Sum((err, response) => {
      if (err) return reject(err);
      console.log("3. Client stream sum:", response.result);
      resolve();
    });

    [10, 20, 30].forEach(number => call.write({ number }));
    call.end();
  });
}

function bidirectionalStreaming() {
  return new Promise((resolve, reject) => {
    const call = client.RunningSum();

    call.on("data", response => {
      console.log("4. Running total:", response.result);
    });

    call.on("error", reject);
    call.on("end", resolve);

    [10, 20, 30].forEach(number => call.write({ number }));
    call.end();
  });
}

async function main() {
  try {
    await unary();
    await serverStreaming();
    await clientStreaming();
    await bidirectionalStreaming();
    console.log("All four RPC patterns passed.");
  } catch (error) {
    console.error("RPC failed:", error.message);
    process.exitCode = 1;
  } finally {
    client.close();
  }
}

main();
