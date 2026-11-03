import axios from "axios";

export const userApi = axios.create({
  baseURL: "/api/grpc/user",
  timeout: 10000
});

export const paymentApi = axios.create({
  baseURL: "/api/grpc/payment",
  timeout: 10000
});