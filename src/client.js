/* 官方客户端的播放器和合集接口。 */
(function () {
  'use strict';
  const core = window.BiliProgressCore;
  const isPlayerWin = /\/player\.html$/.test(location.pathname);
  let bus = null;
  const appProps = () => document.querySelector('#app')?.__vue_app__?.config?.globalProperties;

  const getStore = (name) => appProps()?.$pinia?._s.get(name);

  const groupFor = (bvid, season, type, id) =>
    Number(type) === 8
      ? 'season:' + id
      : season
        ? 'season:' + season
        : [2, 3, 4, 5].includes(Number(type)) && id
          ? `list:${type}:${id}`
          : 'video:' + bvid;

  const mapPart = (item, fallback = {}) => ({
    bvid: item.bvid || fallback.bvid,
    aid: item.aid || item.id || fallback.aid,
    cid: String(item.cid || item.itemId || ''),
    page: Number(item.p || item.page?.page || item.page) || 1,
    part: item.part || item.tabName || item.title || fallback.title || '',
    title: item.groupTitle || fallback.title || item.title || '',
    sectionId: String(item.section_id || item.sectionId || fallback.sectionId || ''),
    sectionTitle: item.sectionTitle || fallback.sectionTitle || '',
    duration: Number(item.duration || item.arc?.duration) || 1,
  });

  function readPlayer() {
    let player,
      info,
      parts = [],
      group,
      mode,
      offline = false,
      bizType,
      bizId = '',
      collection = false;
    if (isPlayerWin) {
      const playerStore = getStore('usePlayerStore'),
        ugc = getStore('useUgcStore'),
        mediaList = getStore('useMediaListStore');
      if (
        !playerStore ||
        !ugc ||
        playerStore.isOgv ||
        playerStore.isPlayLocal ||
        playerStore.dataLoading ||
        playerStore.isInteraction ||
        playerStore.isChargeRequired ||
        !playerStore.isVisible
      )
        return null;
      player = window.biliPlayer;
      mode = 'player';
      offline = !!playerStore.playFromLocalCid;
      bizType = playerStore.bizType;
      bizId = String(playerStore.bizId || '');
      const view = ugc.videoData?.View || {},
        cid = String(playerStore.cid || ugc.cid || '');
      if (bizType && mediaList?.videoList?.length) {
        parts = mediaList.videoList.flatMap((group) =>
          (group.itemList || []).map((item) =>
            mapPart(item, {
              bvid: group.bvid,
              title: group.title,
              aid: group.aid,
            }),
          ),
        );
        info =
          parts.find((item) => item.cid === cid) ||
          mapPart(mediaList.currentVideoInfo || {}, {
            bvid: ugc.bvid,
            aid: ugc.aid,
            title: view.title,
          });
        if (offline) parts = parts.filter((item) => item.bvid === info.bvid);
      } else {
        const episodes = ugc.allEpisodes || [];
        if (episodes.length)
          for (const episode of episodes) {
            // 官方列表已按分 P 展开，pages 只是附带信息，不能再展开一次。
            const partsOfEp = episode.cid ? [episode] : episode.pages?.length ? episode.pages : [];
            for (const item of partsOfEp)
              parts.push(
                mapPart(
                  {
                    ...item,
                    bvid: episode.bvid || item.bvid,
                    aid: episode.aid || item.aid,
                  },
                  {
                    title: episode.title,
                  },
                ),
              );
          }
        if (!parts.length)
          parts = (ugc.pages || []).map((item) =>
            mapPart(item, {
              bvid: ugc.bvid,
              aid: ugc.aid,
              title: view.title,
            }),
          );
        info =
          parts.find((item) => item.cid === cid) ||
          mapPart({
            bvid: ugc.bvid,
            aid: ugc.aid,
            cid,
            page: ugc.page,
            title: view.title,
          });
      }
      // 下载列表有时没有 P 序号，按同一 BV 内的顺序补上。
      if (offline)
        parts.forEach((item, index) => {
          item.page = index + 1;
        });
      info = {
        ...info,
        cid,
      };
      group = groupFor(info.bvid, offline ? null : view.ugc_season?.id, bizType, bizId);
      const sections = view.ugc_season?.sections || [];
      for (const part of parts)
        part.sectionTitle =
          sections.find((item) => String(item.id) === part.sectionId)?.title || '';
      collection = parts.length > 1 || group.startsWith('season:') || group.startsWith('list:');
    } else {
      if (appProps()?.$router?.currentRoute?.value?.name !== 'UgcSeason') return null;
      const season = getStore('UgcSeasonStore');
      if (!season?.pageInited) return null;
      const item = season.activeItem || {};
      player = window.ugcSeasonPlayers?.[item.cid];
      mode = 'inline';
      const counters = {};
      parts = (season.allVideoList || []).map((video) => {
        const episode = season.videoEpisodes?.find((ep) => String(ep.cid) === String(video.cid));
        const rec = mapPart({
          ...episode,
          ...video,
          section_id: episode?.section_id,
        });
        rec.page = counters[rec.bvid] = (counters[rec.bvid] || 0) + 1;
        rec.sectionTitle =
          season.videoSeason?.sections?.find((part) => String(part.id) === rec.sectionId)?.title ||
          '';
        const part = (season.videoPages || []).find((part) => String(part.cid) === rec.cid);
        if (part?.part) rec.part = part.part;
        return rec;
      });
      info = parts.find((part) => part.cid === String(item.cid));
      group = groupFor(item.bvid, season.isUgcSeason ? season.videoSeason?.id : null);
      collection = parts.length > 1;
    }
    if (!info || !player?.getManifest || !player?.seek || !player?.toast) return null;
    const manifest = player.getManifest();
    if (String(manifest?.cid) !== info.cid) return null;
    const media = player.mediaElement?.();
    if (media && media.readyState < 1) return null;
    const record = core.clean({
      ...info,
      group,
      offline,
      bizId,
      time: player.getCurrentTime(),
      duration: player.getDuration(),
      updatedAt: Date.now(),
      ended: player.isEnded?.() === true,
      rate: player.getPlaybackRate?.() || 1,
    });
    return record
      ? {
          ...record,
          player,
          mode,
          parts,
          collection,
          bizType,
          paused: player.isPaused?.() !== false,
        }
      : null;
  }

  async function navigate(target, from) {
    if (core.identity(target) === core.identity(from)) return;

    if (from.mode === 'inline') {
      const season = getStore('UgcSeasonStore');
      const index = (season.allVideoList || []).findIndex(
        (item) => String(item.cid) === target.cid && item.bvid === target.bvid,
      );
      if (index < 0 || !bus) throw Error('合集入口尚未就绪');
      bus.emit('initVideoList', index + 1);
    } else if (from.bizType && getStore('useMediaListStore')?.videoList?.length) {
      const mediaList = getStore('useMediaListStore'),
        group = mediaList.videoList.find((group) =>
          group.itemList?.some((item) => String(item.cid || item.itemId) === target.cid),
        );
      const item = group?.itemList.find((item) => String(item.cid || item.itemId) === target.cid);
      if (item)
        mediaList.changeMediaPage({
          group,
          item,
          bizType: from.bizType,
          time: target.time,
        });
      else if (from.offline) throw Error('该分 P 不在已下载列表中');
      else
        await mediaList.getMediaList({
          type: from.bizType,
          biz_id: from.bizId,
          bvid: target.bvid,
          aid: target.aid,
          itemId: target.cid,
          time: target.time,
        });
    } else {
      getStore('useUgcStore').ugcReload({
        bvid: target.bvid,
        page: target.page,
        time: target.time,
      });
    }
  }

  async function loadBus() {
    const links = [...document.querySelectorAll('link[href],script[src]')].map(
      (el) => el.href || el.src,
    );
    const adapters = [
      ['/assets/track.70fb9ed1.js', 'cs'],
      ['/assets/index.cc8c2a37.js', 'b2'],
    ];
    for (const [file, exportName] of adapters)
      if (links.some((l) => l.endsWith(file))) {
        try {
          const mod = await import(location.origin + file);
          bus = mod[exportName];
        } catch (_) {}
        return;
      }
  }
  window.BiliProgressClient = { appProps, getStore, readPlayer, navigate, loadBus };
})();
