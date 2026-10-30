const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const fs = require("fs");
const path = require("path");

const PROTO_PATH = path.join(__dirname, "banking.proto");

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
});

const bankingProto = grpc.loadPackageDefinition(
  packageDef
).banking;

// --------------------------------------------------
// mTLS CERTIFICATES
// --------------------------------------------------

const certsDir = path.join(__dirname, "certs");

const rootCa = fs.readFileSync(
  path.join(certsDir, "ca.crt")
);

const TEST_UNAUTHENTICATED =
  process.env.TEST_UNAUTHENTICATED === "true";

let sslCredentials;

if (TEST_UNAUTHENTICATED) {
  console.log(
    "⚠️ TEST MODE: Connecting without client certificate"
  );

  sslCredentials = grpc.credentials.createSsl(rootCa);
} else {
  const clientCert = fs.readFileSync(
    path.join(certsDir, "client.crt")
  );

  const clientKey = fs.readFileSync(
    path.join(certsDir, "client.key")
  );

  sslCredentials = grpc.credentials.createSsl(
    rootCa,
    clientKey,
    clientCert
  );
}

//  Here I command this to test the unauthenticated scenario, so that i can test the error handling for unauthenticated scenario.
// const clientCert = fs.readFileSync(
//   path.join(certsDir, "client.crt")
// );

// const clientKey = fs.readFileSync(
//   path.join(certsDir, "client.key")
// );

// const sslCredentials = grpc.credentials.createSsl(
//   rootCa,
//   clientKey,
//   clientCert
// );

// --------------------------------------------------
// gRPC CLIENT
// --------------------------------------------------

const GATEWAY_HOST =
  process.env.GATEWAY_HOST || "127.0.0.1:3003";

const client = new bankingProto.BankGateway(
  GATEWAY_HOST,
  sslCredentials,
  {
    "grpc.ssl_target_name_override":
      "internal-banking-service.default.svc.cluster.local",
  }
);

// --------------------------------------------------
// METADATA
// --------------------------------------------------

const CORRELATION_ID = `TRACE-${Date.now()}`;

function createCallMetadata(requestId) {
  const metadata = new grpc.Metadata();

  if (process.env.TEST_RPC_UNAUTHENTICATED !== "true") {
    metadata.add("authorization", "Bearer bank-poc-secret");
  }

  metadata.set(
    "x-service-name",
    "internal-banking-app"
  );

  metadata.set(
    "x-correlation-id",
    CORRELATION_ID
  );

  metadata.set(
    "x-request-id",
    requestId
  );

  return metadata;
}

// --------------------------------------------------
// DEADLINES
// --------------------------------------------------

function createDeadline(seconds = 5) {
  return new Date(
    Date.now() + seconds * 1000
  );
}

// --------------------------------------------------
// CLIENT ERROR HANDLING
// --------------------------------------------------

function handleGrpcError(error, operation) {
  console.error(`❌ ${operation} failed`);
  console.error("   Code:", error.code);
  console.error("   Details:", error.details);

  switch (error.code) {
    case grpc.status.DEADLINE_EXCEEDED:
      console.error(
        "   Reason: RPC exceeded its deadline"
      );
      break;

    case grpc.status.UNAVAILABLE:
      console.error(
        "   Reason: Gateway or service unavailable"
      );
      break;

    case grpc.status.INVALID_ARGUMENT:
      console.error(
        "   Reason: Invalid request"
      );
      break;

    case grpc.status.NOT_FOUND:
      console.error(
        "   Reason: Resource not found"
      );
      break;

    case grpc.status.UNAUTHENTICATED:
      console.error(
        "   Reason: Caller authentication failed"
      );
      break;

    case grpc.status.INTERNAL:
      console.error(
        "   Reason: Unexpected server-side failure"
      );
      break;

    // case grpc.status.INTERNAL:
    //   console.error(
    //     "   Reason: Internal server error"
    //   );
    //   break;

    default:
      console.error(
        "   Reason: Unexpected gRPC error"
      );
  }
}

// --------------------------------------------------
// 1. UNARY RPC
// --------------------------------------------------

function executeUnaryTransfer() {
  return new Promise((resolve) => {
    console.log("\n1️⃣ Executing Unary Transfer...");

    // Test invalid argument scenario by setting amount to a negative value, After completed the invalid argument test, change amount field to get the valid result
    const TEST_INVALID_ARGUMENT =
      process.env.TEST_INVALID_ARGUMENT === "true";

    const request = {
      account_id: "ACC-101",
      recipient_account: "BANK-ACC-99",
      amount: TEST_INVALID_ARGUMENT ? -250 : 250.0,
      currency: "USD",
    };

    client.RequestTransfer(
      request,
      createCallMetadata("TRANSFER-001"),
      {
        deadline: createDeadline(5),
      },
      (error, response) => {
        if (error) {
          handleGrpcError(
            error,
            "Unary Transfer"
          );

          return resolve();
        }

        console.log(
          "   [Unary Response]:",
          response
        );

        resolve();
      }
    );
  });
}

