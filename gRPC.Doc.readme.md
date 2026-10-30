# gRPC – Learning and Practical Implementation POC

## 1. Objective

The objective of this POC was to understand gRPC communication between microservices, explore HTTP/2, implement different RPC communication patterns, integrate mTLS security, and test gRPC error handling.

The POC uses a banking communication scenario:

**External Bank REST API → Gateway (gRPC Server) → Internal Banking Application (gRPC Client)**

The external application communicates with the gateway through REST, while the gateway and internal application communicate using gRPC over HTTP/2.

---

## 2. Concepts Learned

### 2.1 What is RPC?

RPC stands for Remote Procedure Call.

It allows one application to call a function or method running in another application over a network.

For example:

An internal banking application calls a `Transfer()` method on the gateway. The gateway processes the request and returns the result.

Instead of manually managing HTTP endpoints and JSON request/response handling, RPC provides a method-oriented communication model.

### 2.2 What is gRPC?

gRPC is a high-performance RPC framework developed by Google.

It uses:
- HTTP/2 as its transport protocol.
- Protocol Buffers (Protobuf) for serialization.
- `.proto` files to define services and message structures.
- Generated or dynamically loaded client/server interfaces to communicate between services.

### 2.3 What is Protocol Buffers?

Protocol Buffers (Protobuf) is a binary serialization format.

It converts structured data into a compact binary representation before transmission.

Example:

```protobuf
syntax = "proto3";

service BankingService {
  rpc Transfer (TransferRequest) returns (TransferResponse);
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
```

**What I learned:**
- `.proto` defines the service methods and message structures.
- Each field has a unique field number.
- Protobuf serializes messages into binary data.
- Both communicating services use the same service and message definitions.

### 2.4 HTTP/2 in gRPC

gRPC uses HTTP/2, which provides:

- Multiplexing: Multiple independent requests can share one TCP connection.
- Binary framing: HTTP/2 communicates using binary frames.
- Header compression: HPACK reduces repeated HTTP header overhead.
- Streaming: Data can be transferred continuously in both directions.
- Persistent connections: Connections can be reused across multiple RPC calls.

### 2.5 Multiplexing vs Sequential Calls

I explored two ways of making multiple RPC calls.

**Sequential execution using `await`:**

```javascript
await client.Transfer(request);
await client.GetHistory(request);
await client.UploadPayroll(request);
```

Each operation waits for the previous operation to finish.

**Concurrent execution using `Promise.all()`:**

```javascript
await Promise.all([
  client.Transfer(request),
  client.GetHistory(request),
  client.UploadPayroll(request)
]);
```

Multiple RPC calls can be in progress concurrently.

**What I learned:**
- Sequential execution is useful when one operation depends on another.
- Concurrent execution can reduce total waiting time when operations are independent.
- HTTP/2 multiplexing allows concurrent streams over one TCP connection.
- Multiplexing does not mean that all requests execute in parallel inside the server; server processing and resource limits still matter.

---

## 3. Four gRPC Communication Patterns

I implemented all four RPC communication patterns using the banking POC.

### 3.1 Unary RPC

<image-placeholder></image-placeholder>

**Communication:** One request → One response.

Example: Fund transfer.

1. Internal application sends transfer details.
2. Gateway processes the request.
3. Gateway calls the external bank REST API.
4. Gateway returns the transfer result.

```protobuf
rpc Transfer(TransferRequest) returns (TransferResponse);
```

**Use case:** Balance enquiry, fund transfer, account validation.

### 3.2 Server Streaming RPC

**Communication:** One request → Multiple responses.

Example: Transaction history.

1. Internal application requests transaction history.
2. Gateway retrieves the transaction records.
3. Gateway streams records one by one.
4. Client receives each record until the stream ends.

```protobuf
rpc GetHistory(HistoryRequest) returns (stream TransactionRecord);
```

**Use case:** Transaction history, event feeds, large result sets.

### 3.3 Client Streaming RPC

**Communication:** Multiple requests → One response.

Example: Payroll upload.

1. Internal application sends payroll records in multiple messages.
2. Gateway receives the records through one stream.
3. Gateway processes the uploaded records.
4. Gateway returns one final response after the stream ends.

```protobuf
rpc UploadPayroll(stream PayrollRecord) returns (PayrollResponse);
```

**Use case:** Bulk uploads, file processing, batch data submission.

### 3.4 Bidirectional Streaming RPC

**Communication:** Multiple requests ↔ Multiple responses.

Example: Live payout processing.

1. Internal application opens a bidirectional stream.
2. Client sends payout PAY-001.
3. Gateway processes it and sends a receipt.
4. Client sends PAY-002 while the stream remains open.
5. Gateway sends another receipt.
6. The process continues until all payouts are completed.

