const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { performance } = require("node:perf_hooks");

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

const start = performance.now();

client.Add({ a: 10, b: 20 }, (error, response) => {
  if (error) {
    console.error("gRPC error:", error.message);
  } else {
    console.log("Result:", response.result);
    console.log(
      "Round-trip time:",
      (performance.now() - start).toFixed(2),
      "ms"
    );
  }

  client.close();
});