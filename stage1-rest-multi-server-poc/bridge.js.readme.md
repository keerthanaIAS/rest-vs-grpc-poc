`grpc-bridge.js` is the central communication layer between Axios and gRPC.

It has two responsibilities:

1. Axios interceptor: Captures an existing Axios HTTP request and redirects it through gRPC.
2. gRPC receiver: Receives that gRPC request and executes the original REST route inside Transaction Server.

Let's understand why both are needed.

# 1. First understand the problem

Normally, your Payment Server communicates with Transaction Server using REST.

```
Payment Server                 Transaction Server
     |                                 |
     |-------- HTTP POST ------------>|
     |       /transactions             |
     |                                 |
     |<------- HTTP Response ----------|
```

Your objective is to change the internal communication to gRPC without changing every Axios call.

For example, your existing code:

```
const response = await axios.post(
  `${TRANSACTION_URL}/transactions`,
  {
    userId,
    amount,
    type: "FUND_TRANSFER"
  }
);
```

You want this same code to communicate through gRPC.

This is why you need the Axios interceptor and gRPC receiver.

# 2. Axios interceptor — client side

First, what is an Axios interceptor?

An Axios interceptor is a mechanism that allows you to execute custom logic before an Axios request is sent or after a response is received.

In your POC, you use a request interceptor to redirect selected requests to gRPC.

Your function:

```
function registerAxiosInterceptor(axiosInstance, target)
```

It receives two things:

- `axiosInstance`: The Axios instance to intercept.
- `target`: Configuration containing the Transaction HTTP origin and gRPC address.

For example:

```
registerAxiosInterceptor(axios, {
  httpOrigin: "http://localhost:4003",
  grpcAddress: "localhost:50051",
});
```

This tells the interceptor:

"If Axios tries to communicate with Transaction Server at port 4003, use gRPC at port 50051 instead."

## Step 1: Create a gRPC client

```
const client = new bridge.ApiBridge(
  target.grpcAddress,
  grpc.credentials.createInsecure()
);
```

What happens here?

- `bridge.ApiBridge` comes from your Protobuf definition.
- `target.grpcAddress` identifies the gRPC server.
- `createInsecure()` establishes an unencrypted gRPC connection.

Your Payment Server now has a gRPC client capable of calling the `Forward` RPC.

## Step 2: Intercept Axios requests

```
axiosInstance.interceptors.request.use((config) => {
```

Whenever Axios makes a request, this function executes before the request is sent.

For example:

```
axios.post("http://localhost:4003/transactions", data);
```

The interceptor gets the request configuration.

## Step 3: Identify the destination

```
const requestUrl = new URL(axiosInstance.getUri(config));

if (requestUrl.origin !== target.httpOrigin) {
  return config;
}
```

This is important.

Your application might communicate with multiple services:

```
User Server        localhost:4001
Payment Server     localhost:4002
Transaction Server localhost:4003
```

You only want to redirect requests targeting Transaction Server.

Example:

| Axios destination | What happens          |
| ----------------- | --------------------- |
| `localhost:4001`  | Normal HTTP           |
| `localhost:4003`  | Redirect through gRPC |
| External API      | Normal HTTP           |

Without this condition, you could accidentally redirect unrelated Axios requests.

## Step 4: Replace the Axios adapter

```
config.adapter = async (requestConfig) => {
```

This is the most important part of the interceptor.

Axios normally uses an HTTP adapter to send network requests.

You replace that adapter with your own function.

Instead of:

```
Axios → HTTP network request
```

You now have:

```
Axios → Custom adapter → gRPC
```

Notice that you are not changing:

```
axios.post(...)
axios.get(...)
axios.put(...)
axios.delete(...)
```

The existing application calls remain the same.

## Step 5: Prepare request data

```
const body = requestConfig.data;

const payload =
  body == null
    ? Buffer.alloc(0)
    : Buffer.isBuffer(body)
      ? body
      : Buffer.from(String(body));
```

