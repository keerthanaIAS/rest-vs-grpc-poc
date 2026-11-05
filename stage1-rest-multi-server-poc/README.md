# Stage 1 is your working REST baseline.

## Stage 2 — REST outside, gRPC internally

Simplest architecture to evaluate
1. Axios request interceptor – identifies internal service requests.
2. Generic gRPC client – forwards the request.
3. One generic .proto contract – no individual business API definitions.
4. gRPC receiver inside the existing destination server.
5. fastify.inject() – invokes the existing REST route.
6. Axios response interceptor – converts the result back into the expected response shape.
No new server. No changes to controllers or route files.

# Generic REST-to-gRPC Adapter POC:

## 1. Overview

This POC demonstrates how existing Node.js microservices communicating through REST/Axios can communicate internally using gRPC without modifying individual business routes.

The objective is to introduce a generic gRPC communication layer that intercepts existing Axios HTTP requests, converts them into gRPC requests, and forwards them to the destination service.

The destination service executes its existing Fastify REST routes using `fastify.inject()`.

### Objectives

- Retain existing REST APIs and business logic.
- Avoid modifying individual Axios calls and business routes.
- Use one generic Protobuf contract for multiple HTTP endpoints.
- Replace internal REST network communication with gRPC.
- Support different HTTP methods and request payloads.
- Test standard APIs, background jobs, and file operations.

## 2. Architecture

```text
                    Browser / Postman
                           |
                           | REST
                           v
                  Payment Server :4002
                           |
                    Axios Interceptor
                           |
                    Generic gRPC RPC
                           |
                       Port 50051
                           |
                           v
                Transaction Server
                       :4003
                           |
                    gRPC Receiver
                           |
                    Fastify inject()
                           |
             ----------------------------
             |             |            |
         Transaction     Cron         Agenda
             APIs         Jobs         Jobs
                           |
                     File Operations
                     Upload / Download
```

### Communication flow

1. The client sends an HTTP request to Payment Server.
2. Payment Server executes its existing Axios request.
3. The Axios interceptor identifies requests targeting Transaction Server.
4. Instead of making a normal HTTP network request, the interceptor forwards the request through the generic gRPC RPC.
5. The Transaction Server's gRPC receiver receives the request.
6. The receiver converts the request into a Fastify injection.
7. The existing Transaction Server REST route executes.
8. The HTTP status and response are returned through gRPC.
9. Payment Server receives the response through Axios.

## 3. Project structure

```text
stage1-rest-multi-server-poc/
│
├── shared/
│   ├── grpc-bridge.js
│   └── bridge.proto
│
├── payment-server/
│   └── server.js
│
├── transaction-server/
│   ├── src/
│   │   ├── server.js
│   │   └── uploads/
│   │
│   └── package.json
│
└── README.md
```

Note: The exact file locations depend on the existing project structure. The Transaction Server upload directory is currently:

`transaction-server/src/uploads/`

## 4. Services and ports

| Service | Port | Communication |
|---|---:|---|
| User Server | 4001 | REST |
| Payment Server | 4002 | REST |
| Transaction Server | 4003 | REST route execution |
| Transaction gRPC Receiver | 50051 | Internal gRPC |

Payment Server uses the generic gRPC bridge to communicate with Transaction Server.

## 5. Existing APIs

### Payment Server – Port 4002

| Method | Endpoint | Description |
|---|---|---|
| GET | `/payments` | Retrieve payment records |
| POST | `/transfer` | Initiate a fund transfer |

### Transaction Server – Port 4003

| Method | Endpoint | Description |
|---|---|---|
| GET | `/transactions` | Retrieve transaction records |
| POST | `/transactions` | Create a transaction |

These existing routes are retained without individual business-route modifications.

## 6. Additional functional test APIs

All additional test APIs are exposed through Payment Server and forwarded to Transaction Server through the generic gRPC adapter.

