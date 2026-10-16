import assert from 'node:assert/strict';
import { reserve } from '../src/inventory.js';
assert.equal(reserve(3, 2), 1);
assert.throws(() => reserve(3, 4), /insufficient stock/);
assert.throws(() => reserve(3, 0), /invalid quantity/);
