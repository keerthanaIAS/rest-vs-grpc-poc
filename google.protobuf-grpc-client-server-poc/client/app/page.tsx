"use client";

import { useState } from "react";
import { userApi, paymentApi } from "../lib/api";

type User = { id: number; name: string; email: string };
type Payment = { id: number; amount: number; currency: string; status: string };

export default function Home() {
  const [users, setUsers] = useState<User[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [name, setName] = useState("Keerthana");
  const [email, setEmail] = useState("keerthana@example.com");
  const [amount, setAmount] = useState("500");
  const [message, setMessage] = useState("Start both backend servers, then test the buttons.");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); }
    catch (error: any) {
      setMessage(error.response?.data?.message || error.message || "Request failed");
    } finally { setBusy(false); }
  }

  return (
    <main className="container">
      {/* <h1>Stage 1: REST communication</h1> */}
      {/* <p className="intro">One Next.js + TypeScript client communicating directly with two independent Fastify servers using Axios. No gRPC yet.</p> */}
      <h1>Stage 2: gRPC communication</h1>
      <p className="intro">
        One Next.js client communicating with two independent backend servers
        using native gRPC from the Next.js server.
      </p>
      <div className="status">{message}</div>
      <section className="grid">
        <article className="panel">
          <h2>User Server</h2>
          <p className="muted">Fastify · http://localhost:4001</p>
          <button disabled={busy} onClick={() => run(async () => {
            const { data } = await userApi.get<User[]>("/users");
            setUsers(data); setMessage("GET /users → User Server returned " + data.length + " users.");
          })}>Load users (GET)</button>
          <label>Name<input value={name} onChange={e => setName(e.target.value)} /></label>
          <label>Email<input value={email} onChange={e => setEmail(e.target.value)} /></label>
          <button disabled={busy} onClick={() => run(async () => {
            const { data } = await userApi.post<User>("/users", { name, email });
            setUsers(current => [...current, data]); setMessage("POST /users → User created with ID " + data.id + ".");
          })}>Create user (POST)</button>
          <pre>{JSON.stringify(users, null, 2)}</pre>
        </article>
        <article className="panel">
          <h2>Payment Server</h2>
          <p className="muted">Fastify · http://localhost:4002</p>
          <button disabled={busy} onClick={() => run(async () => {
            const { data } = await paymentApi.get<Payment[]>("/payments");
            setPayments(data); setMessage("GET /payments → Payment Server returned " + data.length + " payments.");
          })}>Load payments (GET)</button>
          <label>Amount<input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <button disabled={busy} onClick={() => run(async () => {
            const { data } = await paymentApi.post<Payment>("/transfer", { amount: Number(amount), currency: "INR" });
            setPayments(current => [...current, data]); setMessage("POST /transfer → Payment created with ID " + data.id + ".");
          })}>Create payment (POST)</button>
          <pre>{JSON.stringify(payments, null, 2)}</pre>
        </article>
      </section>
      <p className="foot">Test error handling: enter 0 or a negative payment amount. Then stop a server and retry its request.</p>
    </main>
  );
}