### 6.1 Cron Job

Cron is used to execute a recurring background task at a specified interval.

**Start Cron**

```http
POST /test/cron/start
```

Request:

```json
{
  "intervalSeconds": 5
}
```

cURL:

```bash
curl -i -X POST http://localhost:4002/test/cron/start \
-H "Content-Type: application/json" \
-d '{"intervalSeconds":5}'
```

Expected response:

```json
{
  "success": true,
  "message": "Cron job started",
  "intervalSeconds": 5
}
```

**Check Cron Status**

```http
GET /test/cron/status
```

cURL:

```bash
curl http://localhost:4002/test/cron/status
```

Expected response:

```json
{
  "success": true,
  "running": true,
  "executionCount": 2
}
```

The execution count depends on elapsed time.

**Stop Cron**

```http
POST /test/cron/stop
```

cURL:

```bash
curl -i -X POST http://localhost:4002/test/cron/stop \
-H "Content-Type: application/json" \
-d '{}'
```

Expected response:

```json
{
  "success": true,
  "message": "Cron job stopped",
  "executionCount": 44
}
```

**Verification**

```bash
curl http://localhost:4002/test/cron/status
```

Expected:

```json
{
  "success": true,
  "running": false,
  "executionCount": 44
}
```

Implementation:
- Package: `node-cron`
- Scheduling happens inside Transaction Server.
- Cron execution is independent of the browser request after scheduling.
- Current implementation uses an in-memory Cron task.

### 6.2 Agenda Background Job

Agenda is used to schedule background jobs with MongoDB persistence.

**Schedule Agenda Job**

```http
POST /test/agenda/schedule
```

Request:

```json
{
  "message": "Test transaction background processing",
  "delaySeconds": 10
}
```

cURL:

```bash
curl -i -X POST http://localhost:4002/test/agenda/schedule \
-H "Content-Type: application/json" \
-d '{
  "message": "Test transaction background processing",
  "delaySeconds": 10
}'
```

Expected response:

```json
{
  "success": true,
  "message": "Agenda job scheduled",
  "data": {
    "jobId": "generated-job-id",
    "scheduledAt": "2026-11-05T09:11:13.566Z",
    "delaySeconds": 10
  }
}
```

**MongoDB Configuration**

MongoDB connection:

```text
mongodb://127.0.0.1:27017/agenda-poc
```

Start MongoDB:

```bash
docker run -d \
--name agenda-mongo \
-p 27017:27017 \
mongo:7
```

If the container already exists:

```bash
docker start agenda-mongo
```

Start Transaction Server with:

```bash
MONGODB_URL=mongodb://127.0.0.1:27017/agenda-poc node server.js
```

**Verify Agenda Job**

Connect to MongoDB:

```bash
docker exec -it agenda-mongo mongosh agenda-poc
```

Execute:

```javascript
db.agendaJobs.find().pretty()
```

Verified job fields:

- `_id`
- `name`
- `data`
- `nextRunAt`
- `lastRunAt`
- `lastFinishedAt`

Observed successful execution:

```javascript
{
  name: 'poc-background-job',
  data: {
    message: 'Test transaction background processing'
  },
  nextRunAt: null,
  lastRunAt: ISODate('2026-11-05T09:11:13.571Z'),
  lastFinishedAt: ISODate('2026-11-05T09:11:13.575Z')
}
```

Implementation:
- Package: `agenda`
- MongoDB is used for job persistence.
- Job scheduling and execution happen inside Transaction Server.
- The scheduled job executes independently of the original HTTP request.

### 6.3 File Upload

File upload tests whether file content can be transferred from Payment Server to Transaction Server through the generic gRPC adapter.

**Endpoint**

```http
POST /test/files/upload
```

Request:

```json
{
  "fileName": "sample.txt",
  "mimeType": "text/plain",
  "contentBase64": "..."
}
```

**Create a sample file**

