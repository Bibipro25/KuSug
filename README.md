# KuSug

KuSug 客户端 UI 全套文件（版本 260922a）与 KuSug.so 原生组件源代码。

## 目录结构

- `KuSug.json` / `version.json` — 版本信息
- `script/` — 脚本集，其中 `KuSug.js` 为 UI 主脚本（保护构建产物）
- `kusug/so/KuSug.so` — 原生组件，与 KuSug.js 按内容指纹配对，必须成对部署
- `ui/` — ClickGUI 菜单定义（KuSug 全部分类，及 NoveXare / Rebirth）
- `textures/` — 快捷键徽章（KuSug 经典样式、z1yr 渐变样式）与其余贴图
- `GBRC/`、`TimeUnity/`、`build/`、`py/` 等 — 配套资源与配置
- `so源码/` — KuSug.so 的源代码与构建链

## so 源码与构建链

`so源码/` 内：

- `build_kusug_so.py` — 母本（唯一事实源），生成 `KuSugSo.c`
- `KuSugSo.c` — 生成出的 C 编译单元（生成物，勿直接手改）
- `kusug_stubs.S` — 链接桩汇编
- `build_obf.py` — 全流水线入口：JS 保护构建 → JS 指纹 → 生成 C → clang 编译 → Kagura 混淆 → zig 链接 → finalize 回填指纹
- `finalize_so.py`、`apply_hardening.py`、`gen_sigtab.py`、`gen_funmap.py`、`check_needed.py` — 流水线组件
- `js_f.txt`、`build_info.txt` — 当前配对指纹与构建记录

注意：KuSug.so 数据槽内嵌 KuSug.js 的内容指纹（内容为钥）。任何 JS 改动都必须经全流水线重建并成对部署，否则配对校验不通过。

## 许可

MIT，见 [LICENSE](LICENSE)。
