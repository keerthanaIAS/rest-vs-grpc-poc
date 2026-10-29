
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const fs = require("fs");
const path = require("path");

// =====================================================
// 1. PROTOBUF CONTRACT
// =====================================================

const PROTO_PATH = path.join(__dirname, "calculate.proto");

const proto = `
syntax = "proto3";

package calculator;

service Calculator {
  // Unary: one request, one response
  rpc Add(AddRequest) returns (AddResponse);

  // Client streaming: multiple requests, one response
  rpc AddStream(stream AddRequest) returns (AddResponse);

  // Server streaming: one request, multiple responses
  rpc Count(CountRequest) returns (stream CountResponse);

  // Bidirectional streaming: multiple requests and responses
  rpc Chat(stream ChatRequest) returns (stream ChatResponse);
}

message AddRequest {
  int32 a = 1;
  int32 b = 2;
}

message AddResponse {
  int32 result = 1;
}

message CountRequest {
  int32 count = 1;
}

message CountResponse {
  int32 number = 1;
}

message ChatRequest {
  string message = 1;
}

message ChatResponse {
  string reply = 1;
}
`;

fs.writeFileSync(PROTO_PATH, proto);

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const calculatorProto = grpc.loadPackageDefinition(
  packageDefinition
).calculator;

// =====================================================
// 2. SERVICE 2: gRPC SERVER
// =====================================================

const SERVER_ADDRESS = "127.0.0.1:3003";

function add(call, callback) {
  const { a, b } = call.request;

  console.log(`Service 2: Add(${a}, ${b})`);

  callback(null, {
    result: a + b,
  });
}

// Client streaming
function addStream(call, callback) {
  let total = 0;
  let requestCount = 0;

  call.on("data", (request) => {
    total += request.a + request.b;
    requestCount++;

    console.log(
      `Service 2 received request ${requestCount}:`,
      request.a,
      "+",
      request.b
    );
  });

  call.on("end", () => {
    console.log("Client streaming completed");

    callback(null, {
      result: total,
    });
  });

  call.on("error", (error) => {
    console.log("Client stream error:", error.message);
  });
}

// Server streaming
function count(call) {
  const requestedCount = call.request.count;

  console.log(
    `Service 2 sending ${requestedCount} responses`
  );

  for (let i = 1; i <= requestedCount; i++) {
    if (call.cancelled) {
      console.log("Client cancelled server stream");
      return;
    }

    call.write({
      number: i,
    });
  }

  call.end();
}

// Bidirectional streaming
function chat(call) {
  call.on("data", (request) => {
    console.log("Service 2 received:", request.message);

    call.write({
      reply: `Service 2 received: ${request.message}`,
    });
  });

  call.on("end", () => {
    console.log("Bidirectional stream completed");
    call.end();
  });

  call.on("error", (error) => {
    console.log("Chat error:", error.message);
  });
}

function startServer() {
  const server = new grpc.Server();

  server.addService(calculatorProto.Calculator.service, {
    Add: add,
    AddStream: addStream,
    Count: count,
    Chat: chat,
  });

  server.bindAsync(
    SERVER_ADDRESS,
    grpc.ServerCredentials.createInsecure(),
    (error, port) => {
      if (error) {
        console.error("Server startup failed:", error);
        process.exit(1);
      }

      console.log(
        `Service 2 running at ${SERVER_ADDRESS} port ${port}`
      );
    }
  );

  return server;
}

// =====================================================
// 3. SERVICE 1: gRPC CLIENT
// =====================================================

const client = new calculatorProto.Calculator(
  SERVER_ADDRESS,
  grpc.credentials.createInsecure(),
  {
    "grpc.keepalive_time_ms": 10000,
    "grpc.keepalive_timeout_ms": 5000,
    "grpc.keepalive_permit_without_calls": 1,
  }
);

// =====================================================
// 4. UNARY CALL
// =====================================================

function unaryCall() {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    client.Add(
      {
        a: 10,
        b: 20,
      },
      {
        deadline: Date.now() + 5000,
      },
      (error, response) => {
        if (error) {
          return reject(error);
        }

        console.log("\n--- UNARY ---");

        console.log("Request: 10 + 20");
        console.log("Response:", response.result);
        console.log("Duration:", Date.now() - start, "ms");

        resolve();
      }
    );
  });
}

// =====================================================
// 5. CONNECTION REUSE
// =====================================================

function connectionReuse() {
  return new Promise((resolve, reject) => {
    console.log("\n--- CONNECTION REUSE ---");

    let completed = 0;
    const totalRequests = 5;

    const start = Date.now();

    for (let i = 1; i <= totalRequests; i++) {
      client.Add(
        {
          a: i,
          b: i,
        },
        (error, response) => {
          if (error) {
            return reject(error);
          }

          console.log(
            `Request ${i}: result=${response.result}`
          );

          completed++;

          if (completed === totalRequests) {
            console.log(
              "Completed requests:",
              completed
            );

            console.log(
              "Elapsed:",
              Date.now() - start,
              "ms"
            );

            console.log(
              "All calls use the same gRPC client/channel"
            );

            resolve();
          }
        }
      );
    }
  });
}

// =====================================================
// 6. MULTIPLEXING
// =====================================================

