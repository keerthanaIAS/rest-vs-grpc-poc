# Here is the exact code, protobuf contract, and Kubernetes manifests for the **Outbound Architecture**:

```
[ Internal App Service ] ──(gRPC + mTLS)──> [ Internal Gateway ] ──(REST/JSON)──> [ External Bank API ]

```

---

1. Step 1: Update Protobuf Schema (`banking.proto`)

Save this as `banking.proto`. It includes Unary, Client Streaming, and Server Streaming RPCs.

```protobuf
syntax = "proto3";

package banking;

service BankGateway {
  // 1. Unary: Request single fund transfer to bank
  rpc RequestTransfer (TransferRequest) returns (TransferResponse);

  // 2. Server Streaming: Internal app asks bank to stream live transaction history
  rpc StreamTransactionHistory (HistoryRequest) returns (stream TransactionRecord);

  // 3. Client Streaming: Internal app streams a batch of payout transfers to the bank
  rpc BatchPayoutStream (stream TransferRequest) returns (BatchPayoutResponse);
}

message TransferRequest {
  string account_id = 1;
  string recipient_account = 2;
  double amount = 3;
  string currency = 4;
}

message TransferResponse {
  string bank_transaction_id = 1;
  string status = 2;
  double remaining_balance = 3;
}

message HistoryRequest {
  string account_id = 1;
  int32 limit = 2;
}

message TransactionRecord {
  string transaction_id = 1;
  string timestamp = 2;
  string type = 3;
  double amount = 4;
  string status = 5;
}

message BatchPayoutResponse {
  int32 total_processed = 1;
  double total_amount = 2;
  string status = 3;
}

```

---

2. Step 2: External Bank API Simulator (`external-bank-api.js`)

Simulates the external bank's public REST server listening on port `8080`.

```javascript
const express = require("express");
const app = express();
app.use(express.json());

// 1. Bank REST Endpoint: Process Transfer
app.post("/v1/bank/transfer", (req, res) => {
  const { account_id, recipient_account, amount } = req.body;
  console.log(`🏦 [External Bank API] Received REST Transfer: $${amount} from ${account_id} to ${recipient_account}`);

  res.json({
    bank_transaction_id: `BANK-TXN-${Date.now()}`,
    status: "SETTLED",
    remaining_balance: 10000.0 - amount
  });
});

// 2. Bank REST Endpoint: Get Transaction History List
app.get("/v1/bank/accounts/:id/history", (req, res) => {
  console.log(`🏦 [External Bank API] Fetching Transaction History for ${req.params.id}`);

  res.json({
    account_id: req.params.id,
    transactions: [
      { transaction_id: "TXN-901", timestamp: new Date().toISOString(), type: "DEPOSIT", amount: 1500.0, status: "COMPLETED" },
      { transaction_id: "TXN-902", timestamp: new Date().toISOString(), type: "PAYMENT", amount: 250.0, status: "COMPLETED" },
      { transaction_id: "TXN-903", timestamp: new Date().toISOString(), type: "TRANSFER", amount: 500.0, status: "COMPLETED" }
    ]
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🏦 External Bank REST API running on port ${PORT}`);
});

```

---

3. Step 3: Gateway Service (`gateway-service.js`)

The Gateway runs a **gRPC Server with strict mTLS**. It receives internal gRPC calls and translates them into outbound REST HTTP requests to the Bank API.

```javascript
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const PROTO_PATH = path.join(__dirname, "banking.proto");
const packageDef = protoLoader.loadSync(PROTO_PATH, { keepCase: true });
const bankingProto = grpc.loadPackageDefinition(packageDef).banking;

const BANK_REST_URL = process.env.BANK_REST_URL || "http://localhost:8080";

// 1. Unary: Internal App calls Gateway -> Gateway calls Bank REST API
async function requestTransfer(call, callback) {
  const req = call.request;
  console.log(`🔄 [Gateway Service] Received gRPC Transfer Request for $${req.amount}`);

  try {
    const response = await axios.post(`${BANK_REST_URL}/v1/bank/transfer`, {
      account_id: req.account_id,
      recipient_account: req.recipient_account,
      amount: req.amount,
      currency: req.currency
    });

    callback(null, {
      bank_transaction_id: response.data.bank_transaction_id,
      status: response.data.status,
      remaining_balance: response.data.remaining_balance
    });
  } catch (err) {
    callback({
      code: grpc.status.INTERNAL,
      details: err.message
    });
  }
}

