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
function getUser(user) {
  return user.profile.name;
}

console.log(getUser(null));

module.exports = {
  add,
  divide,
  multiply,
  power,
};