Why is this needed?

gRPC needs the request data in the format defined by your Protobuf contract.

Your adapter converts the body into a Buffer.

Examples:

- No body → Empty Buffer.
- Buffer body → Retain Buffer.
- String body → Convert to Buffer.

One important detail: your current Axios interceptor relies on Axios having already serialized ordinary JavaScript objects into JSON strings. It does not independently JSON-stringify arbitrary objects.

## Step 6: Create the Protobuf request

```
const grpcRequest = {
  method: (requestConfig.method || "GET").toUpperCase(),
  url: requestUrl.pathname + requestUrl.search,
  headers_json: JSON.stringify(headers),
  payload,
};
```

This is where your HTTP request becomes a generic gRPC request.

Your original request:

```
POST /transactions
Content-Type: application/json
```

With body:

```
{
  "userId": 1,
  "amount": 500,
  "type": "FUND_TRANSFER"
}
```

Becomes a Protobuf request containing:

| Protobuf field | Value                 |
| -------------- | --------------------- |
| `method`       | POST                  |
| `url`          | `/transactions`       |
| `headers_json` | HTTP headers in JSON  |
| `payload`      | Request body as bytes |

Notice something important:

You are not creating a separate gRPC method for every REST endpoint.

You have one generic method called `Forward`.

## Step 7: Call the gRPC server

```
client.forward(
  grpcRequest,
  {
    deadline: new Date(
      Date.now() + (requestConfig.timeout || 5000)
    ),
  },
  (error, response) => {
    if (error) {
      reject(error);
    } else {
      resolve(response);
    }
  }
);
```

This sends the request to the Transaction Server.

The deadline prevents the client from waiting indefinitely.

For example:

```
Payment Server
      |
      | Forward()
      |
      v
Transaction gRPC Receiver
```

If gRPC fails, the Promise rejects.

If it succeeds, the response is returned.

## Step 8: Convert gRPC response into Axios response

```
const response = {
  data: Buffer.from(result.payload).toString("utf8"),
  status: result.status,
  statusText: "",
  headers: JSON.parse(result.headers_json || "{}"),
  config: requestConfig,
  request: null,
};
```

Your application expects Axios response objects.

It expects things like:

```
response.data
response.status
```

But gRPC returns a Protobuf response.

Therefore, you convert the gRPC response back into an Axios-compatible response.

You also check `validateStatus` to preserve Axios's normal HTTP error behavior.

That completes the client-side responsibility.

# 3. gRPC receiver — server side

Now ask the next question:

Payment Server sends a gRPC request. Who receives it, and how does the existing Transaction REST route execute?

That is the purpose of your second function:

```
async function startGrpcReceiver(app, port)
```

It runs inside Transaction Server.

## Step 1: Create the gRPC server

```
const server = new grpc.Server();
```

This creates the gRPC server instance.

Unlike the gRPC client, this server waits for incoming RPC requests.

## Step 2: Register the Forward method

```
server.addService(bridge.ApiBridge.service, {
  Forward: async (call, callback) => {
```

Remember your Protobuf service?

Conceptually:

```
service ApiBridge {
  rpc Forward(BridgeRequest) returns (BridgeResponse);
}
```

Here you implement that `Forward` method.

Whenever Payment Server calls:

```
client.forward(...)
```

This receiver executes:

```
Forward: async (call, callback) => {
```

`call` contains the incoming request.

`callback` sends the response back.

## Step 3: Extract the original HTTP request

```
const request = call.request;

const headers = JSON.parse(
  request.headers_json || "{}"
);
```

You retrieve the HTTP details that Payment Server placed inside the Protobuf message.

For example:

```
method = POST
url = /transactions
headers = Content-Type: application/json
payload = {"userId":1,"amount":500,...}
```

## Step 4: Execute the existing Fastify route

This is the most important line in the entire receiver:

