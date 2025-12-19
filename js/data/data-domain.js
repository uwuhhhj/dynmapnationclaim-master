(() => {
  class DynmapTerritory {
    constructor(id, raw, kind) {
      this.id = id;
      this.raw = raw;
      this.kind = kind;
    }

    static fromMarker(id, marker) {
      return new DynmapTerritory(id, marker, 'marker');
    }

    static fromArea(id, area) {
      return new DynmapTerritory(id, area, 'area');
    }

    static _candidates(raw) {
      return [raw?.markup, raw?.desc, raw?.label];
    }

    static getCountryFrom(raw, parsers) {
      const { extractCountryFromDesc } = parsers;
      for (const candidate of DynmapTerritory._candidates(raw)) {
        if (typeof candidate !== 'string') {
          continue;
        }
        const parsed = extractCountryFromDesc?.(candidate);
        if (parsed) {
          return parsed;
        }
      }
      return null;
    }

    getCountry(parsers) {
      return DynmapTerritory.getCountryFrom(this.raw, parsers);
    }

    static getCapitalFrom(raw, parsers) {
      const { extractCapitalFromDescStrict } = parsers;
      for (const candidate of DynmapTerritory._candidates(raw)) {
        if (typeof candidate !== 'string') {
          continue;
        }
        const parsed = extractCapitalFromDescStrict?.(candidate);
        if (parsed) {
          return parsed;
        }
      }
      return null;
    }

    getCapitalName(parsers) {
      return DynmapTerritory.getCapitalFrom(this.raw, parsers);
    }

    static getPrimaryNameFrom(raw, parsers) {
      const { extractPrimaryNameFromDesc } = parsers;
      for (const candidate of DynmapTerritory._candidates(raw)) {
        if (typeof candidate !== 'string') {
          continue;
        }
        const parsed = extractPrimaryNameFromDesc?.(candidate);
        if (parsed) {
          return parsed;
        }
      }
      return null;
    }

    getPrimaryName(parsers) {
      return DynmapTerritory.getPrimaryNameFrom(this.raw, parsers);
    }

    matchesCapitalArea(capitalName, parsers) {
      if (this.kind !== 'area' || !capitalName) {
        return false;
      }
      const { areaContainsTagDelimitedName } = parsers;
      return (
        areaContainsTagDelimitedName?.(this.raw?.markup, capitalName) ||
        areaContainsTagDelimitedName?.(this.raw?.label, capitalName) ||
        areaContainsTagDelimitedName?.(this.raw?.desc, capitalName)
      );
    }
  }

  class DynmapCountry {
    constructor(name) {
      this.name = name;
      this.spawnGroup = { spawns: [] };
      this.areaMap = {};
      this.capitalInfo = { name: null, areas: {} };
      this.capitalSpawnGroup = { spawns: [] };
      this._hasMarkers = false;
    }

    hasMarkers() {
      return this._hasMarkers;
    }

    addMarker(territory) {
      const marker = territory.raw;
      this._hasMarkers = true;
      if (marker?.x !== undefined && marker?.z !== undefined) {
        this.spawnGroup.spawns.push({
          x: marker.x,
          z: marker.z,
          y: marker.y ?? 64,
          name: marker.label || territory.id,
          markerId: territory.id,
          markerData: marker
        });
      }
      this.spawnGroup[territory.id] = marker;
    }

    addArea(territory, parsers) {
      this.areaMap[territory.id] = territory.raw;
      const capitalName = territory.getCapitalName(parsers);
      if (!capitalName) {
        return;
      }
      this.setCapitalName(capitalName);
      if (territory.matchesCapitalArea(capitalName, parsers)) {
        this.capitalInfo.areas[territory.id] = territory.raw;
      }
    }

    setCapitalName(name) {
      if (!name || this.capitalInfo.name === name) {
        return;
      }
      this.capitalInfo.name = name;
    }

    resolveCapitalArea(parsers) {
      const capitalName = this.capitalInfo.name;
      if (!capitalName) {
        return;
      }
      if (Object.keys(this.capitalInfo.areas).length > 0) {
        return;
      }

      const entries = Object.entries(this.areaMap);
      if (!entries.length) {
        return;
      }

      const exactMatch = entries.find(([, area]) => {
        const primaryName =
          parsers.extractPrimaryNameFromDesc?.(area?.markup) ||
          parsers.extractPrimaryNameFromDesc?.(area?.desc) ||
          parsers.extractPrimaryNameFromDesc?.(area?.label);
        return primaryName === capitalName;
      });

      if (exactMatch) {
        const [areaId, area] = exactMatch;
        this.capitalInfo.areas[areaId] = area;
        return;
      }

      const includesMatch = entries.find(([, area]) => {
        const cleanText =
          (typeof area?.markup === 'string' ? area.markup : null) ||
          (typeof area?.desc === 'string' ? area.desc : null) ||
          (typeof area?.label === 'string' ? area.label : null);
        if (!cleanText) {
          return false;
        }
        const plain = parsers.stripHtml?.(cleanText) ?? cleanText;
        return plain.includes(capitalName);
      });

      if (includesMatch) {
        const [areaId, area] = includesMatch;
        this.capitalInfo.areas[areaId] = area;
        return;
      }

      if (entries.length === 1) {
        const [areaId, area] = entries[0];
        this.capitalInfo.areas[areaId] = area;
      }
    }

    finalizeCapitalSpawn(markers = {}, parsers) {
      const capitalName = this.capitalInfo.name || this.name;
      const capitalAreas = this.capitalInfo.areas || {};
      const areaIds = Object.keys(capitalAreas);
      let spawnMarkerId = null;
      let spawnMarker = null;
      let sourceAreaId = null;

      if (areaIds.length) {
        sourceAreaId = areaIds[0];
        const underscoreIdx = sourceAreaId.lastIndexOf('_');
        const baseId = underscoreIdx > 0 ? sourceAreaId.slice(0, underscoreIdx) : sourceAreaId;
        const candidateMarkerId = `${baseId}_spawn`;
        const candidateMarker = markers[candidateMarkerId];
        if (candidateMarker && candidateMarker.x !== undefined && candidateMarker.z !== undefined) {
          spawnMarkerId = candidateMarkerId;
          spawnMarker = candidateMarker;
        }
      }

      if (!spawnMarker) {
        const targetLabel = String(capitalName || '');
        for (const [markerId, marker] of Object.entries(markers)) {
          if (!markerId.endsWith('_spawn')) {
            continue;
          }
          if (marker?.label !== targetLabel) {
            continue;
          }

          const parsedCountry = DynmapTerritory.getCountryFrom(marker, parsers);
          if (parsedCountry && parsedCountry !== this.name) {
            continue;
          }

          if (marker?.x === undefined || marker?.z === undefined) {
            continue;
          }

          spawnMarkerId = markerId;
          spawnMarker = marker;
          break;
        }
      }

      if (!spawnMarker || spawnMarker.x === undefined || spawnMarker.z === undefined) {
        this.capitalSpawnGroup.spawns = [];
        return;
      }

      this.capitalSpawnGroup.spawns = [
        {
          x: spawnMarker.x,
          z: spawnMarker.z,
          y: spawnMarker.y ?? 64,
          name: capitalName,
          markerId: spawnMarkerId,
          sourceAreaId
        }
      ];
    }
  }

  window.DynmapDomain = Object.freeze({ DynmapTerritory, DynmapCountry });
})();
