# -*- coding: utf-8 -*-
import io, json

CHECKCMD_TIP = r'''const checkCmd = {
	tag: "fun_check_cmd",
	enabled: false,
	lastSig: "",
	tipN: 0,
	lastTipMsg: "",
	BLOCKS: new Set([
		"minecraft:chain_command_block",
		"minecraft:repeating_command_block",
		"minecraft:command_block"
	]),
	MODES: {
		repeating: "Repeating",
		chain: "Chain"
	},
	extract(s, r) {
		try {
			return String(s || "").match(RegExp(r))?.[1] || "";
		} catch (e) {
			return "";
		}
	},
	decode(s) {
		try {
			return decodeURIComponent(s) || "";
		} catch (e) {
			return String(s || "");
		}
	},
	unesc(s) {
		try {
			return String(s || "").replace(/\\(["'\\])/g, "$1");
		} catch (e) {
			return String(s || "");
		}
	},
	hitBlock() {
		try {
			const hr = world.getClientWorld().getHitResult();
			if (!hr || !hr.blockPos) return null;
			const t = hr.type;
			if ((typeof t === "string" && /block|tile/i.test(t)) || t === 0 || t === "0") return hr.blockPos;
			return null;
		} catch (e) {
			return null;
		}
	},
	clearTip() {
		if (!this.lastSig) return;
		this.lastSig = "";
		try { minecraft.showTipMessage(""); } catch (e) {}
	},
	onModuleEvent(args) {
		if (!stdToggle(this, args, "查看命令方块")) return;
		if (!this.enabled) this.clearTip();
	},
	onTick() {
		if (!this.enabled) return;
		const p = this.hitBlock();
		if (!p) {
			this.clearTip();
			return;
		}
		const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
		try {
			const dimension = player.getLocalPlayer().getDimension();
			const block = dimension.getBlock({ x: px, y: py, z: pz });
			const blockNBT = this.decode(block.getNBT());
			const blockName = this.extract(blockNBT, 'name:"([^"]+)"') || "";
			if (!this.BLOCKS.has(blockName)) {
				this.clearTip();
				return;
			}
			let complete = "";
			try {
				const blockEntity = dimension.getBlockEntity({ x: px, y: py, z: pz });
				complete = this.decode(blockEntity.getNBT());
			} catch (e) {}
			const data = {
				mode: this.MODES[this.extract(blockNBT, 'name:"minecraft:([a-z_]+)_command_block"')] || "Tick",
				isRedStoneMode: !+this.extract(complete, "auto:(\\d)b"),
				isConditional: !!+this.extract(blockNBT, "conditional_bit:(\\d)b") || !!+this.extract(complete, "conditionalMode:(\\d)b"),
				command: this.unesc(complete?.match(/Command:"(.*?)",CustomName:/)?.[1] || this.extract(complete, 'Command:"((?:[^"\\\\]|\\\\.)*)"')),
				name: this.unesc(this.extract(complete, 'CustomName:"([^"]+)"')),
				tickDelay: +this.extract(complete, "TickDelay:(\\d+)") || 0,
				shouldTrackOutput: !!+this.extract(complete, "TrackOutput:(\\d)b"),
				executeOnFirstTick: !!+this.extract(complete, "ExecuteOnFirstTick:(\\d)b")
			};
			const sig = px + "," + py + "," + pz + "|" + data.command + "|" + data.name + "|" + data.tickDelay + "|" + (data.isRedStoneMode ? 1 : 0) + (data.isConditional ? 1 : 0) + (data.shouldTrackOutput ? 1 : 0) + (data.executeOnFirstTick ? 1 : 0);
			if (sig === this.lastSig) {
				if (++this.tipN >= 10) {
					this.tipN = 0;
					try { minecraft.showTipMessage(this.lastTipMsg); } catch (e) {}
				}
				return;
			}
			this.lastSig = sig;
			this.tipN = 0;
			const hasContent = data.command || data.name;
			const message = hasContent ?
				`[§fＣｏｍｍａｎｄ-Ｉｎｆｏｒｍａｔｉｏｎ§7]\n` +
				`§6类型: §f${data.mode}\n` +
				`§6模式: §f${data.isRedStoneMode ? "红石控制" : "保持开启"}\n` +
				`§6条件: §f${data.isConditional ? "是" : "否"}\n` +
				`§6命令: §f${(data.command || "").match(/.{1,60}/g)?.map((s, i, a) => i < a.length - 1 ? s + "\n§f" : s).join("") || ""}\n` +
				`§6悬停: §f${data.name || "无"}\n` +
				`§6延迟: §f${data.tickDelay}刻\n` +
				`§6追踪输出: §f${data.shouldTrackOutput ? "是" : "否"}\n` +
				`§6首次执行: §f${data.executeOnFirstTick ? "是" : "否"}` :
				"§l§c〉空链〈";
			this.lastTipMsg = message;
			minecraft.showTipMessage(message);
		} catch (e) {}
	}
};

'''