```
const result = await app.inject({
  method: request.method,
  url: request.url,
  headers,
  payload: request.payload?.length
    ? Buffer.from(request.payload)
    : undefined,
});
```

What is `app.inject()`?

Fastify provides `inject()` to execute an HTTP request against the application internally without making an actual network request.

For example, normally you might call:

```
curl http://localhost:4003/transactions
```

But with `inject()`:

```
await app.inject({
  method: "POST",
  url: "/transactions",
  payload: {
    userId: 1,
    amount: 500,
    type: "FUND_TRANSFER"
  }
});
```

Fastify directly executes the matching route.

That means your existing route:

```
app.post("/transactions", async (request, reply) => {
  // Existing transaction business logic
});
```

executes without requiring an HTTP network call from Payment Server.

This is why you don't need to rewrite individual Transaction routes.

## Step 5: Send the HTTP result back through gRPC

```
callback(null, {
  status: result.statusCode,
  headers_json: JSON.stringify(result.headers),
  payload: Buffer.from(result.body || "", "utf8"),
});
```

Fastify returns:

```
HTTP status: 201
Response body: {"success":true,...}
```

The receiver places these details into a Protobuf response.

The gRPC client receives that response and converts it into an Axios response.

The complete journey:

```
Payment Server
      |
      | axios.post()
      v
Axios Interceptor
      |
      | Convert HTTP request to Protobuf
      v
gRPC Forward()
      |
      v
Transaction gRPC Receiver
      |
      | app.inject()
      v
Existing Transaction REST Route
      |
      | Execute business logic
      v
Fastify HTTP Response
      |
      | Convert to Protobuf
      v
gRPC Response
      |
      v
Axios Response
      |
      v
Payment Server
```

## Step 6: Start listening for gRPC requests

```
server.bindAsync(
  `0.0.0.0:${port}`,
  grpc.ServerCredentials.createInsecure(),
  (error) => {
    if (error) {
      reject(error);
      return;
    }

    server.start();
    resolve();
  }
);
```

This binds the gRPC server to port `50051`.

Your Transaction Server now accepts incoming gRPC requests.

# 4. Why do we need both functions?

This is the key concept to remember.

| Component         | Responsibility                          | Runs in            |
| ----------------- | --------------------------------------- | ------------------ |
| Axios interceptor | Captures outgoing Axios requests        | Payment Server     |
| gRPC client       | Sends generic Forward RPC               | Payment Server     |
| gRPC receiver     | Receives Forward RPC                    | Transaction Server |
| Fastify inject    | Executes existing REST route internally | Transaction Server |

Neither function replaces the other.

- Without the Axios interceptor, existing Axios requests will continue using HTTP.
- Without the gRPC receiver, there is nobody to receive and execute the gRPC request.
- Without `app.inject()`, your receiver would need another mechanism to execute the existing application logic.

# 5. The three most important lines to understand

If you remember only three lines from this entire file, remember these:

1\. Intercept the Axios request

```
config.adapter = async (requestConfig) => {
```

Replaces the normal Axios HTTP transport with your custom gRPC transport.

2\. Send the generic gRPC request

```
client.forward(grpcRequest, options, callback);
```

Transfers the request to Transaction Server using the Forward RPC.

3\. Execute the existing REST route

```
await app.inject({...});
```

Runs the existing Fastify handler without a separate HTTP network request.

# 6. One important limitation in your current implementation

There is something you should understand before treating this as a production-ready adapter.

Your current implementation converts the response payload to UTF-8:

```
Buffer.from(result.payload).toString("utf8")
```

This means:

- JSON responses work.
- Text responses work.
- Base64-encoded file responses work.
- Arbitrary raw binary responses are not safely represented as normal Axios response data.

Also, request adapter assumes Axios has already serialized ordinary object bodies. It does not fully support every possible Axios body type.

So current POC demonstrates generic unary HTTP-to-gRPC forwarding, not a universal replacement for every Axios HTTP capability.