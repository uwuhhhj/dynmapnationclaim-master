(() => {
  const logger = {
    info: (...args) => console.log('[DataUI]', ...args),
    warn: (...args) => console.warn('[DataUI]', ...args),
    error: (...args) => console.error('[DataUI]', ...args)
  };

  let overlayListController = null;

  function getDeps() {
    const storage = window.DynmapStorage;
    const fetcher = window.DynmapDataFetch;
    const datasets = window.DynmapOverlayDatasets;
    if (!storage) {
      throw new Error('Missing DynmapStorage. Ensure js/data/indexeddb-manager.js is loaded.');
    }
    if (!fetcher?.fetchAndStoreAllData) {
      throw new Error('Missing DynmapDataFetch. Ensure js/data/data-fetch.js is loaded.');
    }
    if (!datasets?.loadOverlayDatasetItems) {
      throw new Error('Missing DynmapOverlayDatasets. Ensure js/data/data-overlay-datasets.js is loaded.');
    }
    return { storage, fetcher, datasets };
  }

  function emitDataUpdated(detail) {
    if (typeof document === 'undefined' || typeof CustomEvent !== 'function') {
      return;
    }

    try {
      document.dispatchEvent(
        new CustomEvent('dynmap:data-updated', {
          detail
        })
      );
    } catch (error) {
      logger.warn('Failed to emit data update event', error);
    }
  }

  function displayStorageStatus(type, message) {
    const statusContainer = document.getElementById('storage-status');
    if (!statusContainer) {
      logger.warn('Status container not found. Message:', message);
      return;
    }

    const statusElement = document.createElement('div');
    statusElement.style.padding = '12px 16px';
    statusElement.style.borderRadius = '6px';
    statusElement.style.marginBottom = '10px';
    statusElement.style.color = '#fff';
    statusElement.style.fontSize = '14px';
    statusElement.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.1)';
    statusElement.textContent = message;

    switch (type) {
      case 'success':
        statusElement.style.backgroundColor = '#4CAF50';
        break;
      case 'warning':
        statusElement.style.backgroundColor = '#FFC107';
        statusElement.style.color = '#333';
        break;
      case 'error':
        statusElement.style.backgroundColor = '#F44336';
        break;
      default:
        statusElement.style.backgroundColor = '#2196F3';
    }

    statusContainer.appendChild(statusElement);

    setTimeout(() => {
      if (statusElement.parentNode) {
        statusElement.parentNode.removeChild(statusElement);
      }
    }, 3000);
  }

  function ensureOverlayListController() {
    if (overlayListController) {
      return overlayListController;
    }

    const { datasets } = getDeps();
    const Controller = window.DynmapOverlayListController;
    if (typeof Controller !== 'function') {
      logger.warn('Overlay list controller is not loaded.');
      return null;
    }

    overlayListController = new Controller({
      datasets: datasets.OVERLAY_DATASETS,
      initialDatasetKey: 'territoryMarkers',
      initialSortField: 'id',
      initialSortDirection: 'asc',
      batchSize: 80,
      getItems: datasets.loadOverlayDatasetItems,
      onFocusMc: datasets.focusMapAtMc,
      onStatus: displayStorageStatus
    });

    overlayListController.bind();
    return overlayListController;
  }

  async function updateDataDisplay() {
    const controller = ensureOverlayListController();
    if (!controller) {
      return;
    }

    await controller.refresh(true);
  }

  async function refreshAllData() {
    const { fetcher } = getDeps();
    logger.info('Manual refresh triggered.');

    try {
      await fetcher.fetchAndStoreAllData({
        showStatus: true,
        onStatus: displayStorageStatus,
        onDataUpdated: emitDataUpdated,
        onAfterRefresh: () => updateDataDisplay()
      });
    } catch (error) {
      logger.error('Failed to fetch or store data', error);
      displayStorageStatus('error', `获取数据失败: ${error.message}`);
      throw error;
    }
  }

  async function toggleDataView() {
    const controller = ensureOverlayListController();
    if (!controller) {
      return;
    }

    controller.cycleDataset();
    await controller.refresh(true);
  }

  async function viewCountryData() {
    const controller = ensureOverlayListController();
    if (!controller) {
      return;
    }

    controller.setDataset('countryAreas');
    await controller.refresh(true);
  }

  async function viewStoredData() {
    const { storage } = getDeps();

    await updateDataDisplay();

    const [markers, areas, countrySpawn, countryAreas, countryCapitals, countryCapitalsSpawn, capitalColorModes, countryClaims] = await Promise.all([
      storage.getStoredMarkers(),
      storage.getStoredAreas(),
      storage.getStoredCountrySpawn(),
      storage.getStoredCountryAreas(),
      storage.getStoredCountryCapitals(),
      storage.getStoredCountryCapitalsSpawn(),
      storage.getStoredCapitalColorModes(),
      storage.getStoredCountryClaims()
    ]);

    const markersCount = markers ? Object.keys(markers).length : 0;
    const areasCount = areas ? Object.keys(areas).length : 0;
    const countrySpawnCount = countrySpawn ? Object.keys(countrySpawn).length : 0;
    const countryAreasCount = countryAreas ? Object.keys(countryAreas).length : 0;
    const countryCapitalsCount = countryCapitals ? Object.keys(countryCapitals).length : 0;
    const countryCapitalsSpawnCount = countryCapitalsSpawn ? Object.keys(countryCapitalsSpawn).length : 0;
    const capitalColorCount = capitalColorModes ? Object.keys(capitalColorModes).length : 0;
    const countryClaimsCount = countryClaims ? Object.keys(countryClaims).length : 0;

    displayStorageStatus(
      'success',
      `显示了 ${markersCount} 个标记、${areasCount} 个区域、${countrySpawnCount} 个国家标记、${countryAreasCount} 个国家区域、${countryCapitalsCount} 个国家首都、${countryCapitalsSpawnCount} 个首都出生点、${capitalColorCount} 个首都配色、${countryClaimsCount} 个国家宣称`
    );
  }

  async function clearStoredData() {
    const { storage } = getDeps();
    try {
      await Promise.all([
        storage.removeStoredItem(storage.STORAGE_KEYS.markers),
        storage.removeStoredItem(storage.STORAGE_KEYS.areas),
        storage.removeStoredItem(storage.STORAGE_KEYS.countrySpawn),
        storage.removeStoredItem(storage.STORAGE_KEYS.countryAreas),
        storage.removeStoredItem(storage.STORAGE_KEYS.countryCapitals),
        storage.removeStoredItem(storage.STORAGE_KEYS.countryCapitalsSpawn),
        storage.removeStoredItem(storage.STORAGE_KEYS.capitalColorModes),
        storage.removeStoredItem(storage.STORAGE_KEYS.countryClaims),
        storage.removeStoredItem(storage.STORAGE_KEYS.conflictResolvedBoundaries)
      ]);

      logger.info('All stored data cleared from IndexedDB.');
      displayStorageStatus('success', '已清除存储的所有数据');
      emitDataUpdated({
        markers: {},
        areas: {},
        countrySpawn: {},
        countryAreas: {},
        countryCapitals: {},
        countryCapitalsSpawn: {}
      });
      await updateDataDisplay();
    } catch (error) {
      logger.error('Failed to clear stored data', error);
      displayStorageStatus('error', `清除数据失败：${error.message}`);
    }
  }

  async function initialize() {
    const { storage, fetcher } = getDeps();

    ensureOverlayListController();
    logger.info('Initializing data manager…');
    displayStorageStatus('info', '正在初始化数据…');

    const [cachedMarkers, cachedAreas, cachedSpawn, cachedCountryAreas, cachedCapitals, cachedCapitalsSpawn, cachedCapitalColors, cachedClaims] = await Promise.all([
      storage.getStoredMarkers(),
      storage.getStoredAreas(),
      storage.getStoredCountrySpawn(),
      storage.getStoredCountryAreas(),
      storage.getStoredCountryCapitals(),
      storage.getStoredCountryCapitalsSpawn(),
      storage.getStoredCapitalColorModes(),
      storage.getStoredCountryClaims()
    ]);

    const cachedCounts = {
      markers: cachedMarkers ? Object.keys(cachedMarkers).length : 0,
      areas: cachedAreas ? Object.keys(cachedAreas).length : 0,
      spawn: cachedSpawn ? Object.keys(cachedSpawn).length : 0,
      countryAreas: cachedCountryAreas ? Object.keys(cachedCountryAreas).length : 0,
      capitals: cachedCapitals ? Object.keys(cachedCapitals).length : 0,
      capitalsSpawn: cachedCapitalsSpawn ? Object.keys(cachedCapitalsSpawn).length : 0,
      capitalColors: cachedCapitalColors ? Object.keys(cachedCapitalColors).length : 0,
      claims: cachedClaims ? Object.keys(cachedClaims).length : 0
    };

    const hasCachedData = Object.values(cachedCounts).some(count => count > 0);

    if (hasCachedData) {
      logger.info('Cached data found, rendering current view before refresh.', cachedCounts);
      emitDataUpdated({
        markers: cachedMarkers ?? {},
        areas: cachedAreas ?? {},
        countrySpawn: cachedSpawn ?? {},
        countryAreas: cachedCountryAreas ?? {},
        countryCapitals: cachedCapitals ?? {},
        countryCapitalsSpawn: cachedCapitalsSpawn ?? {},
        capitalColorModes: cachedCapitalColors ?? {}
      });
      await updateDataDisplay();
      displayStorageStatus(
        'info',
        `使用本地缓存：标记 ${cachedCounts.markers}、区域 ${cachedCounts.areas}、国家标记 ${cachedCounts.spawn}、国家区域 ${cachedCounts.countryAreas}、国家首都 ${cachedCounts.capitals}、首都出生点 ${cachedCounts.capitalsSpawn}、首都配色 ${cachedCounts.capitalColors}`
      );
    }

    try {
      await fetcher.fetchAndStoreAllData({
        showStatus: !hasCachedData,
        onStatus: displayStorageStatus,
        onDataUpdated: emitDataUpdated,
        onAfterRefresh: () => updateDataDisplay()
      });
    } catch (error) {
      if (hasCachedData) {
        displayStorageStatus('warning', `更新失败，已展示本地缓存：${error.message}`);
      } else {
        displayStorageStatus('error', `初始化失败：${error.message}`);
      }
    }
  }

  async function exportData() {
    const { storage } = getDeps();
    try {
      logger.info('Exporting stored data…');

      const [markers, areas, countrySpawn, countryAreas, countryCapitals, capitalColorModes, countryClaims] = await Promise.all([
        storage.getStoredMarkers(),
        storage.getStoredAreas(),
        storage.getStoredCountrySpawn(),
        storage.getStoredCountryAreas(),
        storage.getStoredCountryCapitals(),
        storage.getStoredCapitalColorModes(),
        storage.getStoredCountryClaims()
      ]);

      const exportPayload = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        data: {
          landMarkers: markers,
          landAreas: areas,
          countrySpawn,
          countryAreas,
          countryCapitals,
          capitalColorModes,
          countryClaims
        },
        metadata: {
          exportedBy: 'Dynmap 数据管理系统',
          markersCount: markers ? Object.keys(markers).length : 0,
          areasCount: areas ? Object.keys(areas).length : 0,
          countrySpawnCount: countrySpawn ? Object.keys(countrySpawn).length : 0,
          countryAreasCount: countryAreas ? Object.keys(countryAreas).length : 0,
          countryCapitalsCount: countryCapitals ? Object.keys(countryCapitals).length : 0,
          countryClaimsCount: countryClaims ? Object.keys(countryClaims).length : 0
        }
      };

      const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dynmap-data-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      displayStorageStatus('success', '数据导出成功');
      logger.info('Export completed.');
    } catch (error) {
      logger.error('Failed to export data', error);
      displayStorageStatus('error', `数据导出失败：${error.message}`);
    }
  }

  async function showDatabaseStats() {
    const { storage } = getDeps();
    try {
      logger.info('Collecting database statistics…');

      const stats = await window.IndexedDBStorage?.getStats?.();
      const allKeys = await window.IndexedDBStorage?.getAllKeys?.();

      const [markers, areas, countrySpawn, countryAreas, countryCapitals, capitalColorModes, countryClaims] = await Promise.all([
        storage.getStoredMarkers(),
        storage.getStoredAreas(),
        storage.getStoredCountrySpawn(),
        storage.getStoredCountryAreas(),
        storage.getStoredCountryCapitals(),
        storage.getStoredCapitalColorModes(),
        storage.getStoredCountryClaims()
      ]);

      const detailStats = {
        landMarkers: markers ? Object.keys(markers).length : 0,
        landAreas: areas ? Object.keys(areas).length : 0,
        countrySpawn: countrySpawn ? Object.keys(countrySpawn).length : 0,
        countryAreas: countryAreas ? Object.keys(countryAreas).length : 0,
        countryCapitals: countryCapitals ? Object.keys(countryCapitals).length : 0,
        capitalColorModes: capitalColorModes ? Object.keys(capitalColorModes).length : 0,
        countryClaims: countryClaims ? Object.keys(countryClaims).length : 0
      };

      const statsMessage = `📊 数据库统计信息\n` +
        `📦 数据库名称：${stats?.dbName ?? 'N/A'}\n` +
        `🔢 数据库版本：${stats?.version ?? 'N/A'}\n` +
        `📋 总项目数：${stats?.totalItems ?? 'N/A'}\n` +
        `🔑 所有键：[${Array.isArray(allKeys) ? allKeys.join(', ') : ''}]\n\n` +
        `📈 详细统计：\n` +
        `• 领地标记：${detailStats.landMarkers} 个\n` +
        `• 领地区域：${detailStats.landAreas} 个\n` +
        `• 国家出生点：${detailStats.countrySpawn} 个\n` +
        `• 国家区域：${detailStats.countryAreas} 个\n` +
        `• 国家首都：${detailStats.countryCapitals} 个\n` +
        `• 国家宣称：${detailStats.countryClaims} 个`;

      logger.info(statsMessage);
      displayStorageStatus('info', '数据库统计信息已输出到控制台');

      const statusContent = document.getElementById('status-content');
      if (statusContent) {
        statusContent.innerHTML = `<pre style="font-size: 12px; white-space: pre-wrap;">${statsMessage}</pre>`;
      }
    } catch (error) {
      logger.error('Failed to show database stats', error);
      displayStorageStatus('error', `获取统计信息失败：${error.message}`);
    }
  }

  window.DynmapDataUI = Object.freeze({
    initialize,
    refreshAllData,
    viewStoredData,
    clearStoredData,
    toggleDataView,
    viewCountryData,
    exportData,
    showDatabaseStats,
    displayStorageStatus,
    emitDataUpdated,
    updateDataDisplay
  });
})();
