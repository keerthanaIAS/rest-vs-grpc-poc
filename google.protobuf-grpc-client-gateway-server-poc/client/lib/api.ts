
import axios from "axios";

const GATEWAY_URL = "http://localhost:4000";

export const userApi = axios.create({
  baseURL: `${GATEWAY_URL}/user`,
  timeout: 10000
});

export const paymentApi = axios.create({
  baseURL: `${GATEWAY_URL}/payment`,
  timeout: 10000
});
