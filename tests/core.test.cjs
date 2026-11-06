const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');
class Memory {
  constructor() {
    this.map = new Map();
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] || null;
  }
  getItem(key) {
    return this.map.get(key) || null;
  }
  setItem(key, v) {
    this.map.set(key, v);
  }
  removeItem(key) {
    this.map.delete(key);
  }
}
const rec = (overrides = {}) => ({
  bvid: 'BV1TEST00001',
  aid: 10001,
  cid: '20002',
  page: 2,
  part: '第二节',
  title: '示例系列',
  group: 'video:BV1TEST00001',
  time: 83,
  duration: 470,
  updatedAt: 1000,
  ...overrides,
});
test('play all resumes a different part; a direct click only offers the saved title/time', () => {
  const repo = new core.Repository(new Memory());
  repo.put(rec());
  const current = rec({
    cid: '20001',
    page: 1,
    time: 0,
  });
  assert.equal(core.decide(repo, current, 'all', true).action, 'restore');
  const direct = core.decide(repo, current, 'direct', true);
  assert.equal(direct.action, 'prompt');
  assert.equal(direct.record.part, rec().part);
  assert.equal(direct.record.time, 83);
  assert.equal(
    core.decide(
      repo,
      rec({
        time: 0,
      }),
      'direct',
      true,
    ).action,
    'prompt',
  );
});
test('the official list-only open and the explicit downloaded part are distinguished', () => {
  assert.equal(
    core.classifyOpen({
      mediaList: {
        bizType: 8,
        bizId: '42',
      },
    }),
    'all',
  );
  assert.equal(
    core.classifyOpen({
      bvid: rec().bvid,
      cid: '20002',
      localCid: '20002',
      mediaList: {
        bizType: -1,
        bizId: '20001',
      },
    }),
    'direct',
  );
  assert.equal(
    core.classifyOpen(
      {
        bvid: rec().bvid,
      },
      'all',
    ),
    'all',
  );
  assert.equal(
    core.classifyOpen({
      bvid: rec().bvid,
    }),
    'open',
  );
});
test('autoplay-next never jumps backwards; finished history offers manual navigation', () => {
  const repo = new core.Repository(new Memory());
  repo.put(
    rec({
      ended: true,
    }),
  );
  assert.equal(
    core.decide(
      repo,
      rec({
        time: 0,
      }),
      'all',
      true,
    ).action,
    'prompt',
  );
  assert.equal(
    core.decide(
      repo,
      rec({
        time: 0,
      }),
      'next',
      true,
    ).action,
    'none',
  );
});
test('records remain available for both a video and its collection across windows', () => {
  const memory = new Memory(),
    first = new core.Repository(memory),
    second = new core.Repository(memory);
  first.put(
    rec({
      group: 'season:42',
    }),
  );
  second.put(
    rec({
      time: 100,
      updatedAt: 2000,
    }),
  );
  assert.equal(first.latest('season:42').time, 100);
  assert.equal(first.latest('video:' + rec().bvid).time, 100);
  assert.equal(
    first.put(
      rec({
        time: 1,
        updatedAt: 500,
      }),
    ),
    false,
  );
  assert.equal(second.get(rec()).time, 100);
});
test('corruption, storage failure, and an invalid import do not erase good records', () => {
  const memory = new Memory(),
    repo = new core.Repository(memory);
  repo.put(rec());
  memory.setItem(core.PREFIX + 'record:broken', '{');
  assert.equal(repo.list().length, 1);
  const before = repo.export();
  assert.throws(() =>
    repo.import(
      JSON.stringify({
        app: 'BiliProgressMemory',
        schema: 1,
        records: [
          rec({
            time: 999,
          }),
          rec({
            cid: 'bad',
          }),
        ],
      }),
    ),
  );
  assert.equal(repo.export(), before);
  let error = false;
  const bad = new core.Repository(
    {
      getItem() {
        return null;
      },
      setItem() {
        throw Error('quota');
      },
    },
    () => (error = true),
  );
  assert.equal(bad.put(rec()), false);
  assert.equal(error, true);
});
test('import only replaces older data and keeps titles as text', () => {
  const repo = new core.Repository(new Memory());
  repo.put(
    rec({
      updatedAt: 2000,
    }),
  );
  assert.equal(
    repo.import(
      JSON.stringify({
        app: 'BiliProgressMemory',
        schema: 1,
        records: [rec()],
      }),
    ),
    0,
  );
  assert.equal(
    core.clean(
      rec({
        part: '<script>alert(1)</script>',
      }),
    ).part,
    '<script>alert(1)</script>',
  );
  assert.equal(
    core.clean(
      rec({
        bvid: 'https://bad.example',
        cid: '1',
      }),
    ),
    null,
  );
});
test('restart prefers the current multi-P series and retains a separate whole-collection target', () => {
  const first = {
      ...rec(),
      bvid: 'BV1TEST00002',
      cid: '10',
      page: 1,
      title: '另一系列',
    },
    seriesFirst = rec({
      cid: '20',
      page: 1,
    }),
    current = rec({
      cid: '21',
      page: 2,
    });
  const targets = core.restartTargets({
    ...current,
    parts: [first, seriesFirst, current],
  });
  assert.equal(targets.series.cid, '20');
  assert.equal(targets.collection.cid, '10');
});
test('named sections are used when the collection contains single-P videos', () => {
  const first = rec({
      bvid: 'BV1TEST00002',
      cid: '10',
      sectionId: 'a',
    }),
    second = rec({
      cid: '20',
      sectionId: 'b',
      sectionTitle: '第二系列',
    });
  const targets = core.restartTargets({
    ...second,
    parts: [first, second],
  });
  assert.equal(targets.series.cid, '20');
  assert.equal(targets.seriesTitle, '第二系列');
  assert.equal(targets.collection.cid, '10');
});
test('a plain multi-P video does not invent an extra series level', () => {
  const first = rec({
      cid: '10',
      page: 1,
    }),
    second = rec({
      cid: '20',
      page: 2,
    });
  const targets = core.restartTargets({
    ...second,
    parts: [first, second],
  });
  assert.equal(targets.series, null);
  assert.equal(targets.collection.cid, '10');
});