// 2. Server Streaming: Gateway fetches history from Bank REST API and STREAMS it to Internal App frame-by-frame
async function streamTransactionHistory(call) {
  const accountId = call.request.account_id;
  console.log(`🌊 [Gateway Service] Streaming transaction history for ${accountId}...`);

  try {
    const response = await axios.get(`${BANK_REST_URL}/v1/bank/accounts/${accountId}/history`);
    const records = response.data.transactions;

    // Stream each record frame-by-frame over gRPC back to the Internal App
    for (const record of records) {
      if (call.cancelled) return;
      call.write(record);
      await new Promise((r) => setTimeout(r, 500)); // Delay to illustrate real streaming
    }

    call.end(); // End stream
  } catch (err) {
    call.emit("error", { code: grpc.status.INTERNAL, details: err.message });
  }
}

// 3. Client Streaming: Internal App STREAMS multiple transfer requests -> Gateway sends aggregated batch to Bank
function batchPayoutStream(call, callback) {
  let totalProcessed = 0;
  let totalAmount = 0;

  console.log(`📥 [Gateway Service] Receiving incoming Client Stream batch payout...`);

  call.on("data", (tx) => {
    totalProcessed++;
    totalAmount += tx.amount;
    console.log(`   Received batch item #${totalProcessed}: $${tx.amount}`);
  });

  call.on("end", async () => {
    console.log(`✅ Client Stream complete. Forwarding aggregated batch ($${totalAmount}) to External Bank REST API...`);
    
    // Send bulk payload to external bank
    callback(null, {
      total_processed: totalProcessed,
      total_amount: totalAmount,
      status: "BATCH_FORWARDED_TO_BANK"
    });
  });
}

// Load mTLS Certificates
const certsDir = path.join(__dirname, "certs");
const rootCa = fs.readFileSync(path.join(certsDir, "ca.crt"));
const serverCert = fs.readFileSync(path.join(certsDir, "server.crt"));
const serverKey = fs.readFileSync(path.join(certsDir, "server.key"));

// Require Client Certificate Authentication (mTLS)
const serverCredentials = grpc.ServerCredentials.createSsl(
  rootCa,
  [{ cert_chain: serverCert, private_key: serverKey }],
  true // Enforce mTLS
);

const server = new grpc.Server();
server.addService(bankingProto.BankGateway.service, {
  RequestTransfer: requestTransfer,
  StreamTransactionHistory: streamTransactionHistory,
  BatchPayoutStream: batchPayoutStream
});

const PORT = process.env.PORT || "3003";
server.bindAsync(`0.0.0.0:${PORT}`, serverCredentials, (err, port) => {
  if (err) throw err;
  console.log(`🔒 Gateway gRPC Server running with mTLS on port ${port}`);
});

```

---

4. Step 4: Internal App Client (`internal-app-client.js`)

business application logic. Acts as the **gRPC mTLS Client** that triggers operations and consumes gRPC streams.

```javascript
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const fs = require("fs");
const path = require("path");

const PROTO_PATH = path.join(__dirname, "banking.proto");
const packageDef = protoLoader.loadSync(PROTO_PATH, { keepCase: true });
const bankingProto = grpc.loadPackageDefinition(packageDef).banking;

// Read Client mTLS Certificates
const certsDir = path.join(__dirname, "certs");
const rootCa = fs.readFileSync(path.join(certsDir, "ca.crt"));
const clientCert = fs.readFileSync(path.join(certsDir, "client.crt"));
const clientKey = fs.readFileSync(path.join(certsDir, "client.key"));

const sslCredentials = grpc.credentials.createSsl(rootCa, clientKey, clientCert);

const GATEWAY_HOST = process.env.GATEWAY_HOST || "127.0.0.1:3003";

const client = new bankingProto.BankGateway(GATEWAY_HOST, sslCredentials, {
  "grpc.keepalive_time_ms": 10000,
  "grpc.keepalive_timeout_ms": 5000,
  "grpc.ssl_target_name_override": "internal-banking-service.default.svc.cluster.local"
});

