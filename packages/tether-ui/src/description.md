# Tether UI 源码

本目录实现三端共享的 Tether 面板和宿主适配入口。`app.js` 根据宿主提供的 API base、逐目标请求头及原生组件运行同一页面，并提供面向当前 APP 或选中设备的 APP、Node、DSH 插件更新中心。
