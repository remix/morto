#!/usr/bin/env node
const { log, runCommandGroup } = require('../lib.js');

function clean(projects, options) {
  log('Running clean...');
  const env = options.ci ? 'ci' : 'osx';

  Object.keys(projects).forEach((projectName) =>
    runCommandGroup(projects[projectName], projectName, 'cleanCommands', env)
  );

  return 0;
}

module.exports = clean;
