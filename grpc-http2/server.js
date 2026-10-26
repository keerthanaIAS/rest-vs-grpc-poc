const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const packageDefinition = protoLoader.loadSync("calculator.proto", {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const calculator = grpc.loadPackageDefinition(packageDefinition).calculator;
const server = new grpc.Server();

server.addService(calculator.Calculator.service, {
  Add: (call, callback) => {
    const { a, b } = call.request;

    callback(null, { result: a + b });
  }
});

server.bindAsync(
  "127.0.0.1:3003",
  grpc.ServerCredentials.createInsecure(),
  (error, port) => {
    if (error) throw error;
    console.log(`gRPC Service 2 listening on 127.0.0.1:${port}`);
  }
);
