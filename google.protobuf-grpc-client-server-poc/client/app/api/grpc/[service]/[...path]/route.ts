
import { NextRequest, NextResponse } from "next/server";
import { forwardToGrpc } from "../../../../../lib/grpc-client";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    service: string;
    path: string[];
  }>;
};

async function handleRequest(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { service, path } = await context.params;

    const search = new URL(request.url).search;
    const route = "/" + path.join("/") + search;

    const method = request.method;

    let payload = {};

    if (method !== "GET" && method !== "HEAD") {
      payload = await request.json();
    }

    const headers: Record<string, string> = {
      "content-type": "application/json"
    };

    const authorization = request.headers.get("authorization");

    if (authorization) {
      headers.authorization = authorization;
    }

    const result = await forwardToGrpc(
      service,
      method,
      route,
      payload,
      headers
    );

    return NextResponse.json(result.body, {
      status: result.status
    });

  } catch (error: any) {
    console.error("gRPC request failed:", error);

    return NextResponse.json(
      { message: error.message || "gRPC request failed" },
      { status: 502 }
    );
  }
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;
