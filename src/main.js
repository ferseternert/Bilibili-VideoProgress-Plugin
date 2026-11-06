/* 客户端打开页面后，依次加载插件模块。 */
'use strict';
const { app, webContents } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const files = ['bpm-core.js', 'bpm-client.js', 'bpm-extension.js'];
const source = files.map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
const attached = new WeakSet();
const pages = new Set(['/index.html', '/player.html', '/search.html']);

function attach(contents) {
  if (attached.has(contents)) return;
  attached.add(contents);

  const inject = () => {
    if (contents.isDestroyed()) return;
    let url;
    try {
      url = new URL(contents.getURL());
    } catch {
      return;
    }
    if (url.hostname !== 'bilipc.bilibili.com' || !pages.has(url.pathname)) return;
    contents.executeJavaScript(source, false).catch(() => {});
  };

  contents.on('dom-ready', inject);
  contents.on('did-finish-load', inject);
  if (contents.getURL()) inject();
}

app.on('web-contents-created', (_, contents) => attach(contents));
app.whenReady().then(() => webContents.getAllWebContents().forEach(attach));