// --------------------------------------------------
// 2. SERVER STREAMING RPC
// --------------------------------------------------

function executeServerStreaming() {
  return new Promise((resolve) => {
    console.log(
      "\n2️⃣ Executing Server Streaming (History)..."
    );

    const request = {
      account_id: "ACC-101",
      limit: 3,
    };

    const historyStream =
      client.StreamTransactionHistory(
        request,
        createCallMetadata("HISTORY-001"),
        {
          deadline: createDeadline(10),
        }
      );

    historyStream.on("data", (record) => {
      console.log(
        "   Received History Record:",
        record.transaction_id,
        record.type
      );
    });

    historyStream.on("error", (error) => {
      handleGrpcError(
        error,
        "Server Streaming History"
      );

      resolve();
    });

    historyStream.on("end", () => {
      console.log(
        "   ✅ History stream completed"
      );

      resolve();
    });
  });
}

// --------------------------------------------------
// 3. CLIENT STREAMING RPC
// --------------------------------------------------

function executeClientStreaming() {
  return new Promise((resolve) => {
    console.log(
      "\n3️⃣ Executing CLIENT STREAMING: Payroll Upload..."
    );

    const fileStream = client.UploadPayrollFile(
      createCallMetadata(
        "PAYROLL-UPLOAD-001"
      ),
      {
        deadline: createDeadline(10),
      },
      (error, response) => {
        if (error) {
          handleGrpcError(
            error,
            "Payroll Upload"
          );

          return resolve();
        }

        console.log(
          "   [Client Stream Final Response]:",
          response
        );

        resolve();
      }
    );

    fileStream.on("error", (error) => {
      handleGrpcError(
        error,
        "Payroll Upload Stream"
      );
    });

    fileStream.write({
      filename: "payroll_oct2026.csv",
      content: Buffer.from(
        "emp1,1000.00\nemp2,1200.00\n"
      ),
    });

    fileStream.write({
      filename: "payroll_oct2026.csv",
      content: Buffer.from(
        "emp3,1500.00\nemp4,1100.00\n"
      ),
    });

    fileStream.end();
  });
}

// --------------------------------------------------
// 4. BIDIRECTIONAL STREAMING RPC
// --------------------------------------------------

function executeBidirectionalStreaming() {
  return new Promise((resolve) => {
    console.log(
      "\n4️⃣ Executing BIDIRECTIONAL STREAMING"
    );

    const bidiStream = client.LivePayoutStream(
      createCallMetadata(
        "LIVE-PAYOUT-STREAM-001"
      ),
      {
        deadline: createDeadline(15),
      }
    );

    let receivedReceipts = 0;

    let completed = false;

    const payouts = [
      {
        request_id: "PAY-001",
        account_id: "ACC-101",
        recipient_account: "RECIP-1",
        amount: 100,
        currency: "USD",
      },
      {
        request_id: "PAY-002",
        account_id: "ACC-101",
        recipient_account: "RECIP-2",
        amount: 200,
        currency: "USD",
      },
      {
        request_id: "PAY-003",
        account_id: "ACC-101",
        recipient_account: "RECIP-3",
        amount: 300,
        currency: "USD",
      },
    ];

    bidiStream.on("data", (receipt) => {
      receivedReceipts++;

      console.log(
        `📩 RECEIVED RECEIPT: ${receipt.request_id} | ` +
        `${receipt.status} | ${receipt.bank_transaction_id}`
      );
    });

    bidiStream.on("error", (error) => {
      if (completed) return;

      completed = true;

      handleGrpcError(
        error,
        "Bidirectional Payout Stream"
      );

      resolve();
    });

    bidiStream.on("end", () => {
      if (completed) return;

      completed = true;

      console.log(
        `✅ Stream closed. Receipts: ${receivedReceipts}/${payouts.length}`
      );

      resolve();
    });

    async function sendPayouts() {
      for (const payout of payouts) {
        console.log(
          `📤 SENDING: ${payout.request_id}`
        );

        bidiStream.write(payout);

        // Existing delay retained for the POC.
        await new Promise((resolve) =>
          setTimeout(resolve, 1500)
        );
      }

      console.log(
        "📤 Finished sending all payouts"
      );

      bidiStream.end();
    }

    sendPayouts().catch((error) => {
      console.error(
        "Failed to send payouts:",
        error.message
      );

      bidiStream.destroy(error);
    });
  });
}

// --------------------------------------------------
// RUN FULL WORKFLOW
// --------------------------------------------------

async function runFullWorkflow() {
  console.log("==================================================");

  console.log(
    "🚀 INTERNAL APPLICATION STARTED"
  );

  console.log(
    "Correlation ID:",
    CORRELATION_ID
  );

  console.log("==================================================");

  try {
    await executeUnaryTransfer();

    await executeServerStreaming();

    await executeClientStreaming();

    await executeBidirectionalStreaming();
  } catch (error) {
    console.error(
      "Workflow failed:",
      error.message
    );
  } finally {
    client.close();

    console.log(
      "\n🏁 INTERNAL APPLICATION COMPLETED"
    );
  }
}

runFullWorkflow();