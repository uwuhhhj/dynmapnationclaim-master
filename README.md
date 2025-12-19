# Dynmap 领地/国家覆盖层可视化

这是一个纯前端的可视化控制台：从 Dynmap 的 `marker_world.json` 拉取（或使用本地回退）领地标记/区域数据，自动解析并生成“国家维度”的覆盖层（国家区域、出生点、首都、首都出生点），在自定义底图上展示，并提供本地缓存、数据列表检索与导出能力。

## 功能概览

- **自定义底图 + 坐标映射**：使用 Leaflet 的 `L.CRS.Simple` 把 Minecraft 坐标映射到一张静态底图（`tiles/map_low.png`）。
- **数据获取（远程 + 本地回退）**：默认从 `js/data/data-fetch.js` 中的远程 Dynmap URL 拉取 marker 数据；失败时回退到 `data/marker_world.json`。
- **本地缓存（IndexedDB）**：`js/data/indexeddb-manager.js` 直接提供 Dexie-backed 的 `window.IndexedDBStorage` 和数据特化的 `window.DynmapStorage`，用统一 key 保存标记/区域/国家数据。
- **国家数据派生**：解析标记/区域描述中的国家与首都信息，生成并缓存：
  - 国家出生点（点）
  - 国家区域（面）
  - 国家首都（面 + 常驻标签）
  - 首都出生点（点）
- **覆盖层渲染与交互**：地图左上角图层控制器按类别开关覆盖层；覆盖层支持弹窗；点击“首都”弹窗按钮可切换首都配色（红/绿），并持久化保存。
- **覆盖层数据列表**：右侧面板支持按覆盖层切换、搜索、排序与滚动加载；点击条目可将地图定位到对应 MC 坐标（带短暂脉冲标记）。
- **导出**：
  - 导出覆盖层图片（PNG）：按当前激活的覆盖层计算范围并导出叠加效果图。
  - 导出数据（JSON）：导出当前缓存的标记/区域/国家数据等。
- **数据管理**：查看当前存储、清空 IndexedDB、输出数据库统计信息（同时写入面板与控制台）。

## 项目结构

```
.
├─ .github/                      GitHub 工作流/配置（如有）
├─ index.html                    页面入口（地图 + 右侧控制台）
├─ LICENSE.txt                   许可证
├─ package.json                  依赖声明（本项目无需构建即可运行）
├─ package-lock.json             锁定依赖版本
├─ robots.txt                    搜索引擎抓取配置
├─ site.webmanifest              PWA/站点元信息
├─ favicon.ico / icon.png / icon.svg 站点图标
├─ css/
│  ├─ app.css                    应用样式
│  ├─ leaflet.css                Leaflet 样式（含 css/images/ 资源）
│  └─ images/                    Leaflet 默认图标资源
├─ js/
│  ├─ app.js                     Leaflet 地图初始化、底图加载、覆盖层容器注册
│  ├─ libs/                      三方库（Leaflet / html2canvas / Dexie）
│  ├─ data/                      数据获取、解析、缓存与面板逻辑
│  │  ├─ data-domain.js           领地/国家的领域模型帮助类（新）
│  │  ├─ data-fetch.js            拉取 marker_world.json（远程 + 本地回退）、写入缓存、触发更新事件
│  │  ├─ indexeddb-manager.js     直接暴露 Dexie-backed `DynmapStorage` + 工具函数
│  │  ├─ desc-parsers.js          从 desc/markup/label 中解析国家、首都、区块数、玩家数等
│  │  ├─ data-country.js          基于解析结果生成国家维度数据集并写入缓存
│  │  ├─ data-overlay-datasets.js 覆盖层数据集定义 + 列表项加载（含面积/中心点等统计）
│  │  ├─ data-ui.js               右侧面板按钮与数据列表控制（刷新/查看/清空/导出/统计）
│  │  └─ data-manager.js          将 data-ui 的方法绑定到全局按钮回调
│  ├─ ui/
│  │  └─ overlay-list-controller.js 覆盖层数据列表（搜索/排序/滚动加载/点击定位）
│  └─ map/
│     ├─ overlay-manager.js       覆盖层绘制与坐标换算（含首都配色切换）
│     └─ overlay-export.js        覆盖层 PNG 导出（克隆 active layers + html2canvas）
├─ tiles/
│  └─ map_low.png                 底图图片（用于 imageOverlay）
├─ data/
│  ├─ marker_world.json           本地回退的 Dynmap marker 数据
│  └─ main.py                     marker JSON 结构/字段分析脚本（开发辅助）
├─ img/                          预留目录（当前为空）
└─ images/                        Dynmap 相关图标资源（保留原目录结构）
```

## 快速开始

建议用本地静态服务器打开（避免浏览器对 `file://` 的跨域/读取限制）：

```bash
python -m http.server 8000
```

然后访问 `http://localhost:8000/`，在右侧面板点击“获取最新数据”。