STRUCTHUD_TIP = r'''const structHud = {
	tag: "fun_struct_block",
	enabled: false,
	lastSig: "",
	tipN: 0,
	lastTipMsg: "",
	extract(s, r) {
		try {
			return String(s || "").match(RegExp(r))?.[1] || "";
		} catch (e) {
			return "";
		}
	},
	decode(s) {
		try {
			return decodeURIComponent(s) || "";
		} catch (e) {
			return String(s || "");
		}
	},
	unesc(s) {
		try {
			return String(s || "").replace(/\\(["'\\])/g, "$1");
		} catch (e) {
			return String(s || "");
		}
	},
	hitBlock() {
		try {
			const hr = world.getClientWorld().getHitResult();
			if (!hr || !hr.blockPos) return null;
			const t = hr.type;
			if ((typeof t === "string" && /block|tile/i.test(t)) || t === 0 || t === "0") return hr.blockPos;
			return null;
		} catch (e) {
			return null;
		}
	},
	clearTip() {
		if (!this.lastSig) return;
		this.lastSig = "";
		try { minecraft.showTipMessage(""); } catch (e) {}
	},
	onModuleEvent(args) {
		if (!stdToggle(this, args, "查看结构方块")) return;
		if (!this.enabled) this.clearTip();
	},
	onTick() {
		if (!this.enabled) return;
		let ig = true;
		try { ig = app.isInGame(); } catch (e) {}
		if (!ig) {
			this.clearTip();
			return;
		}
		const p = this.hitBlock();
		if (!p) {
			this.clearTip();
			return;
		}
		const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
		try {
			const dimension = player.getLocalPlayer().getDimension();
			const block = dimension.getBlock({ x: px, y: py, z: pz });
			const blockName = this.extract(this.decode(block.getNBT()), 'name:"([^"]+)"') || "";
			if (blockName !== "minecraft:structure_block") {
				this.clearTip();
				return;
			}
			let complete = "";
			try {
				const blockEntity = dimension.getBlockEntity({ x: px, y: py, z: pz });
				complete = this.decode(blockEntity.getNBT());
			} catch (e) {}
			const mode = +this.extract(complete, "data:(-?\\d+)") || 0;
			const modeCN = ["数据", "保存", "加载", "角落", "", "3D导出"][mode] || "无效";
			const sx = +this.extract(complete, "xStructureSize:(-?\\d+)") || 0;
			const sy = +this.extract(complete, "yStructureSize:(-?\\d+)") || 0;
			const sz = +this.extract(complete, "zStructureSize:(-?\\d+)") || 0;
			const ox = +this.extract(complete, "xStructureOffset:(-?\\d+)") || 0;
			const oy = +this.extract(complete, "yStructureOffset:(-?\\d+)") || 0;
			const oz = +this.extract(complete, "zStructureOffset:(-?\\d+)") || 0;
			const rot = (+this.extract(complete, "rotation:(\\d)b") || 0) * 90;
			const mirrorN = +this.extract(complete, "mirror:(\\d)b") || 0;
			const mirrorCN = ["无", "X轴", "Z轴", "X+Z轴"][mirrorN] || "未知";
			const integrity = +this.extract(complete, "integrity:([\\d.]+)f") || 0;
			const seed = this.extract(complete, "seed:(-?\\d+)l");
			const ignoreEntities = !!+this.extract(complete, "ignoreEntities:(\\d)b");
			const includePlayers = !!+this.extract(complete, "includePlayers:(\\d)b");
			const removeBlocks = !!+this.extract(complete, "removeBlocks:(\\d)b");
			const showBB = !!+this.extract(complete, "showBoundingBox:(\\d)b");
			const powered = !!+this.extract(complete, "isPowered:(\\d)b");
			const animN = +this.extract(complete, "animationMode:(\\d)b") || 0;
			const animSec = +this.extract(complete, "animationSeconds:([\\d.]+)f") || 0;
			const animCN = animN === 1 ? "按层放置" : animN === 2 ? "按方块放置" : "无";
			const rsMode = +this.extract(complete, "redstoneSaveMode:(-?\\d+)") || 0;
			let structName = this.unesc(this.extract(complete, 'structureName:"((?:[^"\\\\]|\\\\.)*)"'));
			if (structName.length > 26) structName = structName.slice(0, 26) + "…";
			const sig = px + "," + py + "," + pz + "|" + mode + "|" + sx + "," + sy + "," + sz + "|" + ox + "," + oy + "," + oz + "|" + rot + "|" + mirrorN + "|" + integrity + "|" + seed + "|" + (ignoreEntities ? 1 : 0) + (includePlayers ? 1 : 0) + (removeBlocks ? 1 : 0) + (showBB ? 1 : 0) + (powered ? 1 : 0) + "|" + animN + "," + animSec + "|" + rsMode + "|" + structName;
			if (sig === this.lastSig) {
				if (++this.tipN >= 10) {
					this.tipN = 0;
					try { minecraft.showTipMessage(this.lastTipMsg); } catch (e) {}
				}
				return;
			}
			this.lastSig = sig;
			this.tipN = 0;
			const message =
				`[§fＳｔｒｕｃｔｕｒｅ-Ｉｎｆｏｒｍａｔｉｏｎ§7]\n` +
				`§6模式: §f${modeCN} ${sx}×${sy}×${sz} §6偏移: §f${ox},${oy},${oz}\n` +
				`§6旋转: §f${rot}° §6镜像: §f${mirrorCN} §6完整性: §f${integrity % 1 ? integrity.toFixed(1) : integrity}%\n` +
				`§6种子: §f${seed && seed !== "0" ? seed : "随机"}\n` +
				`§6实体: §f${ignoreEntities ? "忽略" : "包含"} §6玩家: §f${includePlayers ? "包含" : "不含"}\n` +
				`§6忽略方块: §f${removeBlocks ? "是" : "否"} §6边框: §f${showBB ? "显示" : "隐藏"}\n` +
				`§6红石: §f${powered ? "已激活" : "未激活"} §6动画: §f${animCN}${animN > 0 ? " " + (animSec % 1 ? animSec.toFixed(1) : animSec) + "s" : ""}\n` +
				`§6保存至: §f${rsMode === 1 ? "硬盘" : "内存"}\n` +
				`§6结构名: §f${structName || "无"}\n` +
				`§7${px},${py},${pz}`;
			this.lastTipMsg = message;
			try { minecraft.showTipMessage(message); } catch (e) {}
		} catch (e) {}
	}
};

'''

