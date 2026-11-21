import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

const common = {
  manifest_version: 3,
  name: 'Micropub',
  version: '0.1.0',
  description: 'Publish to your own site with Micropub.',
  permissions: ['storage', 'identity', 'activeTab', 'scripting', 'contextMenus'],
  optional_host_permissions: ['https://*/*'],
  action: { default_title: 'Micropub', default_popup: 'src/popup.html' },
};

for (const target of ['firefox', 'chromium']) {
  const dir = `dist/${target}`;
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await cp('src', `${dir}/src`, { recursive: true });
  const manifest = { ...common };
  if (target === 'firefox') {
    manifest.browser_specific_settings = { gecko: { id: 'micropub@ek-micropub.local', strict_min_version: '109.0' } };
    manifest.background = { scripts: ['src/auth.js', 'src/capture.js', 'src/background.js'] };
  } else {
    manifest.background = { service_worker: 'src/background.js' };
  }
  await writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Built ${dir}`);
}
