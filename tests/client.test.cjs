const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../src/core.js');

const bvid = 'BV1TEST00001';
const parts = [
  { bvid, cid: 11, page: 1, part: '开篇', title: '示例系列', duration: 300 },
  { bvid, cid: 12, page: 2, part: '第二节', title: '示例系列', duration: 400 },
];

function setup(inline = false) {
  const calls = [];
  const player = {
    getManifest: () => ({ cid: 12 }),
    getCurrentTime: () => 83,
    getDuration: () => 400,
    mediaElement: () => ({ readyState: 2 }),
    isPaused: () => true,
    seek() {},
    toast: {},
  };
  const ugc = {
    bvid,
    aid: 10,
    pages: parts,
    cid: 12,
    page: 2,
    allEpisodes: parts.map((part) => ({ ...part, pages: parts, section_id: 5 })),
    videoData: {
      View: { title: '示例系列', ugc_season: { id: 42, sections: [{ id: 5, title: '基础篇' }] } },
    },
    ugcReload: (opts) => calls.push(opts),
  };
  const season = {
    pageInited: true,
    activeItem: parts[1],
    allVideoList: parts,
    videoEpisodes: ugc.allEpisodes,
    videoPages: parts,
    isUgcSeason: true,
    videoSeason: { id: 42, sections: [{ id: 5, title: '基础篇' }] },
  };
  const stores = new Map([
    ['usePlayerStore', { isVisible: true, cid: 12 }],
    ['useUgcStore', ugc],
    ['UgcSeasonStore', season],
  ]);
  const props = {
    $pinia: { _s: stores },
    $router: { currentRoute: { value: { name: inline ? 'UgcSeason' : '' } } },
  };
  const window = { BiliProgressCore: core, biliPlayer: player, ugcSeasonPlayers: { 12: player } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/client.js'), 'utf8'), {
    window,
    location: { pathname: inline ? '/index.html' : '/player.html' },
    document: { querySelector: () => ({ __vue_app__: { config: { globalProperties: props } } }) },
  });
  return { client: window.BiliProgressClient, calls, player, stores };
}

test('读取独立播放器时保留官方分P顺序，不重复展开 pages', async () => {
  const { client, calls } = setup();
  const ctx = client.readPlayer();
  assert.equal(ctx.cid, '12');
  assert.equal(ctx.time, 83);
  assert.equal(ctx.parts.length, 2);
  assert.equal(ctx.parts[1].sectionTitle, '基础篇');
  await client.navigate({ ...ctx, cid: '11', page: 1, time: 0 }, ctx);
  assert.equal(calls[0].page, 1);
  assert.equal(calls[0].bvid, bvid);
});

test('内嵌合集读取当前分P和系列标题', () => {
  const { client } = setup(true);
  const ctx = client.readPlayer();
  assert.equal(ctx.mode, 'inline');
  assert.equal(ctx.cid, '12');
  assert.equal(ctx.part, '第二节');
  assert.equal(ctx.page, 2);
  assert.equal(ctx.group, 'season:42');
});

test('切换期间播放器 CID 与目录不一致时，暂不保存采样', () => {
  const { client, player } = setup();
  player.getManifest = () => ({ cid: 99 });
  assert.equal(client.readPlayer(), null);
});
