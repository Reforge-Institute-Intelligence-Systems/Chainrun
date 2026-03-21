#!/usr/bin/env node
/* ═══════════════════════════════════════
   ChainRun → GitHub Deploy Tool
   
   Uploads all site files to GitHub Pages.
   Run: node deploy.js
   
   First-time setup:
   1. Go to github.com/settings/tokens
   2. Generate new token (classic)
   3. Check "repo" scope
   4. Copy the token
   5. Set it: export GITHUB_TOKEN=ghp_your_token_here
   
   Or paste it when prompted.
   ═══════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');

// ── Config ──
const OWNER = 'Reforge-Institute-Intelligence-Systems';
const REPO = 'Chainrun';
const BRANCH = 'main';
const SITE_DIR = __dirname; // same folder as this script

// Files to deploy (everything except deploy.js itself and the worker folder)
const DEPLOY_FILES = [
  'index.html',
  'styles.css',
  'app.js',
  'api.js',
  'engine.js',
  'paygate.js',
  'profiles.js',
  'manifest.json',
  'sw.js'
];

// ── Helpers ──

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function githubRequest(method, endpoint, token, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'ChainRun-Deploy/1.0',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    };

    if (body) {
      const data = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject({ status: res.statusCode, message: json.message || data });
          } else {
            resolve(json);
          }
        } catch {
          if (res.statusCode >= 400) reject({ status: res.statusCode, message: data });
          else resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getFileSha(token, filePath) {
  try {
    const result = await githubRequest(
      'GET',
      `/repos/${OWNER}/${REPO}/contents/${filePath}?ref=${BRANCH}`,
      token
    );
    return result.sha;
  } catch (e) {
    if (e.status === 404) return null; // file doesn't exist yet
    throw e;
  }
}

async function uploadFile(token, filePath, content, sha, commitMsg) {
  const body = {
    message: commitMsg,
    content: Buffer.from(content).toString('base64'),
    branch: BRANCH
  };
  if (sha) body.sha = sha;

  return githubRequest(
    'PUT',
    `/repos/${OWNER}/${REPO}/contents/${filePath}`,
    token,
    body
  );
}

// ── Main ──

async function main() {
  console.log('\n  ╔══════════════════════════════════╗');
  console.log('  ║   ChainRun → GitHub Deploy       ║');
  console.log('  ╚══════════════════════════════════╝\n');

  // Get token
  let token = process.env.GITHUB_TOKEN;
  if (!token) {
    token = await ask('  GitHub token (ghp_...): ');
    if (!token) {
      console.log('\n  ✗ No token provided. Exiting.\n');
      process.exit(1);
    }
  }

  // Verify token works
  console.log('  Checking token...');
  try {
    await githubRequest('GET', `/repos/${OWNER}/${REPO}`, token);
    console.log(`  ✓ Connected to ${OWNER}/${REPO}\n`);
  } catch (e) {
    console.log(`\n  ✗ Cannot access repo: ${e.message}`);
    console.log('  Check your token has "repo" scope.\n');
    process.exit(1);
  }

  // Check which files need updating
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const commitMsg = `Deploy ${timestamp}`;
  
  let uploaded = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of DEPLOY_FILES) {
    const localPath = path.join(SITE_DIR, file);
    
    if (!fs.existsSync(localPath)) {
      console.log(`  ⊘ ${file} — not found locally, skipping`);
      skipped++;
      continue;
    }

    const localContent = fs.readFileSync(localPath, 'utf8');
    
    try {
      // Get current SHA (needed for updates)
      process.stdout.write(`  ↑ ${file}...`);
      const sha = await getFileSha(token, file);
      
      await uploadFile(token, file, localContent, sha, commitMsg);
      console.log(` ✓${sha ? ' (updated)' : ' (created)'}`);
      uploaded++;
    } catch (e) {
      console.log(` ✗ Error: ${e.message || e}`);
      errors++;
    }
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n  ─────────────────────────────────`);
  console.log(`  Deployed: ${uploaded}  Skipped: ${skipped}  Errors: ${errors}`);
  console.log(`  Commit: "${commitMsg}"`);
  
  if (uploaded > 0 && errors === 0) {
    console.log(`\n  ✓ Live at https://chainrun.tech`);
    console.log(`  (GitHub Pages may take 1-2 minutes to update)\n`);
  } else if (errors > 0) {
    console.log(`\n  ⚠ Some files failed. Check errors above.\n`);
  }
}

main().catch(e => {
  console.error('\n  Fatal error:', e.message || e);
  process.exit(1);
});
