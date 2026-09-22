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
- `js源码/` — KuSug.js 的源代码（母本）与构建链

## js 源码与构建链

`js源码/` 内：

- `KuSug_main.js` — JS 母本（唯一事实源），发布包里的 `script/KuSug.js` 由它保护构建而来
- `gen_z1yr_panel.py` — z1yr 面板段生成器（含校验套件 `z1yr_panel_verify.py`，菜单输入 `z1yr类.json`），面板段变更时先跑它回写母本标记段
- `gen_tbcui.py` — TBCUI 生成器，从母本提取 TBCUI 段（输入 `UI控件示例.json`）
- `build_js_protect.js` — JS 保护构建器：gen_tbcui → javascript-obfuscator → acorn 安全折行，产出 KuSug.js

构建顺序：`python gen_z1yr_panel.py`（面板段有改动时）→ `node build_js_protect.js` → 与 so 配对走 `so源码/build_obf.py` 全流水线。依赖：Node.js（npm 包 `javascript-obfuscator`、`acorn`）与 Python 3。

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
