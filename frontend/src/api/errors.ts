import type { ApiError } from "./types";

/** A non-2xx response, carrying the contract's `ApiError` body. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: ApiError["code"];

  constructor(status: number, body: ApiError) {
    super(body.message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = body.code;
  }
}

const CODES: readonly ApiError["code"][] = [
  "bad_request",
  "not_found",
  "conflict",
  "llm_unavailable",
  "internal",
];

/** Narrows an untrusted response body to `ApiError`; falls back to `internal`. */
export function toApiError(body: unknown, fallbackMessage: string): ApiError {
  if (typeof body === "object" && body !== null) {
    const { code, message } = body as Record<string, unknown>;
    if (
      typeof code === "string" &&
      (CODES as readonly string[]).includes(code) &&
      typeof message === "string"
    ) {
      return { code: code as ApiError["code"], message };
    }
  }
  return { code: "internal", message: fallbackMessage };
}
