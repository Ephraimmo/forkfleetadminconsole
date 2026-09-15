/** Shared demo-only formatters used across pages. */

export const money = (value: number, currency: string = "ZAR") =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);

export const money2 = (value: number, currency: string = "ZAR") =>
  new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

export const number0 = (value: number) =>
  new Intl.NumberFormat("en-ZA").format(Math.round(value));

export const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
