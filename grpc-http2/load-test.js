const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const { performance } = require("node:perf_hooks");

const total = Number(process.argv[2] || 1000);
const concurrency = Number(process.argv[3] || 20);

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

const latencies = [];
let success = 0;
let errors = 0;
let completed = 0;
const start = performance.now();

function request() {
  return new Promise(resolve => {
    const requestStart = performance.now();

    client.Add({ a: 10, b: 20 }, (error, response) => {
      latencies.push(performance.now() - requestStart);

      if (error || response.result !== 30) {
        errors++;
      } else {
        success++;
      }

      completed++;
      resolve();
    });
  });
}

async function worker(count) {
  for (let i = 0; i < count; i++) {
    await request();
  }
}

async function main() {
  const base = Math.floor(total / concurrency);
  const remainder = total % concurrency;

  await Promise.all(
    Array.from({ length: concurrency }, (_, i) =>
      worker(base + (i < remainder ? 1 : 0))
    )
  );

  const elapsed = (performance.now() - start) / 1000;
  latencies.sort((a, b) => a - b);

  const percentile = p =>
    latencies[Math.min(Math.ceil(p * latencies.length) - 1,
      latencies.length - 1)];

  console.log("\n--- gRPC / HTTP/2 RESULTS ---");
  console.log("Total requests:", total);
  console.log("Successful responses:", success);
  console.log("Errors:", errors);
  console.log("Elapsed seconds:", elapsed.toFixed(2));
  console.log("Throughput:", (completed / elapsed).toFixed(2), "requests/sec");
  console.log(
    "Average latency:",
    (latencies.reduce((sum, t) => sum + t, 0) / latencies.length).toFixed(2),
    "ms"
  );
  console.log("p95 latency:", percentile(0.95).toFixed(2), "ms");
  console.log("p99 latency:", percentile(0.99).toFixed(2), "ms");

  client.close();
}

main().catch(error => {
  console.error(error);
  client.close();
});