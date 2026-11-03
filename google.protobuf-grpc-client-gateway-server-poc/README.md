# Stage 1: Next.js → Axios → Fastify REST servers.

## Stack
- Next.js + TypeScript client
- Axios for HTTP requests
- Two independent Node.js + Fastify backend servers
- JavaScript controllers and Fastify routes
- In-memory sample data (resets when a server restarts)

## Architecture
Next.js client
  ├── Axios → User Fastify server (port 4001)
  └── Axios → Payment Fastify server (port 4002)

## Run
Open three terminals from this project root.

Terminal 1:
```bash
npm --prefix user-server install
npm run user
```

Terminal 2:
```bash
npm --prefix payment-server install
npm run payment
```

Terminal 3:
```bash
npm --prefix client install
npm run client
```

Open http://localhost:3000.

## Test cases
1. Click **Load users** — GET http://localhost:4001/users
2. Enter a name/email and click **Create user** — POST http://localhost:4001/users
3. Click **Load payments** — GET http://localhost:4002/payments
4. Enter amount and click **Create payment** — POST http://localhost:4002/transfer
5. Try amount 0 or a negative amount — server returns HTTP 400.
6. Stop one backend and retry its button — client displays a connection error.

## Important
This is intentionally REST-only. There is no gRPC, Protobuf, Struct, gateway, or Fastify inject in Stage 1. Each server has its own Fastify instance, routes, and controllers. The client directly calls each server using Axios. Stage 2 can replace the transport path while keeping the business controllers as the comparison baseline.

### What you should understand from Stage 1
- One client communicates with multiple independent servers.
- Axios sends HTTP requests directly to each server.
- Each server has its own Fastify routes.
- Routes call their respective controllers.
- Controllers execute business logic and return responses.

# Stage 2: Next.js → gRPC gateway → multiple gRPC servers → Fastify existing routes

keerthana@Keerthanas-MacBook-Air user-server % cd user-server
node src/server.js
cd: no such file or directory: user-server
{"level":30,"time":1793698520229,"pid":15135,"hostname":"Keerthanas-MacBook-Air.local","msg":"Server listening at http://127.0.0.1:4001"}
{"level":30,"time":1793698520230,"pid":15135,"hostname":"Keerthanas-MacBook-Air.local","msg":"Server listening at http://10.55.66.132:4001"}
User gRPC server running on port 5001

keerthana@Keerthanas-MacBook-Air payment-server % npm run dev

> payment-server@1.0.0 dev
> node src/server.js

{"level":30,"time":1793699274962,"pid":17367,"hostname":"Mac-1.lan","msg":"Server listening at http://127.0.0.1:4002"}
{"level":30,"time":1793699274963,"pid":17367,"hostname":"Mac-1.lan","msg":"Server listening at http://192.168.31.190:4002"}
Payment gRPC server running on port 5002

keerthana@Keerthanas-MacBook-Air client % npm install
npm run dev

up to date, audited 57 packages in 2s

12 packages are looking for funding
  run `npm fund` for details

2 vulnerabilities (1 moderate, 1 high)

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.

> dev
> next dev -p 3000

   ▲ Next.js 15.5.28
   - Local:        http://localhost:3000
   - Network:      http://192.168.31.190:3000

 ✓ Starting...
 ✓ Ready in 2.5s
 ○ Compiling / ...
 ✓ Compiled / in 765ms (746 modules)
 GET / 200 in 1264ms

keerthana@Keerthanas-MacBook-Air gateway % cd gateway
node server.js
cd: no such file or directory: gateway
HTTP + gRPC Gateway running on port 4000

*the browser requests are reaching the gateway, the gateway is sending gRPC requests to both backend servers, and the backend servers are executing your existing Fastify routes.*

**Its job is to connect two different interfaces:**
- HTTP request from the client
- gRPC request to the backend
- Fastify request inside the backend

## The flow is:
1. Gateway receives HTTP
   js     const service = parts.shift();     const client = services[service];     
   It determines whether the request is for user or payment.

2. Gateway converts the request
   js     const grpcRequest = {       data: toStruct({         service,         method: request.method,         url: route,         payload,         headers       })     };     
   It converts the HTTP request into the generic Protobuf request format.

3. Gateway calls gRPC
   js     client.forward(grpcRequest, callback);     
   The request travels over gRPC to port 5001 or 5002.
   
4. Backend decodes the request
   js     const request = fromStruct(call.request.data);     
   The backend converts the Protobuf Struct back into a normal JavaScript object.

5. Backend forwards to Fastify
   js     const result = await app.inject({       method: request.method,       url: request.url,       headers: request.headers || {},       payload: request.payload || {}     });     
   This is the important adapter part: it converts the generic gRPC request into a Fastify request.

6. Fastify executes existing routes
   Your existing user.routes.js, payment.routes.js, controllers, and data logic execute as before.

7. Backend converts the response
   js     callback(null, {       status: result.statusCode,       data: toStruct({ body })     });     
   The backend returns the response using the generic Protobuf response.

8. Gateway returns HTTP
   js     const decoded = fromStruct(result.data);     sendJson(response, result.status, decoded.body);     
   The client receives the same JSON response format it received in Stage 1.

### What are toStruct() and fromStruct() doing?
These are our own helper functions. They are not Google's built-in conversion functions.
1. toStruct()
It converts ordinary JavaScript data into the Protobuf Struct representation.

2. toValue()
This handles the different JavaScript value types:
JavaScript value	   Protobuf Value
"hello"	            stringValue
500	               numberValue
true	               boolValue
null	               nullValue
{}	                  structValue
[]	                  listValue

3. fromStruct()
It performs the reverse conversion.