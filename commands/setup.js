#!/usr/bin/env node
const { log, runCommandGroup } = require('../lib.js');

function setup(projects, options) {
  log('Running setup...');
  const env = options.ci ? 'ci' : 'osx';

  Object.keys(projects).forEach((projectName) =>
    runCommandGroup(projects[projectName], projectName, 'setupCommands', env)
  );

  return 0;
}

module.exports = setup;
