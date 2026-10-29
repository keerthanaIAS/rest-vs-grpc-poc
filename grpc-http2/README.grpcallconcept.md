# Terminal Logs:
keerthana@Keerthanas-MacBook-Air grpc-http2 % node grpc-all-concepts.js
=================================
gRPC COMPLETE LEARNING POC
=================================
Service 2 running at 127.0.0.1:3003 port 3003
Service 2: Add(10, 20)

--- UNARY ---
Request: 10 + 20
Response: 30
Duration: 28 ms

--- CONNECTION REUSE ---
Service 2: Add(1, 1)
Service 2: Add(2, 2)
Service 2: Add(3, 3)
Service 2: Add(4, 4)
Service 2: Add(5, 5)
Request 1: result=2
Request 2: result=4
Request 3: result=6
Request 4: result=8
Request 5: result=10
Completed requests: 5
Elapsed: 6 ms
All calls use the same gRPC client/channel

--- MULTIPLEXING ---
Service 2: Add(1, 100)
Service 2: Add(2, 100)
Service 2: Add(3, 100)
Service 2: Add(4, 100)
Service 2: Add(5, 100)
Service 2: Add(6, 100)
Service 2: Add(7, 100)
Service 2: Add(8, 100)
Service 2: Add(9, 100)
Service 2: Add(10, 100)
Results: [
  101, 102, 103, 104,
  105, 106, 107, 108,
  109, 110
]
Completed: 10 concurrent RPCs
Elapsed: 9 ms
Multiple RPCs share the HTTP/2 connection

--- CLIENT STREAMING ---
Service 2 received request 1: 10 + 20
Service 2 received request 2: 30 + 40
Service 2 received request 3: 50 + 60
Client streaming completed
Server received multiple requests
Final total: 210

--- SERVER STREAMING ---
Service 2 sending 5 responses
Received: 1
Received: 2
Received: 3
Received: 4
Received: 5
Server stream completed

--- BIDIRECTIONAL STREAMING ---
Service 2 received: Hello
Service 2 received: How are you?
Service 2 received: Explain gRPC
Bidirectional stream completed
Client received: Service 2 received: Hello
Client received: Service 2 received: How are you?
Client received: Service 2 received: Explain gRPC
Chat completed

--- ERROR HANDLING ---
Service 2: Add(10, 20)
RPC succeeded: 30

--- DEADLINE / TIMEOUT ---
Request failed: 4 DEADLINE_EXCEEDED: Deadline exceeded after 0.000s,remote_addr=127.0.0.1:3003
Status: DEADLINE_EXCEEDED

--- SECURITY / DEPLOYMENT ---
Protocol: HTTP/2
Serialization: Protobuf
Transport: TCP
Client authentication: Not enabled
TLS: Not enabled
Deployment: Local learning POC
Production should use TLS or mTLS credentials
Production should validate client identity
Production should configure server certificates
Production should use Kubernetes Service DNS

=================================
ALL CONCEPTS COMPLETED
=================================
Server shutdown completed
keerthana@Keerthanas-MacBook-Air grpc-http2 % 

## What each section demonstrates:

| Concept                 | Practical demonstration                                        |
| ----------------------- | -------------------------------------------------------------- |
| Connection reuse        | 5 RPCs through the same client                                 |
| Multiplexing            | 10 concurrent RPCs using `Promise.all()`                       |
| Unary                   | One request → one response                                     |
| Client streaming        | Multiple requests → one response                               |
| Server streaming        | One request → multiple responses                               |
| Bidirectional streaming | Client and server exchange messages                            |
| Error handling          | RPC callback checks error status                               |
| Deadline                | Expired deadline produces a timeout                            |
| Protobuf                | `.proto` defines request, response and service                 |
| Security                | Shows current insecure local setup and production requirements |
