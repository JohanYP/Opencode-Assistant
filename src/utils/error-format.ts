const DEFAULT_MAX_ERROR_DETAILS_LENGTH = 1500;

function clipText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function formatErrorDetails(
  error: unknown,
  maxLength = DEFAULT_MAX_ERROR_DETAILS_LENGTH,
): string {
  let details = "";

  if (error instanceof Error) {
    details = error.stack ?? `${error.name}: ${error.message}`;
  } else if (typeof error === "string") {
    details = error;
  } else {
    try {
      details = JSON.stringify(error, null, 2);
    } catch {
      details = String(error);
    }
  }

  const normalized = details.trim();
  if (!normalized || normalized === "{}" || normalized === "[object Object]") {
    return "unknown error";
  }

  return clipText(normalized, maxLength);
}
