const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const PROTO_PATH = path.join(__dirname, "banking.proto");

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
});

const bankingProto = grpc.loadPackageDefinition(packageDef).banking;

const BANK_REST_URL =
  process.env.BANK_REST_URL || "http://localhost:8080";

const BANK_TIMEOUT = Number(process.env.BANK_TIMEOUT_MS || 5000); // to test timeout, set to 100ms

// --------------------------------------------------
// UNAUTHENTICATED
// --------------------------------------------------

function validateAuthentication(call) {
  const token = call.metadata.get("authorization")[0];

  if (token !== "Bearer bank-poc-secret") {
    return {
      code: grpc.status.UNAUTHENTICATED,
      details: "Missing or invalid authentication token",
    };
  }

  return null;
}

// --------------------------------------------------
// METADATA
// --------------------------------------------------

function logCallMetadata(call, operation) {
  const getValue = (key) => {
    const values = call.metadata.get(key);
    return values.length ? values[0] : "missing";
  };

  const info = {
    service: getValue("x-service-name"),
    correlationId: getValue("x-correlation-id"),
    requestId: getValue("x-request-id"),
  };

  console.log(`[Metadata] ${operation}:`, info);

  return info;
}

// --------------------------------------------------
// ERROR HANDLING
// --------------------------------------------------

function logError(operation, error) {
  console.error(`[${operation}] Error:`, {
    message: error.message,
    code: error.code,
    details: error.details,
  });
}

function mapAxiosError(error) {
  if (error.code === "ECONNABORTED") {
    return {
      code: grpc.status.DEADLINE_EXCEEDED,
      details: "Bank REST API request timed out",
    };
  }

  if (error.response) {
    const status = error.response.status;

    if (status === 400) {
      return {
        code: grpc.status.INVALID_ARGUMENT,
        details: "Bank REST API rejected the request",
      };
    }

    if (status === 404) {
      return {
        code: grpc.status.NOT_FOUND,
        details: "Bank resource not found",
      };
    }

    if (status >= 500) {
      return {
        code: grpc.status.UNAVAILABLE,
        details: "Bank REST API is unavailable",
      };
    }

    return {
      code: grpc.status.INTERNAL,
      details: "Bank REST API request failed",
    };
  }

  if (
    error.code === "ECONNREFUSED" ||
    error.code === "ECONNRESET" ||
    error.code === "ENOTFOUND"
  ) {
    return {
      code: grpc.status.UNAVAILABLE,
      details: "Unable to connect to Bank REST API",
    };
  }

  return {
    code: grpc.status.INTERNAL,
    details: "Internal gateway error",
  };
}

function handleGatewayError(error, callback, operation) {
  logError(operation, error);

  callback(mapAxiosError(error));
}

function sendStreamError(call, error, operation) {
  logError(operation, error);

  const grpcError = mapAxiosError(error);

  call.emit("error", grpcError);
}

// --------------------------------------------------
// REQUEST VALIDATION
// --------------------------------------------------

function validateTransfer(request) {
  if (!request.account_id || !request.recipient_account) {
    return "Account ID and recipient account are required";
  }

  if (
    typeof request.amount !== "number" ||
    !Number.isFinite(request.amount) ||
    request.amount <= 0
  ) {
    return "Transfer amount must be greater than zero";
  }

  if (!request.currency) {
    return "Currency is required";
  }

  return null;
}

// --------------------------------------------------
// REST API REQUEST
// --------------------------------------------------

async function callBankTransfer(request, metadata) {
  return axios.post(
    `${BANK_REST_URL}/v1/bank/transfer`,
    request,
    {
      timeout: BANK_TIMEOUT,

      headers: {
        "x-service-name": metadata.service,
        "x-correlation-id": metadata.correlationId,
        "x-request-id": metadata.requestId,
      },
    }
  );
}

// --------------------------------------------------
// 1. UNARY RPC
// --------------------------------------------------

async function requestTransfer(call, callback) {
  const metadata = logCallMetadata(call, "RequestTransfer");

  const request = call.request;

  // Simulate an unexpected internal failure for testing purposes
  if (process.env.TEST_INTERNAL === "true") {
    console.error(
      "[RequestTransfer] Simulated unexpected internal failure"
    );

    return callback({
      code: grpc.status.INTERNAL,
      details: "Unexpected internal banking gateway failure",
    });
  }

  // authentication
  const authError = validateAuthentication(call);

  if (authError) {
    return callback(authError);
  }

  const validationError = validateTransfer(request);

  if (validationError) {
    return callback({
      code: grpc.status.INVALID_ARGUMENT,
      details: validationError,
    });
  }

  try {
    const response = await callBankTransfer(request, metadata);

    callback(null, response.data);
  } catch (error) {
    handleGatewayError(
      error,
      callback,
      "RequestTransfer"
    );
  }
}

// --------------------------------------------------
// 2. SERVER STREAMING RPC
// --------------------------------------------------

