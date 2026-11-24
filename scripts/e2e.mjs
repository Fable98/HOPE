// End-to-end run in a real Chrome: loads the unpacked extension, opens the demo
// site, starts a task and answers every card (first option, sample text, "Yes").
//
//   npm start                 # in another terminal (mock planner is fine)
//   npm run e2e               # CHROME_PATH=... to pick the browser
//
// Screenshots go to e2e-output/. Exits non-zero if the task does not finish.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'e2e-output');
const SERVER = process.env.HOPE_SERVER || 'http://localhost:8787';
const GOAL = process.argv[2] || 'Appointment with a skin doctor';
const CHROME = process.env.CHROME_PATH || {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
}[process.platform] || '/usr/bin/google-chrome';

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  pipe: true,
  enableExtensions: [path.join(ROOT, 'extension')],
  args: ['--no-first-run', '--no-default-browser-check'],
});

let finished = false;
try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('background.js'), { timeout: 15_000 });
  const extId = new URL(swTarget.url()).host;

  const site = await browser.newPage();
  await site.setViewport({ width: 1100, height: 800 });
  await site.goto(`${SERVER}/demo/`, { waitUntil: 'load' });

  // The side panel needs a user gesture to open, so load the same page in a tab.
  const panel = await browser.newPage();
  await panel.setViewport({ width: 400, height: 800 });
  panel.on('pageerror', (e) => console.log('[panel error]', e.message));
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
  await panel.waitForSelector('#goal');

  await panel.evaluate(async (goal, server) => {
    const [tab] = await chrome.tabs.query({ url: `${server}/*` });
    chrome.runtime.connect({ name: 'hope-panel' }).postMessage({ type: 'start', goal, tabId: tab.id });
  }, GOAL, SERVER);

  let lastKey = '';
  for (let step = 0; step < 40; step++) {
    const card = await panel.waitForFunction((prev) => {
      const key = document.getElementById('card')?.dataset.key || '';
      const type = key.split('|')[1];
      if (!key || key === prev || type === 'working') return null;
      return { key, type, text: document.getElementById('card').innerText };
    }, { timeout: 30_000, polling: 200 }, lastKey).then((h) => h.jsonValue());
    lastKey = card.key;
    const progress = await panel.$eval('#progress-text', (e) => e.textContent);
    console.log(`\n[${card.type}] ${progress}\n${card.text.replace('🔊', '').trim()}`);
    await panel.screenshot({ path: path.join(OUT, `${String(step).padStart(2, '0')}-${card.type}.png`) });

    if (card.type === 'choice') await panel.click('#card .stack button.secondary');
    else if (card.type === 'manual') await panel.click('#card button.primary');
    else if (card.type === 'confirm') await panel.click('#card button.confirm-yes');
    else if (card.type === 'input') {
      const kind = await panel.$eval('#card input', (i) => i.type);
      await panel.type('#card input', kind === 'email' ? 'asha@example.com' : kind === 'tel' ? '9876543210' : 'Asha Rao');
      await panel.click('#card button.primary');
    } else {
      finished = card.type === 'done';
      break;
    }
  }
  const log = await panel.$$eval('#log-list li', (lis) => lis.map((l) => l.textContent));
  console.log(`\nWhat I did for you:\n- ${log.join('\n- ')}`);
  await site.screenshot({ path: path.join(OUT, 'site-final.png') });

  // Family help link: make one and open it like the helper would.
  await panel.click('#help-button');
  await panel.type('#help-note', 'Can you check this for me?');
  await panel.click('#help-make');
  await panel.waitForFunction(() => document.getElementById('help-link').value, { timeout: 10_000 });
  const link = await panel.$eval('#help-link', (i) => i.value);
  await panel.screenshot({ path: path.join(OUT, 'help-link.png') });
  const helper = await browser.newPage();
  await helper.goto(link.replace(/^https?:\/\/[^/]+/, SERVER));
  const helperText = await helper.$eval('main', (m) => m.innerText);
  await helper.screenshot({ path: path.join(OUT, 'help-page.png'), fullPage: true });
  const helpOk = helperText.includes(GOAL) && helperText.includes('Can you check this for me?');
  console.log(`\nHelp link ${link}: ${helpOk ? 'shows goal and message' : 'MISSING CONTENT'}`);
  finished = finished && helpOk;
} finally {
  await browser.close();
}

console.log(finished ? '\nE2E: task finished' : '\nE2E: task did not finish');
process.exit(finished ? 0 : 1);
