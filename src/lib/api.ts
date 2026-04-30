import { NextResponse } from "next/server";
import { ZodError, ZodTypeAny, z } from "zod";

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export async function parseJson<T extends ZodTypeAny>(req: Request, schema: T): Promise<z.infer<T>> {
  const body = (await req.json().catch(() => null)) as unknown;
  if (body == null) throw new ApiError("Invalid JSON body", 400);
  try {
    return schema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new ApiError("Validation failed", 422, { issues: err.issues });
    }
    throw err;
  }
}

export class ApiError extends Error {
  status: number;
  extra?: Record<string, unknown>;
  constructor(message: string, status: number, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function handle<T extends (...args: never[]) => Promise<Response>>(fn: T): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ApiError) return jsonError(err.message, err.status, err.extra);
      if (err instanceof Error && err.message === "UNAUTHENTICATED") {
        return jsonError("Unauthenticated", 401);
      }
      console.error("[api]", err);
      return jsonError("Internal server error", 500);
    }
  }) as T;
}
