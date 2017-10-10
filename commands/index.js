const clean = require('./clean.js');
const setup = require('./setup.js');
const test = require('./test.js');
const distribute = require('./distribute.js');

const { trap } = require('../lib.js');

module.exports = {
  clean: trap(clean),
  setup: trap(setup),
  test: trap(test),
  distribute: trap(distribute),
};
