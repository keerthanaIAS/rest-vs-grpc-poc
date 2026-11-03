const Fastify = require("fastify");
const cors = require("@fastify/cors");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");

const userRoutes = require("./routes/user.routes");

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

// Convert ordinary JavaScript values into Protobuf Struct values.
function toValue(value) {
  if (value === null || value === undefined) {
    return { nullValue: 0 };
  }

  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return { numberValue: value };
  if (typeof value === "boolean") return { boolValue: value };

  if (Array.isArray(value)) {
    return {
      listValue: {
        values: value.map(toValue)
      }
    };
  }

  return { structValue: toStruct(value) };
}

function toStruct(object) {
  const fields = {};

  for (const [key, value] of Object.entries(object || {})) {
    fields[key] = toValue(value);
  }

  return { fields };
}

function fromValue(value) {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.numberValue !== undefined) return value.numberValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.nullValue !== undefined) return null;

  if (value.structValue) return fromStruct(value.structValue);

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

  await app.register(cors, {
    origin: "http://localhost:3000"
  });

  // Existing routes: unchanged.
  await app.register(userRoutes);

  // Generic gRPC server.
  const grpcServer = new grpc.Server();

  grpcServer.addService(proto.ApiBridge.service, {
    forward: async (call, callback) => {
      try {
        console.log("Incoming gRPC request:", JSON.stringify(call.request, null, 2));

        if (!call.request?.data) {
          return callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: "Missing request.data Struct"
          });
        }

        const request = fromStruct(call.request.data);

        console.log("Decoded gRPC request:", request);

        app.log.info({ request }, "User gRPC request received");

        if (request.service !== "user") {
          return callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: "Invalid service"
          });
        }

        const result = await app.inject({
          method: request.method,
          url: request.url,
          headers: request.headers || {},
          ...(request.method.toUpperCase() !== "GET" &&
            request.method.toUpperCase() !== "HEAD"
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
        callback({
          code: grpc.status.INTERNAL,
          message: error.message
        });
      }
    }
  });

  grpcServer.bindAsync(
    "0.0.0.0:5001",
    grpc.ServerCredentials.createInsecure(),
    () => {
      console.log("User gRPC server running on port 5001");
    }
  );

  // Keep existing REST server running for Stage 1 comparison.
  await app.listen({
    port: 4001,
    host: "0.0.0.0"
  });
}

start().catch(console.error);