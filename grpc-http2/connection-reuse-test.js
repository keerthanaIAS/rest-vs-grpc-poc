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
  try {
    const start = performance.now();

    for (let i = 1; i <= 10; i++) {
      const result = await add(i, i);
      console.log(`RPC ${i}: result=${result}`);
    }

    console.log(`Completed 10 sequential RPCs in ${(performance.now() - start).toFixed(2)} ms`);
  } finally {
    client.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
