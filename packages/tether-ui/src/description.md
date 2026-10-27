# Tether UI 源码

本目录实现三端共享的 Tether 面板和宿主适配入口。`app.js` 根据宿主提供的 API base、逐目标请求头及原生组件运行同一页面，并提供面向当前 APP 或选中设备的 APP、Node、DSH 插件更新中心。
工作区加载会校验 Controller 响应并在接口异常时显示局部错误与重试；Web 启动入口用 React ErrorBoundary 兜底渲染错误，保留界面重试能力。
