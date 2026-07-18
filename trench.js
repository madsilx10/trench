const axios  = require('axios');
const crypto = require('crypto');
const fs     = require('fs');

// ═══════════════════ CONFIG ═══════════════════
const BEARER    = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const CLIENT_ID = 'MTIvVjVxQUNHSXdjXzFaMWVUNnM6MTpjaQ';
const REDIRECT_URI = 'https://tren.ch/api/auth/x/callback';

// Referral username tren.ch (kosongkan jika tidak ada)
const REF = 'mirzaeaj';

// Next-Action IDs — update jika tren.ch redeploy
const NA_CLAIM  = '40a31a8522e1a0cc85743ebc0ca9abcb3404bbb83e';
const NA_FOLLOW = '4018fee17e006a5451bc59a4251e66694f6eb9f037';
const DEPLOY_ID = 'dpl_8vKQVe2eDAxtWkG5kcswxVJjiXyw';

const UA        = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const SEC_CH_UA = '"Mises";v="141", "Not?A_Brand";v="8", "Chromium";v="141"';

const AKUN_FILE     = 'akun.txt';
const FOLLOWED_FILE = 'followed.txt';
// ══════════════════════════════════════════════

const sleep  = ms => new Promise(r => setTimeout(r, ms));
const rDelay = (a = 2000, b = 5000) => sleep(Math.floor(Math.random() * (b - a)) + a);

function prompt(question) {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(question, ans => { rl.close(); res(ans); }));
}

// ── File helpers ──────────────────────────────
function readAccounts() {
  const lines = fs.readFileSync(AKUN_FILE, 'utf-8')
    .split('\n').map(l => l.trim()).filter(Boolean);
  const acc = [];
  for (let i = 0; i < lines.length; i += 2) {
    if (lines[i] && lines[i + 1])
      acc.push({ authToken: lines[i], ct0: lines[i + 1] });
  }
  return acc;
}

function isFollowed(authToken) {
  if (!fs.existsSync(FOLLOWED_FILE)) return false;
  return fs.readFileSync(FOLLOWED_FILE, 'utf-8')
    .split('\n').map(l => l.trim()).includes(authToken);
}

function markFollowed(token) {
  fs.appendFileSync(FOLLOWED_FILE, token + '\n');
}

// ── X headers ─────────────────────────────────
const xH = (authToken, ct0, extra = {}) => ({
  Authorization: `Bearer ${BEARER}`,
  'X-Csrf-Token': ct0,
  Cookie: `auth_token=${authToken}; ct0=${ct0}`,
  'User-Agent': UA,
  'X-Twitter-Auth-Type': 'OAuth2Session',
  'X-Twitter-Active-User': 'yes',
  'Sec-Ch-Ua': SEC_CH_UA,
  'Sec-Ch-Ua-Mobile': '?1',
  'Sec-Ch-Ua-Platform': '"Android"',
  Accept: '*/*',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  ...extra
});

// ── Follow @trenches di X ─────────────────────
let _uid = null;
async function getTrenchesId(authToken, ct0) {
  if (_uid) return _uid;
  const { data } = await axios.get('https://x.com/i/api/1.1/users/show.json', {
    params: { screen_name: 'trenches' },
    headers: xH(authToken, ct0)
  });
  _uid = data.id_str;
  return _uid;
}

async function followOnX(authToken, ct0) {
  const uid = await getTrenchesId(authToken, ct0);
  const { data } = await axios.post(
    'https://x.com/i/api/1.1/friendships/create.json',
    `user_id=${uid}`,
    { headers: xH(authToken, ct0, { 'Content-Type': 'application/x-www-form-urlencoded' }) }
  );
  return data;
}

