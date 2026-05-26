export function parseStoredJsonValue(rawValue, fallback) {
  try {
    const parsed = JSON.parse(rawValue ?? JSON.stringify(fallback));
    if (Array.isArray(fallback)) {
      return { value: Array.isArray(parsed) ? parsed : fallback, invalid: !Array.isArray(parsed) };
    }
    if (fallback === null) return { value: parsed, invalid: false };
    const valid = parsed && typeof parsed === typeof fallback;
    return { value: valid ? parsed : fallback, invalid: !valid };
  } catch {
    return { value: fallback, invalid: true };
  }
}

export function isSavedScenario(item) {
  return Boolean(item) &&
    typeof item === "object" &&
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.saved_at === "string" &&
    item.request &&
    typeof item.request === "object" &&
    !Array.isArray(item.request);
}
