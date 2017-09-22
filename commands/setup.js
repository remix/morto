#!/usr/bin/env node
const { copy, log, runCommandGroup } = require('../lib.js');

function setup(projects, options, config) {
  // TODO(JP): Do something more advanced for Circle CI caching (maybe with
  // Circle CI 2.0) so we don't have to run all the setup on all containers.
  log('Running setup (the same on all containers, so caching is straightforward)...');
  const env = options.ci ? 'ci' : 'osx';

  const projectsWithTriggers = copy(projects);

  // Add in projects that other projects get triggered by as they can depend
  // on setup already having happened there.
  Object.keys(projects).forEach((projectName) => {
    if (projects[projectName].triggeredByProjects) {
      projects[projectName].triggeredByProjects.forEach((triggeredByProjectName) => {
        log(`Using project "${projectName}", so also setting up "${triggeredByProjectName}"...`);
        projectsWithTriggers[triggeredByProjectName] = config.projects[triggeredByProjectName];
      });
    }
  });

  Object.keys(projectsWithTriggers).forEach((projectName) => {
    runCommandGroup(config.projects[projectName], projectName, 'setupCommands', env);
  });

  return 0;
}

module.exports = setup;
