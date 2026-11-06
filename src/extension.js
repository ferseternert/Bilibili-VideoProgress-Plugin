/* 播放入口、进度保存和续播。 */
(function () {
  'use strict';

  if (window.__biliProgressMemory || !window.BiliProgressCore) return;
  const core = window.BiliProgressCore,
    isPlayerWin = /\/player\.html$/.test(location.pathname);
  const state = {
    entry: {
      mode: 'open',
      at: Date.now(),
    },
    current: null,
    sample: null,
    pending: null,
    ready: '',
    readyAt: 0,
    savedAt: 0,
    internal: 0,
    toasts: [],
    hooked: new WeakSet(),
    players: new WeakSet(),
    click: null,
    holdUntil: 0,
    error: '',
    intentId: '',
    sequence: 0,
    disabled: false,
    router: null,
  };
  const client = window.BiliProgressClient;
  const { appProps, getStore, readPlayer } = client;
  const repo = new core.Repository(localStorage, () => {
    state.error = '本地存储写入失败';
  });
  const same = (a, b) => a && b && core.identity(a) === core.identity(b);
  const now = () => Date.now();
  const recentClick = () => (state.click && now() - state.click.at < 2000 ? state.click.mode : '');
  const entryKey = core.PREFIX + 'entry';
  function readIntent(params) {
    try {
      const value = JSON.parse(localStorage.getItem(entryKey));
      if (value && value.id !== state.intentId && now() - value.at < 8000) {
        state.intentId = value.id;
        return value.mode;
      }
    } catch (_) {}
    return core.classifyOpen(params || {}, recentClick());
  }
  function clearToasts() {
    for (const { player, id } of state.toasts)
      try {
        player.toast.remove(id);
      } catch (_) {}
    state.toasts = [];
  }
  function showToast(ctx, text, actions = [], duration = 10000) {
    clearToasts();
    const player = ctx?.player;
    if (!player?.toast?.create) return;
    if (!document.getElementById('bpm-toast-style')) {
      const style = document.createElement('style');
      style.id = 'bpm-toast-style';
      style.textContent = `
        .bpx-player-custom-toast-bpm .bpm-actions {
          display: inline-flex; gap: 14px; align-items: center;
        }
        .bpx-player-custom-toast-bpm .bpm-action {
          appearance: none; border: 0; padding: 0; background: none;
          color: #fb7299; font: inherit; cursor: pointer; white-space: nowrap;
        }
        .bpx-player-custom-toast-bpm .bpm-action.secondary { color: #b8b8b8; }
        .bpx-player-custom-toast-bpm .bpm-action:hover,
        .bpx-player-custom-toast-bpm .bpm-action:focus-visible { color: #fff; }
        .bpx-player-custom-toast-bpm .bpm-action:focus-visible { outline: 1px solid currentColor; }
      `;
      document.head.appendChild(style);
    }
    const actionsElement = document.createElement('span');
    actionsElement.className = 'bpm-actions';
    for (const [label, action, secondary = false] of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bpm-action' + (secondary ? ' secondary' : '');
      button.textContent = label;
      button.setAttribute('role', 'button');
      button.tabIndex = 0;
      const run = (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearToasts();
        action();
      };
      button.onclick = run;
      button.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') run(event);
      };
      actionsElement.appendChild(button);
    }
    const id = player.toast.create({
      text,
      duration,
      manualMode: true,
      customClassName: 'bpm',
      confirmText: actions.length ? actionsElement : undefined,
      onConfirmClicked: () => {},
    });
    const waiting = (player.mediaElement?.()?.readyState || 0) < 2;
    if (waiting) player.toast.suspendClock?.(id);
    state.toasts.push({
      player,
      id,
      waiting,
    });
  }
  function formatRecord(rec) {
    return `P${rec.page} ${rec.part || rec.title || '上次观看'} · ${core.formatTime(rec.time)}`;
  }
  function flush(force = false) {
    if (
      state.pending ||
      now() < state.holdUntil ||
      !state.sample ||
      (!force && now() - state.savedAt < 4000)
    )
      return;
    const stamp = core.identity(state.sample) + ':' + state.sample.updatedAt;
    if (state.written === stamp) return;
    if (repo.put(state.sample)) {
      state.savedAt = now();
      state.written = stamp;
    }
  }
  function onEntry(mode, params = {}) {
    if (state.internal || state.disabled) return;
    flush(true);
    clearToasts();
    state.sequence++;
    state.entry = {
      mode,
      at: now(),
      params: params,
    };
    state.current = null;
    state.sample = null;
    state.pending = null;
    state.ready = '';
    state.replaceResume = false;
  }
  function hookActions() {
    const router = appProps()?.$router;
    if (!isPlayerWin && router && state.router !== router) {
      state.router = router;
      router.afterEach((to, from) => {
        if (state.disabled) return;
        if (to.name === 'UgcSeason' && to.fullPath !== from.fullPath)
          onEntry(recentClick() || core.classifyOpen(to.query), to.query);
        else if (to.name !== 'UgcSeason') {
          flush(true);
          clearToasts();
          state.current = null;
          state.sample = null;
          state.entry = {
            mode: 'open',
            at: now(),
          };
        }
      });
      if (router.currentRoute.value.name === 'UgcSeason')
        onEntry(core.classifyOpen(router.currentRoute.value.query));
    }
    for (const name of ['usePlayerActionStore', 'useUgcStore', 'useMediaListStore']) {
      const item = getStore(name);
      if (!item || state.hooked.has(item)) continue;
      state.hooked.add(item);
      item.$onAction(({ name: action, args }) => {
        if (state.internal || state.disabled) return;
        if (name === 'usePlayerActionStore' && action === 'queryChange') {
          const mode = readIntent(args[0]);
          onEntry(mode, args[0]);
          if (mode === 'direct' && !(Number(args[0].t) > 0)) args[0].t = 0.001;
        } else if (!state.entry && state.current) {
          if (action === 'ugcChange') onEntry(args[0]?.auto ? 'next' : recentClick() || 'direct');
          else if (action === 'ugcReload') {
            onEntry(recentClick() || 'direct');
            if (!(Number(args[0]?.time) > 0) && args[0]) args[0].time = 0.001;
          } else if (action === 'changeMediaPage') onEntry(recentClick() || 'next');
        }
        if (
          name === 'useUgcStore' &&
          action === 'ugcInit' &&
          state.entry?.mode === 'direct' &&
          args[0] &&
          !(Number(args[0].time) > 0)
        )
          args[0].time = 0.001;
      }, true);
    }
  }
  function playerOpts(opts = {}) {
    if (state.disabled) return opts;
    const route = appProps()?.$router?.currentRoute?.value;
    if (route?.name === 'UgcSeason' && opts.featureList?.has('noToast')) {
      opts = {
        ...opts,
        featureList: new Set([...opts.featureList].filter((item) => item !== 'noToast')),
      };
    }
    if (
      (isPlayerWin || route?.name === 'UgcSeason') &&
      state.entry?.mode === 'direct' &&
      !(Number(opts.t) > 0)
    )
      opts = {
        ...opts,
        t: 0.001,
      };
    return opts;
  }
  function wrapPlayer(player) {
    if (!player || state.players.has(player)) return player;
    state.players.add(player);
    if (player.reload) {
      const orig = player.reload;
      player.reload = function (opts, ...rest) {
        return orig.call(this, playerOpts(opts), ...rest);
      };
    }
    if (player.toast?.create) {
      const orig = player.toast.create;
      player.toast.create = function (opts, ...rest) {
        // 续播提示由插件接管，播放器的其他提示照常显示。
        if (
          !state.disabled &&
          opts?.customClassName !== 'bpm' &&
          typeof opts?.text === 'string' &&
          /^(上次看到|已为您定位至)/.test(opts.text) &&
          (state.pending || state.replaceResume)
        )
          return '';
        return orig.call(this, opts, ...rest);
      };
    }
    if (player.on)
      for (const event of [
        'Player_LoadedMetadata',
        'Player_CanPlay',
        'Player_Seeked',
        'Player_TimeUpdate',
        'Player_Pause',
        'Player_Ended',
      ]) {
        player.on(event, () => {
          if (!state.disabled) queueMicrotask(tick);
        });
      }
    return player;
  }
  function wrapNano(nano) {
    if (!nano?.createPlayer || nano.createPlayer.__bpm) return nano;
    const orig = nano.createPlayer;
    const create = function (opts, ...rest) {
      return wrapPlayer(orig.call(this, playerOpts(opts), ...rest));
    };
    create.__bpm = true;
    try {
      nano.createPlayer = create;
    } catch (_) {}
    return nano;
  }
  // 页面刚打开时，先从 URL 读取这次选择。
  try {
    const bridge = window.biliBridgePc;
    if (bridge?.addListener) {
      // queryChange 可能早于插件加载，URL 中仍保留了分 P 信息。
      const query = Object.fromEntries(new URLSearchParams(location.search));
      if (isPlayerWin && (query.bvid || query.cid || query.p))
        state.entry = {
          mode: readIntent(query),
          at: now(),
          params: query,
        };
    }
  } catch (_) {}
  try {
    let nanoRef = window.nano;
    const desc = Object.getOwnPropertyDescriptor(window, 'nano');
    if (!desc || desc.configurable)
      Object.defineProperty(window, 'nano', {
        configurable: true,
        enumerable: true,
        get: () => nanoRef,
        set: (value) => {
          nanoRef = wrapNano(value);
        },
      });
    wrapNano(nanoRef);
  } catch (_) {}
  function findTarget(ctx, record) {
    const live = ctx.parts.find((item) => item.cid === record.cid && item.bvid === record.bvid);
    return live
      ? {
          ...record,
          ...live,
          time: Math.min(record.time, record.duration),
          group: ctx.group,
          offline: ctx.offline,
          bizId: ctx.bizId,
        }
      : null;
  }
  function atStart(ctx, part) {
    return part
      ? {
          ...ctx,
          ...part,
          time: 0,
          ended: false,
        }
      : null;
  }
  async function runNavigation(target, from) {
    state.internal++;
    try {
      await client.navigate(target, from);
    } finally {
      state.internal--;
    }
  }
  function startRestore(target, origin, kind = 'resume') {
    clearToasts();
    state.sequence++;
    const seq = state.sequence;
    state.pending = {
      target: {
        ...target,
      },
      origin: {
        ...origin,
      },
      kind,
      seq,
      at: now(),
      attempts: 0,
      last: 0,
      navigating: true,
    };
    state.sample = null;
    state.entry = null;
    state.ready = '';
    runNavigation(target, origin)
      .then(() => {
        if (state.pending?.seq === seq) state.pending.navigating = false;
      })
      .catch(() => fail(seq));
  }
  function fail(seq) {
    if (state.pending?.seq !== seq) return;
    state.failure = {
      kind: state.pending.kind,
      attempts: state.pending.attempts,
      elapsed: now() - state.pending.at,
      phase: state.pending.navigating ? 'navigate' : 'seek',
      target: state.pending.target.cid,
    };
    const origin = state.pending.origin;
    state.pending = null;
    state.entry = null;
    state.holdUntil = now() + 5000;
    state.sample = null;
    showToast(readPlayer() || origin, '暂未能恢复，原有进度已保留', [], 6000);
  }
  function showResume(ctx, origin) {
    const seq = state.sequence;
    const starts = core.restartTargets(ctx);
    const withCurrent = (action) => () => {
      const ctxNow = readPlayer();
      if (seq === state.sequence && same(ctxNow, ctx)) action(ctxNow);
    };
    const actions = [];
    if (origin)
      actions.push(['撤回', withCurrent((ctxNow) => startRestore(origin, ctxNow, 'undo'))]);
    if (starts.series)
      actions.push([
        '从系列开头播放',
        withCurrent((ctxNow) => startRestore(atStart(ctxNow, starts.series), ctxNow, 'series')),
      ]);
    else if (starts.collection)
      actions.push([
        ctx.collection ? '从合集开头播放' : '从头播放',
        withCurrent((ctxNow) => startRestore(atStart(ctxNow, starts.collection), ctxNow, 'start')),
      ]);
    showToast(ctx, '已为你续播 ' + formatRecord(ctx), actions, 12000);
  }
  function showPrompt(ctx, record) {
    const target = findTarget(ctx, record) || (same(ctx, record) ? record : null);
    if (!target) return;
    const seq = state.sequence;
    showToast(
      ctx,
      '上次看到 ' + formatRecord(record),
      [
        [
          '跳转播放',
          () => {
            const ctxNow = readPlayer();
            if (seq === state.sequence && same(ctxNow, ctx)) startRestore(target, ctxNow, 'resume');
          },
        ],
      ],
      12000,
    );
  }
  function checkRestore(ctx) {
    const rec = state.pending;
    if (!rec) return;
    if (now() - rec.at > 45000) {
      fail(rec.seq);
      return;
    }
    if (!ctx || !same(ctx, rec.target) || rec.navigating || now() - state.readyAt < 700) return;
    const time = Math.min(rec.target.time, Math.max(0, ctx.duration - 0.1));
    if (Math.abs(ctx.time - time) < 2 && (!rec.attempts || now() - rec.last > 450)) {
      state.pending = null;
      state.current = ctx;
      state.sample = null;
      state.holdUntil = now() + 1200;
      state.entry = null;
      if (rec.kind === 'undo' && rec.origin.paused) ctx.player.pause?.();
      if (rec.kind === 'resume') showResume(ctx, rec.origin);
      else if (rec.kind === 'series') {
        const starts = core.restartTargets(ctx),
          seq = state.sequence;
        showToast(
          ctx,
          '已从系列开头播放：' + (starts.seriesTitle || ctx.title),
          starts.collection && (!starts.series || !same(starts.series, starts.collection))
            ? [
                [
                  '从整个合集开头播放',
                  () => {
                    const ctxNow = readPlayer();
                    if (seq === state.sequence && same(ctxNow, ctx))
                      startRestore(atStart(ctxNow, starts.collection), ctxNow, 'start');
                  },
                ],
              ]
            : [],
          10000,
        );
      } else
        showToast(
          ctx,
          rec.kind === 'undo'
            ? '已撤回，本次不再自动跳转'
            : ctx.collection
              ? '已从合集开头播放'
              : '已从头播放',
          [],
          5000,
        );
      return;
    }
    if (now() - rec.last < 1200) return;
    if (rec.attempts >= 3) {
      fail(rec.seq);
      return;
    }
    rec.attempts++;
    rec.last = now();
    try {
      Promise.resolve(ctx.player.seek(time)).catch(() => {});
      if (rec.kind === 'undo' && rec.origin.paused) ctx.player.pause?.();
      else if (['start', 'series', 'resume'].includes(rec.kind))
        ctx.player.play?.().catch?.(() => {});
    } catch (_) {}
  }
  function tick() {
    if (state.disabled) return;
    try {
      hookActions();
      wrapNano(window.nano);
      wrapPlayer(window.biliPlayer);
      const ctx = readPlayer();
      for (const toast of state.toasts)
        if (toast.waiting && (toast.player.mediaElement?.()?.readyState || 0) >= 2) {
          toast.waiting = false;
          toast.player.toast.resumeClock?.(toast.id);
        }
      if (!ctx) {
        if (state.pending) checkRestore(null);
        else flush(true);
        state.ready = '';
        return;
      }
      const key = core.identity(ctx);
      if (key !== state.ready) {
        state.ready = key;
        state.readyAt = now();
      }
      if (state.pending) {
        checkRestore(ctx);
        return;
      }
      if (now() - state.readyAt < 700) return;
      if (state.entry || !same(ctx, state.current)) {
        if (!state.entry) {
          flush(true);
          state.sequence++;
          clearToasts();
        }
        const mode = state.entry?.mode || (recentClick() === 'direct' ? 'direct' : 'next');
        state.entry = null;
        state.current = ctx;
        state.sample = null;
        const plan = core.decide(repo, ctx, mode, ctx.collection);
        state.replaceResume = !!plan.record;
        if (plan.record) {
          const target =
            findTarget(ctx, plan.record) || (same(ctx, plan.record) ? plan.record : null);
          if (plan.action === 'restore' && target) {
            startRestore(target, ctx);
            return;
          }
          if (plan.action === 'already') showResume(ctx, ctx);
          else if (plan.action === 'prompt') showPrompt(ctx, plan.record);
        }
        // 给续播留出时间，避免刚打开时的 0 秒覆盖旧记录。
        state.holdUntil = now() + 2500;
      }
      if (now() < state.holdUntil || ctx.player.isSeeking?.()) return;
      if (ctx.time > 0.5 || ctx.ended) {
        const prior = state.sample;
        if (
          !prior ||
          !same(prior, ctx) ||
          Math.abs(prior.time - ctx.time) > 0.25 ||
          prior.ended !== ctx.ended
        ) {
          state.sample = ctx;
          flush(ctx.paused || ctx.ended);
        }
      }
    } catch (err) {
      state.error = err.message;
    }
  }
  function onPointer(event) {
    if (state.disabled || !event.isTrusted || event.target.closest?.('[class*="custom-toast-bpm"]'))
      return;
    const path = event.composedPath().filter((item) => item instanceof Element);
    const button = path.find(
      (item) =>
        (item.textContent || '').trim().length < 32 &&
        /播放全部|全部播放/.test(item.textContent || ''),
    );
    const part = path.find((item) =>
      /page-list-item|season-item|episode-item|part-item|playlist-item|video-episode|ugc-episode/.test(
        String(item.className),
      ),
    );
    if (button || part) {
      state.click = {
        mode: button ? 'all' : 'direct',
        at: now(),
      };
      try {
        localStorage.setItem(
          entryKey,
          JSON.stringify({
            id: String(now()) + Math.random(),
            at: now(),
            mode: state.click.mode,
          }),
        );
      } catch (_) {}
      if (part && state.current) onEntry('direct');
    }
    const seek = path.some((item) => /progress|timeline|slider/.test(String(item.className)));
    if (seek && state.pending) {
      state.pending = null;
      state.entry = null;
      state.sample = null;
      state.holdUntil = now() + 1500;
      clearToasts();
    }
  }
  document.addEventListener('pointerdown', onPointer, true);
  document.addEventListener('click', onPointer, true);
  document.addEventListener(
    'keydown',
    (event) => {
      if (!event.isTrusted) return;
      if (state.pending && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        state.pending = null;
        state.entry = null;
        state.sample = null;
        state.holdUntil = now() + 1500;
        clearToasts();
      }
    },
    true,
  );
  window.addEventListener('pagehide', () => flush(true));
  window.addEventListener('beforeunload', () => flush(true));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush(true);
  });
  try {
    window.biliBridgePc?.addListener('events/beforeAppQuit', () => flush(true));
  } catch (_) {}
  if (!isPlayerWin) setTimeout(client.loadBus, 1500);
  const interval = setInterval(tick, 300);
  repo.prune();
  tick();
  window.__biliProgressMemory = {
    version: '0.1.0',
    status: () => ({
      ready: !!state.current,
      pending: !!state.pending,
      error: state.error,
      records: repo.list().length,
      intent: state.entry?.mode,
      failure: state.failure,
    }),
    stop: () => {
      flush(true);
      clearInterval(interval);
      clearToasts();
      state.disabled = true;
    },
    export: () => repo.export(),
    import: (text) => repo.import(text),
  };
})();
