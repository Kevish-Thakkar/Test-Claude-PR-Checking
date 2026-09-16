const test = require("node:test");
const assert = require("node:assert");
const { add, divide } = require("../src/calculator");

test("add numbers", () => {
  assert.strictEqual(add(2, 3), 5);
});

test("divide numbers", () => {
  assert.strictEqual(divide(10, 2), 5);
});
