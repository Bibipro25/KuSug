# KuSug

《我的世界》中国版 UI 系统，运行于跑路 RunAway 插件平台。

## 使用教程

1. 在 [Releases](https://github.com/Bibipro25/KuSug/releases) 下载最新发布包并解压。
2. 将解压出的全部文件放入客户端资源目录。
3. 启动客户端，在脚本列表中启用 KuSug 即可使用。
4. script/KuSug.js 与 kusug/so/KuSug.so 必须来自同一发布包，不可跨版本混用。

## 组成部分及作用

| 路径 | 作用 |
| --- | --- |
| script/KuSug.js | 主脚本，提供全部功能与操作界面 |
| kusug/so/KuSug.so | 原生组件，与主脚本配套工作 |
| ui/ | 菜单布局与界面配置 |
| textures/ | 界面贴图与图标资源 |
| GBRC/ 与 TimeUnity/ 等 | 配套功能资源与配置 |
| js源码/ | 主脚本源代码与构建工具 |
| so源码/ | 原生组件源代码与构建工具 |

## 许可

MIT，详见 LICENSE。
