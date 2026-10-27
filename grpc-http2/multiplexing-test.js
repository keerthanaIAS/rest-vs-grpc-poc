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

function add(a, b) {
  return new Promise((resolve, reject) => {
    client.Add({ a, b }, (error, response) => {
      if (error) return reject(error);
      resolve(response.result);
    });
  });
}

async function main() {
  const count = 1000;
  const start = performance.now();

  try {
    const results = await Promise.all(
      Array.from({ length: count }, (_, i) => add(i, 1))
    );

    const failures = results.filter((result, i) => result !== i + 1);

    console.log("Total RPCs:", count);
    console.log("Successful:", results.length - failures.length);
    console.log("Incorrect results:", failures.length);
    console.log("Elapsed ms:", (performance.now() - start).toFixed(2));
  } finally {
    client.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
