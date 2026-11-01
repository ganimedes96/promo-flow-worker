export function runtimeLog(
  event: string,
  error?: unknown,
  details: Record<string, string | boolean | number> = {},
): void {
  const object = typeof error === "object" && error !== null ? error : null;
  const statusCode =
    object && "statusCode" in object && typeof object.statusCode === "number"
      ? object.statusCode
      : undefined;
  const requestId =
    object &&
    "requestId" in object &&
    typeof object.requestId === "string" &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(object.requestId)
      ? object.requestId
      : undefined;
  const payload = JSON.stringify({
    time: new Date().toISOString(),
    event,
    ...details,
    errorType:
      error instanceof Error ? error.name : error ? "UnknownError" : undefined,
    statusCode,
    requestId,
  });
  if (error) console.error(payload);
  else console.info(payload);
}
