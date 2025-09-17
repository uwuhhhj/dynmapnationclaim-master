# Dynmap Nation Claim 系统

该项目是一个基于浏览器的可视化工具，主要用于展示并处理 Minecraft 服务器中的领地区域数据。通过整合 Dynmap 导出的标记和区域信息，项目能够生成对应国家的宣称范围图，并提供一系列数据处理流程以解决领地冲突。

## 功能概览

- **地图显示**：使用 Leaflet 在网页上呈现世界地图，支持自定义瓦片、坐标转换及基础交互。
- **数据获取与存储**：通过 `data-manager.js` 从服务器拉取领地标记与区域数据，并利用 IndexedDB 进行本地缓存。
- **国家分组与颜色管理**：根据标记或区域描述识别国家归属，通过 `country-color-manager.js` 管理调色板并统一国家颜色。
- **宣称范围生成**：`country-claims-generator.js` 和 `country-claims-manager.js` 提供从领地区域到国家宣称的生成逻辑，可逐步执行或一次性完成。
- **高级冲突处理**：内置多步骤流程（如冲突检测、栅格化、归属判定等），可在控制面板中按需执行。
- **统一数据模型**：`docs/CountryClaim-DataModel.md` 定义 `CountryClaim`、`CountryClaimsCollection` 等类，用于在各处理阶段保持数据一致性。

## 项目结构

```
├── css/                 页面样式与 Leaflet 样式
├── docs/                文档与数据模型说明
├── images/              瓦片与图标资源
├── js/                  主要脚本目录
│   ├── models/          宣称数据模型实现
│   └── territory-map/   地图与冲突处理模块
├── index.html           主页面
