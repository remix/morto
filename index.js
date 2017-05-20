#!/usr/bin/env node
const colors = require('colors/safe');
const commandLineArgs = require('command-line-args');
const commandLineCommands = require('command-line-commands');
const jmerge = require('junit-merge/lib');
const path = require('path');
const syncRequest = require('sync-request');
const { execSync } = require('child_process');
const { existsSync, writeFileSync } = require('fs');

// Global exit code. If some execution goes wrong, we exit with an error code,
// but we also want to continue running so we can collect JUnit XML files and such.
let exitCode = 0;

// Some helper functions.
function log(message) {
  console.log(`${colors.yellow('[morto]')} ${message}`);
}
function exec(command, cwd) {
  const startTime = new Date();
  log(`[exec] running "${command}" in "/${cwd || ''}"...`);
  try {
    execSync(command, { cwd, stdio: 'inherit' });
    log(`[exec] finished "${command}" in ${((new Date() - startTime) / 1000).toFixed(2)}s...`);
  } catch (_) {
    log(`[exec] ${colors.red('ERROR')} in "${command}" after ${((new Date() - startTime) / 1000).toFixed(2)}s...`);
    exitCode = 1;
  }
}
function copy(object) {
  return JSON.parse(JSON.stringify(object));
}

const { command, argv } = commandLineCommands([null, 'install', 'test']);

if (command === null) {
  console.log('Valid options are: "install", "test".');
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
let projects = {};
{
  if (options.onlyProject.length !== 0) {
    // Iterate over config.projects to guarantee order.
    Object.keys(config.projects).forEach((projectName) => {
      if (options.onlyProject.includes(projectName)) {
        projects[projectName] = config.projects[projectName];
      }
    });
    log(`--onlyProject used, running for projects: ${Object.keys(projects).join(', ')}...`);
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
        projects[projectName] = project;
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
          projects = copy(config.projects);
          log(`Detected non-project file change in "${fileName}", using all projects...`);
          break;
        }
        if (!projects[projectName]) {
          projects[projectName] = config.projects[projectName];
        }
      }
    }

    log(`Using projects: ${Object.keys(projects).join(', ')}...`);
  } else {
    projects = copy(config.projects);
    log(`Using all projects: ${Object.keys(projects).join(', ')}...`);
  }
}

// If the command is `install`, just run project.installCommands and then bail.
{
  if (command === 'install') {
    log('Running installation...');

    Object.keys(projects).forEach((projectName) => {
      const project = projects[projectName];
      const installCommands = project.installCommands || {};

      const installType = options.ci ? 'ci' : 'osx';
      const commands = (installCommands.common || [])
        .concat(installCommands[installType] || []);

      commands.forEach((installCommand, index) => {
        log(`[${projectName}] Running installCommand ${index}...`);
        exec(installCommand, project.subDirectory);
        if (exitCode !== 0) process.exit(exitCode);
      });
    });
    process.exit(exitCode);
  } else {
    log('Skipping installation...');
  }
}

// When we detect parallelism, skip some projects on this machine.
{
  if (process.env.CIRCLE_NODE_TOTAL > 1 && process.env.CIRCLE_NODE_INDEX !== undefined) {
    log(`Parallelism detected; pruning projects that are not on node ${process.env.CIRCLE_NODE_INDEX}...`);
    let nodeIndex = 0;
    const projectNames = Object.keys(projects);
    projectNames.forEach((projectName) => {
      if (projects[projectName].fileTestRunner) {
        log(`[${projectName}] contains fileTestRunner, keeping...`);
      } else {
        if (nodeIndex === parseInt(process.env.CIRCLE_NODE_INDEX, 10)) {
          log(`[${projectName}] running on node ${nodeIndex}, keeping...`);
        } else {
          log(`[${projectName}] running on node ${nodeIndex}, removing...`);
          delete projects[projectName];
        }
        nodeIndex = (nodeIndex + 1) % process.env.CIRCLE_NODE_TOTAL;
      }
    });
    log(`Running these projects on this node: ${Object.keys(projects).join(', ')}...`);
  }
}

// Parse the files given by CircleCI (which are balanced already).
const internalPathsByProject = {};
{
  options.files.forEach((fileName) => {
    const splitFileName = fileName.split(path.sep);
    const projectName = splitFileName[0];
    const internalPath = splitFileName.slice(1).join(path.sep);

    if (!internalPath) throw new Error(`Top-level paths not allowed: "${fileName}"`);
    if (!config.projects[projectName]) throw new Error(`Unknown project: "${projectName}"`);

    internalPathsByProject[projectName] = internalPathsByProject[projectName] || [];
    internalPathsByProject[projectName].push(internalPath);
  });
}

// Run the tests for the current project.
// 1. If a project.fileTestRunner is given, we assume that in circle.yml we have configured
//    files for this project, and that CircleCI has passed them in to us, and have balanced them.
// 2. Otherwise, we run the `testRunners`.
// In both cases we execute things in the context of the project.subDirectory.
{
  log('Running tests...');
  Object.keys(projects).forEach((projectName) => {
    const project = projects[projectName];
    const files = internalPathsByProject[projectName] || [];

    if (project.testRunners && project.fileTestRunner) {
      throw new Error(`[${projectName}] Cannot have both testRunners and fileTestRunner for same project`);
    }

    if (project.testRunners) {
      if (options.runTestRunners) {
        project.testRunners.forEach((testRunner, index) => {
          log(`[${projectName}] Running testRunner ${index}...`);
          exec(testRunner, project.subDirectory);
        });
      } else {
        log(`[${projectName}] skipping testRunners...`);
      }
    }

    if (project.fileTestRunner && files.length > 0) {
      log(`[${projectName}] Running fileTestRunner...`);
      exec(`${project.fileTestRunner} ${files.join(' ')}`, project.subDirectory);
    }
  });
}

// Merge the JUnit XML files, so CircleCI can report and balance tests.
{
  if (!options.junitOutput) {
    log('Skipping JUnit XML merging (no --junitOutput given)...');
  } else {
    log('Merging JUnit XML outputs...');
    const junitTestSuites = [];
    Object.keys(projects).forEach((projectName) => {
      const project = projects[projectName];
      if (project.junitOutput) {
        const file = path.join(projectName, project.junitOutput);
        if (!existsSync(file)) {
          log(`[${projectName}] "${file}" not found, skipping...`);
          return;
        }

        log(`[${projectName}] Parsing "${file}"...`);
        jmerge.getTestsuites(file, (error, result) => {
          if (error) {
            log(`Error merging JUnit XML outputs: ${error}`);
            process.exit(1);
          } else {
            junitTestSuites.push(
              result
                .replace(/ file="(\.\/)?/g, ` file="${projectName}/`)
                .replace(/ classname="/g, ` classname="${projectName}.`)
                .replace(/ name="/g, ` name="[${projectName}] `)
            );
          }
        });
      }
    });
    const merged = `<?xml version="1.0"?>\n<testsuites>\n${junitTestSuites.join('\n')}</testsuites>\n`;
    exec(`mkdir -p ${path.dirname(options.junitOutput)}`);
    writeFileSync(options.junitOutput, merged);
    log(`Written to ${options.junitOutput}...`);
  }
}

process.exit(exitCode);
