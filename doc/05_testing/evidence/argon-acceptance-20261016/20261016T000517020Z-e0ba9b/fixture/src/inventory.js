export function reserve(stock, quantity) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('invalid quantity');
  return stock - quantity;
}
