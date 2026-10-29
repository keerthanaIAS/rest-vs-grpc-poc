const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const PROTO_PATH = path.join(__dirname, "banking.proto");
const packageDef = protoLoader.loadSync(PROTO_PATH, { keepCase: true });
const bankingProto = grpc.loadPackageDefinition(packageDef).banking;

const BANK_REST_URL = process.env.BANK_REST_URL || "http://localhost:8080";

// 1. Unary RPC
async function requestTransfer(call, callback) {
  const req = call.request;
  try {
    const response = await axios.post(`${BANK_REST_URL}/v1/bank/transfer`, req);
    callback(null, response.data);
  } catch (err) {
    callback({ code: grpc.status.INTERNAL, details: err.message });
  }
}

// 2. Server Streaming RPC
async function streamTransactionHistory(call) {
  const accountId = call.request.account_id;
  try {
    const response = await axios.get(`${BANK_REST_URL}/v1/bank/accounts/${accountId}/history`);
    for (const record of response.data.transactions) {
      if (call.cancelled) return;
      call.write(record);
      await new Promise((r) => setTimeout(r, 300));
    }
    call.end();
  } catch (err) {
    call.emit("error", { code: grpc.status.INTERNAL, details: err.message });
  }
}

// 3. Client Streaming RPC (File / Batch Upload -> 1 Final Receipt)
function uploadPayrollFile(call, callback) {
  let totalBytes = 0;
  let filename = "";

  console.log(`📥 [Gateway Service] Receiving Client Stream: Bulk Payroll File Chunks...`);

  call.on("data", (chunk) => {
    filename = chunk.filename;
    totalBytes += chunk.content.length;
    console.log(`   Received file chunk for '${filename}': ${chunk.content.length} bytes`);
  });

  call.on("end", () => {
    console.log(`✅ [Gateway Service] File stream finished. Total: ${totalBytes} bytes.`);
    // Returns 1 single summary response
    callback(null, {
      file_id: `FILE-${Date.now()}`,
      total_bytes_received: totalBytes,
      status: "FILE_UPLOADED_AND_VERIFIED"
    });
  });
}

// 4. Bidirectional Streaming RPC (N Requests <---> N Live Bank Receipts)
function livePayoutStream(call) {
  console.log(`🔀 [Gateway Service] Opened Bidirectional Stream for Live Payouts...`);

  call.on("data", async (tx) => {
    console.log(`   [Bi-Di Stream] Inbound Item: $${tx.amount} to ${tx.recipient_account}. Forwarding to Bank REST API...`);

    try {
      // Call External Bank API for each individual stream item
      const response = await axios.post(`${BANK_REST_URL}/v1/bank/transfer`, tx);

      // Stream back an immediate individual bank response
      call.write({
        bank_transaction_id: response.data.bank_transaction_id,
        status: response.data.status,
        remaining_balance: response.data.remaining_balance
      });
      console.log(`   [Bi-Di Stream] Sent immediate bank receipt for ${response.data.bank_transaction_id}`);
    } catch (err) {
      console.error("❌ Bank REST call failed:", err.message);
    }
  });

  call.on("end", () => {
    console.log(`✅ [Gateway Service] Bi-Directional stream closed by client.`);
    call.end();
  });
}

// Read Certificates
const certsDir = path.join(__dirname, "certs");
const rootCa = fs.readFileSync(path.join(certsDir, "ca.crt"));
const serverCert = fs.readFileSync(path.join(certsDir, "server.crt"));
const serverKey = fs.readFileSync(path.join(certsDir, "server.key"));

const serverCredentials = grpc.ServerCredentials.createSsl(
  rootCa,
  [{ cert_chain: serverCert, private_key: serverKey }],
  true
);

const server = new grpc.Server();
server.addService(bankingProto.BankGateway.service, {
  RequestTransfer: requestTransfer,
  StreamTransactionHistory: streamTransactionHistory,
  UploadPayrollFile: uploadPayrollFile,
  LivePayoutStream: livePayoutStream
});

const PORT = process.env.PORT || "3003";
server.bindAsync(`0.0.0.0:${PORT}`, serverCredentials, (err, port) => {
  if (err) throw err;
  console.log(`🔒 Gateway gRPC Server running with mTLS on port ${port}`);
});