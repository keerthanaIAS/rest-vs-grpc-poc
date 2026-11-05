// This single file handles the client, Axios interceptor and server receiver.

const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");

const definition = protoLoader.loadSync(
  path.join(__dirname, "bridge.proto"),
  {
    keepCase: true,
    defaults: true,
    oneofs: true,
  }
);

const bridge = grpc.loadPackageDefinition(definition).bridge;

// ----------------------------------
// 1. Axios interceptor / gRPC client
// ----------------------------------

function registerAxiosInterceptor(axiosInstance, target) {
  const client = new bridge.ApiBridge(
    target.grpcAddress,
    grpc.credentials.createInsecure()
  );

  axiosInstance.interceptors.request.use((config) => {
    const requestUrl = new URL(axiosInstance.getUri(config));

    // Only redirect requests for the configured transaction service.
    if (requestUrl.origin !== target.httpOrigin) {
      return config;
    }

    config.adapter = async (requestConfig) => {
      let headers = requestConfig.headers;

      if (headers?.toJSON) {
        headers = headers.toJSON();
      }

      headers = { ...(headers || {}) };

      delete headers.host;
      delete headers["content-length"];
      delete headers.connection;

      const body = requestConfig.data;

      const payload =
        body == null
          ? Buffer.alloc(0)
          : Buffer.isBuffer(body)
            ? body
            : Buffer.from(String(body));

      const grpcRequest = {
        method: (requestConfig.method || "GET").toUpperCase(),
        url: requestUrl.pathname + requestUrl.search,
        headers_json: JSON.stringify(headers),
        payload,
      };

      const result = await new Promise((resolve, reject) => {
        client.forward(
          grpcRequest,
          {
            deadline: new Date(
              Date.now() + (requestConfig.timeout || 5000)
            ),
          },
          (error, response) => {
            if (error) {
              reject(error);
            } else {
              resolve(response);
            }
          }
        );
      });

      const response = {
        data: Buffer.from(result.payload).toString("utf8"),
        status: result.status,
        statusText: "",
        headers: JSON.parse(result.headers_json || "{}"),
        config: requestConfig,
        request: null,
      };

      const validateStatus = requestConfig.validateStatus;

      if (!validateStatus || validateStatus(response.status)) {
        return response;
      }

      const error = new Error(
        `Request failed with status code ${response.status}`
      );

      error.config = requestConfig;
      error.response = response;
      error.isAxiosError = true;

      throw error;
    };

    return config;
  });

  console.log(
    `[gRPC Bridge] Axios requests to ${target.httpOrigin} will use gRPC at ${target.grpcAddress}`
  );

  return client;
}

// ----------------------------------
// 2. gRPC receiver / Fastify adapter
// ----------------------------------

async function startGrpcReceiver(app, port) {
  const server = new grpc.Server();

  server.addService(bridge.ApiBridge.service, {
    Forward: async (call, callback) => {
      try {
        const request = call.request;

        const headers = JSON.parse(
          request.headers_json || "{}"
        );

        const result = await app.inject({
          method: request.method,
          url: request.url,
          headers,
          payload: request.payload?.length
            ? Buffer.from(request.payload)
            : undefined,
        });

        callback(null, {
          status: result.statusCode,
          headers_json: JSON.stringify(result.headers),
          payload: Buffer.from(result.body || "", "utf8"),
        });
      } catch (error) {
        callback({
          code: grpc.status.INTERNAL,
          message: error.message,
        });
      }
    },
  });

  await new Promise((resolve, reject) => {
    server.bindAsync(
      `0.0.0.0:${port}`,
      grpc.ServerCredentials.createInsecure(),
      (error) => {
        if (error) {
          reject(error);
          return;
        }

        server.start();
        resolve();
      }
    );
  });

  console.log(`[gRPC Bridge] Receiver listening on ${port}`);

  return server;
}

module.exports = {
  registerAxiosInterceptor,
  startGrpcReceiver,
};