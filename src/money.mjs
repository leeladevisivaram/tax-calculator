export const MONEY_VERSION = "money-v1";

export function toRupees(value) {
  return fromPaise(toPaise(value));
}

export function roundRupee(value) {
  return toRupees(value);
}

export function roundFinalRupee(value) {
  return Math.round(toPaise(value) / 100);
}

export function addRupees(...values) {
  return fromPaise(values.reduce((total, value) => total + toPaise(value), 0));
}

export function multiplyRupees(value, rate) {
  const paise = toPaise(value);
  const numericRate = Number(rate);
  if (!Number.isFinite(numericRate)) return 0;
  return fromPaise(Math.round(paise * numericRate));
}

export function toPaise(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return 0;
    return parseDecimalToPaise(value.toFixed(6));
  }

  if (typeof value === "bigint") {
    return safeNumber(value * 100n);
  }

  const normalized = normalizeAmountText(value);
  if (!normalized) return 0;
  return parseDecimalToPaise(normalized);
}

export function fromPaise(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value) / 100;
}

function normalizeAmountText(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/,/g, "")
    .replace(/^rs\.?\s*/i, "")
    .replace(/^inr\s*/i, "")
    .replace(/^₹\s*/, "");
  return text;
}

function parseDecimalToPaise(text) {
  const match = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return 0;

  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = match[3] ?? "";
  const paiseText = `${fraction}00`.slice(0, 2);
  const roundingDigit = Number(`${fraction}000`.charAt(2));
  const roundedPaise = BigInt(paiseText) + (roundingDigit >= 5 ? 1n : 0n);
  return safeNumber(sign * ((whole * 100n) + roundedPaise));
}

function safeNumber(value) {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > max) return Number.MAX_SAFE_INTEGER;
  if (value < -max) return -Number.MAX_SAFE_INTEGER;
  return Number(value);
}