// ── OAuth X → tren.ch ─────────────────────────
async function oauthXToTrench(authToken, ct0) {
  // 1. Initiate dari tren.ch → dapat X authorize URL
  const initRes = await axios.get('https://tren.ch/api/auth/x', {
    maxRedirects: 0,
    validateStatus: s => s < 500,
    headers: {
      'User-Agent': UA,
      'Sec-Ch-Ua': SEC_CH_UA,
      'Sec-Ch-Ua-Mobile': '?1',
      'Sec-Ch-Ua-Platform': '"Android"',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
    }
  });

  const xAuthUrl = initRes.headers.location;
  if (!xAuthUrl || !xAuthUrl.includes('x.com')) {
    throw new Error(`Gagal dapat X authorize URL dari tren.ch. Status: ${initRes.status}, Location: ${xAuthUrl}`);
  }

  // 2. Hit X authorize dengan cookie akun
  const xAuthRes = await axios.get(xAuthUrl, {
    maxRedirects: 0,
    validateStatus: s => s < 500,
    headers: xH(authToken, ct0, {
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Site': 'cross-site',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    })
  });

  // Ambil callback URL
  let callbackUrl = xAuthRes.headers.location;
  if (!callbackUrl && typeof xAuthRes.data === 'object') {
    callbackUrl = xAuthRes.data.redirect_uri;
  }
  if (!callbackUrl) {
    throw new Error('X tidak redirect ke tren.ch callback');
  }

  // 3. Hit tren.ch callback → dapat session cookies
  const cbRes = await axios.get(callbackUrl, {
    maxRedirects: 10,
    validateStatus: s => s < 500,
    headers: {
      'User-Agent': UA,
      'Sec-Ch-Ua': SEC_CH_UA,
      'Sec-Ch-Ua-Mobile': '?1',
      'Sec-Ch-Ua-Platform': '"Android"',
      Accept: 'text/html,application/xhtml+xml',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Site': 'cross-site',
    }
  });

  const setCookies = cbRes.headers['set-cookie'] || [];
  let trenchSession = '', trenchUser = '';
  for (const c of setCookies) {
    const sm = c.match(/trench_x_session=([^;]+)/);
    const um = c.match(/trench_user=([^;]+)/);
    if (sm) trenchSession = sm[1];
    if (um) trenchUser = decodeURIComponent(um[1]);
  }

  if (!trenchSession) throw new Error('Gagal dapat trench_x_session dari callback');
  return { trenchSession, trenchUser };
}

// ── tren.ch actions ───────────────────────────
const trH = (session, user, action, referer) => ({
  Accept: 'text/x-component',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Content-Type': 'text/plain;charset=UTF-8',
  Cookie: `trench_ref=${REF}; trench_x_session=${session}; trench_user=${user}`,
  'Next-Action': action,
  'X-Deployment-Id': DEPLOY_ID,
  Origin: 'https://tren.ch',
  Referer: referer,
  'User-Agent': UA,
  'Sec-Ch-Ua': SEC_CH_UA,
  'Sec-Ch-Ua-Mobile': '?1',
  'Sec-Ch-Ua-Platform': '"Android"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
});

function parseRSC(raw) {
  const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
  for (const line of str.split('\n')) {
    const m = line.match(/^\d+:(\{.+\})$/);
    if (m) {
      try {
        const p = JSON.parse(m[1]);
        if (p.ok !== undefined) return p;
      } catch {}
    }
  }
  return null;
}

async function claimTrench(session, user) {
  const { data } = await axios.post(
    'https://tren.ch/claim',
    JSON.stringify([REF]),
    { headers: trH(session, user, NA_CLAIM, 'https://tren.ch/claim') }
  );
  return parseRSC(data) ?? data;
}

async function followTrendotch(session, user) {
  const { data } = await axios.post(
    'https://tren.ch/',
    JSON.stringify(['follow_trendotch']),
    { headers: trH(session, user, NA_FOLLOW, 'https://tren.ch/') }
  );
  return parseRSC(data) ?? data;
}

// ── Process satu akun ─────────────────────────
async function processAccount({ authToken, ct0 }, idx) {
  const tag = `[Akun ${idx + 1}]`;

  // Step 1: Follow @trenches di X
  if (isFollowed(authToken)) {
    console.log(`${tag} Sudah follow @trenches → skip`);
  } else {
    console.log(`${tag} Follow @trenches di X...`);
    await followOnX(authToken, ct0);
    markFollowed(authToken);
    console.log(`${tag} ✓ Followed @trenches`);
    await rDelay(2000, 4000);
  }

  // Step 2: OAuth X → tren.ch
  console.log(`${tag} OAuth X → tren.ch...`);
  const { trenchSession, trenchUser } = await oauthXToTrench(authToken, ct0);
  console.log(`${tag} ✓ Login sebagai @${trenchUser}`);
  await rDelay(2000, 4000);

  // Step 3: Claim
  console.log(`${tag} Claim...`);
  const claimRes = await claimTrench(trenchSession, trenchUser);
  console.log(`${tag} ✓ Claim: ok=${claimRes?.ok} isNew=${claimRes?.isNew}`);
  await rDelay(2000, 4000);

  // Step 4: Follow task
  console.log(`${tag} Task follow_trendotch...`);
  const taskRes = await followTrendotch(trenchSession, trenchUser);
  console.log(`${tag} ✓ Task: stars=${taskRes?.stars} tasks=${JSON.stringify(taskRes?.tasksCompleted)}`);
}

// ── Main ──────────────────────────────────────
async function main() {
  const accounts = readAccounts();
  if (!accounts.length) { console.log('akun.txt kosong'); return; }
  console.log(`${accounts.length} akun ditemukan\n`);

  const mode = (await prompt('Mode (1 = satu akun, 2 = semua): ')).trim();

  let targets;
  if (mode === '1') {
    const pick = (await prompt(`Pilih akun (1-${accounts.length}): `)).trim();
    const i = parseInt(pick) - 1;
    if (isNaN(i) || i < 0 || i >= accounts.length) {
      console.log('Nomor tidak valid'); return;
    }
    targets = [{ ...accounts[i], idx: i }];
  } else {
    targets = accounts.map((a, i) => ({ ...a, idx: i }));
  }

  for (let i = 0; i < targets.length; i++) {
    const acct = targets[i];
    try {
      await processAccount(acct, acct.idx);
    } catch (e) {
      console.error(`[Akun ${acct.idx + 1}] ✗ ${e.message}`);
    }
    if (i < targets.length - 1) await rDelay(3000, 7000);
  }

  console.log('\nSelesai.');
}

main().catch(console.error);
