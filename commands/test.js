#!/usr/bin/env node
const { log, exec } = require('../lib.js');

function test(projects, options, config) {
  let exitCode = 0;

  // When we detect parallelism, skip some projects on this machine.
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

  // Parse the files given by CircleCI (which are balanced already).
  const internalPathsByProject = {};
  options.files.forEach((fileName) => {
    const splitFileName = fileName.split(path.sep);
    const projectName = splitFileName[0];
    const internalPath = splitFileName.slice(1).join(path.sep);

    if (!internalPath) throw new Error(`Top-level paths not allowed: "${fileName}"`);
    if (!config.projects[projectName]) throw new Error(`Unknown project: "${projectName}"`);

    internalPathsByProject[projectName] = internalPathsByProject[projectName] || [];
    internalPathsByProject[projectName].push(internalPath);
  });

  // Run the tests for the current project.
  // 1. If a project.fileTestRunner is given, we assume that in circle.yml we have configured
  //    files for this project, and that CircleCI has passed them in to us, and have balanced them.
  // 2. Otherwise, we run the `testRunners`.
  // In both cases we execute things in the context of the project.subDirectory.

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
          exitCode = exec(testRunner, project.subDirectory);
        });
      } else {
        log(`[${projectName}] skipping testRunners...`);
      }
    }

    if (project.fileTestRunner && files.length > 0) {
      log(`[${projectName}] Running fileTestRunner...`);
      exitCode = exec(`${project.fileTestRunner} ${files.join(' ')}`, project.subDirectory);
    }
  });

  // Merge the JUnit XML files, so CircleCI can report and balance tests.
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
            throw new Error(`Error merging JUnit XML outputs: ${error}`);
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
    exitCode = exec(`mkdir -p ${path.dirname(options.junitOutput)}`);
    writeFileSync(options.junitOutput, merged);
    log(`Written to ${options.junitOutput}...`);
  }

  return exitCode;
}

module.exports = test;