ROOT = r"D:\work\KuSug\KuSug全套"
src = io.open(ROOT + r"\工具\src\KuSug_main.js", "r", encoding="utf-8").read()

start = src.find("const likeUser = {")
assert start != -1, "likeUser block start not found"
end = src.find("\n};\n", start)
assert end != -1, "likeUser block end not found"
end += len("\n};\n")
s = src[:start] + src[end:]

assert "\tlikeUser.lastLoginUid = \"\";\n\tlikeUser.start();\n" in s, "sauth lines not found"
s = s.replace("\tlikeUser.lastLoginUid = \"\";\n\tlikeUser.start();\n", "", 1)

assert "likeUser.start();\n" in s, "bottom start not found"
s = s.replace("likeUser.start();\n", "", 1)

assert "likeUser, " in s, "modules entry not found"
s = s.replace("likeUser, ", "", 1)

assert s.count("likeUser") == 0, "likeUser residue: %d" % s.count("likeUser")

gp = s.find("const gamePkg = (function () {")
wmu = s.find("const watermarkUid = {")
assert gp != -1 and wmu != -1 and gp < wmu, "gamePkg anchors not found"
s = s[:gp] + s[wmu:]

mb = s.find("const motionBlur = {")
ih = s.find("const itemHud = {")
hc = s.find("const hideClutter = {")
assert mb != -1 and ih != -1 and hc != -1 and mb < ih < hc, "so module anchors not found"
s = s[:mb] + s[hc:]

jwm = s.find("const javaWatermark = {")
qpl = s.find("const queryPlayer = {")
assert jwm != -1 and qpl != -1 and jwm < qpl, "javaWatermark anchors not found"
s = s[:jwm] + '''const javaWatermark = {
	tag: "fun_java_watermark",
	enabled: false,
	onModuleEvent(args) {
		if (!stdToggle(this, args, "动态水印", false)) return;
		try {
			const dir = app.getResource("kusug");
			if (!fs.exists(dir)) fs.createDirectories(dir);
			fs.write(app.getResource("kusug/java_watermark.flag"), this.enabled ? "1" : "0");
		} catch (e) {}
	}
};

''' + s[qpl:]

s = s.replace("\tif (javaWatermark.enabled) tickSafe(javaWatermark);\n", "")
s = s.replace("\tif (motionBlur.enabled) tickSafe(motionBlur);\n", "")
s = s.replace("\tif (itemHud.enabled) tickSafe(itemHud);\n", "")
s = s.replace("\tif (dirHud.enabled) tickSafe(dirHud);\n", "")
s = s.replace("\tif (crosshair.enabled) tickSafe(crosshair);\n", "")
s = s.replace("\tif (radarHud.enabled) tickSafe(radarHud);\n", "")

