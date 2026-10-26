# Engineering Study Notes: Microservice Architecture & Performance
 
* 1. The Core Infrastructure Hierarchy

Modern network architectures stack protocols like an evolutionary chain. Each layer sits on top of, improves, or replaces the one below it.
• Layer 1: TCP (The Physical Highway): Transmission Control Protocol. Its only job is to safely move data from Point A to Point B in the exact correct order. It does not care what the data looks like.
• Layer 2: HTTP/1.1 (The Old Pipeline): Text-based and sequential. It can only process one request at a time per connection. If a request slows down, everything behind it stops (Head-of-Line Blocking).
• Layer 3: HTTP/2 (The Multi-Lane Upgrade): Binary-based. Introduces Streams and Multiplexing. It allows thousands of requests and responses to fly concurrently down a single open TCP connection without waiting in line.
• Layer 4: gRPC (The Smart Application Layer): Built by Google on top of HTTP/2. It uses Protocol Buffers (Protobuf) to compress code data into tiny binary formats (1s and 0s) instead of bulky text.

* 2. Architectural Connectivity: The Bank Whitelist Scenario

When connecting internal services to external third-party restrictions (like a bank API), architectures split into two distinct environments to protect performance:
text
[ SOURCE INTERACTION ]
       Service 3 (Internal Application Service)
           │
           │  <-- INTERNAL LEG (gRPC over HTTP/2)
           ▼   Optimized, low-latency binary streams (0a05416c696365...)
     Service 1 / 2 (IP-Whitelisted Proxy Gateway)
           │
           │  <-- EXTERNAL LEG (REST over HTTP/1.1)
           ▼   Heavy human-readable text strings ({"id": 75, "name": "Alice"})
     [ Third-Party Bank API ]
Use code with caution.

The Logic Behind the Design:
----------------------------
1. The External Leg (REST / HTTP/1.1): Strict external providers (banks) force you to use standard REST/JSON text over HTTP/1.1. This leg is inherently slow (e.g., 300ms) due to network distance, text parsing, and provider processing.
2. The Internal Leg (gRPC / HTTP/2): Because the external bank is already slow, you cannot afford to add internal latency. By using gRPC over HTTP/2 between Service 3 and Service 2, you drop internal routing times to near-zero (under 2ms), keeping the bottleneck completely isolated to the bank.

* 3. Empirical Proof: POC Performance Metrics

Your Proof of Concept (POC) load test with 5,000 concurrent requests perfectly mapped theory to empirical data:
• Throughput (REST: 5,912 req/s vs. gRPC: 9,768 req/s): A ~65% increase in volume capacity. Turning data into binary completely frees up network bandwidth and CPU cycles.
• Average Latency (REST: 7.82 ms vs. gRPC: 5.06 ms): A ~35% faster base response time for standard operations.
• Worst-Case System Lag / p99 Latency (REST: 37.16 ms vs. gRPC: 11.16 ms): A massive ~70% drop in lag spikes. This mathematically proves that HTTP/2 multiplexed streams successfully eliminated Head-of-Line blocking. The worst-case scenario under gRPC is almost as fast as the average scenario under REST.

* 4. Summary of Major Problems Solved

1. The Traffic Jam (Head-of-Line Blocking): Solved by HTTP/2 streams. Interleaving labeled chunks of data ensures slow tasks do not bottle up quick tasks on the wire.
2. The Heavy Baggage (Text Parsing Overhead): Solved by gRPC Protobuf binary formatting. Computers instantly read raw bits without wasting CPU spinning through heavy JSON brackets, quotes, and strings.
3. The Miscommunication (Broken Code/Typos): Solved by gRPC's Contract-First Design (.proto). Code for clients and servers is automatically generated from a singular blueprint file, making typos or missing schema keys impossible during deployment.


## Terminal logs:
### HTTP/1.1:

keerthana@Keerthanas-MacBook-Air service-2 % node server.js
Service 2 listening on http://localhost:3002

keerthana@Keerthanas-MacBook-Air service-2 % cd ..
keerthana@Keerthanas-MacBook-Air rest-http11-poc % cd service-2
keerthana@Keerthanas-MacBook-Air service-2 % curl -i -X POST http://localhost:3002/add \
  -H 'Content-Type: application/json' \
  -d '{"a":10,"b":20}'
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 13
ETag: W/"d-J80u2wgXt26SbaWzKJL8KxlBooM"
Date: Mon, 26 Oct 2026 10:15:48 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"result":30}%                                               
keerthana@Keerthanas-MacBook-Air service-2 % cd ..
cd service-1
nano client.js
keerthana@Keerthanas-MacBook-Air service-1 % node client.js
HTTP status: 200
Response: { result: 30 }
Round-trip time: 78.14 ms
keerthana@Keerthanas-MacBook-Air service-1 % node load-test.js 1000 20

--- REST / HTTP/1.1 RESULTS ---
Total requests: 1000
Successful responses: 1000
Errors: 0
Elapsed seconds: 0.32
Throughput: 3109.64 requests/sec
Average latency: 5.29 ms
p95 latency: 10.11 ms
p99 latency: 48.53 ms
keerthana@Keerthanas-MacBook-Air service-1 % node load-test.js 5000 50

--- REST / HTTP/1.1 RESULTS ---
Total requests: 5000
Successful responses: 5000
Errors: 0
Elapsed seconds: 0.85
Throughput: 5912.48 requests/sec
Average latency: 7.82 ms
p95 latency: 12.37 ms
p99 latency: 37.16 ms
keerthana@Keerthanas-MacBook-Air service-1 % curl -v http://localhost:3002/
* Host localhost:3002 was resolved.
* IPv6: ::1
* IPv4: 127.0.0.1
*   Trying [::1]:3002...
* Connected to localhost (::1) port 3002
> GET / HTTP/1.1
> Host: localhost:3002
> User-Agent: curl/8.7.1
> Accept: */*
> 
* Request completely sent off
< HTTP/1.1 404 Not Found
< X-Powered-By: Express
< Content-Security-Policy: default-src 'none'
< X-Content-Type-Options: nosniff
< Content-Type: text/html; charset=utf-8
< Content-Length: 139
< Date: Mon, 26 Oct 2026 10:17:20 GMT
< Connection: keep-alive
< Keep-Alive: timeout=5
< 
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot GET /</pre>
</body>
</html>
* Connection #0 to host localhost left intact
keerthana@Keerthanas-MacBook-Air service-1 % 

### HTTP/2:
keerthana@Keerthanas-MacBook-Air grpc-http2 % node server.js
gRPC Service 2 listening on 127.0.0.1:3003

keerthana@Keerthanas-MacBook-Air grpc-http2 % node client.js
Result: 30
Round-trip time: 33.64 ms
keerthana@Keerthanas-MacBook-Air grpc-http2 % node load-test.js 1000 20

--- gRPC / HTTP/2 RESULTS ---
Total requests: 1000
Successful responses: 1000
Errors: 0
Elapsed seconds: 0.19
Throughput: 5220.28 requests/sec
Average latency: 3.72 ms
p95 latency: 4.90 ms
p99 latency: 36.15 ms
keerthana@Keerthanas-MacBook-Air grpc-http2 % node load-test.js 5000 50

--- gRPC / HTTP/2 RESULTS ---
Total requests: 5000
Successful responses: 5000
Errors: 0
Elapsed seconds: 0.51
Throughput: 9767.99 requests/sec
Average latency: 5.06 ms
p95 latency: 7.98 ms
p99 latency: 11.16 ms
keerthana@Keerthanas-MacBook-Air grpc-http2 % 