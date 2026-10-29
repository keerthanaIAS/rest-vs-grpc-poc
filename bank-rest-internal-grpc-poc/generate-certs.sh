#!/bin/bash
set -e

mkdir -p certs
cd certs

echo "1. Generating Internal CA Key and Certificate..."
openssl genrsa -out ca.key 4096
openssl req -new -x509 -days 365 -key ca.key -out ca.crt -subj "/CN=internal-banking-ca"

echo "2. Generating Server Key and Certificate (Internal gRPC Service)..."
openssl genrsa -out server.key 2048
openssl req -new -key server.key -out server.csr -subj "/CN=internal-banking-service.default.svc.cluster.local"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365

echo "3. Generating Client Key and Certificate (REST Gateway as gRPC Client)..."
openssl genrsa -out client.key 2048
openssl req -new -key client.key -out client.csr -subj "/CN=gateway-service"
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt -days 365

cd ..
echo "✅ All mTLS certificates created in ./certs/"