```bash
echo "Testing file transfer through generic gRPC adapter" > sample.txt
```

**Convert file to Base64**

```bash
BASE64_CONTENT=$(base64 < sample.txt | tr -d '\n')
```

**Upload file**

```bash
curl -sS -X POST http://localhost:4002/test/files/upload \
-H "Content-Type: application/json" \
-d "{\"fileName\":\"sample.txt\",\"mimeType\":\"text/plain\",\"contentBase64\":\"${BASE64_CONTENT}\"}" \
-o upload-response.json \
-w "\nHTTP %{http_code}\n"
```

Expected:

```text
HTTP 201
```

Expected response:

```json
{
  "success": true,
  "message": "File uploaded successfully",
  "data": {
    "id": "generated-uuid",
    "fileName": "sample.txt",
    "size": 51,
    "mimeType": "text/plain"
  }
}
```

**Retrieve uploaded file ID**

```bash
FILE_ID=$(node -p "require('./upload-response.json').data.id")

echo "$FILE_ID"
```

**Verify uploaded file on Transaction Server**

From the project root:

```bash
ls -lh transaction-server/src/uploads/
```

Files are stored inside the Transaction Server's `uploads` directory.

Implementation:
- File content is encoded using Base64.
- The content is sent as part of the JSON request body.
- Transaction Server decodes and stores the file content in a JSON metadata file.
- Maximum supported file size in this POC: 512 KB.

### 6.4 File Download

File download tests whether the uploaded file content can be retrieved from Transaction Server through the generic gRPC adapter.

**Endpoint**

```http
GET /test/files/:id/download
```

**Download file**

```bash
curl -sS \
"http://localhost:4002/test/files/${FILE_ID}/download" \
-o download-response.json \
-w "\nHTTP %{http_code}\n"
```

Expected:

```text
HTTP 200
```

**Decode downloaded file**

```bash
node -e '
const fs = require("fs");
const response = require("./download-response.json");
const file = response.data;

fs.writeFileSync(
  "downloaded-" + file.fileName,
  Buffer.from(file.contentBase64, "base64")
);

console.log("Downloaded:", file.fileName);
'
```

Expected:

```text
Downloaded: sample.txt
```

**Verify file integrity**

```bash
cmp sample.txt downloaded-sample.txt
```

Expected: No output.

**Compare SHA-256 hashes**

```bash
shasum -a 256 sample.txt downloaded-sample.txt
```

Verified output:

```text
61fd2a9a1d6734a2c4dce67d718d722f7aff0cd0a9d5e02a4ce1acbaf8350f16  sample.txt

61fd2a9a1d6734a2c4dce67d718d722f7aff0cd0a9d5e02a4ce1acbaf8350f16  downloaded-sample.txt
```

Matching hashes demonstrate that the downloaded content matches the original file.

## 7. Functional test results

The following tests were executed successfully.

| Test case | Expected HTTP status | Actual result | Status |
|---|---:|---|---|
| Create transfer | 201 | 201 | PASS |
| Invalid transfer amount | 400 | 400 | PASS |
| Transaction server unavailable | 502 | 502 | PASS |
| Cron start | 200 | 200 | PASS |
| Cron status | 200 | 200 | PASS |
| Cron stop | 200 | 200 | PASS |
| Agenda schedule | 201 | 201 | PASS |
| Agenda job execution | N/A | MongoDB execution confirmed | PASS |
| File upload | 201 | 201 | PASS |
| File download | 200 | 200 | PASS |
| File integrity | N/A | Matching SHA-256 | PASS |

Note: The original Cron stop request without a JSON content type returned HTTP 415. The test passed after sending `Content-Type: application/json` with an empty JSON body (`{}`).

## 8. Current implementation details

### Generic gRPC communication