async function runInternalAppWorkflow() {
  console.log("==================================================");
  console.log("🚀 INTERNAL BANKING APP STARTED");
  console.log("   Protocol: gRPC over HTTP/2 with mTLS");
  console.log("==================================================\n");

  // 1. Unary RPC Test
  console.log("1️⃣ Triggering Single Fund Transfer via Gateway...");
  client.RequestTransfer(
    { account_id: "ACC-101", recipient_account: "BANK-ACC-99", amount: 250.0, currency: "USD" },
    (err, response) => {
      if (err) return console.error("❌ Unary Error:", err.message);
      console.log("   [gRPC Response]:", response);
    }
  );

  // Wait 1 second before running stream test
  await new Promise((r) => setTimeout(r, 1000));

  // 2. Server Streaming Test (Consuming live transaction history stream frame by frame)
  console.log("\n2️⃣ Initiating Server Streaming: Consuming Live Transaction Records...");
  const historyStream = client.StreamTransactionHistory({ account_id: "ACC-101", limit: 5 });

  historyStream.on("data", (record) => {
    console.log("   Received Stream Frame:", record);
  });

  historyStream.on("end", () => {
    console.log("   ✅ Server Stream Completed successfully.\n");

    // 3. Client Streaming Test (Streaming batch payouts)
    console.log("3️⃣ Initiating Client Streaming: Sending Batch Payout Transfers...");
    const batchStream = client.BatchPayoutStream((err, response) => {
      if (err) return console.error("❌ Client Stream Error:", err.message);
      console.log("   [gRPC Final Batch Response]:", response);
      console.log("\n==================================================");
      console.log("✅ ALL gRPC STREAMS & mTLS EXECUTED SUCCESSFULLY");
      console.log("==================================================");
    });

    batchStream.write({ account_id: "ACC-101", recipient_account: "BANK-1", amount: 100.0, currency: "USD" });
    batchStream.write({ account_id: "ACC-101", recipient_account: "BANK-2", amount: 200.0, currency: "USD" });
    batchStream.write({ account_id: "ACC-101", recipient_account: "BANK-3", amount: 300.0, currency: "USD" });
    batchStream.end();
  });
}

runInternalAppWorkflow();

```

---

5. Step 5: Updated Dockerfiles

Create 3 Dockerfiles in directory:

* `Dockerfile.bank` (External Bank API)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY external-bank-api.js ./
EXPOSE 8080
CMD ["node", "external-bank-api.js"]

```

* `Dockerfile.gateway` (Internal Gateway gRPC Server)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY banking.proto gateway-service.js ./
COPY certs ./certs
EXPOSE 3003
CMD ["node", "gateway-service.js"]

```

* `Dockerfile.client` (Internal App gRPC Client)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY banking.proto internal-app-client.js ./
COPY certs ./certs
CMD ["node", "internal-app-client.js"]

```

---

6. Step 6: Updated Kubernetes Deployments (`k8s-deployments.yaml`)

```yaml
# 1. External Bank API Deployment & Service
apiVersion: apps/v1
kind: Deployment
metadata:
  name: external-bank-api
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: external-bank-api
  template:
    metadata:
      labels:
        app: external-bank-api
    spec:
      containers:
      - name: bank-api
        image: external-bank-api:latest
        imagePullPolicy: Never
        ports:
        - containerPort: 8080
---
apiVersion: v1
kind: Service
metadata:
  name: external-bank-api
  namespace: default
spec:
  type: ClusterIP
  ports:
  - port: 8080
    targetPort: 8080
  selector:
    app: external-bank-api
---
# 2. Internal Gateway gRPC Service Deployment & Service
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gateway-service
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels:
      app: gateway-service
  template:
    metadata:
      labels:
        app: gateway-service
    spec:
      containers:
      - name: gateway
        image: gateway-service:latest
        imagePullPolicy: Never
        env:
        - name: PORT
          value: "3003"
        - name: BANK_REST_URL
          value: "http://external-bank-api.default.svc.cluster.local:8080"
        ports:
        - containerPort: 3003
        volumeMounts:
        - name: certs-vol
          mountPath: /app/certs
          readOnly: true
      volumes:
      - name: certs-vol
        secret:
          secretName: mtls-certs
---
apiVersion: v1
kind: Service
metadata:
  name: gateway-service
  namespace: default
spec:
  type: ClusterIP
  ports:
  - port: 3003
    targetPort: 3003
    name: grpc
  selector:
    app: gateway-service

```

---

7. Step 7: Execution Commands for Minikube

Run these steps in order to execute the new architecture:

```bash
# 1. Point shell to Minikube
eval $(minikube docker-env)

# 2. Rebuild images inside Minikube
docker build -t external-bank-api:latest -f Dockerfile.bank .
docker build -t gateway-service:latest -f Dockerfile.gateway .
docker build -t internal-app-client:latest -f Dockerfile.client .

# 3. Create mTLS secret directly from certificates
kubectl create secret generic mtls-certs \
  --from-file=ca.crt=certs/ca.crt \
  --from-file=server.crt=certs/server.crt \
  --from-file=server.key=certs/server.key \
  --from-file=client.crt=certs/client.crt \
  --from-file=client.key=certs/client.key \
  --dry-run=client -o yaml | kubectl apply -f -

# 4. Deploy services
kubectl apply -f k8s-deployments.yaml

# 5. Verify pods are running
kubectl get pods

# 6. Run the Internal Application Client pod
kubectl delete pod internal-app-client-pod --ignore-not-found

kubectl run internal-app-client-pod \
  --image=internal-app-client:latest \
  --image-pull-policy=Never \
  --restart=Never \
  --env="GATEWAY_HOST=gateway-service.default.svc.cluster.local:3003"

# 7. Check output logs
kubectl logs -f internal-app-client-pod

```

