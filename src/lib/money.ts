export function formatMoneyFromCents(amountCents: number, currency: string) {
  const amount = amountCents / 100;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
  }).format(amount);
}

