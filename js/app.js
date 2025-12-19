    const imageHeight = 1688;
    const imageWidth = 1570;
    const imageBounds = [[0, 0], [imageHeight, imageWidth]];

    const map = L.map('map', {
      crs: L.CRS.Simple,
      center: [838 / 2, 838 / 2],
      zoom: -1,
      minZoom: -3,
      maxZoom: 5
    });

    const baseLayer = L.imageOverlay('tiles/map_low.png', imageBounds);
    baseLayer.addTo(map);
    map.fitBounds(imageBounds);

    const overlayLayers = {
      territoryMarkers: L.layerGroup(),
      territoryAreas: L.layerGroup(),
      countrySpawn: L.layerGroup(),
      countryAreas: L.layerGroup(),
      countryCapitals: L.layerGroup(),
      countryCapitalsSpawn: L.layerGroup()
    };
    //默认不加载图层
    //Object.values(overlayLayers).forEach(layer => layer.addTo(map));

    const baseLayers = {
      'Dynmap 底图': baseLayer
    };

    const overlayControl = L.control.layers(baseLayers, {
      '领地标记（点）': overlayLayers.territoryMarkers,
      '领地区域（面）': overlayLayers.territoryAreas,
      '国家出生点（点）': overlayLayers.countrySpawn,
      '国家区域（面）': overlayLayers.countryAreas,
      '国家首都': overlayLayers.countryCapitals,
      '首都出生点（点）': overlayLayers.countryCapitalsSpawn
    }, {
      position: 'topleft'
    }).addTo(map);

    window.DynmapOverlayLayers = {
      map,
      baseLayer,
      overlayLayers,
      overlayControl,
      imageSize: { width: imageWidth, height: imageHeight },
      imageBounds: L.latLngBounds(imageBounds)
    };

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
          return [r, g, b].map(part => part.toString(16).padStart(2, '0')).join('');
        }

        let hex = raw;
        if (hex.startsWith('#')) {
          hex = hex.slice(1);
        } else if (hex.startsWith('0x')) {
          hex = hex.slice(2);
        }

        if (/^[0-9a-f]{3}$/i.test(hex)) {
          hex = hex.split('').map(ch => ch + ch).join('');
        } else if (/^[0-9a-f]{8}$/i.test(hex)) {
          hex = hex.slice(0, 6);
        }

        return /^[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : '';
      }

      function isSameHexColor(value, expected) {
        const valueHex = toHex6(value);
        const expectedHex = toHex6(expected);
        if (!valueHex || !expectedHex) {
          return false;
        }
        return valueHex === expectedHex;
      }

      function hashHue(value) {
        const str = String(value ?? '');
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
        }
        return hash % 360;
      }

      function getCountryColorScheme(countryName) {
        const key = String(countryName ?? '');
        if (countryColorCache[key]) {
          return countryColorCache[key];
        }
        const hue = hashHue(key);
        const scheme = {
          stroke: `hsl(${hue}, 78%, 38%)`,
          fill: `hsl(${hue}, 78%, 55%)`
        };
        countryColorCache[key] = scheme;
        return scheme;
      }

      function getCountryOverlayScheme(countryName) {
        const fallback = getCountryColorScheme(countryName);
        if (!lastCountryAreasData || typeof lastCountryAreasData !== 'object') {
          return fallback;
        }

        const areas = lastCountryAreasData[countryName];
        if (!areas || typeof areas !== 'object') {
          return fallback;
        }

        for (const area of Object.values(areas)) {
          if (!area || typeof area !== 'object') {
            continue;
          }

          const strokeSource = area?.color;
          const fillSource = area?.fillcolor || area?.color;
          const isDefaultStroke = !strokeSource || isSameHexColor(strokeSource, DEFAULT_TERRITORY_STROKE_COLOR);
          const isDefaultFill = !fillSource ||
            isSameHexColor(fillSource, DEFAULT_TERRITORY_FILL_COLOR) ||
            isSameHexColor(fillSource, DEFAULT_TERRITORY_STROKE_COLOR);
          const useCountryColor = isDefaultStroke && isDefaultFill;

          if (!useCountryColor) {
            return {
              stroke: area?.color || area?.fillcolor || DEFAULT_TERRITORY_STROKE_COLOR,
              fill: area?.fillcolor || area?.color || DEFAULT_TERRITORY_FILL_COLOR
            };
          }
        }

        return fallback;
      }

      function syncCapitalColorOverrides(modes) {
        const source = modes && typeof modes === 'object' ? modes : {};

        Object.keys(capitalColorOverrides).forEach(country => {
          if (!Object.prototype.hasOwnProperty.call(source, country)) {
            delete capitalColorOverrides[country];
          }
        });

        Object.entries(source).forEach(([country, mode]) => {
          if (typeof mode === 'string' && CAPITAL_COLOR_SCHEMES[mode]) {
            capitalColorOverrides[country] = mode;
          }
        });
      }

      function persistCapitalColorModes() {
        if (!window.IndexedDBStorage || typeof window.IndexedDBStorage.setItem !== 'function') {
          return Promise.resolve();
        }

        const serializable = Object.fromEntries(Object.entries(capitalColorOverrides));
        return window.IndexedDBStorage.setItem(CAPITAL_COLOR_STORAGE_KEY, serializable);
      }

      function getCapitalColorMode(countryName) {
        if (!countryName) {
          return 'red';
        }
        const override = capitalColorOverrides[countryName];
        return override && CAPITAL_COLOR_SCHEMES[override] ? override : 'red';
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
            radius: 4,
            weight: 1,
            color: '#38bdf8',
            fillColor: '#38bdf8',
            fillOpacity: 0.85
          });

          bindPopup(markerLayer, marker?.label || markerId, marker?.desc);
          overlayLayers.territoryMarkers.addLayer(markerLayer);
          overlayContent.territoryMarkers.push(markerLayer);
        });
      }

      function updateTerritoryAreas(areas) {
        clearOverlay('territoryAreas');

        if (areas && typeof areas === 'object') {
          Object.entries(areas).forEach(([areaId, area]) => {
            if (!Array.isArray(area?.x) || !Array.isArray(area?.z) || area.x.length !== area.z.length || !area.x.length) {
              return;
            }

            const latLngs = area.x.map((xCoord, idx) => mcToMapCoords(xCoord, area.z[idx])).filter(Boolean);
            if (!latLngs.length) {
              return;
            }

            const polygon = L.polygon(latLngs, {
              color: area?.color || DEFAULT_TERRITORY_STROKE_COLOR,
              weight: area?.weight ?? 2,
              fillColor: area?.fillcolor || area?.color || DEFAULT_TERRITORY_FILL_COLOR,
              fillOpacity: area?.fillopacity ?? 0.3
            });

            bindPopup(polygon, area?.label || areaId, area?.desc);
            overlayLayers.territoryAreas.addLayer(polygon);
            overlayContent.territoryAreas.push(polygon);
          });
        }

        if (window.TownAreasLayer && typeof window.TownAreasLayer.createTownLayer === 'function') {
          const townLayer = window.TownAreasLayer.createTownLayer();
          if (townLayer) {
            overlayLayers.territoryAreas.addLayer(townLayer);
            overlayContent.territoryAreas.push(townLayer);
          }
        }
      }

      function updateCountrySpawns(countrySpawn) {
        clearOverlay('countrySpawn');

        if (!countrySpawn || typeof countrySpawn !== 'object') {
          return;
        }

        Object.entries(countrySpawn).forEach(([countryName, data]) => {
          const scheme = getCountryOverlayScheme(countryName);
          (data?.spawns || []).forEach(spawn => {
            const coords = mcToMapCoords(spawn?.x, spawn?.z);
            if (!coords) {
              return;
            }

            const spawnMarker = L.circleMarker(coords, {
              radius: 5,
              weight: 2,
              color: scheme.stroke,
              fillColor: scheme.fill,
              fillOpacity: 0.9
            });

            bindPopup(spawnMarker, countryName, spawn?.name);
            overlayLayers.countrySpawn.addLayer(spawnMarker);
            overlayContent.countrySpawn.push(spawnMarker);
          });
        });
      }

      function updateCountryCapitalSpawns(countryCapitalsSpawn) {
        clearOverlay('countryCapitalsSpawn');

        if (!countryCapitalsSpawn || typeof countryCapitalsSpawn !== 'object') {
          return;
        }

        Object.entries(countryCapitalsSpawn).forEach(([countryName, data]) => {
          (data?.spawns || []).forEach(spawn => {
            const coords = mcToMapCoords(spawn?.x, spawn?.z);
            if (!coords) {
              return;
            }

            const spawnMarker = L.circleMarker(coords, {
              radius: 6,
              weight: 2,
              color: '#a855f7',
              fillColor: '#a855f7',
              fillOpacity: 0.95
            });

            const details = spawn?.name ? `首都：${spawn.name}` : '首都出生点';
            bindPopup(spawnMarker, countryName, details);
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

        Object.entries(countryAreas).forEach(([countryName, areas]) => {
          const countryScheme = getCountryColorScheme(countryName);
          Object.entries(areas || {}).forEach(([areaId, area]) => {
            if (!Array.isArray(area?.x) || !Array.isArray(area?.z) || area.x.length !== area.z.length || !area.x.length) {
              return;
            }

            const latLngs = area.x.map((xCoord, idx) => mcToMapCoords(xCoord, area.z[idx])).filter(Boolean);
            if (!latLngs.length) {
              return;
            }

            const strokeSource = area?.color;
            const fillSource = area?.fillcolor || area?.color;
            const isDefaultStroke = !strokeSource || isSameHexColor(strokeSource, DEFAULT_TERRITORY_STROKE_COLOR);
            const isDefaultFill = !fillSource ||
              isSameHexColor(fillSource, DEFAULT_TERRITORY_FILL_COLOR) ||
              isSameHexColor(fillSource, DEFAULT_TERRITORY_STROKE_COLOR);
            const useCountryColor = isDefaultStroke && isDefaultFill;

            const strokeColor = useCountryColor
              ? countryScheme.stroke
              : (area?.color || area?.fillcolor || DEFAULT_TERRITORY_STROKE_COLOR);
            const fillColor = useCountryColor
              ? countryScheme.fill
              : (area?.fillcolor || area?.color || DEFAULT_TERRITORY_FILL_COLOR);

            const polygon = L.polygon(latLngs, {
              color: strokeColor,
              weight: area?.weight ?? 2,
              fillColor: fillColor,
              fillOpacity: area?.fillopacity ?? 0.2
            });

            const heading = area?.label ? `${countryName} · ${area.label}` : countryName;
            bindPopup(polygon, heading, area?.desc);
            overlayLayers.countryAreas.addLayer(polygon);
            overlayContent.countryAreas.push(polygon);
          });
        });
      }

      function updateCountryCapitals(countryCapitals) {
        clearOverlay('countryCapitals');

        lastCountryCapitalData = countryCapitals && typeof countryCapitals === 'object' ? countryCapitals : {};

        if (!countryCapitals || typeof countryCapitals !== 'object') {
          return;
        }

        Object.entries(countryCapitals).forEach(([countryName, capitalInfo]) => {
          const capitalAreas = capitalInfo?.areas || {};
          const capitalName = capitalInfo?.name || countryName;
          const colorMode = getCapitalColorMode(countryName);
          const colorScheme = CAPITAL_COLOR_SCHEMES[colorMode] || CAPITAL_COLOR_SCHEMES.red;
          const nextMode = colorMode === 'green' ? 'red' : 'green';
          const toggleLabel = colorMode === 'green' ? '切换回红色' : '切换为绿色';

          Object.entries(capitalAreas).forEach(([areaId, area]) => {
            if (!Array.isArray(area?.x) || !Array.isArray(area?.z) || area.x.length !== area.z.length || !area.x.length) {
              return;
            }

            const latLngs = area.x.map((xCoord, idx) => mcToMapCoords(xCoord, area.z[idx])).filter(Boolean);
            if (!latLngs.length) {
              return;
            }

            const polygon = L.polygon(latLngs, {
              color: colorScheme.stroke,
              weight: area?.weight ?? 3,
              fillColor: colorScheme.fill,
              fillOpacity: 0.35
            });

            const heading = capitalName ? `${countryName} · ${capitalName}` : countryName;

            const detailsParts = [];
            if (area?.desc) {
              detailsParts.push(`<div class="capital-desc">${area.desc}</div>`);
            }
            detailsParts.push(`<div class="capital-popup-controls"><button type="button" class="capital-color-toggle" data-next-mode="${nextMode}">${toggleLabel}</button></div>`);

            bindPopup(polygon, heading, detailsParts.join(''));
            polygon.bindTooltip(countryName, {
              permanent: true,
              direction: 'center',
              className: `capital-label ${colorScheme.labelClass}`,
              opacity: 1
            });
            polygon.on('popupopen', event => {
              const popupElement = event.popup.getElement();
              if (!popupElement) {
                return;
              }
              const toggleButton = popupElement.querySelector('.capital-color-toggle');
              if (!toggleButton) {
                return;
              }
              toggleButton.addEventListener('click', clickEvent => {
                clickEvent.preventDefault();
                clickEvent.stopPropagation();
                toggleCapitalColorMode(countryName);
              }, { once: true });
            });

            overlayLayers.countryCapitals.addLayer(polygon);
            overlayContent.countryCapitals.push(polygon);
          });
        });
      }

      function applyData(detail = {}) {
        if (Object.prototype.hasOwnProperty.call(detail, 'capitalColorModes')) {
          syncCapitalColorOverrides(detail.capitalColorModes);
        }
        updateTerritoryMarkers(detail.markers || {});
        updateTerritoryAreas(detail.areas || {});
        updateCountryAreas(detail.countryAreas || {});
        updateCountrySpawns(detail.countrySpawn || {});
        updateCountryCapitalSpawns(detail.countryCapitalsSpawn || {});
        updateCountryCapitals(detail.countryCapitals || {});
      }

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

    (function () {
      const overlayApi = window.DynmapOverlayLayers;
      const map = overlayApi?.map;
      if (!overlayApi || !map) {
        return;
      }

      const { overlayLayers } = overlayApi;
      const crs = map.options?.crs || L.CRS.Simple;
      const fullImageBounds = overlayApi.imageBounds || L.latLngBounds([[0, 0], [overlayApi?.imageSize?.height ?? 0, overlayApi?.imageSize?.width ?? 0]]);
      const MAX_EXPORT_DIMENSION = 8192;

      const overlayActivationOrder = [];

      function resolveOverlayKey(layer) {
        if (!overlayLayers || !layer) {
          return null;
        }
        for (const [key, group] of Object.entries(overlayLayers)) {
          if (group === layer) {
            return key;
          }
        }
        return null;
      }

      function removeFromOrder(key) {
        const index = overlayActivationOrder.indexOf(key);
        if (index >= 0) {
          overlayActivationOrder.splice(index, 1);
        }
      }

      map.on('overlayadd', event => {
        const key = resolveOverlayKey(event?.layer);
        if (!key) {
          return;
        }
        removeFromOrder(key);
        overlayActivationOrder.push(key);
      });

      map.on('overlayremove', event => {
        const key = resolveOverlayKey(event?.layer);
        if (!key) {
          return;
        }
        removeFromOrder(key);
      });

      function getActiveOverlayKeysInOrder() {
        if (!overlayLayers) {
          return [];
        }

        const activeKeys = Object.entries(overlayLayers)
          .filter(([, group]) => map.hasLayer(group))
          .map(([key]) => key);

        if (!activeKeys.length) {
          return [];
        }

        const ordered = overlayActivationOrder.filter(key => activeKeys.includes(key));
        activeKeys.forEach(key => {
          if (!ordered.includes(key)) {
            ordered.push(key);
          }
        });

        return ordered;
      }

      function extendBoundsFromLayer(bounds, layer) {
        if (!layer) {
          return;
        }

        if (typeof layer.eachLayer === 'function' && !(layer instanceof L.Path) && !(layer instanceof L.Marker)) {
          layer.eachLayer(child => extendBoundsFromLayer(bounds, child));
          return;
        }

        if (typeof layer.getBounds === 'function') {
          try {
            const layerBounds = layer.getBounds();
            if (layerBounds && typeof layerBounds.isValid === 'function' && layerBounds.isValid()) {
              bounds.extend(layerBounds);
              return;
            }
          } catch (error) {
            // ignore bounds extraction errors
          }
        }

        if (typeof layer.getLatLng === 'function') {
          try {
            bounds.extend(layer.getLatLng());
          } catch (error) {
            // ignore
          }
        }
      }

      function getActiveOverlayBounds(keys) {
        const bounds = L.latLngBounds([]);

        keys.forEach(key => {
          const group = overlayLayers?.[key];
          if (!group || typeof group.eachLayer !== 'function') {
            return;
          }
          group.eachLayer(layer => extendBoundsFromLayer(bounds, layer));
        });

        return bounds.isValid() ? bounds : null;
      }

      function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
      }

      function normalizePointBounds(bounds, zoom) {
        const nw = crs.latLngToPoint(bounds.getNorthWest(), zoom);
        const se = crs.latLngToPoint(bounds.getSouthEast(), zoom);

        const minX = Math.min(nw.x, se.x);
        const maxX = Math.max(nw.x, se.x);
        const minY = Math.min(nw.y, se.y);
        const maxY = Math.max(nw.y, se.y);

        return {
          min: L.point(minX, minY),
          max: L.point(maxX, maxY)
        };
      }

      function intersectPointBounds(a, b) {
        const minX = Math.max(a.min.x, b.min.x);
        const minY = Math.max(a.min.y, b.min.y);
        const maxX = Math.min(a.max.x, b.max.x);
        const maxY = Math.min(a.max.y, b.max.y);

        if (maxX <= minX || maxY <= minY) {
          return null;
        }

        return {
          min: L.point(minX, minY),
          max: L.point(maxX, maxY)
        };
      }

      function pointBoundsToLatLngBounds(pointBounds, zoom) {
        const a = crs.pointToLatLng(pointBounds.min, zoom);
        const b = crs.pointToLatLng(pointBounds.max, zoom);
        return L.latLngBounds(a, b);
      }

      function computeExportBounds(options = {}) {
        const zoom = 0;
        const fullPointBounds = normalizePointBounds(fullImageBounds, zoom);

        if (options?.topLeft) {
          const topLeft = Array.isArray(options.topLeft) ? L.latLng(options.topLeft[0], options.topLeft[1]) : L.latLng(options.topLeft);
          const topLeftPointRaw = crs.latLngToPoint(topLeft, zoom);
          const topLeftPoint = L.point(
            clamp(topLeftPointRaw.x, fullPointBounds.min.x, fullPointBounds.max.x),
            clamp(topLeftPointRaw.y, fullPointBounds.min.y, fullPointBounds.max.y)
          );

          const maxWidth = Number(options?.maxWidth);
          const maxHeight = Number(options?.maxHeight);
          const remainingWidth = fullPointBounds.max.x - topLeftPoint.x;
          const remainingHeight = fullPointBounds.max.y - topLeftPoint.y;

          const width = Number.isFinite(maxWidth) && maxWidth > 0 ? Math.min(maxWidth, remainingWidth) : remainingWidth;
          const height = Number.isFinite(maxHeight) && maxHeight > 0 ? Math.min(maxHeight, remainingHeight) : remainingHeight;

          const bottomRightPoint = L.point(topLeftPoint.x + width, topLeftPoint.y + height);
          return pointBoundsToLatLngBounds({ min: topLeftPoint, max: bottomRightPoint }, zoom);
        }

        const activeKeys = getActiveOverlayKeysInOrder();
        const overlayBounds = getActiveOverlayBounds(activeKeys);
        if (!overlayBounds) {
          return null;
        }

        const paddingPx = Number(options?.paddingPx);
        const padding = Number.isFinite(paddingPx) ? Math.max(0, paddingPx) : 16;

        const overlayPointBounds = normalizePointBounds(overlayBounds, zoom);
        const paddedPointBounds = {
          min: L.point(overlayPointBounds.min.x - padding, overlayPointBounds.min.y - padding),
          max: L.point(overlayPointBounds.max.x + padding, overlayPointBounds.max.y + padding)
        };

        const clipped = intersectPointBounds(paddedPointBounds, fullPointBounds);
        if (!clipped) {
          return null;
        }

        return pointBoundsToLatLngBounds(clipped, zoom);
      }

      function cloneLeafletLayer(layer) {
        if (!layer) {
          return null;
        }

        if (layer instanceof L.LayerGroup || layer instanceof L.FeatureGroup) {
          const group = L.layerGroup();
          layer.eachLayer(child => {
            const clonedChild = cloneLeafletLayer(child);
            if (clonedChild) {
              group.addLayer(clonedChild);
            }
          });
          return group;
        }

        if (layer instanceof L.Marker) {
          return L.marker(layer.getLatLng(), { ...layer.options, icon: layer.options?.icon });
        }

        if (layer instanceof L.Circle) {
          return L.circle(layer.getLatLng(), { ...layer.options, radius: layer.getRadius() });
        }

        if (layer instanceof L.CircleMarker) {
          return L.circleMarker(layer.getLatLng(), { ...layer.options });
        }

        if (layer instanceof L.Polygon) {
          return L.polygon(layer.getLatLngs(), { ...layer.options });
        }

        if (layer instanceof L.Polyline) {
          return L.polyline(layer.getLatLngs(), { ...layer.options });
        }

        if (typeof layer.toGeoJSON === 'function') {
          try {
            return L.geoJSON(layer.toGeoJSON(), {
              style: () => ({ ...layer.options }),
              pointToLayer: (feature, latlng) => L.circleMarker(latlng, { ...layer.options })
            });
          } catch (error) {
            return null;
          }
        }

        return null;
      }

      function mirrorPanes(sourceMap, targetMap) {
        if (!sourceMap || !targetMap || typeof sourceMap.getPanes !== 'function') {
          return;
        }

        const panes = sourceMap.getPanes();
        Object.entries(panes).forEach(([name, element]) => {
          if (!name || !element || targetMap.getPane(name)) {
            return;
          }

          try {
            const pane = targetMap.createPane(name);
            if (element.style?.zIndex) {
              pane.style.zIndex = element.style.zIndex;
            }
          } catch (error) {
            // ignore panes that cannot be created
          }
        });
      }

      async function waitForNextFrame() {
        await new Promise(resolve => requestAnimationFrame(() => resolve()));
      }

      async function exportOverlayImage(options = {}) {
        if (typeof html2canvas !== 'function') {
          if (typeof displayStorageStatus === 'function') {
            displayStorageStatus('error', '导出失败：缺少 html2canvas');
          }
          return;
        }

        const activeKeys = getActiveOverlayKeysInOrder();
        if (!activeKeys.length) {
          if (typeof displayStorageStatus === 'function') {
            displayStorageStatus('warning', '没有启用任何覆盖层，无法导出');
          }
          return;
        }

        const exportBounds = computeExportBounds(options);
        if (!exportBounds) {
          if (typeof displayStorageStatus === 'function') {
            displayStorageStatus('warning', '未能计算导出范围（覆盖层可能为空）');
          }
          return;
        }

        const zoom = 0;
        const fullPointBounds = normalizePointBounds(fullImageBounds, zoom);
        const exportPointBounds = normalizePointBounds(exportBounds, zoom);
        const clipped = intersectPointBounds(exportPointBounds, fullPointBounds);
        if (!clipped) {
          if (typeof displayStorageStatus === 'function') {
            displayStorageStatus('warning', '导出范围超出地图边界');
          }
          return;
        }

        const width = Math.ceil(clipped.max.x - clipped.min.x);
        const height = Math.ceil(clipped.max.y - clipped.min.y);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          if (typeof displayStorageStatus === 'function') {
            displayStorageStatus('error', '导出失败：无效的图片尺寸');
          }
          return;
        }

        const maxSize = Math.max(width, height);
        const minZoom = Number.isFinite(map.getMinZoom?.()) ? map.getMinZoom() : -5;
        let exportZoom = 0;
        if (maxSize > MAX_EXPORT_DIMENSION) {
          exportZoom = Math.floor(Math.log2(MAX_EXPORT_DIMENSION / maxSize));
          exportZoom = Math.max(minZoom, exportZoom);
        }

        const exportBoundsAtZoom = normalizePointBounds(normalizedBounds, exportZoom);
        const exportWidth = Math.ceil(exportBoundsAtZoom.max.x - exportBoundsAtZoom.min.x);
        const exportHeight = Math.ceil(exportBoundsAtZoom.max.y - exportBoundsAtZoom.min.y);

        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.left = '-100000px';
        container.style.top = '-100000px';
        container.style.width = `${exportWidth}px`;
        container.style.height = `${exportHeight}px`;
        container.style.background = 'transparent';
        container.style.pointerEvents = 'none';
        container.setAttribute('aria-hidden', 'true');
        document.body.appendChild(container);

        const exportMap = L.map(container, {
          crs,
          zoomControl: false,
          attributionControl: false,
          preferCanvas: true,
          zoomAnimation: false,
          fadeAnimation: false,
          markerZoomAnimation: false,
          minZoom: exportZoom,
          maxZoom: exportZoom,
          zoomSnap: 0
        });

        mirrorPanes(map, exportMap);

        const normalizedBounds = pointBoundsToLatLngBounds(clipped, zoom);
        exportMap.fitBounds(normalizedBounds, { animate: false, padding: [0, 0], maxZoom: exportZoom });

        const layerOrder = activeKeys;
        layerOrder.forEach(key => {
          const group = overlayLayers?.[key];
          if (!group) {
            return;
          }

          const groupLayers = [];
          if (typeof group.eachLayer === 'function') {
            group.eachLayer(layer => groupLayers.push(layer));
          }

          groupLayers.forEach(layer => {
            const clonedLayer = cloneLeafletLayer(layer);
            if (!clonedLayer) {
              return;
            }

            if (typeof layer.getTooltip === 'function' && typeof clonedLayer.bindTooltip === 'function') {
              const tooltip = layer.getTooltip();
              if (tooltip) {
                clonedLayer.bindTooltip(tooltip.getContent(), { ...tooltip.options });
                if (tooltip.options?.permanent && typeof clonedLayer.openTooltip === 'function') {
                  clonedLayer.openTooltip();
                }
              }
            }

            clonedLayer.addTo(exportMap);
          });
        });

        await waitForNextFrame();
        await waitForNextFrame();

        const canvas = await html2canvas(container, {
          backgroundColor: null,
          scale: 1,
          useCORS: true
        });

        exportMap.remove();
        container.remove();

        const date = new Date();
        const datePart = date.toISOString().split('T')[0];
        const modeSuffix = options?.topLeft ? 'clip' : 'full';
        const filename = `dynmap-overlays-${modeSuffix}-${datePart}.png`;

        await new Promise((resolve, reject) => {
          canvas.toBlob(blob => {
            if (!blob) {
              reject(new Error('Unable to generate PNG blob'));
              return;
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            resolve();
          }, 'image/png');
        });

        if (typeof displayStorageStatus === 'function') {
          displayStorageStatus('success', `覆盖层图片已导出：${filename}`);
        }
      }

      window.exportOverlayImage = exportOverlayImage;
    })();
