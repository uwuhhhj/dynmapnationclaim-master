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
      imageSize: { width: imageWidth, height: imageHeight }
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
              color: area?.color || '#34d399',
              weight: area?.weight ?? 2,
              fillColor: area?.fillcolor || area?.color || '#34d399',
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
          (data?.spawns || []).forEach(spawn => {
            const coords = mcToMapCoords(spawn?.x, spawn?.z);
            if (!coords) {
              return;
            }

            const spawnMarker = L.circleMarker(coords, {
              radius: 5,
              weight: 2,
              color: '#facc15',
              fillColor: '#facc15',
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

        if (!countryAreas || typeof countryAreas !== 'object') {
          return;
        }

        Object.entries(countryAreas).forEach(([countryName, areas]) => {
          Object.entries(areas || {}).forEach(([areaId, area]) => {
            if (!Array.isArray(area?.x) || !Array.isArray(area?.z) || area.x.length !== area.z.length || !area.x.length) {
              return;
            }

            const latLngs = area.x.map((xCoord, idx) => mcToMapCoords(xCoord, area.z[idx])).filter(Boolean);
            if (!latLngs.length) {
              return;
            }

            const polygon = L.polygon(latLngs, {
              color: '#f97316',
              weight: area?.weight ?? 2,
              fillColor: '#fb923c',
              fillOpacity: 0.2
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
        updateCountrySpawns(detail.countrySpawn || {});
        updateCountryCapitalSpawns(detail.countryCapitalsSpawn || {});
        updateCountryAreas(detail.countryAreas || {});
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
