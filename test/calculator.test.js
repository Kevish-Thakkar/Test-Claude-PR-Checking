const test = require("node:test");
const assert = require("node:assert");
const { add, divide, multiply, power } = require("../src/calculator");

test("add numbers", () => {
  assert.strictEqual(add(2, 3), 5);
});

test("divide numbers", () => {
  assert.strictEqual(divide(10, 2), 5);
});

test("multiply numbers", () => {
  assert.strictEqual(multiply(4, 5), 20);
});

test("power numbers", () => {
  assert.strictEqual(power(2, 3), 8);
});
