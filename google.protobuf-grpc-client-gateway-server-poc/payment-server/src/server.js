
const Fastify = require("fastify");
const cors = require("@fastify/cors");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");

const paymentRoutes = require("./routes/payment.routes");

const PROTO_PATH = path.resolve(
  __dirname,
  "../../shared/bridge.proto"
);

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  includeDirs: [
    path.resolve(process.cwd(), "node_modules/google-proto-files")
  ],
  keepCase: false,
  defaults: true,
  oneofs: true
});

const proto = grpc.loadPackageDefinition(packageDefinition).bridge;

// Convert JavaScript values into Protobuf Struct values.
function toValue(value) {
  if (value === null || value === undefined) {
    return { nullValue: 0 };
  }

  if (typeof value === "string") {
    return { stringValue: value };
  }

  if (typeof value === "number") {
    return { numberValue: value };
  }

  if (typeof value === "boolean") {
    return { boolValue: value };
  }

  if (Array.isArray(value)) {
    return {
      listValue: {
        values: value.map(toValue)
      }
    };
  }

  return {
    structValue: toStruct(value)
  };
}

function toStruct(object) {
  const fields = {};

  for (const [key, value] of Object.entries(object || {})) {
    fields[key] = toValue(value);
  }

  return { fields };
}

// Convert Protobuf Struct values back into JavaScript.
function fromValue(value) {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.numberValue !== undefined) return value.numberValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.nullValue !== undefined) return null;

  if (value.structValue) {
    return fromStruct(value.structValue);
  }

  if (value.listValue) {
    return value.listValue.values.map(fromValue);
  }

  return null;
}

function fromStruct(struct) {
  const result = {};

  for (const [key, value] of Object.entries(struct.fields || {})) {
    result[key] = fromValue(value);
  }

  return result;
}

async function start() {
  const app = Fastify({ logger: true });

  // Existing CORS configuration.
  await app.register(cors, {
    origin: "http://localhost:3000"
  });

  // Existing payment routes. No route changes.
  await app.register(paymentRoutes);

  // Create generic gRPC server.
  const grpcServer = new grpc.Server();

  grpcServer.addService(proto.ApiBridge.service, {
    Forward: async (call, callback) => {
      try {
        const request = fromStruct(call.request.data);

        app.log.info(
          { request },
          "Payment gRPC request received"
        );

        if (request.service !== "payment") {
          return callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: "Invalid service"
          });
        }

        const method = request.method.toUpperCase();

        const result = await app.inject({
          method,
          url: request.url,
          headers: request.headers || {},
          ...(method !== "GET" && method !== "HEAD"
            ? { payload: request.payload || {} }
            : {})
        });

        let body;

        try {
          body = result.json();
        } catch {
          body = { raw: result.body };
        }

        callback(null, {
          status: result.statusCode,
          data: toStruct({ body })
        });

      } catch (error) {
        app.log.error(error);

        callback({
          code: grpc.status.INTERNAL,
          message: error.message
        });
      }
    }
  });

  // Start gRPC server on port 5002.
  grpcServer.bindAsync(
    "0.0.0.0:5002",
    grpc.ServerCredentials.createInsecure(),
    () => {
      console.log("Payment gRPC server running on port 5002");
    }
  );

  // Keep existing REST server on port 4002.
  await app.listen({
    port: 4002,
    host: "0.0.0.0"
  });
}

start().catch(error => {
  console.error(error);
  process.exit(1);
});