async function streamTransactionHistory(call) {
  const metadata = logCallMetadata(
    call,
    "StreamTransactionHistory"
  );

  const accountId = call.request.account_id;

  if (!accountId) {
    return sendStreamError(
      call,
      {
        response: {
          status: 400,
        },
        message: "Account ID is required",
      },
      "StreamTransactionHistory"
    );
  }

  try {
    const response = await axios.get(
      `${BANK_REST_URL}/v1/bank/accounts/${encodeURIComponent(
        accountId
      )}/history`,
      {
        timeout: BANK_TIMEOUT,

        headers: {
          "x-service-name": metadata.service,
          "x-correlation-id": metadata.correlationId,
          "x-request-id": metadata.requestId,
        },
      }
    );

    for (const record of response.data.transactions) {
      if (call.cancelled) {
        console.log(
          "[StreamTransactionHistory] Client cancelled stream"
        );

        return;
      }

      call.write(record);

      await new Promise((resolve) =>
        setTimeout(resolve, 300)
      );
    }

    call.end();
  } catch (error) {
    sendStreamError(
      call,
      error,
      "StreamTransactionHistory"
    );
  }
}

// --------------------------------------------------
// 3. CLIENT STREAMING RPC
// --------------------------------------------------

function uploadPayrollFile(call, callback) {
  const metadata = logCallMetadata(
    call,
    "UploadPayrollFile"
  );

  let totalBytes = 0;
  let filename = "";

  let streamFailed = false;

  console.log(
    "📥 [Gateway] Receiving payroll file chunks"
  );

  call.on("data", (chunk) => {
    if (streamFailed) return;

    if (!chunk.filename || !chunk.content) {
      streamFailed = true;

      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        details: "Invalid payroll file chunk",
      });
    }

    filename = chunk.filename;

    totalBytes += chunk.content.length;

    console.log(
      `Received chunk for '${filename}': ${chunk.content.length} bytes`
    );
  });

  call.on("error", (error) => {
    logError("UploadPayrollFile", error);
  });

  call.on("end", () => {
    if (streamFailed) return;

    console.log(
      `✅ [Gateway] File stream finished. Total: ${totalBytes} bytes`
    );

    callback(null, {
      file_id: `FILE-${Date.now()}`,
      total_bytes_received: totalBytes,
      status: "FILE_UPLOADED_AND_VERIFIED",
    });
  });
}

// --------------------------------------------------
// 4. BIDIRECTIONAL STREAMING RPC
// --------------------------------------------------

function livePayoutStream(call) {
  const metadata = logCallMetadata(
    call,
    "LivePayoutStream"
  );

  console.log("🔀 Bidirectional Live Payout Stream Opened");

  const pendingRequests = [];

  let streamEnded = false;

  call.on("data", (transaction) => {
    if (streamEnded) return;

    console.log(
      `📥 Received ${transaction.request_id}: ` +
      `$${transaction.amount} to ${transaction.recipient_account}`
    );

    const validationError = validateTransfer(transaction);

    if (validationError) {
      call.emit("error", {
        code: grpc.status.INVALID_ARGUMENT,
        details: validationError,
      });

      return;
    }

    const request = callBankTransfer(
      transaction,
      {
        ...metadata,
        requestId: transaction.request_id,
      }
    )
      .then((response) => {
        if (call.cancelled || streamEnded) {
          return;
        }

        const bankReceipt = response.data;

        call.write({
          request_id: transaction.request_id,
          bank_transaction_id:
            bankReceipt.bank_transaction_id,
          status: bankReceipt.status,
          remaining_balance:
            bankReceipt.remaining_balance,
        });

        console.log(
          `📤 Receipt sent for ${transaction.request_id}`
        );
      })
      .catch((error) => {
        if (call.cancelled || streamEnded) {
          return;
        }

        logError(
          `LivePayoutStream ${transaction.request_id}`,
          error
        );

        call.emit("error", mapAxiosError(error));
      });

    pendingRequests.push(request);
  });

  call.on("error", (error) => {
    logError("LivePayoutStream", error);
  });

  call.on("end", async () => {
    console.log("📤 Client finished sending payouts");

    await Promise.all(pendingRequests);

    if (call.cancelled || streamEnded) {
      return;
    }

    streamEnded = true;

    console.log("✅ All payout processing completed");

    call.end();
  });
}

// --------------------------------------------------
// mTLS CERTIFICATES
// --------------------------------------------------

const certsDir = path.join(__dirname, "certs");

const rootCa = fs.readFileSync(
  path.join(certsDir, "ca.crt")
);

const serverCert = fs.readFileSync(
  path.join(certsDir, "server.crt")
);

const serverKey = fs.readFileSync(
  path.join(certsDir, "server.key")
);

const serverCredentials = grpc.ServerCredentials.createSsl(
  rootCa,
  [
    {
      cert_chain: serverCert,
      private_key: serverKey,
    },
  ],
  true // The last argument true means the server requires client authentication.
);

// --------------------------------------------------
// gRPC SERVER
// --------------------------------------------------

const server = new grpc.Server();

server.addService(
  bankingProto.BankGateway.service,
  {
    RequestTransfer: requestTransfer,
    StreamTransactionHistory: streamTransactionHistory,
    UploadPayrollFile: uploadPayrollFile,
    LivePayoutStream: livePayoutStream,
  }
);

const PORT = process.env.PORT || "3003";

server.bindAsync(
  `0.0.0.0:${PORT}`,
  serverCredentials,
  (error, port) => {
    if (error) {
      console.error("Gateway startup failed:", error);
      process.exit(1);
    }

    console.log(
      `🔒 Gateway gRPC Server running with mTLS on port ${port}`
    );
  }
);