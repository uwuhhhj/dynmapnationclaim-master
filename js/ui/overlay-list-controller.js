(() => {
  class OverlayListController {
    constructor(options) {
      this.datasets = Array.isArray(options?.datasets) ? options.datasets : [];
      this.getItems = options?.getItems;
      this.onFocusMc = options?.onFocusMc;
      this.onStatus = options?.onStatus;

      this.datasetSelect = document.getElementById(options?.datasetSelectId ?? 'overlay-dataset-select');
      this.searchInput = document.getElementById(options?.searchInputId ?? 'overlay-search');
      this.sortFieldSelect = document.getElementById(options?.sortFieldSelectId ?? 'overlay-sort-field');
      this.sortDirectionSelect = document.getElementById(options?.sortDirectionSelectId ?? 'overlay-sort-direction');
      this.dataTitle = document.getElementById(options?.dataTitleId ?? 'data-display-title');
      this.dataList = document.getElementById(options?.dataListId ?? 'data-list');

      this.state = {
        datasetKey: options?.initialDatasetKey ?? (this.datasets[0]?.key ?? ''),
        search: '',
        sortField: options?.initialSortField ?? 'id',
        sortDirection: options?.initialSortDirection ?? 'asc',
        items: [],
        filteredSortedItems: [],
        visibleCount: 0,
        batchSize: Number.isFinite(options?.batchSize) ? options.batchSize : 80
      };

      this.observer = null;
      this.bound = false;
    }

    bind() {
      if (this.bound) {
        return;
      }
      this.bound = true;

      if (this.datasetSelect) {
        this.datasetSelect.value = this.state.datasetKey;
        this.datasetSelect.addEventListener('change', async () => {
          this.state.datasetKey = this.datasetSelect.value;
          await this.refresh(true);
        });
      }

      if (this.searchInput) {
        let timer = null;
        this.searchInput.addEventListener('input', () => {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            this.state.search = this.searchInput.value;
            this.computeFilteredSortedItems();
            this.render(true);
            this.refreshObserver();
          }, 120);
        });
      }

      if (this.sortFieldSelect) {
        this.sortFieldSelect.value = this.state.sortField;
        this.sortFieldSelect.addEventListener('change', () => {
          this.state.sortField = this.sortFieldSelect.value;
          this.computeFilteredSortedItems();
          this.render(true);
          this.refreshObserver();
        });
      }

      if (this.sortDirectionSelect) {
        this.sortDirectionSelect.value = this.state.sortDirection;
        this.sortDirectionSelect.addEventListener('change', () => {
          this.state.sortDirection = this.sortDirectionSelect.value;
          this.computeFilteredSortedItems();
          this.render(true);
          this.refreshObserver();
        });
      }

      if (this.dataList) {
        this.dataList.addEventListener('click', event => {
          const row = event.target?.closest?.('.data-row');
          if (!row) {
            return;
          }

          const mcX = this.safeNumber(row.dataset.mcX);
          const mcZ = this.safeNumber(row.dataset.mcZ);
          if (mcX === null || mcZ === null) {
            this.onStatus?.('warning', '该条目没有可定位的坐标');
            return;
          }

          const ok = this.onFocusMc?.(mcX, mcZ);
          if (!ok) {
            this.onStatus?.('warning', '地图尚未就绪，无法定位');
          }
        });
      }
    }

    safeNumber(value) {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : null;
    }

    normalizeText(value) {
      return String(value ?? '').trim().toLowerCase();
    }

    setDataset(key) {
      this.state.datasetKey = key;
      if (this.datasetSelect) {
        this.datasetSelect.value = key;
      }
    }

    cycleDataset() {
      const order = this.datasets.map(item => item.key).filter(Boolean);
      if (!order.length) {
        return;
      }
      const currentIndex = Math.max(0, order.indexOf(this.state.datasetKey));
      const nextKey = order[(currentIndex + 1) % order.length];
      this.setDataset(nextKey);
    }

    async refresh(reset = true) {
      if (typeof this.getItems !== 'function') {
        this.state.items = [];
        this.computeFilteredSortedItems();
        this.render(true);
        return;
      }

      this.state.items = await this.getItems(this.state.datasetKey);
      this.computeFilteredSortedItems();
      this.render(reset);
      this.ensureObserver();
      this.refreshObserver();
    }

    computeFilteredSortedItems() {
      const query = this.normalizeText(this.state.search);
      const filtered = query
        ? this.state.items.filter(item => {
            const haystack = `${item.name} ${item.id} ${item.country} ${item.chunks ?? ''} ${item.townPlayers ?? ''} ${item.countryPlayers ?? ''}`.toLowerCase();
            return haystack.includes(query);
          })
        : this.state.items.slice();

      const direction = this.state.sortDirection === 'desc' ? -1 : 1;
      const field = this.state.sortField;

      filtered.sort((a, b) => {
        const numericFields = new Set(['size', 'quantity', 'chunks', 'townPlayers', 'countryPlayers', 'territoryCount']);
        if (numericFields.has(field)) {
          const av = Number.isFinite(a[field]) ? a[field] : 0;
          const bv = Number.isFinite(b[field]) ? b[field] : 0;
          if (av !== bv) {
            return (av - bv) * direction;
          }
          return String(a.id).localeCompare(String(b.id)) * direction;
        }

        const av = field === 'countryName' ? String(a.country ?? '') : String(a[field] ?? '');
        const bv = field === 'countryName' ? String(b.country ?? '') : String(b[field] ?? '');
        const cmp = av.localeCompare(bv, 'zh-Hans-CN-u-co-pinyin');
        if (cmp !== 0) {
          return cmp * direction;
        }
        return String(a.id).localeCompare(String(b.id)) * direction;
      });

      this.state.filteredSortedItems = filtered;
    }

    render(reset = false) {
      if (!this.dataList || !this.dataTitle) {
        return;
      }

      const dataset = this.datasets.find(item => item.key === this.state.datasetKey);
      this.dataTitle.textContent = `📋 覆盖层数据：${dataset?.label ?? this.state.datasetKey}`;

      if (reset) {
        this.state.visibleCount = Math.min(this.state.batchSize, this.state.filteredSortedItems.length);
        this.dataList.innerHTML = '';
      }

      if (this.state.filteredSortedItems.length === 0) {
        if (reset) {
          this.dataList.innerHTML = '<div class="data-sentinel">暂无数据（请先点击“获取最新数据”）</div>';
        }
        return;
      }

      const end = this.state.visibleCount;
      const fragment = document.createDocumentFragment();

      const existingRows = this.dataList.querySelectorAll('.data-row').length;
      for (let i = existingRows; i < Math.min(end, this.state.filteredSortedItems.length); i += 1) {
        const item = this.state.filteredSortedItems[i];
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'data-row';
        row.dataset.mcX = item.mcX ?? '';
        row.dataset.mcZ = item.mcZ ?? '';
        row.dataset.itemId = item.id;

        const hasCountry = item.country && item.country !== '无国家';
        const countryClass = hasCountry ? 'data-row__pill' : 'data-row__pill is-empty';

        const safeName = String(item.name ?? '');
        const safeCountry = String(item.country ?? '无国家');
        const chunkValue = item.chunks === null || item.chunks === undefined ? '-' : String(item.chunks);
        const townPlayersValue = item.townPlayers === null || item.townPlayers === undefined ? '-' : String(item.townPlayers);

        row.innerHTML = `
          <div>
            <div class="data-row__name" title="${safeName.replace(/\"/g, '&quot;')}">${safeName}</div>
            <div class="data-row__meta">
              <div>区块：${chunkValue}</div>
              <div>城镇玩家数：${townPlayersValue}</div>
            </div>
          </div>
          <div class="${countryClass}">${safeCountry}</div>
        `;

        fragment.appendChild(row);
      }

      let sentinel = this.dataList.querySelector('#data-list-sentinel');
      if (!sentinel) {
        sentinel = document.createElement('div');
        sentinel.id = 'data-list-sentinel';
        sentinel.className = 'data-sentinel';
        this.dataList.appendChild(sentinel);
      }

      this.dataList.insertBefore(fragment, sentinel);

      const hasMore = this.state.visibleCount < this.state.filteredSortedItems.length;
      sentinel.textContent = hasMore
        ? `继续滚动加载（已显示 ${Math.min(end, this.state.filteredSortedItems.length)} / ${this.state.filteredSortedItems.length}）`
        : `已显示全部 ${this.state.filteredSortedItems.length} 条`;
    }

    ensureObserver() {
      if (this.observer || !this.dataList) {
        return;
      }

      this.observer = new IntersectionObserver(
        entries => {
          const entry = entries[0];
          if (!entry?.isIntersecting) {
            return;
          }

          if (this.state.visibleCount >= this.state.filteredSortedItems.length) {
            return;
          }

          this.state.visibleCount = Math.min(
            this.state.visibleCount + this.state.batchSize,
            this.state.filteredSortedItems.length
          );
          this.render(false);
        },
        { root: this.dataList, threshold: 0.15 }
      );

      const sentinel = this.dataList.querySelector('#data-list-sentinel');
      if (sentinel) {
        this.observer.observe(sentinel);
      }
    }

    refreshObserver() {
      if (!this.observer || !this.dataList) {
        return;
      }
      const sentinel = this.dataList.querySelector('#data-list-sentinel');
      if (sentinel) {
        this.observer.disconnect();
        this.observer.observe(sentinel);
      }
    }
  }

  window.DynmapOverlayListController = OverlayListController;
})();