df = s.find("\n/* 死亡特效")
er = s.find("\nconst eatRepeat = {", df)
assert df != -1 and er != -1, "deathFx anchors not found"
s = s[:df] + s[er:]
s = s.replace("\tif (deathFx.enabled) tickSafe(deathFx);\n", "")
s = s.replace(", deathFx", "")

s = s.replace(", motionBlur", "").replace(", dirHud", "").replace(", itemHud", "")
s = s.replace(", motionBlur", "").replace(", dirHud", "").replace(", itemHud", "").replace(", crosshair", "").replace(", uiVis", "").replace(", radarHud", "")
s = s.replace('"fun_dir_hud", ', "")
s = s.replace('"fun_crosshair", ', "")
s = s.replace('"fun_item_hud", ', "")
s = s.replace(', "fun_item_hud"]', "]")
s = s.replace(', "fun_radar", "fun_container_blur", "fun_death_fx"]', ', "fun_container_blur"]')   # fun_container_blur 纯 Python 特性, TBCUI 保留
s = s.replace('"fun_motion_blur", ', "")

cc1 = s.find("const checkCmd = {")
cc2 = s.find("function PatchChatMessage", cc1)
assert cc1 != -1 and cc2 != -1, "checkCmd anchors not found"
s = s[:cc1] + CHECKCMD_TIP + STRUCTHUD_TIP + s[cc2:]
tx1 = s.find("\nconst texInject = {")
tx2 = s.find("\nconst sendControl = {", tx1)
assert tx1 != -1 and tx2 != -1, "texInject anchors not found"
s = s[:tx1] + s[tx2:]
s = s.replace(", texInject", "")
s = s.replace('"fun_tex_inject", ', "")
s = s.replace("\tif (kuNative.loaded) kuNative.flushLog();\n", "")

for tok in ["radarHud", "fun_radar", "__radar_in", "rd_enable", "rd_pos", "rd_commit", "rd_frames", "rd_", "motionBlur", "itemHud", "dirHud", "crosshair", "uiVis", "chud_", "kuNative", "wmhud", "gamePkg", "com.netease.x19", "fun_motion_blur", "fun_item_hud", "fun_dir_hud", "fun_crosshair", "KuSug.so", "__ihud_in", "mblur_set", "ihud_enable", "ihud_sync", "ihud_side", "ihud_offx", "ihud_offy", "ihud_maxrows", "dirhud_enable", "dirhud_set", "dirhud_frames", "dirhud_offx", "dirhud_offy", "dropfont", "font.ttf", "cbPanel", "cbhud_", "MxProbe.so", "__wpl_in", "wpl_sync", "wplChan", "jsMode", "sb_mode", "texInject", "fun_tex_inject", "tex_apply", "__tex_in", "tex_restore", "材质包注入", "panelLog", "panel_js.log", "deathFx", "fun_death_fx", "死亡特效"]:
    assert s.count(tok) == 0, "residue: %s x%d" % (tok, s.count(tok))

n1 = s.count("KuSug")
s = s.replace("KuSug", "TBCUI")
n2 = s.count("kusug")
s = s.replace("kusug", "tbcui")
assert "KuSug" not in s and "kusug" not in s
assert n1 > 0 and n2 > 0, "rename counts suspicious: %d %d" % (n1, n2)

io.open(ROOT + r"\TBCUI\TBCUI.js", "w", encoding="utf-8", newline="\n").write(s)
print("TBCUI.js written, likeUser+so模块(motionBlur/itemHud/kuNative) removed, renamed KuSug->TBCUI %d, kusug->tbcui %d" % (n1, n2))

EXC_TAGS = {"fun_motion_blur", "fun_item_hud", "fun_dir_hud", "fun_crosshair", "fun_cb_panel", "fun_tex_inject", "fun_radar", "fun_death_fx"}
EXC_KEYS = {"cb_mode", "sb_mode"}
ui = json.load(io.open(ROOT + r"\UI控件示例.json", "r", encoding='utf-8'))

def prune(o):
    if isinstance(o, list):
        return [prune(it) for it in o if not (isinstance(it, dict) and (it.get("tag") in EXC_TAGS or it.get("key") in EXC_KEYS))]
    if isinstance(o, dict):
        return {k: prune(v) for k, v in o.items()}
    return o

ui = prune(ui)
assert json.dumps(ui, ensure_ascii=False).count("cb_mode") == 0, "cb_mode residue in TBCUI menu"
assert json.dumps(ui, ensure_ascii=False).count("sb_mode") == 0, "sb_mode residue in TBCUI menu"
with io.open(ROOT + r"\TBCUI\UI控件示例.json", "w", encoding="utf-8", newline="\n") as f:
    json.dump(ui, f, ensure_ascii=False, indent=2)
    f.write("\n")
print("TBCUI UI控件示例.json synced (so 开关已剔除)")
