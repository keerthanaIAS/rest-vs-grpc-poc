const { performance } = require("node:perf_hooks");

async function main() {
  const start = performance.now();

  const response = await fetch("http://localhost:3002/add", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ a: 10, b: 20 })
  });

  const data = await response.json();
  const elapsed = performance.now() - start;

  console.log("HTTP status:", response.status);
  console.log("Response:", data);
  console.log("Round-trip time:", elapsed.toFixed(2), "ms");
}

main().catch(console.error);