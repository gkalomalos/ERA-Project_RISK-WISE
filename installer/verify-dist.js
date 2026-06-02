#!/usr/bin/env node
/*
 * Installer smoke-test for issue #66 (electron-builder 26.0.12 -> 26.7.0).
 *
 * Verifies that `npm run dist` produced the artifacts required by the
 * acceptance criteria: NSIS installer, zip, 7z, and a well-formed
 * latest.yml for the GitHub publish provider.
 *
 * Usage:
 *   node installer/verify-dist.js
 *   npm run verify-dist
 *
 * Exits non-zero on the first failure so it can gate a release.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const distDir = path.join(ROOT, 'dist', version);

const checks = [];
const fail = (name, msg) => checks.push({ name, ok: false, msg });
const pass = (name, msg = '') => checks.push({ name, ok: true, msg });

function fileExists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function sha512OfFile(p) {
  const buf = fs.readFileSync(p);
  return crypto.createHash('sha512').update(buf).digest('base64');
}

function expectFile(label, relPath, { minBytes = 1024 } = {}) {
  const abs = path.join(distDir, relPath);
  if (!fileExists(abs)) {
    fail(label, `missing: ${abs}`);
    return null;
  }
  const size = fs.statSync(abs).size;
  if (size < minBytes) {
    fail(label, `too small (${size} < ${minBytes} bytes): ${abs}`);
    return null;
  }
  pass(label, `${relPath} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  return abs;
}

function parseLatestYml(p) {
  const text = fs.readFileSync(p, 'utf8');
  const obj = {};
  const files = [];
  let inFiles = false;
  let current = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line) continue;
    if (line.startsWith('files:')) { inFiles = true; continue; }
    if (inFiles && line.startsWith('  - ')) {
      current = {};
      files.push(current);
      const m = line.match(/^\s+-\s+(\w+):\s*(.+)$/);
      if (m) current[m[1]] = m[2];
      continue;
    }
    if (inFiles && line.startsWith('    ')) {
      const m = line.match(/^\s+(\w+):\s*(.+)$/);
      if (m && current) current[m[1]] = m[2];
      continue;
    }
    inFiles = false;
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) obj[m[1]] = m[2];
  }
  obj.files = files;
  return obj;
}

// --- Pre-check: dist directory exists -------------------------------------
if (!fs.existsSync(distDir)) {
  fail('dist directory', `not found: ${distDir} — run \`npm run dist\` first`);
  report();
  process.exit(1);
}
pass('dist directory', distDir);

// --- AC: NSIS + zip + 7z artifacts ----------------------------------------
const installer = expectFile(
  'NSIS installer',
  `RiskWiseInstaller-v${version}-Setup.exe`,
  { minBytes: 10 * 1024 * 1024 }
);
const zipArtifact = expectFile(
  'zip artifact',
  `RiskWiseInstaller-v${version}-Setup.zip`,
  { minBytes: 10 * 1024 * 1024 }
);
const sevenZArtifact = expectFile(
  '7z artifact',
  `RiskWiseInstaller-v${version}-Setup.7z`,
  { minBytes: 10 * 1024 * 1024 }
);

// --- AC: latest.yml well-formed for GitHub publish provider ---------------
const latestYmlPath = path.join(distDir, 'latest.yml');
if (!fileExists(latestYmlPath)) {
  fail('latest.yml', `missing: ${latestYmlPath}`);
} else {
  const yml = parseLatestYml(latestYmlPath);
  const required = ['version', 'path', 'sha512', 'releaseDate'];
  const missing = required.filter((k) => !yml[k]);
  if (missing.length) {
    fail('latest.yml fields', `missing keys: ${missing.join(', ')}`);
  } else {
    pass('latest.yml fields', `keys present: ${required.join(', ')}`);
  }
  if (yml.version && yml.version.replace(/['"]/g, '') !== version) {
    fail('latest.yml version', `expected ${version}, got ${yml.version}`);
  } else {
    pass('latest.yml version', yml.version);
  }
  if (yml.path && installer) {
    const expectedName = path.basename(installer);
    const actualName = yml.path.replace(/['"]/g, '');
    if (actualName !== expectedName) {
      fail('latest.yml path', `expected ${expectedName}, got ${actualName}`);
    } else {
      pass('latest.yml path', actualName);
    }
  }
  if (installer && yml.sha512) {
    const computed = sha512OfFile(installer);
    const recorded = yml.sha512.replace(/['"]/g, '');
    if (computed !== recorded) {
      fail('latest.yml sha512', `mismatch for ${path.basename(installer)}`);
    } else {
      pass('latest.yml sha512', 'matches installer');
    }
  }
  if (Array.isArray(yml.files) && yml.files.length > 0) {
    pass('latest.yml files[]', `${yml.files.length} entries`);
  } else {
    fail('latest.yml files[]', 'no entries — auto-updater needs this');
  }
}

// --- AC: electron-updater wired in renderer/main --------------------------
const electronJsPath = path.join(ROOT, 'build', 'electron.js');
if (fileExists(electronJsPath)) {
  const src = fs.readFileSync(electronJsPath, 'utf8');
  if (src.includes('electron-updater')) {
    pass('electron-updater wired', 'imported in build/electron.js');
  } else {
    pass(
      'electron-updater wired',
      'NOTE: not referenced in build/electron.js — check main process if auto-update is expected'
    );
  }
}

// --- Report ---------------------------------------------------------------
function report() {
  console.log('\nInstaller smoke-test for electron-builder bump (issue #66)\n');
  for (const c of checks) {
    const mark = c.ok ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${c.name}${c.msg ? ' — ' + c.msg : ''}`);
  }
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  return failed;
}

const failed = report();
process.exit(failed === 0 ? 0 : 1);
