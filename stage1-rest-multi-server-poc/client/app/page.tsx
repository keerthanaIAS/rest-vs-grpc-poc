
"use client";

import { useEffect, useState } from "react";
import {
  getUsers,
  createUser,
  getPayments,
  createTransfer,
  getTransactions,
} from "@/lib/api";

export default function Home() {
  const [users, setUsers] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [userId, setUserId] = useState(1);
  const [amount, setAmount] = useState(500);
  const [message, setMessage] = useState("");

  async function loadData() {
    try {
      const [u, p, t] = await Promise.all([
        getUsers(),
        getPayments(),
        getTransactions(),
      ]);

      setUsers(u.data.data);
      setPayments(p.data.data);
      setTransactions(t.data.data);
    } catch (error) {
      console.error(error);
      setMessage("Unable to load server data");
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();

    try {
      await createUser({ name, email });
      setName("");
      setEmail("");
      setMessage("User created successfully");
      await loadData();
    } catch {
      setMessage("User creation failed");
    }
  }

  async function handleTransfer(e: React.FormEvent) {
    e.preventDefault();

    try {
      const response = await createTransfer({ userId, amount });
      setMessage(response.data.message);
      await loadData();
    } catch (error: any) {
      setMessage(
        error.response?.data?.message || "Transfer failed"
      );
    }
  }

  return (
    <main style={{ padding: 30, fontFamily: "Arial" }}>
      <h1>Multi Server REST POC</h1>

      <p>{message}</p>

      <hr />

      <h2>Create User</h2>

      <form onSubmit={handleCreateUser}>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <input
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <button type="submit">Create User</button>
      </form>

      <h3>Users</h3>
      <pre>{JSON.stringify(users, null, 2)}</pre>

      <hr />

      <h2>Fund Transfer</h2>

      <form onSubmit={handleTransfer}>
        <input
          type="number"
          value={userId}
          onChange={(e) => setUserId(Number(e.target.value))}
          min={1}
          required
        />

        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          min={1}
          required
        />

        <button type="submit">Transfer</button>
      </form>

      <h3>Payments</h3>
      <pre>{JSON.stringify(payments, null, 2)}</pre>

      <hr />

      <h2>Transactions</h2>
      <pre>{JSON.stringify(transactions, null, 2)}</pre>

      <button onClick={loadData}>Refresh All</button>
    </main>
  );
}
