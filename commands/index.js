const clean = require('./clean.js');
const setup = require('./setup.js');
const test = require('./test.js');
const distribute = require('./distribute.js');

const { trap } = require('../lib.js');

module.exports = {
  // TODO(JP): Maybe generalize some of these?
  // See https://github.com/remix/morto/pull/6#discussion_r143610256
  clean: trap(clean),
  setup: trap(setup),
  test: trap(test),
  distribute: trap(distribute),
};