```protobuf
rpc LivePayout(stream PayoutRequest) returns (stream PayoutReceipt);
```

**Use case:** Live payment processing, real-time updates, interactive communication.

### Streaming Summary

| RPC pattern | Client sends | Server returns |
|---|---|---|
| Unary | One message | One message |
| Server streaming | One message | Multiple messages |
| Client streaming | Multiple messages | One message |
| Bidirectional streaming | Multiple messages | Multiple messages |

---

## 4. Practical Implementation

### Architecture

```text
External Bank API
       |
       | REST / HTTP
       v
   gRPC Gateway
       |
       | gRPC over HTTP/2
       | mTLS
       v
 Internal Application
       |
       +-- Unary Transfer
       |
       +-- Server Streaming (History)
       |
       +-- Client Streaming (Payroll)
       |
       +-- Bidirectional Streaming (Live Payout)
```

### Main files

| File | Purpose |
|---|---|
| `banking.proto` | Defines gRPC services and messages |
| `external-bank-api.js` | Simulates the external bank REST API |
| `gateway-service.js` | gRPC server and REST-to-gRPC integration |
| `internal-app-client.js` | Internal gRPC client and RPC tests |
| `Dockerfile.bank` | Builds external bank API image |
| `Dockerfile.gateway` | Builds gateway image |
| `Dockerfile.client` | Builds internal client image |

### What I implemented

- Created an external bank REST API.
- Created a gRPC gateway to communicate with the internal application.
- Defined banking RPC methods and messages using Protobuf.
- Implemented unary, server streaming, client streaming, and bidirectional streaming.
- Integrated mTLS between the gateway and internal application.
- Tested sequential and concurrent RPC execution.
- Added deadlines and error handling.
- Added application-level authentication using gRPC metadata.
- Deployed and tested the services in Minikube.

---

## 5. Security: mTLS and Application Authentication

### 5.1 What is mTLS?

mTLS stands for Mutual Transport Layer Security.

In normal TLS, the client verifies the server certificate.

In mTLS, both sides authenticate each other using certificates.

In this POC:

1. Internal application connects to the gateway.
2. Gateway presents its server certificate.
3. Internal application verifies the gateway certificate.
4. Internal application presents its client certificate.
5. Gateway verifies the client certificate.
6. If verification succeeds, the gRPC connection is established.

The gateway requires a client certificate using:

```javascript
grpc.ServerCredentials.createSsl(
  rootCa,
  [{ cert_chain: serverCert, private_key: serverKey }],
  true
);
```

The final `true` enables mandatory client certificate authentication.

### 5.2 Application-Level Authentication

In addition to mTLS, I implemented application-level authentication using gRPC metadata.

Example:

```javascript
const metadata = new grpc.Metadata();

metadata.add(
  "authorization",
  "Bearer bank-poc-secret"
);
```

The gateway validates the authorization metadata before processing the transfer.

**Difference:**

| mTLS | Application authentication |
|---|---|
| Verifies client certificate | Verifies authorization token |
| Happens during TLS handshake | Happens after connection establishment |
| Protects transport identity | Controls application-level access |

---

## 6. gRPC Deadlines and Error Handling

### 6.1 What is a deadline?

A deadline defines the maximum time allowed for an RPC to complete.

Example:

```javascript
client.Transfer(
  request,
  metadata,
  { deadline: Date.now() + 5000 },
  callback
);
```

If the operation does not complete within the allowed time, the RPC can fail with `DEADLINE_EXCEEDED`.

Deadlines help prevent clients from waiting indefinitely.

### 6.2 Error Handling Implemented

I implemented and tested the following scenarios.

| gRPC code | Status | Meaning | POC test |
|---:|---|---|---|
| 0 | OK | Operation successful | Valid transfer |
| 3 | INVALID_ARGUMENT | Invalid request data | Negative transfer amount |
| 4 | DEADLINE_EXCEEDED | Operation exceeded its time limit | REST API timeout |
| 13 | INTERNAL | Unexpected internal server failure | Simulated gateway failure |
| 14 | UNAVAILABLE | Service/connection unavailable | Missing mTLS client certificate |
| 16 | UNAUTHENTICATED | Authentication failed | Missing authorization token |

### 6.3 Scenario 1: INVALID_ARGUMENT (3)

**Test:** Send a negative transfer amount.

Test flag:

```bash
TEST_INVALID_ARGUMENT=true
```

Expected response:

```text
Code: 3
Details: Transfer amount must be greater than zero
```

**Learning:** Validate incoming request data before calling the external REST API.

### 6.4 Scenario 2: DEADLINE_EXCEEDED (4)

**Test:** Configure the gateway REST timeout to 100 ms while the external REST API takes 500 ms.

```bash
kubectl set env deployment/gateway-service BANK_TIMEOUT=100
kubectl rollout status deployment/gateway-service
```

