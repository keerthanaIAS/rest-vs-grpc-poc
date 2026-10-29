const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const fs = require("fs");
const path = require("path");

const PROTO_PATH = path.join(__dirname, "banking.proto");
const packageDef = protoLoader.loadSync(PROTO_PATH, { keepCase: true });
const bankingProto = grpc.loadPackageDefinition(packageDef).banking;

const certsDir = path.join(__dirname, "certs");
const rootCa = fs.readFileSync(path.join(certsDir, "ca.crt"));
const clientCert = fs.readFileSync(path.join(certsDir, "client.crt"));
const clientKey = fs.readFileSync(path.join(certsDir, "client.key"));

const sslCredentials = grpc.credentials.createSsl(rootCa, clientKey, clientCert);
const GATEWAY_HOST = process.env.GATEWAY_HOST || "127.0.0.1:3003";

const client = new bankingProto.BankGateway(GATEWAY_HOST, sslCredentials, {
  "grpc.ssl_target_name_override": "internal-banking-service.default.svc.cluster.local"
});

async function runFullWorkflow() {
  console.log("==================================================");
  console.log("🚀 INTERNAL APPLICATION STARTED");
  console.log("==================================================\n");

  // 1. Unary Call
  console.log("1️⃣ Executing Unary Transfer...");
  client.RequestTransfer(
    { account_id: "ACC-101", recipient_account: "BANK-ACC-99", amount: 250.0, currency: "USD" },
    (err, resp) => console.log("   [Unary Response]:", resp)
  );

  await new Promise((r) => setTimeout(r, 1000));

  // 2. Server Streaming
  console.log("\n2️⃣ Executing Server Streaming (Live History)...");
  const histStream = client.StreamTransactionHistory({ account_id: "ACC-101", limit: 3 });
  histStream.on("data", (rec) => console.log("   Received History Record:", rec.transaction_id, rec.type));
  histStream.on("end", async () => {
    
    // 3. Client Streaming (File Chunk Upload -> 1 Final Response)
    console.log("\n3️⃣ Executing CLIENT STREAMING: Bulk Payroll CSV Upload...");
    const fileStream = client.UploadPayrollFile((err, resp) => {
      console.log("   [Client Stream Final Response]:", resp);
    });

    fileStream.write({ filename: "payroll_oct2026.csv", content: Buffer.from("emp1,1000.00\nemp2,1200.00\n") });
    fileStream.write({ filename: "payroll_oct2026.csv", content: Buffer.from("emp3,1500.00\nemp4,1100.00\n") });
    fileStream.end();

    await new Promise((r) => setTimeout(r, 1000));

    // 4. Bidirectional Streaming (3 Requests <---> 3 Immediate Live Bank Responses)
    console.log("\n4️⃣ Executing BIDIRECTIONAL STREAMING: Live Real-Time Payouts...");
    const bidiStream = client.LivePayoutStream();

    // Listen for incoming live responses from the bank stream
    bidiStream.on("data", (bankReceipt) => {
      console.log("   Received Live Bank Response:", bankReceipt);
    });

    bidiStream.on("end", () => {
      console.log("\n==================================================");
      console.log("✅ ALL 4 gRPC PATTERNS & mTLS EXECUTED SUCCESSFULLY");
      console.log("==================================================");
    });

    // Write payouts sequentially
    bidiStream.write({ account_id: "ACC-101", recipient_account: "RECIP-1", amount: 100.0, currency: "USD" });
    await new Promise((r) => setTimeout(r, 500));

    bidiStream.write({ account_id: "ACC-101", recipient_account: "RECIP-2", amount: 200.0, currency: "USD" });
    await new Promise((r) => setTimeout(r, 500));

    bidiStream.write({ account_id: "ACC-101", recipient_account: "RECIP-3", amount: 300.0, currency: "USD" });
    await new Promise((r) => setTimeout(r, 500));

    bidiStream.end();
  });
}

runFullWorkflow();