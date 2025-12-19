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
// 默认不加载图层
// Object.values(overlayLayers).forEach(layer => layer.addTo(map));

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

window.DynmapOverlayManager?.init?.();
