#!/usr/bin/env node
const commandLineArgs = require('command-line-args');
const commandLineCommands = require('command-line-commands');
const path = require('path');
const syncRequest = require('sync-request');
const { execSync } = require('child_process');

const commands = require('./commands');
const { log, exec, copy } = require('./lib.js');

const { command, argv } = commandLineCommands([null, 'setup', 'test', 'distribute']);

if (command === null) {
  console.log('Valid options are: "setup", "test", "distribute".');
  process.exit(1);
}

// The different command line options.
// TODO: Add more documentation about what each of them does.
const options = commandLineArgs([
  { name: 'files', type: String, multiple: true, defaultOption: true, defaultValue: [] },
  { name: 'junitOutput', type: String },
  { name: 'onlyProject', type: String, multiple: true },
  { name: 'runTestRunners', type: Boolean },
  { name: 'ci', type: Boolean },
], { argv });

// Load in config.
const config = require(path.join(process.cwd(), '.morto.js'));

// Figure out which projects to run.
// 1. --onlyProject lets you manually select projects to run (useful for debugging).
// 2. When a PR is detected, we only run projects of which the project.subDirectory has changed,
//    and we always keep projects with project.alwaysRun set to true.
// 3. Otherwise, we run all projects.
let selectedProjects = {};
{
  if (options.onlyProject && options.onlyProject.length > 0) {
    // Iterate over config.projects to guarantee order.
    Object.keys(config.projects).forEach((projectName) => {
      if (options.onlyProject.includes(projectName)) {
        selectedProjects[projectName] = config.projects[projectName];
      }
    });
    log(`--onlyProject used, running for projects: ${Object.keys(selectedProjects).join(', ')}...`);
  } else if (process.env.CI_PULL_REQUEST) {
    const splitPRUrl = process.env.CI_PULL_REQUEST.split('/');
    const prNumber = parseInt(splitPRUrl[splitPRUrl.length - 1], 10);
    log(`Pull request detected: #${prNumber}...`);

    const prURL = `https://api.github.com/repos/${process.env.CIRCLE_PROJECT_USERNAME}/${process.env.CIRCLE_PROJECT_REPONAME}/pulls/${prNumber}?access_token=${process.env.GITHUB_BOT_TOKEN}`;
    const response = syncRequest('GET', prURL, { headers: {
      'Accept': 'application/vnd.github.v3+json',
      'Content-type': 'application/json',
      'User-Agent': 'morto',
    } });
    if (!response.body) throw new Error(`Could not get a response from the Github API: "${prURL}"`);
    const { commits } = JSON.parse(response.body);
    log(`Found ${commits} commit(s) in this PR...`);

    const filesChanged = execSync(`git --no-pager diff --name-only HEAD~${commits}`).toString().split('\n');

    const projectNamesBySubdirectory = {};
    Object.keys(config.projects).forEach((projectName) => {
      const project = config.projects[projectName];

      if (project.alwaysRun) {
        selectedProjects[projectName] = project;
      } else {
        if (projectNamesBySubdirectory[project.subDirectory]) {
          throw new Error(`Cannot have multiple projects with same subDirectory: "${project.subDirectory}"`);
        }
        projectNamesBySubdirectory[project.subDirectory] = projectName;
      }
    });

    for (const fileName of filesChanged) {
      if (fileName.length > 0) {
        const projectName = projectNamesBySubdirectory[fileName.split(path.sep)[0]];
        if (!projectName) {
          selectedProjects = copy(config.projects);
          log(`Detected non-project file change in "${fileName}", using all projects...`);
          break;
        }
        if (!selectedProjects[projectName]) {
          selectedProjects[projectName] = config.projects[projectName];
        }
      }
    }

    if (command === 'setup') {
      // Find all projects that should be set up together.
      // E.g. if you have "A", "B", and "A-B-integration", then if any of those
      // three changes, then all three should be set up. If you also have a
      // "C" and a "B-C-integration", that forms another group of three (if "C"
      // changes then "A" does not to be set up).
      const projectSetupGroups = [];
      Object.keys(config.projects).forEach((projectName) => {
        const project = config.projects[projectName];
        if (project.triggeredByProjects) {
          project.triggeredByProjects.forEach((dependentProjectName) => {
            if (!config.projects[dependentProjectName]) {
              throw new Error(`Couldn't find project "${dependentProjectName}" that "${projectName}" depends on`);
            }
            if (config.projects[dependentProjectName].triggeredByProjects) {
              throw new Error(`"${projectName}" depends on "${dependentProjectName}", which itself depends on other selectedProjects, cannot do that`);
            }
          });
          projectSetupGroups.push(project.triggeredByProjects.concat([projectName]));
        }
      });
      log(`All project groups for setup: ${projectSetupGroups.map((group) => group.join('+')).join(', ')}...`);

      // If a project is selected, make sure its whole group is selected.
      Object.keys(selectedProjects).forEach((projectName) => {
        projectSetupGroups.forEach((group) => {
          if (group.includes(projectName)) {
            log(`Using project "${projectName}", so for setup using all of ${group.join('+')}...`);
            group.forEach((groupProjectName) => {
              selectedProjects[groupProjectName] = config.projects[groupProjectName];
            });
          }
        });
      });

      log(`Selected projects (just for setup): ${Object.keys(selectedProjects).join(', ')}...`);
    } else {
      // If a project is selected, make sure projects that depend on it are selected.
      Object.keys(config.projects).forEach((projectName) => {
        const project = config.projects[projectName];
        if (project.triggeredByProjects) {
          project.triggeredByProjects.forEach((dependentProjectName) => {
            if (selectedProjects[dependentProjectName]) {
              log(`Using project "${dependentProjectName}", so also using "${projectName}"...`);
              selectedProjects[dependentProjectName] = config.projects[dependentProjectName];
            }
          });
        }
      });

      log(`Selected projects: ${Object.keys(selectedProjects).join(', ')}...`);
    }
  } else {
    selectedProjects = copy(config.projects);
    log(`Selected all projects: ${Object.keys(selectedProjects).join(', ')}...`);
  }
}

// Run the specified command.
const exitCode = commands[command](selectedProjects, options, config);

process.exit(exitCode);
