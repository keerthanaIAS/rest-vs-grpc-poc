# Keep your existing project. Make these additions/changes:
stage2-grpc-poc/
├── shared/
│   └── bridge.proto
│
├── client/
│   ├── app/
│   │   ├── api/
│   │   │   └── grpc/
│   │   │       └── [service]/
│   │   │           └── [...path]/
│   │   │               └── route.ts       NEW
│   │   └── page.tsx                       UNCHANGED
│   └── lib/
│       ├── api.ts                         UPDATE
│       └── grpc-client.ts                 NEW
│
├── user-server/
│   └── src/server.js                      KEEP
│
└── payment-server/
    └── src/server.js                      KEEP

Bitbucket Workspace
│
├── user-service
├── payment-service
├── account-service
├── banking-client
│
└── grpc-contracts             ← NEW REPOSITORY
    └── proto/
        └── bridge.proto

How will each repository use it?
1. Create grpc-contracts in Bitbucket.
2. Add your existing bridge.proto to it.
3. User service gets the contract from this repository.
4. Payment service gets the same contract.
5. Other services and the client get the same contract.

Why this approach?
- One .proto file to maintain.
- No copying into every repository.
- Changes are version-controlled.
- All microservices use the same contract.
- No separate running microservice is needed.

## Client-to-Server gRPC flow:

1. Next.js UI: Sends an HTTP request using Axios.
2. Next.js API route: Receives the request and extracts the service name, HTTP method, URL and payload.
3. gRPC client: Selects the appropriate backend server and converts request data into Protobuf Struct.
4. gRPC communication: Sends the request to the selected server (User: `5001`, Payment: `5002`).
5. Backend gRPC server: Decodes the request and invokes the existing Fastify route using `app.inject()`.
6. Response: Backend sends the result through gRPC back to the Next.js API route, which returns JSON to the browser.

Flow:

`Next.js UI → API Route → gRPC Client → Backend gRPC Server → Existing Fastify Route → Response back to Client`