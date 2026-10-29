
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
const server = new grpc.Server();

server.addService(calculator.Calculator.service, {
  // Unary
  Add: (call, callback) => {
    callback(null, {
      result: call.request.a + call.request.b
    });
  },

  // Server streaming
  CountUp: call => {
    const { start, end } = call.request;

    if (end < start || end - start > 1000) {
      call.emit("error", {
        code: grpc.status.INVALID_ARGUMENT,
        details: "Invalid range"
      });
      return;
    }

    for (let n = start; n <= end; n++) {
      if (call.cancelled) return;
      call.write({ number: n });
    }

    call.end();
  },

  // Client streaming
  Sum: (call, callback) => {
    let total = 0;

    call.on("data", request => {
      total += request.number;
    });

    call.on("end", () => {
      callback(null, { result: total });
    });
  },

  // Bidirectional streaming
  RunningSum: call => {
    let total = 0;

    call.on("data", request => {
      total += request.number;
      call.write({ result: total });
    });

    call.on("end", () => {
      call.end();
    });
  }
});

server.bindAsync(
  "127.0.0.1:3003",
  grpc.ServerCredentials.createInsecure(),
  (error, port) => {
    if (error) throw error;
    console.log(`gRPC server listening on 127.0.0.1:${port}`);
  }
);
