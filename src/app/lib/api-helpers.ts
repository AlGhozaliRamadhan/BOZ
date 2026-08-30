import { NextResponse } from 'next/server';

export class InvalidJsonBodyError extends Error {
  constructor() {
    super('Invalid JSON body');
    this.name = 'InvalidJsonBodyError';
  }
}

export function jsonResponse(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function errorResponse(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function parseBody<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new InvalidJsonBodyError();
  }
}
