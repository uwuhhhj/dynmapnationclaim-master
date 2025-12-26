(() => {
  let initialized = false;

  function init() {
    if (initialized) {
      return;
    }
    initialized = true;

    const overlayApi = window.DynmapOverlayLayers;
    const map = overlayApi?.map;
    if (!overlayApi || !map) {
      return;
    }

    const { overlayLayers } = overlayApi;
    const crs = map.options?.crs || L.CRS.Simple;
    const fullImageBounds =
      overlayApi.imageBounds ||
      L.latLngBounds([[0, 0], [overlayApi?.imageSize?.height ?? 0, overlayApi?.imageSize?.width ?? 0]]);
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
        const topLeft = Array.isArray(options.topLeft)
          ? L.latLng(options.topLeft[0], options.topLeft[1])
          : L.latLng(options.topLeft);
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

      return null;
    }

    function cloneOverlays(keys) {
      const group = L.layerGroup();
      keys.forEach(key => {
        const source = overlayLayers?.[key];
        if (!source) {
          return;
        }
        const cloned = cloneLeafletLayer(source);
        if (cloned) {
          group.addLayer(cloned);
        }
      });
      return group;
    }

    function computeExportSize(bounds, options = {}) {
      const zoom = 0;
      const pointBounds = normalizePointBounds(bounds, zoom);
      const width = Math.ceil(pointBounds.max.x - pointBounds.min.x);
      const height = Math.ceil(pointBounds.max.y - pointBounds.min.y);

      const maxDimension = Number(options?.maxDimension);
      const limit = Number.isFinite(maxDimension)
        ? Math.min(MAX_EXPORT_DIMENSION, Math.max(1, maxDimension))
        : MAX_EXPORT_DIMENSION;

      const scale = Math.min(1, limit / Math.max(width, height));
      return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
        scale
      };
    }

    function waitForMapRender(map) {
      if (!map) {
        return Promise.resolve();
      }
      return new Promise(resolve => {
        let settled = false;
        let timer;
        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          map.off('render', finish);
          map.off('moveend', finish);
          map.off('zoomend', finish);
          clearTimeout(timer);
          resolve();
        };
        timer = setTimeout(finish, 120);
        map.on('render', finish);
        map.on('moveend', finish);
        map.on('zoomend', finish);
      });
    }

    async function exportOverlayImage(options = {}) {
      if (!window.html2canvas) {
        throw new Error('Missing html2canvas library');
      }

      const bounds = computeExportBounds(options);
      if (!bounds) {
        if (typeof displayStorageStatus === 'function') {
          displayStorageStatus('warning', '没有可导出的覆盖层内容');
        }
        return;
      }

      const { width, height, scale } = computeExportSize(bounds, options);
      const exportBackgroundColor = options?.backgroundColor;
      const html2canvasBackgroundColor = exportBackgroundColor ?? null;
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-99999px';
      container.style.top = '0';
      container.style.width = `${width}px`;
      container.style.height = `${height}px`;
      container.style.background = exportBackgroundColor ?? 'transparent';
      document.body.appendChild(container);

      let exportMap = null;
      try {
        exportMap = L.map(container, {
          crs,
          center: bounds.getCenter(),
          zoom: 0,
          zoomControl: false,
          attributionControl: false,
          preferCanvas: true,
          renderer: L.canvas()
        });

        exportMap.fitBounds(bounds, { padding: [0, 0] });

        const includeBaseLayer = Boolean(options?.includeBaseLayer);
        if (includeBaseLayer) {
          const baseLayer = overlayApi.baseLayer;
          if (baseLayer) {
            const baseUrl = baseLayer._url || baseLayer._image?.src || baseLayer._url;
            if (baseUrl) {
              L.imageOverlay(baseUrl, overlayApi.imageBounds || fullImageBounds).addTo(exportMap);
            }
          }
        }

        const activeKeys = getActiveOverlayKeysInOrder();
        const overlayGroup = cloneOverlays(activeKeys);
        overlayGroup.addTo(exportMap);

        await waitForMapRender(exportMap);

        const canvas = await window.html2canvas(container, {
          backgroundColor: html2canvasBackgroundColor,
          scale: scale || 1,
          useCORS: true,
          logging: false
        });

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
      } finally {
        try {
          exportMap?.remove?.();
        } catch (error) {
          // ignore
        }
        try {
          container.remove();
        } catch (error) {
          // ignore
        }
      }
    }

    window.exportOverlayImage = exportOverlayImage;
  }

  window.DynmapOverlayExport = Object.freeze({ init });
})();

