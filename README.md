# Morto (MOnoRepoTOols)

Morto is a set of tools to help with managing a [monorepo](https://danluu.com/monorepo/).

It currently does these things:

1. Set up a development environment: `morto setup`.
1. Run tests with the right test runner: `morto test <filename>`.
1. Build and distribute projects to staging environments: `morto distribute`.
1. Do these things in CI, where it can automatically figure out which projects (subdirectories) have changed.


## Setup

Morto organises projects by subdirectory. It currently assumes that each subdirectory is its own project, and that there are no dependencies between projects.

You can put system integration tests in subdirectories too, but those are not projects. If a system integration test changes, Morto will run all the tests.

Morto assumes you have a `.morto.js` in the root of your repo. Ours looks something like this:

```javascript
module.exports = {
  projects: {
    topLevelSetup: {
      alwaysRun: true,
      setupCommands: {
        common: [
          '(which ruby && which gem) || echo "Please make sure ruby/gem are installed"',
          '(which node && which yarn) || echo "Please make sure node/yarn are installed"',
        ],
        osx: [
          'which brew || echo "Please make sure brew (Homebrew) is installed"',
          'gem install bundler',
          'bundle install',
          'overcommit --install',
          'overcommit --sign',
        ],
        ci: [
          'sudo apt-get update',
          'bundle check --path=~/.bundle || bundle install --deployment --path=~/.bundle',
        ],
      },
      distributeCommands: {
        common: [],
      },
    },
    linters: {
      alwaysRun: true,
      testRunners: [
        'bundle exec overcommit --sign',
        'SKIP=AuthorEmail,AuthorName,ForbiddenBranches bundle exec overcommit -r',
      ],
    },
    core: {
      subDirectory: 'core',
      setupCommands: {
        common: [
          '(which psql && which createdb) || echo "Please make sure PostgreSQL is installed"',
          'which redis-cli || echo "Please make sure Redis is installed (but not running)"',
          'test -e .env || cp .env.sample .env',
          'yarn install --pure-lockfile',
        ],
        osx: [
          'bundle install ',
          'bundle exec rake db:reset --trace',
        ],
        ci: [
          'bundle check --path=~/.bundle || bundle install --deployment --path=~/.bundle',
          'yarn run build',
          'RAILS_ENV="test" RACK_ENV="test" bundle exec rake db:create db:structure:load --trace',
        ],
      },
      distributeCommands: {
        ci: [
          'git push -f git@heroku.com:staging-remix-core.git $CIRCLE_SHA1:refs/heads/master',
          'heroku run --exit-code rake db:migrate --app staging-remix-core',
          'heroku restart --app staging-remix-core',
          'heroku config:set RELEASE_NUMBER=$((`heroku config:get RELEASE_NUMBER -a staging-remix-core` + 1)) -a staging-remix-core',
        ],
      },
      fileTestRunner: 'bundle exec rspec --format progress --format RspecJunitFormatter --out junit.xml',
      junitOutput: 'junit.xml',
    },
    keystone: {
      subDirectory: 'keystone',
      setupCommands: {
        common: [
          'test -e .env || cp .env.sample .env',
          'virtualenv venv',
          'venv/bin/pip install --upgrade pip',
        ],
        osx: [
          'venv/bin/pip install --upgrade -r requirements.txt',
        ],
        ci: [
          'venv/bin/pip install --upgrade -r requirements.txt -q --log $CIRCLE_ARTIFACTS/pip-keystone.log',
        ],
      },
      distributeCommands: {
        common: [
          'make deploy-stage',
        ],
      },
      testRunners: [
        'make coverage && venv/bin/codecov',
      ],
    },
  },
};
```

We should add more documentation at some point, but at least this should give you a rough idea of what is possible.

- Each project can either have a `subDirectory` (in which case it will only setup/test that project in CI if files in that directory have changed) or `alwaysRun`.
- Each project needs to have a number of `setupCommands`, split between `common` (run regardless of platform), `osx` (run only when you don't use the `--ci` flag) or `ci` (run only when you use the `--ci` flag).
- A project can either have `testRunners` (simply runs the commands) or `fileTestRunner` (will use this command when passing in a file, e.g. `morto test core/file_spec.rb` would run something like `cd core && bundle exec rspec file_spec.rb`).
- You can specify a `junitOutput`, which we will collect in one output if you use the `--junitOutput` flag.


## CI setup

Morto is currently pretty tied to [CircleCI](https://circleci.com) and [Github](https://github.com). Our `circle.yml` looks something like this:

```
dependencies:
  cache_directories:
    - "~/.bundle"
    - "~/.yarn-cache"
    - "core/node_modules"
  override:
    - yarn config set cache-folder ~/.yarn-cache
    - yarn install --pure-lockfile
    - node_modules/.bin/morto setup --ci
database:
  override: []
test:
  override:
    # Service-specific tests (only for what has changed), using CircleCI's test balancing:
    - node_modules/.bin/morto test --runTestRunners --junitOutput $CIRCLE_TEST_REPORTS/reports/junit.xml:
        parallel: true
        files:
          - core/spec/**/*_spec.rb
deployment:
  staging:
    branch: master
    commands:
      - yarn run morto -- distribute --ci
```


## TODO
- Support more platforms than just `osx` and `ci`.
- Support more CI environments than CircleCI+Github.
- Support explicit dependencies between projects.
- Better test-balancing (don't rely on CircleCI for this).
- Better docs!
- Add linters and tests to this repo.
