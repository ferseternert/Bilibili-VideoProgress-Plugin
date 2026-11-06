/* 观看记录、本地存储和续播规则。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BiliProgressCore = api;
})(globalThis, function () {
  'use strict';

  const PREFIX = 'bili-progress-memory:v1:';
  const finite = (value) => Number.isFinite(Number(value));
  const clip = (text, max = 240) => String(text || '').slice(0, max);
  function clean(value) {
    if (!value || typeof value !== 'object') return null;
    if (
      !/^BV[0-9A-Za-z]{10}$/.test(value.bvid || '') ||
      !/^\d{1,20}$/.test(String(value.cid || ''))
    )
      return null;
    if (!finite(value.time) || Number(value.time) < 0 || Number(value.time) > 604800) return null;
    if (!finite(value.duration) || Number(value.duration) <= 0 || Number(value.duration) > 604800)
      return null;
    if (!finite(value.updatedAt) || Number(value.updatedAt) <= 0) return null;
    return {
      bvid: value.bvid,
      cid: String(value.cid),
      aid: Number(value.aid) || 0,
      page: Math.max(1, Math.min(10000, Math.floor(Number(value.page) || 1))),
      group: /^(season:\d+|list:-?\d+:\d+)$/.test(value.group || '')
        ? value.group
        : 'video:' + value.bvid,
      groups: Array.isArray(value.groups)
        ? value.groups
            .filter((g) => /^(season:\d+|list:-?\d+:\d+|video:BV[0-9A-Za-z]{10})$/.test(g))
            .slice(0, 30)
        : [],
      title: clip(value.title),
      part: clip(value.part),
      time: Math.min(Number(value.time), Number(value.duration)),
      duration: Number(value.duration),
      updatedAt: Number(value.updatedAt),
      ended: value.ended === true,
      offline: value.offline === true,
      bizId: /^\d{1,20}$/.test(String(value.bizId || '')) ? String(value.bizId) : '',
      rate: finite(value.rate) ? Math.max(0.25, Math.min(4, Number(value.rate))) : 1,
    };
  }
  const identity = (rec) => rec.bvid + ':' + rec.cid;
  const finished = (rec) =>
    rec.ended || rec.time >= rec.duration - Math.min(5, rec.duration * 0.015);
  function formatTime(seconds) {
    seconds = Math.floor(Math.max(0, Number(seconds) || 0));
    const hours = Math.floor(seconds / 3600),
      minutes = Math.floor((seconds % 3600) / 60),
      secs = seconds % 60;
    return (
      (hours ? hours + ':' + String(minutes).padStart(2, '0') : String(minutes)) +
      ':' +
      String(secs).padStart(2, '0')
    );
  }
  class Repository {
    constructor(storage, onError = () => {}) {
      this.storage = storage;
      this.onError = onError;
    }
    read(key) {
      try {
        return JSON.parse(this.storage.getItem(PREFIX + key));
      } catch (_) {
        return null;
      }
    }
    list() {
      const all = [];
      try {
        for (let i = 0; i < this.storage.length; i++) {
          const key = this.storage.key(i);
          if (!key || !key.startsWith(PREFIX + 'record:')) continue;
          const rec = clean(this.read(key.slice(PREFIX.length)));
          if (rec) all.push(rec);
        }
      } catch (err) {
        this.onError(err);
      }
      return all.sort((first, second) => second.updatedAt - first.updatedAt);
    }
    latest(group) {
      return this.list().find((rec) => rec.group === group || rec.groups.includes(group)) || null;
    }
    get(rec) {
      return clean(this.read('record:' + identity(rec)));
    }
    put(value) {
      const rec = clean(value);
      if (!rec) return false;
      try {
        const previous = this.get(rec);
        if (previous && previous.updatedAt > rec.updatedAt) return false;
        rec.groups = [
          ...new Set(
            [
              ...(previous?.groups || []),
              previous?.group,
              ...rec.groups,
              rec.group,
              'video:' + rec.bvid,
            ].filter(Boolean),
          ),
        ].slice(-30);
        this.storage.setItem(PREFIX + 'record:' + identity(rec), JSON.stringify(rec));
        return true;
      } catch (err) {
        this.onError(err);
        return false;
      }
    }
    settings() {
      return {
        auto: true,
        ...this.read('settings'),
      };
    }
    setSettings(settings) {
      try {
        this.storage.setItem(
          PREFIX + 'settings',
          JSON.stringify({
            auto: settings.auto !== false,
          }),
        );
        return true;
      } catch (err) {
        this.onError(err);
        return false;
      }
    }
    prune() {
      try {
        this.list()
          .slice(2000)
          .forEach((rec) => this.storage.removeItem(PREFIX + 'record:' + identity(rec)));
      } catch (err) {
        this.onError(err);
      }
    }
    export() {
      return JSON.stringify(
        {
          app: 'BiliProgressMemory',
          schema: 1,
          records: this.list(),
        },
        null,
        2,
      );
    }
    import(text) {
      if (text.length > 5 * 1024 * 1024) throw new Error('备份文件超过 5 MB');
      const data = JSON.parse(text);
      if (
        data.app !== 'BiliProgressMemory' ||
        data.schema !== 1 ||
        !Array.isArray(data.records) ||
        data.records.length > 2000
      )
        throw new Error('备份格式不正确');
      const records = data.records.map(clean);
      if (records.some((rec) => !rec)) throw new Error('备份含有无效记录，未导入');
      let count = 0;
      for (const rec of records) {
        const old = this.get(rec);
        if ((!old || old.updatedAt < rec.updatedAt) && this.put(rec)) count++;
      }
      return count;
    }
  }
  // 直接选择分 P 时只提示，是否跳转由用户决定。
  function decide(repository, current, intent = 'open', isCollection = false) {
    const members = new Set((current.parts || []).map(identity));
    const record =
      repository
        .list()
        .find(
          (rec) =>
            rec.group === current.group ||
            rec.groups.includes(current.group) ||
            members.has(identity(rec)),
        ) || repository.get(current);
    if (!record || record.time < 1 || intent === 'next')
      return {
        action: 'none',
        record: null,
      };
    if (intent === 'direct' || !repository.settings().auto)
      return {
        action: 'prompt',
        record,
      };
    if (finished(record))
      return {
        action: 'prompt',
        record,
      };
    if (identity(record) === identity(current) && Math.abs(record.time - current.time) < 2)
      return {
        action: 'already',
        record,
      };
    return {
      action: 'restore',
      record,
    };
  }
  function classifyOpen(params = {}, click = '') {
    if (click === 'all') return 'all';
    if (click === 'direct' || params.cid || params.localCid || params.p || params.page)
      return 'direct';
    if (params.mediaList?.bizId && !params.bvid && !params.aid) return 'all';
    return 'open';
  }
  function restartTargets(current) {
    const parts = current.parts || [],
      collection = parts[0] || null;
    if (!collection)
      return {
        collection: null,
        series: null,
      };
    const videoParts = parts.filter((p) => p.bvid === current.bvid);
    // 合集中的多 P 视频作为当前系列。
    if (new Set(parts.map((p) => p.bvid)).size > 1 && videoParts.length > 1) {
      const first = videoParts.reduce((first, second) =>
        (second.page || 1) < (first.page || 1) ? second : first,
      );
      return {
        collection,
        series: first,
        seriesTitle: first.title || current.title,
      };
    }
    const selected = parts.find((p) => identity(p) === identity(current));
    if (selected?.sectionId && new Set(parts.map((p) => p.sectionId).filter(Boolean)).size > 1) {
      return {
        collection,
        series: parts.find((p) => p.sectionId === selected.sectionId),
        seriesTitle: selected.sectionTitle || '当前系列',
      };
    }
    return {
      collection,
      series: null,
    };
  }
  return {
    PREFIX,
    clean,
    identity,
    finished,
    formatTime,
    Repository,
    decide,
    classifyOpen,
    restartTargets,
  };
});