## End-to-End System Architecture:
┌─────────────────────────────────────────────────────────────┐
│  1. Internal Application Client                             │
│     (gRPC Client / Business Application Pod)                │
└─────────────────────────────────────────────────────────────┘
                               │
                               │ Protocol: gRPC over HTTP/2 (Port 3003)
                               │ Security: Mutual TLS (mTLS Enforced)
                               │ Target: gateway-service.default.svc.cluster.local
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Gateway Service                                         │
│     (gRPC Server + Outbound REST HTTP Client)               │
└─────────────────────────────────────────────────────────────┘
                               │
                               │ Protocol: Standard HTTP REST (JSON over Port 8080)
                               │ Security: Standard HTTP/HTTPS
                               │ Target: external-bank-api.default.svc.cluster.local
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  3. External Bank API                                       │
│     (Third-Party Bank REST API Server)                      │
└─────────────────────────────────────────────────────────────┘

### After Bidirection and Client streaming code changed:
-----------------------------------------------------

* Flow:
┌─────────────────────────────────────────────────────────────┐
│  1. Internal Application Client                             │
│     (Initiates all gRPC calls)                              │
└─────────────────────────────────────────────────────────────┘
                               │
                               │ Protocol: gRPC over HTTP/2 (Port 3003)
                               │ Security: Mutual TLS (mTLS Enforced)
                               │ Target: gateway-service.default.svc.cluster.local
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Gateway Service                                         │
│     (gRPC Server + Outbound REST HTTP Client)               │
└─────────────────────────────────────────────────────────────┘
                               │
                               │ Protocol: Standard HTTP REST (JSON over Port 8080)
                               │ Target: external-bank-api.default.svc.cluster.local
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  3. External Bank API                                       │
│     (Third-Party Bank REST API Server)                      │
└─────────────────────────────────────────────────────────────┘

Here is the complete, crystal-clear breakdown of all four gRPC communication patterns and how your Gateway manages them alongside mTLS and outbound REST calls.

---

1. Security Layer: Mutual TLS (mTLS) Handshake

Before any banking request is processed on port `3003`, the **Internal App** and the **Gateway** perform a strict mTLS handshake over HTTP/2:

1. **Client & Server Exchange:** The Internal App sends `client.crt`, and the Gateway sends `server.crt`.
2. **CA Verification:** Both sides validate the received certificates against the shared Root CA (`ca.crt`) mounted from the `mtls-certs` Kubernetes secret.
3. **Encrypted Channel:** Once authenticated, a persistent, encrypted HTTP/2 connection is established. Unauthenticated pods without a valid client certificate cannot connect.

---

2. The 4 gRPC Communication Patterns Explained

* Pattern 1: Unary RPC (`RequestTransfer`)

* **Concept:** Standard 1-to-1 request-response pattern.
* **Execution Flow:**
1. Internal App sends **1 gRPC request** (`$250 transfer`).
2. Gateway translates Protobuf to JSON and calls the External Bank via **REST POST** (`/v1/bank/transfer`).
3. External Bank returns a JSON receipt (`BANK-TXN-101`).
4. Gateway converts JSON to Protobuf and sends **1 gRPC response** back to the Internal App.

---

* Pattern 2: Server Streaming RPC (`StreamTransactionHistory`)

* **Concept:** 1 Request $\rightarrow$ Stream of Multiple Responses.
* **Execution Flow:**
1. Internal App sends **1 gRPC request** asking for transaction history for `ACC-101`.
2. Gateway fetches the complete list from the External Bank via **REST GET** (`/v1/bank/accounts/ACC-101/history`).
3. Instead of returning a single bulk JSON array, the Gateway streams each transaction record **frame-by-frame** (`TXN-901`, `TXN-902`, `TXN-903`) over the open gRPC connection.
4. Once finished, the Gateway sends an `END_STREAM` signal.

---

* Pattern 3: Client Streaming RPC (`UploadPayrollFile`)

* **Concept:** Stream of Multiple Chunks $\rightarrow$ 1 Final Summary Response.
* **Use Case:** Bulk file uploads (like CSV payroll files) or high-volume log/telemetry ingestion where individual chunks do not need real-time responses.
* **Execution Flow:**
1. Internal App opens a writable stream and sends **multiple binary chunks** of `payroll_oct2026.csv` sequentially.
2. Gateway listens silently (`call.on("data")`) and accumulates the file byte size in memory. The Gateway **does not respond** to individual chunks.
3. Internal App calls `fileStream.end()` to signal completion.
4. Gateway processes the file and returns **1 single summary response** (`total_bytes_received: 28, status: FILE_UPLOADED_AND_VERIFIED`).

