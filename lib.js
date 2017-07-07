#!/usr/bin/env node

const colors = require('colors/safe');
const { execSync } = require('child_process');

function log(message) {
  console.log(`${colors.yellow('[morto]')} ${message}`);
}

function exec(command, cwd) {
  const startTime = new Date();
  log(`[exec] running "${command}" in "/${cwd || ''}"...`);
  try {
    execSync(command, { cwd, stdio: 'inherit', stderr: 'inherit' });
    log(`[exec] finished "${command}" in ${((new Date() - startTime) / 1000).toFixed(2)}s...`);
    return 0;
  } catch (_) {
    log(`[exec] ${colors.red('ERROR')} in "${command}" after ${((new Date() - startTime) / 1000).toFixed(2)}s...`);
    return 1;
  }
}

function copy(object) {
  return JSON.parse(JSON.stringify(object));
}

function trap(fn) {
  return function(...args) {
    try {
      return fn(...args);
    } catch(e) {
      log(`[trap] ERROR: ${e.message}`);
      return 1;
    }
  }
}

function runCommandGroup(project, name, group, env) {
  const commandGroup = project[group] || {};
  const commands = (commandGroup.common || []).concat(commandGroup[env] || []);

  commands.forEach((command, index) => {
    log(`[${name}] Running ${group} ${index}...`);
    const exitCode = exec(command, project.subDirectory);
    if (exitCode !== 0) throw new Error(`Command failed in project ${name}: ${command}`);
  });
}

module.exports = { log, exec, copy, trap, runCommandGroup };
