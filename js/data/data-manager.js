/**
 * Dynmap 领地数据管理器
 * 负责数据的获取、存储、处理和展示。
 */

const DATA_SOURCE_URL = 'https://map.simmc.cc/tiles/_markers_/marker_world.json';
const LAND_SET_NAMESPACE = 'me.angeschossen.lands';

const STORAGE_KEYS = Object.freeze({
  markers: 'landMarkers',
  areas: 'landAreas',
  countrySpawn: 'countrySpawn',
  countryAreas: 'countryAreas',
  countryCapitals: 'countryCapitals',
  countryClaims: 'countryClaims',
  claimsConfig: 'claimsConfig',
  conflictResolvedBoundaries: 'conflictResolvedBoundaries'
});

let currentDataView = 'markers'; // 'markers' | 'areas' | 'countrySpawn' | 'countryAreas'

/**
 * 通用工具函数
 */

const logger = {
  info: (...args) => console.log('[DataManager]', ...args),
  warn: (...args) => console.warn('[DataManager]', ...args),
  error: (...args) => console.error('[DataManager]', ...args)
};

function stripHtml(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractCountryFromDesc(desc) {
  const cleanDesc = stripHtml(desc);
  if (!cleanDesc) {
    return null;
  }

  const patterns = [
    /这片领土属于国家[:：]?\s*([^，。:\\s]+)/
  ];

  for (const pattern of patterns) {
    const match = cleanDesc.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

// 严格解析“首都: XXX/首都：XXX”的工具方法
function extractCapitalFromDescStrict(desc) {
  const cleanDesc = stripHtml(desc);
  if (!cleanDesc) {
    return null;
  }

  const patterns = [
    /首都[:：]?\s*([^，。:\s]+)/
  ];

  for (const pattern of patterns) {
    const match = cleanDesc.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

// 校验区域文本是否以 >首都名< 的形式出现
function areaContainsTagDelimitedName(source, name) {
  if (!source || !name || typeof source !== 'string' || typeof name !== 'string') {
    return false;
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`>${escaped}<`);
  return re.test(source);
}

function deriveTerritoryGroupingName(identifier, source) {
  const candidates = [source?.label, source?.name, source?.title];
  for (const candidate of candidates) {
    const cleaned = stripHtml(candidate);
    if (cleaned) {
      return cleaned;
    }
  }

  const fallback = stripHtml(source?.desc);
  if (fallback) {
    const patterns = [
      /领地[:：]\s*([^，。:\\s]+)/,
      /territory[:：]?\s*([A-Za-z0-9 _'()-]+)/i
    ];

    for (const pattern of patterns) {
      const match = fallback.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    const primarySegment = fallback.split(/[，。:；;\n]/u)[0]?.trim();
    if (primarySegment) {
      return primarySegment;
    }
  }

  if (identifier) {
    return `Territory ${identifier}`;
  }

  return null;
}
function emitDataUpdated(detail) {
  if (typeof document === 'undefined' || typeof CustomEvent !== 'function') {
    return;
  }

  try {
    document.dispatchEvent(new CustomEvent('dynmap:data-updated', {
      detail
    }));
  } catch (error) {
    logger.warn('Failed to emit data update event', error);
  }
}

async function getStoredJson(key) {
  if (!key || typeof key !== 'string') {
    logger.warn('getStoredJson called without a valid key, skipping lookup.', key);
    return null;
  }

  const rawValue = await IndexedDBStorage.getItem(key);
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  if (typeof rawValue === 'string') {
    try {
      return JSON.parse(rawValue);
    } catch (error) {
      logger.warn(`Unable to parse value for key "${key}" as JSON. Returning raw string.`, error);
      return rawValue;
    }
  }

  return rawValue;
}

async function setStoredJson(key, value) {
  if (value === undefined) {
    return;
  }

  if (value === null) {
    await IndexedDBStorage.removeItem(key);
    return;
  }

  await IndexedDBStorage.setItem(key, value);
}

async function removeStoredItem(key) {
  await IndexedDBStorage.removeItem(key);
}

/**
 * 数据获取和存储
 */

async function fetchRemoteData() {
  logger.info('Fetching remote marker data from', DATA_SOURCE_URL);

  const response = await fetch(DATA_SOURCE_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function extractLandData(rawData) {
  const landSet = rawData?.sets?.[LAND_SET_NAMESPACE];
  if (!landSet) {
    logger.warn('Land set not found in remote payload.');
    return { markers: {}, areas: {} };
  }

  return {
    markers: landSet.markers ?? {},
    areas: landSet.areas ?? {}
  };
}

async function persistFetchedData(markers, areas) {
  await Promise.all([
    setStoredJson(STORAGE_KEYS.markers, markers ?? {}),
    setStoredJson(STORAGE_KEYS.areas, areas ?? {})
  ]);
}

async function getStoredMarkers() {
  return getStoredJson(STORAGE_KEYS.markers);
}

async function getStoredAreas() {
  return getStoredJson(STORAGE_KEYS.areas);
}

async function fetchAndStoreAllData(options = {}) {
  const { showStatus = true } = options;

  if (showStatus) {
    displayStorageStatus('info', '正在从服务器获取最新数据...');
  }

  try {
    const rawData = await fetchRemoteData();
    const { markers, areas } = extractLandData(rawData);
    const markersCount = Object.keys(markers).length;
    const areasCount = Object.keys(areas).length;

    await persistFetchedData(markers, areas);
    const countryData = await processCountryData(markers, areas);

    emitDataUpdated({
      markers,
      areas,
      countrySpawn: countryData?.countrySpawn ?? {},
      countryAreas: countryData?.countryAreas ?? {},
      countryCapitals: countryData?.countryCapitals ?? {}
    });

    if (showStatus) {
      displayStorageStatus('success', `成功存储 ${markersCount} 个标记、${areasCount} 个区域`);
    }

    logger.info(
      'Remote data stored. markers:',
      markersCount,
      'areas:',
      areasCount,
      'capitals:',
      Object.keys(countryData?.countryCapitals ?? {}).length
    );
    await updateDataDisplay();

    return { markers, areas };
  } catch (error) {
    logger.error('Failed to fetch or store data', error);
    if (showStatus) {
      displayStorageStatus('error', `获取数据失败: ${error.message}`);
    }
    throw error;
  }
}

async function processCountryData(markers, areas) {
  logger.info('Processing country level data…');

  const markerData = markers ?? (await getStoredMarkers());
  const areaData = areas ?? (await getStoredAreas());

  if (!markerData && !areaData) {
    logger.warn('No marker or area data available for country processing.');
    return { countrySpawn: {}, countryAreas: {}, countryCapitals: {} };
  }

  const countrySpawn = {};
  const countryAreas = {};
  const countryCapitals = {};

  if (markerData) {
    for (const [markerId, marker] of Object.entries(markerData)) {
      // Only accept countries parsed via extractCountryFromDesc
      const countryName =
        extractCountryFromDesc(marker?.markup) ||
        extractCountryFromDesc(marker?.desc) ||
        extractCountryFromDesc(marker?.label);

      if (!countryName) {
        logger.warn(`Skipping marker ${markerId}: no country found via extractCountryFromDesc`);
        continue;
      }

      if (!countrySpawn[countryName]) {
        countrySpawn[countryName] = { spawns: [] };
      }

      if (marker?.x !== undefined && marker?.z !== undefined) {
        countrySpawn[countryName].spawns.push({
          x: marker.x,
          z: marker.z,
          y: marker.y ?? 64,
          name: marker.label || markerId,
          markerId,
          markerData: marker
        });
      }

      countrySpawn[countryName][markerId] = marker;
    }
  }

  if (areaData) {
    for (const [areaId, area] of Object.entries(areaData)) {
      // Only accept countries parsed via extractCountryFromDesc
      const countryName =
        extractCountryFromDesc(area?.markup) ||
        extractCountryFromDesc(area?.desc) ||
        extractCountryFromDesc(area?.label);

      if (!countryName) {
        logger.warn(`Skipping area ${areaId}: no country found via extractCountryFromDesc`);
        continue;
      }

      if (!countryAreas[countryName]) {
        countryAreas[countryName] = {};
      }

      countryAreas[countryName][areaId] = area;

      const capitalName =
        extractCapitalFromDescStrict(area?.markup) ||
        extractCapitalFromDescStrict(area?.desc) ||
        extractCapitalFromDescStrict(area?.label);

      if (capitalName) {
        if (!countryCapitals[countryName]) {
          countryCapitals[countryName] = { name: capitalName, areas: {} };
        } else if (!countryCapitals[countryName].areas) {
          countryCapitals[countryName].areas = {};
        }

        // 更新首都名字
        countryCapitals[countryName].name = capitalName;

        // 仅当区域文本中出现 `>首都名<` 时，才将该区域计入首都区域
        const matchesCapitalArea =
          areaContainsTagDelimitedName(area?.markup, capitalName) ||
          areaContainsTagDelimitedName(area?.label, capitalName) ||
          areaContainsTagDelimitedName(area?.desc, capitalName);

        if (matchesCapitalArea) {
          countryCapitals[countryName].areas[areaId] = area;
        }
      }
    }
  }

  await Promise.all([
    setStoredJson(STORAGE_KEYS.countrySpawn, countrySpawn),
    setStoredJson(STORAGE_KEYS.countryAreas, countryAreas),
    setStoredJson(STORAGE_KEYS.countryCapitals, countryCapitals)
  ]);

  logger.info(
    `Country data stored. spawn groups: ${Object.keys(countrySpawn).length}, area groups: ${Object.keys(countryAreas).length}, capital groups: ${Object.keys(countryCapitals).length}`
  );

  return { countrySpawn, countryAreas, countryCapitals };
}

function extractCapitalFromDesc(desc) {
  if (!desc || typeof desc !== 'string') {
    return null;
  }

  const cleanDesc = desc.replace(/<[^>]*>/g, '');
  const match = cleanDesc.match(/首都[:：]\s*([^领\s]+?)领土/);
  if (!match || !match[1]) {
    return null;
  }

  return match[1].trim();
}

async function getStoredCountrySpawn() {
  return getStoredJson(STORAGE_KEYS.countrySpawn);
}

async function getStoredCountryAreas() {
  return getStoredJson(STORAGE_KEYS.countryAreas);
}

async function getStoredCountryCapitals() {
  return getStoredJson(STORAGE_KEYS.countryCapitals);
}

async function setStoredCountryClaims(countryClaimsData) {
  await setStoredJson(STORAGE_KEYS.countryClaims, countryClaimsData);
  logger.info('Country claims stored.');
}

async function getStoredCountryClaims() {
  return getStoredJson(STORAGE_KEYS.countryClaims);
}

async function setStoredClaimsConfig(configData) {
  await setStoredJson(STORAGE_KEYS.claimsConfig, configData);
  logger.info('Claims config stored.');
}

async function getStoredClaimsConfig() {
  return getStoredJson(STORAGE_KEYS.claimsConfig);
}

async function clearStoredCountryClaims() {
  await removeStoredItem(STORAGE_KEYS.countryClaims);
  const remaining = await IndexedDBStorage.getItem(STORAGE_KEYS.countryClaims);
  const isCleared = remaining === null;
  logger.info('Country claims cleared:', isCleared);
  return isCleared;
}

async function setStoredConflictResolvedBoundaries(boundaryData) {
  await setStoredJson(STORAGE_KEYS.conflictResolvedBoundaries, boundaryData);
  logger.info('Conflict resolved boundaries stored.');
}

async function getStoredConflictResolvedBoundaries() {
  return getStoredJson(STORAGE_KEYS.conflictResolvedBoundaries);
}

async function clearStoredConflictResolvedBoundaries() {
  await removeStoredItem(STORAGE_KEYS.conflictResolvedBoundaries);
  const remaining = await IndexedDBStorage.getItem(STORAGE_KEYS.conflictResolvedBoundaries);
  const isCleared = remaining === null;
  logger.info('Conflict resolved boundaries cleared:', isCleared);
  return isCleared;
}

async function verifyCountryClaimsCleared() {
  const remaining = await IndexedDBStorage.getItem(STORAGE_KEYS.countryClaims);
  const isCleared = remaining === null;
  logger.info('Country claims present after clear?', !isCleared);
  if (!isCleared) {
    logger.info('Remaining country claims data:', remaining);
  }
  return isCleared;
}

/**
 * 数据展示
 */

async function updateDataDisplay() {
  switch (currentDataView) {
    case 'markers': {
      const markers = await getStoredMarkers();
      displayMarkersOnPage(markers);
      break;
    }
    case 'areas': {
      const areas = await getStoredAreas();
      displayAreasOnPage(areas);
      break;
    }
    case 'countrySpawn': {
      const countrySpawn = await getStoredCountrySpawn();
      displayCountrySpawnOnPage(countrySpawn);
      break;
    }
    case 'countryAreas': {
      const countryAreas = await getStoredCountryAreas();
      displayCountryAreasOnPage(countryAreas);
      break;
    }
    default:
      logger.warn('Unknown data view:', currentDataView);
  }
}

function displayMarkersOnPage(markers) {
  const dataList = document.getElementById('data-list');
  const dataTitle = document.getElementById('data-display-title');
  if (!dataList || !dataTitle) {
    return;
  }

  dataTitle.textContent = '📍 存储的标记数据';

  if (!markers || Object.keys(markers).length === 0) {
    dataList.innerHTML = '<p style="color: #999; font-style: italic;">暂无标记数据</p>';
    return;
  }

  let html = `
    <div style="margin-bottom: 15px; padding: 10px; background-color: #e8f5e8; border-radius: 5px;">
      <strong>📊 总计 ${Object.keys(markers).length} 个标记</strong>
    </div>
    <div style="display: grid; gap: 10px;">
  `;

  for (const [key, marker] of Object.entries(markers)) {
    const { x, y, z, label, desc, icon, dim } = marker;
    const cleanDesc = desc ? desc.replace(/<[^>]*>/g, '').trim() : '无描述';

    html += `
      <div style="
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 15px;
        background-color: #fafafa;
        transition: box-shadow 0.2s;
      " onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)'" onmouseout="this.style.boxShadow='none'">

        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
          <h4 style="margin: 0; color: #2c3e50; font-size: 16px;">
            🏷️ ${label || '未命名标记'}
          </h4>
          <span style="
            background-color: #3498db;
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
            white-space: nowrap;
          ">
            ${icon || 'default'} ${dim || ''}
          </span>
        </div>

        <div style="margin-bottom: 8px;">
          <strong>📍 坐标：</strong>
          <span style="font-family: monospace; background-color: #ecf0f1; padding: 2px 6px; border-radius: 3px;">
            X: ${x}, Y: ${y}, Z: ${z}
          </span>
        </div>

        <div style="margin-bottom: 8px;">
          <strong>🔑 标识：</strong>
          <span style="font-family: monospace; font-size: 12px; color: #7f8c8d;">
            ${key}
          </span>
        </div>

        ${cleanDesc !== '无描述' ? `
          <div style="margin-top: 10px; padding: 8px; background-color: #fff; border-left: 3px solid #3498db; border-radius: 0 4px 4px 0;">
            <strong>📝 描述：</strong><br>
            <span style="color: #555; font-size: 14px;">${cleanDesc}</span>
          </div>
        ` : ''}

      </div>
    `;
  }

  html += '</div>';
  dataList.innerHTML = html;
}

function displayAreasOnPage(areas) {
  const dataList = document.getElementById('data-list');
  const dataTitle = document.getElementById('data-display-title');
  if (!dataList || !dataTitle) {
    return;
  }

  dataTitle.textContent = '🏘️ 存储的区域数据';

  if (!areas || Object.keys(areas).length === 0) {
    dataList.innerHTML = '<p style="color: #999; font-style: italic;">暂无区域数据</p>';
    return;
  }

  let html = `
    <div style="margin-bottom: 15px; padding: 10px; background-color: #f3e5f5; border-radius: 5px;">
      <strong>📊 总计 ${Object.keys(areas).length} 个区域</strong>
    </div>
    <div style="display: grid; gap: 10px;">
  `;

  for (const [key, area] of Object.entries(areas)) {
    const { x = [], z = [], fillcolor, color, ytop, weight, markup } = area;
    if (!Array.isArray(x) || !Array.isArray(z) || x.length === 0 || z.length === 0) {
      continue;
    }

    const minX = Math.min(...x);
    const maxX = Math.max(...x);
    const minZ = Math.min(...z);
    const maxZ = Math.max(...z);
    const centerX = Math.round((minX + maxX) / 2);
    const centerZ = Math.round((minZ + maxZ) / 2);
    const pointCount = x.length;

    html += `
      <div style="
        padding: 15px;
        border: 1px solid #ddd;
        border-radius: 8px;
        background-color: #fafafa;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      ">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
          <div>
            <h4 style="margin: 0 0 5px 0; color: #673AB7; font-size: 16px;">
              区域 ${key.split('_')[0]}
            </h4>
            <p style="margin: 0; font-size: 12px; color: #666;">
              ID: ${key}
            </p>
          </div>
          <div style="text-align: right;">
            <div style="
              width: 20px;
              height: 20px;
              background-color: ${fillcolor || '#80AE89'};
              border: 2px solid ${color || '#80AE89'};
              border-radius: 3px;
              display: inline-block;
            "></div>
          </div>
        </div>

        <div style="margin-bottom: 10px;">
          <strong style="color: #333;">中心坐标：</strong>
          <span style="
            font-family: monospace;
            background-color: #f3e5f5;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 13px;
          ">
            X: ${centerX}, Z: ${centerZ}
          </span>
        </div>

        <div style="margin-bottom: 10px;">
          <strong style="color: #333;">边界范围：</strong>
          <span style="
            font-family: monospace;
            background-color: #f3e5f5;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 13px;
          ">
            X: ${minX} ~ ${maxX}, Z: ${minZ} ~ ${maxZ}
          </span>
        </div>

        <div style="margin-bottom: 8px;">
          <strong style="color: #333;">顶点数量：</strong>
          <span style="color: #666; font-size: 14px;">${pointCount} 个</span>
        </div>

        <div style="margin-bottom: 8px;">
          <strong style="color: #333;">Y 轴高度：</strong>
          <span style="color: #666; font-size: 14px;">${ytop ?? 'N/A'}</span>
        </div>

        <div style="margin-bottom: 8px;">
          <strong style="color: #333;">边框粗细：</strong>
          <span style="color: #666; font-size: 14px;">${weight ?? 1}px</span>
        </div>

        ${markup ? `
          <div style="margin-top: 10px; font-size: 13px; color: #555;">
            <strong>标注：</strong>
            <span>${markup}</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  html += '</div>';
  dataList.innerHTML = html;
}

function displayCountrySpawnOnPage(countrySpawn) {
  const dataList = document.getElementById('data-list');
  const dataTitle = document.getElementById('data-display-title');
  if (!dataList || !dataTitle) {
    return;
  }

  dataTitle.textContent = '🏰 国家出生点';

  if (!countrySpawn || Object.keys(countrySpawn).length === 0) {
    dataList.innerHTML = '<p style="color: #999; font-style: italic;">暂无国家出生点数据</p>';
    return;
  }

  let html = `
    <div style="margin-bottom: 15px; padding: 10px; background-color: #e0f7fa; border-radius: 5px;">
      <strong>📊 涉及 ${Object.keys(countrySpawn).length} 个国家</strong>
    </div>
    <div style="display: grid; gap: 10px;">
  `;

  for (const [countryName, data] of Object.entries(countrySpawn)) {
    const spawns = Array.isArray(data?.spawns) ? data.spawns : [];
    html += `
      <div style="
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 15px;
        background-color: #fafafa;
      ">
        <h3 style="margin: 0 0 10px 0; color: #006064;">${countryName}</h3>
        <p style="margin: 0 0 10px 0; color: #555;">拥有 ${spawns.length} 个出生点</p>
        <div style="display: grid; gap: 6px;">
          ${spawns.length > 0
            ? spawns
                .map(spawn => `
                  <div style="
                    background-color: #e0f2f1;
                    padding: 8px;
                    border-radius: 6px;
                    font-size: 13px;
                  ">
                    <strong>${spawn.name}</strong>
                    <span style="font-family: monospace; margin-left: 6px;">(X: ${spawn.x}, Y: ${spawn.y}, Z: ${spawn.z})</span>
                  </div>
                `)
                .join('')
            : '<span style="color: #999; font-style: italic;">暂无出生点</span>'}
        </div>
      </div>
    `;
  }

  html += '</div>';
  dataList.innerHTML = html;
}

function displayCountryAreasOnPage(countryAreas) {
  const dataList = document.getElementById('data-list');
  const dataTitle = document.getElementById('data-display-title');
  if (!dataList || !dataTitle) {
    return;
  }

  dataTitle.textContent = '🗺️ 国家领地区域';

  if (!countryAreas || Object.keys(countryAreas).length === 0) {
    dataList.innerHTML = '<p style="color: #999; font-style: italic;">暂无国家区域数据</p>';
    return;
  }

  let html = `
    <div style="margin-bottom: 15px; padding: 10px; background-color: #fff9c4; border-radius: 5px;">
      <strong>📊 涉及 ${Object.keys(countryAreas).length} 个国家</strong>
    </div>
    <div style="display: grid; gap: 10px;">
  `;

  for (const [countryName, areas] of Object.entries(countryAreas)) {
    const areaCount = Object.keys(areas).length;
    html += `
      <div style="
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 15px;
        background-color: #fffde7;
      ">
        <h3 style="margin: 0 0 10px 0; color: #827717;">${countryName}</h3>
        <p style="margin: 0 0 10px 0; color: #555;">拥有 ${areaCount} 个区域</p>
        <div style="display: grid; gap: 6px; font-size: 13px;">
          ${Object.entries(areas)
            .map(([areaId]) => `
              <div style="padding: 6px; border-radius: 4px; background-color: #fff59d;">
                区域 ID: ${areaId}
              </div>
            `)
            .join('')}
        </div>
      </div>
    `;
  }

  html += '</div>';
  dataList.innerHTML = html;
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

/**
 * 用户操作
 */

async function refreshAllData() {
  logger.info('Manual refresh triggered.');
  await fetchAndStoreAllData({ showStatus: true });
}

async function toggleDataView() {
  const viewCycle = ['markers', 'areas', 'countrySpawn', 'countryAreas'];
  const currentIndex = viewCycle.indexOf(currentDataView);
  currentDataView = viewCycle[(currentIndex + 1) % viewCycle.length];

  const toggleBtn = document.getElementById('data-view-toggle');
  if (toggleBtn) {
    switch (currentDataView) {
      case 'markers':
        toggleBtn.textContent = '🔄 切换到区域数据';
        toggleBtn.style.backgroundColor = '#9C27B0';
        break;
      case 'areas':
        toggleBtn.textContent = '🔄 切换到国家标记';
        toggleBtn.style.backgroundColor = '#FF9800';
        break;
      case 'countrySpawn':
        toggleBtn.textContent = '🔄 切换到国家区域';
        toggleBtn.style.backgroundColor = '#4CAF50';
        break;
      case 'countryAreas':
        toggleBtn.textContent = '🔄 切换到标记数据';
        toggleBtn.style.backgroundColor = '#2196F3';
        break;
      default:
        toggleBtn.textContent = '🔄 切换视图';
        toggleBtn.style.backgroundColor = '#607D8B';
    }
  }

  await updateDataDisplay();
}

async function viewStoredData() {
  await updateDataDisplay();

  const [markers, areas, countrySpawn, countryAreas, countryCapitals, countryClaims] = await Promise.all([
    getStoredMarkers(),
    getStoredAreas(),
    getStoredCountrySpawn(),
    getStoredCountryAreas(),
    getStoredCountryCapitals(),
    getStoredCountryClaims()
  ]);

  const markersCount = markers ? Object.keys(markers).length : 0;
  const areasCount = areas ? Object.keys(areas).length : 0;
  const countrySpawnCount = countrySpawn ? Object.keys(countrySpawn).length : 0;
  const countryAreasCount = countryAreas ? Object.keys(countryAreas).length : 0;
  const countryCapitalsCount = countryCapitals ? Object.keys(countryCapitals).length : 0;
  const countryClaimsCount = countryClaims ? Object.keys(countryClaims).length : 0;

  displayStorageStatus(
    'success',
    `显示了 ${markersCount} 个标记、${areasCount} 个区域、${countrySpawnCount} 个国家标记、${countryAreasCount} 个国家区域、${countryCapitalsCount} 个国家首都、${countryClaimsCount} 个国家宣称`
  );
}

async function viewCountryData() {
  const [countrySpawn, countryAreas] = await Promise.all([
    getStoredCountrySpawn(),
    getStoredCountryAreas()
  ]);

  if (!countrySpawn && !countryAreas) {
    displayStorageStatus('warning', '暂无国家数据，请先获取。');
    return;
  }

  currentDataView = countrySpawn ? 'countrySpawn' : 'countryAreas';
  await updateDataDisplay();
}

async function clearStoredData() {
  try {
    await Promise.all([
      removeStoredItem(STORAGE_KEYS.markers),
      removeStoredItem(STORAGE_KEYS.areas),
      removeStoredItem(STORAGE_KEYS.countrySpawn),
      removeStoredItem(STORAGE_KEYS.countryAreas),
      removeStoredItem(STORAGE_KEYS.countryCapitals),
      removeStoredItem(STORAGE_KEYS.countryClaims),
      removeStoredItem(STORAGE_KEYS.conflictResolvedBoundaries)
    ]);

    logger.info('All stored data cleared from IndexedDB.');
    displayStorageStatus('success', '已清除存储的所有数据');
    emitDataUpdated({
      markers: {},
      areas: {},
      countrySpawn: {},
      countryAreas: {},
      countryCapitals: {}
    });
    await updateDataDisplay();
  } catch (error) {
    logger.error('Failed to clear stored data', error);
    displayStorageStatus('error', `清除数据失败：${error.message}`);
  }
}

/**
 * 初始化流程
 */

async function initializeDataManager() {
  logger.info('Initializing data manager…');
  displayStorageStatus('info', '正在初始化数据…');

  const [cachedMarkers, cachedAreas, cachedSpawn, cachedCountryAreas, cachedCapitals, cachedClaims] = await Promise.all([
    getStoredMarkers(),
    getStoredAreas(),
    getStoredCountrySpawn(),
    getStoredCountryAreas(),
    getStoredCountryCapitals(),
    getStoredCountryClaims()
  ]);

  const cachedCounts = {
    markers: cachedMarkers ? Object.keys(cachedMarkers).length : 0,
    areas: cachedAreas ? Object.keys(cachedAreas).length : 0,
    spawn: cachedSpawn ? Object.keys(cachedSpawn).length : 0,
    countryAreas: cachedCountryAreas ? Object.keys(cachedCountryAreas).length : 0,
    capitals: cachedCapitals ? Object.keys(cachedCapitals).length : 0,
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
      countryCapitals: cachedCapitals ?? {}
    });
    await updateDataDisplay();
    displayStorageStatus(
      'info',
      `使用本地缓存：标记 ${cachedCounts.markers}、区域 ${cachedCounts.areas}、国家标记 ${cachedCounts.spawn}、国家区域 ${cachedCounts.countryAreas}、国家首都 ${cachedCounts.capitals}`
    );
  }

  try {
    await fetchAndStoreAllData({ showStatus: !hasCachedData });
  } catch (error) {
    if (hasCachedData) {
      displayStorageStatus('warning', `更新失败，已展示本地缓存：${error.message}`);
    } else {
      displayStorageStatus('error', `初始化失败：${error.message}`);
    }
  }
}

document.addEventListener('DOMContentLoaded', initializeDataManager);

/**
 * 高级功能
 */

async function exportData() {
  try {
    logger.info('Exporting stored data…');

    const [markers, areas, countrySpawn, countryAreas, countryCapitals, countryClaims] = await Promise.all([
      getStoredMarkers(),
      getStoredAreas(),
      getStoredCountrySpawn(),
      getStoredCountryAreas(),
      getStoredCountryCapitals(),
      getStoredCountryClaims()
    ]);

    const exportData = {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      data: {
        landMarkers: markers,
        landAreas: areas,
        countrySpawn,
        countryAreas,
        countryCapitals,
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

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
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
  try {
    logger.info('Collecting database statistics…');

    const stats = await IndexedDBStorage.getStats();
    const allKeys = await IndexedDBStorage.getAllKeys();

    const [markers, areas, countrySpawn, countryAreas, countryCapitals, countryClaims] = await Promise.all([
      getStoredMarkers(),
      getStoredAreas(),
      getStoredCountrySpawn(),
      getStoredCountryAreas(),
      getStoredCountryCapitals(),
      getStoredCountryClaims()
    ]);

    const detailStats = {
      landMarkers: markers ? Object.keys(markers).length : 0,
      landAreas: areas ? Object.keys(areas).length : 0,
      countrySpawn: countrySpawn ? Object.keys(countrySpawn).length : 0,
      countryAreas: countryAreas ? Object.keys(countryAreas).length : 0,
      countryCapitals: countryCapitals ? Object.keys(countryCapitals).length : 0,
      countryClaims: countryClaims ? Object.keys(countryClaims).length : 0
    };

    const statsMessage = `📊 数据库统计信息\n` +
      `📁 数据库名称：${stats.dbName}\n` +
      `🧾 数据库版本：${stats.version}\n` +
      `📦 总项目数：${stats.totalItems}\n` +
      `🔑 所有键：[${allKeys.join(
)}]\n\n` +
      `📋 详细统计：\n` +
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

// 暴露全局函数给 HTML 的按钮使用
window.refreshAllData = refreshAllData;
window.viewStoredData = viewStoredData;
window.clearStoredData = clearStoredData;
window.toggleDataView = toggleDataView;
window.viewCountryData = viewCountryData;
window.exportData = exportData;
window.showDatabaseStats = showDatabaseStats;