- Payment Server uses Axios.
- An Axios interceptor identifies the Transaction Server HTTP origin.
- The interceptor forwards matching requests through the generic gRPC bridge.
- Transaction Server exposes a generic gRPC receiver.
- The receiver uses Fastify injection to execute existing REST routes.
- HTTP response status and payload are returned to Payment Server.

### Current communication model

```text
Axios HTTP Request
       |
       v
Axios Interceptor
       |
       v
Generic Protobuf RPC
       |
       v
gRPC Receiver
       |
       v
Fastify inject()
       |
       v
Existing REST Handler
       |
       v
HTTP Response
       |
       v
gRPC Response
       |
       v
Axios Response
```

## 9. Advantages demonstrated

1. Existing business routes remain unchanged.
2. Existing Axios-based service communication is retained.
3. A single generic Protobuf contract handles multiple endpoints.
4. No separate gateway service is required.
5. Different HTTP methods and status codes can be forwarded.
6. Background-job scheduling can be triggered through the adapter.
7. Base64-encoded file content can be transferred through the adapter.
8. Existing Fastify route handlers can be reused.

## 10. Current limitations

This is a functional POC, not a production-ready gRPC migration.

| Area | Current implementation | Limitation |
|---|---|---|
| RPC type | Unary RPC | No streaming implemented |
| Security | Insecure local gRPC credentials | No mTLS in this POC |
| Payload | JSON serialization | Additional serialization overhead |
| File upload | Base64 | Increased payload size |
| File download | Base64 | Not raw binary streaming |
| Cron | In-memory | Jobs are lost when the service restarts |
| Agenda | MongoDB persistence | Requires MongoDB availability |
| File storage | Local filesystem | No distributed or object storage |
| Performance | Not benchmarked | No measured performance improvement |

### Important technical notes

**1. File handling**

The current implementation transfers file content using Base64-encoded JSON.

This verifies small-file content preservation, but it does not demonstrate native binary streaming or multipart upload support.

**2. gRPC streaming**

The current POC uses unary RPC only.

It does not yet demonstrate:

- Client streaming.
- Server streaming.
- Bidirectional streaming.

**3. Security**

The current local POC uses insecure gRPC credentials. Production deployment requires appropriate transport security, authentication, authorization and service identity verification.

**4. Performance**

No conclusion about gRPC being faster than REST has been established yet.

Performance must be measured under identical workloads.

**5. Cron reliability**

The current Cron task exists in the Transaction Server process memory. Restarting the process removes the scheduled task.

Agenda provides persistent job storage, but production reliability still requires appropriate retry, locking, monitoring and failure-handling tests.

## 11. Current POC completion status

| Stage | Description | Status |
|---|---|---|
| Stage 1 | REST-based multi-server communication | Completed |
| Stage 2 | Generic REST-to-gRPC adapter | Functional |
| Stage 2 | Existing Axios integration | Tested |
| Stage 2 | Generic Protobuf request forwarding | Tested |
| Stage 2 | Existing Fastify route execution | Tested |
| Stage 2 | Cron job integration | Tested |
| Stage 2 | Agenda integration | Tested |
| Stage 2 | File upload and download | Tested |
| Stage 2 | File integrity verification | Tested |
| Next | REST vs generic gRPC performance comparison | Pending |
| Future | Raw binary and gRPC streaming tests | Pending |
| Future | mTLS and production security | Pending |

## 12. Conclusion

Stage 2 demonstrates that a generic gRPC adapter can be introduced into an existing Node.js microservice architecture while retaining existing Axios calls and Fastify business routes.

The implementation successfully forwards standard REST operations, triggers Cron and Agenda jobs, and transfers Base64-encoded file content between services.

The current implementation establishes functional compatibility across different API patterns.

However, it does not yet establish performance superiority, native gRPC streaming support, raw binary transfer, or production-grade security.

**Current milestone: Stage 2 – Generic REST-to-gRPC Functional POC Completed.**

**Next milestone: Controlled REST vs Generic gRPC Performance Evaluation.**