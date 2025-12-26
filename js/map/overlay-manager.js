(() => {
  let initialized = false;

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;

    (function () {
      const overlayApi = window.DynmapOverlayLayers;
      if (!overlayApi) {
        console.warn('[OverlayManager] Missing overlay API');
        return;
      }

      const { overlayLayers, imageSize } = overlayApi;
      const imageWidthValue = imageSize?.width;
      const imageHeightValue = imageSize?.height;

      if (!overlayLayers || !imageWidthValue || !imageHeightValue) {
        console.warn('[OverlayManager] Incomplete overlay configuration');
        return;
      }

      const MC_BOUNDS = {
        minX: -13566,
        maxX: 11520,
        minZ: -8702,
        maxZ: 18297
      };

      const WORLD_WIDTH = MC_BOUNDS.maxX - MC_BOUNDS.minX;
      const WORLD_HEIGHT = MC_BOUNDS.maxZ - MC_BOUNDS.minZ;
      const SCALE_X = imageWidthValue / WORLD_WIDTH;
      const SCALE_Y = imageHeightValue / WORLD_HEIGHT;

      const overlayContent = {
        territoryMarkers: [],
        territoryAreas: [],
        countrySpawn: [],
        countryAreas: [],
        countryCapitals: [],
        countryCapitalsSpawn: []
      };

      const CAPITAL_COLOR_SCHEMES = {
        red: { stroke: '#dc2626', fill: '#ef4444', labelClass: 'capital-label--red' },
        green: { stroke: '#15803d', fill: '#22c55e', labelClass: 'capital-label--green' }
      };
      const CAPITAL_COLOR_STORAGE_KEY = 'capitalColorModes';
      const capitalColorOverrides = Object.create(null);
      let lastCountryCapitalData = {};
      let lastCountryAreasData = {};

      const DEFAULT_TERRITORY_STROKE_COLOR = '#009933';
      const DEFAULT_TERRITORY_FILL_COLOR = '#00ff00';
      const countryColorCache = Object.create(null);

      function normalizeColor(value) {
        if (!value || typeof value !== 'string') {
          return '';
        }
        return value.trim().toLowerCase();
      }

      function toHex6(value) {
        const raw = normalizeColor(value);
        if (!raw) {
          return '';
        }

        if (raw.startsWith('rgb')) {
          const match = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
          if (!match) {
            return '';
          }
          const r = Math.max(0, Math.min(255, Number(match[1])));
          const g = Math.max(0, Math.min(255, Number(match[2])));
          const b = Math.max(0, Math.min(255, Number(match[3])));
          const hex = (v) => v.toString(16).padStart(2, '0');
          return `#${hex(r)}${hex(g)}${hex(b)}`;
        }

        if (raw.startsWith('#')) {
          const cleaned = raw.slice(1);
          if (cleaned.length === 3) {
            return `#${cleaned[0]}${cleaned[0]}${cleaned[1]}${cleaned[1]}${cleaned[2]}${cleaned[2]}`.toLowerCase();
          }
          if (cleaned.length === 6) {
            return `#${cleaned}`.toLowerCase();
          }
        }

        return raw;
      }

      function getCountryColor(countryName) {
        if (!countryName) {
          return null;
        }
        if (countryColorCache[countryName]) {
          return countryColorCache[countryName];
        }
        const hash = Array.from(countryName).reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const hue = hash % 360;
        const color = `hsl(${hue}, 70%, 50%)`;
        countryColorCache[countryName] = color;
        return color;
      }

      function getCapitalColorMode(countryName) {
        if (!countryName) {
          return 'red';
        }
        return capitalColorOverrides[countryName] || 'red';
      }

      function getCapitalColorScheme(countryName) {
        const mode = getCapitalColorMode(countryName);
        return CAPITAL_COLOR_SCHEMES[mode] || CAPITAL_COLOR_SCHEMES.red;
      }

      async function persistCapitalColorModes() {
        if (!window.IndexedDBStorage || typeof window.IndexedDBStorage.setItem !== 'function') {
          return;
        }
        const saved = {};
        Object.entries(capitalColorOverrides).forEach(([countryName, mode]) => {
          saved[countryName] = mode;
        });
        await window.IndexedDBStorage.setItem(CAPITAL_COLOR_STORAGE_KEY, saved);
      }

      async function loadCapitalColorModes() {
        if (!window.IndexedDBStorage || typeof window.IndexedDBStorage.getItem !== 'function') {
          return;
        }
        try {
          const stored = await window.IndexedDBStorage.getItem(CAPITAL_COLOR_STORAGE_KEY);
          if (!stored) {
            return;
          }
          const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
          if (!parsed || typeof parsed !== 'object') {
            return;
          }
          Object.entries(parsed).forEach(([countryName, mode]) => {
            if (mode === 'green') {
              capitalColorOverrides[countryName] = mode;
            }
          });
        } catch (error) {
          console.warn('[OverlayManager] Failed to load capital color modes', error);
        }
      }

      function toggleCapitalColorMode(countryName) {
        if (!countryName) {
          return;
        }
        const currentMode = getCapitalColorMode(countryName);
        const nextMode = currentMode === 'green' ? 'red' : 'green';
        if (nextMode === 'red') {
          delete capitalColorOverrides[countryName];
        } else {
          capitalColorOverrides[countryName] = nextMode;
        }
        if (lastCountryCapitalData && typeof lastCountryCapitalData === 'object') {
          updateCountryCapitals(lastCountryCapitalData);
        }
        persistCapitalColorModes().catch(error => {
          console.warn('[OverlayManager] Failed to persist capital color overrides', error);
        });
      }

      function mcToMapCoords(mcX, mcZ) {
        if (typeof mcX !== 'number' || typeof mcZ !== 'number') {
          return null;
        }

        const relativeX = mcX - MC_BOUNDS.minX;
        const relativeZ = mcZ - MC_BOUNDS.minZ;

        const mapX = relativeX * SCALE_X;
        const mapY = imageHeightValue - (relativeZ * SCALE_Y);

        if (!Number.isFinite(mapX) || !Number.isFinite(mapY)) {
          return null;
        }

        return [mapY, mapX];
      }

      let focusPulseLayer = null;
      let focusPulseTimer = null;

      function pulseAt(coords) {
        const map = overlayApi?.map;
        if (!map || !coords || typeof L === 'undefined') {
          return;
        }

        if (focusPulseTimer) {
          window.clearTimeout(focusPulseTimer);
          focusPulseTimer = null;
        }

        if (focusPulseLayer) {
          try {
            map.removeLayer(focusPulseLayer);
          } catch (error) {
            // ignore
          }
          focusPulseLayer = null;
        }

        focusPulseLayer = L.circleMarker(coords, {
          radius: 10,
          color: '#38bdf8',
          weight: 3,
          opacity: 0.9,
          fillColor: '#38bdf8',
          fillOpacity: 0.18
        }).addTo(map);

        focusPulseTimer = window.setTimeout(() => {
          if (!focusPulseLayer) {
            return;
          }
          try {
            map.removeLayer(focusPulseLayer);
          } catch (error) {
            // ignore
          }
          focusPulseLayer = null;
          focusPulseTimer = null;
        }, 1200);
      }

      function focusMc(mcX, mcZ, options = {}) {
        const map = overlayApi?.map;
        if (!map) {
          return false;
        }

        const coords = mcToMapCoords(mcX, mcZ);
        if (!coords) {
          return false;
        }

        const requestedZoom = Number(options?.zoom);
        const zoom = Number.isFinite(requestedZoom) ? requestedZoom : Math.min(map.getMaxZoom?.() ?? 2, 2);
        map.setView(coords, zoom, { animate: true });
        pulseAt(coords);
        return true;
      }

      overlayApi.mcToMapCoords = mcToMapCoords;
      overlayApi.focusMc = focusMc;

      function clearOverlay(key) {
        overlayContent[key].forEach(layer => {
          overlayLayers[key].removeLayer(layer);
        });
        overlayContent[key] = [];
      }

      function bindPopup(layer, heading, details) {
        const parts = [];
        if (heading) {
          parts.push(`<strong>${heading}</strong>`);
        }
        if (details) {
          parts.push(details);
        }
        if (parts.length) {
          layer.bindPopup(parts.join(''));
        }
      }

      function escapeHtml(value) {
        return String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function getParsers() {
        const parsers = window.DynmapDescParsers;
        if (!parsers || typeof parsers !== 'object') {
          return {
            stripHtml: (value) => (typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : ''),
            extractPrimaryNameFromDesc: () => null
          };
        }
        return {
          stripHtml: typeof parsers.stripHtml === 'function' ? parsers.stripHtml : (value) => String(value ?? ''),
          extractPrimaryNameFromDesc: typeof parsers.extractPrimaryNameFromDesc === 'function' ? parsers.extractPrimaryNameFromDesc : () => null
        };
      }

      function isLikelyInternalIdLabel(labelText, areaId) {
        const value = String(labelText ?? '').trim();
        if (!value) {
          return false;
        }

        const normalized = value.replace(/\s+/g, '');
        const normalizedAreaId = String(areaId ?? '').trim().replace(/\s+/g, '');
        if (normalizedAreaId && normalized.toLowerCase() === normalizedAreaId.toLowerCase()) {
          return true;
        }

        // ULID (26 chars Crockford base32), optionally with a suffix like "_world".
        if (/^[0-9A-HJKMNP-TV-Z]{26}(?:_[A-Za-z0-9-]+)?$/i.test(normalized)) {
          return true;
        }

        // UUID (common internal identifier format).
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)) {
          return true;
        }

        return false;
      }

      function getAreaDisplayName(areaId, area) {
        if (!area || typeof area !== 'object') {
          return '';
        }

        const { stripHtml, extractPrimaryNameFromDesc } = getParsers();

        const primaryName =
          extractPrimaryNameFromDesc(area?.markup) ||
          extractPrimaryNameFromDesc(area?.desc) ||
          extractPrimaryNameFromDesc(area?.label);
        const cleanedPrimary = stripHtml(primaryName);
        if (cleanedPrimary && !isLikelyInternalIdLabel(cleanedPrimary, areaId)) {
          return cleanedPrimary;
        }

        const cleanedLabel = stripHtml(area?.label);
        if (cleanedLabel && !isLikelyInternalIdLabel(cleanedLabel, areaId)) {
          return cleanedLabel;
        }

        return '';
      }

      function getAreaPopupHeading(areaId, area) {
        return getAreaDisplayName(areaId, area);
      }

      function updateTerritoryMarkers(markers) {
        clearOverlay('territoryMarkers');

        if (!markers || typeof markers !== 'object') {
          return;
        }

        Object.entries(markers).forEach(([markerId, marker]) => {
          const coords = mcToMapCoords(marker?.x, marker?.z);
          if (!coords) {
            return;
          }

          const markerLayer = L.circleMarker(coords, {
            radius: 5,
            color: '#0ea5e9',
            fillColor: '#38bdf8',
            fillOpacity: 0.72,
            weight: 2
          });
          bindPopup(markerLayer, marker?.label || markerId, marker?.desc);
          overlayLayers.territoryMarkers.addLayer(markerLayer);
          overlayContent.territoryMarkers.push(markerLayer);
        });
      }

      function updateTerritoryAreas(areas) {
        clearOverlay('territoryAreas');

        if (!areas || typeof areas !== 'object') {
          return;
        }

        Object.entries(areas).forEach(([areaId, area]) => {
          if (!area || !Array.isArray(area.x) || !Array.isArray(area.z) || area.x.length !== area.z.length) {
            return;
          }

          const latLngs = area.x.map((xCoord, idx) => mcToMapCoords(xCoord, area.z[idx])).filter(Boolean);
          if (latLngs.length < 3) {
            return;
          }

          const polygon = L.polygon(latLngs, {
            color: area.color || DEFAULT_TERRITORY_STROKE_COLOR,
            fillColor: area.fillcolor || DEFAULT_TERRITORY_FILL_COLOR,
            fillOpacity: area.fillopacity ?? 0.25,
            weight: area.weight ?? 1,
            opacity: area.opacity ?? 1
          });
          // Don't show internal area IDs by default; prefer the configured label.
          bindPopup(polygon, getAreaPopupHeading(areaId, area), area?.desc);
          overlayLayers.territoryAreas.addLayer(polygon);
          overlayContent.territoryAreas.push(polygon);

        });
      }

      function updateCountrySpawn(countrySpawn) {
        clearOverlay('countrySpawn');

        if (!countrySpawn || typeof countrySpawn !== 'object') {
          return;
        }

        Object.entries(countrySpawn).forEach(([countryName, data]) => {
          const spawns = Array.isArray(data?.spawns) ? data.spawns : [];
          spawns.forEach(spawn => {
            const coords = mcToMapCoords(spawn?.x, spawn?.z);
            if (!coords) {
              return;
            }
            const spawnMarker = L.circleMarker(coords, {
              radius: 6,
              color: '#f59e0b',
              fillColor: '#fbbf24',
              fillOpacity: 0.8,
              weight: 2
            });
            bindPopup(spawnMarker, `${countryName} 出生点`, `${spawn?.name || ''}`);
            overlayLayers.countrySpawn.addLayer(spawnMarker);
            overlayContent.countrySpawn.push(spawnMarker);
          });
        });
      }

      function updateCountryCapitalsSpawn(countryCapitalsSpawn) {
        clearOverlay('countryCapitalsSpawn');

        if (!countryCapitalsSpawn || typeof countryCapitalsSpawn !== 'object') {
          return;
        }

        Object.entries(countryCapitalsSpawn).forEach(([countryName, data]) => {
          const spawns = Array.isArray(data?.spawns) ? data.spawns : [];
          spawns.forEach(spawn => {
            const coords = mcToMapCoords(spawn?.x, spawn?.z);
            if (!coords) {
              return;
            }
            const spawnMarker = L.circleMarker(coords, {
              radius: 6,
              color: '#7c3aed',
              fillColor: '#a855f7',
              fillOpacity: 0.72,
              weight: 2
            });
            bindPopup(spawnMarker, `${countryName} 首都出生点`, `${spawn?.name || ''}`);
            overlayLayers.countryCapitalsSpawn.addLayer(spawnMarker);
            overlayContent.countryCapitalsSpawn.push(spawnMarker);
          });
        });
      }

      function updateCountryAreas(countryAreas) {
        clearOverlay('countryAreas');

        lastCountryAreasData = countryAreas && typeof countryAreas === 'object' ? countryAreas : {};

        if (!countryAreas || typeof countryAreas !== 'object') {
          return;
        }

        Object.entries(countryAreas).forEach(([countryName, areaMap]) => {
          if (!areaMap || typeof areaMap !== 'object') {
            return;
          }

          const strokeColor = getCountryColor(countryName) || DEFAULT_TERRITORY_STROKE_COLOR;
          Object.entries(areaMap).forEach(([areaId, area]) => {
            if (!area || !Array.isArray(area.x) || !Array.isArray(area.z) || area.x.length !== area.z.length) {
              return;
            }

            const latLngs = area.x.map((xCoord, idx) => mcToMapCoords(xCoord, area.z[idx])).filter(Boolean);
            if (latLngs.length < 3) {
              return;
            }

            const polygon = L.polygon(latLngs, {
              color: strokeColor,
              fillColor: strokeColor,
              fillOpacity: 0.18,
              weight: 2
            });
            const areaName = getAreaDisplayName(areaId, area);
            const heading = areaName ? `${countryName} - ${areaName}` : countryName;
            bindPopup(polygon, heading, area?.desc);
            overlayLayers.countryAreas.addLayer(polygon);
            overlayContent.countryAreas.push(polygon);
          });
        });
      }

      function buildCapitalPopup(countryName, capitalName) {
        const mode = getCapitalColorMode(countryName);
        const nextMode = mode === 'green' ? 'red' : 'green';
        const buttonText = nextMode === 'green' ? '切换为绿色' : '恢复红色';

        return `
          <div class="capital-desc"><strong>${capitalName}</strong></div>
          <div class="capital-popup-controls">
            <button class="capital-color-toggle" data-next-mode="${nextMode}" onclick="window.toggleCapitalColorMode && window.toggleCapitalColorMode('${countryName.replace(/'/g, '\\\\\'')}')">${buttonText}</button>
          </div>
        `;
      }

      function updateCountryCapitals(countryCapitals) {
        clearOverlay('countryCapitals');

        lastCountryCapitalData = countryCapitals && typeof countryCapitals === 'object' ? countryCapitals : {};

        if (!countryCapitals || typeof countryCapitals !== 'object') {
          return;
        }

        Object.entries(countryCapitals).forEach(([countryName, capitalInfo]) => {
          const capitalName = capitalInfo?.name || countryName;
          const areas = capitalInfo?.areas;
          if (!areas || typeof areas !== 'object') {
            return;
          }

          const scheme = getCapitalColorScheme(countryName);
          Object.entries(areas).forEach(([areaId, area]) => {
            if (!area || !Array.isArray(area.x) || !Array.isArray(area.z) || area.x.length !== area.z.length) {
              return;
            }

            const latLngs = area.x.map((xCoord, idx) => mcToMapCoords(xCoord, area.z[idx])).filter(Boolean);
            if (latLngs.length < 3) {
              return;
            }

            const polygon = L.polygon(latLngs, {
              color: scheme.stroke,
              fillColor: scheme.fill,
              fillOpacity: 0.24,
              weight: 3
            });

            const popup = buildCapitalPopup(countryName, capitalName);
            bindPopup(polygon, `${countryName} 首都`, popup);
            overlayLayers.countryCapitals.addLayer(polygon);
            overlayContent.countryCapitals.push(polygon);

            const bounds = polygon.getBounds();
            const center = bounds.getCenter();
            const labelLayer = L.tooltip({
              permanent: true,
              direction: 'center',
              className: `capital-label ${scheme.labelClass}`,
              opacity: 1
            })
              .setContent(capitalName)
              .setLatLng(center);

            overlayLayers.countryCapitals.addLayer(labelLayer);
            overlayContent.countryCapitals.push(labelLayer);
          });
        });
      }

      function applyData(detail) {
        updateTerritoryMarkers(detail.markers || {});
        updateTerritoryAreas(detail.areas || {});
        updateCountrySpawn(detail.countrySpawn || {});
        updateCountryCapitalsSpawn(detail.countryCapitalsSpawn || {});
        updateCountryAreas(detail.countryAreas || {});
        updateCountryCapitals(detail.countryCapitals || {});
      }

      window.toggleCapitalColorMode = toggleCapitalColorMode;

      loadCapitalColorModes().finally(() => {
        if (lastCountryCapitalData && typeof lastCountryCapitalData === 'object') {
          updateCountryCapitals(lastCountryCapitalData);
        }
      });

      async function loadFromStorage() {
        if (!window.IndexedDBStorage || typeof window.IndexedDBStorage.getItem !== 'function') {
          applyData({});
          return;
        }

        const storageKeys = ['landMarkers', 'landAreas', 'countrySpawn', 'countryCapitalsSpawn', 'countryAreas', 'countryCapitals', 'capitalColorModes'];
        const results = await Promise.all(storageKeys.map(key => window.IndexedDBStorage.getItem(key)));
        const parsed = {};
        storageKeys.forEach((key, index) => {
          const raw = results[index];
          if (!raw) {
            parsed[key] = null;
            return;
          }
          try {
            parsed[key] = JSON.parse(raw);
          } catch (error) {
            console.warn('[OverlayManager] Failed to parse stored data for', key, error);
            parsed[key] = null;
          }
        });

        applyData({
          markers: parsed.landMarkers,
          areas: parsed.landAreas,
          countrySpawn: parsed.countrySpawn,
          countryCapitalsSpawn: parsed.countryCapitalsSpawn,
          countryAreas: parsed.countryAreas,
          countryCapitals: parsed.countryCapitals,
          capitalColorModes: parsed.capitalColorModes || {}
        });
      }

      document.addEventListener('dynmap:data-updated', event => {
        applyData(event.detail || {});
      });

      loadFromStorage();
    })();

    window.DynmapOverlayExport?.init?.();
  }

  window.DynmapOverlayManager = Object.freeze({ init });
})();
