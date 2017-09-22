#!/usr/bin/env node
const { log, runCommandGroup } = require('../lib.js');

function setup(projects, options) {
  // TODO(JP): Do something more advanced for Circle CI caching (maybe with
  // Circle CI 2.0) so we don't have to run all the setup on all containers.
  log('Running setup (the same on all containers, so caching is straightforward)...');
  const env = options.ci ? 'ci' : 'osx';

  Object.keys(projects).forEach((projectName) =>
    runCommandGroup(projects[projectName], projectName, 'setupCommands', env)
  );

  return 0;
}

module.exports = setup;
