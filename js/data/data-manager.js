(() => {
  const logger = {
    info: (...args) => console.log('[DataManager]', ...args),
    warn: (...args) => console.warn('[DataManager]', ...args),
    error: (...args) => console.error('[DataManager]', ...args)
  };

  function bindGlobal(name, fn) {
    if (typeof fn !== 'function') {
      logger.warn(`Unable to bind global "${name}": target is not a function.`);
      return;
    }
    window[name] = fn;
  }

  function init() {
    const ui = window.DynmapDataUI;
    if (!ui) {
      logger.warn('Missing DynmapDataUI. Ensure js/data/data-ui.js is loaded before data-manager.js.');
      return;
    }

    bindGlobal('refreshAllData', ui.refreshAllData);
    bindGlobal('viewStoredData', ui.viewStoredData);
    bindGlobal('clearStoredData', ui.clearStoredData);
    bindGlobal('toggleDataView', ui.toggleDataView);
    bindGlobal('viewCountryData', ui.viewCountryData);
    bindGlobal('exportData', ui.exportData);
    bindGlobal('showDatabaseStats', ui.showDatabaseStats);

    // Needed by overlay-export.js (export image status)
    bindGlobal('displayStorageStatus', ui.displayStorageStatus);

    ui.initialize?.();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

