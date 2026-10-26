const express = require("express");

const app = express();
app.use(express.json());

app.post("/add", (req, res) => {
  const { a, b } = req.body;

  if (typeof a !== "number" || typeof b !== "number") {
    return res.status(400).json({
      error: "a and b must be numbers"
    });
  }

  res.json({ result: a + b });
});

app.listen(3002, () => {
  console.log("Service 2 listening on http://localhost:3002");
});