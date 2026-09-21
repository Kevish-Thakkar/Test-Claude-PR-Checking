const test = require("node:test");
const assert = require("node:assert");
const { add, divide } = require("../src/calculator");

test("add positive integers", () => {
  assert.strictEqual(add(2, 3), 5);
});

test("add negative numbers", () => {
  assert.strictEqual(add(-2, -3), -5);
});

test("add mixed sign numbers", () => {
  assert.strictEqual(add(-2, 5), 3);
});

test("add zeros", () => {
  assert.strictEqual(add(0, 0), 0);
});

test("add decimals", () => {
  assert.strictEqual(add(1.5, 2.25), 3.75);
});

test("divide positive integers", () => {
  assert.strictEqual(divide(10, 2), 5);
});

test("divide resulting in decimal", () => {
  assert.strictEqual(divide(1, 2), 0.5);
});

test("divide negative by positive", () => {
  assert.strictEqual(divide(-10, 2), -5);
});

test("divide by zero yields Infinity", () => {
  assert.strictEqual(divide(10, 0), Infinity);
});

test("divide zero by number", () => {
  assert.strictEqual(divide(0, 5), 0);
});
