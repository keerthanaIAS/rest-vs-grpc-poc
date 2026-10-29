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