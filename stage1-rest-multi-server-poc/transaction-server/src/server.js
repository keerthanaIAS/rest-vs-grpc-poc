
const Fastify = require("fastify");
const cors = require("@fastify/cors");
const {
  startGrpcReceiver,
} = require("../../shared/grpc-bridge");
const cron = require("node-cron");
const Agenda = require("agenda");
const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

const app = Fastify({ logger: true });

app.register(cors, { origin: "http://localhost:3000" });

let transactions = [
  { id: "TXN-1001", userId: 1, amount: 500, type: "FUND_TRANSFER", status: "SUCCESS" },
  { id: "TXN-1002", userId: 2, amount: 1000, type: "FUND_TRANSFER", status: "PENDING" }
];

app.get("/transactions", async () => {
  return {
    success: true,
    data: transactions
  };
});

app.post("/transactions", async (request, reply) => {
  const { userId, amount, type } = request.body || {};

  if (!userId || !Number.isFinite(amount) || amount <= 0 || !type) {
    return reply.code(400).send({
      success: false,
      message: "Invalid transaction details"
    });
  }

  const transaction = {
    id: `TXN-${Date.now()}`,
    userId,
    amount,
    type,
    status: "PENDING"
  };

  transactions.push(transaction);

  return reply.code(201).send({
    success: true,
    message: "Transaction created",
    data: transaction
  });
});

// ======================================
// 1. CRON JOB API
// ======================================

let cronTask = null;
let cronExecutionCount = 0;

app.post("/test/cron/start", async (request, reply) => {
  const { intervalSeconds = 5 } = request.body || {};

  if (
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds < 1 ||
    intervalSeconds > 59
  ) {
    return reply.code(400).send({
      success: false,
      message: "intervalSeconds must be between 1 and 59",
    });
  }

  if (cronTask) {
    return reply.code(409).send({
      success: false,
      message: "Cron job is already running",
    });
  }

  const expression = `*/${intervalSeconds} * * * * *`;

  cronTask = cron.schedule(expression, () => {
    cronExecutionCount++;

    app.log.info({
      message: "Cron job executed",
      executionCount: cronExecutionCount,
      executedAt: new Date().toISOString(),
    });
  });

  return {
    success: true,
    message: "Cron job started",
    intervalSeconds,
  };
});

app.get("/test/cron/status", async () => {
  return {
    success: true,
    running: Boolean(cronTask),
    executionCount: cronExecutionCount,
  };
});

app.post("/test/cron/stop", async () => {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }

  return {
    success: true,
    message: "Cron job stopped",
    executionCount: cronExecutionCount,
  };
});

// ======================================
// 2. AGENDA JOB API
// ======================================

const MONGODB_URL =
  process.env.MONGODB_URL ||
  "mongodb://127.0.0.1:27017/agenda-poc";

const AGENDA_JOB_NAME = "poc-background-job";

let agenda = null;
let agendaStarting = null;

async function getAgenda() {
  if (agenda) {
    return agenda;
  }

  if (!agendaStarting) {
    agendaStarting = (async () => {
      const instance = new Agenda({
        db: {
          address: MONGODB_URL,
          collection: "agendaJobs",
        },
      });

      instance.define(AGENDA_JOB_NAME, async (job) => {
        app.log.info({
          message: "Agenda background job executed",
          jobId: String(job.attrs._id),
          jobData: job.attrs.data,
          executedAt: new Date().toISOString(),
        });
      });

      await instance.start();

      agenda = instance;

      return instance;
    })().catch((error) => {
      agendaStarting = null;
      throw error;
    });
  }

  return agendaStarting;
}

app.post("/test/agenda/schedule", async (request, reply) => {
  const {
    message = "Agenda POC background task",
    delaySeconds = 10,
  } = request.body || {};

  if (
    typeof message !== "string" ||
    !message.trim() ||
    !Number.isInteger(delaySeconds) ||
    delaySeconds < 1 ||
    delaySeconds > 3600
  ) {
    return reply.code(400).send({
      success: false,
      message: "Invalid message or delaySeconds",
    });
  }

  try {
    const scheduler = await getAgenda();

    const runAt = new Date(
      Date.now() + delaySeconds * 1000
    );

    const job = await scheduler.schedule(
      runAt,
      AGENDA_JOB_NAME,
      { message }
    );

    return reply.code(201).send({
      success: true,
      message: "Agenda job scheduled",
      data: {
        jobId: String(job.attrs._id),
        scheduledAt: runAt.toISOString(),
        delaySeconds,
      },
    });
  } catch (error) {
    request.log.error(error);

    return reply.code(503).send({
      success: false,
      message: "Agenda scheduler unavailable",
    });
  }
});

// ======================================
// 3. FILE UPLOAD API
// ======================================

const UPLOAD_DIR = path.join(__dirname, "uploads");
const MAX_FILE_SIZE = 512 * 1024;

async function ensureUploadDirectory() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

app.post("/test/files/upload", async (request, reply) => {
  const {
    fileName,
    mimeType = "application/octet-stream",
    contentBase64,
  } = request.body || {};

  if (
    typeof fileName !== "string" ||
    !fileName.trim() ||
    typeof contentBase64 !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(contentBase64) ||
    contentBase64.length % 4 !== 0
  ) {
    return reply.code(400).send({
      success: false,
      message: "Invalid file upload details",
    });
  }

  const fileBuffer = Buffer.from(contentBase64, "base64");

  if (
    fileBuffer.length === 0 ||
    fileBuffer.length > MAX_FILE_SIZE ||
    fileBuffer.toString("base64") !== contentBase64
  ) {
    return reply.code(400).send({
      success: false,
      message: "File must be between 1 byte and 512 KB",
    });
  }

  await ensureUploadDirectory();

  const id = randomUUID();

  const metadata = {
    id,
    fileName: path.basename(fileName),
    mimeType,
    size: fileBuffer.length,
    contentBase64,
    uploadedAt: new Date().toISOString(),
  };

  await fs.writeFile(
    path.join(UPLOAD_DIR, `${id}.json`),
    JSON.stringify(metadata)
  );

  return reply.code(201).send({
    success: true,
    message: "File uploaded successfully",
    data: {
      id,
      fileName: metadata.fileName,
      size: metadata.size,
      mimeType,
    },
  });
});

// ======================================
// 4. FILE DOWNLOAD API
// ======================================

app.get("/test/files/:id/download", async (request, reply) => {
  const { id } = request.params;

  // Only allow UUID-generated file IDs.
  if (
    typeof id !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(id)
  ) {
    return reply.code(400).send({
      success: false,
      message: "Invalid file ID",
    });
  }

  try {
    const filePath = path.join(UPLOAD_DIR, `${id}.json`);

    const fileContent = await fs.readFile(filePath, "utf8");
    const metadata = JSON.parse(fileContent);

    return {
      success: true,
      data: {
        id: metadata.id,
        fileName: metadata.fileName,
        mimeType: metadata.mimeType,
        size: metadata.size,
        contentBase64: metadata.contentBase64,
      },
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return reply.code(404).send({
        success: false,
        message: "File not found",
      });
    }

    request.log.error(error);

    return reply.code(500).send({
      success: false,
      message: "File download failed",
    });
  }
});

async function start() {
  try {
    await app.listen({ port: 4003, host: "0.0.0.0" });
    await startGrpcReceiver(app, 50051);
    console.log("Transaction Server running on port 4003");
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