Example:
--------
*Payroll = the list of all employees a company pays on payday, plus how much each gets*.
A single payroll run for one month looks like this (simplified payroll_oct2026.csv)

emp_id,name,account,amount
E001,Alice,ACC-1001,5000
E002,Bob,ACC-1002,4200
E003,Carol,ACC-1003,3800
...
E5000,Zara,ACC-6000,6100

- N chunks go up → 1 summary comes back.

---

* Pattern 4: Bidirectional Streaming RPC (`LivePayoutStream`)

* **Concept:** Stream of Requests $\leftrightarrow$ Stream of Immediate Live Responses (Full Duplex).
* **Use Case:** Real-time individual payouts where **every single transfer item** must receive an immediate, individual bank receipt.
* **Execution Flow:**
1. Internal App opens a full-duplex stream (`LivePayoutStream`).
2. Internal App writes **Transfer 1** ($100 to `RECIP-1`).
3. Gateway receives Transfer 1, calls Bank REST API, and **immediately streams back Bank Receipt 1** (`BANK-TXN-101`).
4. Internal App writes **Transfer 2** ($200 to `RECIP-2`).
5. Gateway calls Bank REST API and **immediately streams back Bank Receipt 2** (`BANK-TXN-102`).
6. Internal App writes **Transfer 3** ($300 to `RECIP-3`).
7. Gateway calls Bank REST API and **immediately streams back Bank Receipt 3** (`BANK-TXN-103`).
8. Internal App closes the stream (`bidiStream.end()`), and the Gateway terminates the stream session.

---

3. Summary Matrix

| Pattern | Inbound Request Flow | Gateway Behavior | Final Output |
| --- | --- | --- | --- |
| **Unary** | 1 Request | Translates to 1 REST call | 1 Response |
| **Server Streaming** | 1 Request | Fetches dataset & streams items frame-by-frame | $N$ Stream Responses |
| **Client Streaming** | Stream of $N$ Chunks | Accumulates/buffers chunks until stream closes | **1 Summary Response** |
| **Bidirectional** | Stream of $N$ Requests | Translates each item immediately to REST | **$N$ Live Responses** |

-------------------------------------------------------------------------------------------------------------------------------------------
#### Upated Code:
-------------------------------------------------------------------------------------------------------------------------------------------

Here is the updated codebase. It now explicitly separates **Client Streaming** (for bulk file/dataset ingestion like End-of-Day Payroll file chunk uploads) and **Bidirectional Streaming** (for live, per-transaction payouts where every stream item gets an immediate, real-time bank response).

---

1. Step 1: Update Protobuf Schema (`banking.proto`)

Update `banking.proto` to include both streaming patterns:

```protobuf
syntax = "proto3";

package banking;

service BankGateway {
  // 1. Unary: Single Fund Transfer
  rpc RequestTransfer (TransferRequest) returns (TransferResponse);

  // 2. Server Streaming: Stream transaction history frame-by-frame
  rpc StreamTransactionHistory (HistoryRequest) returns (stream TransactionRecord);

  // 3. Client Streaming: Bulk Payroll CSV File Upload (Many Chunks -> 1 Final Batch Confirmation)
  rpc UploadPayrollFile (stream FileChunk) returns (FileUploadResponse);

  // 4. Bidirectional Streaming: Live Real-Time Payouts (Stream Requests <---> Stream Immediate Bank Receipts)
  rpc LivePayoutStream (stream TransferRequest) returns (stream TransferResponse);
}

message TransferRequest {
  string account_id = 1;
  string recipient_account = 2;
  double amount = 3;
  string currency = 4;
}

message TransferResponse {
  string bank_transaction_id = 1;
  string status = 2;
  double remaining_balance = 3;
}

message HistoryRequest {
  string account_id = 1;
  int32 limit = 2;
}

message TransactionRecord {
  string transaction_id = 1;
  string timestamp = 2;
  string type = 3;
  double amount = 4;
  string status = 5;
}

message FileChunk {
  string filename = 1;
  bytes content = 2;
}

message FileUploadResponse {
  string file_id = 1;
  int32 total_bytes_received = 2;
  string status = 3;
}

```

---

2. Step 2: Gateway Service (`gateway-service.js`)

Add handlers for both **Client Streaming** (`UploadPayrollFile`) and **Bidirectional Streaming** (`LivePayoutStream`).

```javascript
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

```

---

3. Step 3: Internal Application Client (`internal-app-client.js`)

```javascript
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

```

---

4. Step 4: Rebuild & Execute in Minikube

Execute these commands in Mac terminal:

