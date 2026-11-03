const http = require("http");
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");

const PROTO_PATH = path.resolve(
  __dirname,
  "../shared/bridge.proto"
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

// gRPC clients for multiple backend servers.
const services = {
  user: new proto.ApiBridge(
    "localhost:5001",
    grpc.credentials.createInsecure()
  ),

  payment: new proto.ApiBridge(
    "localhost:5002",
    grpc.credentials.createInsecure()
  )
};

function toValue(value) {
  if (value === null || value === undefined) return { nullValue: 0 };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return { numberValue: value };
  if (typeof value === "boolean") return { boolValue: value };

  if (Array.isArray(value)) {
    return { listValue: { values: value.map(toValue) } };
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

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://localhost:3000",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  });

  response.end(JSON.stringify(data));
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "http://localhost:3000",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    });

    return response.end();
  }

  try {
    const url = new URL(request.url, "http://localhost:4000");

    const parts = url.pathname.split("/").filter(Boolean);

    const service = parts.shift();

    const client = services[service];

    if (!client) {
      return sendJson(response, 404, {
        message: "Unknown service"
      });
    }

    const route = "/" + parts.join("/") + url.search;

    let body = "";

    for await (const chunk of request) {
      body += chunk;
    }

    const payload = body ? JSON.parse(body) : {};

    const grpcRequest = {
      data: toStruct({
        service,
        method: request.method,
        url: route,
        payload,
        headers: {
          "content-type": request.headers["content-type"] || "application/json",
          ...(request.headers.authorization
            ? { authorization: request.headers.authorization }
            : {})
        }
      })
    };

    console.log("Gateway received:", {
      service,
      method: request.method,
      url: route,
      payload
    });

    client.forward(grpcRequest, (error, result) => {
      if (error) {
        return sendJson(response, 502, {
          message: error.message
        });
      }

      const decoded = fromStruct(result.data);

      console.log("Gateway received gRPC response:", decoded);

      sendJson(response, result.status, decoded.body);
    });

  } catch (error) {
    sendJson(response, 500, {
      message: error.message
    });
  }
});

server.listen(4000, () => {
  console.log("HTTP + gRPC Gateway running on port 4000");
});