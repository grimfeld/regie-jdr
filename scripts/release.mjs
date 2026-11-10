// Cut a release: npm run release -- <version> [--dry-run]
//   <version>  an exact version (0.1.0, 0.2.0-beta.1) or patch | minor | major
// Sets package.json to that version, commits, tags vX.Y.Z and pushes main + the tag.
// The tag push starts .github/workflows/release.yml, which builds and publishes the installer.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const BUMPS = ['patch', 'minor', 'major'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const requested = args.find((a) => !a.startsWith('--'));

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

/** Run a command and return its trimmed stdout. Arguments are validated before reaching here. */
function sh(command) {
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

/** Run a command that changes something; only printed on --dry-run. */
function run(command) {
  console.log(`> ${command}`);
  if (!dryRun) execSync(command, { stdio: 'inherit' });
}

function nextVersion(current, bump) {
  const [major, minor, patch] = current.split('-')[0].split('.').map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

if (!requested) fail('usage: npm run release -- <version | patch | minor | major> [--dry-run]');
if (!SEMVER.test(requested) && !BUMPS.includes(requested)) {
  fail(`"${requested}" is not a version (X.Y.Z or X.Y.Z-pre) nor patch/minor/major`);
}

const current = JSON.parse(readFileSync('package.json', 'utf8')).version;
const version = BUMPS.includes(requested) ? nextVersion(current, requested) : requested;
const tag = `v${version}`;

// Preconditions: release from an up-to-date, clean main, with a tag that does not exist yet.
const branch = sh('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') fail(`releases are cut from main, not ${branch}`);
if (sh('git status --porcelain')) fail('working tree is not clean');

sh('git fetch origin main --tags --quiet');
if (sh('git rev-parse HEAD') !== sh('git rev-parse origin/main')) {
  fail('main is not in sync with origin/main (pull or push first)');
}
if (sh(`git tag --list ${tag}`)) fail(`tag ${tag} already exists`);

console.log(`Releasing ${tag} (package.json is ${current})${dryRun ? ' [dry run]' : ''}`);

if (version === current) {
  // npm version refuses a same-version bump; tag the current commit instead.
  run(`git tag -a ${tag} -m "Release ${tag}"`);
} else {
  run(`npm version ${version} -m "Release v%s"`);
}

run('git push origin main');
run(`git push origin ${tag}`);

if (!dryRun)
  console.log(`\n${tag} pushed. The Release workflow on GitHub Actions now builds the installer.`);
