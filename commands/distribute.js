#!/usr/bin/env node
const { log, runCommandGroup } = require('../lib.js');

function distribute(projects, options) {
  log('Running distribute...');
  const env = options.ci ? 'ci' : 'osx';

  Object.keys(projects).forEach((projectName) =>
    runCommandGroup(projects[projectName], projectName, 'distributeCommands', env)
  );

  return 0;
}

module.exports = distribute;
