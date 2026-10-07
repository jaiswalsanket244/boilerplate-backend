const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

// Binary (1024-based) units, rounded to one decimal with a trailing ".0" dropped.
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError(
      `formatBytes expects a non-negative finite number, got ${bytes}`,
    );
  }

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  let rounded = unitIndex === 0 ? Math.round(value) : Number(value.toFixed(1));
  // Rounding can land exactly on 1024 (e.g. 1048575 B -> "1024 KB"); promote so it reads "1 MB".
  if (rounded >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    rounded = Number((rounded / 1024).toFixed(1));
    unitIndex++;
  }

  return `${rounded} ${BYTE_UNITS[unitIndex]}`;
}

export { formatBytes };
