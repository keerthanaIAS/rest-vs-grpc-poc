
import axios from "axios";

const userApi = axios.create({
  baseURL: "http://localhost:4001",
  timeout: 5000,
});

const paymentApi = axios.create({
  baseURL: "http://localhost:4002",
  timeout: 5000,
});

const transactionApi = axios.create({
  baseURL: "http://localhost:4003",
  timeout: 5000,
});

export const getUsers = () => userApi.get("/users");

export const createUser = (data: {
  name: string;
  email: string;
}) => userApi.post("/users", data);

export const getPayments = () => paymentApi.get("/payments");

export const createTransfer = (data: {
  userId: number;
  amount: number;
}) => paymentApi.post("/transfer", data);

export const getTransactions = () =>
  transactionApi.get("/transactions");