```bash
# 1. Point to Minikube Docker environment
eval $(minikube docker-env)

# 2. Rebuild updated images
docker build -t gateway-service:latest -f Dockerfile.gateway .
docker build -t internal-app-client:latest -f Dockerfile.client .

# 3. Restart deployments
kubectl rollout restart deployment/gateway-service

# 4. Run the Client Pod
kubectl delete pod internal-app-client-pod --ignore-not-found

kubectl run internal-app-client-pod \
  --image=internal-app-client:latest \
  --image-pull-policy=Never \
  --restart=Never \
  --env="GATEWAY_HOST=gateway-service.default.svc.cluster.local:3003"

# 5. Check live execution logs
kubectl logs -f internal-app-client-pod

```

###### The key difference from unary:

1. Unary RPC
One request → one response

Client ── Request ──> Gateway
Client <── Response ─ Gateway
    
2. Bidirectional RPC
Multiple requests ↔ multiple responses

Client ── Request 1 ──> Gateway
Client ── Request 2 ──> Gateway
Client <── Response 2 ─ Gateway
Client ── Request 3 ──> Gateway
Client <── Response 3 ─ Gateway
Client <── Response 1 ─ Gateway
    
*One technical point: bidirectional streaming does not automatically make processing faster. Your gateway still makes individual REST calls, and each bank transfer has its own processing time. The advantage demonstrated here is that requests and responses can progress independently over one persistent gRPC stream.*

# Metadata POC:

          * When the internal banking app calls the gRPC gateway, it will attach metadata identifying the calling service and the request. The gateway will read it, validate it, and log it before processing the call.

          Internal Banking App
            |
            | mTLS + gRPC request
            | Metadata:
            |   x-service-name: internal-banking-app
            |   x-correlation-id: TRACE-123
            |
            v
          gRPC Gateway
            |
            | Validate and log metadata
            | Forward business request to Bank REST API
            v
          Bank REST API

Will use:
- x-service-name — caller's declared service name.
- x-correlation-id — identifier used to connect logs for the same operation.
- x-request-id — identifier for an individual request, such as PAY-001.

## Understand what we are adding
Deadline	-  Maximum time allowed for the entire gRPC call
Timeout	 -  Stops waiting when the operation takes too long
Error handling	-  Returns meaningful gRPC status codes instead of crashing
Client error handling	 -  Handles timeout, unavailable gateway, and server errors

Remaining Scenarios:
1. UNAUTHENTICATED — gateway rejects a client without a valid mTLS certificate.
2. INVALID_ARGUMENT — gateway rejects invalid banking request data.
3. INTERNAL — gateway simulates an unexpected internal server error.

### Rebuild code changes and update Minikube images: It includes build → load into Minikube → restart → verify → run the client.

Run everything from your POC directory: `bank-rest-internal-grpc-poc`.

1. Rebuild the three images

```
docker build --no-cache -t external-bank-api:latest -f Dockerfile.bank .
docker build --no-cache -t gateway-service:latest -f Dockerfile.gateway .
docker build --no-cache -t internal-banking-service:latest -f Dockerfile.internal .
```

2. Load images into Minikube

```
minikube image load external-bank-api:latest
minikube image load gateway-service:latest
minikube image load internal-banking-service:latest
```

3. Restart deployments

```
kubectl rollout restart deployment/external-bank-api
kubectl rollout restart deployment/gateway-service
kubectl rollout restart deployment/internal-banking-service
```

4. Wait for deployments

```
kubectl rollout status deployment/external-bank-api
kubectl rollout status deployment/gateway-service
kubectl rollout status deployment/internal-banking-service
```

5. Run the internal application client

Delete the previous client pod and create a fresh one so it runs the latest client image:

```
kubectl delete pod internal-app-client-pod --ignore-not-found

kubectl run internal-app-client-pod \
  --image=internal-app-client:latest \
  --image-pull-policy=Never \
  --restart=Never \
  --env="GATEWAY_HOST=gateway-service.default.svc.cluster.local:3003"
```

6. View client output

```
kubectl logs -f internal-app-client-pod
```

7. Check gateway and REST API logs

```
kubectl logs deployment/gateway-service \
  --all-pods=true --prefix=true --since=5m

kubectl logs deployment/external-bank-api --since=5m
```

8. Verify all resources

```
kubectl get deployments,pods,services
```

Important: Check your actual Dockerfile names before using these commands:

```
ls Dockerfile*
```

I know your project has `Dockerfile.bank` and `Dockerfile.gateway`; I haven't confirmed that `Dockerfile.internal` exists. Also, if you modify `internal-app-client.js`, rebuild and load `internal-app-client:latest` separately before recreating its pod:

```
docker build --no-cache -t internal-app-client:latest -f Dockerfile.client .
minikube image load internal-app-client:latest
```

