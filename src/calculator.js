function add(a, b) {
  return a + b;
}

function divide(a, b) {
  return a / b;
}

function multiply(a, b) {
  return a * b;
}

function power(a, b) {
  return Math.pow(a, b);
}

console.log("divide(10/0) :>> ", divide(10 / 0));

module.exports = {
  add,
  divide,
  multiply,
  power,
};