function multiplexing() {
  return new Promise((resolve, reject) => {
    console.log("\n--- MULTIPLEXING ---");

    const requests = [];

    const start = Date.now();

    for (let i = 1; i <= 10; i++) {
      requests.push(
        new Promise((resolveRequest, rejectRequest) => {
          client.Add(
            {
              a: i,
              b: 100,
            },
            (error, response) => {
              if (error) {
                return rejectRequest(error);
              }

              resolveRequest(response.result);
            }
          );
        })
      );
    }

    Promise.all(requests)
      .then((results) => {
        console.log("Results:", results);

        console.log(
          "Completed:",
          results.length,
          "concurrent RPCs"
        );

        console.log(
          "Elapsed:",
          Date.now() - start,
          "ms"
        );

        console.log(
          "Multiple RPCs share the HTTP/2 connection"
        );

        resolve();
      })
      .catch(reject);
  });
}

// =====================================================
// 7. CLIENT STREAMING
// =====================================================

function clientStreaming() {
  return new Promise((resolve, reject) => {
    console.log("\n--- CLIENT STREAMING ---");

    const call = client.AddStream(
      {
        deadline: Date.now() + 5000,
      },
      (error, response) => {
        if (error) {
          return reject(error);
        }

        console.log(
          "Server received multiple requests"
        );

        console.log(
          "Final total:",
          response.result
        );

        resolve();
      }
    );

    call.write({
      a: 10,
      b: 20,
    });

    call.write({
      a: 30,
      b: 40,
    });

    call.write({
      a: 50,
      b: 60,
    });

    call.end();
  });
}

// =====================================================
// 8. SERVER STREAMING
// =====================================================

function serverStreaming() {
  return new Promise((resolve, reject) => {
    console.log("\n--- SERVER STREAMING ---");

    const call = client.Count({
      count: 5,
    });

    call.on("data", (response) => {
      console.log(
        "Received:",
        response.number
      );
    });

    call.on("end", () => {
      console.log("Server stream completed");
      resolve();
    });

    call.on("error", reject);
  });
}

// =====================================================
// 9. BIDIRECTIONAL STREAMING
// =====================================================

function bidirectionalStreaming() {
  return new Promise((resolve, reject) => {
    console.log("\n--- BIDIRECTIONAL STREAMING ---");

    const call = client.Chat();

    const messages = [
      "Hello",
      "How are you?",
      "Explain gRPC",
    ];

    let received = 0;

    call.on("data", (response) => {
      console.log(
        "Client received:",
        response.reply
      );

      received++;
    });

    call.on("end", () => {
      console.log("Chat completed");
      resolve();
    });

    call.on("error", reject);

    for (const message of messages) {
      call.write({
        message,
      });
    }

    call.end();
  });
}

// =====================================================
// 10. ERROR HANDLING
// =====================================================

function errorHandling() {
  return new Promise((resolve) => {
    console.log("\n--- ERROR HANDLING ---");

    client.Add(
      {
        a: 10,
        b: 20,
      },
      {
        deadline: Date.now() + 5000,
      },
      (error, response) => {
        if (error) {
          console.log(
            "RPC failed:",
            error.message
          );

          console.log(
            "Error code:",
            error.code
          );

          return resolve();
        }

        console.log(
          "RPC succeeded:",
          response.result
        );

        resolve();
      }
    );
  });
}

// =====================================================
// 11. DEADLINE AND TIMEOUT
// =====================================================

function deadlineTimeout() {
  return new Promise((resolve) => {
    console.log("\n--- DEADLINE / TIMEOUT ---");

    const call = client.Add(
      {
        a: 10,
        b: 20,
      },
      {
        deadline: Date.now() - 1000,
      },
      (error, response) => {
        if (error) {
          console.log(
            "Request failed:",
            error.message
          );

          console.log(
            "Status:",
            error.code === grpc.status.DEADLINE_EXCEEDED
              ? "DEADLINE_EXCEEDED"
              : error.code
          );

          return resolve();
        }

        console.log(
          "Response:",
          response.result
        );

        resolve();
      }
    );

    call.on("error", (error) => {
      console.log(
        "Call error:",
        error.message
      );
    });
  });
}

// =====================================================
// 12. SECURITY AND DEPLOYMENT
// =====================================================

function securityInfo() {
  console.log("\n--- SECURITY / DEPLOYMENT ---");

  console.log("Protocol: HTTP/2");
  console.log("Serialization: Protobuf");
  console.log("Transport: TCP");
  console.log("Client authentication: Not enabled");
  console.log("TLS: Not enabled");
  console.log("Deployment: Local learning POC");

  console.log(
    "Production should use TLS or mTLS credentials"
  );

  console.log(
    "Production should validate client identity"
  );

  console.log(
    "Production should configure server certificates"
  );

  console.log(
    "Production should use Kubernetes Service DNS"
  );
}

// =====================================================
// 13. RUN ALL CONCEPTS
// =====================================================

async function main() {
  console.log("=================================");
  console.log("gRPC COMPLETE LEARNING POC");
  console.log("=================================");

  const server = startServer();

  // Wait for server initialization.
  await new Promise((resolve) => {
    setTimeout(resolve, 500);
  });

  try {
    await unaryCall();

    await connectionReuse();

    await multiplexing();

    await clientStreaming();

    await serverStreaming();

    await bidirectionalStreaming();

    await errorHandling();

    await deadlineTimeout();

    securityInfo();

    console.log("\n=================================");
    console.log("ALL CONCEPTS COMPLETED");
    console.log("=================================");
  } catch (error) {
    console.error("POC failed:", error);
  } finally {
    client.close();

    server.tryShutdown(() => {
      console.log("Server shutdown completed");
    });
  }
}

main();