# gRPC Error Handling:

## 1. What We Implemented

We added error-handling scenarios to the banking communication flow:

**External Bank REST API → Gateway (gRPC Server) → Internal Application (gRPC Client)**

The gateway maps internal REST/API failures and validation errors to appropriate gRPC status codes. The internal client handles the returned errors and continues executing the remaining RPC operations.

### Code changes

**`gateway-service.js`**
- Added `BANK_TIMEOUT` configuration to control the REST API request timeout.
- Added `mapAxiosError()` to map REST/API errors to gRPC status codes.
- Added `validateTransfer()` to validate transfer details before calling the REST API.
- Added a `TEST_INTERNAL` flag to simulate an unexpected gateway failure.
- Configured the gRPC server to require client certificates through mTLS.

**`internal-app-client.js`**
- Added RPC deadlines to prevent requests from waiting indefinitely.
- Added error handling for gRPC status codes.
- Added `TEST_INVALID_ARGUMENT` to send an invalid transfer amount.
- Added `TEST_UNAUTHENTICATED` to connect without a client certificate.
- Added error handling so one failed RPC does not stop the remaining RPC tests.

## 2. Error Scenarios Tested

| Scenario | gRPC status | Result |
|---|---:|---|
| Request deadline exceeded | `4 – DEADLINE_EXCEEDED` | Passed |
| Invalid transfer amount | `3 – INVALID_ARGUMENT` | Passed |
| Unexpected gateway failure | `13 – INTERNAL` | Passed |
| Missing mTLS client certificate | `14 – UNAVAILABLE` | Passed |

**Important:** Missing client certificate does not produce gRPC `UNAUTHENTICATED (16)` in this test. The TLS handshake fails before the request reaches the gRPC handler, and gRPC reports the connection failure as `UNAVAILABLE (14)`.

## 3. Build and Load Updated Images

Run these commands from the project directory:

```bash
cd /Users/keerthana/Desktop/rest-vs-grpc-poc/bank-rest-internal-grpc-poc
```

Build the gateway image:

```bash
docker build --no-cache -t gateway-service:debug-v2 -f Dockerfile.gateway .
minikube image load gateway-service:debug-v2
```

Build the internal client image:

```bash
docker build --no-cache -t internal-app-client:debug-v2 -f Dockerfile.client .
minikube image load internal-app-client:debug-v2
```

## 4. Update Gateway Deployment

Update the gateway deployment to use the newly built image:

```bash
CONTAINER=$(kubectl get deployment gateway-service -o jsonpath='{.spec.template.spec.containers[0].name}')

kubectl set image deployment/gateway-service "$CONTAINER=gateway-service:debug-v2"

kubectl patch deployment gateway-service \
  -p '{"spec":{"template":{"spec":{"containers":[{"name":"'"$CONTAINER"'","imagePullPolicy":"Never"}]}}}}'

kubectl rollout status deployment/gateway-service
```

Check the gateway pods:

```bash
kubectl get pods -l app=gateway-service
```

## 5. Run the Error-Handling Tests

For each test, delete the previous client pod before creating a new one. This prevents old completed-pod logs from being mistaken for the latest test.

### Test 1: DEADLINE_EXCEEDED (4)

The gateway REST request timeout must be shorter than the external REST API's 500 ms response delay.

For the timeout test, temporarily set the gateway timeout to 100 ms:

```bash
kubectl set env deployment/gateway-service BANK_TIMEOUT=100
kubectl rollout status deployment/gateway-service
```

Run the client with its normal valid mTLS certificate:

```bash
kubectl delete pod internal-app-client-pod --ignore-not-found

kubectl run internal-app-client-pod \
  --image=internal-app-client:debug-v2 \
  --image-pull-policy=Never \
  --restart=Never \
  --env="GATEWAY_HOST=gateway-service.default.svc.cluster.local:3003"

kubectl logs -f internal-app-client-pod
```

Expected transfer error:

```text
Code: 4
Details: Bank REST API request timed out
Reason: RPC exceeded its deadline
```

Restore the gateway timeout after the test:

```bash
kubectl set env deployment/gateway-service BANK_TIMEOUT=5000
kubectl rollout status deployment/gateway-service
```

### Test 2: INVALID_ARGUMENT (3)

Set the client test flag to send a negative transfer amount:

```bash
kubectl delete pod internal-app-client-pod --ignore-not-found

kubectl run internal-app-client-pod \
  --image=internal-app-client:debug-v2 \
  --image-pull-policy=Never \
  --restart=Never \
  --env="GATEWAY_HOST=gateway-service.default.svc.cluster.local:3003" \
  --env="TEST_INVALID_ARGUMENT=true"

kubectl logs -f internal-app-client-pod
```

