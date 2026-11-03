import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";

const PROTO_PATH = path.resolve(
  process.cwd(),
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

const proto = grpc.loadPackageDefinition(
  packageDefinition
).bridge as any;

// Reuse connections instead of creating a new client for every request.
const userClient = new proto.ApiBridge(
  "localhost:5001",
  grpc.credentials.createInsecure()
);

const paymentClient = new proto.ApiBridge(
  "localhost:5002",
  grpc.credentials.createInsecure()
);

function toValue(value: any): any {
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

function toStruct(object: any): any {
  const fields: Record<string, any> = {};

  for (const [key, value] of Object.entries(object || {})) {
    fields[key] = toValue(value);
  }

  return { fields };
}

function fromValue(value: any): any {
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

function fromStruct(struct: any): any {
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(struct?.fields || {})) {
    result[key] = fromValue(value);
  }

  return result;
}

export function forwardToGrpc(
  service: string,
  method: string,
  url: string,
  payload: any,
  headers: Record<string, string>
): Promise<{ status: number; body: any }> {
  const client =
    service === "user"
      ? userClient
      : service === "payment"
        ? paymentClient
        : null;

  if (!client) {
    return Promise.reject(new Error("Unknown service"));
  }

  const grpcRequest = {
    data: toStruct({
      service,
      method,
      url,
      payload,
      headers
    })
  };

  return new Promise((resolve, reject) => {
    client.forward(grpcRequest, (error: any, result: any) => {
      if (error) {
        return reject(error);
      }

      const decoded = fromStruct(result.data);

      resolve({
        status: result.status,
        body: decoded.body
      });
    });
  });
}