import { reserve } from './inventory.js';
export function placeOrder(stock, quantity) { return { remaining: reserve(stock, quantity) }; }