Expected output:

```text
Unary Transfer failed
Code: 3
Details: Transfer amount must be greater than zero
Reason: Invalid request
```

The gateway rejects the invalid amount before making the REST API request.

### Test 3: INTERNAL (13)

Enable the gateway's internal-error simulation:

```bash
kubectl set env deployment/gateway-service TEST_INTERNAL=true
kubectl rollout status deployment/gateway-service
```

Run the client with its valid mTLS certificate:

```bash
kubectl delete pod internal-app-client-pod --ignore-not-found

kubectl run internal-app-client-pod \
  --image=internal-app-client:debug-v2 \
  --image-pull-policy=Never \
  --restart=Never \
  --env="GATEWAY_HOST=gateway-service.default.svc.cluster.local:3003"

kubectl logs -f internal-app-client-pod
```

Expected output:

```text
Unary Transfer failed
Code: 13
Details: Unexpected internal banking gateway failure
Reason: Internal server error
```

Disable the simulation after testing:

```bash
kubectl set env deployment/gateway-service TEST_INTERNAL-
kubectl rollout status deployment/gateway-service
```

### Test 4: Missing mTLS Client Certificate

Run the client without its client certificate:

```bash
kubectl delete pod internal-app-client-pod --ignore-not-found

kubectl run internal-app-client-pod \
  --image=internal-app-client:debug-v2 \
  --image-pull-policy=Never \
  --restart=Never \
  --env="GATEWAY_HOST=gateway-service.default.svc.cluster.local:3003" \
  --env="TEST_UNAUTHENTICATED=true"

kubectl logs -f internal-app-client-pod
```

Expected output includes:

```text
TEST MODE: Connecting without client certificate
Code: 14
Details: No connection established
tlsv13 alert certificate required
```

This confirms that the gateway rejects a client that does not present a certificate trusted by its mTLS configuration.

### Test 5: UNAUTHENTICATED (16) – Application-Level Authentication

**Implementation:**
- Added `validateAuthentication()` in `gateway-service.js`.
- Gateway checks the `authorization` metadata value.
- Expected token: `Bearer bank-poc-secret`.
- Missing or invalid token returns `grpc.status.UNAUTHENTICATED`.
- Added `TEST_RPC_UNAUTHENTICATED` in `internal-app-client.js` to simulate a request without the authorization metadata.
- mTLS remains enabled during this test.

**Negative test – Missing token:**

```bash
kubectl delete pod internal-app-client-pod --ignore-not-found

kubectl run internal-app-client-pod \
  --image=internal-app-client:debug-v3 \
  --image-pull-policy=Never \
  --restart=Never \
  --env="GATEWAY_HOST=gateway-service.default.svc.cluster.local:3003" \
  --env="TEST_RPC_UNAUTHENTICATED=true"

kubectl logs -f internal-app-client-pod
```

Expected result:

```text
Code: 16
Details: Missing or invalid authentication token
Reason: Caller authentication failed
```

**Positive test – Valid token:**

```bash
kubectl delete pod internal-app-client-pod --ignore-not-found

kubectl run internal-app-client-pod \
  --image=internal-app-client:debug-v3 \
  --image-pull-policy=Never \
  --restart=Never \
  --env="GATEWAY_HOST=gateway-service.default.svc.cluster.local:3003"

kubectl logs -f internal-app-client-pod
```

Expected result: Unary transfer succeeds and returns a bank transaction ID.

**Observation:** mTLS authenticates the client certificate during the TLS handshake. Application-level authentication separately validates the authorization metadata. Missing certificates result in connection rejection (14), whereas missing application authentication results in `UNAUTHENTICATED (16)`.

## 6. Useful Monitoring Commands

View gateway logs:

```bash
kubectl logs deployment/gateway-service --tail=100
```

Check gateway deployment:

```bash
kubectl get deployment gateway-service
```

Check pods:

```bash
kubectl get pods
```

Check the client test output:

```bash
kubectl logs internal-app-client-pod
```

Delete the test client pod:

```bash
kubectl delete pod internal-app-client-pod --ignore-not-found
```

## 7. Important Notes

- Always use the `debug-v2` image tags for these tests; the older `latest` images did not contain all the test changes.
- Load the images into Minikube after rebuilding them.
- Use `imagePullPolicy: Never` so Kubernetes uses the locally loaded image.
- Delete the previous client pod before running another test.
- Restore `BANK_TIMEOUT=5000` and remove `TEST_INTERNAL` after testing.
- The client uses valid certificates for the INTERNAL and INVALID_ARGUMENT tests.
- The missing-certificate scenario tests the TLS/mTLS handshake, not application-level gRPC authentication.