Expected response:

```text
Code: 4
Details: Bank REST API request timed out
```

Restore the timeout:

```bash
kubectl set env deployment/gateway-service BANK_TIMEOUT=5000
kubectl rollout status deployment/gateway-service
```

**Learning:** Deadlines and timeouts prevent long-running requests from consuming resources indefinitely.

### 6.5 Scenario 3: INTERNAL (13)

**Test:** Simulate an unexpected gateway failure.

Enable:

```bash
kubectl set env deployment/gateway-service TEST_INTERNAL=true
kubectl rollout status deployment/gateway-service
```

Expected response:

```text
Code: 13
Details: Unexpected internal banking gateway failure
```

Disable after testing:

```bash
kubectl set env deployment/gateway-service TEST_INTERNAL-
kubectl rollout status deployment/gateway-service
```

**Learning:** Internal errors should be returned using the appropriate gRPC status rather than leaving the client waiting.

### 6.6 Scenario 4: Missing mTLS Certificate (14)

**Test:** Connect without a client certificate.

```bash
TEST_UNAUTHENTICATED=true
```

Run the client pod with:

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

Expected result:

```text
Code: 14
tlsv13 alert certificate required
```

**Learning:** The gateway rejects the connection during the TLS handshake if the client certificate is missing. The gRPC service handler is never reached.

This is an mTLS handshake failure, not an application-level `UNAUTHENTICATED` response.

### 6.7 Scenario 5: UNAUTHENTICATED (16)

**Test:** Keep the mTLS client certificate but omit the authorization token.

```bash
TEST_RPC_UNAUTHENTICATED=true
```

Run:

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

Expected response:

```text
Code: 16
Details: Missing or invalid authentication token
```

**Positive test:** Run the client without `TEST_RPC_UNAUTHENTICATED=true`. The client sends the valid authorization metadata and the transfer succeeds.

**Learning:** A valid TLS connection does not automatically mean that the application request is authorized.

---

## 7. Final Test Results

| Test | Expected result | Actual result |
|---|---|---|
| Valid unary transfer | Successful transfer | Passed |
| Server streaming | Three history records received | Passed |
| Client streaming | Payroll uploaded and verified | Passed |
| Bidirectional streaming | Three payout receipts received | Passed |
| Sequential RPC execution | Calls execute one after another | Tested |
| Concurrent RPC execution | Independent calls execute concurrently | Tested |
| mTLS with valid certificate | Connection established | Passed |
| mTLS without client certificate | Connection rejected | Passed |
| INVALID_ARGUMENT (3) | Invalid transfer rejected | Passed |
| DEADLINE_EXCEEDED (4) | Timeout returned | Passed |
| INTERNAL (13) | Internal error returned | Passed |
| UNAVAILABLE (14) | Missing certificate connection rejected | Passed |
| UNAUTHENTICATED (16) | Missing token rejected | Passed |
| Valid application token | Transfer authorized | Passed |

---

## 8. REST vs gRPC – What I Learned

| REST over HTTP/1.1 | gRPC over HTTP/2 |
|---|---|
| Commonly uses JSON | Uses Protobuf by default |
| Text-based JSON payloads | Compact binary messages |
| Resource/endpoint-oriented | Method/RPC-oriented |
| HTTP/1.1 request-response model commonly used | Supports four RPC communication patterns |
| Multiple concurrent requests may use multiple connections | Multiplexes streams over a TCP connection |
| Manual API contract or OpenAPI | `.proto` service contract |
| Easy to inspect using curl/Postman | Usually needs a gRPC client/tool |

### gRPC advantages

- Efficient binary serialization.
- HTTP/2 multiplexing.
- Supports streaming communication.
- Strongly defined service contracts.
- Built-in deadlines and status codes.
- Suitable for service-to-service communication.

### gRPC disadvantages

- Binary payloads are less human-readable.
- Requires Protobuf definitions and client/server compatibility.
- Browser support is less straightforward than REST.
- Debugging can require specialized tools.
- Service and schema versioning need careful management.

---

## 9. Final Learning Outcome

Through this POC, I learned how microservices communicate using RPC and how gRPC uses HTTP/2 and Protocol Buffers for efficient service-to-service communication. I implemented and tested all four RPC communication patterns: unary, server streaming, client streaming, and bidirectional streaming. I also explored sequential versus concurrent RPC execution, HTTP/2 multiplexing, deadlines, error handling, mTLS authentication, and application-level authentication using metadata. Finally, I tested the main gRPC error scenarios, including `INVALID_ARGUMENT`, `DEADLINE_EXCEEDED`, `INTERNAL`, `UNAVAILABLE`, and `UNAUTHENTICATED`, and compared REST over HTTP/1.1 with gRPC over HTTP/2.