// Small input validators. Every tool input and form field passes through
// these on the server, whatever the model or browser claims to have sent.

export class ValidationError extends Error {}

export function text(value, field, { max = 200, required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (typeof value !== "string") throw new ValidationError(`${field} must be text`);
  // Strip control characters but keep newlines and tabs.
  const v = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!v) {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (v.length > max) throw new ValidationError(`${field} must be ${max} characters or fewer`);
  return v;
}

export function oneOf(value, field, allowed, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (!allowed.includes(value)) throw new ValidationError(`${field} must be one of: ${allowed.join(", ")}`);
  return value;
}

export function listOf(value, field, allowed, { min = 0, max = 20 } = {}) {
  if (value === undefined || value === null) value = [];
  if (!Array.isArray(value)) throw new ValidationError(`${field} must be a list`);
  if (value.length < min) throw new ValidationError(`${field} needs at least ${min} item(s)`);
  if (value.length > max) throw new ValidationError(`${field} has too many items`);
  for (const v of value) if (!allowed.includes(v)) throw new ValidationError(`${field} contains an unknown value: ${String(v).slice(0, 40)}`);
  return [...new Set(value)];
}

export function bool(value, field, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new ValidationError(`${field} is required`);
    return null;
  }
  if (typeof value !== "boolean") throw new ValidationError(`${field} must be true or false`);
  return value;
}

export function int(value, field, { min = 0, max = 100 } = {}) {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${field} must be a whole number from ${min} to ${max}`);
  return n;
}

export function email(value, field = "email", { required = false } = {}) {
  const v = text(value, field, { max: 254, required });
  if (v === null) return null;
  if (!/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(v)) throw new ValidationError(`${field} does not look like an email address`);
  return v.toLowerCase();
}

export function phone(value, field = "phone", { required = false } = {}) {
  const v = text(value, field, { max: 30, required });
  if (v === null) return null;
  if (!/^[0-9+().\-\s x]+$/i.test(v)) throw new ValidationError(`${field} does not look like a phone number`);
  const digits = v.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) throw new ValidationError(`${field} does not look like a phone number`);
  return v;
}

// Catches identifiers that must never be stored: SSNs and dates of birth
// typed into a free-text field.
export function containsSensitiveNumber(value) {
  if (typeof value !== "string") return false;
  return /\b\d{3}-\d{2}-\d{4}\b/.test(value) || /\bssn\b|social security/i.test(value);
}
