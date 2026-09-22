const menu = require("menu");
const app = require("app");
const gui = require("gui");
const camera = require("camera");
const options = require("options");
const player = require("player");
const world = require("world");
const netease = require("netease");
const minecraft = require("minecraft");
const fs = require("fs");
const https = require("https");
const packet = require("packet");
const input = require("input");
const blockApi = require("block");
const os = require("os");

function mkLog(prefix) {
	return function (msg) { try { minecraft.clientMessage(prefix + msg); } catch (e) {} };
}

function ensureHud(mod, tag, name) {
	if (mod.hud) return;
	mod.hud = new gui.ArrayList({ function: tag, name: name, shortName: name, enabled: false });
}

function notifyToggle(name, enabled, extra) {
	try {
		minecraft.clientMessage("§b[" + name + "] " + (enabled ? "§a已开启" : "§c已关闭") + (enabled && extra ? " §7" + extra : ""));
	} catch (e) {}
}

function stdToggle(mod, args, name, useHud, extra) {
	if (args.fun !== mod.tag || !("value" in args)) return false;
	const v = Boolean(args.value);
	if (v === mod.enabled) return false;
	mod.enabled = v;
	if (useHud !== false) { ensureHud(mod, mod.tag, name); mod.hud.enabled = v; }
	notifyToggle(name, v, extra);
	return true;
}

function fireLatch(mod, v) {
	if (!v) { mod.fired = false; return false; }
	if (mod.fired) return false;
	mod.fired = true;
	return true;
}

function tickEvery(mod, n) {
	mod.tickCount++;
	if (mod.tickCount < n) return false;
	mod.tickCount = 0;
	return true;
}

function tickSafe(mod) {
	try { mod.onTick(); } catch (e) {}
}

function clampPos(v, lo, hi) {
	const n = Number(v);
	if (isNaN(n) || n <= 0) return 0;
	return Math.max(lo, Math.min(hi, Math.floor(n)));
}

function radio2(args, keyName, optA, optB, mod, field, valA, valB) {
	const mv = argPick(args, keyName);
	if (mv === optA) mod[field] = valA;
	else if (mv === optB) mod[field] = valB;
	if (args[optA] === true) mod[field] = valA;
	if (args[optB] === true) mod[field] = valB;
}

function hex2buf(hex) {
	const u = new Uint8Array(hex.length / 2);
	for (let i = 0; i < u.length; i++) u[i] = parseInt(hex.substr(i * 2, 2), 16);
	return u.buffer;
}

function carriedNbt() {
	const lp = player.getLocalPlayer();
	const it = lp.getCarriedItem();
	let nbt = "";
	try { nbt = String(it.getNBT() || ""); } catch (e) {}
	return { lp: lp, it: it, nbt: nbt };
}

const STRIP_COLOR_RE = /§[0-9a-fk-or]/gi;
const EMPTY_LIST = [];

function pascalKey(key) {
	return key.replace(/(^|_)([a-z])/g, function (m, p, c) { return p + c.toUpperCase(); });
}

function showPyPopup(title, lines, copyText) {
	const pythonCode = `# -*- coding: utf-8 -*-
import json
import minecraft
from gui_2d import GUI, ui_const

TITLE = json.loads(${JSON.stringify(JSON.stringify(title))})
LINES = json.loads(${JSON.stringify(JSON.stringify(lines))})
COPY = json.loads(${JSON.stringify(JSON.stringify(copyText === undefined ? null : String(copyText)))})

try:
	text = COPY if COPY is not None else u'\\n'.join(LINES)
	def on_copy():
		try:
			minecraft.instance.copyToClipboard(text)
			GUI.ui_mgr.show_toast(u'已复制到粘贴板')
		except Exception:
			pass
	GUI.ui_mgr.show_gui(ui_const.COMMON_POP_WINDOW, data={
		'title': TITLE,
		'content': u'',
		'text_list': LINES,
		'confirm_text': u'确定',
		'cancel_text': u'复制信息',
		'show_close_btn': False,
		'cancel_callback': on_copy
	})
except Exception:
	pass
`;
	try { app.evalPython(pythonCode); } catch (e) {}
}

function binReader(data) {
	const u8 = new Uint8Array(data);
	const r = {
		u8: u8,
		off: 0,
		need(n) { if (r.off + n > u8.length) throw 0; },
		byte() { r.need(1); return u8[r.off++]; },
		skip(n) { r.need(n); r.off += n; },
		uvarint() {
			let v = 0, shift = 0, b;
			do { b = r.byte(); v += (b & 0x7F) * (2 ** shift); shift += 7; } while ((b & 0x80) && shift < 35);
			return v;
		},
		svarint() {
			const uv = r.uvarint();
			const half = Math.floor(uv / 2);
			return uv % 2 ? -half - 1 : half;
		}
	};
	return r;
}

function uvarintBytes(v) {
	const enc = [];
	do {
		const t = v % 128;
		v = Math.floor(v / 128);
		enc.push(v > 0 ? t | 0x80 : t);
	} while (v > 0);
	return enc;
}

function joinParts(parts) {
	let total = 0;
	for (const p of parts) total += p.length;
	const res = new Uint8Array(total);
	let pos = 0;
	for (const p of parts) {
		res.set(p, pos);
		pos += p.length;
	}
	return res.buffer;
}

function decodeUtf8(bytes) {
	let s = "";
	for (let i = 0; i < bytes.length;) {
		const b1 = bytes[i++];
		if (b1 < 0x80) {
			s += String.fromCharCode(b1);
		} else if (b1 < 0xE0) {
			s += String.fromCharCode(((b1 & 0x1F) << 6) | (bytes[i++] & 0x3F));
		} else if (b1 < 0xF0) {
			s += String.fromCharCode(((b1 & 0x0F) << 12) | ((bytes[i++] & 0x3F) << 6) | (bytes[i++] & 0x3F));
		} else {
			const b2 = bytes[i++],
				b3 = bytes[i++],
				b4 = bytes[i++];
			const cp = (((b1 & 0x07) << 18) | ((b2 & 0x3F) << 12) | ((b3 & 0x3F) << 6) | (b4 & 0x3F)) - 0x10000;
			s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
		}
	}
	return s;
}

function encodeUtf8(str) {
	const out = [];
	for (let i = 0; i < str.length;) {
		const cp = str.codePointAt(i);
		i += cp > 0xFFFF ? 2 : 1;
		if (cp <= 0x7F) {
			out.push(cp);
		} else if (cp <= 0x7FF) {
			out.push(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F));
		} else if (cp <= 0xFFFF) {
			out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
		} else {
			out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
		}
	}
	return out;
}

function nbtSetInf(nbt) {
	const tagIdx = nbt.indexOf("tag:{");
	if (tagIdx < 0) {
		if (nbt.charAt(nbt.length - 1) !== "}") return null;
		return nbt.slice(0, -1) + ",tag:{Damage:-32767}}";
	}
	const start = tagIdx + 4;
	let depth = 0, end = -1;
	for (let i = start; i < nbt.length; i++) {
		const c = nbt.charAt(i);
		if (c === "{") depth++;
		else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
	}
	if (end < 0) return null;
	const tagBody = nbt.slice(start + 1, end);
	let newBody;
	if (/Damage:-?\d+[a-z]?/.test(tagBody)) {
		newBody = tagBody.replace(/Damage:-?\d+[a-z]?/, "Damage:-32767");
	} else {
		newBody = "Damage:-32767" + (tagBody ? "," + tagBody : "");
	}
	return nbt.slice(0, start + 1) + newBody + nbt.slice(end);
}

function nbtSetDamage(nbt, val) {
	let depth = 0, inStr = false;
	for (let i = 0; i < nbt.length; i++) {
		const c = nbt.charAt(i);
		if (inStr) {
			if (c === '"') inStr = false;
			continue;
		}
		if (c === '"') { inStr = true; continue; }
		if (c === "{") depth++;
		else if (c === "}") depth--;
		else if (c === "D" && depth === 1 && nbt.substr(i, 7) === "Damage:") {
			const m = /^Damage:-?\d+([a-z]?)/.exec(nbt.slice(i));
			if (!m) return null;
			return nbt.slice(0, i) + "Damage:" + val + m[1] + nbt.slice(i + m[0].length);
		}
	}
	if (nbt.charAt(0) !== "{") return null;
	return "{Damage:" + val + "s," + nbt.slice(1);
}

function makeNbtWriter(cfg) {
	return {
		tag: cfg.tag,
		fired: false,
		writesLeft: 0,
		writeGap: 0,
		throwAfter: !!cfg.throwDefault,
		dropDelay: 0,
		value: 0,
		onModuleEvent(args) {
			if (typeof args[cfg.throwKey] !== "undefined") this.throwAfter = Boolean(args[cfg.throwKey]);
			if (cfg.textKey && typeof args[cfg.textKey] === "string") {
				const n = Number(args[cfg.textKey].trim());
				if (!isNaN(n) && isFinite(n)) this.value = Math.round(n);
			}
			if (cfg.radioKey) {
				const re = new RegExp("^" + cfg.radioKey + "_(\\d+)$");
				if (typeof args[cfg.radioKey] === "string") {
					const m = re.exec(args[cfg.radioKey]);
					if (m) this.value = Number(m[1]);
				}
				for (const k in args) {
					const m = re.exec(k);
					if (m && args[k]) this.value = Number(m[1]);
				}
			}
			if (args.fun !== this.tag || !("value" in args)) return;
			if (!fireLatch(this, Boolean(args.value))) return;
			this.writesLeft = 2;
			this.writeGap = 0;
		},
		log: mkLog(cfg.logPrefix),
		onTick() {
			if (this.dropDelay > 0) {
				this.dropDelay--;
				if (this.dropDelay === 0) {
					try {
						input.buttonDown("button.drop");
						input.buttonUp("button.drop");
					} catch (e) {}
				}
			}
			if (this.writesLeft > 0) {
				if (this.writeGap > 0) {
					this.writeGap--;
					return;
				}
				this.writesLeft--;
				const ok = this.doWrite();
				if (!ok) {
					this.writesLeft = 0;
					return;
				}
				if (this.writesLeft > 0) {
					this.writeGap = 1;
					return;
				}
				this.log(cfg.okText + (cfg.okVal ? this.value : ""));
				if (this.throwAfter) this.dropDelay = 3;
			}
		},
		doWrite() {
			try {
				const { lp, it, nbt } = carriedNbt();
				if (!it || !nbt || nbt.indexOf('Name:""') >= 0 || nbt.indexOf("Count:0") >= 0 || (cfg.need && nbt.indexOf(cfg.need) < 0)) {
					this.log(cfg.holdMsg);
					return false;
				}
				const newNbt = cfg.transform(nbt, this.value);
				if (!newNbt) {
					this.log("§c物品NBT格式异常");
					return false;
				}
				it.setNBT(newNbt);
				lp.setCarriedItem(it);
				return true;
			} catch (e) {
				this.log("§c写入失败: " + e);
				return false;
			}
		}
	};
}

const cookieLogin = {
	tag: "fun_cookie_login",
	enabled: false,
	panel: false,
	cookieText: "",
	armCapture: false,
	pendingDel: "",
	inWorld: false,
	bootMs: Date.now(),
	loaded: false,
	autoLogin: true,
	savedEnabled: false,
	lastUsed: "",
	list: [],
	gui: null,
	ivEnabled: null,
	ivAuto: null,
	ivName: null,
	ivData: null,
	extractSAuthJson(raw) {
		const text = String(raw || "").trim();
		try {
			const data = JSON.parse(text);
			if (typeof data.sauth_json === "string") return data.sauth_json;
			if (data.sauth_json && typeof data.sauth_json === "object") return JSON.stringify(data.sauth_json);
		} catch (e) {}
		return text;
	},
	filePath() {
		return app.getResource("KuSug/Cookies.json");
	},
	ensureImgui() {
		if (this.gui) return true;
		try {
			const gui = require("ImGui");
			this.ivEnabled = new gui.AccessValue(this.enabled);
			this.ivAuto = new gui.AccessValue(this.autoLogin);
			this.ivName = new gui.AccessValue("");
			this.ivData = new gui.AccessValue("");
			this.gui = gui;
			return true;
		} catch (e) {
			return false;
		}
	},
	load() {
		if (this.loaded) return;
		this.loaded = true;
		try {
			const f = this.filePath();
			if (fs.exists(f)) {
				const data = JSON.parse(String(fs.read(f) || "{}"));
				if (Array.isArray(data.cookies)) this.list = data.cookies;
				if (typeof data.autoLogin === "boolean") this.autoLogin = data.autoLogin;
				if (typeof data.lastUsed === "string") this.lastUsed = data.lastUsed;
				if (typeof data.enabled === "boolean") this.savedEnabled = data.enabled;
				if (typeof data.panel === "boolean") this.panel = data.panel;
			}
		} catch (e) {}
	},
	save() {
		try {
			const dir = app.getResource("KuSug");
			if (!fs.exists(dir)) fs.createDirectories(dir);
			fs.write(this.filePath(), JSON.stringify({ enabled: this.enabled, autoLogin: this.autoLogin, lastUsed: this.lastUsed, panel: this.panel, cookies: this.list }));
		} catch (e) {}
	},
	syncCheckbox() {
		try {
			if (this.ivEnabled) this.ivEnabled.value = this.enabled;
			if (this.ivAuto) this.ivAuto.value = this.autoLogin;
		} catch (e) {}
	},
	current() {
		return this.findById(this.lastUsed);
	},
	findById(id) {
		for (let i = 0; i < this.list.length; i++) {
			if (this.list[i].id === id) return this.list[i];
		}
		return null;
	},
	boot() {
		this.load();
		this.enabled = this.savedEnabled;
		const c = this.current();
		if (c) {
			this.cookieText = String(c.data || "").trim();
			if (this.enabled && this.autoLogin) {
				notifyToggle("Cookie登录", true, c.name + " 自动登录");
			}
		}
		this.syncCheckbox();
	},
	capture(raw, prefix) {
		this.load();
		const data = String(raw || "").trim();
		if (!data) return;
		for (let i = 0; i < this.list.length; i++) {
			if (String(this.list[i].data) === data) {
				this.lastUsed = this.list[i].id;
				this.save();
				return;
			}
		}
		const d = new Date();
		const pad = function (n) { return n < 10 ? "0" + n : "" + n; };
		const entry = {
			id: "c" + Date.now() + "_" + Math.floor(Math.random() * 1000),
			name: prefix + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()),
			data: data,
			time: Date.now()
		};
		this.list.push(entry);
		this.lastUsed = entry.id;
		this.save();
	},
	useCookie(id) {
		const c = this.findById(id);
		if (!c) return;
		this.lastUsed = id;
		this.enabled = true;
		this.save();
		this.syncCheckbox();
		try {
			this.cookieText = String(c.data || "").trim();
		} catch (e) {}
	},
	delCookie(id) {
		this.list = this.list.filter(function (c) { return c.id !== id; });
		if (this.lastUsed === id) this.lastUsed = "";
		this.pendingDel = "";
		this.save();
	},
	exportCookie(id) {
		const c = this.findById(id);
		if (!c) return;
		let raw = String(c.data || "").trim();
		if (!raw) {
			try { app.showToast("该记录内容为空"); } catch (e) {}
			return;
		}
		let out = raw;
		try {
			const data = JSON.parse(raw);
			if (typeof data.sauth_json === "string") out = JSON.stringify({ sauth_json: data.sauth_json });
			else if (data.sauth_json && typeof data.sauth_json === "object") out = JSON.stringify({ sauth_json: JSON.stringify(data.sauth_json) });
			else out = JSON.stringify({ sauth_json: raw });
		} catch (e) {
			out = JSON.stringify({ sauth_json: raw });
		}
		let nm = String(c.name || "cookie").replace(/[\\/:*?"<>|\s]+/g, "_");
		if (!nm) nm = "cookie";
		try {
			const dir = app.getResource("KuSug/导出");
			if (!fs.exists(dir)) fs.createDirectories(dir);
			let fn = "sauth_json_" + nm + ".json";
			let n = 2;
			while (fs.exists(dir + "/" + fn)) { fn = "sauth_json_" + nm + "_" + n + ".json"; n++; }
			fs.write(dir + "/" + fn, out);
			app.showToast("已导出: KuSug/导出/" + fn);
		} catch (e) {
			try { app.showToast("导出失败: " + (e && e.message ? e.message : e)); } catch (e2) {}
		}
	},
	addFromInput() {
		const name = String(this.ivName.value || "").trim();
		const data = String(this.ivData.value || "").trim();
		if (!data) {
			try { app.showToast("Cookie数据为空"); } catch (e) {}
			return;
		}
		for (let i = 0; i < this.list.length; i++) {
			if (String(this.list[i].data) === data) {
				this.lastUsed = this.list[i].id;
				this.save();
				return;
			}
		}
		const entry = {
			id: "c" + Date.now() + "_" + Math.floor(Math.random() * 1000),
			name: name || "Cookie-" + (this.list.length + 1),
			data: data,
			time: Date.now()
		};
		this.list.push(entry);
		this.lastUsed = entry.id;
		this.save();
		this.ivName.value = "";
		this.ivData.value = "";
	},
	onModuleEvent(args) {
		if (args.fun === "fun_cookie_login" && "value" in args) {
			const v = Boolean(args.value);
			if (v !== this.panel) {
				this.panel = v;
				this.save();
				if (v) {
					this.load();
					this.ensureImgui();
					this.syncCheckbox();
				}
			}
		}
	},
	onWorldEnter() {
		this.inWorld = true;
	},
	onWorldExit() {
		this.inWorld = false;
	},
	onSAuthJsonHook(cookie) {
		if (this.armCapture) {
			this.armCapture = false;
			try {
				this.capture(cookie, "捕获");
				app.showToast("已捕获本次登录Cookie");
			} catch (e) {}
			return;
		}
		if (!this.enabled) return;
		const sauthJson = this.extractSAuthJson(this.cookieText);
		if (sauthJson) {
			app.showToast("Cookie登录成功");
			try { this.capture(this.cookieText, "输入"); } catch (e) {}
			return sauthJson;
		}
		app.showToast("Cookie无效，登录失败");
		return null;
	},
	onRender() {
		if (!this.panel || this.inWorld) return;
		if (Date.now() - this.bootMs < 3000) return;
		if (!this.ensureImgui()) return;
		const gui = this.gui;
		try {
			this.renderPanel();
		} catch (e) {
			try { gui.End(); } catch (e2) {}
		}
	},
	renderPanel() {
		const gui = this.gui;
		const acts = [];
		gui.Begin("Cookie 登录");
		if (gui.Checkbox("启用登录", this.ivEnabled)) {
			this.enabled = Boolean(this.ivEnabled.value);
			notifyToggle("Cookie登录", this.enabled);
			this.save();
		}
		if (gui.Checkbox("自动登录", this.ivAuto)) {
			this.autoLogin = Boolean(this.ivAuto.value);
			this.save();
		}
		const cur = this.current();
		gui.Text("已存 " + this.list.length + " 个，当前: " + (cur ? cur.name : "无"));
		gui.Text("点名称选用，下次登录自动生效");
		if (gui.Separator) gui.Separator();
		else gui.Text(" ");
		for (let i = 0; i < this.list.length; i++) {
			const c = this.list[i];
			if (c.id === this.lastUsed) {
				if (gui.Button("√ " + (i + 1) + ". " + c.name + "（当前）")) acts.push({ t: "use", id: c.id });
				try { gui.SameLine(0, 60); } catch (e) { gui.SameLine(); }
				if (gui.Button("导#" + (i + 1))) acts.push({ t: "exp", id: c.id });
				try { gui.SameLine(0, 60); } catch (e) { gui.SameLine(); }
				if (gui.Button((this.pendingDel === c.id ? "确认删#" : "删#") + (i + 1))) {
					if (this.pendingDel === c.id) acts.push({ t: "del", id: c.id });
					else this.pendingDel = c.id;
				}
			} else {
				if (gui.Button((i + 1) + ". " + c.name)) acts.push({ t: "use", id: c.id });
				try { gui.SameLine(0, 60); } catch (e) { gui.SameLine(); }
				if (gui.Button("导#" + (i + 1))) acts.push({ t: "exp", id: c.id });
				try { gui.SameLine(0, 60); } catch (e) { gui.SameLine(); }
				if (gui.Button((this.pendingDel === c.id ? "确认删#" : "删#") + (i + 1))) {
					if (this.pendingDel === c.id) acts.push({ t: "del", id: c.id });
					else this.pendingDel = c.id;
				}
			}
		}
		if (this.pendingDel) {
			const pc = this.findById(this.pendingDel);
			if (pc) {
				gui.Text("将删除: " + pc.name);
				if (gui.Button("取消删除")) this.pendingDel = "";
			} else {
				this.pendingDel = "";
			}
		}
		if (this.list.length === 0) gui.Text("(暂无，下方新增或用旧通道捕获)");
		if (gui.Separator) gui.Separator();
		else gui.Text(" ");
		gui.Text("新增 Cookie");
		gui.InputText("名称", this.ivName);
		gui.InputText("Cookie数据", this.ivData);
		if (gui.Button("保存为新 Cookie")) this.addFromInput();
		if (this.armCapture) {
			gui.Text("(等待捕获下次登录...)");
			if (gui.Button("取消捕获")) {
				this.armCapture = false;
			}
		} else {
			if (gui.Button("捕获下次登录")) {
				this.armCapture = true;
			}
		}
		gui.End();
		for (let i = 0; i < acts.length; i++) {
			if (acts[i].t === "use") this.useCookie(acts[i].id);
			else if (acts[i].t === "exp") this.exportCookie(acts[i].id);
			else this.delCookie(acts[i].id);
		}
	}
};

const moveCamera = {
	tag: "fun_move_camera",
	enabled: false,
	amplitude: 3,
	prev: [],
	onModuleEvent(args) {
		if (stdToggle(this, args, "运动相机")) {
			if (!this.enabled) {
				this.prev = [];
				camera.setAnchor({ x: 0, y: 0, z: 0 });
			}
		}
		const amp = Number(args.MoveCameraAmplitude !== undefined ? args.MoveCameraAmplitude : args.Amplitu);
		if (!isNaN(amp) && amp > 0) {
			this.amplitude = Math.max(1, Math.min(20, Math.floor(amp)));
		}
	},
	onTick() {
		if (!this.enabled) return;
		try {
			if (options.getPlayerViewPerspective() === 0) {
				camera.setAnchor({ x: 0, y: 0, z: 0 });
				return;
			}
			const localPlayer = player.getLocalPlayer();
			if (!localPlayer) return;
			const pos = localPlayer.getPos();
			if (!pos) return;
			let slot;
			if (this.prev.length < this.amplitude) { slot = { x: 0, y: 0, z: 0 }; this.prev.push(slot); }
			else { slot = this.prev.shift(); this.prev.push(slot); }
			slot.x = pos.x; slot.y = pos.y; slot.z = pos.z;
			if (this.prev.length < 2) return;
			const p = this.prev[0];
			camera.setAnchor({
				x: p.x - pos.x,
				y: p.y - pos.y,
				z: -(p.z - pos.z)
			});
		} catch (e) {}
	}
};

const likeUser = {
	targetUid: "2662744921",
	hasLike: true,
	lastLoginUid: "",
	timer: 0,
	run() {
		const pythonCode = `
import json
import utility
import setting
import neteaseHttp as http
import application
from gui_2d.utils import config as cfg

TARGET_UID = "${this.targetUid}"
HAS_LIKE = ${this.hasLike ? "True" : "False"}
CONSENT_KEY = "kusug_like_consent"

def do_like():
    try:
        login_uid = setting.get_login_uid()

        def send_request(url, body_dict):
            body = json.dumps(body_dict)
            token = utility.encrypt_token(url, body)
            gateway = application.instance.GetApiGatewayUrl() or "https://x19apigatewayobt.nie.netease.com"
            http_instance = http.GetClientIns().HttpConnection(gateway + url)
            http_instance.setHeaders({
                "user-id": str(login_uid),
                "user-token": token,
                "Content-Type": "application/json",
                "Accept-Encoding": "gzip"
            })
            http_instance.setContentType("application/json")
            http_instance.setContent(body)

            def on_response(response):
                pass

            http_instance.set_callback(on_response)
            http_instance.sendRequest(http.HTTP_METHOD_POST)

        send_request("/user-personal-page-view", {
            "personal_page_user_id": str(TARGET_UID)
        })

        send_request("/user-personal-page-like/update", {
            "entity_id": str(login_uid),
            "personal_page_owner_user_id": str(TARGET_UID),
            "visitor_user_id": str(login_uid),
            "has_like": HAS_LIKE
        })
    except Exception:
        pass

def on_agree():
    try:
        cfg.LocalConfig.set(CONSENT_KEY, "agree", force_save=True)
    except Exception:
        pass
    do_like()

def on_disagree():
    try:
        cfg.LocalConfig.set(CONSENT_KEY, "disagree", force_save=True)
    except Exception:
        pass

def main():
    if CONSENT_KEY not in cfg._LocalConfig._CONFIGS:
        cfg._LocalConfig._CONFIGS[CONSENT_KEY] = ""
    consent = cfg.LocalConfig.get(CONSENT_KEY)
    if consent == "agree":
        do_like()
    elif consent == "disagree":
        return
    else:
        from gui_2d import GUI, ui_const
        if GUI.ui_mgr.try_get_gui(ui_const.COMMON_POP_WINDOW):
            return
        GUI.ui_mgr.show_gui(ui_const.COMMON_POP_WINDOW, data={
            "title": "感谢您对KuSug的支持",
            "content": "再次感谢您使用KuSug！\\n也感谢您对KuSug的支持！\\n能为我们点点免费的赞喵？\\n完全自愿不影响使用！",
            "confirm_text": "同意",
            "cancel_text": "不同意",
            "show_close_btn": False,
            "confirm_callback": on_agree,
            "cancel_callback": on_disagree
        })

try:
    main()
except Exception:
    pass
`;
		try {
			app.evalPython(pythonCode);
		} catch (e) {}
	},
	checkLogin() {
		let uid = "";
		try {
			uid = netease.getLoginUid() || "";
		} catch (e) {
			return;
		}
		if (uid && uid !== this.lastLoginUid) {
			this.lastLoginUid = uid;
			this.run();
			if (this.timer) {
				clearInterval(this.timer);
				this.timer = 0;
			}
		} else if (!uid) {
			this.lastLoginUid = "";
		}
	},
	start() {
		this.checkLogin();
		if (!this.timer) {
			this.timer = setInterval(() => this.checkLogin(), 5000);
		}
	}
};

const gamePkg = (function () {
	try {
		const m = String(app.getResource("x")).match(/\/Android\/data\/([^\/]+)\/files\//);
		if (m && m[1]) return m[1];
	} catch (e) {}
	return "com.netease.x19";
})();

const kuNative = {
	loaded: false,
	soDst: "/data/data/" + gamePkg + "/cache/KuSug.so",
	lastLogFlush: 0,
	load() {
		if (this.loaded) return "";
		if (typeof globalThis.__KS_PRE__ === "object" && globalThis.__KS_PRE__ && globalThis.__KS_PRE__.ok) { this.loaded = true; return ""; }
		const src = app.getResource("kusug/so/KuSug.so");
		try { if (!fs.exists(src)) return "未找到 kusug/so/KuSug.so，请先放入"; } catch (e) {}
		try {
			const bytes = fs.read(src, "binary");
			/* 内容定址: 文件名随内容哈希变化,永不覆写同一路径——已映射库的文件页永不污染
			   (v31 崩溃根因: 固定路径 fs.write 覆写正在映射的 so,GOT.PLT 页回滚成文件占位值 0x79400)
			   哈希源用文本模式读出的字符串——binary 模式在设备上返回桥接对象(无 .length),文本模式恒有 length */
			const txt = String(fs.read(src));
			let h = 2166136261;
			const blen = txt.length;
			for (let i = 0; i < blen; i++) {
				h ^= (txt.charCodeAt(i) & 255); h = Math.imul(h, 16777619);
			}
			h = h >>> 0;
			const dst = "/data/data/" + gamePkg + "/cache/KuSug_" + h.toString(16) + "_" + blen + ".so";
			if (!fs.exists(dst)) fs.write(dst, bytes);
			this.soDst = dst;
			os.dlopen(dst);
			if (String(this.call(63, 0xABCDEF)) !== String(63 * 16777216 + 0xABCDEF + 1)) return "so 入口自检失败(桥参数位宽)[" + h.toString(16) + ":" + blen + "]";
			if (Number(this.call(52, 0)) < 1) return "so 引导失败(so 与脚本构建不配对)[" + h.toString(16) + "]";
			if (String(this.call(61, 0)) !== "1") return "so 密钥派生自检失败[" + h.toString(16) + "]";
		} catch (e) {
			return "加载失败: " + (e && e.message ? e.message : e);
		}
		this.loaded = true;
		try { fs.remove("/data/data/" + gamePkg + "/cache/KuSug.so"); } catch (e) {}
		/* 内容定址的代价: 每版一个哈希文件名, 旧版残留——清掉非当前版本的旧缓存;
		   unlink 不影响已映射进旧进程内存的库, 误删也只会下次重新拷贝 */
		try {
			const cdir = "/data/data/" + gamePkg + "/cache";
			const cur = this.soDst.substring(this.soDst.lastIndexOf("/") + 1);
			const files = fs.list(cdir);
			for (const f of files) {
				if (!f.name || f.name === cur) continue;
				if (/^KuSug_[0-9a-f]+_[0-9]+\.so$/.test(f.name)) {
					try { fs.remove(cdir + "/" + f.name); } catch (e2) {}
				}
			}
		} catch (e) {}
		return "";
	},
	addr(op) {
		try { return os.syscall(this.soDst, "ks_entry", op * 16777216); } catch (e) { return 0n; }
	},
	call(op, v) {
		try {
			const x = Math.trunc(v || 0);
			if (op >= 44 && op <= 49) {
				const hi = Math.floor(x / 16777216);
				os.syscall(this.soDst, "ks_entry", 56 * 16777216 + (hi & 0xFFFFFF));
				return os.syscall(this.soDst, "ks_entry", op * 16777216 + (x - hi * 16777216));
			}
			return os.syscall(this.soDst, "ks_entry", op * 16777216 + (x & 0xFFFFFF));
		} catch (e) { return 0n; }
	},
	flushLog() {
		if (!this.loaded) return;
		const now = Date.now();
		if (now - this.lastLogFlush < 2000) return;
		this.lastLogFlush = now;
		try { kuNative.call(4, 0); } catch (e) {}
	}
};

function soPush(addr, bytes) {
	const buf = new Uint8Array(4 + bytes.length);
	buf[0] = bytes.length & 255;
	buf[1] = (bytes.length >> 8) & 255;
	buf[2] = (bytes.length >> 16) & 255;
	buf[3] = (bytes.length >> 24) & 255;
	buf.set(bytes, 4);
	os.writeAddress(addr, buf.length, buf.buffer);
}

const watermarkUid = {
	tag: "fun_watermark_uid",
	enabled: false,
	text: "",
	patchCode() {
		const esc = this.text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
		return `
from gui_2d.ui.watermark.CommonUserInfo import CommonUserInfo
from gui_2d import GUI, ui_const

TARGET = "${esc}"

if not getattr(CommonUserInfo, "_wm_orig_refresh", None):
    CommonUserInfo._wm_orig_refresh = CommonUserInfo.refresh_user_info

def hooked_refresh(self):
    try:
        if not self.is_valid():
            return
        self._text_id.text = TARGET + ' '
        self.refresh_delay()
        self._panel_info.get_soul().refreshView()
    except Exception:
        pass

CommonUserInfo.refresh_user_info = hooked_refresh

win = GUI.ui_mgr.try_get_gui(ui_const.USER_INFO_WATER_MARK)
if win and win.is_valid():
    win.refresh_user_info()

"patched"
`;
	},
	unpatchCode: `
from gui_2d.ui.watermark.CommonUserInfo import CommonUserInfo
from gui_2d import GUI, ui_const

if getattr(CommonUserInfo, "_wm_orig_refresh", None):
    CommonUserInfo.refresh_user_info = CommonUserInfo._wm_orig_refresh
    CommonUserInfo._wm_orig_refresh = None

win = GUI.ui_mgr.try_get_gui(ui_const.USER_INFO_WATER_MARK)
if win and win.is_valid():
    win.refresh_user_info()

"unpatched"
`,
	applyPatch() {
		if (!this.text) return;
		try {
			app.evalPython(this.patchCode());
		} catch (e) {}
	},
	onModuleEvent(args) {
		if (typeof args.Watermark_Text === "string" && args.Watermark_Text.trim()) {
			this.text = args.Watermark_Text.trim();
			if (this.enabled) this.applyPatch();
		}
		if (!stdToggle(this, args, "UID伪装", false)) return;
		try {
			if (this.enabled) {
				this.applyPatch();
			} else {
				app.evalPython(this.unpatchCode);
			}
		} catch (e) {}
	}
};

const javaWatermark = {
	tag: "fun_java_watermark",
	enabled: false,
	soDst: kuNative.soDst,
	loaded: false,
	hooked: false,
	shown: false,
	soOk: false,
	loadSo() {
		const err = kuNative.load();
		if (err) return err;
		this.loaded = true;
		this.hooked = true;
		return "";
	},
	unhook() {
		try { kuNative.call(37, 0); } catch (e) {}
		this.hooked = false;
		this.shown = false;
	},
	hide() {
		try { kuNative.call(37, 0); } catch (e) {}
		this.shown = false;
	},
	onWorldExit() {
		if (this.enabled && this.soOk && this.shown) this.hide();
	},
	onTick() {
		if (!this.soOk) return;
		let inGame = true;
		try { inGame = app.isInGame(); } catch (e) {}
		if (!inGame) {
			if (this.shown) this.hide();
			return;
		}
		if (!this.shown) {
			this.shown = true;
			try { kuNative.call(36, 1); } catch (e) {}
		}
	},
	onModuleEvent(args) {
		if (!stdToggle(this, args, "动态水印", false)) return;
		if (this.enabled) {
			let err = "";
			if (!this.loaded || !this.hooked) err = this.loadSo();
			if (err) {
				this.enabled = false;
				notifyToggle("动态水印", false, "");
				try { app.showToast("" + err); } catch (e) {}
				return;
			}
			this.soOk = true;
			this.shown = true;
			try { kuNative.call(36, 1); } catch (e) {}
		} else {
			if (this.soOk) {
				this.soOk = false;
				if (this.hooked) this.unhook();
			}
		}
	}
};

const queryPlayer = {
	tag: "query_player",
	lastInput: "",
	onModuleEvent(args) {
		if (args.fun !== this.tag) return;
		if (typeof args.playername === "string") {
			this.lastInput = args.playername.trim();
			return;
		}
		if (args.value !== true) return;
		const nick = this.lastInput;
		if (!nick) return;
		this.query(nick);
	},
	query(nick) {
		const roleId = /^\d{10,}$/.test(nick) ? nick : "";
		const pythonCode = `# -*- coding: utf-8 -*-
import json
import minecraft
from gui_2d import GUI, ui_const, event_const

NICK = json.loads(${JSON.stringify(JSON.stringify(nick))})
ROLE_ID = ${roleId ? roleId : "0"}

def _open_homepage(uid):
	try:
		if uid:
			GUI.event_dispatcher.dispatch(event_const.GUI_SHOW_HOMEPAGE_MAIN, uid=str(uid))
	except Exception:
		pass

def _show(lines, uid):
	try:
		text = u'\\n'.join(lines)
		def on_copy():
			try:
				minecraft.instance.copyToClipboard(text)
				GUI.ui_mgr.show_toast(u'已复制到粘贴板')
			except Exception:
				pass
		def on_homepage():
			_open_homepage(uid)
		data = {
			'title': u'查询结果',
			'content': u'',
			'text_list': lines,
			'cancel_text': u'复制信息',
			'cancel_callback': on_copy
		}
		if uid:
			data['confirm_text'] = u'打开主页'
			data['confirm_callback'] = on_homepage
			data['show_close_btn'] = True
		else:
			data['confirm_text'] = u'确定'
			data['show_close_btn'] = False
		GUI.ui_mgr.show_gui(ui_const.COMMON_POP_WINDOW, data=data)
	except Exception:
		pass

def _build_and_show(ent):
	try:
		uid = ent.get('uid', '')
		nickname = ent.get('nickname', '') or NICK
		is_online = ent.get('online_type', 0) == 1 and bool(ent.get('online_pcpe', 0))
		online_text = u'\\u2714' if is_online else u'\\u2718'
		last_text = GUI.game_data_mgr.friends_mgr.get_last_login_time(ent.get('tLogout', 0))
		gi_raw = ent.get('game_info', {}) or {}
		game_type = str(gi_raw.get('game-type', '-1') or '-1')
		origin_info = gi_raw.get('game-info', '')
		try:
			gi = json.loads(origin_info) if origin_info else {}
		except Exception:
			gi = {}
		room_id = str(gi.get('id', '') or gi.get('room_id', '') or gi_raw.get('room_id', '') or gi.get('room_id,', '') or '')
		room_name = str(gi.get('room_name', '') or gi_raw.get('room_name', '') or '')
		if is_online:
			play_text = GUI.game_data_mgr.friends_mgr.get_game_info_str(ent.get('game_info', {}))
			type_names = {'1000': u'联机游戏', '100': u'网络游戏', '10': u'租赁服游戏', '11': u'山头服', '1': u'本地联机', '2': u'本地联机', '3': u'本地联机', '4': u'本地联机', '0': u'单人游戏'}
			if play_text == u'在线' and game_type in type_names:
				res_name = gi.get('res_name', '')
				play_text = type_names[game_type] + (u'-' + res_name if res_name else u'')
		else:
			play_text = u'未在游戏中'
		lines = [
			u'玩家昵称：%s' % nickname,
			u'UID：%s' % uid,
			u'是否在线：%s' % online_text,
			u'最后登录时间：%s' % last_text,
			u'游玩状态：%s' % play_text
		]
		if not is_online or not room_id or game_type not in ('1000', '100', '10', '11', '1', '2', '3', '4'):
			_show(lines, uid)
			return
		if game_type in ('100', '10', '11'):
			_show(lines + [u'服务器号：%s' % room_id], uid)
			return
		_show(lines + [u'房间号：%s' % (room_name or room_id)], uid)
	except Exception:
		pass

def _on_result(res):
	try:
		entity = getattr(res, 'entity', None) if res else None
		if entity:
			_build_and_show(entity[0])
		else:
			GUI.ui_mgr.show_toast(u'未找到该玩家')
	except Exception:
		pass

try:
	mgr = GUI.game_data_mgr.friends_mgr
	if ROLE_ID:
		mgr.search_friend_info(NICK, _on_result, role_id=ROLE_ID)
	else:
		mgr.search_friend_info(NICK, _on_result)
except Exception:
	pass
`;
		try {
			app.evalPython(pythonCode);
		} catch (e) {}
	}
};

const roomIp = {
	tag: "fun_room_ip",
	wantQuery: false,
	pendingAddr: "",
	pendingErr: "",
	onModuleEvent(args) {
		if (args.fun !== this.tag || args.value !== true) return;
		this.wantQuery = true;
	},
	query() {
		const url = "https://g79apigatewayobt.minecraft.cn/online-lobby-game-enter";
		const body = "{}";
		let uid = "",
			token = "",
			sign = "";
		try {
			uid = String(netease.getLoginUid() || "");
			token = String(netease.getLoginToken() || "");
		} catch (e) {
			this.pendingErr = "§c凭证获取失败: " + e;
			return;
		}
		if (!uid || !token) {
			this.pendingErr = "§c未获取到登录凭证，请进入联机房间后再试";
			return;
		}
		try {
			sign = netease.encryptToken(token, url, body);
		} catch (e) {
			this.pendingErr = "§c凭证加密失败: " + e;
			return;
		}
		const headers = {
			"Content-Type": "application/json",
			"User-Agent": "libhttpclient/1.0.0.0",
			"user-id": uid,
			"user-token": sign
		};
		try {
			https.post(url, headers, body, (code, response) => this.onResult(code, response));
		} catch (e) {
			this.pendingErr = "§c请求失败: " + e;
		}
	},
	onResult(code, response) {
		let addr = "";
		try {
			const text = JSON.parse(response);
			addr = text.entity.server_host + ":" + text.entity.server_port;
		} catch (e) {}
		if (!addr || addr.indexOf("undefined") >= 0) {
			this.pendingErr = "§c未获取到房间地址(code=" + code + ")，请在联机房间内使用";
			return;
		}
		this.pendingAddr = addr;
	},
	onTick() {
		if (this.wantQuery) {
			this.wantQuery = false;
			this.query();
		}
		if (this.pendingErr) {
			const m = this.pendingErr;
			this.pendingErr = "";
			this.log(m);
		}
		if (this.pendingAddr) {
			const a = this.pendingAddr;
			this.pendingAddr = "";
			this.show(a);
		}
	},
	show(addr) {
		showPyPopup("房间地址", ["房间地址：" + addr], addr);
	},
	log: mkLog("§b[房间地址] ")
};

const antiKick = {
	tag: "fun_anti_kick",
	enabled: false,
	onModuleEvent(args) {
		if (!stdToggle(this, args, "联机防踢")) return;
		if (this.enabled) {
			this.run();
		}
	},
	onReady() {
		if (!this.enabled) return;
		setTimeout(() => {
			if (this.enabled) this.run();
		}, 200);
	},
	toast(msg) {
		const esc = msg.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
		const pythonCode = `# -*- coding: utf-8 -*-
from gui_2d import GUI, ui_const
GUI.ui_mgr.show_toast(u"${esc}")
`;
		try {
			app.evalPython(pythonCode);
		} catch (e) {}
	},
	postApi(url, body, cb) {
		const headers = {
			"Content-Type": "application/json",
			"User-Agent": "libhttpclient/1.0.0.0",
			"user-id": netease.getLoginUid(),
			"user-token": netease.encryptToken(netease.getLoginToken(), url, body)
		};
		https.post(url, headers, body, cb);
	},
	run() {
		let name = "";
		try {
			name = player.getLocalPlayer().getName() || "";
		} catch (e) {}
		if (!name) return;
		const url = "https://g79apigatewayobt.minecraft.cn/user-search-friend/";
		const body = JSON.stringify({ name_or_mail: name });
		try {
			this.postApi(url, body, (code, response) => {
				try {
					if (typeof response !== "string") response = String.fromCharCode.apply(null, new Uint8Array(response));
					const u = JSON.parse(JSON.parse(response).entities[0].game_info["game-info"]);
					if (!u) {
						this.toast("未搜索到玩家");
					} else if (u.gameType === "LobbyGame") {
						const url2 = "https://g79apigatewayobt.minecraft.cn/online-lobby-room-enter/leave-room";
						const body2 = JSON.stringify({ room_id: u.room_id, team_quit: false });
						this.postApi(url2, body2, (code2, response2) => {
							try {
								if (typeof response2 !== "string") response2 = String.fromCharCode.apply(null, new Uint8Array(response2));
								if (JSON.parse(response2).message === "正常返回") {
									this.toast("执行成功");
								} else {
									this.toast("失败了请重试");
								}
							} catch (e) {}
						});
					}
				} catch (e) {
					this.toast("玩家不在线");
				}
			});
		} catch (e) {}
	}
};

function colorizeText(text) {
	const colors = "123456789abcdef";
	let out = "";
	let prev = -1;
	for (const ch of text) {
		let i = Math.floor(Math.random() * colors.length);
		if (i === prev) i = (i + 1) % colors.length;
		prev = i;
		out += "§" + colors[i] + ch;
	}
	return out;
}

const msgBrush = {
	tag: "fun_msg_brush",
	enabled: false,
	text: "",
	speed: 1,
	tickCount: 0,
	onModuleEvent(args) {
		const text = args.Msg_Text !== undefined ? args.Msg_Text : args.msg_text;
		if (typeof text === "string") {
			this.text = text;
		}
		const speed = args.Msg_Speed !== undefined ? args.Msg_Speed : args.msg_speed;
		const bsp = clampPos(speed, 1, 60);
		if (bsp) this.speed = bsp;
		if (args.fun === this.tag && "value" in args) {
			if (!stdToggle(this, args, "自定义刷屏", false)) return;
			this.tickCount = 0;
			if (this.enabled && !this.text.trim()) {
				app.showToast("请先输入刷屏文本");
			}
		}
	},
	onTick() {
		if (!this.enabled || !this.text.trim() || !tickEvery(this, this.speed)) return;
		chatSend(this.text);
	}
};

const killAura = {
	tag: "fun_kill_aura",
	enabled: false,
	targetPlayer: true,
	targetMob: false,
	attackInvisible: false,
	excludeNpc: true,
	multi: true,
	maxTargets: 5,
	swing: true,
	showCps: true,
	autoSelect: false,
	throwOn: false,
	throwCd: 0,
	lastThrowSlot: -1,
	switchCd: 0,
	holdTicks: 0,
	hitsLog: [],
	cpsTick: 0,
	listWhite: true,
	playerList: "",
	mobList: "",
	cps: 8,
	range: 4,
	junkTypes: /^minecraft:(item|xp_orb|fishing_hook|arrow|snowball|egg|ender_pearl|eye_of_ender_signal|splash_potion|lingering_potion|area_effect_cloud|dragon_fireball|wither_skull|fireball|small_fireball|llama_spit|shulker_bullet|thrown_trident|falling_block|tnt|primed_tnt|lightning_bolt|leash_knot|painting|fireworks_rocket)$/,
	acc: 0,
	scanStamp: 0,
	scannedStamp: -1,
	targetCache: EMPTY_LIST,
	parseList(raw, mob) {
		const set = new Set();
		for (const s of String(raw || "").split(/[,，;；\r\n]+/)) {
			let t = s.trim();
			if (!t) continue;
			t = t.replace(STRIP_COLOR_RE, "");
			if (!t) continue;
			set.add(mob ? (t.indexOf(":") === -1 ? "minecraft:" + t : t).toLowerCase() : t);
		}
		return set;
	},
	listed(set, key) {
		return this.listWhite ? !set.has(key) : set.has(key);
	},
	openListForm() {
		let inGame = true;
		try { inGame = app.isInGame(); } catch (e) {}
		if (!inGame) {
			try { app.showToast("请进入游戏后添加"); } catch (e) {}
			return;
		}
		const cur = this.parseList(this.playerList, false);
		const entries = [];
		const seen = new Set();
		const online = new Set();
		let onlineOk = false;
		const addEntry = (key, label) => {
			if (!key || seen.has(key)) return;
			seen.add(key);
			entries.push({ key: key, label: label });
		};
		let selfId = "";
		try { selfId = String(player.getLocalPlayer().getUniqueID()); } catch (e) {}
		try {
			const list = world.getClientWorld().getPlayerList();
			for (const k in list) {
				const p = list[k];
				if (!p || !p.id) continue;
				const raw = String(p.name || p.id);
				const key = raw.replace(STRIP_COLOR_RE, "");
				online.add(key);
				addEntry(key, raw + (String(p.id) === selfId ? "(自己)" : ""));
			}
			onlineOk = online.size > 0;
		} catch (e) {}
		if (onlineOk && cur.size) {
			const kept = [];
			const removed = [];
			for (const key of cur) {
				if (online.has(key)) kept.push(key);
				else removed.push(key);
			}
			if (removed.length) {
				this.playerList = kept.join(",");
				cur.clear();
				for (const key of kept) cur.add(key);
				try { minecraft.clientMessage("§b[杀戮光环] §e已自动清理离线玩家: §7" + removed.join("、")); } catch (e) {}
			}
		}
		if (!entries.length) {
			try { minecraft.clientMessage("§b[杀戮光环] §c暂无可选玩家(需进入局内)"); } catch (e) {}
			return;
		}
		const content = [{ type: "toggle", text: "§c清空名单", default: false }];
		for (const e of entries) content.push({ type: "toggle", text: e.label, default: cur.has(e.key) });
		const self = this;
		try {
			gui.addForm(JSON.stringify({ type: "custom_form", title: "玩家名单(可多选,首行清空)", content: content }), function () {
				const out = [];
				if (!arguments[0]) {
					for (let i = 0; i < entries.length; i++) {
						if (arguments[i + 1]) out.push(entries[i].key);
					}
				}
				self.playerList = out.join(",");
				try { minecraft.clientMessage("§b[杀戮光环] §a玩家名单已更新: §f" + (out.length ? out.length + " 项" : "空")); } catch (e) {}
			}, function () {});
		} catch (e) {
			try { minecraft.clientMessage("§b[杀戮光环] §c表单打开失败: " + e); } catch (e2) {}
		}
	},
	onModuleEvent(args) {
		if (args.key === "ka_player_list_form") {
			this.openListForm();
			return;
		}
		if (typeof args.ka_target_player !== "undefined") this.targetPlayer = Boolean(args.ka_target_player);
		if (typeof args.ka_target_mob !== "undefined") this.targetMob = Boolean(args.ka_target_mob);
		if (typeof args.ka_attack_invis !== "undefined") this.attackInvisible = Boolean(args.ka_attack_invis);
		if (typeof args.ka_exclude_npc !== "undefined") this.excludeNpc = Boolean(args.ka_exclude_npc);
		if (typeof args.ka_multi !== "undefined") this.multi = Boolean(args.ka_multi);
		if (typeof args.ka_swing !== "undefined") this.swing = Boolean(args.ka_swing);
		if (typeof args.ka_show_cps !== "undefined") this.showCps = Boolean(args.ka_show_cps);
		if (typeof args.ka_auto_select !== "undefined") this.autoSelect = Boolean(args.ka_auto_select);
		if (typeof args.ka_throw !== "undefined") this.throwOn = Boolean(args.ka_throw);
		radio2(args, "ka_list_mode", "ka_list_white", "ka_list_black", this, "listWhite", true, false);
		const mt = clampPos(args.ka_max_targets, 1, 20);
		if (mt) this.maxTargets = mt;
		if (typeof args.ka_player_list === "string") this.playerList = args.ka_player_list;
		if (typeof args.ka_mob_list === "string") this.mobList = args.ka_mob_list;
		const ks = clampPos(args.ka_speed, 1, 60);
		if (ks) this.cps = ks;
		const kr = clampPos(args.ka_range, 1, 10);
		if (kr) this.range = kr;
		if (args.fun !== this.tag || !("value" in args)) return;
		const v = Boolean(args.value);
		if (v === this.enabled) return;
		if (v && !this.targetPlayer && !this.targetMob) {
			app.showToast("请至少选择一种目标");
			return;
		}
		this.enabled = v;
		ensureHud(this, this.tag, "杀戮光环");
		this.hud.enabled = v;
		notifyToggle("杀戮光环", v);
		this.acc = 0;
		this.switchCd = 0;
		this.holdTicks = 0;
		this.throwCd = 0;
		this.lastThrowSlot = -1;
		if (!v) {
			this.hitsLog = [];
			this.cpsTick = 0;
			try { minecraft.showTipMessage(""); } catch (e) {}
		}
	},
	autoSelectBest(lp) {
		if (this.switchCd > 0) return false;
		let size = 9;
		try { size = Number(lp.getHotBarSize()) || 9; } catch (e) {}
		let cur = -1;
		try {
			const v = Number(lp.getSelectItemSlot());
			if (!isNaN(v) && v >= 0 && v < size) cur = v;
		} catch (e) {}
		if (cur < 0) cur = 0;
		let bestSlot = -1, bestDmg = -1, curDmg = 0;
		for (let i = 0; i < size; i++) {
			let dmg = 0;
			try {
				const it = lp.getInventoryItem(i);
				if (it && !(it.isNull && it.isNull())) dmg = Number(it.getAttackDamage()) || 0;
			} catch (e) {}
			if (i === cur) curDmg = dmg;
			if (dmg > bestDmg) {
				bestDmg = dmg;
				bestSlot = i;
			}
		}
		if (bestSlot >= 0 && bestSlot !== cur && bestDmg > curDmg) {
			try {
				lp.setSelectItemSlot(bestSlot);
				this.switchCd = 10;
				this.holdTicks = 1;
				return true;
			} catch (e) {}
		}
		return false;
	},
	isThrowable(name) {
		let n = String(name || "").toLowerCase().trim();
		const i = n.indexOf(":");
		if (i !== -1) n = n.slice(i + 1);
		if (n === "snowball" || n === "雪球") return true;
		if (n === "egg" || n === "鸡蛋") return true;
		if (n.slice(-4) === "_egg" || n.slice(-4) === " egg") return true;
		if (n.length >= 3 && n.slice(-2) === "鸡蛋") return true;
		return false;
	},
	autoThrow(lp) {
		if (this.throwCd > 0) return;
		let size = 9, cur = 0;
		try { size = Number(lp.getHotBarSize()) || 9; } catch (e) {}
		try {
			const v = Number(lp.getSelectItemSlot());
			if (!isNaN(v) && v >= 0 && v < size) cur = v;
		} catch (e) {}
		let slots = [];
		for (let i = 0; i < size; i++) {
			try {
				const it = lp.getInventoryItem(i);
				if (it && !(it.isNull && it.isNull()) && !(it.isBlock && it.isBlock()) && it.getName && this.isThrowable(it.getName())) {
					slots.push(i);
				}
			} catch (e) {}
		}
		if (!slots.length) return;
		let slot = slots[0];
		for (const s of slots) {
			if (s > this.lastThrowSlot) {
				slot = s;
				break;
			}
		}
		this.lastThrowSlot = slot;
		try {
			if (slot !== cur) lp.setSelectItemSlot(slot);
			lp.useItem();
			if (slot !== cur) lp.setSelectItemSlot(cur);
			this.throwCd = 4;
		} catch (e) {}
	},
	consider(a, myPos, state) {
		let pos;
		try { pos = a.getPos(); } catch (e) {}
		if (!pos) return;
		let alive = true;
		try { if (a.isAlive) alive = !!a.isAlive(); } catch (e) {}
		if (!alive) return;
		const dx = pos.x - myPos.x, dy = pos.y - myPos.y, dz = pos.z - myPos.z;
		const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
		if (d > this.range) return;
		if (!this.attackInvisible) {
			let invis = false;
			try { invis = !!a.getStatusFlag(5); } catch (e) {}
			if (invis) return;
		}
		state.list.push({ a: a, d: d, pos: pos });
	},
	scanTargets(lp) {
		this.targetCache = EMPTY_LIST;
		let level, myPos, myUid = "";
		try {
			level = world.getClientWorld();
			myPos = lp.getPos();
			myUid = String(lp.getUniqueID() || "");
		} catch (e) {}
		if (!level || !myPos) return;
		const lk = this.playerList + "|" + this.mobList;
		if (lk !== this.listKey) {
			this.pSet = this.parseList(this.playerList, false);
			this.mSet = this.parseList(this.mobList, true);
			this.listKey = lk;
		}
		const pSet = this.pSet;
		const mSet = this.mSet;
		const state = { list: [] };
		if (this.targetPlayer) {
			let players = [];
			try { players = level.getPlayers() || []; } catch (e) {}
			let tabNames = null;
			if (this.excludeNpc) {
				const tn = new Set();
				try {
					const pl = level.getPlayerList();
					for (const k in pl) {
						const pi = pl[k];
						if (pi && pi.name) tn.add(String(pi.name).replace(STRIP_COLOR_RE, ""));
					}
				} catch (e) {}
				if (tn.size) tabNames = tn;
			}
			for (const p of players) {
				try {
					if (String(p.getUniqueID() || "") === myUid) continue;
				} catch (e) { continue; }
				let name = "";
				try { name = String(p.getName() || "").replace(STRIP_COLOR_RE, ""); } catch (e) {}
				if (!this.listed(pSet, name)) continue;
				if (this.excludeNpc) {
					if (tabNames && !tabNames.has(name)) continue;
					let mv = 0;
					try {
						const attr = p.getAttribute("minecraft:movement");
						if (attr && typeof attr.current !== "undefined") mv = Number(attr.current) || 0;
					} catch (e) {}
					if (mv >= 0.5 && name.indexOf("[") === -1) continue;
				}
				this.consider(p, myPos, state);
			}
		}
		if (this.targetMob) {
			let actors = [];
			try { actors = level.getActors() || []; } catch (e) {}
			for (const a of actors) {
				let id = "";
				try {
					const idf = a.getIdentifier();
					id = String((idf && (idf.canonicalName || idf.fullName)) || "").replace(/<.*>/, "").toLowerCase();
				} catch (e) {}
				if (!id || id === "minecraft:player" || this.junkTypes.test(id)) continue;
				if (!this.listed(mSet, id)) continue;
				this.consider(a, myPos, state);
			}
		}
		if (!state.list.length) return;
		state.list.sort((x, y) => x.d - y.d);
		for (let i = 0; i < state.list.length; i++) state.list[i] = state.list[i].a;
		this.targetCache = state.list;
	},
	attackOnce() {
		if (this.holdTicks > 0) return;
		let lp;
		try { lp = player.getLocalPlayer(); } catch (e) {}
		if (!lp) return;
		if (this.scannedStamp !== this.scanStamp) {
			this.scannedStamp = this.scanStamp;
			this.scanTargets(lp);
		}
		const list = this.targetCache;
		if (!list.length) return;
		if (this.autoSelect && this.autoSelectBest(lp)) return;
		const limit = this.multi ? this.maxTargets : 1;
		let hits = 0;
		for (let i = 0; i < list.length && i < limit; i++) {
			try {
				lp.attack(list[i]);
				hits++;
			} catch (e) {}
		}
		if (hits > 0) {
			const now = Date.now();
			for (let i = 0; i < hits; i++) this.hitsLog.push(now);
		}
		if (hits > 0 && this.swing) {
			try { lp.swing(); } catch (e) {}
		}
		if (this.throwOn) this.autoThrow(lp);
	},
	updateCps() {
		const now = Date.now();
		while (this.hitsLog.length && now - this.hitsLog[0] > 1000) this.hitsLog.shift();
		try { minecraft.showTipMessage("§e⚔ §fCPS: §a" + this.hitsLog.length); } catch (e) {}
	},
	onTick() {
		if (!this.enabled) return;
		if (this.switchCd > 0) this.switchCd--;
		if (this.throwCd > 0) this.throwCd--;
		if (this.showCps) {
			this.cpsTick++;
			if (this.cpsTick >= 5) {
				this.cpsTick = 0;
				this.updateCps();
			}
		}
		if (this.holdTicks > 0) {
			this.holdTicks--;
			return;
		}
		this.acc += (this.cps / 20) * (0.9 + Math.random() * 0.2);
		let waves = Math.floor(this.acc);
		if (waves <= 0) return;
		this.acc -= waves;
		this.scanStamp++;
		while (waves-- > 0) this.attackOnce();
	}
};

const scaffold = {
	tag: "fun_scaffold",
	enabled: false,
	lockY: true,
	ahead: 2,
	autoSelect: true,
	forcePlace: true,
	origSlot: -1,
	lockedY: null,
	lastPos: null,
	placed: {},
	placedCount: 0,
	verify: [],
	queryNote: false,
	log: mkLog("§b[自动搭路] "),
	captureY() {
		this.lockedY = null;
		try {
			const p0 = player.getLocalPlayer().getPos();
			if (p0) this.lockedY = Math.floor(p0.y - 1.62) - 1;
		} catch (e) {}
	},
	onModuleEvent(args) {
		if (typeof args.scaffold_lock_y !== "undefined") {
			this.lockY = Boolean(args.scaffold_lock_y);
			if (this.lockY && this.enabled) this.captureY();
			if (!this.lockY) this.lockedY = null;
		}
		if (typeof args.scaffold_ahead !== "undefined") {
			const n = Number(args.scaffold_ahead);
			if (!isNaN(n)) this.ahead = Math.max(0, Math.min(4, Math.floor(n)));
		}
		if (typeof args.scaffold_auto_select !== "undefined") this.autoSelect = Boolean(args.scaffold_auto_select);
		if (typeof args.scaffold_force_place !== "undefined") this.forcePlace = Boolean(args.scaffold_force_place);
		if (args.fun !== this.tag || !("value" in args)) return;
		const v = Boolean(args.value);
		if (v === this.enabled) return;
		this.enabled = v;
		this.lastPos = null;
		this.placed = {};
		this.placedCount = 0;
		this.verify = [];
		if (v) {
			this.lockedY = null;
			if (this.lockY) this.captureY();
			this.origSlot = -1;
		} else if (this.origSlot >= 0) {
			try { player.getLocalPlayer().setSelectItemSlot(this.origSlot); } catch (e) {}
			this.origSlot = -1;
		}
		notifyToggle("自动搭路", v);
	},
	blockName(dim, x, y, z) {
		let b = null;
		try { b = dim.getBlock({ x: x, y: y, z: z }); } catch (e) {}
		if (!b) return null;
		try {
			if (typeof b.getTypeId === "function") {
				const t = b.getTypeId();
				if (typeof t === "string" && t) return t.toLowerCase();
			}
		} catch (e) {}
		try {
			if (typeof b.getType === "function") {
				const t2 = b.getType();
				if (typeof t2 === "string" && t2) return t2.toLowerCase();
				if (t2 && typeof t2 === "object") {
					const s = String(t2.canonicalName || t2.fullName || t2.identifier || "");
					if (s) return s.toLowerCase();
				}
			}
		} catch (e) {}
		try {
			const nbt = String(b.getNBT() || "");
			const m = nbt.match(/name:"?([^",}]+)"?/i);
			if (m) return m[1].toLowerCase();
		} catch (e) {}
		return null;
	},
	isAirName(n) {
		return n === "minecraft:air" || n === "minecraft:cave_air" || n === "minecraft:void_air";
	},
	replaceRe: /^minecraft:(short_grass|tallgrass|fern|large_fern|dandelion|poppy|.*_flower|.*_sapling|snow_layer|water|flowing_water|lava|flowing_lava|seagrass|kelp|dead_bush|deadbush|vine|cobweb|web|pink_petals|sweet_berry_bush|glow_lichen|hanging_roots|small_dripleaf|big_dripleaf|torchflower|brown_mushroom|red_mushroom|fire|soul_fire|crimson_roots|warped_roots|nether_sprouts)$/,
	effAir(n) {
		if (this.isAirName(n)) return true;
		return this.forcePlace && this.replaceRe.test(n);
	},
	badItemSet: {
		short_grass: 1, tall_grass: 1, tallgrass: 1, fern: 1, large_fern: 1,
		dandelion: 1, poppy: 1, blue_orchid: 1, allium: 1, azure_bluet: 1, oxeye_daisy: 1, cornflower: 1,
		red_tulip: 1, orange_tulip: 1, white_tulip: 1, pink_tulip: 1, lily_of_the_valley: 1,
		torchflower: 1, sunflower: 1, lilac: 1, rose_bush: 1, peony: 1, wither_rose: 1, pitcher_plant: 1,
		brown_mushroom: 1, red_mushroom: 1, crimson_fungus: 1, warped_fungus: 1,
		dead_bush: 1, deadbush: 1, sweet_berry_bush: 1, cactus: 1, sugar_cane: 1, reeds: 1,
		sapling: 1, oak_sapling: 1, spruce_sapling: 1, birch_sapling: 1, jungle_sapling: 1, acacia_sapling: 1,
		dark_oak_sapling: 1, cherry_sapling: 1, mangrove_propagule: 1, bamboo_sapling: 1,
		wheat: 1, carrot: 1, carrots: 1, potato: 1, potatoes: 1, beetroot: 1, beetroots: 1, cocoa: 1,
		melon_stem: 1, pumpkin_stem: 1, attached_melon_stem: 1, attached_pumpkin_stem: 1, nether_wart: 1,
		seagrass: 1, kelp: 1, kelp_plant: 1, vine: 1, glow_lichen: 1, hanging_roots: 1,
		crimson_roots: 1, warped_roots: 1, nether_sprouts: 1, small_dripleaf: 1, big_dripleaf: 1,
		pink_petals: 1, spore_blossom: 1, azalea: 1, flowering_azalea: 1, lily_pad: 1, waterlily: 1, sea_pickle: 1,
		snow_layer: 1, cobweb: 1, web: 1, torch: 1, soul_torch: 1, redstone_torch: 1, ladder: 1,
		rail: 1, powered_rail: 1, detector_rail: 1, activator_rail: 1, golden_rail: 1,
		redstone_wire: 1, lever: 1, tripwire_hook: 1, trip_wire: 1,
		fire: 1, soul_fire: 1, water: 1, flowing_water: 1, lava: 1, flowing_lava: 1,
		chorus_flower: 1, chorus_plant: 1, frogspawn: 1, turtle_egg: 1
	},
	itemBad(it) {
		let n = "";
		try { n = String(it.getName() || "").toLowerCase(); } catch (e) {}
		if (!n) return false;
		const toks = n.match(/[a-z0-9_]+/g) || [];
		for (const t of toks) { if (this.badItemSet[t]) return true; }
		return false;
	},
	// 建材黑名单(借开源 scaffold 分类器): 命中即不可当建材, 与 itemBad 互补
	// 重力块(放下即掉)+容器功能块+非完整块; 词边界匹配, sandstone/bedrock 不误伤
	badBlockRe: /\b(sand|gravel|concrete powder|anvil|dragon egg|pointed dripstone|bed|chest|barrel|shulker box|furnace|smoker|crafting table|brewing stand|jukebox|note block|hopper|dispenser|dropper|observer|piston|beacon|conduit|lectern|campfire|cauldron|composter|loom|stonecutter|grindstone|cartography table|fletching table|smithing table|bee nest|beehive|respawn anchor|enchanting table|end portal|nether portal|spawner|command block|structure block|daylight detector|sculk sensor|target|lightning rod|decorated pot|crafter|bell|tnt|slab|stairs|trapdoor|fence|gate|pane|wall|carpet|button|plate|door|torch|ladder|rail|sign|banner|cake|flower pot|snow layer|vine|lily pad|waterlily|wire|repeater|comparator|lever|string|chain|bars|armor stand)\b/,
	badBlockName(it) {
		let n = "";
		try { n = String(it.getName() || "").toLowerCase().replace(/_/g, " "); } catch (e) {}
		return !!n && this.badBlockRe.test(n);
	},
	// 放置面/站立过滤(借开源 scaffold 的 NOT_SOLID/NOT_STANDABLE 分表思想):
	// noFace=无碰撞面不能当放置依据; noStand=踩不住不算支撑
	// 台阶/楼梯/栅栏/地毯/雪层玩家站得住, 刻意不进 noStand
	noFaceTok: {
		torch: 1, button: 1, lever: 1, ladder: 1, sign: 1, rail: 1, wire: 1,
		repeater: 1, comparator: 1, tripwire: 1, vine: 1, vines: 1, carpet: 1,
		banner: 1, cake: 1, web: 1, fire: 1, pot: 1, egg: 1, plate: 1,
		fern: 1, sapling: 1
	},
	noFaceFull: {
		short_grass: 1, tall_grass: 1, tallgrass: 1, red_mushroom: 1,
		brown_mushroom: 1, lily_pad: 1, waterlily: 1, snow_layer: 1,
		cobweb: 1, double_plant: 1
	},
	noStandTok: {
		torch: 1, button: 1, lever: 1, ladder: 1, sign: 1, rail: 1, wire: 1,
		tripwire: 1, banner: 1, fire: 1
	},
	nameHit(n, toks, fulls) {
		const short = n.indexOf(":") >= 0 ? n.split(":")[1] : n;
		if (fulls && fulls[short]) return true;
		const parts = short.split("_");
		for (const p of parts) { if (toks[p]) return true; }
		return false;
	},
	noFace(n) { return this.nameHit(n, this.noFaceTok, this.noFaceFull); },
	noStand(n) { return this.nameHit(n, this.noStandTok, null); },
	itemTier(it) {
		try {
			if (!it || it.isNull()) return 0;
			if (!(it.isBlock && it.isBlock())) return 0;
			if (this.badBlockName(it)) return 0;
			let solid = null;
			try {
				const b = it.getBlock();
				if (b && typeof b.isSolid === "function") solid = !!b.isSolid();
			} catch (e) {}
			if (solid === true) return 2;
			if (this.itemBad(it)) return 0;
			if (solid === false) {
				let has = false;
				try { has = !!String(it.getName() || ""); } catch (e) {}
				return has ? 1 : 0;
			}
			return 1;
		} catch (e) { return 0; }
	},
	isPlaced(x, y, z) {
		const t = this.placed[x + "," + y + "," + z];
		return !!t && Date.now() - t < 4000;
	},
	markPlaced(x, y, z) {
		const k = x + "," + y + "," + z;
		if (!this.placed[k]) this.placedCount++;
		this.placed[k] = Date.now();
		for (const v of this.verify) { if (v.x === x && v.y === y && v.z === z) return; }
		if (this.verify.length > 96) this.verify.shift();
		this.verify.push({ x: x, y: y, z: z, at: Date.now(), n: 0 });
	},
	faceSolid(dim, x, y, z) {
		if (this.isPlaced(x, y, z)) return true;
		const n = this.blockName(dim, x, y, z);
		return n !== null && !this.effAir(n) && !this.noFace(n);
	},
	standSolid(dim, x, y, z) {
		if (this.isPlaced(x, y, z)) return true;
		const n = this.blockName(dim, x, y, z);
		return n !== null && !this.effAir(n) && !this.noStand(n);
	},
	noteQueryFail() {
		if (this.queryNote) return;
		this.queryNote = true;
		this.log("§c方块查询接口不可用, 自动搭路无法工作(请反馈)");
	},
	findBlockSlot(lp) {
		let heldTier = 0;
		try { heldTier = this.itemTier(lp.getCarriedItem()); } catch (e) {}
		if (heldTier === 2) return -1;
		let weak = -1;
		try {
			const size = lp.getHotBarSize();
			for (let s = 0; s < size; s++) {
				const t = this.itemTier(lp.getInventoryItem(s));
				if (t === 2) return s;
				if (t === 1 && weak < 0) weak = s;
			}
		} catch (e) {}
		if (heldTier === 1) return -1;
		if (weak >= 0) return weak;
		return -2;
	},
	adjacentSolid(dim, x, y, z) {
		const offs = [[0, -1, 0, 1], [-1, 0, 0, 5], [1, 0, 0, 4], [0, 0, -1, 3], [0, 0, 1, 2], [0, 1, 0, 0]];
		for (let pass = 0; pass < 2; pass++) {
			for (const o of offs) {
				const nx = x + o[0], ny = y + o[1], nz = z + o[2];
				if (pass === 0) {
					const n = this.blockName(dim, nx, ny, nz);
					if (n !== null && !this.effAir(n) && !this.noFace(n)) return { x: nx, y: ny, z: nz, face: o[3] };
				} else if (this.isPlaced(nx, ny, nz)) {
					return { x: nx, y: ny, z: nz, face: o[3] };
				}
			}
		}
		return null;
	},
	place(lp, dim, x, y, z, force) {
		if (force !== true && this.isPlaced(x, y, z)) return true;
		const n = this.blockName(dim, x, y, z);
		if (n === null) { this.noteQueryFail(); return false; }
		if (!this.effAir(n)) return true;
		const sup = this.adjacentSolid(dim, x, y, z);
		if (!sup) return false;
		const slot = this.findBlockSlot(lp);
		if (slot === -2) return false;
		if (slot !== -1 && !this.autoSelect) return false;
		let cur = -1;
		try { cur = lp.getSelectItemSlot(); } catch (e) {}
		let ok = false;
		try {
			if (slot >= 0) {
				if (this.origSlot < 0) this.origSlot = cur;
				lp.setSelectItemSlot(slot);
			}
			lp.buildBlock({ x: sup.x, y: sup.y, z: sup.z }, sup.face);
			ok = true;
		} catch (e) {}
		if (ok) this.markPlaced(x, y, z);
		return ok;
	},
	buildChain(lp, dim, sx, sy, sz, tx, ty, tz) {
		let cx = sx, cy = sy, cz = sz, guard = 0;
		while ((cx !== tx || cy !== ty || cz !== tz) && guard++ < 8) {
			if (cx !== tx) cx += cx < tx ? 1 : -1;
			else if (cz !== tz) cz += cz < tz ? 1 : -1;
			else cy += cy < ty ? 1 : -1;
			if (!this.place(lp, dim, cx, cy, cz)) return false;
		}
		return true;
	},
	findSupport(dim, x, y, z) {
		for (let dx = -1; dx <= 1; dx++) {
			for (let dz = -1; dz <= 1; dz++) {
				for (let dy = 1; dy >= -1; dy--) {
					if (!dx && !dz && !dy) continue;
					if (this.faceSolid(dim, x + dx, y + dy, z + dz)) return [x + dx, y + dy, z + dz];
				}
			}
		}
		return null;
	},
	onTick() {
		if (!this.enabled) return;
		let lp = null, pos = null, dim = null;
		try { lp = player.getLocalPlayer(); } catch (e) {}
		if (!lp) return;
		try { pos = lp.getPos(); dim = lp.getDimension(); } catch (e) {}
		if (!pos || !dim) return;
		if (this.placedCount > 200) {
			const now = Date.now();
			for (const k in this.placed) {
				if (now - this.placed[k] > 4000) {
					delete this.placed[k];
					this.placedCount--;
				}
			}
		}
		if (this.verify.length) {
			const now2 = Date.now();
			const keep = [];
			for (const v of this.verify) {
				if (now2 - v.at < 900) { keep.push(v); continue; }
				const n = this.blockName(dim, v.x, v.y, v.z);
				if (n === null) { keep.push(v); continue; }
				const vk = v.x + "," + v.y + "," + v.z;
				if (!this.effAir(n)) continue;
				const dx = v.x + 0.5 - pos.x, dy = v.y + 1.5 - pos.y, dz = v.z + 0.5 - pos.z;
				if (dx * dx + dy * dy + dz * dz < 32 && v.n < 5) {
					// 重试期间保留乐观标记(链支撑/向前铺门槛都靠它), 强制重放真实补块;
					// 只有彻底放弃才删标记 —— 实测小游戏服确认延迟 0.4~2s, 早删标记=断链
					v.n++;
					this.place(lp, dim, v.x, v.y, v.z, true);
					v.at = now2;
					keep.push(v);
				} else if (this.placed[vk]) {
					delete this.placed[vk];
					this.placedCount--;
				}
			}
			this.verify = keep;
		}
		const x = Math.floor(pos.x), z = Math.floor(pos.z);
		const feetPlane = Math.floor(pos.y - 1.62) - 1;
		let placeY = feetPlane;
		let mdx = 0, mdz = 0, moving = false;
		if (this.lastPos) {
			mdx = pos.x - this.lastPos.x;
			mdz = pos.z - this.lastPos.z;
			moving = (mdx * mdx + mdz * mdz) > 0.0004;
		}
		if (this.lockY) {
			if (moving) {
				if (this.lockedY === null) this.lockedY = feetPlane;
				placeY = this.lockedY;
			} else {
				this.lockedY = feetPlane;
			}
		}
		const under = this.blockName(dim, x, placeY, z);
		if (under === null) { this.noteQueryFail(); return; }
		if (this.effAir(under)) {
			// 先试直接放置(adjacentSolid 六向找面, 含头顶桥底面+刚放标记格):
			// 下沉入水时头顶的桥往往是唯一的面来源, findSupport 够不到它会眼睁睁沉底
			if (!this.place(lp, dim, x, placeY, z)) {
				const sup = this.findSupport(dim, x, placeY, z);
				if (sup) this.buildChain(lp, dim, sup[0], sup[1], sup[2], x, placeY, z);
			}
		}
		if (this.ahead > 0 && moving && this.standSolid(dim, x, placeY, z)) {
			const ml = Math.sqrt(mdx * mdx + mdz * mdz);
			const fx = mdx / ml, fz = mdz / ml;
			let bx = x, bz = z;
			for (let i = 1; i <= this.ahead; i++) {
				const tx = x + Math.round(fx * i), tz = z + Math.round(fz * i);
				if (tx === bx && tz === bz) continue;
				const tn = this.blockName(dim, tx, placeY, tz);
				if (tn !== null && this.effAir(tn)) {
					this.buildChain(lp, dim, bx, placeY, bz, tx, placeY, tz);
					bx = tx;
					bz = tz;
				}
			}
		}
		this.lastPos = { x: pos.x, z: pos.z };
	}
};
const nightVision = {
	tag: "fun_night_vision",
	enabled: false,
	tickCount: 0,
	apply() {
		try {
			player.getLocalPlayer().addEffect({
				id: 16,
				duration: 100000,
				amplifier: 0,
				ambient: true,
				noCounter: true,
				effectVisible: false
			});
		} catch (e) {}
	},
	onModuleEvent(args) {
		if (!stdToggle(this, args, "无限夜视")) return;
		this.tickCount = 0;
		try {
			if (this.enabled) {
				this.apply();
			} else {
				player.getLocalPlayer().removeEffect(16);
			}
		} catch (e) {}
	},
	onTick() {
		if (!this.enabled || !tickEvery(this, 20)) return;
		try {
			const eff = player.getLocalPlayer().getEffect(16);
			if (!eff || !eff.duration || eff.duration < 100) {
				this.apply();
			}
		} catch (e) {}
	}
};

const locateStructure = {
	tag: "fun_locate_structure",
	list: [
		["village", "村庄"],
		["mineshaft", "废弃矿井"],
		["stronghold", "要塞"],
		["pillager_outpost", "掠夺者前哨站"],
		["mansion", "林地府邸"],
		["monument", "海底神殿"],
		["ruins", "海底废墟"],
		["shipwreck", "沉船"],
		["buried_treasure", "埋藏的宝藏"],
		["temple", "神庙"],
		["trail_ruins", "古迹废墟"],
		["trial_chambers", "试炼密室"],
		["ancient_city", "远古城市"],
		["fortress", "下界要塞"],
		["bastion_remnant", "堡垒遗迹"],
		["ruined_portal", "废弃传送门"],
		["end_city", "末地城"]
	],
	checked: {},
	fired: false,
	batchSize: 3,
	queue: null,
	results: [],
	level: null,
	pos: null,
	onModuleEvent(args) {
		for (const item of this.list) {
			const v = args[item[2]] !== undefined ? args[item[2]] : args[item[3]];
			if (v !== undefined) {
				this.checked[item[0]] = Boolean(v);
			}
		}
		if (args.fun === this.tag && "value" in args) {
			if (fireLatch(this, Boolean(args.value))) this.run();
		}
	},
	run() {
		const selected = [];
		for (const item of this.list) {
			if (this.checked[item[0]]) selected.push(item);
		}
		if (!selected.length) {
			app.showToast("请先勾选要查询的结构");
			return;
		}
		try {
			this.level = world.getClientWorld();
			this.pos = player.getLocalPlayer().getPos();
		} catch (e) {
			this.level = null;
			this.pos = null;
		}
		if (!this.level || !this.pos) {
			app.showToast("获取世界信息失败");
			return;
		}
		this.queue = selected.slice();
		this.results = [];
	},
	queryOne(item) {
		const id = item[0];
		const name = item[1];
		try {
			const r = this.level.findStructure("minecraft:" + id, { x: this.pos.x, y: this.pos.y, z: this.pos.z });
			if (r && r.x !== undefined) {
				return name + "：" + (Math.floor(r.x) | 0) + ", " + (Math.floor(r.y) | 0) + ", " + (Math.floor(r.z) | 0);
			}
			return name + "：未找到";
		} catch (e) {
			return name + "：查询失败";
		}
	},
	onTick() {
		if (!this.queue) return;
		for (let n = 0; n < this.batchSize; n++) {
			const item = this.queue.shift();
			if (!item) {
				this.queue = null;
				this.level = null;
				this.pos = null;
				this.show(this.results);
				return;
			}
			this.results.push(this.queryOne(item));
		}
	},
	show(lines) {
		showPyPopup("查询结果", lines);
	}
};

for (const item of locateStructure.list) {
	const snake = "locate_" + item[0];
	item[2] = pascalKey(snake);
	item[3] = snake;
}

const posPrint = {
	tag: "fun_pos_print",
	fired: false,
	pending: 0,
	names: {},
	myId: "",
	wantRun: false,
	outbox: [],
	onModuleEvent(args) {
		if (args.fun !== this.tag || !("value" in args)) return;
		if (!fireLatch(this, Boolean(args.value))) return;
		this.wantRun = true;
	},
	log: mkLog("§b[坐标打印] "),
	run() {
		try { this.myId = String(player.getLocalPlayer().getUniqueID()); } catch (e) { this.myId = ""; }
		let list = null;
		try { list = world.getClientWorld().getPlayerList(); } catch (e) {}
		this.names = {};
		const targets = [];
		if (list) {
			for (const k in list) {
				const p = list[k];
				if (!p) continue;
				const id = String(p.id || "");
				if (!id) continue;
				this.names[id] = p.name || "未知玩家";
				if (id !== this.myId) targets.push(id);
			}
		}
		if (!targets.length) {
			this.log("§7当前没有其他玩家");
			return;
		}
		this.pending = targets.length;
		this.log("§7开始获取 " + targets.length + " 名玩家的坐标…");
		for (const id of targets) this.sendQuery(id);
		setTimeout(() => {
			if (this.pending > 0) {
				this.pending = 0;
				this.outbox.push("§7查询结束，有玩家未响应");
			}
		}, 5000);
	},
	onTick() {
		if (this.wantRun) {
			this.wantRun = false;
			this.run();
		}
		if (this.outbox.length) {
			const lines = this.outbox;
			this.outbox = [];
			for (const m of lines) this.log(m);
		}
	},
	sendQuery(id) {
		try {
			packet.sendPyRpcPacket(98247598, hex2buf("93c401729200c4314d696e6563726166743a7065743a7065745f736b696c6c5f667269656e645f6332735f6765745f667269656e645f706f73c0"));
			packet.sendPyRpcPacket(98247598, hex2buf(
				"93c40163920082c407706c617965727391c4" +
				id.length.toString(16).padStart(2, "0") + this.str2hex(id) +
				"c40b726571506c617965724964c4" +
				this.myId.length.toString(16).padStart(2, "0") + this.str2hex(this.myId) + "c0"
			));
		} catch (e) {}
	},
	onPyRpc(id, data) {
		if (this.pending <= 0) return;
		const u8 = this.toU8(data);
		if (!u8 || u8.length < 6) return;
		let hasPosMap = false;
		for (let i = 0; i + 6 <= u8.length; i++) {
			if (u8[i] === 0x70 && u8[i + 1] === 0x6f && u8[i + 2] === 0x73 && u8[i + 3] === 0x4d && u8[i + 4] === 0x61 && u8[i + 5] === 0x70) {
				hasPosMap = true;
				break;
			}
		}
		if (!hasPosMap) return;
		let hex = "";
		for (let i = 0; i < u8.length; i++) hex += u8[i].toString(16).padStart(2, "0");
		let pos = null, pid = null;
		try { pos = this.calHexPos(hex); } catch (e) {}
		try { pid = this.hex2str(this.extractPlayerIdHex(hex)); } catch (e) {}
		if (!pos) return;
		const name = (pid && this.names[pid]) || "未知玩家";
		this.outbox.push("§f" + name + " §7[§e" + pos.x + "§7, §e" + pos.y + "§7, §e" + pos.z + "§7]");
		this.pending--;
		if (this.pending === 0) this.outbox.push("§a坐标获取完成");
	},
	toU8(data) {
		if (typeof data === "string") {
			const u = new Uint8Array(data.length);
			for (let i = 0; i < data.length; i++) u[i] = data.charCodeAt(i) & 0xff;
			return u;
		}
		if (data instanceof ArrayBuffer) return new Uint8Array(data);
		if (data && data.buffer) return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength);
		return null;
	},
	hex2str(hex) {
		if (!hex) return "";
		let str = "";
		for (let i = 0; i < hex.length; i += 2) str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
		return str;
	},
	str2hex(str) {
		let hex = "";
		for (let i = 0; i < str.length; i++) hex += str.charCodeAt(i).toString(16).padStart(2, "0");
		return hex;
	},
	extractPlayerIdHex(hexData) {
		const posMapIndex = hexData.indexOf("706f734d6170");
		if (posMapIndex === -1) return null;
		let index = posMapIndex + 12;
		index += 2;
		const formatByte = hexData.substr(index, 2);
		index += 2;
		let strLength;
		if (formatByte === "c4") { strLength = parseInt(hexData.substr(index, 2), 16); index += 2; }
		else if (formatByte === "c5") { strLength = parseInt(hexData.substr(index, 4), 16); index += 4; }
		else if (formatByte === "c6") { strLength = parseInt(hexData.substr(index, 8), 16); index += 8; }
		else if (formatByte >= "a0" && formatByte <= "bf") strLength = parseInt(formatByte, 16) - 0xa0;
		else return null;
		return hexData.substr(index, strLength * 2);
	},
	calHexPos(hex) {
		const valueKeyHex = "76616c7565";
		const valueKeyIndex = hex.indexOf(valueKeyHex);
		if (valueKeyIndex === -1) throw new Error("no value key");
		let pos = valueKeyIndex + valueKeyHex.length;
		if (hex.substring(pos, pos + 2) !== "93") throw new Error("no array tag");
		pos += 2;
		const coordinates = [];
		for (let i = 0; i < 3; i++) {
			if (hex.substring(pos, pos + 2) !== "cb") throw new Error("no float64 tag");
			pos += 2;
			const floatData = hex.substring(pos, pos + 16);
			pos += 16;
			const bytes = new Uint8Array(8);
			for (let j = 0; j < 8; j++) bytes[j] = parseInt(floatData.substring(j * 2, j * 2 + 2), 16);
			coordinates.push(new DataView(bytes.buffer).getFloat64(0, false));
		}
		return {
			x: Number(coordinates[0].toFixed(2)),
			y: Number(coordinates[1].toFixed(2)),
			z: Number(coordinates[2].toFixed(2))
		};
	}
};

function toPythonMsgpack(node) {
	if (!node || typeof node !== "object" || !("type" in node)) return node;
	switch (node.type) {
		case "array": return node.value.map(toPythonMsgpack);
		case "object":
			const obj = {};
			for (const { key, value } of node.value) obj[toPythonMsgpack(key)] = toPythonMsgpack(value);
			return obj;
		case "binary": return node.value.toString();
		case "int": return node.value;
		case "uint": return "u" + node.value;
		case "float": return "f" + node.value;
		case "double": return "d" + node.value;
		case "boolean": return node.value;
		case "nil": return null;
		default: return node.value;
	}
}

let resDirPath = ".";
try { resDirPath = app.getResource(); } catch (e) {}
try { fs.createDirectories(resDirPath + "/KuSug"); } catch (e) {}

const noInvis = {
	tag: "fun_no_invis",
	enabled: false,
	onModuleEvent(args) {
		stdToggle(this, args, "移除隐身", false);
	},
	onTick() {
		let players = null;
		try { players = world.getClientWorld().getPlayers(); } catch (e) {}
		if (!players) return;
		for (const p of players) {
			try { p.removeEffect(14); } catch (e) {}
			try { p.setStatusFlag(5, false); } catch (e) {}
		}
	}
};

const getUid = {
	tag: "fun_get_uid",
	waiting: false,
	wantSend: false,
	pendingEntries: null,
	reqBytes: [147, 196, 17, 82, 101, 113, 117, 101, 115, 116, 80, 108, 97, 121, 101, 114, 115, 85, 73, 68, 144, 192],
	uidFile: resDirPath + "/KuSug/玩家uid.json",
	onModuleEvent(args) {
		if (args.fun !== this.tag || args.value !== true) return;
		this.wantSend = true;
	},
	log: mkLog("§b[全服uid] "),
	onTick() {
		if (this.pendingEntries) {
			const entries = this.pendingEntries;
			this.pendingEntries = null;
			const nameMap = {};
			try {
				const list = world.getClientWorld().getPlayerList();
				if (list) {
					for (const k in list) {
						const p = list[k];
						if (p && p.id) nameMap[String(p.id)] = p.name || "";
					}
				}
			} catch (e) {}
			let store = {};
			try { store = JSON.parse(fs.read(this.uidFile) || "{}") || {}; } catch (e) {}
			let count = 0;
			for (const pair of entries) {
				store[nameMap[pair[0]] || pair[0]] = pair[1];
				count++;
			}
			try { fs.write(this.uidFile, JSON.stringify(store, null, 2), false); } catch (e) {}
			this.log("§a已保存 " + count + " 名玩家uid到 KuSug/玩家uid.json");
			return;
		}
		if (!this.wantSend) return;
		this.wantSend = false;
		if (this.waiting) {
			this.log("§e请求未响应，请稍候再试");
			return;
		}
		try {
			packet.sendPyRpcPacket(98247598, new Uint8Array(this.reqBytes).buffer);
			this.waiting = true;
		} catch (e) {
			this.log("§c发送失败: " + e);
		}
	},
	onPyRpc(id, data, json) {
		if (!this.waiting || !json) return;
		let py = null;
		try { py = toPythonMsgpack(JSON.parse(json)); } catch (e) {}
		if (!py || py[0] !== "SetPlayersUID") return;
		const dict = py[1] && py[1][0];
		if (!dict || typeof dict !== "object") return;
		this.waiting = false;
		const entries = [];
		for (const k in dict) {
			entries.push([String(k).replace(/^[udf]/, ""), String(dict[k]).replace(/^[udf]/, "")]);
		}
		this.pendingEntries = entries;
	}
};

const adventureEdit = {
	tag: "fun_adventure_place_break",
	fired: false,
	pending: false,
	blocks: "",
	onModuleEvent(args) {
		if (args.fun !== this.tag || !("value" in args)) return;
		if (!fireLatch(this, Boolean(args.value))) return;
		let blocks = "";
		try {
			blocks = String(fs.read(app.getResource("script/方块nbt.json")) || "").replace(/\s+/g, "");
		} catch (e) {}
		if (!blocks) {
			this.log("§c读取 方块nbt.json 失败，请确认文件在 script 目录");
			return;
		}
		this.blocks = blocks;
		this.pending = true;
	},
	log: mkLog("§b[冒险放置破坏] "),
	onTick() {
		if (!this.pending) return;
		this.pending = false;
		this.doWrite();
	},
	doWrite() {
		try {
			const { lp, it, nbt } = carriedNbt();
			if (!it || !nbt || nbt.indexOf('Name:""') >= 0 || nbt.indexOf("Count:0") >= 0) {
				this.log("§c请先手持要写入的物品");
				return;
			}
			const inject = "CanPlaceOn:" + this.blocks + ",CanDestroy:" + this.blocks + ",";
			if (nbt.charAt(0) !== "{") {
				this.log("§c物品NBT格式异常");
				return;
			}
			const newNbt = "{" + inject + nbt.slice(1);
			it.setNBT(newNbt);
			lp.setCarriedItem(it);
			this.log("§a放置/破坏写入成功");
		} catch (e) {
			this.log("§c写入失败: " + e);
		}
	}
};

const infDurability = makeNbtWriter({
	tag: "fun_inf_durability",
	logPrefix: "§b[无限耐久] ",
	throwKey: "inf_durability_throw",
	holdMsg: "§c请先手持要修改的物品",
	okText: "§a无限耐久写入成功",
	transform: nbtSetInf
});

const goatEffect = makeNbtWriter({
	tag: "fun_goat_effect",
	logPrefix: "§b[山羊角修改] ",
	throwKey: "goat_effect_throw",
	radioKey: "goat_effect",
	need: "goat_horn",
	holdMsg: "§c请先手持山羊角",
	okText: "§a山羊角音效写入成功: ",
	okVal: true,
	transform: nbtSetDamage
});

const bedColor = makeNbtWriter({
	tag: "fun_bed_color",
	logPrefix: "§b[床颜色修改] ",
	throwKey: "bed_color_throw",
	radioKey: "bed_color",
	need: 'minecraft:bed"',
	holdMsg: "§c请先手持床",
	okText: "§a床颜色写入成功: ",
	okVal: true,
	transform: nbtSetDamage
});

const bannerColor = makeNbtWriter({
	tag: "fun_banner_color",
	logPrefix: "§b[旗帜颜色修改] ",
	throwKey: "banner_color_throw",
	radioKey: "banner_color",
	need: 'minecraft:banner"',
	holdMsg: "§c请先手持旗帜",
	okText: "§a旗帜颜色写入成功: ",
	okVal: true,
	transform: nbtSetDamage
});

const ominousBottle = makeNbtWriter({
	tag: "fun_ominous_bottle",
	logPrefix: "§b[不祥药水修改] ",
	throwKey: "ominous_bottle_throw",
	radioKey: "ominous_bottle",
	need: 'minecraft:ominous_bottle"',
	holdMsg: "§c请先手持不祥之瓶",
	okText: "§a不祥之兆等级写入成功: ",
	okVal: true,
	transform: nbtSetDamage
});

const customDamage = makeNbtWriter({
	tag: "fun_custom_damage",
	logPrefix: "§b[特殊值修改] ",
	throwKey: "custom_damage_throw",
	throwDefault: true,
	textKey: "custom_damage_value",
	holdMsg: "§c请先手持要修改的物品",
	okText: "§a特殊值写入成功: ",
	okVal: true,
	transform: nbtSetDamage
});

const attackDrops = {
	tag: "fun_attack_drops",
	fired: false,
	pending: false,
	running: false,
	range: 5.0,
	attackTimes: 5,
	queue: [],
	hits: {},
	onModuleEvent(args) {
		if (args.fun !== this.tag || !("value" in args)) return;
		if (!fireLatch(this, Boolean(args.value))) return;
		this.pending = true;
	},
	log: mkLog("§b[攻击掉落物] "),
	entityId(a) {
		let id = "?";
		try {
			const idf = a.getIdentifier();
			if (idf) id = idf.canonicalName || idf.fullName || "?";
			id = id.replace(/<.*>/, "");
		} catch (e) {}
		return id;
	},
	findByUid(level, uid) {
		const actors = level.getActors();
		if (!actors) return null;
		for (const a of actors) {
			try {
				if (String(a.getUniqueID() || "") === uid) return a;
			} catch (e) {}
		}
		return null;
	},
	onTick() {
		if (this.pending) {
			this.pending = false;
			this.start();
		}
		if (!this.running) return;
		this.step();
	},
	start() {
		try {
			const lp = player.getLocalPlayer();
			const level = world.getClientWorld();
			if (!lp || !level) { this.log("§c获取玩家或世界失败"); return; }
			const myPos = lp.getPos();
			const actors = level.getActors() || [];
			const uids = [];
			for (const a of actors) {
				if (this.entityId(a) !== "minecraft:item") continue;
				let uid = "";
				try { uid = String(a.getUniqueID() || ""); } catch (e) {}
				if (!uid) continue;
				let d = -1;
				try {
					const p = a.getPos();
					const dx = p.x - myPos.x, dy = p.y - myPos.y, dz = p.z - myPos.z;
					d = Math.sqrt(dx * dx + dy * dy + dz * dz);
				} catch (e) {}
				if (d < 0 || d > this.range) continue;
				uids.push(uid);
			}
			if (!uids.length) { this.log("§7范围内没有掉落物"); return; }
			this.queue = [];
			this.hits = {};
			for (const uid of uids) {
				for (let i = 0; i < this.attackTimes; i++) this.queue.push(uid);
			}
			this.running = true;
		} catch (e) { this.log("§c启动失败: " + e); }
	},
	step() {
		const lp = player.getLocalPlayer();
		const level = world.getClientWorld();
		if (!lp || !level) {
			this.running = false;
			this.queue = [];
			this.log("§c玩家或世界丢失，中断");
			return;
		}
		const uid = this.queue.shift();
		const a = this.findByUid(level, uid);
		if (!a) {
			this.queue = this.queue.filter(q => q !== uid);
		} else {
			try {
				lp.attack(a);
				if (!this.hits[uid]) this.log("§e攻击掉落物 §f" + uid + " §a成功");
			} catch (e) { this.log("§c攻击失败: " + e); }
			this.hits[uid] = (this.hits[uid] || 0) + 1;
		}
		if (!this.queue.length) {
			this.running = false;
		}
	}
};

const auxEffect = {
	tag: "fun_aux_effect",
	fired: false,
	pending: false,
	checked: {},
	throwAfter: false,
	dropDelay: 0,
	validNames: ["minecraft:potion", "minecraft:splash_potion", "minecraft:lingering_potion", "minecraft:arrow"],
	onModuleEvent(args) {
		if (typeof args.aux_effect_throw !== "undefined") {
			this.throwAfter = Boolean(args.aux_effect_throw);
		}
		if (typeof args.aux_effect === "string") {
			const m = /^aux_effect_(\d+)$/.exec(args.aux_effect);
			if (m) {
				this.checked = {};
				this.checked[Number(m[1])] = true;
			}
		}
		for (const k in args) {
			if (k.indexOf("aux_effect_") !== 0 || k === "aux_effect_throw") continue;
			const n = Number(k.slice(11));
			if (isNaN(n)) continue;
			if (args[k]) this.checked[n] = true;
			else delete this.checked[n];
		}
		if (args.fun === this.tag && "value" in args) {
			if (!fireLatch(this, Boolean(args.value))) return;
			this.pending = true;
		}
	},
	log: mkLog("§b[修改药水效果] "),
	onTick() {
		if (this.dropDelay > 0) {
			this.dropDelay--;
			if (this.dropDelay === 0) {
				try {
					input.buttonDown("button.drop");
					input.buttonUp("button.drop");
				} catch (e) { this.log("§c丢出失败: " + e); }
			}
		}
		if (!this.pending) return;
		this.pending = false;
		this.doWrite();
	},
	setRootDamage(nbt, dv) {
		if (nbt.charAt(0) !== "{") return null;
		const tagIdx = nbt.indexOf("tag:{");
		const head = tagIdx < 0 ? nbt : nbt.slice(0, tagIdx);
		const tail = tagIdx < 0 ? "" : nbt.slice(tagIdx);
		if (/Damage:-?\d+[a-z]?/.test(head)) {
			return head.replace(/Damage:-?\d+[a-z]?/, "Damage:" + dv + "s") + tail;
		}
		return "{Damage:" + dv + "s," + head.slice(1) + tail;
	},
	doWrite() {
		try {
			const sel = Object.keys(this.checked);
			if (!sel.length) {
				app.showToast("请先勾选要修改的效果");
				this.log("§c请先勾选要修改的效果");
				return;
			}
			if (sel.length > 1) {
				app.showToast("只能勾选一个效果");
				this.log("§c只能勾选一个效果，请取消多余勾选");
				return;
			}
			const dv = Number(sel[0]);
			const { lp, it, nbt } = carriedNbt();
			if (!it || !nbt || nbt.indexOf('Name:""') >= 0 || nbt.indexOf("Count:0") >= 0) { this.log("§c请先手持药水或箭"); return; }
			let name = "";
			const m = nbt.match(/Name:"([^"]*)"/);
			if (m) name = m[1];
			if (this.validNames.indexOf(name) < 0) { this.log("§c手持物品不是药水或箭: " + name); return; }
			const wdv = (name === "minecraft:arrow" && dv > 0) ? dv + 1 : dv;
			const newNbt = this.setRootDamage(nbt, wdv);
			if (!newNbt) { this.log("§c物品NBT格式异常"); return; }
			it.setNBT(newNbt);
			lp.setCarriedItem(it);
			this.log("§a效果修改成功（Damage=" + wdv + "）");
			if (this.throwAfter) {
				this.dropDelay = 3;
			}
		} catch (e) { this.log("§c修改失败: " + e); }
	}
};

function PatchAnvilNewlines(data) {
	const r = binReader(data);
	const u8 = r.u8;
	const skipSlot = () => {
		r.skip(3);
		r.svarint();
	};
	const skipItem = () => {
		if (r.svarint() === 0) return;
		r.skip(2);
		r.uvarint();
		r.svarint();
		r.skip(r.uvarint());
	};
	const skipAction = (t) => {
		switch (t) {
			case 0:
			case 1:
			case 7:
			case 8:
				r.byte();
				skipSlot();
				skipSlot();
				break;
			case 2:
			case 9:
				skipSlot();
				skipSlot();
				break;
			case 3:
				r.byte();
				skipSlot();
				r.byte();
				break;
			case 4:
			case 5:
				r.byte();
				skipSlot();
				break;
			case 6:
				r.byte();
				break;
			case 10:
				r.svarint();
				r.svarint();
				break;
			case 11:
				r.svarint();
				r.svarint();
				r.svarint();
				break;
			case 12:
			case 14:
				r.uvarint();
				r.byte();
				break;
			case 13:
				r.uvarint();
				r.byte();
				r.byte();
				break;
			case 15:
				r.uvarint();
				r.skip(4);
				break;
			case 16:
				r.uvarint();
				r.byte();
				r.svarint();
				break;
			case 17: {
				r.skip(r.uvarint());
				r.byte();
				break;
			}
			case 18:
				break;
			case 19: {
				const cnt = r.uvarint();
				for (let i = 0; i < cnt; i++) skipItem();
				r.byte();
				break;
			}
			default:
				throw 0;
		}
	};
	const segs = [];
	const reqCount = r.uvarint();
	for (let i = 0; i < reqCount; i++) {
		r.svarint();
		const actCount = r.uvarint();
		let hasOptional = false;
		for (let j = 0; j < actCount; j++) {
			const t = r.byte();
			if (t === 15) hasOptional = true;
			skipAction(t);
		}
		const strCount = r.uvarint();
		for (let j = 0; j < strCount; j++) {
			const segStart = r.off;
			const slen = r.uvarint();
			r.need(slen);
			const cStart = r.off;
			r.off += slen;
			if (j === 0 && hasOptional) segs.push({ segStart, cStart, slen });
		}
	}
	const patches = [];
	for (const s of segs) {
		const segEnd = s.cStart + s.slen;
		const out = [];
		let hit = false;
		for (let i = s.cStart; i < segEnd; i++) {
			if (u8[i] === 0x5C && i + 1 < segEnd && u8[i + 1] === 0x6E) {
				out.push(0x0A);
				i++;
				hit = true;
			} else out.push(u8[i]);
		}
		if (hit) patches.push({ start: s.segStart, end: segEnd, data: out });
	}
	if (!patches.length) return false;
	const parts = [];
	let last = 0;
	for (const p of patches) {
		parts.push(u8.slice(last, p.start));
		parts.push(uvarintBytes(p.data.length), p.data);
		last = p.end;
	}
	parts.push(u8.slice(last));
	return joinParts(parts);
}

const anvilLines = {
	tag: "fun_anvil_lines",
	enabled: false,
	onModuleEvent(args) {
		stdToggle(this, args, "铁砧换行");
	},
	onSendServerPacket(id, name, bin) {
		if (!this.enabled || id !== 147) return false;
		try {
			return PatchAnvilNewlines(bin);
		} catch (e) {}
		return false;
	}
};

const noHunger = {
	tag: "fun_no_hunger",
	enabled: false,
	tickCount: 0,
	apply() {
		try {
			player.getLocalPlayer().setAttribute("minecraft:player.hunger", { current: 20 });
		} catch (e) {}
	},
	onModuleEvent(args) {
		if (!stdToggle(this, args, "无视饥饿")) return;
		this.tickCount = 0;
		if (this.enabled) this.apply();
	},
	onTick() {
		if (!this.enabled || !tickEvery(this, 20)) return;
		this.apply();
	}
};

function safeRegFun(tag) {
	try { menu.regFun(tag); } catch (e) {}
}

for (const t of ["fun_cookie_login", "fun_move_camera", "fun_watermark_uid", "fun_java_watermark", "query_player", "fun_room_ip", "fun_anti_kick", "fun_msg_brush", "fun_kill_aura", "fun_night_vision", "fun_locate_structure", "fun_pos_print", "fun_no_hunger", "fun_get_uid", "fun_adventure_place_break", "fun_inf_durability", "fun_goat_effect", "fun_bed_color", "fun_attack_drops", "fun_auto_drop", "fun_attack_fx", "fun_chunk_display", "fun_self_attack", "fun_ghost_barrier", "fun_minimap", "fun_aux_effect", "fun_anvil_lines", "fun_check_cmd", "fun_struct_block", "fun_tex_inject", "fun_send_control", "fun_trade_unlock", "fun_fps", "fun_kill_taunt", "fun_attack_taunt", "fun_batch_cmd", "fun_banner_color", "fun_ominous_bottle", "fun_hide_clutter", "fun_custom_damage", "fun_scaffold", "fun_bypass_server", "fun_gyro_view", "fun_big_gyro", "fun_custom_camera", "fun_dir_hud", "fun_crosshair", "fun_item_hud", "fun_motion_blur", "fun_auto_sign", "fun_gm_panel", "fun_skin_tryon", "fun_no_invis", "fun_eat_repeat", "fun_login_video", "fun_radar", "fun_container_blur", "fun_death_fx"]) safeRegFun(t);

const skinTryOn = {
	tag: "fun_skin_tryon",
	enabled: false,
	current: null,
	deviceData: null,
	tickCount: 0,
	sel: {},
	selLoaded: false,
	manual: "",
	pending: null,
	pendingManual: "",
	PBR_TEST_UUIDS: { "361b9a81-09bb-40c1-a977-2c1f3df95a03": 119, "1859a748-c854-4da7-8c34-f6c4c220ef40": 143, "13214da7-f7ca-46a4-991e-5ffc78743c31": 148, "e494e015-7712-4c30-b2e7-98d90b4266e9": 151, "10c85b7d-7975-4dc9-8cdf-c149d609417a": 154 },
	DEBUG_KEYS: { "test_crafting_table_uuid": 1, "test_furnace_uuid": 1, "chest_test_a": 1, "chest_test_b": 1 },
	CLEAR_PY: `
from gui_2d.ui.easy_debug_ui.actions.debug_skin_test import debug_skin_test
debug_skin_test.IN_GAME_UUIDS = []
try:
    from common import game
    mgr = game.GetClient().GetPlayerVipMgr()
    if mgr is not None:
        mgr.SyncUsingModToServer(None)
except Exception:
    pass
try:
    import mod.client.extraClientApi as clientApi
    import entity_module
    import __main__
    _fake = getattr(__main__, 'KUSUG_FAKE_UIDS', {}) or {}
    _fp = getattr(__main__, 'KUSUG_FAKE_PID', None)
    __main__.KUSUG_FAKE_UIDS = {}
    if _fake and _fp:
        _v = clientApi.GetSystem('Minecraft', 'vipEventSystem')
        if _v is not None and entity_module.is_entity_exist(_fp):
            _cur = set(x[0] for x in getattr(_v, 'playerUsingMods', {}).get(_fp, set()))
            for _u in _fake:
                _cur.discard(_u)
            _uids = {}
            for _u in _cur:
                _uids[_u] = {}
            _a = {'id': _fp, 'uids': _uids, 'skinItemId': getattr(_v, 'playerId2SkinItemId', {}).get(_fp), 'skinUuid': getattr(_v, 'playerId2SkinUuid', {}).get(_fp)}
            _v.DeliverItemsWithECS(_a)
            _v.DeliverItems(_a)
except Exception:
    pass
try:
    from gui_2d.ui.easy_debug_ui.actions.debug_ntes_render import debug_ntes_render as dnr
    dnr._execute_pbr_skin_state(0, 'KuSug', user_click=False)
except Exception:
    pass
try:
    import model, entity_module
    import mod.client.extraClientApi as clientApi
    from common import eventUtil
    import __main__
    pid = entity_module.get_local_player_id()
    if pid:
        model.resetSkinToSteve(pid)
    try:
        gc = clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId())
        hid = gc.GetRiderId(pid)
        if hid:
            model.reset_model(hid)
    except Exception:
        pass
    _owner = getattr(__main__, 'KUSUG_MOUNT_OWNER', None)
    _hook = getattr(__main__, 'KUSUG_MOUNT_HOOK', None)
    if _owner is not None and _hook is not None:
        try:
            eventUtil.instance.UnListenForEngineClient('EntityStartRidingEvent', _owner, _hook)
        except Exception:
            pass
    __main__.KUSUG_MOUNT_MODEL = ''
except Exception:
    pass
`,
	DUMP_PY: `
import json
import __main__
RESULT = {'count': 0, 'err': ''}
try:
    from common.appmgr.vipLogic.properties import DATA
    out = {}
    for u, v in DATA.iteritems():
        if not isinstance(v, dict):
            continue
        comp = v.get('client_components', {})
        info = v.get('item_info', {}) or {}
        vip_skin = comp.get('vip_skin', {})
        out[u] = {
            'types': sorted(comp.keys()),
            'season': vip_skin.get('season', ''),
            'skin_list': vip_skin.get('skin_list', [])[:2],
            'name': info.get('item_name', '') or info.get('eng_name', ''),
            'itype': info.get('item_type', ''),
            'rarity': info.get('rarity', ''),
            'comment': v.get('comment', ''),
            'model': comp.get('horse_anim', {}).get('model', '') or comp.get('ui_model', {}).get('model', '')
        }
    fp = DUMP_PATH
    import os
    dp = os.path.dirname(fp)
    if dp and not os.path.exists(dp):
        os.makedirs(dp)
    f = open(fp, 'w')
    f.write(json.dumps({'count': len(out), 'items': out}))
    f.close()
    RESULT['count'] = len(out)
except Exception as e:
    RESULT['err'] = str(e)[:80]
try:
    __main__.KUSUG_TRYON_RESULT = json.dumps(RESULT)
except Exception:
    pass
`,
	buildDumpPy() {
		let path = "KuSug/device_vipdata.json";
		try { path = app.getResource(path); } catch (e) {}
		return this.DUMP_PY.replace("DUMP_PATH", "u" + JSON.stringify(path));
	},
	runDump() {
		try {
			app.evalPython(this.buildDumpPy());
		} catch (e) {
			try { minecraft.clientMessage("§b[修改皮肤] §c刷新失败: §f" + String(e).slice(0, 80)); } catch (e2) {}
			return;
		}
		this.deviceData = null;
		let n = 0;
		try {
			const raw = String(app.evalPython("__main__.KUSUG_TRYON_RESULT") || "");
			if (raw) n = JSON.parse(raw).count || 0;
		} catch (e) {}
		try { minecraft.clientMessage("§b[修改皮肤] §a设备外观已刷新" + (n ? ": §f" + n + " 条" : "")); } catch (e) {}
	},
	loadDeviceData() {
		if (this.deviceData !== null) return this.deviceData;
		this.deviceData = {};
		let raw = "";
		try { raw = String(fs.read(app.getResource("KuSug/device_vipdata.json")) || ""); } catch (e) {}
		try {
			const d = JSON.parse(raw);
			if (d && d.items) this.deviceData = d.items;
		} catch (e) {}
		return this.deviceData;
	},
	buildApplyPy(uuids, mountModel) {
		const skip = uuids.filter(u => this.PBR_TEST_UUIDS[String(u)]);
		const states = {};
		for (const u of skip) states[String(u)] = this.PBR_TEST_UUIDS[String(u)];
		return `
import json
from common.appmgr.vipLogic.properties import DATA
UUIDS = json.loads(${JSON.stringify(JSON.stringify(uuids.map(String)))})
SKIP = set(json.loads(${JSON.stringify(JSON.stringify(skip.map(String)))}))
PBR_STATES = json.loads(${JSON.stringify(JSON.stringify(states))})
MOUNT_MODEL = json.loads(${JSON.stringify(JSON.stringify(mountModel || ""))})
try:
    from gui_2d.ui.easy_debug_ui.actions.debug_ntes_render import debug_ntes_render as dnr
    for u in UUIDS:
        fake = dnr._PBR_DEBUG_VIP_SKIN_DATA.get(u)
        if fake and u not in DATA:
            DATA[u] = fake
except Exception:
    pass
try:
    import mod.client.extraClientApi as clientApi
    import entity_module
    import __main__
    _fake = {}
    for u in UUIDS:
        if u not in SKIP:
            _fake[u] = {}
    __main__.KUSUG_FAKE_UIDS = _fake
    __main__.KUSUG_FAKE_PID = entity_module.get_local_player_id()
    def _kusug_ensure():
        try:
            _v = clientApi.GetSystem('Minecraft', 'vipEventSystem')
            if _v is None:
                return
            _fu = getattr(__main__, 'KUSUG_FAKE_UIDS', None)
            _fp = getattr(__main__, 'KUSUG_FAKE_PID', None)
            if not _fu or not _fp:
                return
            if not entity_module.is_entity_exist(_fp):
                return
            _cur = set(x[0] for x in getattr(_v, 'playerUsingMods', {}).get(_fp, set()))
            _mis = False
            for _u in _fu:
                if _u not in _cur:
                    _mis = True
                    break
            if not _mis:
                return
            _merged = {}
            for _u in _cur:
                _merged[_u] = {}
            for _u in _fu:
                _merged[_u] = {}
            _a = {'id': _fp, 'uids': _merged, 'skinItemId': getattr(_v, 'playerId2SkinItemId', {}).get(_fp), 'skinUuid': getattr(_v, 'playerId2SkinUuid', {}).get(_fp)}
            _v.PreDeliverItems({'uids': list(_merged.keys())})
            _v.DeliverItemsWithECS(_a)
            _v.DeliverItems(_a)
        except Exception:
            pass
    __main__.KUSUG_FAKE_ENSURE = _kusug_ensure
    _kusug_ensure()
except Exception:
    pass
try:
    import model, entity_module
    pid = entity_module.get_local_player_id()
    for u in UUIDS:
        if u in SKIP:
            try:
                st = PBR_STATES.get(u, 0)
                if st:
                    dnr._execute_pbr_skin_state(st, 'KuSug', user_click=False)
            except Exception:
                pass
            continue
        comp = DATA.get(u, {}).get('client_components', {})
        vip_skin = comp.get('vip_skin', {})
        skin_list = vip_skin.get('skin_list') or []
        if pid and skin_list:
            try:
                model.vipChange4DSkin(pid, vip_skin.get('season', '4d_skin'), skin_list[0])
            except Exception:
                pass
except Exception:
    pass
if MOUNT_MODEL:
    try:
        import mod.client.extraClientApi as clientApi
        from common import eventUtil
        import __main__
        __main__.KUSUG_MOUNT_MODEL = MOUNT_MODEL
        def _kusug_apply_mount():
            try:
                pid2 = entity_module.get_local_player_id()
                gc = clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId())
                hid = gc.GetRiderId(pid2)
                if hid:
                    model.change_model(hid, __main__.KUSUG_MOUNT_MODEL)
                    return True
            except Exception:
                pass
            return False
        __main__.KUSUG_APPLY_MOUNT = _kusug_apply_mount
        if not _kusug_apply_mount():
            class _KusugMountOwner(object):
                pass
            _owner = getattr(__main__, 'KUSUG_MOUNT_OWNER', None)
            if _owner is None:
                _owner = _KusugMountOwner()
                __main__.KUSUG_MOUNT_OWNER = _owner
            _old = getattr(__main__, 'KUSUG_MOUNT_HOOK', None)
            if _old is not None:
                try:
                    eventUtil.instance.UnListenForEngineClient('EntityStartRidingEvent', _owner, _old)
                except Exception:
                    pass
            def _kusug_on_ride(data):
                try:
                    h = getattr(__main__, 'KUSUG_APPLY_MOUNT', None)
                    if h:
                        h()
                except Exception:
                    pass
            __main__.KUSUG_MOUNT_HOOK = _kusug_on_ride
            eventUtil.instance.ListenForEngineClient('EntityStartRidingEvent', _owner, _kusug_on_ride)
    except Exception:
        pass
`;
	},
	apply(uuids, label, mountModel) {
		if (!uuids || !uuids.length) return;
		try {
			app.evalPython(this.buildApplyPy(uuids, mountModel));
		} catch (e) {
			const err = String(e).slice(0, 80);
			try { minecraft.clientMessage("§b[修改皮肤] §c应用失败: §f" + err); } catch (e2) {}
			try { app.showToast("应用失败: " + err); } catch (e2) {}
			return;
		}
		this.current = { uuids: uuids.slice(), label: String(label || uuids.join(",")), mountModel: mountModel || "" };
		let msg = "§b[修改皮肤] §a已应用: §f" + this.current.label + " §7(仅自己可见)";
		if (mountModel) msg += " §7(上马后自动换装)";
		if (uuids.some(u => this.PBR_TEST_UUIDS[String(u)])) msg += " §7(测试皮走状态机)";
		try { minecraft.clientMessage(msg); } catch (e) {}
	},
	clear() {
		try { app.evalPython(this.CLEAR_PY); } catch (e) {}
	},
	deviceTypeOf(info) {
		const types = info.types || [];
		const has = t => types.indexOf(t) >= 0;
		if (has("vip_skin")) return "皮肤";
		if (has("horse_anim")) return "坐骑";
		if (has("weapon_model") || has("bow_weapon_model") || has("offhand_weapon_model")) return "武器";
		if (types.some(t => t.indexOf("vip_skin_parts") === 0)) return "拆件";
		if (has("suit_armor")) return "盔甲";
		if (has("function_block") || has("chest_function_block")) return "功能方块";
		if (has("player_footprint_new") || has("player_footprint_old")) return "脚印";
		if (info.itype === "fz") return "法阵";
		return "其他";
	},
	deviceList() {
		const dev = this.loadDeviceData();
		const out = [];
		for (const u in dev) {
			if (this.DEBUG_KEYS[u] || u.indexOf("test_") === 0 || u.charAt(0) === "_") continue;
			const v = dev[u] || {};
			const name = String(v.name || "").trim();
			const comment = String(v.comment || "").trim();
			const model = String(v.model || "").trim();
			out.push({
				name: name || comment || model || u.slice(0, 8),
				named: !!name,
				uuid: u,
				type: this.deviceTypeOf(v),
				rarity: 0,
				model: model,
				device: true
			});
		}
		const order = { "皮肤": 1, "坐骑": 2, "法阵": 3, "武器": 4, "拆件": 5, "脚印": 6, "盔甲": 7, "功能方块": 8, "其他": 9 };
		out.sort((a, b) => (order[a.type] || 99) - (order[b.type] || 99) || (a.named === b.named ? 0 : a.named ? -1 : 1) || (a.name < b.name ? -1 : 1));
		return out;
	},
	selFilePath() {
		return app.getResource("KuSug/SkinTryOn.json");
	},
	loadSel() {
		if (this.selLoaded) return;
		this.selLoaded = true;
		try {
			const f = this.selFilePath();
			if (fs.exists(f)) {
				const d = JSON.parse(String(fs.read(f) || "{}"));
				if (d && d.sel && typeof d.sel === "object") this.sel = d.sel;
				if (d && typeof d.manual === "string") this.manual = d.manual;
			}
		} catch (e) {}
	},
	saveSel() {
		try {
			const dir = app.getResource("KuSug");
			if (!fs.exists(dir)) fs.createDirectories(dir);
			fs.write(this.selFilePath(), JSON.stringify({ sel: this.sel, manual: this.manual }));
		} catch (e) {}
	},
	initPending(all) {
		this.loadSel();
		const p = {};
		for (const cat in this.sel) {
			const arr = Array.isArray(this.sel[cat]) ? this.sel[cat] : [];
			const ok = arr.filter(u => all.some(it => it.uuid === u));
			if (ok.length) p[cat] = ok;
		}
		this.pending = p;
		this.pendingManual = String(this.manual || "");
	},
	prunePending(all) {
		const p = this.pending || {};
		for (const cat in p) {
			const ok = p[cat].filter(u => all.some(it => it.uuid === u));
			if (ok.length) p[cat] = ok;
			else delete p[cat];
		}
	},
	isMultiCat(cat) {
		return cat === "武器" || cat === "功能方块";
	},
	pendingCount() {
		let n = 0;
		const p = this.pending || {};
		for (const cat in p) n += (p[cat] || []).length;
		n += String(this.pendingManual || "").split(/[,，]/).map(x => x.trim()).filter(x => x).length;
		return n;
	},
	openMainForm() {
		let devCount = Object.keys(this.loadDeviceData()).length;
		if (!devCount) {
			this.runDump();
			devCount = Object.keys(this.loadDeviceData()).length;
		}
		if (!devCount) {
			try { app.showToast("设备外观读取失败,请稍后重试"); } catch (e) {}
			this.pending = null;
			return;
		}
		const cats = ["皮肤", "坐骑", "法阵", "武器", "拆件", "脚印", "盔甲", "功能方块", "其他"];
		const all = this.deviceList();
		if (this.pending === null) this.initPending(all);
		const self = this;
		const acts = [];
		const buttons = [];
		for (const c of cats) {
			const opts = all.filter(it => it.type === c);
			if (!opts.length) continue;
			acts.push({ t: "cat", cat: c, opts: opts });
			const staged = (this.pending || {})[c] || [];
			let status = "无";
			if (this.isMultiCat(c)) {
				if (staged.length) status = "已选" + staged.length + "个";
			} else if (staged.length) {
				const it = opts.find(o => o.uuid === staged[0]);
				if (it) status = it.name;
			}
			buttons.push({ text: c + ": " + status });
		}
		const manualCount = String(this.pendingManual || "").split(/[,，]/).map(x => x.trim()).filter(x => x).length;
		acts.push({ t: "manual" });
		buttons.push({ text: "手动UUID" + (manualCount ? ": " + manualCount + "个" : "") });
		acts.push({ t: "refresh" });
		buttons.push({ text: "刷新列表" });
		acts.push({ t: "clear" });
		buttons.push({ text: "§c清空所有外观" });
		acts.push({ t: "submit" });
		buttons.push({ text: "§a提交" });
		const pendingN = this.pendingCount();
		const form = JSON.stringify({
			type: "form",
			title: "修改皮肤(" + all.length + ")",
			content: "待应用: " + (pendingN ? pendingN + "项" : "无"),
			buttons: buttons
		});
		try {
			gui.addForm(form, function (idx) {
				const a = acts[typeof idx === "number" ? idx : parseInt(idx, 10)];
				if (!a) { self.doApply(); return; }
				if (a.t === "cat") {
					if (self.isMultiCat(a.cat)) self.openMultiForm(a.cat, a.opts);
					else self.openCatForm(a.cat, a.opts);
				} else if (a.t === "manual") {
					self.openManualForm();
				} else if (a.t === "refresh") {
					self.runDump();
					self.prunePending(self.deviceList());
					self.openMainForm();
				} else if (a.t === "clear") {
					self.pending = {};
					self.pendingManual = "";
					self.doApply();
				} else if (a.t === "submit") {
					self.doApply();
				}
			}, function () { self.pending = null; });
		} catch (e) {}
	},
	openCatForm(cat, opts) {
		const staged = (this.pending || {})[cat] || [];
		let def = 0;
		if (staged.length) {
			for (let j = 0; j < opts.length; j++) {
				if (opts[j].uuid === staged[0]) { def = j + 1; break; }
			}
		}
		const self = this;
		const form = JSON.stringify({
			type: "custom_form",
			title: cat + "(" + opts.length + ")",
			content: [{ type: "dropdown", text: cat, options: ["无"].concat(opts.map(o => o.name)), default: def }]
		});
		try {
			gui.addForm(form, function (idx) {
				const i = parseInt(idx, 10) || 0;
				if (i > 0 && opts[i - 1]) self.pending[cat] = [opts[i - 1].uuid];
				else delete self.pending[cat];
				self.openMainForm();
			}, function () { self.openMainForm(); });
		} catch (e) { self.openMainForm(); }
	},
	openMultiForm(cat, opts) {
		const staged = (this.pending || {})[cat] || [];
		const content = [];
		for (const o of opts) {
			content.push({ type: "toggle", text: o.name, default: staged.indexOf(o.uuid) >= 0 });
		}
		const self = this;
		const form = JSON.stringify({
			type: "custom_form",
			title: cat + "(" + opts.length + ")",
			content: content
		});
		try {
			gui.addForm(form, function () {
				const picks = [];
				for (let j = 0; j < opts.length; j++) {
					const v = arguments[j];
					if (v === true || v === "true" || v === 1 || v === "1") picks.push(opts[j].uuid);
				}
				if (picks.length) self.pending[cat] = picks;
				else delete self.pending[cat];
				self.openMainForm();
			}, function () {
				delete self.pending[cat];
				self.openMainForm();
			});
		} catch (e) { self.openMainForm(); }
	},
	openManualForm() {
		const self = this;
		const form = JSON.stringify({
			type: "custom_form",
			title: "手动UUID",
			content: [{ type: "input", text: "手动UUID(可选,多个逗号分隔)", placeholder: "列表没有的外观填这里", default: String(this.pendingManual || "") }]
		});
		try {
			gui.addForm(form, function (v) {
				self.pendingManual = String(v || "");
				self.openMainForm();
			}, function () { self.openMainForm(); });
		} catch (e) { self.openMainForm(); }
	},
	doApply() {
		if (this.pending === null) return;
		const all = this.deviceList();
		this.prunePending(all);
		const p = this.pending || {};
		this.pending = null;
		const chosen = [];
		let mountModel = "";
		for (const c of ["皮肤", "坐骑", "法阵", "武器", "拆件", "脚印", "盔甲", "功能方块", "其他"]) {
			const staged = p[c] || [];
			for (const u of staged) {
				const it = all.find(o => o.uuid === u);
				if (!it) continue;
				chosen.push(it);
				if (c === "坐骑" && it.model) mountModel = it.model;
			}
		}
		const manual = String(this.pendingManual || "").split(/[,，]/).map(x => x.trim()).filter(x => x);
		for (const mu of manual) chosen.push({ uuid: mu, name: mu.slice(0, 13), type: "手动" });
		this.sel = {};
		for (const cat in p) {
			if (p[cat] && p[cat].length) this.sel[cat] = p[cat].slice();
		}
		this.manual = String(this.pendingManual || "");
		this.saveSel();
		if (!chosen.length) {
			if (this.current) {
				this.current = null;
				this.clear();
				try { minecraft.clientMessage("§b[修改皮肤] §e已清除所有外观"); } catch (e) {}
			} else {
				try { app.showToast("未选择任何组件"); } catch (e) {}
			}
			return;
		}
		this.apply(chosen.map(it => it.uuid), chosen.map(it => it.name + "[" + it.type + "]").join(" + "), mountModel);
	},
	onModuleEvent(args) {
		if (!stdToggle(this, args, "修改皮肤")) return;
		if (this.enabled) this.openMainForm();
	},
	onTick() {
		if (!this.current || !tickEvery(this, 40)) return;
		try { app.evalPython("__main__.KUSUG_FAKE_ENSURE()"); } catch (e) {}
	}
};

const loginVideo = {
	tag: "fun_login_video",
	enabled: false,
	restoreMode: false,
	targetPath() {
		let pkg = ["com", "netease", "x19"].join(".");
		try {
			const m = String(app.getResource("x")).match(/\/Android\/data\/([^\/]+)\/files\//);
			if (m && m[1]) pkg = m[1];
		} catch (e) {}
		return "/data/user/0/" + pkg + "/files/games/com.netease/storge/asset/loginVideoNew.mp4";
	},
	srcPath() {
		return app.getResource("kusug/loginVideoNew.mp4");
	},
	backupPath() {
		return app.getResource("kusug/loginVideoNew.mp4.bak");
	},
	run() {
		const src = this.srcPath();
		const bak = this.backupPath();
		const target = this.targetPath();
		try {
			if (!fs.exists(target)) {
				try { app.showToast("目标不存在: " + target); } catch (e) {}
				return;
			}
			if (this.restoreMode) {
				if (!fs.exists(bak)) {
					try { app.showToast("无官方备份可恢复(先不勾选恢复执行一次替换)"); } catch (e) {}
					return;
				}
				fs.write(target, fs.read(bak, "binary"));
				try { app.showToast("已恢复官方视频,重启游戏生效"); } catch (e) {}
				return;
			}
			if (!fs.exists(src)) {
				try { app.showToast("未找到视频,请先放入: 资源目录/kusug/loginVideoNew.mp4"); } catch (e) {}
				return;
			}
			if (!fs.exists(bak)) fs.write(bak, fs.read(target, "binary"));
			fs.write(target, fs.read(src, "binary"));
			try { app.showToast("已替换主界面视频,重启游戏生效"); } catch (e) {}
		} catch (e) {
			try { app.showToast("操作失败: " + String(e).slice(0, 80)); } catch (e2) {}
		}
	},
	onModuleEvent(args) {
		if (typeof args.lv_restore !== "undefined") this.restoreMode = Boolean(args.lv_restore);
		if (!stdToggle(this, args, "主界面视频")) return;
		if (!this.enabled) return;
		this.run();
	}
};

const gmPanel = {
	tag: "fun_gm_panel",
	enabled: false,
	OPEN_PY: `
from gui_2d import GUI, ui_const
from gui_2d.ui.easy_debug_ui.debug_ui import DebugUI
root = getattr(GUI.ui_mgr.try_get_scene(ui_const.DEBUGUI_SCENE), '_root', None)
if not root:
    import cc
    root = cc.Director.getInstance().getRunningScene()
inst = DebugUI(root, hide=False)
inst.visible = True
try:
    GUI.ui_mgr.show_gui(ui_const.GAME_DEBUG_EYE)
except Exception:
    pass
`,
	CLOSE_PY: `
from gui_2d import GUI, ui_const
from gui_2d.ui.easy_debug_ui.debug_ui import DebugUI
inst = DebugUI.get_instance()
if inst is not None:
    inst.visible = False
try:
    GUI.ui_mgr.hide_gui(ui_const.GAME_DEBUG_EYE)
except Exception:
    pass
`,
	onModuleEvent(args) {
		if (!stdToggle(this, args, "GM菜单")) return;
		if (!this.enabled) {
			try { app.evalPython(this.CLOSE_PY); } catch (e) {}
			return;
		}
		try {
			app.evalPython(this.OPEN_PY);
		} catch (e) {
			this.enabled = false;
			if (this.hud) this.hud.enabled = false;
			try { app.showToast("打开失败: " + String(e).slice(0, 60)); } catch (e2) {}
		}
	}
};

const checkCmd = {
	tag: "fun_check_cmd",
	enabled: false,
	lastSig: "",
	jsMode: false,
	tipN: 0,
	lastTipMsg: "",
	soDst: kuNative.soDst,
	loaded: false,
	showing: false,
	bufAddr: 0n,
	BLOCKS: new Set([
		"minecraft:chain_command_block",
		"minecraft:repeating_command_block",
		"minecraft:command_block"
	]),
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
	loadSo() {
		const err = kuNative.load();
		if (err) return err;
		this.loaded = true;
		this.bufAddr = kuNative.addr(51);
		return "";
	},
	sc(op, a) {
		kuNative.call(op, a);
	},
	pushContent(lines) {
		const sig = lines.join("|");
		if (sig === this.lastSig) return;
		this.lastSig = sig;
		if (!this.bufAddr) return;
		wplChan.owner = this;
		const bytes = encodeUtf8(lines.join("\n"));
		if (bytes.length > 8000) return;
		try {
			soPush(this.bufAddr, bytes);
			kuNative.call(42, 0);
		} catch (e) {}
	},
	hidePanel() {
		if (wplChan.owner && wplChan.owner !== this) {
			this.showing = false;
			this.lastSig = "";
			return;
		}
		if (this.showing) { this.showing = false; this.sc(43, 0); }
		this.lastSig = "";
		if (wplChan.owner === this) wplChan.owner = null;
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
	releaseWpl(immediate) {
		const self = this;
		const fire = function () { if (self.loaded && (!self.enabled || self.jsMode) && !(typeof structHud !== "undefined" && structHud.enabled && !structHud.jsMode)) { try { kuNative.call(41, 0); } catch (e) {} } };
		if (immediate) fire();
		else setTimeout(fire, 300);
	},
	switchMode(js) {
		this.jsMode = js;
		this.lastSig = "";
		this.showing = false;
		if (!this.enabled) return;
		if (js) {
			this.hidePanel();
			this.releaseWpl(true);
		} else {
			try { minecraft.showTipMessage(""); } catch (e) {}
			let err = "";
			if (!this.loaded) err = this.loadSo();
			if (!err) { try { kuNative.call(41, 1); } catch (e) {} }
		}
	},
	onModuleEvent(args) {
		let wantJs = this.jsMode;
		const mv = argPick(args, "cb_mode");
		if (mv === "cb_mode_js") wantJs = true;
		else if (mv === "cb_mode_so") wantJs = false;
		if (args.cb_mode_js === true) wantJs = true;
		else if (args.cb_mode_so === true) wantJs = false;
		if (!stdToggle(this, args, "查看命令方块")) {
			if (wantJs !== this.jsMode) this.switchMode(wantJs);
			return;
		}
		if (this.enabled) {
			if (this.jsMode) {
				this.lastSig = "";
				return;
			}
			let err = "";
			if (!this.loaded) err = this.loadSo();
			if (err) {
				try { app.showToast("" + err); } catch (e) {}
			} else {
				try { kuNative.call(41, 1); } catch (e) {}
			}
		} else {
			if (this.jsMode) this.clearTip();
			else {
				this.hidePanel();
				this.releaseWpl();
			}
		}
	},
	onTick() {
		if (!this.enabled) return;
		if (this.jsMode) {
			this.tickTip();
			return;
		}
		if (!this.loaded) return;

		let ig = false;
		try { ig = app.isInGame(); } catch (e) {}
		if (!ig || uiVis.poll()) {
			this.hidePanel();
			return;
		}

		try {
			const pos = player.getLocalPlayer().getPos();
			if (pos && isFinite(pos.x)) {
				this.sc(44, Math.round(pos.x * 1000));
				this.sc(45, Math.round(pos.y * 1000));
				this.sc(46, Math.round(pos.z * 1000));
			}
		} catch (e) {}
		const p = this.hitBlock();
		if (!p) {
			this.hidePanel();
			return;
		}
		const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
		try {
			const dimension = player.getLocalPlayer().getDimension();
			const block = dimension.getBlock({ x: px, y: py, z: pz });
			const blockNBT = this.decode(block.getNBT());
			const blockName = this.extract(blockNBT, 'name:"([^"]+)"') || "";
			if (!this.BLOCKS.has(blockName)) {
				this.hidePanel();
				return;
			}
			let complete = "";
			try {
				const blockEntity = dimension.getBlockEntity({ x: px, y: py, z: pz });
				complete = this.decode(blockEntity.getNBT());
			} catch (e) {}
			const isRedStoneMode = !+this.extract(complete, "auto:(\\d)b");
			const isConditional = !!+this.extract(blockNBT, "conditional_bit:(\\d)b") || !!+this.extract(complete, "conditionalMode:(\\d)b");
			const command = this.unesc(complete?.match(/Command:"(.*?)",CustomName:/)?.[1] || this.extract(complete, 'Command:"((?:[^"\\\\]|\\\\.)*)"'));
			const tickDelay = +this.extract(complete, "TickDelay:(\\d+)") || 0;
			const nameCN = blockName === "minecraft:chain_command_block" ? "锁链" : blockName === "minecraft:repeating_command_block" ? "循环" : "脉冲";
			const customName = this.unesc(this.extract(complete, 'CustomName:"((?:[^"\\\\]|\\\\.)*)"'));
			this.pushContent([
				command || "空链",
				"类型:" + nameCN,
				"条件:" + (isConditional ? "有条件" : "无条件"),
				"红石:" + (isRedStoneMode ? "红石控制" : "保持开启"),
				"延迟:" + tickDelay,
				customName ? "n:名称:" + customName : ""
			]);
			this.sc(47, px);
			this.sc(48, py);
			this.sc(49, pz);
			if (!this.showing) { this.showing = true; this.sc(43, 1); }
			} catch (e) {}
		},
	tickTip() {
		let ig = true;
		try { ig = app.isInGame(); } catch (e) {}
		if (!ig || uiVis.poll()) {
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
			const nameCN = blockName === "minecraft:chain_command_block" ? "锁链" : blockName === "minecraft:repeating_command_block" ? "循环" : "脉冲";
			const isRedStoneMode = !+this.extract(complete, "auto:(\\d)b");
			const isConditional = !!+this.extract(blockNBT, "conditional_bit:(\\d)b") || !!+this.extract(complete, "conditionalMode:(\\d)b");
			const command = this.unesc(complete?.match(/Command:"(.*?)",CustomName:/)?.[1] || this.extract(complete, 'Command:"((?:[^"\\\\]|\\\\.)*)"'));
			const tickDelay = +this.extract(complete, "TickDelay:(\\d+)") || 0;
			const customName = this.unesc(this.extract(complete, 'CustomName:"((?:[^"\\\\]|\\\\.)*)"'));
			const trackOut = !!+this.extract(complete, "TrackOutput:(\\d)b");
			const firstTick = !!+this.extract(complete, "ExecuteOnFirstTick:(\\d)b");
			const sig = px + "," + py + "," + pz + "|" + command + "|" + customName + "|" + tickDelay + (isConditional ? 1 : 0) + (isRedStoneMode ? 1 : 0) + (trackOut ? 1 : 0) + (firstTick ? 1 : 0);
			if (sig === this.lastSig) {
				if (++this.tipN >= 10) {
					this.tipN = 0;
					try { minecraft.showTipMessage(this.lastTipMsg); } catch (e) {}
				}
				return;
			}
			this.lastSig = sig;
			this.tipN = 0;
			const hasContent = command || customName;
			const message = hasContent ?
				`[§fＣｏｍｍａｎｄ-Ｉｎｆｏｒｍａｔｉｏｎ§7]\n` +
				`§6类型: §f${nameCN}\n` +
				`§6模式: §f${isRedStoneMode ? "红石控制" : "保持开启"}\n` +
				`§6条件: §f${isConditional ? "是" : "否"}\n` +
				`§6命令: §f${(command || "").match(/.{1,60}/g)?.map((s, i, a) => i < a.length - 1 ? s + "\n§f" : s).join("") || ""}\n` +
				`§6悬停: §f${customName || "无"}\n` +
				`§6延迟: §f${tickDelay}刻\n` +
				`§6追踪输出: §f${trackOut ? "是" : "否"}\n` +
				`§6首次执行: §f${firstTick ? "是" : "否"}` :
				"§l§c〉空链〈";
			this.lastTipMsg = message;
			try { minecraft.showTipMessage(message); } catch (e) {}
		} catch (e) {}
	}
};

const wplChan = { owner: null };

const structHud = {
	tag: "fun_struct_block",
	enabled: false,
	lastSig: "",
	jsMode: false,
	tipN: 0,
	lastTipMsg: "",
	soDst: kuNative.soDst,
	loaded: false,
	showing: false,
	bufAddr: 0n,
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
	loadSo() {
		const err = kuNative.load();
		if (err) return err;
		this.loaded = true;
		this.bufAddr = kuNative.addr(51);
		return "";
	},
	sc(op, a) {
		kuNative.call(op, a);
	},
	pushContent(lines) {
		const sig = lines.join("|");
		if (sig === this.lastSig) return;
		this.lastSig = sig;
		if (!this.bufAddr) return;
		wplChan.owner = this;
		const bytes = encodeUtf8(lines.join("\n"));
		if (bytes.length > 8000) return;
		try {
			soPush(this.bufAddr, bytes);
			kuNative.call(42, 0);
		} catch (e) {}
	},
	hidePanel() {
		if (wplChan.owner && wplChan.owner !== this) {
			this.showing = false;
			this.lastSig = "";
			return;
		}
		if (this.showing) { this.showing = false; this.sc(43, 0); }
		this.lastSig = "";
		if (wplChan.owner === this) wplChan.owner = null;
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
	releaseWpl(immediate) {
		const self = this;
		const fire = function () { if (self.loaded && (!self.enabled || self.jsMode) && !(typeof checkCmd !== "undefined" && checkCmd.enabled && !checkCmd.jsMode)) { try { kuNative.call(41, 0); } catch (e) {} } };
		if (immediate) fire();
		else setTimeout(fire, 300);
	},
	switchMode(js) {
		this.jsMode = js;
		this.lastSig = "";
		this.showing = false;
		if (!this.enabled) return;
		if (js) {
			this.hidePanel();
			this.releaseWpl(true);
		} else {
			try { minecraft.showTipMessage(""); } catch (e) {}
			let err = "";
			if (!this.loaded) err = this.loadSo();
			if (!err) { try { kuNative.call(41, 1); } catch (e) {} }
		}
	},
	onModuleEvent(args) {
		let wantJs = this.jsMode;
		const mv = argPick(args, "sb_mode");
		if (mv === "sb_mode_js") wantJs = true;
		else if (mv === "sb_mode_so") wantJs = false;
		if (args.sb_mode_js === true) wantJs = true;
		else if (args.sb_mode_so === true) wantJs = false;
		if (!stdToggle(this, args, "查看结构方块")) {
			if (wantJs !== this.jsMode) this.switchMode(wantJs);
			return;
		}
		if (this.enabled) {
			if (this.jsMode) {
				this.lastSig = "";
				return;
			}
			let err = "";
			if (!this.loaded) err = this.loadSo();
			if (err) {
				try { app.showToast("" + err); } catch (e) {}
			} else {
				try { kuNative.call(41, 1); } catch (e) {}
			}
		} else {
			if (this.jsMode) this.clearTip();
			else {
				this.hidePanel();
				this.releaseWpl();
			}
		}
	},
	onTick() {
		if (!this.enabled) return;
		if (this.jsMode) {
			this.tickTip();
			return;
		}
		if (!this.loaded) return;

		let ig = false;
		try { ig = app.isInGame(); } catch (e) {}
		if (!ig || uiVis.poll()) {
			this.hidePanel();
			return;
		}

		try {
			const pos = player.getLocalPlayer().getPos();
			if (pos && isFinite(pos.x)) {
				this.sc(44, Math.round(pos.x * 1000));
				this.sc(45, Math.round(pos.y * 1000));
				this.sc(46, Math.round(pos.z * 1000));
			}
		} catch (e) {}
		const p = this.hitBlock();
		if (!p) {
			this.hidePanel();
			return;
		}
		const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
		try {
			const dimension = player.getLocalPlayer().getDimension();
			const block = dimension.getBlock({ x: px, y: py, z: pz });
			const blockNBT = this.decode(block.getNBT());
			const blockName = this.extract(blockNBT, 'name:"([^"]+)"') || "";
			if (blockName !== "minecraft:structure_block") {
				this.hidePanel();
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
			this.pushContent([
				modeCN + " " + sx + "×" + sy + "×" + sz,
				"偏移:" + ox + "," + oy + "," + oz,
				"旋转:" + rot + "°",
				"镜像:" + mirrorCN,
				"完整性:" + (integrity % 1 ? integrity.toFixed(1) : integrity) + "%",
				"种子:" + (seed && seed !== "0" ? seed : "随机"),
				"实体:" + (ignoreEntities ? "忽略" : "包含"),
				"玩家:" + (includePlayers ? "包含" : "不含"),
				"忽略方块:" + (removeBlocks ? "是" : "否"),
				"边框:" + (showBB ? "显示" : "隐藏"),
				"红石:" + (powered ? "已激活" : "未激活"),
				"动画:" + animCN + (animN > 0 ? " " + (animSec % 1 ? animSec.toFixed(1) : animSec) + "s" : ""),
				"保存至:" + (rsMode === 1 ? "硬盘" : "内存"),
				structName ? "n:结构名:" + structName : ""
			]);
			this.sc(47, px);
			this.sc(48, py);
			this.sc(49, pz);
			if (!this.showing) { this.showing = true; this.sc(43, 1); }
		} catch (e) {}
	},
	tickTip() {
		let ig = true;
		try { ig = app.isInGame(); } catch (e) {}
		if (!ig || uiVis.poll()) {
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

function PatchChatMessage(data, replacer) {
	const r = binReader(data);
	r.skip(2);
	r.skip(r.uvarint());
	const msgStart = r.off;
	const msgLen = r.uvarint();
	r.need(msgLen);
	const cStart = r.off;
	r.off += msgLen;
	const message = decodeUtf8(r.u8.slice(cStart, cStart + msgLen));
	const next = replacer(message);
	if (typeof next !== "string" || next === message) return false;
	const nb = encodeUtf8(next);
	return joinParts([r.u8.slice(0, msgStart), uvarintBytes(nb.length), nb, r.u8.slice(cStart + msgLen)]);
}

function ReadChatMessage(data) {
	try {
		const r = binReader(data);
		r.skip(2);
		r.skip(r.uvarint());
		const msgLen = r.uvarint();
		r.need(msgLen);
		return decodeUtf8(r.u8.slice(r.off, r.off + msgLen));
	} catch (e) {
		return null;
	}
}

const texInject = {
	tag: "fun_tex_inject",
	enabled: false,
	busy: false,
	restoreMode: false,
	bootAt: Date.now(),
	soDst: kuNative.soDst,
	loaded: false,
	bufAddr: 0n,
	loadSo() {
		const err = kuNative.load();
		if (err) return err;
		this.loaded = true;
		this.bufAddr = kuNative.addr(40);
		return "";
	},
	run0(mode) {
		if (!this.loaded) {
			const err = this.loadSo();
			if (err) return ["ERR " + err];
		}
		if (!this.bufAddr) return ["ERR so 无输入缓冲区"];
		const chan = app.getResource("KuSug/材质包注入缓存.txt");
		const resDir = app.getResource("KuSug/resource_packs");
		const payload = resDir + "\n" + chan + "\n" + "/data/data/" + gamePkg + "/files\n";
		const bytes = encodeUtf8(payload);
		try {
			soPush(this.bufAddr, bytes);
			kuNative.call(39, mode);
		} catch (e) {
			return ["ERR 调用失败: " + (e && e.message ? e.message : e)];
		}
		try {
			const r = String(fs.read(chan) || "").split("\n");
			try { fs.write(chan, ""); } catch (e) {}
			return r;
		} catch (e) {
			return ["ERR 回读失败: " + e];
		}
	},
	onModuleEvent(args) {
		if (typeof args.tex_restore !== "undefined") this.restoreMode = Boolean(args.tex_restore);
		if (!stdToggle(this, args, "材质包注入")) return;
		if (!this.enabled) return;
		if (Date.now() - this.bootAt < 6000) return;
		if (this.busy) return;
		this.busy = true;
		try {
			const lines = this.run0(this.restoreMode ? 0 : 1);
			let tail = "";
			for (const l of lines) { if (/^(OK|ERR) /.test(l)) tail = l; }
			if (tail) {
				const text = tail.indexOf("OK ") === 0 ? (this.restoreMode ? "已还原官方材质,请重启游戏" : "注入成功,请重启游戏") : tail.slice(3);
				try { app.showToast("" + text); } catch (e) {}
				try { minecraft.clientMessage("§b[材质包注入] §f" + text); } catch (e) {}
			}
		} finally {
			this.busy = false;
		}
	}
};

const sendControl = {
	tag: "fun_send_control",
	enabled: false,
	prefix: "",
	suffix: "",
	meMode: false,
	colour: true,
	colourSp: true,
	bold: false,
	newline: false,
	built: [],
	meQueue: [],
	meVersion: 88,
	clampText(s) {
		return [...String(s)].slice(0, 30).join("");
	},
	onModuleEvent(args) {
		if (typeof args.send_prefix === "string") this.prefix = this.clampText(args.send_prefix);
		if (typeof args.send_suffix === "string") this.suffix = this.clampText(args.send_suffix);
		if (typeof args.send_me !== "undefined") this.meMode = Boolean(args.send_me);
		if (typeof args.send_colour !== "undefined") this.colour = Boolean(args.send_colour);
		if (typeof args.send_colour_sp !== "undefined") this.colourSp = Boolean(args.send_colour_sp);
		if (typeof args.send_bold !== "undefined") this.bold = Boolean(args.send_bold);
		if (typeof args.send_newline !== "undefined") this.newline = Boolean(args.send_newline);
		if (!stdToggle(this, args, "发言控制")) return;
		if (!this.enabled) {
			this.built = [];
			this.meQueue = [];
		}
	},
	buildText(message) {
		let body = message;
		let head = this.prefix;
		let tail = this.suffix;
		if (this.newline) {
			body = String(body).replace(/\\n/g, "\n");
			head = head.replace(/\\n/g, "\n");
			tail = tail.replace(/\\n/g, "\n");
		}
		if (this.colour && !this.colourSp) body = colorizeText(body);
		if (tail !== "" && this.colour && !this.colourSp) tail = "§r" + (this.bold ? "§l" : "") + tail;
		let out = head + body + tail;
		if (this.colour && this.colourSp) out = colorizeText(out);
		if (this.bold) out = "§l" + out;
		return out;
	},
	hasTextFeature() {
		return this.colour || this.prefix !== "" || this.suffix !== "" || this.newline;
	},
	learnVersion(data) {
		try {
			const r = binReader(data);
			r.skip(r.uvarint());
			const type = r.uvarint();
			if (type !== 0) return;
			r.skip(16);
			r.skip(r.uvarint());
			r.skip(1);
			const v = r.uvarint();
			if (v > 0 && v < 100000) this.meVersion = v;
		} catch (e) {}
	},
	onSendServerPacket(id, name, bin) {
		if (id === 77) {
			this.learnVersion(bin);
			return false;
		}
		if (!this.enabled || id !== 9) return false;
		if (this.meMode) {
			const message = ReadChatMessage(bin);
			if (!message || message.indexOf("/") === 0) return false;
			if (this.meQueue.length < 10) this.meQueue.push(message);
			return true;
		}
		if (!this.hasTextFeature()) return false;
		try {
			return PatchChatMessage(bin, (message) => {
				if (!message || message.indexOf("/") === 0) return null;
				const idx = this.built.indexOf(message);
				if (idx !== -1) {
					this.built.splice(idx, 1);
					return null;
				}
				const next = this.buildText(message);
				this.built.push(next);
				if (this.built.length > 10) this.built.shift();
				return next;
			});
		} catch (e) {}
		return false;
	},
	onTick() {
		if (!this.enabled || !this.meMode) {
			this.meQueue.length = 0;
			return;
		}
		if (!this.meQueue.length) return;
		const message = this.meQueue.shift();
		try {
			packet.sendCommandRequestPacket({ command: "/me " + this.buildText(message), version: this.meVersion });
		} catch (e) {
			this.log("转换失败: " + e);
		}
	},
	log: mkLog("§b[发言控制] ")
};

function chatSend(text) {
	try { minecraft.sendChatMessage(text); } catch (e) {}
	return false;
}

function PatchTradeTiers(data) {
	const u8 = new Uint8Array(data);
	const len = u8.length;
	let off = 0;
	const tiers = [];
	const need = (n) => { if (off + n > len) throw new Error("eof@" + off); };
	const byte = () => { need(1); return u8[off++]; };
	const skip = (n) => { need(n); off += n; };
	const uv = () => {
		let v = 0, s = 0, b;
		do { b = byte(); v += (b & 0x7F) * (2 ** s); s += 7; } while ((b & 0x80) && s < 70);
		return v;
	};
	const sv = () => {
		const u = uv();
		const h = Math.floor(u / 2);
		return u % 2 ? -h - 1 : h;
	};
	const str = () => {
		const n = uv();
		need(n);
		let s = "";
		for (let i = 0; i < n; i++) s += String.fromCharCode(u8[off + i]);
		off += n;
		return s;
	};
	const walkCompound = () => {
		for (;;) {
			const t = byte();
			if (t === 0) return;
			const name = str();
			walkValue(t, name);
		}
	};
	const walkValue = (t, name) => {
		switch (t) {
			case 1: skip(1); break;
			case 2: skip(2); break;
			case 3: {
				const start = off;
				sv();
				if (name === "tier" && off - start === 1) tiers.push(start);
				break;
			}
			case 4: sv(); break;
			case 5: skip(4); break;
			case 6: skip(8); break;
			case 7: { const n = sv(); if (n < 0) throw new Error("neg-len"); skip(n); break; }
			case 8: str(); break;
			case 9: {
				const et = byte();
				const n = sv();
				if (n < 0) throw new Error("neg-len");
				for (let i = 0; i < n; i++) walkValue(et, "");
				break;
			}
			case 10: walkCompound(); break;
			case 11: { const n = sv(); if (n < 0) throw new Error("neg-len"); for (let i = 0; i < n; i++) sv(); break; }
			default: throw new Error("tag" + t + "@" + off);
		}
	};
	skip(2);
	sv();
	sv();
	sv();
	sv();
	str();
	let nbtStart = -1;
	for (let p = off; p < Math.min(off + 4, len); p++) {
		if (u8[p] === 10) { nbtStart = p; break; }
	}
	if (nbtStart < 0) throw new Error("no-nbt");
	off = nbtStart;
	byte();
	str();
	walkCompound();
	const out = new Uint8Array(u8);
	for (const o of tiers) out[o] = 0;
	return { buf: tiers.length ? out.buffer : null, n: tiers.length };
}

function entityNameById(id) {
	try {
		const ent = world.getClientWorld().getEntity(id);
		if (ent) {
			const n = String(ent.getName() || "");
			if (n) return n;
		}
	} catch (e) {}
	try {
		const list = world.getClientWorld().getPlayerList();
		for (const k in list) {
			const p = list[k];
			if (p && String(p.id) === String(id)) return p.name || "";
		}
	} catch (e) {}
	return "";
}

function argPick(args, key) {
	const parts = key.split("_");
	let pascal = "";
	for (const p of parts) pascal += (pascal ? "_" : "") + p.charAt(0).toUpperCase() + p.slice(1);
	if (args[pascal] !== undefined) return args[pascal];
	if (args[key] !== undefined) return args[key];
	return args[key.charAt(0).toUpperCase() + key.slice(1)];
}

const tauntDefaultText = ["§7{name} 不过如此", "§f{name} §7就这？", "§e{name} §7回去再练练吧", "§b{name} §7被 §f{self} §7抬走了"].join("\n");
function ensureTauntFile() {
	try {
		const p = app.getResource("KuSug/嘲讽文本.txt");
		if (fs.exists(p)) return;
		try { fs.createDirectories(app.getResource("KuSug")); } catch (e) {}
		fs.write(p, tauntDefaultText);
	} catch (e) {}
}

function tauntFire(victimName, mode, customText) {
	let line = "";
	if (mode === "text") line = String(customText || "").trim();
	if (!line) {
		let lines = [];
		try {
			ensureTauntFile();
			const raw = String(fs.read(app.getResource("KuSug/嘲讽文本.txt")) || "");
			for (const s of raw.split(/\r?\n/)) {
				const t = s.trim();
				if (t) lines.push(t);
			}
		} catch (e) {}
		if (!lines.length) lines = ["§7{name} 不过如此", "§f{name} §7就这？"];
		line = lines[Math.floor(Math.random() * lines.length)];
	}
	let self = "";
	try { self = String(player.getLocalPlayer().getName() || ""); } catch (e) {}
	return line.replace(/\{name\}/g, victimName).replace(/\{self\}/g, self);
}

const tradeUnlock = {
	tag: "fun_trade_unlock",
	enabled: false,
	onModuleEvent(args) {
		stdToggle(this, args, "跨等级交易");
	},
	onReceiveServerPacket(id, name, bin) {
		if (!this.enabled || id !== 80) return null;
		try {
			const r = PatchTradeTiers(bin);
			if (r.n > 0) return r.buf;
		} catch (e) {}
		return null;
	}
};

const fpsHud = {
	tag: "fun_fps",
	enabled: true,
	applied: false,
	tickCount: 0,
	PY_ON: `
from gui_2d import GUI, ui_const
import mod.client.extraClientApi as clientApi

FLAG = "${app.getResource("KuSug/fps_on.flag")}"

win = GUI.ui_mgr.try_get_gui(ui_const.USER_INFO_WATER_MARK)
applied = False
if win and win.is_valid():
    try:
        win.cancel_timer(win.panel_user_info_timer)
        win.panel_user_info_timer = 0
    except Exception:
        pass
    old = getattr(win, "_ks_fps_timer", 0)
    if old:
        try:
            win.cancel_timer(old)
        except Exception:
            pass
        win._ks_fps_timer = 0
    t = win._text_time
    if t.is_valid():
        if getattr(t, "_parent_widget", None) is None:
            t.add_to_parent(win._panel_info)
        t.visible = True
        t.text = "FPS:--"

        def _ks_fps_tick():
            try:
                fps = clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId()).GetFps()
                t.text = "FPS:" + str(int(float(fps)))
            except Exception:
                t.text = "FPS:--"

        win._ks_fps_timer = win.add_timer(1, _ks_fps_tick, True)
        applied = True
if applied:
    try:
        with open(FLAG, "w") as f:
            f.write("1")
    except Exception:
        pass
`,
	PY_OFF: `
from gui_2d import GUI, ui_const

win = GUI.ui_mgr.try_get_gui(ui_const.USER_INFO_WATER_MARK)
if win and win.is_valid():
    old = getattr(win, "_ks_fps_timer", 0)
    if old:
        try:
            win.cancel_timer(old)
        except Exception:
            pass
        win._ks_fps_timer = 0
    t = win._text_time
    if t.is_valid():
        t.remove_from_parent()
"off"
`,
	applyOn() {
		const flag = app.getResource("KuSug/fps_on.flag");
		try { fs.write(flag, "0"); } catch (e) {}
		try {
			app.evalPython(this.PY_ON);
		} catch (e) {
			return false;
		}
		try {
			return String(fs.read(flag) || "").trim() === "1";
		} catch (e) {
			return false;
		}
	},
	onModuleEvent(args) {
		if (!stdToggle(this, args, "FPS显示")) return;
		if (this.enabled) {
			this.applied = this.applyOn();
		} else {
			try { app.evalPython(this.PY_OFF); } catch (e) {}
			this.applied = false;
		}
	},
	onTick() {
		if (!this.enabled || this.applied || !tickEvery(this, 20)) return;
		this.applied = this.applyOn();
	}
};

const killTaunt = {
	tag: "fun_kill_taunt",
	enabled: false,
	attacks: [],
	lastFire: 0,
	cdSec: 3,
	mode: "file",
	text: "",
	onModuleEvent(args) {
		const kcd = clampPos(argPick(args, "kill_taunt_cd"), 1, 60);
		if (kcd) this.cdSec = kcd;
		radio2(args, "kill_taunt_mode", "kill_taunt_mode_text", "kill_taunt_mode_file", this, "mode", "text", "file");
		const tx = argPick(args, "kill_taunt_text");
		if (typeof tx === "string") this.text = tx;
		if (!stdToggle(this, args, "击杀嘲讽")) return;
		if (this.enabled) ensureTauntFile();
		else this.attacks = [];
	},
	onPlayerAttack(playerId, targetId) {
		if (!this.enabled) return;
		this.attacks.push({ id: String(targetId), name: entityNameById(targetId), t: Date.now() });
		if (this.attacks.length > 20) this.attacks.shift();
	},
	onEntityBehavior(entityId, behaviorId) {
		if (!this.enabled || behaviorId !== 3) return;
		const now = Date.now();
		if (now - this.lastFire < this.cdSec * 1000) return;
		const id = String(entityId);
		for (let i = this.attacks.length - 1; i >= 0; i--) {
			const a = this.attacks[i];
			if (now - a.t > 15000) {
				this.attacks.splice(i, 1);
				continue;
			}
			if (a.id !== id) continue;
			this.attacks.splice(i, 1);
			this.lastFire = now;
			chatSend(tauntFire(a.name || "对手", this.mode, this.text));
			return;
		}
	}
};

const attackTaunt = {
	tag: "fun_attack_taunt",
	enabled: false,
	cdSec: 8,
	mode: "file",
	text: "",
	lastFire: 0,
	onModuleEvent(args) {
		const acd = clampPos(argPick(args, "attack_taunt_cd"), 1, 60);
		if (acd) this.cdSec = acd;
		radio2(args, "attack_taunt_mode", "attack_taunt_mode_text", "attack_taunt_mode_file", this, "mode", "text", "file");
		const tx = argPick(args, "attack_taunt_text");
		if (typeof tx === "string") this.text = tx;
		if (!stdToggle(this, args, "攻击嘲讽")) return;
		if (this.enabled) {
			this.lastFire = 0;
			ensureTauntFile();
		}
	},
	onPlayerAttack(playerId, targetId) {
		if (!this.enabled) return;
		const now = Date.now();
		if (now - this.lastFire < this.cdSec * 1000) return;
		this.lastFire = now;
		chatSend(tauntFire(entityNameById(targetId) || "对手", this.mode, this.text));
	}
};

const autoDrop = {
	tag: "fun_auto_drop",
	enabled: false,
	iterateHotbar: true,
	mode: "btn",
	slot: 0,
	needSelect: false,
	pyReady: false,
	pyInstall: "import mod.client.extraClientApi as clientApi\ndef _kusug_pet_drop(slot):\n    try:\n        s = clientApi.GetSystem('Minecraft', 'pet')\n        if not s:\n            if not globals().get('_kusug_pet_drop_noted'):\n                globals()['_kusug_pet_drop_noted'] = True\n                from gui_2d import GUI\n                GUI.ui_mgr.show_toast(u'该服未开启宠物系统，无法使用宠物通道')\n            return\n        d = s.CreateEventData()\n        d['playerId'] = clientApi.GetLocalPlayerId()\n        d['slot'] = slot\n        d['item'] = None\n        s.NotifyToServer('drop_pet_bag_item', d)\n    except Exception as e:\n        if not globals().get('_kusug_pet_drop_noted'):\n            globals()['_kusug_pet_drop_noted'] = True\n            try:\n                from gui_2d import GUI\n                GUI.ui_mgr.show_toast(u'宠物通道丢物失败: %s' % e)\n            except Exception:\n                pass\nglobals()['_kusug_pet_drop'] = _kusug_pet_drop",
	onModuleEvent(args) {
		if (typeof args.auto_drop_hotbar !== "undefined") this.iterateHotbar = Boolean(args.auto_drop_hotbar);
		radio2(args, "auto_drop_mode", "auto_drop_mode_btn", "auto_drop_mode_pet", this, "mode", "btn", "pet");
		if (!stdToggle(this, args, "自动丢物", false, this.mode === "pet" ? "宠物通道" : "按键模式")) return;
		if (this.enabled) {
			this.slot = 0;
			this.needSelect = this.iterateHotbar && this.mode === "btn";
		}
	},
	log: mkLog("§b[自动丢物] "),
	petDrop(slot) {
		if (!this.pyReady) {
			this.pyReady = true;
			try { app.evalPython(this.pyInstall); } catch (e) {}
		}
		try {
			app.evalPython("globals()['_kusug_pet_drop'](" + slot + ")");
			return true;
		} catch (e) {
			this.log("§c宠物通道调用失败: " + e);
			return false;
		}
	},
	onTick() {
		if (!this.enabled) return;
		let lp;
		try { lp = player.getLocalPlayer(); } catch (e) { return; }
		if (this.mode === "pet") {
			let slot = this.slot;
			if (!this.iterateHotbar) {
				try { slot = Number(lp.getSelectItemSlot()) || 0; } catch (e) { slot = 0; }
			}
			if (!this.petDrop(slot)) {
				this.enabled = false;
				this.log("§c已自动关闭");
				return;
			}
			if (!this.iterateHotbar) return;
			this.slot++;
			let petHotbar = 9;
			try { petHotbar = lp.getHotBarSize(); } catch (e) {}
			if (this.slot >= petHotbar) this.slot = 0;
			return;
		}
		if (this.iterateHotbar && this.needSelect) {
			try { lp.setSelectItemSlot(this.slot); } catch (e) {
				this.log("§c选槽失败: " + e.message);
				this.enabled = false;
				return;
			}
			this.needSelect = false;
		}
		try {
			input.buttonDown("button.drop");
			input.buttonUp("button.drop");
		} catch (e) {
			this.log("§c丢出失败: " + e.message);
			this.enabled = false;
			return;
		}
		if (!this.iterateHotbar) return;
		this.slot++;
		let hotbar = 9;
		try { hotbar = lp.getHotBarSize(); } catch (e) {}
		if (this.slot >= hotbar) this.slot = 0;
		this.needSelect = true;
	}
};

const attackFx = {
	tag: "fun_attack_fx",
	enabled: false,
	sound: true,
	uid: "",
	boltSeq: 0,
	lastSound: 0,
	lastBolt: 0,
	boltCd: 150,
	dbgLines: [],
	dbgPath: "",
	dbg(msg) {
		try {
			this.dbgLines.push((Date.now() % 1000000) + " " + msg);
			if (this.dbgLines.length > 30) this.dbgLines.shift();
			if (!this.dbgPath) this.dbgPath = app.getFilesDir() + "/kusug_afx_debug.log";
			fs.write(this.dbgPath, this.dbgLines.join("\n"));
		} catch (e) {}
	},
	/* 音效走官方 CreateCustomAudio.PlayCustomMusic(z1yr killeffect 同款); 旧 _entitymodule.play_sound 一响就炸穿 mod Python 运行时(2026-09-16 设备实证)。
	   落雷实体保持原注包方案不变 */
	pyOn: `
import mod.client.extraClientApi as clientApi

def _kusug_afx_thunder(x, y, z):
    try:
        clientApi.GetEngineCompFactory().CreateCustomAudio(clientApi.GetLevelId()).PlayCustomMusic('ambient.weather.thunder', (x, y, z), 1.0, 1.0, False, None)
    except Exception:
        pass

def _kusug_afx_impact(x, y, z, pitch):
    try:
        clientApi.GetEngineCompFactory().CreateCustomAudio(clientApi.GetLevelId()).PlayCustomMusic('ambient.weather.lightning.impact', (x, y, z), 4.0, pitch, False, None)
    except Exception:
        pass
`,
	pyOff: `
pass
`,
	onModuleEvent(args) {
		if (typeof args.attack_fx_sound !== "undefined") {
			this.sound = Boolean(args.attack_fx_sound);
		}
		if (!stdToggle(this, args, "攻击特效", true, "攻击实体落雷")) return;
		this.dbg(this.enabled ? "on" : "off");
		if (!this.enabled) this.uid = "";
		try { app.evalPython(this.enabled ? this.pyOn : this.pyOff); } catch (e) {}
	},
	onPlayerAttack(playerId, targetId) {
		if (!this.enabled) return;
		if (!this.uid) {
			try { this.uid = String(player.getLocalPlayer().getUniqueID()); } catch (e) { this.uid = "?"; }
		}
		if (this.uid !== "?" && String(playerId) !== this.uid) return;
		const pos = this.victimFootPos(targetId);
		if (pos) this.strike(pos);
	},
	victimFootPos(targetId) {
		try {
			const ent = world.getClientWorld().getEntity(targetId);
			if (!ent) return null;
			try {
				const bb = ent.getAABB();
				if (bb && bb.lower && bb.upper) {
					return { x: (bb.lower.x + bb.upper.x) / 2, y: bb.lower.y, z: (bb.lower.z + bb.upper.z) / 2 };
				}
			} catch (e) {}
			const p = ent.getPos();
			if (p) return { x: p.x, y: p.y - 1.62, z: p.z };
		} catch (e) {}
		return null;
	},
	strike(pos) {
		const now = Date.now();
		if (now - this.lastBolt < this.boltCd) { this.dbg("debounce skip (框架攻击事件双发)"); return; }
		this.lastBolt = now;
		this.boltSeq = (this.boltSeq + 1) % 100000;
		this.dbg("bolt build seq=" + this.boltSeq + " pos=" + pos.x.toFixed(1) + " " + pos.y.toFixed(1) + " " + pos.z.toFixed(1));
		// AddEntityPacket(id=13) vanilla v557 线格式; 网易 extra 段仅 hasExtra=true 才写,伪造时为空
		let st = "?";
		try {
			const p = new packet.Packet();
			p.writeVarInt(-(200000 + this.boltSeq));               // uniqueId 负区间, zigzag 字节与 varlong 同构
			p.writeUnsignedVarInt(450000000 + this.boltSeq);       // runtimeId 高区间防撞
			p.writeString("minecraft:lightning_bolt");
			p.writeFloat(pos.x); p.writeFloat(pos.y); p.writeFloat(pos.z);
			p.writeFloat(0); p.writeFloat(0); p.writeFloat(0);
			p.writeFloat(0); p.writeFloat(0);
			p.writeFloat(0);
			p.writeFloat(0);
			p.writeUnsignedVarInt(0);
			p.writeUnsignedVarInt(0);
			p.writeUnsignedVarInt(0);
			p.writeUnsignedVarInt(0);
			p.writeUnsignedVarInt(0);
			st = String(p.sendToLocal(13));
		} catch (e) { st = "ex:" + e; }
		this.dbg("bolt sendToLocal(13)=" + st);
		if (!this.sound) return;
		if (now - this.lastSound < 1000) return;
		this.lastSound = now;
		try {
			app.evalPython("_f = globals().get('_kusug_afx_thunder')\nif _f is not None:\n    _f(" + pos.x + ", " + pos.y + ", " + pos.z + ")");
		} catch (e) { this.dbg("snd ex " + e); }
		/* 真实雷击不只雷声: 约一半概率在落点补一声炸裂音(impact), 音高 0.9~1.1 随机 */
		if (Math.random() < 0.5) {
			const pitch = (0.9 + Math.random() * 0.2).toFixed(2);
			try {
				app.evalPython("_f = globals().get('_kusug_afx_impact')\nif _f is not None:\n    _f(" + pos.x + ", " + pos.y + ", " + pos.z + ", " + pitch + ")");
			} catch (e) { this.dbg("snd2 ex " + e); }
		}
	},
	onWorldExit() {
		this.uid = "";
	}
};

/* 死亡特效: 本人攻击过的实体进 watch, tick 轮询 isAlive(杀戮光环同款判活), 血量到死亡即触发一次落雷+音效。
   实体卸载(getEntity 空)只移出不触发; 音效函数与 attackFx 同名同实现, 此处注入一份保证 attackFx 未开时也存在 */
const deathFx = {
	tag: "fun_death_fx",
	enabled: false,
	onlyMob: false,
	onlyPlayer: false,
	sound: true,
	uid: "",
	watch: [],
	boltSeq: 0,
	lastSound: 0,
	pyOn: `
import mod.client.extraClientApi as clientApi

def _kusug_afx_thunder(x, y, z):
    try:
        clientApi.GetEngineCompFactory().CreateCustomAudio(clientApi.GetLevelId()).PlayCustomMusic('ambient.weather.thunder', (x, y, z), 1.0, 1.0, False, None)
    except Exception:
        pass

def _kusug_afx_impact(x, y, z, pitch):
    try:
        clientApi.GetEngineCompFactory().CreateCustomAudio(clientApi.GetLevelId()).PlayCustomMusic('ambient.weather.lightning.impact', (x, y, z), 4.0, pitch, False, None)
    except Exception:
        pass
`,
	pyOff: `
pass
`,
	onModuleEvent(args) {
		if (typeof args.death_fx_only_mob !== "undefined") this.onlyMob = Boolean(args.death_fx_only_mob);
		if (typeof args.death_fx_only_player !== "undefined") this.onlyPlayer = Boolean(args.death_fx_only_player);
		if (typeof args.death_fx_sound !== "undefined") this.sound = Boolean(args.death_fx_sound);
		if (!stdToggle(this, args, "死亡特效", true, "击杀目标落雷")) return;
		if (!this.enabled) { this.uid = ""; this.watch = []; }
		try { app.evalPython(this.enabled ? this.pyOn : this.pyOff); } catch (e) {}
	},
	onPlayerAttack(playerId, targetId) {
		if (!this.enabled) return;
		if (!this.uid) {
			try { this.uid = String(player.getLocalPlayer().getUniqueID()); } catch (e) { this.uid = "?"; }
		}
		if (this.uid !== "?" && String(playerId) !== this.uid) return;
		let ent = null;
		try { ent = world.getClientWorld().getEntity(targetId); } catch (e) {}
		if (!ent) return;
		try { if (ent.isAlive && !ent.isAlive()) return; } catch (e) {}
		let isPlayer = false;
		try { isPlayer = ent.getIdentifier().canonicalName === "minecraft:player"; } catch (e) {}
		const id = String(targetId);
		for (const w of this.watch) {
			if (w.id === id) { w.isPlayer = isPlayer; return; }
		}
		this.watch.push({ id: id, isPlayer: isPlayer });
		if (this.watch.length > 20) this.watch.shift();
	},
	onTick() {
		for (let i = this.watch.length - 1; i >= 0; i--) {
			const w = this.watch[i];
			let ent = null;
			try { ent = world.getClientWorld().getEntity(w.id); } catch (e) {}
			if (!ent) { this.watch.splice(i, 1); continue; }
			let alive = true;
			try { if (ent.isAlive) alive = !!ent.isAlive(); } catch (e) {}
			if (alive) continue;
			this.watch.splice(i, 1);
			if (this.onlyPlayer && !w.isPlayer) continue;
			if (this.onlyMob && w.isPlayer) continue;
			const pos = this.footPos(ent);
			if (pos) this.strike(pos);
		}
	},
	footPos(ent) {
		try {
			const bb = ent.getAABB();
			if (bb && bb.lower && bb.upper) {
				return { x: (bb.lower.x + bb.upper.x) / 2, y: bb.lower.y, z: (bb.lower.z + bb.upper.z) / 2 };
			}
		} catch (e) {}
		try {
			const p = ent.getPos();
			if (p) return { x: p.x, y: p.y - 1.62, z: p.z };
		} catch (e) {}
		return null;
	},
	strike(pos) {
		this.boltSeq = (this.boltSeq + 1) % 100000;
		try {
			const p = new packet.Packet();
			p.writeVarInt(-(200000 + this.boltSeq));
			p.writeUnsignedVarInt(450000000 + this.boltSeq);
			p.writeString("minecraft:lightning_bolt");
			p.writeFloat(pos.x); p.writeFloat(pos.y); p.writeFloat(pos.z);
			p.writeFloat(0); p.writeFloat(0); p.writeFloat(0);
			p.writeFloat(0); p.writeFloat(0);
			p.writeFloat(0);
			p.writeFloat(0);
			p.writeUnsignedVarInt(0);
			p.writeUnsignedVarInt(0);
			p.writeUnsignedVarInt(0);
			p.writeUnsignedVarInt(0);
			p.writeUnsignedVarInt(0);
			p.sendToLocal(13);
		} catch (e) {}
		if (!this.sound) return;
		const now = Date.now();
		if (now - this.lastSound < 1000) return;
		this.lastSound = now;
		try {
			app.evalPython("_f = globals().get('_kusug_afx_thunder')\nif _f is not None:\n    _f(" + pos.x + ", " + pos.y + ", " + pos.z + ")");
		} catch (e) {}
		if (Math.random() < 0.5) {
			const pitch = (0.9 + Math.random() * 0.2).toFixed(2);
			try {
				app.evalPython("_f = globals().get('_kusug_afx_impact')\nif _f is not None:\n    _f(" + pos.x + ", " + pos.y + ", " + pos.z + ", " + pitch + ")");
			} catch (e) {}
		}
	},
	onWorldExit() {
		this.uid = "";
		this.watch = [];
	}
};

const eatRepeat = {
	tag: "fun_eat_repeat",
	enabled: false,
	count: 10,
	onModuleEvent(args) {
		if (args.eat_repeat_count !== undefined) {
			const n = Math.floor(Number(args.eat_repeat_count));
			if (!isNaN(n) && n > 0) this.count = n;
			if (this.enabled) this.setHud();
		}
		if (!stdToggle(this, args, "暴饮暴食", true, "tick内重复 " + this.count + " 次")) return;
		if (this.enabled) this.setHud();
	},
	setHud() {
		const s = "暴饮暴食 x" + this.count;
		try { this.hud.name = s; } catch (e) {}
		try { this.hud.shortName = s; } catch (e) {}
	},
	onSendServerPacket(id, name, bin) {
		if (!this.enabled || id !== 27) return;
		return this.count;
	}
};

const chunkDisplay = {
	tag: "fun_chunk_display",
	enabled: false,
	onModuleEvent(args) {
		if (!stdToggle(this, args, "区块显示", false)) return;
		try { options.setBoolean(289, { value: this.enabled, defaultValue: false }); } catch (e) {}
	}
};

const selfAttack = {
	tag: "fun_self_attack",
	enabled: false,
	cps: 4,
	acc: 0,
	onModuleEvent(args) {
		const sac = clampPos(args.self_attack_cps, 1, 20);
		if (sac) this.cps = sac;
		if (!stdToggle(this, args, "自杀光环", false, "以 " + this.cps + " 次/秒攻击自己")) return;
		this.acc = 0;
	},
	onTick() {
		if (!this.enabled) return;
		this.acc += this.cps / 20;
		if (this.acc < 1) return;
		let lp;
		try { lp = player.getLocalPlayer(); } catch (e) { return; }
		if (!lp) return;
		while (this.acc >= 1) {
			this.acc -= 1;
			try { lp.attack(lp); } catch (e) {}
			try { lp.swing(); } catch (e) {}
		}
	}
};

const ghostBarrier = {
	tag: "fun_ghost_barrier",
	enabled: false,
	target: "self",
	shape: "box",
	rx: 1,
	ry: 2,
	rz: 1,
	scale: 1,
	spin: 0,
	yOff: 0,
	xOff: 0,
	zOff: 0,
	orient: "v",
	writing: "row",
	flipX: false,
	flipY: false,
	interval: 2,
	skipSelf: true,
	excludeMe: true,
	text: "",
	pickIds: {},
	presetPts: null,
	textPts: null,
	textKey: "",
	boxPts: null,
	boxKey: "",
	angle: 0,
	acc: 0,
	failCount: 0,
	cjkFont: null,
	cjkWarned: false,
	scanInit: {},
	MAXPTS: 300,
	FONT_CHARS: " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_",
	FONT_HEX: "000000000000005f00000007000700147f147f14242a7f2a12231308646236495522500005030000001c2241000041221c0014083e081408083e080800503000000808080808006060000020100804023e5149453e00427f400042615149462141454b311814127f1027454545393c4a49493001710905033649494936064949291e003636000000563600000814224100141414141400412214080201510906324979413e"
		+ "7e1111117e7f494949363e414141227f4141221c7f494949417f090909013e4149497a7f0808087f00417f41002040413f017f081422417f404040407f020c027f7f0408107f3e4141413e7f090909063e4151215e7f09192946464949493101017f01013f4040403f1f2040201f3f4038403f631408146307087008076151494543"
		+ "007f41410002040810200041417f0004020102044040404040",
	fontMap: null,
	radioSel(args, group, names) {
		const v = argPick(args, group);
		if (typeof v === "string" && v !== "") {
			const n = v.indexOf(group + "_") === 0 ? v.slice(group.length + 1) : v;
			return names.indexOf(n) >= 0 ? n : null;
		}

		for (const k in args) {
			if (k.indexOf(group + "_") !== 0 || !args[k]) continue;
			const n = k.slice(group.length + 1);
			if (names.indexOf(n) >= 0) return n;
		}
		return null;
	},
	clampInt(v, lo, hi, def) {
		const n = Number(v);
		if (isNaN(n)) return def;
		return Math.max(lo, Math.min(hi, Math.floor(n)));
	},
	onModuleEvent(args) {
		const t = this.radioSel(args, "gb_target", ["self", "all", "pick"]);
		if (t) {
			if (this.scanInit.target && t !== this.target) {
				this.target = t;
				if (t === "pick") this.openPlayerForm();
			} else {
				this.target = t;
			}
			this.scanInit.target = true;
		}
		const sh = this.radioSel(args, "gb_shape", ["box", "preset", "text"]);
		if (sh) {
			if (this.scanInit.shape && sh !== this.shape) {
				this.shape = sh;
				if (sh === "preset") this.openPresetForm();
			} else {
				this.shape = sh;
			}
			this.scanInit.shape = true;
		}
		const tx = argPick(args, "gb_text");
		if (typeof tx === "string") this.text = tx;
		let v = argPick(args, "gb_range_x");
		if (typeof v !== "undefined") this.rx = this.clampInt(v, 0, 8, this.rx);
		v = argPick(args, "gb_range_y");
		if (typeof v !== "undefined") this.ry = this.clampInt(v, 0, 8, this.ry);
		v = argPick(args, "gb_range_z");
		if (typeof v !== "undefined") this.rz = this.clampInt(v, 0, 8, this.rz);
		v = argPick(args, "gb_scale");
		if (typeof v !== "undefined") this.scale = this.clampInt(v, 1, 4, this.scale);
		v = argPick(args, "gb_spin");
		if (typeof v !== "undefined") this.spin = this.clampInt(v, 0, 36, this.spin);
		v = argPick(args, "gb_offset_y");
		if (typeof v !== "undefined") this.yOff = this.clampInt(v, 0, 8, this.yOff);
		v = argPick(args, "gb_offset_x");
		if (typeof v !== "undefined") {
			const nx = Number(v);
			if (!isNaN(nx)) this.xOff = Math.max(-16, Math.min(16, Math.floor(nx)));
		}
		v = argPick(args, "gb_offset_z");
		if (typeof v !== "undefined") {
			const nz = Number(v);
			if (!isNaN(nz)) this.zOff = Math.max(-16, Math.min(16, Math.floor(nz)));
		}
		const o = this.radioSel(args, "gb_orient", ["v", "h"]);
		if (o) this.orient = o;
		const wm = this.radioSel(args, "gb_writing", ["row", "col"]);
		if (wm) this.writing = wm;
		v = argPick(args, "gb_flip_x");
		if (typeof v !== "undefined") this.flipX = Boolean(v);
		v = argPick(args, "gb_flip_y");
		if (typeof v !== "undefined") this.flipY = Boolean(v);
		v = argPick(args, "gb_interval");
		if (typeof v !== "undefined") this.interval = this.clampInt(v, 1, 20, this.interval);
		v = argPick(args, "gb_skip_self");
		if (typeof v !== "undefined") this.skipSelf = Boolean(v);
		v = argPick(args, "gb_exclude_me");
		if (typeof v !== "undefined") this.excludeMe = Boolean(v);
		if (!stdToggle(this, args, "虚影屏障", false)) return;
		this.acc = 0;
		this.angle = 0;
		this.failCount = 0;
	},
	sendOne(id, x, y, z) {

		packet.sendPlayerActionPacket({ id: id, pos: { x: x, y: y, z: z }, action: 17 });
	},
	openPlayerForm() {
		const entries = [];
		let selfId = "";
		try { selfId = String(player.getLocalPlayer().getUniqueID()); } catch (e) {}
		try {
			const list = world.getClientWorld().getPlayerList();
			for (const k in list) {
				const p = list[k];
				if (!p || !p.id) continue;
				const id = String(p.id);
				entries.push({ id: id, name: String(p.name || id) + (id === selfId ? "(自己)" : "") });
			}
		} catch (e) {}
		if (!entries.length) {
			this.log("§c未发现玩家（需进入局内）");
			return;
		}
		const content = [];
		for (const e of entries) {
			content.push({ type: "toggle", text: e.name, default: !!this.pickIds[e.id] });
		}
		const self = this;
		try {
			gui.addForm(JSON.stringify({ type: "custom_form", title: "选择目标玩家(可多选)", content: content }), function () {
				const ids = {};
				for (let i = 0; i < arguments.length && i < entries.length; i++) {
					if (arguments[i]) ids[entries[i].id] = true;
				}
				self.pickIds = ids;
				self.log("§a已选 " + Object.keys(ids).length + " 名玩家");
			}, function () {});
		} catch (e) {
			this.log("§c表单打开失败: " + e);
		}
	},
	presetDir() {
		return app.getResource("kusug/虚影");
	},
	initPresetDir() {
		const dir = this.presetDir();
		if (!fs.exists(dir)) fs.createDirectories(dir);
	},
	openPresetForm() {
		const dir = this.presetDir();
		try { this.initPresetDir(); } catch (e) {}
		const names = [];
		try {
			const files = fs.list(dir);
			for (const f of files) {
				if (f.name && f.name.endsWith(".json")) names.push(f.name);
			}
		} catch (e) {}
		if (!names.length) {
			this.log("§c预设目录无json文件: " + dir);
			return;
		}
		const self = this;
		try {
			gui.addForm(JSON.stringify({
				type: "custom_form",
				title: "选择预设文件",
				content: [{ type: "dropdown", text: "文件(相对坐标json)", options: names }]
			}), function (idx) {
				self.loadPreset(dir, names[idx]);
			}, function () {});
		} catch (e) {
			this.log("§c表单打开失败: " + e);
		}
	},
	loadPreset(dir, name) {
		try {
			const data = JSON.parse(String(fs.read(dir + "/" + name) || ""));
			if (!Array.isArray(data) || !data.length) {
				this.log("§c预设为空或不是坐标数组");
				return;
			}
			const pts = [];
			for (const p of data) {
				if (p && typeof p.x !== "undefined") pts.push([Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0]);
				if (pts.length >= 512) break;
			}
			if (!pts.length) {
				this.log("§c预设无有效坐标");
				return;
			}
			this.presetPts = pts;
			this.log("§a已加载 " + name + "（" + pts.length + "点）");
		} catch (e) {
			this.log("§c预设读取失败: " + e);
		}
	},
	initFont() {
		if (this.fontMap) return;
		const m = {};
		for (let i = 0; i < this.FONT_CHARS.length; i++) {
			const b = [];
			for (let c = 0; c < 5; c++) b.push(parseInt(this.FONT_HEX.substr(i * 10 + c * 2, 2), 16));
			m[this.FONT_CHARS.charCodeAt(i)] = b;
		}
		this.fontMap = m;
	},
	loadCjkFont() {
		try {
			const raw = String(fs.read(this.presetDir() + "/font16.hex") || "");
			const m = {};
			const lines = raw.split("\n");
			for (const ln of lines) {
				if (ln.length < 69) continue;
				const cp = parseInt(ln.substr(0, 4), 16);
				if (isNaN(cp)) continue;
				const rows = [];
				for (let r = 0; r < 16; r++) rows.push(parseInt(ln.substr(5 + r * 4, 4), 16));
				m[cp] = rows;
			}
			if (!Object.keys(m).length) throw new Error("empty");
			this.cjkFont = m;
		} catch (e) {
			this.cjkFont = null;
			if (!this.cjkWarned) {
				this.cjkWarned = true;
				this.log("§c缺中文字体文件：把 font16.hex 放到 " + this.presetDir() + "/ 目录下");
			}
		}
	},
	centerY(pts) {
		if (!pts.length) return;
		let mn = Infinity, mx = -Infinity;
		for (const p of pts) {
			if (p[1] < mn) mn = p[1];
			if (p[1] > mx) mx = p[1];
		}
		const shift = -Math.floor((mn + mx) / 2);
		for (const p of pts) p[1] += shift;
	},
	buildCjkPts(raw) {
		if (!this.cjkFont) this.loadCjkFont();
		if (!this.cjkFont) return [];
		const pts = [];
		const s = raw.slice(0, 10);
		const scale = this.scale;
		const vert = this.writing === "col";
		const adv = 17;
		const x0 = -Math.floor((s.length * adv - 1) * scale / 2);
		const PH = [0xffff].concat(Array(14).fill(0x8001), [0xffff]);
		for (let i = 0; i < s.length; i++) {
			const rows = this.cjkFont[s.charCodeAt(i)] || PH;
			for (let r = 0; r < 16; r++) {
				const v = rows[r];
				if (!v) continue;
				for (let c = 0; c < 16; c++) {
					if (!((v >> (15 - c)) & 1)) continue;
					for (let sx = 0; sx < scale; sx++) {
						for (let sy = 0; sy < scale; sy++) {
							if (vert) pts.push([(c - 8) * scale + sx, (15 - r) * scale + sy - i * adv * scale]);
							else pts.push([x0 + (i * adv + c) * scale + sx, (15 - r) * scale + sy]);
						}
					}
				}
			}
		}
		if (vert) this.centerY(pts);
		return pts;
	},
	buildTextPts() {
		const raw = String(this.text || "");
		if (!raw) return [];
		for (let i = 0; i < raw.length; i++) {
			const c = raw.charCodeAt(i);
			if (c < 0x20 || c > 0x7e) return this.buildCjkPts(raw);
		}
		this.initFont();
		const pts = [];
		const s = raw.toUpperCase().slice(0, 16);
		const scale = this.scale;
		const vert = this.writing === "col";
		const x0 = -Math.floor((s.length * 6 - 1) * scale / 2);
		for (let i = 0; i < s.length; i++) {
			const g = this.fontMap[s.charCodeAt(i)] || [0x7f, 0x41, 0x41, 0x41, 0x7f];
			for (let c = 0; c < 5; c++) {
				for (let r = 0; r < 7; r++) {
					if (!((g[c] >> r) & 1)) continue;
					for (let sx = 0; sx < scale; sx++) {
						for (let sy = 0; sy < scale; sy++) {
							if (vert) pts.push([(c - 2) * scale + sx, (6 - r) * scale + sy - i * 8 * scale]);
							else pts.push([x0 + (i * 6 + c) * scale + sx, (6 - r) * scale + sy]);
						}
					}
				}
			}
		}
		if (vert) this.centerY(pts);
		return pts;
	},
	finalizeTextPts(pts2d) {
		const out = [];
		const fx = this.flipX, fy = this.flipY, flat = this.orient === "h";
		for (const p of pts2d) {
			const u = fx ? -p[0] : p[0];
			const w = fy ? -p[1] : p[1];
			out.push(flat ? [u, 0, w] : [u, w, 0]);
		}
		return out;
	},
	shapePoints() {
		if (this.shape === "preset") return this.presetPts;
		if (this.shape === "text") {
			const key = [this.text, this.scale, this.writing, this.orient, this.flipX, this.flipY].join("|");
			if (key !== this.textKey) {
				this.textPts = this.finalizeTextPts(this.buildTextPts());
				this.textKey = key;
			}
			return this.textPts;
		}
		const key = this.rx + "|" + this.ry + "|" + this.rz + "|" + (this.skipSelf ? 1 : 0);
		if (key !== this.boxKey) {
			const pts = [];
			for (let dx = -this.rx; dx <= this.rx; dx++) {
				for (let dy = 0; dy <= this.ry; dy++) {
					for (let dz = -this.rz; dz <= this.rz; dz++) {
						if (this.skipSelf && dx === 0 && dz === 0 && dy <= 1) continue;
						pts.push([dx, dy, dz]);
					}
				}
			}
			this.boxPts = pts;
			this.boxKey = key;
		}
		return this.boxPts;
	},
	onTick() {
		if (!this.enabled) return;
		this.acc++;
		if (this.acc < this.interval) return;
		this.acc = 0;
		let lp, uid, lvl;
		try {
			lp = player.getLocalPlayer();
			uid = lp ? String(lp.getUniqueID()) : "";
			lvl = world.getClientWorld();
		} catch (e) { return; }
		if (!lp || !uid || !lvl) return;
		const positions = [];
		if (this.target === "self") {
			let p = null;
			try { p = lp.getPos(); } catch (e) {}
			if (p) positions.push(p);
		} else {
			const ids = [];
			if (this.target === "all") {
				try {
					const list = lvl.getPlayerList();
					for (const k in list) {
						const p = list[k];
						if (p && p.id) ids.push(String(p.id));
					}
				} catch (e) {}
			} else {
				for (const id in this.pickIds) ids.push(id);
			}
			for (const id of ids) {
				if (this.target === "all" && this.excludeMe && id === uid) continue;
				try {
					const ent = lvl.getEntity(id);
					const p = ent ? ent.getPos() : null;
					if (p) positions.push(p);
				} catch (e) {}
			}
		}
		if (!positions.length) return;
		let pts = this.shapePoints();
		if (!pts || !pts.length) return;
		const isText = this.shape === "text";
		const cap = Math.max(30, Math.min(isText ? 900 : this.MAXPTS, Math.floor((isText ? 1800 : 900) / positions.length)));
		if (pts.length > cap) {
			const stride = pts.length / cap;
			const sub = [];
			for (let i = 0; i < cap; i++) sub.push(pts[Math.floor(i * stride)]);
			pts = sub;
		}
		const mul = this.shape === "text" ? 1 : this.scale;
		const flipNt = this.shape !== "text" && (this.flipX || this.flipY);
		const rot = this.angle % 360 !== 0;
		const rad = this.angle * Math.PI / 180;
		const cos = Math.cos(rad), sin = Math.sin(rad);
		for (const tp of positions) {
			const bx = Math.floor(tp.x), by = Math.floor(tp.y), bz = Math.floor(tp.z);
			for (const pt of pts) {
				let ox = pt[0] * mul, oy = pt[1] * mul;
				const oz = pt[2] * mul;
				if (flipNt) {
					if (this.flipX) ox = -ox;
					if (this.flipY) oy = -oy;
				}
				let fx = ox, fz = oz;
				if (rot) {
					fx = ox * cos - oz * sin;
					fz = ox * sin + oz * cos;
				}
				try {
					this.sendOne(uid, bx + fx + this.xOff, by + oy + this.yOff, bz + fz + this.zOff);
					this.failCount = 0;
				} catch (e) {
					this.failCount++;
					if (this.failCount >= 3) {
						this.enabled = false;
						this.log("§c连续发包失败，已自动关闭: " + (e && e.message ? e.message : e));
						return;
					}
				}
			}
		}
		this.angle = (this.angle + this.spin) % 360;
	},
	log: mkLog("§b[虚影屏障] ")
};

try { ghostBarrier.initPresetDir(); } catch (e) {}

const miniMap = {
	tag: "fun_minimap",
	enabled: false,
	showBiome: true,
	zoom: 90,
	buildPyOn() {
		return `# -*- coding: utf-8 -*-
import mod.client.extraClientApi as clientApi

ARROW = 'textures/ui/pet/parterner/minimap_arrow'
PET_NS = 'neteasePetMod'
PET_KEY = 'minimpUI'
SHOW_BIOME = ${this.showBiome ? "True" : "False"}
ZOOM_LEVEL = ${(this.zoom / 100).toFixed(2)}

def _anchor():
    import client.ui.uiManager as uiManager
    return uiManager.instance()

def _dead():
    try:
        return getattr(_anchor(), '_kusug_mmap_dead', False)
    except Exception:
        return False

def _cfg(key, default):
    try:
        c = getattr(_anchor(), '_kusug_mmap_cfg', None)
        if c and key in c:
            return c[key]
    except Exception:
        pass
    return default

def _chat(msg):
    try:
        import clientlevel
        m = msg
        if isinstance(m, unicode):
            m = m.encode('utf-8')
        clientlevel.display_message(1, m, '', '')
    except Exception:
        pass

_CS = clientApi.GetClientSystemCls()

def _find_pet_node():
    try:
        node = clientApi.GetUI(PET_NS, PET_KEY)
        if node is not None:
            return node
    except Exception:
        pass
    try:
        for n in _anchor()._ui_stack:
            try:
                if n.get_def_key() == '%s:%s' % (PET_NS, PET_KEY) and not n.is_remove():
                    return n
            except Exception:
                pass
    except Exception:
        pass
    return None

def _flip_open(val):
    try:
        petSys = clientApi.GetSystem('Minecraft', 'pet')
        if petSys is None:
            return None
        mgr = getattr(petSys, 'mConvinientFuncMgrClient', None)
        if mgr is None:
            return None
        getter = getattr(mgr, 'GetMiniMapControl', None)
        if getter is None:
            return None
        mmf = getter()
        if mmf is not None:
            mmf.mMiniMapOpenState = val
        return mmf
    except Exception:
        return None

def _configure(node):
    playerId = clientApi.GetLocalPlayerId()
    try:
        comp = clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId())
        dim = comp.GetCurrentDimension()
        hy = 256
        if dim == 1:
            pc = clientApi.GetEngineCompFactory().CreatePos(playerId)
            fp = pc.GetFootPos()
            if fp:
                hy = int(fp[1]) + 1
        node.SetHighestY(hy)
    except Exception:
        pass
    try:
        import gui
        gui.minimap_show_face_icon(node.screen_name, node.component_path + node.GetMapPath(), 0)
    except Exception:
        pass
    try:
        deco = getattr(node, 'mDecorationArray', {}) or {}
        if playerId not in deco:
            node.AddEntityMarker(playerId, ARROW, (7, 7), True)
    except Exception:
        pass
    try:
        node.SetTouchEnable('/mainPanel/netease_mini_map', False)
    except Exception:
        pass
    try:
        import gui as _g
        _g.minimap_zoom(node.screen_name, node.component_path + node.GetMapPath(), float(_cfg('zoom', ZOOM_LEVEL)), 1)
    except Exception:
        try:
            node.ZoomOut(0.1)
        except Exception:
            pass
    try:
        node.SetVisible('/info_panel/biome_panel', bool(_cfg('biome', SHOW_BIOME)))
    except Exception:
        pass
    node.SetMiniMapVisible(True)
    try:
        node.SetVisible('/mainPanel/netease_mini_map', True)
    except Exception:
        pass

class _KuSugMiniMap(_CS):
    def __init__(self, ns, sn):
        super(_KuSugMiniMap, self).__init__(ns, sn)
        self.node = None
        self.tries = 0
        self.active = True
        try:
            _anchor()._kusug_mmap_dead = False
            _anchor()._kusug_mmap_inst = self
            _anchor()._kusug_mmap_cfg = {'biome': SHOW_BIOME, 'zoom': ZOOM_LEVEL}
        except Exception:
            pass
        self.game_timer(0.5, self.create_step)

    def game_timer(self, delay, fn):
        try:
            game = clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId())
            game.AddTimer(delay, fn)
            return True
        except Exception:
            return False

    def create_step(self):
        if self.node is not None or not self.active or _dead():
            return
        self.tries += 1
        try:
            playerId = clientApi.GetLocalPlayerId()
        except Exception:
            playerId = None
        if not playerId or playerId == '-1':
            if self.tries < 10:
                self.game_timer(1.0, self.create_step)
            else:
                _chat(u'§c[小地图] 拿不到本地玩家，请进局后再开')
            return
        pet = _find_pet_node()
        if pet is not None:
            self.node = pet
            _flip_open(True)
            _configure(pet)
            _chat(u'§a[小地图] 已接管官方屏')
            return
        if self.tries < 10:
            self.game_timer(1.0, self.create_step)
        else:
            _chat(u'§c[小地图] 找不到官方小地图屏')
        return

    def apply_cfg(self, key, val):
        if self.node is None:
            return
        try:
            if key == 'biome':
                self.node.SetVisible('/info_panel/biome_panel', bool(val))
            elif key == 'zoom':
                import gui
                gui.minimap_zoom(self.node.screen_name, self.node.component_path + self.node.GetMapPath(), float(val), 1)
        except Exception:
            pass

    def shutdown(self):
        self.active = False
        if self.node is not None:
            try:
                self.node.SetMiniMapVisible(False)
            except Exception:
                pass
            try:
                self.node.SetVisible('/mainPanel/netease_mini_map', False)
            except Exception:
                pass
            _flip_open(False)
            self.node = None
        try:
            self.UnListenAllEvents()
        except Exception:
            pass
        try:
            if getattr(_anchor(), '_kusug_mmap_inst', None) is self:
                _anchor()._kusug_mmap_inst = None
        except Exception:
            pass

_old = None
try:
    _old = getattr(_anchor(), '_kusug_mmap_inst', None)
except Exception:
    pass
if _old is None:
    _old = globals().get('_kusug_mmap')
if _old is not None:
    def _kill_old(o=_old):
        try:
            o.shutdown()
        except Exception:
            pass
    try:
        _g0 = clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId())
        _g0.AddTimer(0.01, _kill_old)
    except Exception:
        _kill_old()
_inst = _KuSugMiniMap('KuSugMiniMap', 'KuSugMiniMap')
globals()['_kusug_mmap'] = _inst`;
	},
	pyOff: `# -*- coding: utf-8 -*-
import mod.client.extraClientApi as clientApi

def _anchor():
    import client.ui.uiManager as uiManager
    return uiManager.instance()

try:
    _anchor()._kusug_mmap_dead = True
except Exception:
    pass

def _do_off():
    _inst = None
    try:
        _inst = getattr(_anchor(), '_kusug_mmap_inst', None)
    except Exception:
        pass
    if _inst is None:
        _inst = globals().get('_kusug_mmap')
    if _inst is not None:
        try:
            _inst.shutdown()
        except Exception:
            pass
    _old2 = globals().get('_mmap_inst')
    if _old2 is not None and _old2 is not _inst:
        try:
            _old2.shutdown()
        except Exception:
            pass
        globals()['_mmap_inst'] = None
    try:
        _n = clientApi.GetUI('neteasePetMod', 'minimpUI')
        if _n is not None:
            _n.SetMiniMapVisible(False)
            try:
                _n.SetVisible('/mainPanel/netease_mini_map', False)
            except Exception:
                pass
    except Exception:
        pass
    try:
        _ps = clientApi.GetSystem('Minecraft', 'pet')
        _mgr = getattr(_ps, 'mConvinientFuncMgrClient', None)
        if _mgr is not None:
            _mmf = _mgr.GetMiniMapControl()
            if _mmf is not None:
                _mmf.mMiniMapOpenState = False
    except Exception:
        pass
    try:
        _anchor()._kusug_mmap_inst = None
    except Exception:
        pass
    globals()['_kusug_mmap'] = None

try:
    _game = clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId())
    _game.AddTimer(0.01, _do_off)
except Exception:
    _do_off()`,
	onModuleEvent(args) {
		if (typeof args.minimap_show_biome !== "undefined") {
			this.showBiome = Boolean(args.minimap_show_biome);
			if (this.enabled) this.apply("biome", this.showBiome ? "True" : "False");
		}
		if (typeof args.minimap_zoom !== "undefined") {
			const z = clampPos(args.minimap_zoom, 50, 300);
			if (z) this.zoom = z;
			if (this.enabled) this.apply("zoom", (this.zoom / 100).toFixed(2));
		}
		if (!stdToggle(this, args, "小地图", false)) return;
		try { app.evalPython(this.enabled ? this.buildPyOn() : this.pyOff); } catch (e) {}
	},
	apply(key, pyVal) {
		const code = [
			"import mod.client.extraClientApi as clientApi",
			"def _anchor():",
			"    import client.ui.uiManager as uiManager",
			"    return uiManager.instance()",
			"try:",
			"    _c = getattr(_anchor(), '_kusug_mmap_cfg', None)",
			"    if _c is None:",
			"        _c = {}",
			"        _anchor()._kusug_mmap_cfg = _c",
			"    _c['" + key + "'] = " + pyVal,
			"except Exception:",
			"    pass",
			"def _do():",
			"    _i = getattr(_anchor(), '_kusug_mmap_inst', None)",
			"    if _i is not None:",
			"        try:",
			"            _i.apply_cfg('" + key + "', " + pyVal + ")",
			"        except Exception:",
			"            pass",
			"try:",
			"    _g = clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId())",
			"    _g.AddTimer(0.01, _do)",
			"except Exception:",
			"    _do()"
		].join("\n");
		try { app.evalPython(code); } catch (e) {}
	}
};

const batchCmd = {
	tag: "fun_batch_cmd",
	enabled: false,
	loop: false,
	sync: false,
	interval: 1,
	source: "file",
	execMode: "cmd",
	inputText: "",
	commands: [],
	index: 0,
	tickCount: 0,
	cmdFile: resDirPath + "/KuSug/CMD.txt",
	parseLines(raw) {
		const cmds = [];
		for (const line of String(raw || "").split(/\r?\n/)) {
			const t = line.trim();
			if (!t || t.charAt(0) === "#") continue;
			cmds.push(t.charAt(0) === "/" ? t : "/" + t);
		}
		return cmds;
	},
	loadFile() {
		let missing = false;
		try { missing = !fs.exists(this.cmdFile); } catch (e) {}
		if (missing) {
			try { fs.write(this.cmdFile, "/say 你好\n/say 这是批量命令示例\n# 井号开头是注释，会被跳过\n"); } catch (e) {}
			app.showToast("已创建 KuSug/CMD.txt 示例，请编辑后使用");
			return null;
		}
		let raw = "";
		try { raw = String(fs.read(this.cmdFile) || ""); } catch (e) {}
		const cmds = this.parseLines(raw);
		if (!cmds.length) {
			app.showToast("CMD.txt 为空");
			return null;
		}
		return cmds;
	},
	loadInput() {
		const cmds = this.parseLines(this.inputText);
		if (!cmds.length) {
			app.showToast("请在输入框填写命令，每行一条，#开头为注释");
			return null;
		}
		return cmds;
	},
	exec(cmd) {
		if (this.execMode === "rpc") {
			this.rpcExec(cmd);
			return;
		}
		try { packet.sendCommandRequestPacket({ command: cmd, version: 88 }); } catch (e) {}
	},
	rpcExec(cmd) {
		let selfId = "";
		try { selfId = String(player.getLocalPlayer().getUniqueID()); } catch (e) {}
		if (!selfId) return;
		try {
			packet.sendPyRpcPacket(98247598, hex2buf("93c40172920cc42d4d696e6563726166743a6169436f6d6d616e643a4578656375746555736566756c436f6d6d616e644576656e74c0"));
			packet.sendPyRpcPacket(98247598, hex2buf("93c40163920c82c408706c617965724964" + this.binSeg(selfId) + "c407636f6d6d616e64" + this.binSeg(cmd) + "c0"));
		} catch (e) {}
	},
	binSeg(str) {
		const hex = this.utf8hex(str);
		const n = hex.length / 2;
		if (n <= 255) return "c4" + n.toString(16).padStart(2, "0") + hex;
		return "c5" + n.toString(16).padStart(4, "0") + hex;
	},
	utf8hex(str) {
		const bytes = encodeUtf8(str);
		let hex = "";
		for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
		return hex;
	},
	onModuleEvent(args) {
		if (typeof args.batch_cmd_loop !== "undefined") this.loop = Boolean(args.batch_cmd_loop);
		if (typeof args.batch_cmd_sync !== "undefined") this.sync = Boolean(args.batch_cmd_sync);
		const bci = clampPos(args.batch_cmd_interval, 1, 60);
		if (bci) this.interval = bci;
		if (typeof args.batch_cmd_text === "string") this.inputText = args.batch_cmd_text;
		radio2(args, "batch_cmd_source", "batch_cmd_src_file", "batch_cmd_src_input", this, "source", "file", "input");
		radio2(args, "batch_cmd_exec", "batch_cmd_exec_cmd", "batch_cmd_exec_rpc", this, "execMode", "cmd", "rpc");
		if (args.fun !== this.tag || !("value" in args)) return;
		const v = Boolean(args.value);
		if (v === this.enabled) return;
		if (v) {
			const cmds = this.source === "input" ? this.loadInput() : this.loadFile();
			if (!cmds) return;
			this.commands = cmds;
			this.index = 0;
			this.tickCount = 0;
			this.enabled = true;
		} else {
			this.enabled = false;
		}
		ensureHud(this, this.tag, "批量命令");
		this.hud.enabled = this.enabled;
		notifyToggle("批量命令", this.enabled, this.enabled ?
			(this.source === "input" ? "输入框" : "CMD.txt") + " 共 " + this.commands.length + " 条 · " + (this.execMode === "rpc" ? "PyRPC通道" : "原版命令") + " · " + (this.sync ? "同步" : "顺序") + " 间隔 " + this.interval + "tick" + (this.loop ? " · 循环" : "") : "");
	},
	onTick() {
		if (!this.enabled || !this.commands.length || !tickEvery(this, this.interval)) return;
		if (this.sync) {
			for (const cmd of this.commands) this.exec(cmd);
			if (!this.loop) this.stop();
			return;
		}
		this.exec(this.commands[this.index]);
		this.index++;
		if (this.index >= this.commands.length) {
			if (this.loop) {
				this.index = 0;
			} else {
				this.stop();
			}
		}
	},
	stop() {
		this.enabled = false;
		if (this.hud) this.hud.enabled = false;
	}
};

const bypassServer = {
	tag: "fun_bypass_server",
	serverName: "",
	password: "",
	addr: "",
	log: mkLog("§b§l[KuSug·服务器直连]§r§f "),
	buildPy(ip, port) {
		const j = function (v) { return JSON.stringify(JSON.stringify(v)); };
		return `# -*- coding: utf-8 -*-
import json
from gui_2d import GUI
from gui_2d.ui_service.ui_request import request
import mc_game_ctrl
import realms_main
from gui_2d.consts import InGameType
from gui_2d.utils import util
from gui_2d.utils.PrePlayWorld import pre_play_world

SERVER_NAME = json.loads(${j(this.serverName)})
PASSWORD = json.loads(${j(this.password)})
CUSTOM_IP = json.loads(${j(ip)})
CUSTOM_PORT = ${port}

def _toast(msg):
    try:
        GUI.ui_mgr.show_toast(msg)
    except Exception:
        pass

class _KuSugServerJoin(object):
    def __init__(self):
        self.server_id = ""
        self.server_name = SERVER_NAME
        self.server_entity = None
        self.final_ip = CUSTOM_IP
        self.final_port = CUSTOM_PORT
        self.game_info = None

    def start(self):
        try:
            request({
                'url': '/rental-server/query/search-by-name',
                'hostName': 'WebServerUrl',
                'method': 'POST',
                'params': {'server_name': SERVER_NAME, 'offset': 0}
            }, self.on_search)
        except Exception:
            _toast(u'服务器直连: 请求发送失败')

    def on_search(self, response):
        try:
            entity = getattr(response, 'entity', None)
            if entity and len(entity) > 0:
                self.server_entity = entity[0]
                self.server_id = self.server_entity.get('entity_id')
                self.server_name = self.server_entity.get('server_name', SERVER_NAME)
                request({
                    'url': '/rental-server-world-enter/get',
                    'hostName': 'WebServerUrl',
                    'method': 'POST',
                    'params': {'server_id': self.server_id, 'pwd': PASSWORD}
                }, self.on_enter)
            else:
                _toast(u'服务器直连: 未找到服务器')
        except Exception:
            _toast(u'服务器直连: 查询异常')

    def on_enter(self, response):
        try:
            if getattr(response, 'code', -1) == 0 and getattr(response, 'entity', None):
                res_ip = response.entity.get('mcserver_host', '')
                res_port = response.entity.get('mcserver_port', 0)
                if res_ip:
                    self.final_ip = res_ip
                    self.final_port = res_port
            self.game_info = {
                'gameType': InGameType.RentalGame,
                'id': self.server_id,
                'room_name': self.server_name,
                'min_level': self.server_entity.get('min_level', 0),
                'ownerId': self.server_entity.get('owner_id', ''),
                'ownerName': self.server_entity.get('ownerName', ''),
                'res_name': self.server_name
            }
            pre_play_world({
                'warningFor4G': True,
                'gameType': InGameType.RentalGame,
                'item_id': self.server_id,
                'room_name': self.server_name
            }, self.on_pre_check)
        except Exception:
            _toast(u'服务器直连: 进入失败')

    def on_pre_check(self, is_success, msg=''):
        if not is_success:
            _toast(msg or u'服务器直连: 进入游戏失败')
            return
        try:
            mgr = getattr(GUI.game_data_mgr, 'lobby_game_mgr', None)
            if mgr is not None:
                mgr.leave_main_city(callback=self.enter_game)
            else:
                self.enter_game()
        except Exception:
            self.enter_game()

    def enter_game(self):
        try:
            mc_game_ctrl.instance.setCurGameInfo(self.game_info)
            util.add_play_game_record(self.game_info)
            GUI.game_mgr.game_type = InGameType.RentalGame
            realms_main.join_rental_game(
                {'BGP': self.final_ip, 'ISP': self.final_ip},
                {'BGP': self.final_port, 'ISP': self.final_port},
                self.server_id,
                self.server_name
            )
        except Exception:
            _toast(u'服务器直连: 连接失败')

_KuSugServerJoin().start()
`;
	},
	onModuleEvent(args) {
		if (typeof args.bypass_server_name === "string") this.serverName = args.bypass_server_name.trim();
		if (typeof args.bypass_server_pwd === "string") this.password = args.bypass_server_pwd.trim();
		if (typeof args.bypass_server_addr === "string") this.addr = args.bypass_server_addr.trim();
		if (args.fun !== this.tag || !("value" in args)) return;
		if (!Boolean(args.value)) return;
		if (!this.serverName) {
			app.showToast("请先填写服务器号");
			return;
		}
		const m = /^([^\s:]+):(\d{1,5})$/.exec(this.addr);
		if (!m) {
			app.showToast("请正确填写IP和端口，例如 127.0.0.1:19132");
			return;
		}
		const ip = m[1];
		const port = parseInt(m[2], 10);
		if (!(port > 0 && port <= 65535)) {
			app.showToast("端口范围 1-65535");
			return;
		}
		try {
			app.evalPython(this.buildPy(ip, port));
			this.log("§a已执行 §7" + this.serverName + " → " + ip + ":" + port);
		} catch (e) {
			this.log("§c执行失败: " + e);
		}
	}
};

const gyroView = {
	tag: "fun_gyro_view",
	enabled: false,
	sens: 1.0,
	log: mkLog("§b§l[KuSug·陀螺仪]§r§f "),
	pyOn: `import mod.client.extraClientApi as clientApi

_CS = clientApi.GetClientSystemCls()

class _KuSugGyro(_CS):
    def __init__(self, ns, sn):
        super(_KuSugGyro, self).__init__(ns, sn)
        self.rotComp = None
        self.lastTs = None
        self.sensorOn = False
        self.dead = False
        self.retries = 0
        self.pendYaw = 0.0
        self.pendPitch = 0.0
        ns2 = clientApi.GetEngineNamespace()
        sn2 = clientApi.GetEngineSystemName()
        self.ListenForEvent(ns2, sn2, "GyroSensorChangedClientEvent", self, self.on_gyro)
        self.ListenForEvent(ns2, sn2, "GameRenderTickEvent", self, self.on_render_tick)
        self.try_enable_sensor()
        self.try_get_comp()

    def try_enable_sensor(self):
        if self.dead or self.sensorOn:
            return
        try:
            import sensor
            if sensor.toggleGyroSensor(True):
                sensor.setGyroSensorReportRate(60)
                self.sensorOn = True
                self.try_get_comp()
                return
        except Exception:
            pass
        self.schedule_retry()

    def schedule_retry(self):
        if self.dead or self.retries >= 40:
            return
        self.retries += 1
        try:
            game = clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId())
            game.AddTimer(0.5, self.retry_sensor)
        except Exception:
            pass

    def retry_sensor(self):
        if self.dead or self.sensorOn:
            return
        self.try_enable_sensor()

    def try_get_comp(self):
        if self.rotComp is not None:
            return True
        try:
            pid = clientApi.GetLocalPlayerId()
            if pid and pid != '-1':
                self.rotComp = clientApi.GetEngineCompFactory().CreateRot(pid)
        except Exception:
            pass
        return self.rotComp is not None

    def shutdown(self):
        self.dead = True
        try:
            self.UnListenAllEvents()
        except Exception:
            pass
        try:
            import sensor
            sensor.toggleGyroSensor(False)
        except Exception:
            pass

    def on_gyro(self, args):
        ts = args.get("timestamp")
        if ts is None:
            return
        if self.lastTs is None:
            self.lastTs = ts
            return
        dt = ts - self.lastTs
        self.lastTs = ts
        if dt <= 0.0 or dt > 0.5:
            return
        k = 57.29577951308232 * dt * globals().get("_kusug_gyro_sens", 1.0)
        xd = args.get("xDiff") or 0.0
        yd = args.get("yDiff") or 0.0
        o = args.get("orientation", 1)
        if o == 1:
            dyaw = -xd
            dpitch = yd
        elif o == 3:
            dyaw = xd
            dpitch = -yd
        elif o == 2:
            dyaw = yd
            dpitch = xd
        else:
            dyaw = -yd
            dpitch = -xd
        self.pendYaw += dyaw * k
        self.pendPitch += dpitch * k
        if self.pendYaw > 45.0:
            self.pendYaw = 45.0
        elif self.pendYaw < -45.0:
            self.pendYaw = -45.0
        if self.pendPitch > 45.0:
            self.pendPitch = 45.0
        elif self.pendPitch < -45.0:
            self.pendPitch = -45.0

    def on_render_tick(self, args):
        mag = abs(self.pendYaw) + abs(self.pendPitch)
        if mag < 1e-9:
            return
        if self.rotComp is None:
            if not self.try_get_comp():
                self.pendYaw = 0.0
                self.pendPitch = 0.0
                return
        if mag < 0.05:
            dyaw = self.pendYaw
            dpitch = self.pendPitch
        else:
            a = 0.7 + 0.3 * min(1.0, mag / 30.0)
            dyaw = self.pendYaw * a
            dpitch = self.pendPitch * a
        try:
            rot = self.rotComp.GetRot()
            if not rot:
                return
            pitch = rot[0] + dpitch
            yaw = (rot[1] + dyaw) % 360.0
            if pitch > 89.0:
                pitch = 89.0
            elif pitch < -89.0:
                pitch = -89.0
            self.rotComp.SetRot((pitch, yaw))
            self.pendYaw -= dyaw
            self.pendPitch -= dpitch
        except Exception:
            pass

_old = globals().get("_kusug_gyro")
if _old is not None:
    try:
        _old.shutdown()
    except Exception:
        pass
globals()["_kusug_gyro"] = _KuSugGyro("KuSugGyro", "KuSugGyroSystem")`,
	pyOff: `_old = globals().get("_kusug_gyro")
if _old is not None:
    try:
        _old.shutdown()
    except Exception:
        pass
globals()["_kusug_gyro"] = None`,
	onModuleEvent(args) {
		if (args.gyro_sens !== undefined) {
			const p = Number(args.gyro_sens);
			if (!isNaN(p) && p > 0) {
				this.sens = Math.max(0.1, Math.min(10, p / 100));
				if (this.enabled) this.setSensFlag();
			}
		}
		if (!stdToggle(this, args, "陀螺仪视角", false, "灵敏度 " + this.sens)) return;
		try {
			app.evalPython(this.enabled ? this.pyOn : this.pyOff);
		} catch (e) {
			this.log("§c调用异常: " + e);
		}
		if (this.enabled) this.setSensFlag();
	},
	setSensFlag() {
		try { app.evalPython("globals()[\"_kusug_gyro_sens\"] = " + this.sens); } catch (e) {}
	}
};

const bigGyro = {
	tag: "fun_big_gyro",
	enabled: false,
	running: false,
	speed: 720,
	head: true,
	headSpeed: 360,
	headPhase: 0,
	yaw: 0,
	lastMs: 0,
	pyUp: false,
	pyOn: `import mod.client.extraClientApi as clientApi
import time

try:
    import _camera
    _HAS_CAM = True
except Exception:
    _HAS_CAM = False

_CS = clientApi.GetClientSystemCls()

class _KuSugSpin(_CS):
    def __init__(self, ns, sn):
        super(_KuSugSpin, self).__init__(ns, sn)
        self.rotComp = None
        self.last = None
        self.yaw = 0.0
        self.phase = 0.0
        ns2 = clientApi.GetEngineNamespace()
        sn2 = clientApi.GetEngineSystemName()
        self.ListenForEvent(ns2, sn2, 'GameRenderTickEvent', self, self.on_frame)

    def on_frame(self, args):
        if not globals().get('_kusug_spin_on'):
            self.last = None
            return
        if globals().get('_kusug_spin_reset'):
            globals()['_kusug_spin_reset'] = False
            self.yaw = 0.0
            self.phase = 0.0
            self.last = None
        if _HAS_CAM:
            try:
                _camera.DepartCamera()
            except Exception:
                pass
        now = time.time()
        if self.last is None:
            self.last = now
            return
        dt = now - self.last
        self.last = now
        if dt <= 0 or dt > 0.25:
            dt = 0.033
        self.yaw = (self.yaw + globals().get('_kusug_spin_speed', 720) * dt) % 360.0
        if globals().get('_kusug_spin_head', True):
            self.phase = (self.phase + globals().get('_kusug_spin_head_speed', 360) * dt) % 360.0
            pitch = self.phase
        else:
            pitch = 180.0
        comp = self.rotComp
        if comp is None:
            try:
                pid = clientApi.GetLocalPlayerId()
                if pid and pid != '-1':
                    comp = self.rotComp = clientApi.GetEngineCompFactory().CreateRot(pid)
            except Exception:
                return
            if comp is None:
                return
        try:
            comp.SetRot((pitch, self.yaw))
        except Exception:
            pass

_old = globals().get('_kusug_spin_sys')
if _old is not None:
    try:
        _old.UnListenAllEvents()
    except Exception:
        pass
globals()['_kusug_spin_sys'] = _KuSugSpin('KuSugSpin', 'KuSugSpinSystem')`,
	onModuleEvent(args) {
		let dirty = false;
		if (args.big_gyro_speed !== undefined) {
			const p = Number(args.big_gyro_speed);
			if (!isNaN(p) && p > 0) {
				this.speed = Math.max(60, Math.min(3000, Math.floor(p)));
				dirty = true;
			}
		}
		if (typeof args.big_gyro_head !== "undefined") {
			this.head = Boolean(args.big_gyro_head);
			dirty = true;
		}
		if (args.big_gyro_head_speed !== undefined) {
			const p = Number(args.big_gyro_head_speed);
			if (!isNaN(p) && p > 0) {
				this.headSpeed = Math.max(30, Math.min(1800, Math.floor(p)));
				dirty = true;
			}
		}
		if (!stdToggle(this, args, "大陀螺", false)) {
			if (dirty) this.pushPy();
			return;
		}
		if (this.enabled) {
			this.tryStart();
		} else {
			this.stopLoop(true);
		}
	},
	pushPy() {
		const on = this.running && this.enabled ? "True" : "False";
		try { app.evalPython("globals()['_kusug_spin_on'] = " + on); } catch (e) {}
		try { app.evalPython("globals()['_kusug_spin_speed'] = " + this.speed); } catch (e) {}
		try { app.evalPython("globals()['_kusug_spin_head'] = " + (this.head ? "True" : "False")); } catch (e) {}
		try { app.evalPython("globals()['_kusug_spin_head_speed'] = " + this.headSpeed); } catch (e) {}
	},
	tryStart() {
		if (this.running) return;
		let lp;
		try { lp = player.getLocalPlayer(); } catch (e) { return; }
		if (!lp) return;
		try { camera.departCamera(); } catch (e) {}
		this.running = true;
		this.yaw = 0;
		this.headPhase = 0;
		this.lastMs = Date.now();
		if (!this.pyUp) {
			try {
				app.evalPython(this.pyOn);
				this.pyUp = true;
			} catch (e) {
				this.pyUp = false;
			}
		}
		if (this.pyUp) {
			try { app.evalPython("globals()['_kusug_spin_reset'] = True"); } catch (e) {}
		}
		this.pushPy();
	},
	onTick() {
		if (this.enabled && !this.running) this.tryStart();
		if (!this.running) return;
		const now = Date.now();
		let dt = (now - this.lastMs) / 1000;
		this.lastMs = now;
		if (dt <= 0 || dt > 0.25) dt = 0.033;
		this.yaw = (this.yaw + this.speed * dt) % 360;
		let pitch = 180;
		if (this.head) {
			this.headPhase = (this.headPhase + this.headSpeed * dt) % 360;
			pitch = this.headPhase;
		}
		let lp;
		try { lp = player.getLocalPlayer(); } catch (e) { lp = null; }
		if (!lp) return;

		try { camera.departCamera(); } catch (e) {}
		if (this.pyUp) return;
		try { if (typeof lp.setRotation === "function") lp.setRotation({ yaw: this.yaw, pitch: pitch }); } catch (e) {}
		try { if (typeof lp.setYBodyRotation === "function") lp.setYBodyRotation(this.yaw); } catch (e) {}
		try { if (typeof lp.setYHeadRotation === "function") lp.setYHeadRotation(this.yaw); } catch (e) {}
	},
	stopLoop(restore) {
		this.running = false;
		this.pushPy();
		if (!restore) return;
		let r = null;
		try { r = camera.getRotation(); } catch (e) {}
		try {
			const lp = player.getLocalPlayer();
			if (lp && typeof lp.setRotation === "function" && r && isFinite(r.yaw)) {
				lp.setRotation({ yaw: r.yaw, pitch: isFinite(r.pitch) ? r.pitch : 0 });
			}
		} catch (e) {}
		try { camera.resetCamera(); } catch (e) {}
	},
	onWorldExit() {
		this.stopLoop(false);
		this.pyUp = false;
		try { camera.resetCamera(); } catch (e) {}
	}
};

const customCamera = {
	tag: "fun_custom_camera",
	enabled: false,
	offX: 0,
	offY: 0,
	offZ: 0,
	pyUp: false,
	tries: 0,
	pyOn: `import mod.client.extraClientApi as clientApi

try:
    import _camera
    _CAM_HAS = True
except Exception:
    _CAM_HAS = False

_CS = clientApi.GetClientSystemCls()

class _KuSugCam(_CS):
    def __init__(self, ns, sn):
        super(_KuSugCam, self).__init__(ns, sn)
        self.frame = 0
        ns2 = clientApi.GetEngineNamespace()
        sn2 = clientApi.GetEngineSystemName()
        self.ListenForEvent(ns2, sn2, 'GameRenderTickEvent', self, self.on_frame)

    def on_frame(self, args):
        if not _CAM_HAS:
            return
        self.frame += 1
        if not globals().get('_kusug_cam_on'):
            if globals().get('_kusug_cam_reset'):
                globals()['_kusug_cam_reset'] = False
                try:
                    _camera.SetCameraOffset((0, 0, 0))
                except Exception:
                    pass
            return
        if not globals().get('_kusug_cam_dirty') and self.frame % 20:
            return
        globals()['_kusug_cam_dirty'] = False
        self.frame = 0
        off = globals().get('_kusug_cam_off')
        if off:
            try:
                _camera.SetCameraOffset(off)
            except Exception:
                pass

_old = globals().get('_kusug_cam_sys')
if _old is not None:
    try:
        _old.UnListenAllEvents()
    except Exception:
        pass
globals()['_kusug_cam_sys'] = _KuSugCam('KuSugCam', 'KuSugCamSystem')`,
	onModuleEvent(args) {
		let dirty = false;
		if (args.cam_x !== undefined) {
			const n = Number(args.cam_x);
			if (!isNaN(n)) {
				const v = Math.max(-50, Math.min(50, Math.floor(n)));
				if (v !== this.offX) { this.offX = v; dirty = true; }
			}
		}
		if (args.cam_y !== undefined) {
			const n = Number(args.cam_y);
			if (!isNaN(n)) {
				const v = Math.max(-50, Math.min(50, Math.floor(n)));
				if (v !== this.offY) { this.offY = v; dirty = true; }
			}
		}
		if (args.cam_z !== undefined) {
			const n = Number(args.cam_z);
			if (!isNaN(n)) {
				const v = Math.max(-50, Math.min(50, Math.floor(n)));
				if (v !== this.offZ) { this.offZ = v; dirty = true; }
			}
		}
		if (!stdToggle(this, args, "自定义相机", false)) {
			if (dirty) this.pushPy();
			return;
		}
		if (this.enabled) {
			this.tries = 0;
			this.ensurePy();
		}
		this.pushPy();
	},
	ensurePy() {
		if (this.pyUp || this.tries >= 100) return;
		this.tries++;
		try {
			app.evalPython(this.pyOn);
			this.pyUp = true;
		} catch (e) {
			this.pyUp = false;
		}
	},
	pushPy() {
		const on = this.enabled ? "True" : "False";
		const rst = this.enabled ? "False" : "True";
		try {
			app.evalPython("globals()['_kusug_cam_on'] = " + on + "\nglobals()['_kusug_cam_reset'] = " + rst + "\nglobals()['_kusug_cam_dirty'] = True\nglobals()['_kusug_cam_off'] = (" + (this.offX / 10) + "," + (this.offY / 10) + "," + (this.offZ / 10) + ")");
		} catch (e) {}
	},
	onTick() {
		if (!this.enabled) return;
		if (!this.pyUp) {
			this.ensurePy();
			if (this.pyUp) this.pushPy();
		}
	},
	onWorldExit() {
		this.pyUp = false;
		this.tries = 0;
	}
};

const motionBlur = {
	tag: "fun_motion_blur",
	enabled: false,
	shown: true,
	intensity: 60,
	soDst: kuNative.soDst,
	loaded: false,
	hooked: false,
	lastPos: null,
	lastRot: null,
	cur: 0,
	sent: -1,
	loadSo() {
		const err = kuNative.load();
		if (err) return err;
		this.loaded = true;
		this.hooked = true;
		return "";
	},
	setPermil(v) {
		try { kuNative.call(5, v + 1); } catch (e) {}
	},
	unhook() {
		this.setPermil(0);
		this.hooked = false;
	},
	onModuleEvent(args) {
		const mbi = clampPos(args.motion_blur_intensity, 10, 100);
		if (mbi) this.intensity = mbi;
		if (args.fun !== this.tag || !("value" in args)) return;
		const v = Boolean(args.value);
		if (v === this.enabled) return;
		if (v) {
			let err = "";
			if (!this.loaded || !this.hooked) err = this.loadSo();
			if (err) {
				try { app.showToast("" + err); } catch (e) {}
				return;
			}
			this.lastPos = null;
			this.lastRot = null;
			this.cur = 0;
			this.sent = -1;
			this.enabled = true;
			this.shown = true;
		} else {
			this.enabled = false;
			if (this.hooked) this.unhook();
		}
		ensureHud(this, this.tag, "动态模糊");
		this.hud.enabled = this.enabled;
		notifyToggle("动态模糊", this.enabled, this.enabled ? "强度 " + this.intensity + "%" : "");
	},
	onWorldExit() {
		if (this.enabled && this.shown) {
			this.shown = false;
			this.sent = 0;
			this.setPermil(0);
		}
	},
	onTick() {
		if (!this.enabled || !this.loaded) return;
		let inGame = true;
		try { inGame = app.isInGame(); } catch (e) {}
		if (!inGame) {
			if (this.sent !== 0) {
				this.sent = 0;
				this.setPermil(0);
			}
			return;
		}
		let pos = null;
		try { pos = player.getLocalPlayer().getPos(); } catch (e) {}
		let rot = null;
		try { rot = camera.getRotation(); } catch (e) {}
		let k = 0;
		if (pos && this.lastPos) {
			const dx = pos.x - this.lastPos.x, dy = pos.y - this.lastPos.y, dz = pos.z - this.lastPos.z;
			const speed = Math.sqrt(dx * dx + dy * dy + dz * dz) * 20;
			k = (speed - 2) / 4;
		}
		if (rot && this.lastRot) {
			let dyaw = rot.yaw - this.lastRot.yaw;
			if (dyaw > 180) dyaw -= 360;
			if (dyaw < -180) dyaw += 360;
			const dpitch = rot.pitch - this.lastRot.pitch;
			const ang = Math.sqrt(dyaw * dyaw + dpitch * dpitch) * 20;
			const kr = (ang - 20) / 120;
			if (kr > k) k = kr;
		}
		if (pos) this.lastPos = pos;
		if (rot) this.lastRot = rot;
		if (k < 0.06) k = 0;
		if (k > 1) k = 1;
		const target = (k > 0 ? Math.sqrt(k) : 0) * 9.3 * this.intensity;
		this.cur += (target - this.cur) * 0.35;
		if (this.cur < 5) this.cur = 0;
		const v = Math.round(this.cur);
		if (v !== this.sent) {
			this.sent = v;
			this.setPermil(v);
		}
	}
};

const itemHud = {
	tag: "fun_item_hud",
	enabled: false,
	shown: true,
	soDst: kuNative.soDst,
	loaded: false,
	hooked: false,
	bufAddr: 0n,
	lastSig: "",
	tickCount: 0,
	agg: {},
	side: 0,
	offX: 0,
	offY: 0,
	maxRows: 14,
	pickRadio(args, key, n) {
		const mv = argPick(args, key);
		if (typeof mv === "string") {
			for (let i = 0; i < n; i++) if (mv === key + "_" + i) return i;
		}
		for (let i = 0; i < n; i++) if (args[key + "_" + i] === true) return i;
		return -1;
	},
	pushCfg() {
		if (!this.loaded) return;
		try { kuNative.call(9, this.side + 1); } catch (e) {}
		try { kuNative.call(10, this.offX + 401); } catch (e) {}
		try { kuNative.call(11, this.offY + 401); } catch (e) {}
		try { kuNative.call(12, this.maxRows); } catch (e) {}
	},
	loadSo() {
		const err = kuNative.load();
		if (err) return err;
		this.loaded = true;
		this.hooked = true;
		this.bufAddr = kuNative.addr(13);
		return "";
	},
	unhook() {
		try { kuNative.call(7, 2); } catch (e) {}
		this.hooked = false;
	},
	push(lines) {
		const sig = lines.join("|");
		if (sig === this.lastSig) return;
		this.lastSig = sig;
		if (!this.bufAddr) return;
		const bytes = encodeUtf8(lines.join("\n"));
		if (bytes.length > 8000) return;
		try {
			soPush(this.bufAddr, bytes);
			kuNative.call(8, 0);
		} catch (e) {}
	},
	liveName(a, id) {
		try {
			const s = String(a.getName() || "").replace(/§./g, "").trim();
			if (s) return s;
		} catch (e) {}
		return id.replace(/^minecraft:/, "");
	},
	extractStack(a) {
		let nbt = "";
		try { nbt = String(a.getAdditionalSaveData() || ""); } catch (e) {}
		let body = "";
		const it = nbt.indexOf("Item:{");
		if (it >= 0) {
			let depth = 0, end = -1;
			for (let i = it + 5; i < nbt.length; i++) {
				const c = nbt.charAt(i);
				if (c === "{") depth++;
				else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
			}
			if (end < 0) return null;
			body = nbt.slice(it, end + 1);
		} else {
			body = nbt;
		}
		const nm = /Name:"([^"]*)"/.exec(body);
		const cm = /Count:(\d+)b/.exec(body);
		const id = nm ? nm[1] : "";
		if (!id) return null;
		return { id: id.replace(/^minecraft:/, ""), count: cm ? parseInt(cm[1], 10) : 1 };
	},
	onModuleEvent(args) {
		let touched = false;
		const sd = this.pickRadio(args, "ih_side", 2);
		if (sd >= 0) { this.side = sd; touched = true; }
		if (args.ih_offx !== undefined || argPick(args, "ih_offx") !== undefined) {
			const n = Number(argPick(args, "ih_offx"));
			if (!isNaN(n)) { this.offX = Math.max(-200, Math.min(200, Math.floor(n))); touched = true; }
		}
		if (args.ih_offy !== undefined || argPick(args, "ih_offy") !== undefined) {
			const n = Number(argPick(args, "ih_offy"));
			if (!isNaN(n)) { this.offY = Math.max(-200, Math.min(200, Math.floor(n))); touched = true; }
		}
		const mr = clampPos(argPick(args, "ih_maxrows"), 1, 14);
		if (mr) { this.maxRows = mr; touched = true; }
		if (touched && this.enabled && this.loaded) this.pushCfg();
		if (args.fun !== this.tag || !("value" in args)) return;
		const v = Boolean(args.value);
		if (v === this.enabled) return;
		if (v) {
			let err = "";
			if (!this.loaded || !this.hooked) err = this.loadSo();
			if (err) {
				try { app.showToast("" + err); } catch (e) {}
				return;
			}
			try { kuNative.call(7, 1); } catch (e) {}
			this.enabled = true;
			this.shown = true;
			this.lastSig = "";
			this.pushCfg();
		} else {
			this.enabled = false;
			this.push([]);
			const self = this;
			setTimeout(function () { if (!self.enabled && self.hooked) self.unhook(); }, 450);
		}
		ensureHud(this, this.tag, "掉落物统计");
		this.hud.enabled = this.enabled;
		notifyToggle("掉落物统计", this.enabled, "");
	},
	onWorldExit() {
		if (this.enabled && this.shown) {
			this.shown = false;
			this.push([]);
		}
	},
	onTick() {
		if (!tickEvery(this, 5)) return;
		let inGame = true;
		try { inGame = app.isInGame(); } catch (e) {}
		if (!inGame || uiVis.poll()) {
			if (this.shown) {
				this.shown = false;
				this.push([]);
			}
			return;
		}
		this.shown = true;
		const agg = this.agg;
		for (const k in agg) delete agg[k];
		let actors = null;
		try {
			const level = world.getClientWorld();
			actors = level ? level.getActors() : null;
		} catch (e) {}
		if (actors) {
			for (const a of actors) {
				let id = "";
				try {
					const idf = a.getIdentifier();
					id = String((idf && idf.canonicalName) || "");
				} catch (e) {}
				if (id !== "minecraft:item") continue;
				const st = this.extractStack(a);
				if (!st) continue;
				if (!agg[st.id]) agg[st.id] = { name: this.liveName(a, st.id), count: 0 };
				agg[st.id].count += st.count;
			}
		}
		const names = Object.keys(agg);
		names.sort((x, y) => agg[y].count - agg[x].count || (x < y ? -1 : x > y ? 1 : 0));
		const lines = [];
		for (let i = 0; i < names.length && i < this.maxRows; i++) lines.push(agg[names[i]].name + "\t" + agg[names[i]].count);
		this.push(lines);
	}
};

const dirHud = {
	tag: "fun_dir_hud",
	enabled: false,
	soDst: kuNative.soDst,
	loaded: false,
	hooked: false,
	shown: true,
	lastSent: -1,
	infoAddr: 0n,
	lastInfo: "",
	infoTick: 0,
	fpsVal: 0,
	offX: 0,
	offY: 0,
	loadSo() {
		const err = kuNative.load();
		if (err) return err;
		this.loaded = true;
		this.hooked = true;
		this.infoAddr = kuNative.addr(21);
		return "";
	},
	pushCfg() {
		if (!this.loaded) return;
		try { kuNative.call(18, this.offX + 401); } catch (e) {}
		try { kuNative.call(19, this.offY + 401); } catch (e) {}
	},
	unhook() {
		try { kuNative.call(17, 0); } catch (e) {}
		this.hooked = false;
		this.shown = false;
		this.lastInfo = "";
	},
	hide() {
		try { kuNative.call(17, 0); } catch (e) {}
		this.shown = false;
		this.lastInfo = "";
	},
	onWorldExit() {
		if (this.enabled && this.shown) this.hide();
	},
	onModuleEvent(args) {
		let touched = false;
		if (argPick(args, "dir_offx") !== undefined) {
			const n = Number(argPick(args, "dir_offx"));
			if (!isNaN(n)) { this.offX = Math.max(-200, Math.min(200, Math.floor(n))); touched = true; }
		}
		if (argPick(args, "dir_offy") !== undefined) {
			const n = Number(argPick(args, "dir_offy"));
			if (!isNaN(n)) { this.offY = Math.max(-200, Math.min(200, Math.floor(n))); touched = true; }
		}
		if (touched && this.enabled && this.loaded) this.pushCfg();
		if (args.fun !== this.tag || !("value" in args)) return;
		const v = Boolean(args.value);
		if (v === this.enabled) return;
		if (v) {
			let err = "";
			if (!this.loaded || !this.hooked) err = this.loadSo();
			if (err) {
				try { app.showToast("" + err); } catch (e) {}
				return;
			}
			try { kuNative.call(14, 1); } catch (e) {}
			this.enabled = true;
			this.shown = true;
			this.lastSent = -1;
			this.lastInfo = "";
			this.infoTick = 0;
			this.refreshFps();
			this.pushCfg();
			this.pushInfo();
		} else {
			this.enabled = false;
			if (this.hooked) this.unhook();
		}
		ensureHud(this, this.tag, "方向标");
		this.hud.enabled = this.enabled;
		notifyToggle("方向标", this.enabled, "");
	},
	buildInfo() {
		let pos = null;
		try { pos = player.getLocalPlayer().getPos(); } catch (e) {}
		if (!pos || !isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z)) return "";
		let s = "KuSug · X:" + Math.floor(pos.x) + " Y:" + Math.floor(pos.y - 1.62) + " Z:" + Math.floor(pos.z);
		if (!fpsHud.enabled && this.fpsVal) s += " · " + this.fpsVal + " FPS";
		return s;
	},
	refreshFps() {
		if (fpsHud.enabled) return;
		try {
			const path = app.getResource("KuSug/Fps.txt");
			app.evalPython("import mod.client.extraClientApi as clientApi\nwith open(\"" + path + "\", \"w\") as f:\n\tf.write(str(clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId()).GetFps()))");
			const n = Number(String(fs.read(path) || "").trim());
			this.fpsVal = isNaN(n) ? 0 : Math.floor(n);
		} catch (e) {}
	},
	pushInfo() {
		if (!this.enabled || !this.shown || !this.infoAddr) return;
		const s = this.buildInfo();
		if (s === this.lastInfo) return;
		const bytes = encodeUtf8(s);
		if (bytes.length > 400) return;
		this.lastInfo = s;
		try {
			soPush(this.infoAddr, bytes);
			kuNative.call(16, 0);
		} catch (e) {}
	},
	onTick() {
		let inGame = true;
		try { inGame = app.isInGame(); } catch (e) {}
		if (!inGame || uiVis.poll()) {
			if (this.shown) this.hide();
			return;
		}
		if (!this.shown) {
			this.shown = true;
			this.lastInfo = "";
			this.infoTick = 0;
			this.refreshFps();
			try { kuNative.call(14, 1); } catch (e) {}
			this.pushCfg();
			this.lastSent = -1;
		}
		let yaw = NaN;
		try {
			const r = camera.getRotation();
			if (r) yaw = Number(r.yaw);
		} catch (e) {}
		if (isFinite(yaw)) {
			// 设备实测该 API yaw: 0=北且向西递增(90=西), 与雷达 θ=+yaw 同源; 换算成方位角(0=北 90=东 顺时针)
			let b = (360 - (((yaw % 360) + 360) % 360)) % 360;
			const cdeg = Math.round(b * 100);
			if (cdeg !== this.lastSent) {
				this.lastSent = cdeg;
				try { kuNative.call(15, cdeg + 1); } catch (e) {}
			}
		}
		this.infoTick++;
		if (this.infoTick >= 20) {
			this.infoTick = 0;
			this.refreshFps();
		}
		this.pushInfo();
	}
};

const uiVis = {
	path: "/storage/emulated/0/Android/data/" + gamePkg + "/files/resources/KuSug/UI隐显.txt",
	pyUp: false,
	tries: 0,
	lastV: false,
	lastT: 0,
	pyOn: `def _kc_pkg():
    try:
        with open('/proc/self/cmdline', 'rb') as _f:
            _s = _f.read(256)
        _s = _s.split(chr(0))[0].split(':')[0].strip()
        if len(_s) > 3 and '.' in _s:
            return _s
    except Exception:
        pass
    return 'com.netease.x19'

_KC_VFILE = '/storage/emulated/0/Android/data/' + _kc_pkg() + '/files/resources/KuSug/UI隐显.txt'

def _kc_vwrite(v):
    try:
        with open(_KC_VFILE, 'wb') as f:
            f.write(str(v))
    except Exception:
        pass

import mod.client.extraClientApi as clientApi

_CS = clientApi.GetClientSystemCls()

class _KuSugVis(_CS):
    def __init__(self, ns, sn):
        super(_KuSugVis, self).__init__(ns, sn)
        self.dead = False
        self.depth = 0
        ns2 = clientApi.GetEngineNamespace()
        sn2 = clientApi.GetEngineSystemName()
        self.ListenForEvent(ns2, sn2, 'PushScreenEvent', self, self.on_push)
        self.ListenForEvent(ns2, sn2, 'PopScreenEvent', self, self.on_pop)
        _kc_vwrite(0)

    def on_push(self, args=None):
        try:
            ns = (args or {}).get('namespace') or u''
            if ns == u'hud.hud_screen':
                # hud push = back to gameplay; screens killed by world switch never fire Pop,
                # so force depth reset here (pure event self-heal, no polling)
                self.depth = 0
                _kc_vwrite(0)
                return
            self.depth += 1
            _kc_vwrite(1)
        except Exception:
            pass

    def on_pop(self, args=None):
        try:
            ns = (args or {}).get('namespace') or u''
            if ns == u'hud.hud_screen':
                # hud pop = leaving world; screens above hud die with it, reset counter
                self.depth = 0
                return
            if self.depth > 0:
                self.depth -= 1
            if self.depth == 0:
                _kc_vwrite(0)
        except Exception:
            pass

    def shutdown(self):
        self.dead = True
        try:
            self.UnListenAllEvents()
        except Exception:
            pass
        _kc_vwrite(0)

_old = globals().get('_kusug_vis_sys')
if _old is not None:
    try:
        _old.shutdown()
    except Exception:
        pass
globals()['_kusug_vis_sys'] = _KuSugVis('KuSugVis', 'KuSugVisSystem')`,
	ensurePy() {
		if (this.pyUp || this.tries >= 100) return;
		this.tries++;
		try {
			app.evalPython(this.pyOn);
			this.pyUp = true;
		} catch (e) {
			this.pyUp = false;
		}
	},
	poll() {
		const now = Date.now();
		if (now - this.lastT < 200) return this.lastV;
		this.lastT = now;
		if (!this.pyUp) this.ensurePy();
		if (!this.pyUp) return false;
		let raw = "";
		try { raw = String(fs.read(this.path) || "").trim(); } catch (e) {}
		if (raw === "1" || raw === "0") this.lastV = raw === "1";
		return this.lastV;
	},
	onWorldExit() {
		this.pyUp = false;
		this.tries = 0;
		this.lastV = false;
	}
};

const crosshair = {
	tag: "fun_crosshair",
	enabled: false,
	soDst: kuNative.soDst,
	loaded: false,
	hooked: false,
	shown: true,
	preset: 0,
	size: 18,
	thick: 3,
	gap: 6,
	colorIdx: 0,
	dynSpread: true,
	amp: 10,
	offX: -3,
	offY: -3,
	uid: "",
	CH_COLORS: [0xFFFFFF, 0x3DFF6E, 0x41E8FF, 0xFF4DD8, 0xFFE14D, 0xFF4D4D, 0xFF9A3D, 0xA06BFF],
	loadSo() {
		const err = kuNative.load();
		if (err) return err;
		this.loaded = true;
		this.hooked = true;
		return "";
	},
	unhook() {
		try { kuNative.call(23, 0); } catch (e) {}
		this.hooked = false;
		this.shown = false;
	},
	hide() {
		try { kuNative.call(23, 0); } catch (e) {}
		this.shown = false;
	},
	pickRadio(args, key, n) {
		const mv = argPick(args, key);
		if (typeof mv === "string") {
			for (let i = 0; i < n; i++) if (mv === key + "_" + i) return i;
		}
		for (let i = 0; i < n; i++) if (args[key + "_" + i] === true) return i;
		return -1;
	},
	pushCfg() {
		if (!this.loaded) return;
		try { kuNative.call(24, this.preset); } catch (e) {}
		try { kuNative.call(29, this.size); } catch (e) {}
		try { kuNative.call(30, this.thick); } catch (e) {}
		try { kuNative.call(31, this.gap); } catch (e) {}
		try { kuNative.call(25, this.CH_COLORS[this.colorIdx] || 0xFFFFFF); } catch (e) {}
		try { kuNative.call(26, 90); } catch (e) {}
		try { kuNative.call(34, this.dynSpread ? 1 : 0); } catch (e) {}
		try { kuNative.call(27, this.amp); } catch (e) {}
		try { kuNative.call(32, this.offX); } catch (e) {}
		try { kuNative.call(33, this.offY); } catch (e) {}
	},
	onModuleEvent(args) {
		let touched = false;
		const sz = clampPos(argPick(args, "ch_size"), 4, 80);
		if (sz) { this.size = sz; touched = true; }
		const tk = clampPos(argPick(args, "ch_thick"), 1, 12);
		if (tk) { this.thick = tk; touched = true; }
		if (args.ch_gap !== undefined) {
			const n = Number(argPick(args, "ch_gap"));
			if (!isNaN(n)) { this.gap = Math.max(0, Math.min(40, Math.floor(n))); touched = true; }
		}
		const pr = this.pickRadio(args, "ch_preset", 5);
		if (pr >= 0) { this.preset = pr; touched = true; }
		const ci = this.pickRadio(args, "ch_color", 8);
		if (ci >= 0) { this.colorIdx = ci; touched = true; }
		if (typeof args.ch_dyn_spread !== "undefined") { this.dynSpread = Boolean(args.ch_dyn_spread); touched = true; }
		const am = clampPos(argPick(args, "ch_amp"), 2, 40);
		if (am) { this.amp = am; touched = true; }
		if (args.ch_offx !== undefined) {
			const n = Number(argPick(args, "ch_offx"));
			if (!isNaN(n)) { this.offX = Math.max(-100, Math.min(100, Math.floor(n))); touched = true; }
		}
		if (args.ch_offy !== undefined) {
			const n = Number(argPick(args, "ch_offy"));
			if (!isNaN(n)) { this.offY = Math.max(-100, Math.min(100, Math.floor(n))); touched = true; }
		}
		if (touched && this.enabled && this.loaded) this.pushCfg();
		if (args.fun !== this.tag || !("value" in args)) return;
		const v = Boolean(args.value);
		if (v === this.enabled) return;
		if (v) {
			let err = "";
			if (!this.loaded || !this.hooked) err = this.loadSo();
			if (err) {
				try { app.showToast("" + err); } catch (e) {}
				return;
			}
			try { kuNative.call(22, 1); } catch (e) {}
			this.enabled = true;
			this.shown = true;
			this.pushCfg();
		} else {
			this.enabled = false;
			if (this.hooked) this.unhook();
		}
		notifyToggle("自定义准星", this.enabled, "");
	},
	onPlayerAttack(playerId, targetId) {
		if (!this.enabled || !this.shown || !this.loaded) return;
		if (!this.uid) {
			try { this.uid = String(player.getLocalPlayer().getUniqueID()); } catch (e) { this.uid = "?"; }
		}
		if (this.uid !== "?" && String(playerId) !== this.uid) return;
		try { kuNative.call(28, 2); } catch (e) {}
	},
	onTick() {
		let fp = true;
		try { fp = options.getPlayerViewPerspective() === 0; } catch (e) {}
		if (!fp || uiVis.poll()) {
			if (this.shown) this.hide();
			return;
		}
		if (!this.shown) {
			this.shown = true;
			try { kuNative.call(22, 1); } catch (e) {}
			this.pushCfg();
		}
	},
	onWorldExit() {
		if (this.enabled && this.shown) this.hide();
		this.uid = "";
	}
};
const radarHud = {
	tag: "fun_radar",
	enabled: false,
	loaded: false,
	bufAddr: 0n,
	offX: 65,
	offY: 16,
	range: 64,
	tickCount: 0,
	selfUid: "",
	shown: true,
	showPlayer: true,
	showMob: true,
	hide() {
		try { kuNative.call(57, 0); } catch (e) {}
		this.shown = false;
	},
	onWorldExit() {
		if (this.enabled && this.shown) this.hide();
	},
	loadSo() {
		const err = kuNative.load();
		if (err) return err;
		this.loaded = true;
		return "";
	},
	pushCfg() {
		if (!this.loaded) return;
		try { kuNative.call(58, ((this.offY & 255) << 8) | (this.offX & 255)); } catch (e) {}
	},
	pushYaw() {
		if (!this.loaded) return;
		let yaw = NaN;
		try { const r = camera.getRotation(); if (r) yaw = Number(r.yaw); } catch (e) {}
		if (!isFinite(yaw)) return;
		yaw = ((yaw % 360) + 360) % 360;
		try { kuNative.call(59, Math.round(yaw * 64)); } catch (e) {}
	},
	scan() {
		let mp = null;
		try { mp = player.getLocalPlayer().getPos(); } catch (e) {}
		if (!mp || !isFinite(mp.x)) return;
		const range = this.range;
		const rangeSq = range * range;
		const buf = [0];
		let n = 0;
		const push = function (p, type) {
			if (!p || !isFinite(p.x)) return;
			const dx = p.x - mp.x, dz = p.z - mp.z;
			if (dx * dx + dz * dz > rangeSq) return;
			let qx = Math.round(dx * 16), qz = Math.round(dz * 16);
			if (qx < -32768) qx = -32768; if (qx > 32767) qx = 32767;
			if (qz < -32768) qz = -32768; if (qz > 32767) qz = 32767;
			buf.push(qx & 255, (qx >> 8) & 255, qz & 255, (qz >> 8) & 255, type);
			n++;
		};
		const lvl = world.getClientWorld();
		if (!lvl) return;
		if (!this.selfUid) {
			try { this.selfUid = String(player.getLocalPlayer().getUniqueID() || ""); } catch (e) {}
		}
		let ps = [];
		if (this.showPlayer) { try { ps = lvl.getPlayers() || []; } catch (e) {} }
		for (const p of ps) {
			if (n >= 64) break;
			try {
				if (this.selfUid && String(p.getUniqueID()) === this.selfUid) continue;
				push(p.getPos(), 0);
			} catch (e) {}
		}
		let as = [];
		if (this.showMob) { try { as = lvl.getActors() || []; } catch (e) {} }
		for (const a of as) {
			if (n >= 64) break;
			try {
				const idf = a.getIdentifier();
				const cn = idf ? String(idf.canonicalName || "") : "";
				if (cn === "minecraft:player" || !cn || killAura.junkTypes.test(cn)) continue;   /* 空名(伪造包实体)+杂物实体(闪电/箭/经验球等)不上雷达 */
				push(a.getPos(), 1);
			} catch (e) {}
		}
		buf[0] = n;
		try {
			os.writeAddress(this.bufAddr, buf.length, new Uint8Array(buf).buffer);
			kuNative.call(60, 0);
		} catch (e) {}
	},
	onModuleEvent(args) {
		let touched = false;
		if (argPick(args, "rd_offx") !== undefined) {
			const n = Number(argPick(args, "rd_offx"));
			if (!isNaN(n)) { this.offX = Math.max(0, Math.min(100, Math.floor(n))); touched = true; }
		}
		if (argPick(args, "rd_offy") !== undefined) {
			const n = Number(argPick(args, "rd_offy"));
			if (!isNaN(n)) { this.offY = Math.max(0, Math.min(100, Math.floor(n))); touched = true; }
		}
		if (argPick(args, "rd_range") !== undefined) {
			const n = Number(argPick(args, "rd_range"));
			if (!isNaN(n)) { this.range = Math.max(16, Math.min(100, Math.floor(n))); touched = true; }
		}
		if (typeof args.rd_show_player !== "undefined") this.showPlayer = Boolean(args.rd_show_player);
		if (typeof args.rd_show_mob !== "undefined") this.showMob = Boolean(args.rd_show_mob);
		if (touched && this.enabled && this.loaded) this.pushCfg();
		if (!stdToggle(this, args, "雷达")) return;
		if (!this.enabled) {
			this.shown = false;
			try { kuNative.call(57, 0); } catch (e) {}
			return;
		}
		if (!this.loaded) {
			const err = this.loadSo();
			if (err) {
				this.enabled = false;
				if (this.hud) this.hud.enabled = false;
				try { app.showToast("so 加载失败: " + err); } catch (e2) {}
				return;
			}
		}
		try { this.bufAddr = BigInt(kuNative.call(57, 1)); } catch (e) {}
		this.shown = true;
		this.pushCfg();
		this.pushYaw();
	},
	onTick() {
		if (!this.enabled || !this.loaded || !this.bufAddr) return;
		let inGame = true;
		try { inGame = app.isInGame(); } catch (e) {}
		if (!inGame || uiVis.poll()) {
			if (this.shown) this.hide();
			return;
		}
		if (!this.shown) {
			this.shown = true;
			try { kuNative.call(57, 1); } catch (e) {}
			this.pushCfg();
		}
		this.pushYaw();
		if (!tickEvery(this, 4)) return;
		this.scan();
	}
};

const hideClutter = {
	tag: "fun_hide_clutter",
	enabled: false,
	patchCode: `
import mod.client.extraClientApi as clientApi

_G = globals()
st = _G.get('_kusug_hc')
if st is None:
    st = {'on': False, 'timer': None, 'ai_obj': None, 'ai_orig': None, 'ai_cheat': True, 'pet_obj': None, 'pet_orig': None}
    _G['_kusug_hc'] = st

def _hc_ai_mgr():
    try:
        s = clientApi.GetSystem('Minecraft', 'aiCommand')
        if s is None:
            return None
        um = getattr(s, 'mAiUIManager', None)
        if um is None:
            return None
        return getattr(um, 'mHudScreenAIFuncManager', None)
    except Exception:
        return None

def _hc_pet_screen():
    try:
        n = clientApi.GetUI('neteasePetMod', 'petChatHud')
        if n is not None:
            return n
    except Exception:
        pass
    try:
        import client.ui.uiManager as uiManager
        for n in uiManager.instance()._ui_stack:
            try:
                if n.get_def_key() == 'neteasePetMod:petChatHud' and not n.is_remove():
                    return n
            except Exception:
                pass
    except Exception:
        pass
    return None

def _hc_hide_ai(m):
    try:
        m.mCheatVisible = False
    except Exception:
        pass
    for a in ('mAiBtn', 'mAiShortcutBtn', 'mTutorialStartPanel', 'mDragTipsPanel', 'mRootNode'):
        b = getattr(m, a, None)
        if b is not None:
            try:
                b.SetVisible(False)
            except Exception:
                pass

def _hc_hide_pet(s):
    for a in ('mChatBtn', 'mToggleBtn', 'mKeyHintBg', 'mRootNode'):
        b = getattr(s, a, None)
        if b is not None:
            try:
                b.SetVisible(False)
            except Exception:
                pass

def _hc_patch_ai(m):
    if getattr(m, '_ks_hc_patched', False):
        return
    st['ai_obj'] = m
    st['ai_orig'] = getattr(m, 'SetAiUiVisible', None)
    st['ai_cheat'] = getattr(m, 'mCheatVisible', True)
    def _fake_ai(visible, _m=m):
        _hc_hide_ai(_m)
    m.SetAiUiVisible = _fake_ai
    m._ks_hc_patched = True

def _hc_patch_pet(s):
    if getattr(s, '_ks_hc_patched', False):
        return
    st['pet_obj'] = s
    st['pet_orig'] = getattr(s, 'RefreshByPetRuntimeState', None)
    def _fake_pet(state, _s=s):
        _hc_hide_pet(_s)
    s.RefreshByPetRuntimeState = _fake_pet
    s._ks_hc_patched = True

def _hc_enforce():
    if not st.get('on'):
        return
    m = _hc_ai_mgr()
    if m is not None:
        _hc_patch_ai(m)
        _hc_hide_ai(m)
    s = _hc_pet_screen()
    if s is not None:
        _hc_patch_pet(s)
        _hc_hide_pet(s)

st['on'] = True
try:
    if st.get('timer') is None:
        st['timer'] = clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId()).AddRepeatedTimer(0.6, _hc_enforce)
except Exception:
    st['timer'] = None
_hc_enforce()
`,
	unpatchCode: `
import mod.client.extraClientApi as clientApi

_G = globals()
st = _G.get('_kusug_hc')

def _hc_ai_mgr2():
    try:
        s = clientApi.GetSystem('Minecraft', 'aiCommand')
        if s is None:
            return None
        um = getattr(s, 'mAiUIManager', None)
        if um is None:
            return None
        return getattr(um, 'mHudScreenAIFuncManager', None)
    except Exception:
        return None

def _hc_pet_screen2():
    try:
        n = clientApi.GetUI('neteasePetMod', 'petChatHud')
        if n is not None:
            return n
    except Exception:
        pass
    try:
        import client.ui.uiManager as uiManager
        for n in uiManager.instance()._ui_stack:
            try:
                if n.get_def_key() == 'neteasePetMod:petChatHud' and not n.is_remove():
                    return n
            except Exception:
                pass
    except Exception:
        pass
    return None

if st is not None:
    st['on'] = False
    t = st.get('timer')
    if t is not None:
        try:
            clientApi.GetEngineCompFactory().CreateGame(clientApi.GetLevelId()).CancelTimer(t)
        except Exception:
            pass
        st['timer'] = None
    m = _hc_ai_mgr2()
    if m is not None and st.get('ai_obj') is m:
        try:
            if st.get('ai_orig') is not None:
                m.SetAiUiVisible = st['ai_orig']
                st['ai_orig'](st.get('ai_cheat', True))
        except Exception:
            pass
        try:
            m._ks_hc_patched = False
        except Exception:
            pass
    s = _hc_pet_screen2()
    if s is not None and st.get('pet_obj') is s:
        try:
            if st.get('pet_orig') is not None:
                s.RefreshByPetRuntimeState = st['pet_orig']
                st['pet_orig'](getattr(s, 'mPetRuntimeState', None) or {})
        except Exception:
            pass
        try:
            s._ks_hc_patched = False
        except Exception:
            pass
    _G['_kusug_hc'] = None
`,
	onModuleEvent(args) {
		if (!stdToggle(this, args, "隐藏累赘")) return;
		try { app.evalPython(this.enabled ? this.patchCode : this.unpatchCode); } catch (e) {}
	}
};

const containerBlur = {
	tag: "fun_container_blur",
	enabled: false,
	intensity: 60,
	// 事件监听必须走 ClientSystem 子类的 self.ListenForEvent(陀螺仪同款官方通道);
	// 引擎内部框架 eventUtil.ListenForEngineClient 在 evalPython 沙箱里静默失败(2026-09-16 设备实证)。
	// 全量容器: Push/PopScreenEvent 通用屏幕栈事件 + 容器名子串匹配 + 计数记账(嵌套开屏不互灭)
	buildPatchCode() {
		return `
import mod.client.extraClientApi as clientApi

_CS = clientApi.GetClientSystemCls()

_CB_KEYS = ('chest', 'inventory_screen', 'crafting', 'furnace', 'smoker', 'anvil', 'enchant', 'brewing', 'beacon', 'hopper', 'dropper', 'dispenser', 'loom', 'smithing', 'grindstone', 'cartography', 'stonecutter', 'trad', 'shulker', 'barrel', 'horse', 'lectern', 'command_block', 'structure_block', 'jigsaw', 'sign_screen', 'book_screen', 'npc_screen')

def _cb_is_container(ns):
    if not ns:
        return False
    for _k in _CB_KEYS:
        if _k in ns:
            return True
    return False

class _KuSugCB(_CS):
    def __init__(self, ns, sn):
        super(_KuSugCB, self).__init__(ns, sn)
        self.blurComp = None
        self.dead = False
        self.depth = {}
        self.blurred = False
        ns2 = clientApi.GetEngineNamespace()
        sn2 = clientApi.GetEngineSystemName()
        self.ListenForEvent(ns2, sn2, 'PushScreenEvent', self, self.on_push)
        self.ListenForEvent(ns2, sn2, 'PopScreenEvent', self, self.on_pop)
        self.try_get_comp()

    def try_get_comp(self):
        if self.blurComp is not None:
            return True
        try:
            self.blurComp = clientApi.GetEngineCompFactory().CreatePostProcess(clientApi.GetLevelId())
        except Exception:
            pass
        return self.blurComp is not None

    def apply_blur(self, on):
        if self.dead or not self.try_get_comp():
            return
        try:
            if on:
                self.blurComp.SetEnableGaussianBlur(True)
                self.blurComp.SetGaussianBlurRadius(float(globals().get('_kusug_cb_intensity', 0.6)))
            else:
                self.blurComp.SetEnableGaussianBlur(False)
        except Exception:
            pass

    def set_intensity(self, v):
        if self.blurComp is not None:
            try:
                self.blurComp.SetGaussianBlurRadius(float(v))
            except Exception:
                pass

    def on_push(self, args):
        ns = args.get('namespace') or ''
        if _cb_is_container(ns):
            self.depth[ns] = self.depth.get(ns, 0) + 1
            self.blurred = True
            self.apply_blur(True)

    def on_pop(self, args):
        ns = args.get('namespace') or ''
        if self.depth.get(ns):
            self.depth[ns] -= 1
        if self.blurred and not any(self.depth.values()):
            self.blurred = False
            self.apply_blur(False)

    def shutdown(self):
        self.dead = True
        try:
            self.UnListenAllEvents()
        except Exception:
            pass
        if self.blurComp is not None:
            try:
                self.blurComp.SetEnableGaussianBlur(False)
            except Exception:
                pass

globals()['_kusug_cb_intensity'] = ${(this.intensity / 100).toFixed(2)}
_old = globals().get('_kusug_cb_sys')
if _old is not None:
    try:
        _old.shutdown()
    except Exception:
        pass
globals()['_kusug_cb_sys'] = _KuSugCB('KuSugCB', 'KuSugCBSystem')
`;
	},
	buildSetCode() {
		return `
globals()['_kusug_cb_intensity'] = ${(this.intensity / 100).toFixed(2)}
_s = globals().get('_kusug_cb_sys')
if _s is not None:
    try:
        _s.set_intensity(float(globals()['_kusug_cb_intensity']))
    except Exception:
        pass
`;
	},
	unpatchCode: `
_old = globals().get('_kusug_cb_sys')
if _old is not None:
    try:
        _old.shutdown()
    except Exception:
        pass
    globals()['_kusug_cb_sys'] = None
`,
	onModuleEvent(args) {
		if (argPick(args, "cb_intensity") !== undefined) {
			const n = Number(argPick(args, "cb_intensity"));
			if (!isNaN(n)) {
				this.intensity = Math.max(10, Math.min(100, Math.floor(n)));
				if (this.enabled) { try { app.evalPython(this.buildSetCode()); } catch (e) {} }
			}
		}
		if (!stdToggle(this, args, "容器模糊")) return;
		try { app.evalPython(this.enabled ? this.buildPatchCode() : this.unpatchCode); } catch (e) {}
	}
};

const autoSign = {
	tag: "fun_auto_sign",
	enabled: false,
	text: "",
	pending: [],
	MAX_PENDING: 8,
	TICK_EXPIRE: 200,
	VERIFY_DELAY: 10,
	DUP_TICKS: 5,
	PKT_TICKS: 5,
	tickNow: 0,
	lastEv: { tick: -9999, x: 0, y: 0, z: 0, face: -1 },
	pktUntil: -9999,
	pktSeen: 0,
	FACE_OFF: [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]],
	escape(s) {
		return String(s).split("\\").join("\\\\").split('"').join('\\"');
	},
	buildNbt(x, y, z, hanging, t) {
		const side = '{Text:"' + t + '",SignTextColor:-16777216,IgnoreLighting:0b,PersistFormatting:1b,TextIgnoreLegacyBugResolved:0b}';
		return '{id:"' + (hanging ? "HangingSign" : "Sign") + '",isMovable:1b,x:' + x + ',y:' + y + ',z:' + z + ',TextOwner:"",FrontText:' + side + ',BackText:' + side + '}';
	},
	blockName(dimension, c) {
		try {
			const m = String(dimension.getBlock({ x: c[0], y: c[1], z: c[2] }).getNBT()).match(/name:"([^"]*)"/i);
			return m ? m[1].toLowerCase() : "";
		} catch (e) { return ""; }
	},
	readText(dimension, pos) {
		try {
			const m = String(dimension.getBlockEntity(pos).getNBT()).match(/Text:"([^"]*)"/);
			return m ? m[1] : "";
		} catch (e) { return null; }
	},
	editorOpen() {
		try {
			return /sign/i.test(String(gui.getCurrentScreenName() || ""));
		} catch (e) { return false; }
	},
	write(dimension, p) {
		blockApi.setBlockEntityData(p.pos, this.buildNbt(p.pos.x, p.pos.y, p.pos.z, p.hanging, this.escape(this.text.trim())));
		p.wrote++;
		p.verifyIn = this.VERIFY_DELAY;
	},
	onModuleEvent(args) {
		if (typeof args.AutoSign_Text === "string") this.text = args.AutoSign_Text;
		if (!stdToggle(this, args, "自动告示牌")) return;
		this.pending.length = 0;
	},
	heldSign() {
		try {
			const m = String(player.getLocalPlayer().getCarriedItem().getNBT() || "").match(/name:"([^"]*)"/i);
			return !!m && m[1].toLowerCase().indexOf("sign") >= 0;
		} catch (e) { return false; }
	},
	onPlayerBuildBlockEvent(playerId, x, y, z, face) {
		if (!this.enabled) return false;
		try {
			if (String(playerId) !== String(player.getLocalPlayer().getUniqueID())) return false;
		} catch (e) { return false; }
		const held = this.heldSign();
		if (held && this.tickNow - this.lastEv.tick <= this.DUP_TICKS
			&& this.lastEv.x === x && this.lastEv.y === y && this.lastEv.z === z && this.lastEv.face === face) {
			return true;
		}
		if (held) {
			this.lastEv = { tick: this.tickNow, x, y, z, face };
			this.pktUntil = this.tickNow + this.PKT_TICKS;
			this.pktSeen = 0;
		}
		const cands = [[x, y, z]];
		if (face >= 0 && face <= 5) {
			const f = this.FACE_OFF[face];
			cands.push([x + f[0], y + f[1], z + f[2]]);
		}
		this.pending.push({ cands, pos: null, hanging: false, age: 0, wrote: 0, verifyIn: -1 });
		while (this.pending.length > this.MAX_PENDING) this.pending.shift();
		return false;
	},
	onSendServerPacket(id, name, bin) {
		if (!this.enabled || this.tickNow > this.pktUntil) return false;
		if (!/inventorytransaction/i.test(String(name || ""))) return false;
		this.pktSeen++;
		if (this.pktSeen === 1) return false;
		return true;
	},
	onTick() {
		this.tickNow++;
		if (!this.enabled || !this.pending.length) return;
		let dimension = null;
		try { dimension = player.getLocalPlayer().getDimension(); } catch (e) {}
		if (!dimension) return;
		const editing = this.editorOpen();
		const t = this.text.trim();
		const keep = [];
		for (const p of this.pending) {
			p.age++;
			if (p.age > this.TICK_EXPIRE) continue;
			if (!p.pos) {
				for (const c of p.cands) {
					const nm = this.blockName(dimension, c);
					if (nm.indexOf("sign") >= 0) {
						p.pos = { x: c[0], y: c[1], z: c[2] };
						p.hanging = nm.indexOf("hanging") >= 0;
						break;
					}
				}
				if (!p.pos) { keep.push(p); continue; }
			}
			if (p.verifyIn >= 0) {
				p.verifyIn--;
				if (p.verifyIn > 0) { keep.push(p); continue; }
				const cur = this.readText(dimension, p.pos);
				if (cur === null || cur !== "" || p.wrote >= 2) continue;
				if (editing) { p.verifyIn = 1; keep.push(p); continue; }
				if (!t) continue;
				this.write(dimension, p);
				keep.push(p);
				continue;
			}
			if (editing) { keep.push(p); continue; }
			const cur = this.readText(dimension, p.pos);
			if (cur === null) { keep.push(p); continue; }
			if (cur !== "") continue;
			if (!t) continue;
			this.write(dimension, p);
			keep.push(p);
		}
		this.pending = keep;
	}
};

// >>> Z1YR_PANEL_BEGIN (gen_z1yr_panel.py 生成, 勿手改)
const Z1_MCP_FILE = "z1yrScripts.mcp";
const MCP_PY = `# -*- coding: utf-8 -*-
import os
import re
import sys

try:
    _UNI = unicode
except NameError:
    _UNI = str


def _kapi():
    import mod.client.extraClientApi as c
    return c


def _knotify():
    try:
        import _notify as n
        if hasattr(n, 'add_mod_mcp'):
            return n
    except Exception:
        pass
    import minecraft.notify as n
    return n


def _keu():
    try:
        import mod.common.eventUtil as e
    except Exception:
        from common import eventUtil as e
    return e.instance


def _kreg():
    try:
        from common.system.systemRegister import client as r
        return r
    except Exception:
        pass
    try:
        import common.system.systemRegister as sr
        return getattr(sr, 'client', None)
    except Exception:
        return None


def _kep(p):
    if sys.version_info[0] >= 3:
        return p
    if isinstance(p, _UNI):
        return p.encode('utf-8', 'replace')
    return p


def _ku(s):
    if sys.version_info[0] >= 3:
        return s
    if isinstance(s, str):
        return s.decode('utf-8', 'replace')
    return s


def _kerr(e):
    try:
        return _ku(str(e))
    except Exception:
        return repr(e)


def _kstate():
    import __main__
    s = getattr(__main__, '_KUSUG_MCP_STATE', None)
    if s is None:
        s = {'loaded': {}, 'bound': set(), 'tick': None}
        __main__._KUSUG_MCP_STATE = s
    return s


def _ktakes_arg(func):
    code = getattr(func, '__code__', None)
    if code is None:
        im = getattr(func, 'im_func', None)
        if im is not None:
            code = getattr(im, 'func_code', None)
    if code is None:
        return True
    n = getattr(code, 'co_argcount', 1)
    if getattr(func, '__self__', None) is not None or getattr(func, 'im_self', None) is not None:
        n = max(0, n - 1)
    return n > 0


def _kcall(func, args):
    if _ktakes_arg(func):
        func(args if args is not None else {})
    else:
        func()


def _kdispatch(ev, args):
    s = _kstate()
    for p in list(s['loaded'].keys()):
        ent = s['loaded'].get(p)
        if not ent:
            continue
        for e2, f2 in list(ent['recs']):
            if e2 != ev:
                continue
            try:
                _kcall(f2, args)
            except Exception:
                pass


def _kdrain():
    s = _kstate()
    q = s.get('chatqueue')
    if not q:
        return 0
    s['chatqueue'] = []
    n = 0
    for fn, arg, rp in q:
        try:
            res = fn(arg)
        except Exception as e:
            try:
                res = 'err:' + _kerr(e)
            except Exception:
                res = 'err:?'
        n += 1
        try:
            import io
            fq = io.open(rp, 'w', encoding='utf-8')
            fq.write(_UNI(res))
            fq.close()
        except Exception:
            pass
    return n


class _KTick(object):
    def on_tick(self, args=None):
        _kdispatch('OnScriptTickClient', {})
        _kdrain()


class _KListener(object):
    def __init__(self, ev):
        self.ev = ev

    def on_event(self, args=None):
        _kdispatch(self.ev, args)


class _KCapture(object):
    def __init__(self):
        self.recs = []
        self.systems = []
        self.patched = []
        self.base_cls = None
        self.base_orig = None
        self.reg_orig = None

    def make_listen(self):
        def _cap(system, namespace, system_name, event_name, instance, func):
            self.recs.append((event_name, func))
        return _cap

    def patch_cls(self, cls_path):
        mp, _, cn = cls_path.rpartition('.')
        if not mp or not cn:
            return
        try:
            mod = __import__(mp, fromlist=[''])
            cls = getattr(mod, cn, None)
        except Exception:
            return
        if cls is None:
            return
        for c0, _o in self.patched:
            if c0 is cls:
                return
        orig = getattr(cls, 'ListenForEvent', None)
        if orig is None:
            return
        cls.ListenForEvent = self.make_listen()
        self.patched.append((cls, orig))

    def begin(self):
        try:
            api = _kapi()
        except Exception:
            return
        try:
            cls = api.GetClientSystemCls()
            orig = getattr(cls, 'ListenForEvent', None)
            if orig is not None:
                cls.ListenForEvent = self.make_listen()
                self.base_cls = cls
                self.base_orig = orig
        except Exception:
            pass
        reg = getattr(api, 'RegisterSystem', None)
        if reg is not None:
            self.reg_orig = reg
            cap = self

            def _rec_register(namespace, system_name, cls_path):
                cap.systems.append((namespace, system_name))
                cap.patch_cls(cls_path)
                return cap.reg_orig(namespace, system_name, cls_path)
            try:
                api.RegisterSystem = _rec_register
            except Exception:
                self.reg_orig = None

    def end(self):
        if self.base_cls is not None:
            try:
                self.base_cls.ListenForEvent = self.base_orig
            except Exception:
                pass
            self.base_cls = None
            self.base_orig = None
        for c0, o0 in self.patched:
            try:
                c0.ListenForEvent = o0
            except Exception:
                pass
        self.patched = []
        if self.reg_orig is not None:
            try:
                _kapi().RegisterSystem = self.reg_orig
            except Exception:
                pass
            self.reg_orig = None


def _kpost_load(systems, instances):
    called = []
    objs = list(instances)
    try:
        api = _kapi()
    except Exception:
        api = None
    for ns, sn in systems:
        so = None
        if api is not None:
            try:
                so = api.GetSystem(ns, sn)
            except Exception:
                so = None
        if so is None:
            reg = _kreg()
            if reg is not None:
                key = ns + ':' + sn
                so = getattr(reg, 'systemInstances', {}).get(key)
                if so is None:
                    so = getattr(reg, 'newSystemInstances', {}).get(key)
        if so is not None:
            objs.append(so)
            try:
                _kstate().setdefault('sysmap', {})[ns + ':' + sn] = so
            except Exception:
                pass
    names = ('uiinitfinished', 'loadclientaddonscriptsafter')
    keys = ('uiinit', 'loadclientaddonscriptsafter')
    for so in objs:
        try:
            nl = getattr(so, 'nameToListenEvents', {})
            for ev, el in list(nl.items()):
                if str(ev).lower() not in names:
                    continue
                for e in list(el):
                    try:
                        f = getattr(e, 'funcName', None)
                        if f is None:
                            continue
                        if getattr(f, '__self__', None) is None and getattr(f, 'im_self', None) is None:
                            inst = getattr(e, 'instance', None)
                            if inst is not None:
                                f = getattr(inst, getattr(f, '__name__', ''), f)
                        if f in called:
                            continue
                        _kcall(f, {})
                        called.append(f)
                    except Exception:
                        pass
        except Exception:
            pass
        for k in dir(so):
            lk = k.lower()
            hit = False
            for m in keys:
                if m in lk:
                    hit = True
                    break
            if not hit:
                continue
            f = getattr(so, k)
            if not callable(f) or f in called:
                continue
            try:
                _kcall(f, {})
                called.append(f)
            except Exception:
                pass


def _kattach():
    s = _kstate()
    try:
        eu = _keu()
    except Exception:
        return
    if s['tick'] is None:
        t = _KTick()
        try:
            eu.ListenForEngineClient('OnScriptTickClient', t, t.on_tick, 10)
            s['tick'] = t
        except Exception:
            return
    skip = ('UiInitFinished', 'LoadClientAddonScriptsAfter', 'OnScriptTickClient')
    seen = {}
    for p in list(s['loaded'].keys()):
        ent = s['loaded'].get(p)
        if not ent:
            continue
        for ev, f in ent['recs']:
            if ev in skip or ev in s['bound'] or ev in seen:
                continue
            seen[ev] = True
            l = _KListener(ev)
            try:
                eu.ListenForEngineClient(ev, l, l.on_event, 10)
                s['bound'].add(ev)
            except Exception:
                pass


def _knorm(p):
    return os.path.normcase(os.path.normpath(p))


def _kunreg(ns, sn):
    reg = _kreg()
    if reg is None:
        return
    try:
        reg.UnRegisterSystem(ns, sn)
    except Exception:
        pass
    key = ns + ':' + sn
    try:
        _kstate().get('sysmap', {}).pop(key, None)
    except Exception:
        pass
    try:
        reg.systemInstances.pop(key, None)
    except Exception:
        pass
    inst = None
    try:
        inst = reg.newSystemInstances.pop(key, None)
    except Exception:
        pass
    if inst is not None:
        for m in ('DestroyEvents', 'Destroy'):
            try:
                getattr(inst, m)()
            except Exception:
                pass
    try:
        reg.deleteSystemInstances.discard(key)
    except Exception:
        pass


def _kunload(path):
    s = _kstate()
    ent = s['loaded'].pop(path, None)
    if ent is None:
        return
    for ns, sn in ent['systems']:
        _kunreg(ns, sn)
    name = ent['name']
    for mn in ent.get('aliases', []):
        try:
            v = sys.modules.get(mn)
            if v is not None and (getattr(v, '__name__', '') or '').startswith(name + '.'):
                del sys.modules[mn]
        except Exception:
            pass
    for mn in [m for m in list(sys.modules) if m == name or m.startswith(name + '.')]:
        try:
            del sys.modules[mn]
        except Exception:
            pass
    np = _knorm(path)
    for p in list(sys.path):
        try:
            if _knorm(p) == np:
                sys.path.remove(p)
        except Exception:
            pass
    try:
        _knotify().remove_mod_mcp(_kep(path))
    except Exception:
        pass
    cache = getattr(sys, 'path_importer_cache', None)
    if cache is not None:
        for k in list(cache):
            try:
                if _knorm(k) == np:
                    del cache[k]
            except Exception:
                pass
    try:
        sys.module_paths.clear()
    except Exception:
        pass


def _kload(path):
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        raise Exception(_kep(u'文件不存在'))
    base = os.path.basename(path)
    name = base[:-4] if base.lower().endswith('.mcp') else os.path.splitext(base)[0]
    if not re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', name):
        raise Exception(_kep(u'文件名需为英文数字下划线'))
    s = _kstate()
    if path in s['loaded']:
        _kunload(path)
    notify = _knotify()
    notify.add_mod_mcp(_kep(path))
    np = _knorm(path)
    for p in list(sys.path):
        try:
            if _knorm(p) == np:
                sys.path.remove(p)
        except Exception:
            pass
    sys.path.insert(0, path)
    cap = _KCapture()
    cap.begin()
    instances = []
    errors = []
    try:
        try:
            mod = __import__(name + '.modMain', fromlist=[''])
        except Exception:
            low = name.lower()
            if low == name:
                raise
            name = low
            mod = __import__(name + '.modMain', fromlist=[''])
        for mk in dir(mod):
            cls = getattr(mod, mk)
            if not hasattr(cls, 'MOD_NAME'):
                continue
            try:
                inst = cls()
            except Exception as e:
                errors.append(mk + '(): ' + _kerr(e))
                continue
            instances.append(inst)
            for ck in dir(inst):
                f = getattr(inst, ck)
                if not hasattr(f, 'InitClient'):
                    continue
                try:
                    f()
                except Exception as e:
                    errors.append(mk + '.' + ck + ': ' + _kerr(e))
        # 包内顶层绝对 import 兼容(如 z1yr 的 from module.config import ...):
        # 把内层模块映射到顶层, 与原生环境一致(不覆盖已存在的同名模块)
        aliases = []
        for mn in list(sys.modules):
            if mn.startswith(name + '.'):
                alias = mn[len(name) + 1:]
                if alias and alias not in sys.modules:
                    try:
                        sys.modules[alias] = sys.modules[mn]
                        aliases.append(alias)
                    except Exception:
                        pass
    except Exception as e:
        cap.end()
        try:
            notify.remove_mod_mcp(_kep(path))
        except Exception:
            pass
        for p in list(sys.path):
            try:
                if _knorm(p) == np:
                    sys.path.remove(p)
            except Exception:
                pass
        raise Exception(_kep(u'导入失败: ' + _kerr(e)))
    cap.end()
    s['loaded'][path] = {'name': name, 'systems': cap.systems, 'recs': cap.recs, 'aliases': aliases}
    _kpost_load(cap.systems, instances)
    _kattach()
    msg = _ku(name) + u' 事件' + _ku(str(len(cap.recs))) + u'个'
    if errors:
        msg += u' 警告:' + errors[0][:24]
    return msg


def _klist():
    s = _kstate()
    out = []
    for p, ent in s['loaded'].items():
        out.append(_ku(ent['name']))
    return '|'.join(out)


def _kunload_all():
    s = _kstate()
    for p in list(s['loaded'].keys()):
        _kunload(p)


try:
    _ZU = unicode
except NameError:
    _ZU = str


def _zapi():
    try:
        import mod.client.extraClientApi as c
        return c
    except Exception:
        return None


def _zreg():
    try:
        from common.system.systemRegister import client as r
        return r
    except Exception:
        pass
    try:
        import common.system.systemRegister as sr
        return getattr(sr, 'client', None)
    except Exception:
        return None


def _zsys():
    import __main__ as m2
    st = getattr(m2, '_KUSUG_MCP_STATE', None)
    if st:
        so = st.get('sysmap', {}).get('z1yr:Z1yrClientSystem')
        if so is not None:
            return so
    try:
        a = _zapi()
        if a is not None:
            so = a.GetSystem('z1yr', 'Z1yrClientSystem')
            if so is not None:
                return so
    except Exception:
        pass
    r = _zreg()
    if r is None:
        return None
    try:
        so = getattr(r, 'systemInstances', {}).get('z1yr:Z1yrClientSystem')
        if so is None:
            so = getattr(r, 'newSystemInstances', {}).get('z1yr:Z1yrClientSystem')
        if so is not None:
            return so
        for d in (getattr(r, 'systemInstances', {}), getattr(r, 'newSystemInstances', {})):
            for k, v in list(d.items()):
                if hasattr(v, '_manager') and hasattr(v, 'thisPlayer'):
                    return v
    except Exception:
        pass
    return None


def _zmod(n):
    s = _zsys()
    if s is None:
        return None
    try:
        m = getattr(s, '_manager', None)
        if m is None:
            return None
        try:
            return m.get(n)
        except Exception:
            return getattr(m, '_modules', {}).get(n)
    except Exception:
        return None


def _zerr(e):
    try:
        return str(e)[:60]
    except Exception:
        return '?'


def _zwrite(rp, s):
    try:
        import io
        if not isinstance(s, _ZU):
            try:
                s = s.decode('utf-8', 'replace')
            except Exception:
                s = _ZU(s)
        f = io.open(rp, 'w', encoding='utf-8')
        f.write(s)
        f.close()
    except Exception:
        pass


def _zstateall(rp):
    s = _zsys()
    out = []
    if s is not None:
        m = getattr(s, '_manager', None)
        d = getattr(m, '_modules', {}) if m is not None else {}
        for k in sorted(d):
            out.append(k + '=' + ('1' if getattr(d[k], 'enabled', False) else '0'))
        out.append('notification=' + ('1' if getattr(s, 'notification', False) else '0'))
    _zwrite(rp, ';'.join(out) if out else 'none')


# tick queue: evalPython context swallows engine calls, so all control runs in the game tick.
# item = (fn, arg, rp); core _KTick.on_tick drains in main loop and writes receipts.

def _zchatfire(cmd):
    n = 0
    err = ''
    import __main__ as m2
    s = getattr(m2, '_KUSUG_MCP_STATE', None)
    if s:
        for p, ent in list(s.get('loaded', {}).items()):
            for e2, f2 in list(ent.get('recs', [])):
                if e2 != 'ClickChatSendClientEvent':
                    continue
                try:
                    f2({'message': cmd})
                    n += 1
                except TypeError:
                    try:
                        f2()
                        n += 1
                    except Exception as e:
                        if not err:
                            err = _zerr(e)
                except Exception as e:
                    if not err:
                        err = _zerr(e)
    return str(n) + ('|err:' + err if err else '')


def _zsetfire(nw):
    n, want = nw
    o = _zmod(n)
    if o is None:
        return 'missing'
    try:
        if want:
            o.enable()
        else:
            o.disable()
        return '1' if getattr(o, 'enabled', False) else '0'
    except Exception as e:
        return 'err:' + _zerr(e)


def _ztogfire(n):
    o = _zmod(n)
    if o is None:
        return 'missing'
    try:
        o.toggle()
        return '1' if getattr(o, 'enabled', False) else '0'
    except Exception as e:
        return 'err:' + _zerr(e)


def _zqueue(item):
    import __main__ as m2
    s = getattr(m2, '_KUSUG_MCP_STATE', None)
    if s is None:
        s = {'loaded': {}, 'bound': set(), 'tick': None}
        m2._KUSUG_MCP_STATE = s
    if s.get('tick') is None:
        for fn in (globals().get('_kattach'), getattr(m2, '_kattach', None)):
            if fn is None:
                continue
            try:
                fn()
                break
            except Exception:
                pass
    s.setdefault('chatqueue', []).append(item)


def _zchatq(cmd, rp):
    _zqueue((_zchatfire, cmd, rp))


def _zsetq(n, want, rp):
    _zqueue((_zsetfire, (n, want), rp))


def _ztogq(n, rp):
    _zqueue((_ztogfire, n, rp))


def _zcfgfire(nkv):
    n, k, vs = nkv
    o = _zmod(n)
    if o is None:
        return 'missing'
    fn = getattr(o, 'apply_config', None)
    if fn is None:
        return 'err:noapply'
    try:
        fn(k, vs)
        return 'ok'
    except Exception as e:
        return 'err:' + _zerr(e)


def _zcfgq(n, k, vs, rp):
    _zqueue((_zcfgfire, (n, k, vs), rp))


_ZCFGS = (
    'z1n_killaura_multi_limit|killaura|multi_limit|multi_limit|int',
    'z1n_aimbot_speed|aimbot|speed|speed|num',
    'z1n_aimbot_yoffset|aimbot|yoffset|y_offset|num',
    'z1n_triggerbot_range|triggerbot|range|range|num',
    'z1n_triggerbot_fov|triggerbot|fov|fov|int',
    'z1n_triggerbot_cps|triggerbot|cps|cps|int',
    'z1n_criticals_sneakdelay|criticals|sneakdelay|sneak_delay|num',
    'z1n_criticals_clickspan|criticals|clickspan|click_span|num',
    'z1n_autoclicker_cpsmin|autoclicker|cps_min|cps_min|int',
    'z1n_autoclicker_cpsmax|autoclicker|cps_max|cps_max|int',
    'z1n_autorod_switchdelay|autorod|switchdelay|switch_delay|int',
    'z1n_autorod_range|autorod|range|range|int',
    'z1n_autosoup_health|autosoup|health|health|int',
    'z1n_autosoup_delay|autosoup|delay|delay|int',
    'z1n_combatbot_trackrange|combatbot|track_range|track_range|int',
    'z1n_combatbot_attackrange|combatbot|attack_range|attack_range|num',
    'z1n_combatbot_keepdist|combatbot|keep_distance|keep_distance|num',
    'z1n_combatbot_healhp|combatbot|heal_hp|heal_hp|int',
    'z1n_combatbot_healkeep|combatbot|heal_keep_distance|heal_keep_distance|int',
    'z1n_kbchange_yaw|kbchange|yaw|yaw|int',
    'z1n_kbchange_range|kbchange|range|range|num',
    'z1n_ridetpaura_range|ridetpaura|range|range|int',
    'z1n_bhop_fallspeed|bhop|fallspeed|fall_speed|num',
    'z1n_bhop_speed|bhop|speed|speed|num',
    'z1n_ridebhop_speed|ridebhop|speed|speed|num',
    'z1n_ridebhop_ymotion|ridebhop|ymotion|ymotion|num',
    'z1n_scaffold_radius|scaffold|radius|radius|int',
    'z1n_autotool_switchtick|autotool|switchtick|switch_tick|int',
    'z1n_autotool_restoretick|autotool|restoretick|restore_tick|int',
    'z1n_blockin_speed|blockin|speed|speed|int',
    'z1n_autotrap_range|autotrap|range|range|num',
    'z1n_autoweb_delay|autoweb|delay|delay|num',
    'z1n_nobreakdelay_restarttick|nobreakdelay|restarttick|restart_tick|int',
    'z1n_nobreakdelay_aimconfirmticks|nobreakdelay|aimconfirmticks|aim_confirm_ticks|int',
    'z1n_fucker_range|fucker|range|range|num',
    'z1n_fucker_scaninterval|fucker|scan_interval|scan_interval|int',
    'z1n_zoom_fov|zoom|fov|fov|int',
    'z1n_zoom_smooth|zoom|speed|smooth_speed|num',
    'z1n_gaussblur_intensity|gaussblur|intensity|intensity|num',
    'z1n_fogchange_density|fogchange|density|density|int',
    'z1n_fogchange_r|fogchange|color_r|color_r|num',
    'z1n_fogchange_g|fogchange|color_g|color_g|num',
    'z1n_fogchange_b|fogchange|color_b|color_b|num',
    'z1n_esp_smooth|esp|smooth_factor|smooth_factor|num',
    'z1n_esp_predict|esp|predict_ticks|predict_ticks|num',
    'z1n_esp_chestradius|esp|chest_scan_radius|chest_scan_radius|int',
    'z1n_esp_r|esp|color_r|color_r|num',
    'z1n_esp_g|esp|color_g|color_g|num',
    'z1n_esp_b|esp|color_b|color_b|num',
    'z1n_hud_range|hud|range|range|num',
    'z1n_hud_fov|hud|fov|fov|int',
    'z1n_pyrpc_maxdisplay|pyrpc|maxdisplay|maxDisplay|int',
    'z1n_whitelist_range|whitelist|range|range|num',
    'z1n_invisible_restoredelay|invisible|restoredelay|restore_delay|num',
    'z1n_rodaim_range|rodaim|range|aim_range|num',
    'z1n_rodaim_fov|rodaim|fov|fov|int',
    'z1n_noclip_speed|noclip|speed|speed|num',
    'z1c_killaura_onweapon|killaura|onweapon|onweapon|bool',
    'z1c_killaura_onhold|killaura|onhold|onhold|bool',
    'z1c_killaura_onholdattack|killaura|onholdattack|onholdattack|bool',
    'z1c_killaura_ecbypass|killaura|ecbypass|ecbypass|bool',
    'z1c_aimbot_onclick|aimbot|onclick|onclick|bool',
    'z1c_aimbot_onhold|aimbot|onhold|onhold|bool',
    'z1c_aimbot_onweapon|aimbot|onweapon|onweapon|bool',
    'z1c_aimbot_leftclick|aimbot|leftclick|leftclick|bool',
    'z1c_aimbot_sticky|aimbot|sticky|sticky|bool',
    'z1c_triggerbot_onweapon|triggerbot|onweapon|onweapon|bool',
    'z1c_triggerbot_ignoreteammates|triggerbot|ignoreteammates|ignore_teammates|bool',
    'z1c_triggerbot_throughwalls|triggerbot|throughwalls|through_walls|bool',
    'z1c_triggerbot_leftclick|triggerbot|leftclick|leftclick|bool',
    'z1c_criticals_onclick|criticals|onclick|onclick|bool',
    'z1c_criticals_onweapon|criticals|onweapon|onweapon|bool',
    'z1c_criticals_onsneak|criticals|onsneak|onsneak|bool',
    'z1c_criticals_onhold|criticals|onhold|onhold|bool',
    'z1c_autoclicker_swingair|autoclicker|swingair|swing_air|bool',
    'z1c_autoclicker_ecbypass|autoclicker|ecbypass|ecbypass|bool',
    'z1c_autorod_canattack|autorod|canattack|can_attack|bool',
    'z1c_autorod_silentswitch|autorod|silentswitch|silent_switch|bool',
    'z1c_combatbot_criticals|combatbot|criticals|criticals|bool',
    'z1c_combatbot_sprint|combatbot|sprint|sprint|bool',
    'z1c_kbchange_ecbypass|kbchange|ecbypass|ecbypass|bool',
    'z1c_kbchange_movefix|kbchange|movefix|movefix|bool',
    'z1c_ridetpaura_onweapon|ridetpaura|onweapon|onweapon|bool',
    'z1c_scaffold_airplace|scaffold|airplace|airplace|bool',
    'z1c_fucker_onholdbreak|fucker|onholdbreak|onholdbreak|bool',
    'z1c_esp_teambox|esp|teambox|teambox|bool',
    'z1c_esp_chestesp|esp|chest_esp|chest_esp|bool',
    'z1c_esp_chestfov|esp|chest_fov|chest_fov|bool',
    'z1c_hud_targethud|hud|targethud|targethud|bool',
    'z1c_hud_bjd|hud|bjd|bjd|bool',
    'z1c_pyrpc_decode|pyrpc|decode|decode|bool',
    'z1c_pyrpc_showmessage|pyrpc|showmessage|showMessage|bool',
    'z1c_whitelist_midclick|whitelist|midclick|midclick|bool',
    'z1c_list_send|list|send|send|bool',
    'z1c_rodaim_onhold|rodaim|onhold|onhold|bool',
    'z1c_xray_ore_diamond|xray|diamond|ore:diamond|bool',
    'z1c_xray_ore_iron|xray|iron|ore:iron|bool',
    'z1c_xray_ore_gold|xray|gold|ore:gold|bool',
    'z1c_xray_ore_emerald|xray|emerald|ore:emerald|bool',
    'z1c_xray_ore_debris|xray|debris|ore:debris|bool',
    'z1c_xray_ore_redstone|xray|redstone|ore:redstone|bool',
    'z1c_xray_ore_lapis|xray|lapis|ore:lapis|bool',
    'z1c_xray_ore_coal|xray|coal|ore:coal|bool',
    'z1c_xray_ore_copper|xray|copper|ore:copper|bool',
    'z1c_xray_ore_quartz|xray|quartz|ore:quartz|bool',
    'z1r_killaura_weaponmode|killaura|weaponmode|weapon_mode|enum',
    'z1r_killaura_attackmode|killaura|attack_mode|attack_mode|enum',
    'z1r_killaura_priority|killaura|priority|priority|enum',
    'z1r_aimbot_mode|aimbot|mode|mode|enum',
    'z1r_rodaim_mode|rodaim|mode|mode|enum',
    'z1r_antibot_mode|antibot|mode|mode|enum',
    'z1r_kbchange_mode|kbchange|mode|mode|enum',
    'z1r_kbchange_cameramode|kbchange|camera_mode|camera_mode|enum',
    'z1r_bhop_mode|bhop|mode|mode|enum',
    'z1r_inventorywalk_mode|inventorywalk|mode|mode|enum',
    'z1r_scaffold_switchmode|scaffold|switchmode|switchmode|enum',
    'z1r_fucker_mode|fucker|mode|mode|enum',
    'z1r_fucker_rotation|fucker|rotation|rotation|enum',
    'z1r_esp_espmode|esp|esp_mode|esp_mode|enum',
    'z1r_team_mode|team|mode|mode|enum',
    'z1r_crasher_mode|crasher|mode|mode|enum',
    'z1r_ridetpaura_attackmode|ridetpaura|attack_mode|attack_mode|enum',
    'z1r_ridetpaura_priority|ridetpaura|priority|priority|enum',
    'z1r_autorod_restoremode|autorod|restoremode|restore_mode|enum',
)


def _zcfgall(rp):
    s = _zsys()
    out = []
    if s is not None:
        m = getattr(s, '_manager', None)
        for ln in _ZCFGS:
            p5 = ln.split('|')
            if len(p5) != 5:
                continue
            ctl, n, k, at, ty = p5
            o = None
            if m is not None:
                try:
                    o = m.get(n)
                except Exception:
                    o = None
            if o is None:
                continue
            try:
                if at[:4] == 'ore:':
                    v = o.get_ore(at[4:])
                else:
                    v = getattr(o, at, None)
                if v is None:
                    vs = 'inf'
                elif ty == 'bool':
                    vs = 'true' if v else 'false'
                elif ty == 'enum':
                    vs = str(v)
                elif isinstance(v, float):
                    vs = '%g' % v
                else:
                    vs = str(v)
                out.append(ctl + '=' + vs)
            except Exception:
                pass
    _zwrite(rp, ';'.join(out) if out else 'none')


def _zloadfire(path):
    import __main__ as m2
    try:
        msg = m2.KUSUG_MCP['load'](path)
        return 'ok:' + str(msg)[:60]
    except Exception as e:
        return 'err:' + _zerr(e)


def _zload(path, rp):
    _zqueue((_zloadfire, path, rp))


def _zexitfire(unused):
    import __main__ as m2
    try:
        m2.KUSUG_MCP['unload_all']()
        return 'ok'
    except Exception as e:
        return 'err:' + _zerr(e)


def _zexit(rp):
    _zqueue((_zexitfire, None, rp))


import __main__
__main__.KUSUG_MCP = {'load': _kload, 'unload': _kunload, 'unload_all': _kunload_all, 'list': _klist, 'drain': _kdrain, 'z1stateall': _zstateall, 'z1chatq': _zchatq, 'z1setq': _zsetq, 'ztogq': _ztogq, 'z1cfgq': _zcfgq, 'z1cfgall': _zcfgall, 'z1load': _zload, 'z1exit': _zexit}
`;
const Z1_TOPUP_PY = `try:
    _ZU = unicode
except NameError:
    _ZU = str


def _zapi():
    try:
        import mod.client.extraClientApi as c
        return c
    except Exception:
        return None


def _zreg():
    try:
        from common.system.systemRegister import client as r
        return r
    except Exception:
        pass
    try:
        import common.system.systemRegister as sr
        return getattr(sr, 'client', None)
    except Exception:
        return None


def _zsys():
    import __main__ as m2
    st = getattr(m2, '_KUSUG_MCP_STATE', None)
    if st:
        so = st.get('sysmap', {}).get('z1yr:Z1yrClientSystem')
        if so is not None:
            return so
    try:
        a = _zapi()
        if a is not None:
            so = a.GetSystem('z1yr', 'Z1yrClientSystem')
            if so is not None:
                return so
    except Exception:
        pass
    r = _zreg()
    if r is None:
        return None
    try:
        so = getattr(r, 'systemInstances', {}).get('z1yr:Z1yrClientSystem')
        if so is None:
            so = getattr(r, 'newSystemInstances', {}).get('z1yr:Z1yrClientSystem')
        if so is not None:
            return so
        for d in (getattr(r, 'systemInstances', {}), getattr(r, 'newSystemInstances', {})):
            for k, v in list(d.items()):
                if hasattr(v, '_manager') and hasattr(v, 'thisPlayer'):
                    return v
    except Exception:
        pass
    return None


def _zmod(n):
    s = _zsys()
    if s is None:
        return None
    try:
        m = getattr(s, '_manager', None)
        if m is None:
            return None
        try:
            return m.get(n)
        except Exception:
            return getattr(m, '_modules', {}).get(n)
    except Exception:
        return None


def _zerr(e):
    try:
        return str(e)[:60]
    except Exception:
        return '?'


def _zwrite(rp, s):
    try:
        import io
        if not isinstance(s, _ZU):
            try:
                s = s.decode('utf-8', 'replace')
            except Exception:
                s = _ZU(s)
        f = io.open(rp, 'w', encoding='utf-8')
        f.write(s)
        f.close()
    except Exception:
        pass


def _zstateall(rp):
    s = _zsys()
    out = []
    if s is not None:
        m = getattr(s, '_manager', None)
        d = getattr(m, '_modules', {}) if m is not None else {}
        for k in sorted(d):
            out.append(k + '=' + ('1' if getattr(d[k], 'enabled', False) else '0'))
        out.append('notification=' + ('1' if getattr(s, 'notification', False) else '0'))
    _zwrite(rp, ';'.join(out) if out else 'none')


# tick queue: evalPython context swallows engine calls, so all control runs in the game tick.
# item = (fn, arg, rp); core _KTick.on_tick drains in main loop and writes receipts.

def _zchatfire(cmd):
    n = 0
    err = ''
    import __main__ as m2
    s = getattr(m2, '_KUSUG_MCP_STATE', None)
    if s:
        for p, ent in list(s.get('loaded', {}).items()):
            for e2, f2 in list(ent.get('recs', [])):
                if e2 != 'ClickChatSendClientEvent':
                    continue
                try:
                    f2({'message': cmd})
                    n += 1
                except TypeError:
                    try:
                        f2()
                        n += 1
                    except Exception as e:
                        if not err:
                            err = _zerr(e)
                except Exception as e:
                    if not err:
                        err = _zerr(e)
    return str(n) + ('|err:' + err if err else '')


def _zsetfire(nw):
    n, want = nw
    o = _zmod(n)
    if o is None:
        return 'missing'
    try:
        if want:
            o.enable()
        else:
            o.disable()
        return '1' if getattr(o, 'enabled', False) else '0'
    except Exception as e:
        return 'err:' + _zerr(e)


def _ztogfire(n):
    o = _zmod(n)
    if o is None:
        return 'missing'
    try:
        o.toggle()
        return '1' if getattr(o, 'enabled', False) else '0'
    except Exception as e:
        return 'err:' + _zerr(e)


def _zqueue(item):
    import __main__ as m2
    s = getattr(m2, '_KUSUG_MCP_STATE', None)
    if s is None:
        s = {'loaded': {}, 'bound': set(), 'tick': None}
        m2._KUSUG_MCP_STATE = s
    if s.get('tick') is None:
        for fn in (globals().get('_kattach'), getattr(m2, '_kattach', None)):
            if fn is None:
                continue
            try:
                fn()
                break
            except Exception:
                pass
    s.setdefault('chatqueue', []).append(item)


def _zchatq(cmd, rp):
    _zqueue((_zchatfire, cmd, rp))


def _zsetq(n, want, rp):
    _zqueue((_zsetfire, (n, want), rp))


def _ztogq(n, rp):
    _zqueue((_ztogfire, n, rp))


def _zcfgfire(nkv):
    n, k, vs = nkv
    o = _zmod(n)
    if o is None:
        return 'missing'
    fn = getattr(o, 'apply_config', None)
    if fn is None:
        return 'err:noapply'
    try:
        fn(k, vs)
        return 'ok'
    except Exception as e:
        return 'err:' + _zerr(e)


def _zcfgq(n, k, vs, rp):
    _zqueue((_zcfgfire, (n, k, vs), rp))


_ZCFGS = (
    'z1n_killaura_multi_limit|killaura|multi_limit|multi_limit|int',
    'z1n_aimbot_speed|aimbot|speed|speed|num',
    'z1n_aimbot_yoffset|aimbot|yoffset|y_offset|num',
    'z1n_triggerbot_range|triggerbot|range|range|num',
    'z1n_triggerbot_fov|triggerbot|fov|fov|int',
    'z1n_triggerbot_cps|triggerbot|cps|cps|int',
    'z1n_criticals_sneakdelay|criticals|sneakdelay|sneak_delay|num',
    'z1n_criticals_clickspan|criticals|clickspan|click_span|num',
    'z1n_autoclicker_cpsmin|autoclicker|cps_min|cps_min|int',
    'z1n_autoclicker_cpsmax|autoclicker|cps_max|cps_max|int',
    'z1n_autorod_switchdelay|autorod|switchdelay|switch_delay|int',
    'z1n_autorod_range|autorod|range|range|int',
    'z1n_autosoup_health|autosoup|health|health|int',
    'z1n_autosoup_delay|autosoup|delay|delay|int',
    'z1n_combatbot_trackrange|combatbot|track_range|track_range|int',
    'z1n_combatbot_attackrange|combatbot|attack_range|attack_range|num',
    'z1n_combatbot_keepdist|combatbot|keep_distance|keep_distance|num',
    'z1n_combatbot_healhp|combatbot|heal_hp|heal_hp|int',
    'z1n_combatbot_healkeep|combatbot|heal_keep_distance|heal_keep_distance|int',
    'z1n_kbchange_yaw|kbchange|yaw|yaw|int',
    'z1n_kbchange_range|kbchange|range|range|num',
    'z1n_ridetpaura_range|ridetpaura|range|range|int',
    'z1n_bhop_fallspeed|bhop|fallspeed|fall_speed|num',
    'z1n_bhop_speed|bhop|speed|speed|num',
    'z1n_ridebhop_speed|ridebhop|speed|speed|num',
    'z1n_ridebhop_ymotion|ridebhop|ymotion|ymotion|num',
    'z1n_scaffold_radius|scaffold|radius|radius|int',
    'z1n_autotool_switchtick|autotool|switchtick|switch_tick|int',
    'z1n_autotool_restoretick|autotool|restoretick|restore_tick|int',
    'z1n_blockin_speed|blockin|speed|speed|int',
    'z1n_autotrap_range|autotrap|range|range|num',
    'z1n_autoweb_delay|autoweb|delay|delay|num',
    'z1n_nobreakdelay_restarttick|nobreakdelay|restarttick|restart_tick|int',
    'z1n_nobreakdelay_aimconfirmticks|nobreakdelay|aimconfirmticks|aim_confirm_ticks|int',
    'z1n_fucker_range|fucker|range|range|num',
    'z1n_fucker_scaninterval|fucker|scan_interval|scan_interval|int',
    'z1n_zoom_fov|zoom|fov|fov|int',
    'z1n_zoom_smooth|zoom|speed|smooth_speed|num',
    'z1n_gaussblur_intensity|gaussblur|intensity|intensity|num',
    'z1n_fogchange_density|fogchange|density|density|int',
    'z1n_fogchange_r|fogchange|color_r|color_r|num',
    'z1n_fogchange_g|fogchange|color_g|color_g|num',
    'z1n_fogchange_b|fogchange|color_b|color_b|num',
    'z1n_esp_smooth|esp|smooth_factor|smooth_factor|num',
    'z1n_esp_predict|esp|predict_ticks|predict_ticks|num',
    'z1n_esp_chestradius|esp|chest_scan_radius|chest_scan_radius|int',
    'z1n_esp_r|esp|color_r|color_r|num',
    'z1n_esp_g|esp|color_g|color_g|num',
    'z1n_esp_b|esp|color_b|color_b|num',
    'z1n_hud_range|hud|range|range|num',
    'z1n_hud_fov|hud|fov|fov|int',
    'z1n_pyrpc_maxdisplay|pyrpc|maxdisplay|maxDisplay|int',
    'z1n_whitelist_range|whitelist|range|range|num',
    'z1n_invisible_restoredelay|invisible|restoredelay|restore_delay|num',
    'z1n_rodaim_range|rodaim|range|aim_range|num',
    'z1n_rodaim_fov|rodaim|fov|fov|int',
    'z1n_noclip_speed|noclip|speed|speed|num',
    'z1c_killaura_onweapon|killaura|onweapon|onweapon|bool',
    'z1c_killaura_onhold|killaura|onhold|onhold|bool',
    'z1c_killaura_onholdattack|killaura|onholdattack|onholdattack|bool',
    'z1c_killaura_ecbypass|killaura|ecbypass|ecbypass|bool',
    'z1c_aimbot_onclick|aimbot|onclick|onclick|bool',
    'z1c_aimbot_onhold|aimbot|onhold|onhold|bool',
    'z1c_aimbot_onweapon|aimbot|onweapon|onweapon|bool',
    'z1c_aimbot_leftclick|aimbot|leftclick|leftclick|bool',
    'z1c_aimbot_sticky|aimbot|sticky|sticky|bool',
    'z1c_triggerbot_onweapon|triggerbot|onweapon|onweapon|bool',
    'z1c_triggerbot_ignoreteammates|triggerbot|ignoreteammates|ignore_teammates|bool',
    'z1c_triggerbot_throughwalls|triggerbot|throughwalls|through_walls|bool',
    'z1c_triggerbot_leftclick|triggerbot|leftclick|leftclick|bool',
    'z1c_criticals_onclick|criticals|onclick|onclick|bool',
    'z1c_criticals_onweapon|criticals|onweapon|onweapon|bool',
    'z1c_criticals_onsneak|criticals|onsneak|onsneak|bool',
    'z1c_criticals_onhold|criticals|onhold|onhold|bool',
    'z1c_autoclicker_swingair|autoclicker|swingair|swing_air|bool',
    'z1c_autoclicker_ecbypass|autoclicker|ecbypass|ecbypass|bool',
    'z1c_autorod_canattack|autorod|canattack|can_attack|bool',
    'z1c_autorod_silentswitch|autorod|silentswitch|silent_switch|bool',
    'z1c_combatbot_criticals|combatbot|criticals|criticals|bool',
    'z1c_combatbot_sprint|combatbot|sprint|sprint|bool',
    'z1c_kbchange_ecbypass|kbchange|ecbypass|ecbypass|bool',
    'z1c_kbchange_movefix|kbchange|movefix|movefix|bool',
    'z1c_ridetpaura_onweapon|ridetpaura|onweapon|onweapon|bool',
    'z1c_scaffold_airplace|scaffold|airplace|airplace|bool',
    'z1c_fucker_onholdbreak|fucker|onholdbreak|onholdbreak|bool',
    'z1c_esp_teambox|esp|teambox|teambox|bool',
    'z1c_esp_chestesp|esp|chest_esp|chest_esp|bool',
    'z1c_esp_chestfov|esp|chest_fov|chest_fov|bool',
    'z1c_hud_targethud|hud|targethud|targethud|bool',
    'z1c_hud_bjd|hud|bjd|bjd|bool',
    'z1c_pyrpc_decode|pyrpc|decode|decode|bool',
    'z1c_pyrpc_showmessage|pyrpc|showmessage|showMessage|bool',
    'z1c_whitelist_midclick|whitelist|midclick|midclick|bool',
    'z1c_list_send|list|send|send|bool',
    'z1c_rodaim_onhold|rodaim|onhold|onhold|bool',
    'z1c_xray_ore_diamond|xray|diamond|ore:diamond|bool',
    'z1c_xray_ore_iron|xray|iron|ore:iron|bool',
    'z1c_xray_ore_gold|xray|gold|ore:gold|bool',
    'z1c_xray_ore_emerald|xray|emerald|ore:emerald|bool',
    'z1c_xray_ore_debris|xray|debris|ore:debris|bool',
    'z1c_xray_ore_redstone|xray|redstone|ore:redstone|bool',
    'z1c_xray_ore_lapis|xray|lapis|ore:lapis|bool',
    'z1c_xray_ore_coal|xray|coal|ore:coal|bool',
    'z1c_xray_ore_copper|xray|copper|ore:copper|bool',
    'z1c_xray_ore_quartz|xray|quartz|ore:quartz|bool',
    'z1r_killaura_weaponmode|killaura|weaponmode|weapon_mode|enum',
    'z1r_killaura_attackmode|killaura|attack_mode|attack_mode|enum',
    'z1r_killaura_priority|killaura|priority|priority|enum',
    'z1r_aimbot_mode|aimbot|mode|mode|enum',
    'z1r_rodaim_mode|rodaim|mode|mode|enum',
    'z1r_antibot_mode|antibot|mode|mode|enum',
    'z1r_kbchange_mode|kbchange|mode|mode|enum',
    'z1r_kbchange_cameramode|kbchange|camera_mode|camera_mode|enum',
    'z1r_bhop_mode|bhop|mode|mode|enum',
    'z1r_inventorywalk_mode|inventorywalk|mode|mode|enum',
    'z1r_scaffold_switchmode|scaffold|switchmode|switchmode|enum',
    'z1r_fucker_mode|fucker|mode|mode|enum',
    'z1r_fucker_rotation|fucker|rotation|rotation|enum',
    'z1r_esp_espmode|esp|esp_mode|esp_mode|enum',
    'z1r_team_mode|team|mode|mode|enum',
    'z1r_crasher_mode|crasher|mode|mode|enum',
    'z1r_ridetpaura_attackmode|ridetpaura|attack_mode|attack_mode|enum',
    'z1r_ridetpaura_priority|ridetpaura|priority|priority|enum',
    'z1r_autorod_restoremode|autorod|restoremode|restore_mode|enum',
)


def _zcfgall(rp):
    s = _zsys()
    out = []
    if s is not None:
        m = getattr(s, '_manager', None)
        for ln in _ZCFGS:
            p5 = ln.split('|')
            if len(p5) != 5:
                continue
            ctl, n, k, at, ty = p5
            o = None
            if m is not None:
                try:
                    o = m.get(n)
                except Exception:
                    o = None
            if o is None:
                continue
            try:
                if at[:4] == 'ore:':
                    v = o.get_ore(at[4:])
                else:
                    v = getattr(o, at, None)
                if v is None:
                    vs = 'inf'
                elif ty == 'bool':
                    vs = 'true' if v else 'false'
                elif ty == 'enum':
                    vs = str(v)
                elif isinstance(v, float):
                    vs = '%g' % v
                else:
                    vs = str(v)
                out.append(ctl + '=' + vs)
            except Exception:
                pass
    _zwrite(rp, ';'.join(out) if out else 'none')


def _zloadfire(path):
    import __main__ as m2
    try:
        msg = m2.KUSUG_MCP['load'](path)
        return 'ok:' + str(msg)[:60]
    except Exception as e:
        return 'err:' + _zerr(e)


def _zload(path, rp):
    _zqueue((_zloadfire, path, rp))


def _zexitfire(unused):
    import __main__ as m2
    try:
        m2.KUSUG_MCP['unload_all']()
        return 'ok'
    except Exception as e:
        return 'err:' + _zerr(e)


def _zexit(rp):
    _zqueue((_zexitfire, None, rp))


__main__.KUSUG_MCP.update({'z1stateall': _zstateall, 'z1chatq': _zchatq, 'z1setq': _zsetq, 'ztogq': _ztogq, 'z1cfgq': _zcfgq, 'z1cfgall': _zcfgall, 'z1load': _zload, 'z1exit': _zexit})`;

// 与加载器同形的载荷: 核心缺失则整芯注入; 核心在但缺 z1 驱动(独立加载器注入过)则顶补
function z1Wrap(expr) {
	let core = "";
	for (const l of MCP_PY.split("\n")) core += "\n    " + l;
	let top = "";
	for (const l2 of Z1_TOPUP_PY.split("\n")) top += "\n    " + l2;
	return "import __main__\nif not hasattr(__main__, 'KUSUG_MCP'):" + core +
		"\nelif 'z1setq' not in __main__.KUSUG_MCP:" + top +
		"\n" + expr;
}

function z1Toast(m) { try { app.showToast(m); } catch (e) {} }

// Python 字符串字面量: 非 ASCII 转 \uXXXX(与 工具/MCP加载器.js 同法)
function z1Lit(s) {
	return "u'" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/[^\x20-\x7e]/g, function (c) {
		const h = c.charCodeAt(0).toString(16);
		return "\\u" + "0000".slice(h.length) + h;
	}) + "'";
}

// 回执走文件(设备实证 evalPython 只回 true 不回值): 每次调用先清空回执文件, Python 写, JS 读
function z1RetFile() {
	let d = "";
	try { d = app.getResource("kusug"); } catch (e) {}
	return d + "/z1_ret.txt";
}

// 回执乱码救援: 引擎 fs.read 不按 UTF-8 解码, 非 ASCII 会变 latin-1 展开; 纯 ASCII 与真 unicode 不受影响
function z1ReadFile(p) {
	let rr = "";
	try { rr = String(fs.read(p) || "").trim(); } catch (e) {}
	if (/[\x80-\xff]/.test(rr)) { try { rr = decodeURIComponent(escape(rr)); } catch (e) {} }
	return rr;
}

function z1Op(expr) {
	const rp = z1RetFile();
	try { fs.write(rp, ""); } catch (e) {}
	try { app.evalPython(z1Wrap(expr)); } catch (e) { return ""; }
	return z1ReadFile(rp);
}

function z1Cmd(fn, args) {
	return z1Op("__main__.KUSUG_MCP['" + fn + "'](" + (args ? args + "," : "") + z1Lit(z1RetFile()) + ")");
}

// ===== 一切控制都进游戏刻(设备实证: evalPython 上下文里引擎调用会被吞, mount/clickgui 均如此) =====
// 入队 -> 核心 _KTick 下一游戏刻在主循环排空执行并写序号回执 -> JS 延迟 200ms 读
const Z1_SEQ = { n: 0 };

function z1TickOp(buildExpr, label, after, fail) {
	const rp = z1RetFile() + "." + (Z1_SEQ.n++);
	try { fs.write(rp, ""); } catch (e) {}
	try { app.evalPython(z1Wrap(buildExpr(rp))); } catch (e) { z1Toast(label + " 投递异常"); if (fail) fail(); return; }
	setTimeout(function () {
		const r = z1ReadFile(rp);
		try { fs.remove(rp); } catch (e) {}
		if (r === "") { z1Toast(label + " 无回执(tick 未跑?)"); if (fail) fail(); return; }
		if (r.indexOf("err:") === 0) { z1Toast(label + " 异常: " + r.slice(4, 44)); if (fail) fail(); return; }
		if (after) after(r);
	}, 200);
}

// 聊天分发回执: n 或 n|err:...; n=0 即未加载
function z1ChatTick(cmd, label, ok, fail) {
	z1TickOp(function (rp) {
		return "__main__.KUSUG_MCP['z1chatq'](" + z1Lit(cmd) + "," + z1Lit(rp) + ")";
	}, label, function (r) {
		if (r === "0") { z1Toast("z1yr 未加载"); if (fail) fail(); return; }
		if (r.indexOf("|err:") > 0) { z1Toast(label + " 异常: " + r.split("|err:")[1].slice(0, 40)); if (fail) fail(); return; }
		if (ok) ok(r);
	}, fail);
}

// 直控回执: 1/0(真实开关态) / missing(未加载) / err:...
function z1DirectTick(name, want, label) {
	z1TickOp(function (rp) {
		return want === null
			? "__main__.KUSUG_MCP['ztogq'](" + z1Lit(name) + "," + z1Lit(rp) + ")"
			: "__main__.KUSUG_MCP['z1setq'](" + z1Lit(name) + "," + (want ? "True" : "False") + "," + z1Lit(rp) + ")";
	}, label, function (r) {
		if (r === "missing") { z1Toast("z1yr 未加载"); if (want !== null) Z1_STATE[name] = !want; return; }
		if (r === "0" || r === "1") { Z1_STATE[name] = r === "1"; notifyToggle(label, r === "1"); }
		else z1Toast("切换回执异常: " + r.slice(0, 40));
	}, function () { if (want !== null) Z1_STATE[name] = !want; });
}

const Z1_MODS = {
	killaura: "杀戮光环",
	aimbot: "自动瞄准",
	reach: "攻击距离",
	velocity: "反击退",
	autoclicker: "自动连点",
	triggerbot: "扳机",
	antibot: "反机器人",
	combatbot: "战斗机器人",
	criticals: "刀刀暴击",
	autosoup: "自动喝汤",
	autorod: "自动鱼竿",
	rodaim: "鱼竿自瞄",
	jumpreset: "跳跃重置",
	fastanchor: "快速重生锚",
	kbchange: "击退移位",
	ridetpaura: "坐骑百米",
	fly: "飞行",
	noclip: "穿墙",
	bhop: "速度",
	sprint: "自动疾跑",
	nojumpdelay: "无跳跃延迟",
	clicktp: "点击传送",
	inventorywalk: "背包行走",
	ridefly: "坐骑飞行",
	ridebhop: "坐骑速度",
	respawn: "原地复活",
	xray: "矿透",
	scaffold: "自动搭路",
	autotool: "自动工具",
	autoweb: "自动蜘蛛网",
	autotrap: "自动围人",
	blockin: "方块围栏",
	fucker: "自动拆床",
	nobreakdelay: "无挖矿延迟",
	esp: "透视",
	freecam: "自由视角",
	invisible: "隐身",
	killeffect: "击杀特效",
	motioncamera: "运动相机",
	nohurtcam: "无受击抖动",
	gaussblur: "容器模糊",
	fogchange: "迷雾视效",
	zoom: "缩放",
	hud: "界面显示",
	spammer: "自动发言",
	team: "队伍",
	mount: "坐骑生成",
	fashionunlock: "时装破解",
	list: "玩家列表",
	whitelist: "白名单",
	debug: "调试信息",
	gmpanel: "GM面板",
	pyrpc: "PyRpc日志",
	cebridge: "CE桥接",
	crasher: "崩溃器",
	notification: "通知",
};

const Z1_PARAMS = {
	z1_killaura_range: ["killaura", "range"],
	z1_killaura_fov: ["killaura", "fov"],
	z1_killaura_cps: ["killaura", "cps"],
	z1_killaura_switchdelay: ["killaura", "switchdelay"],
	z1_autoclicker_reach: ["autoclicker", "reach"],
	z1_aimbot_range: ["aimbot", "range"],
	z1_aimbot_fov: ["aimbot", "fov"],
	z1_reach_dist: ["reach", "dist"],
	z1_velocity_x: ["velocity", "x"],
	z1_velocity_y: ["velocity", "y"],
	z1_velocity_z: ["velocity", "z"],
	z1_fly_speed: ["fly", "speed"],
	z1_ridefly_speed: ["ridefly", "speed"],
	z1_freecam_speed: ["freecam", "speed"],
	z1_autorod_roddelay: ["autorod", "roddelay"],
	z1_respawn_delay: ["respawn", "delay"],
	z1_fastanchor_delay: ["fastanchor", "delay"],
	z1_fastanchor_stepdelay: ["fastanchor", "stepdelay"],
	z1_xray_range: ["xray", "range"],
	z1_xray_ylimit: ["xray", "ylimit"],
	z1_xray_budget: ["xray", "budget"],
	z1_xray_refresh: ["xray", "refresh"],
	z1_xray_max: ["xray", "max"],
	z1_xray_render: ["xray", "render"],
	z1_invisible_int: ["invisible", "interval"],
	z1_spammer_text: ["spammer", "text"],
	z1_spammer_delay: ["spammer", "delay"],
	z1_spammer_rand: ["spammer", "rand"],
};

// 聊天命令名与模块名不同的映射; 一次性动作(点了就发, 不进状态); 聊天不可控走 Python 直控
const Z1_CMD = { noclip: "clip" };
const Z1_ONESHOT = { mount: "mount", gmpanel: "gm", debug: "debug", list: "list" };
const Z1_DIRECT = { whitelist: 1, kbchange: 1, ridetpaura: 1, hud: 1, autotrap: 1, blockin: 1, fucker: 1, zoom: 1 };
const Z1_PARAMVALS = {};
// 复合命令组: 同一组只发主 key(从 Z1_PARAMVALS 取全组当前值拼一条)
const Z1_COMPOUND_LEAD = { z1_velocity_y: "z1_velocity_x", z1_velocity_z: "z1_velocity_x", z1_spammer_delay: "z1_spammer_text", z1_spammer_rand: "z1_spammer_text" };
const Z1_PARAM_AUTOEN = { z1_killaura_range: 1, z1_killaura_fov: 1, z1_killaura_cps: 1, z1_killaura_switchdelay: 1, z1_autoclicker_reach: 1, z1_reach_dist: 1, z1_velocity_x: 1, z1_velocity_y: 1, z1_velocity_z: 1, z1_spammer_text: 1, z1_spammer_delay: 1, z1_spammer_rand: 1 };
const Z1_STATE = {};

// ===== 子参数直控(原生 apply_config 通道): key -> [模块, cfg键, 类型, 标签]; 枚举选项在 Z1_CFG_OPTS =====
const Z1_CFG = {
	z1n_killaura_multi_limit: ["killaura", "multi_limit", "int", "目标上限"],
	z1n_aimbot_speed: ["aimbot", "speed", "num", "速度"],
	z1n_aimbot_yoffset: ["aimbot", "yoffset", "num", "垂直偏移"],
	z1n_triggerbot_range: ["triggerbot", "range", "num", "范围"],
	z1n_triggerbot_fov: ["triggerbot", "fov", "int", "FOV"],
	z1n_triggerbot_cps: ["triggerbot", "cps", "int", "CPS"],
	z1n_criticals_sneakdelay: ["criticals", "sneakdelay", "num", "潜行延迟"],
	z1n_criticals_clickspan: ["criticals", "clickspan", "num", "点击间隔"],
	z1n_autoclicker_cpsmin: ["autoclicker", "cps_min", "int", "最小CPS"],
	z1n_autoclicker_cpsmax: ["autoclicker", "cps_max", "int", "最大CPS"],
	z1n_autorod_switchdelay: ["autorod", "switchdelay", "int", "切换延迟"],
	z1n_autorod_range: ["autorod", "range", "int", "范围"],
	z1n_autosoup_health: ["autosoup", "health", "int", "血量"],
	z1n_autosoup_delay: ["autosoup", "delay", "int", "延迟"],
	z1n_combatbot_trackrange: ["combatbot", "track_range", "int", "追踪范围"],
	z1n_combatbot_attackrange: ["combatbot", "attack_range", "num", "攻击距离"],
	z1n_combatbot_keepdist: ["combatbot", "keep_distance", "num", "保持距离"],
	z1n_combatbot_healhp: ["combatbot", "heal_hp", "int", "回血阈值"],
	z1n_combatbot_healkeep: ["combatbot", "heal_keep_distance", "int", "回血距离"],
	z1n_kbchange_yaw: ["kbchange", "yaw", "int", "转向角"],
	z1n_kbchange_range: ["kbchange", "range", "num", "范围"],
	z1n_ridetpaura_range: ["ridetpaura", "range", "int", "范围"],
	z1n_bhop_fallspeed: ["bhop", "fallspeed", "num", "下落速度"],
	z1n_bhop_speed: ["bhop", "speed", "num", "速度"],
	z1n_ridebhop_speed: ["ridebhop", "speed", "num", "速度"],
	z1n_ridebhop_ymotion: ["ridebhop", "ymotion", "num", "垂直速度"],
	z1n_scaffold_radius: ["scaffold", "radius", "int", "半径"],
	z1n_autotool_switchtick: ["autotool", "switchtick", "int", "切换延迟"],
	z1n_autotool_restoretick: ["autotool", "restoretick", "int", "恢复延迟"],
	z1n_blockin_speed: ["blockin", "speed", "int", "速度"],
	z1n_autotrap_range: ["autotrap", "range", "num", "范围"],
	z1n_autoweb_delay: ["autoweb", "delay", "num", "延迟"],
	z1n_nobreakdelay_restarttick: ["nobreakdelay", "restarttick", "int", "重挖延迟"],
	z1n_nobreakdelay_aimconfirmticks: ["nobreakdelay", "aimconfirmticks", "int", "瞄准确认"],
	z1n_fucker_range: ["fucker", "range", "num", "范围"],
	z1n_fucker_scaninterval: ["fucker", "scan_interval", "int", "扫描间隔"],
	z1n_zoom_fov: ["zoom", "fov", "int", "视野"],
	z1n_zoom_smooth: ["zoom", "speed", "num", "平滑"],
	z1n_gaussblur_intensity: ["gaussblur", "intensity", "num", "模糊强度"],
	z1n_fogchange_density: ["fogchange", "density", "int", "雾浓度"],
	z1n_fogchange_r: ["fogchange", "color_r", "num", "红色"],
	z1n_fogchange_g: ["fogchange", "color_g", "num", "绿色"],
	z1n_fogchange_b: ["fogchange", "color_b", "num", "蓝色"],
	z1n_esp_smooth: ["esp", "smooth_factor", "num", "平滑"],
	z1n_esp_predict: ["esp", "predict_ticks", "num", "预测"],
	z1n_esp_chestradius: ["esp", "chest_scan_radius", "int", "箱子半径"],
	z1n_esp_r: ["esp", "color_r", "num", "红色"],
	z1n_esp_g: ["esp", "color_g", "num", "绿色"],
	z1n_esp_b: ["esp", "color_b", "num", "蓝色"],
	z1n_hud_range: ["hud", "range", "num", "范围"],
	z1n_hud_fov: ["hud", "fov", "int", "FOV"],
	z1n_pyrpc_maxdisplay: ["pyrpc", "maxdisplay", "int", "显示上限"],
	z1n_whitelist_range: ["whitelist", "range", "num", "范围"],
	z1n_invisible_restoredelay: ["invisible", "restoredelay", "num", "恢复延迟"],
	z1n_rodaim_range: ["rodaim", "range", "num", "范围"],
	z1n_rodaim_fov: ["rodaim", "fov", "int", "FOV"],
	z1n_noclip_speed: ["noclip", "speed", "num", "速度"],
	z1c_killaura_onweapon: ["killaura", "onweapon", "bool", "持武器"],
	z1c_killaura_onhold: ["killaura", "onhold", "bool", "按住触发"],
	z1c_killaura_onholdattack: ["killaura", "onholdattack", "bool", "按住攻击"],
	z1c_killaura_ecbypass: ["killaura", "ecbypass", "bool", "ECBypass"],
	z1c_aimbot_onclick: ["aimbot", "onclick", "bool", "点击触发"],
	z1c_aimbot_onhold: ["aimbot", "onhold", "bool", "按住触发"],
	z1c_aimbot_onweapon: ["aimbot", "onweapon", "bool", "持武器"],
	z1c_aimbot_leftclick: ["aimbot", "leftclick", "bool", "按住锁定"],
	z1c_aimbot_sticky: ["aimbot", "sticky", "bool", "粘滞锁定"],
	z1c_triggerbot_onweapon: ["triggerbot", "onweapon", "bool", "持武器"],
	z1c_triggerbot_ignoreteammates: ["triggerbot", "ignoreteammates", "bool", "忽略队友"],
	z1c_triggerbot_throughwalls: ["triggerbot", "throughwalls", "bool", "隔墙攻击"],
	z1c_triggerbot_leftclick: ["triggerbot", "leftclick", "bool", "按住锁定"],
	z1c_criticals_onclick: ["criticals", "onclick", "bool", "点击触发"],
	z1c_criticals_onweapon: ["criticals", "onweapon", "bool", "持武器"],
	z1c_criticals_onsneak: ["criticals", "onsneak", "bool", "潜行触发"],
	z1c_criticals_onhold: ["criticals", "onhold", "bool", "按住触发"],
	z1c_autoclicker_swingair: ["autoclicker", "swingair", "bool", "空挥"],
	z1c_autoclicker_ecbypass: ["autoclicker", "ecbypass", "bool", "ECBypass"],
	z1c_autorod_canattack: ["autorod", "canattack", "bool", "可攻击"],
	z1c_autorod_silentswitch: ["autorod", "silentswitch", "bool", "静默切换"],
	z1c_combatbot_criticals: ["combatbot", "criticals", "bool", "暴击"],
	z1c_combatbot_sprint: ["combatbot", "sprint", "bool", "疾跑"],
	z1c_kbchange_ecbypass: ["kbchange", "ecbypass", "bool", "ECBypass"],
	z1c_kbchange_movefix: ["kbchange", "movefix", "bool", "移动修正"],
	z1c_ridetpaura_onweapon: ["ridetpaura", "onweapon", "bool", "持武器"],
	z1c_scaffold_airplace: ["scaffold", "airplace", "bool", "空放自救"],
	z1c_fucker_onholdbreak: ["fucker", "onholdbreak", "bool", "按住挖掘"],
	z1c_esp_teambox: ["esp", "teambox", "bool", "队友框"],
	z1c_esp_chestesp: ["esp", "chest_esp", "bool", "箱子透视"],
	z1c_esp_chestfov: ["esp", "chest_fov", "bool", "箱子视野"],
	z1c_hud_targethud: ["hud", "targethud", "bool", "目标面板"],
	z1c_hud_bjd: ["hud", "bjd", "bool", "布吉岛"],
	z1c_pyrpc_decode: ["pyrpc", "decode", "bool", "解码"],
	z1c_pyrpc_showmessage: ["pyrpc", "showmessage", "bool", "显示消息"],
	z1c_whitelist_midclick: ["whitelist", "midclick", "bool", "中键"],
	z1c_list_send: ["list", "send", "bool", "发送"],
	z1c_rodaim_onhold: ["rodaim", "onhold", "bool", "按住触发"],
	z1c_xray_ore_diamond: ["xray", "diamond", "bool", "钻石"],
	z1c_xray_ore_iron: ["xray", "iron", "bool", "铁矿"],
	z1c_xray_ore_gold: ["xray", "gold", "bool", "金矿"],
	z1c_xray_ore_emerald: ["xray", "emerald", "bool", "绿宝石"],
	z1c_xray_ore_debris: ["xray", "debris", "bool", "远古残骸"],
	z1c_xray_ore_redstone: ["xray", "redstone", "bool", "红石"],
	z1c_xray_ore_lapis: ["xray", "lapis", "bool", "青金石"],
	z1c_xray_ore_coal: ["xray", "coal", "bool", "煤矿"],
	z1c_xray_ore_copper: ["xray", "copper", "bool", "铜矿"],
	z1c_xray_ore_quartz: ["xray", "quartz", "bool", "石英"],
	z1r_killaura_weaponmode: ["killaura", "weaponmode", "enum", "武器选择"],
	z1r_killaura_attackmode: ["killaura", "attack_mode", "enum", "攻击模式"],
	z1r_killaura_priority: ["killaura", "priority", "enum", "优先级"],
	z1r_aimbot_mode: ["aimbot", "mode", "enum", "模式"],
	z1r_rodaim_mode: ["rodaim", "mode", "enum", "模式"],
	z1r_antibot_mode: ["antibot", "mode", "enum", "模式"],
	z1r_kbchange_mode: ["kbchange", "mode", "enum", "模式"],
	z1r_kbchange_cameramode: ["kbchange", "camera_mode", "enum", "相机模式"],
	z1r_bhop_mode: ["bhop", "mode", "enum", "模式"],
	z1r_inventorywalk_mode: ["inventorywalk", "mode", "enum", "模式"],
	z1r_scaffold_switchmode: ["scaffold", "switchmode", "enum", "切换模式"],
	z1r_fucker_mode: ["fucker", "mode", "enum", "模式"],
	z1r_fucker_rotation: ["fucker", "rotation", "enum", "转头模式"],
	z1r_esp_espmode: ["esp", "esp_mode", "enum", "模式"],
	z1r_team_mode: ["team", "mode", "enum", "模式"],
	z1r_crasher_mode: ["crasher", "mode", "enum", "模式"],
	z1r_ridetpaura_attackmode: ["ridetpaura", "attack_mode", "enum", "攻击模式"],
	z1r_ridetpaura_priority: ["ridetpaura", "priority", "enum", "优先级"],
	z1r_autorod_restoremode: ["autorod", "restoremode", "enum", "切回武器"],
};
const Z1_CFG_OPTS = {
	z1r_killaura_weaponmode: [["default", "默认"], ["sword", "剑"], ["axe", "斧头"], ["mace", "重锤"]],
	z1r_killaura_attackmode: [["single", "单体"], ["switch", "多体"], ["multi", "群体"]],
	z1r_killaura_priority: [["distance", "最近距离"], ["health", "最少血量"], ["angle", "准星最近"]],
	z1r_aimbot_mode: [["dynamic", "动态"], ["static", "静态"]],
	z1r_rodaim_mode: [["dynamic", "动态"], ["static", "静态"]],
	z1r_antibot_mode: [["bjd", "布吉岛"], ["default", "默认"]],
	z1r_kbchange_mode: [["right", "右"], ["left", "左"]],
	z1r_kbchange_cameramode: [["static", "静态"], ["dynamic", "动态"]],
	z1r_bhop_mode: [["lowhop", "低跳"], ["motion", "兔子跳"]],
	z1r_inventorywalk_mode: [["motion", "动态"], ["vanilla", "原版"]],
	z1r_scaffold_switchmode: [["default", "默认"], ["auto", "自动"], ["silent", "静默"]],
	z1r_fucker_mode: [["bed", "床"], ["surround", "围堵"]],
	z1r_fucker_rotation: [["off", "关闭"], ["dynamic", "动态"], ["static", "静态"]],
	z1r_esp_espmode: [["2d", "2D"], ["3d", "3D"], ["both", "两者"]],
	z1r_team_mode: [["armor", "护甲颜色"], ["namecolor", "名字颜色"], ["prefix", "名字前缀"], ["all", "全部"]],
	z1r_crasher_mode: [["pyrpc", "PyRpc"], ["4dskin", "4D皮肤"]],
	z1r_ridetpaura_attackmode: [["single", "单体"], ["switch", "多体"]],
	z1r_ridetpaura_priority: [["distance", "最近距离"], ["health", "最少血量"], ["angle", "准星最近"]],
	z1r_autorod_restoremode: [["default", "默认"], ["sword", "剑"], ["axe", "斧头"]],
};
const Z1_CFGVALS = {};
let Z1_CFGSEEDED = false;

function z1CfgSame(ck, ty, val) {
	const old = Z1_CFGVALS[ck];
	if (old === undefined) return false;
	if (old === val) return true;
	if (ty === "bool" || ty === "enum") return false;
	return Number(old) === Number(val);
}

// 子参数回执: ok / missing(未加载) / err:...(原生 apply_config 自己吞错时仍会 ok)
function z1CfgTick(ck, val) {
	const spec = Z1_CFG[ck];
	const label = Z1_MODS[spec[0]] + " " + spec[3];
	z1TickOp(function (rp) {
		return "__main__.KUSUG_MCP['z1cfgq'](" + z1Lit(spec[0]) + "," + z1Lit(spec[1]) + "," + z1Lit(val) + "," + z1Lit(rp) + ")";
	}, label, function (r) {
		if (r === "ok") {
			Z1_CFGVALS[ck] = val;
			let disp = val;
			if (spec[2] === "bool") disp = val === "true" ? "开" : "关";
			else if (spec[2] === "enum") { const os = Z1_CFG_OPTS[ck] || []; for (let i = 0; i < os.length; i++) if (os[i][0] === val) { disp = os[i][1]; break; } }
			else if (val === "inf") disp = "无限";
			z1Toast(label + ": " + disp);
			return;
		}
		if (r === "missing") { z1Toast("z1yr 未加载"); return; }
		if (r.indexOf("err:") === 0) { z1Toast(label + " 异常: " + r.slice(4, 44)); return; }
		z1Toast(label + " 回执异常: " + r.slice(0, 40));
	});
}

// 加载成功后播种子参数真实值(读模块 attr): 开菜单洪水上报的静态默认值与真值相同即静默, 不同才下发
function z1CfgSeed() {
	const st = z1Cmd("z1cfgall", "");
	Z1_CFGSEEDED = false;
	for (const k in Z1_CFGVALS) delete Z1_CFGVALS[k];
	if (!st || st === "none") return;
	for (const p of st.split(";")) {
		const i = p.indexOf("=");
		if (i > 0) Z1_CFGVALS[p.slice(0, i)] = p.slice(i + 1);
	}
	Z1_CFGSEEDED = true;
}


// 状态串同步进 Z1_STATE; 返回是否拿到有效串
function z1SyncFrom(st) {
	if (!st || st === "none") return false;
	for (const p of st.split(";")) {
		const i = p.indexOf("=");
		if (i > 0) Z1_STATE[p.slice(0, i)] = p.slice(i + 1) === "1";
	}
	return true;
}

// 读单个模块的真实开关态(切换后校正方向用); 同步失败时退回意图值
function z1Actual(name, want) {
	const st = z1Cmd("z1stateall", "");
	if (!st || st === "none") return want;
	for (const p of st.split(";")) {
		const i = p.indexOf("=");
		if (i > 0 && p.slice(0, i) === name) return p.slice(i + 1) === "1";
	}
	return want;
}

// 加载/退出专用长轮询: 加载要在游戏刻内跑完整个注册(数秒), 400ms 步进最多 10s
let Z1_LOADING = false;

function z1Poll(buildExpr, label, after, fail) {
	const rp = z1RetFile() + "." + (Z1_SEQ.n++);
	try { fs.write(rp, ""); } catch (e) {}
	try { app.evalPython(z1Wrap(buildExpr(rp))); } catch (e) { z1Toast(label + " 投递异常"); if (fail) fail(); return; }
	let tries = 0;
	const step = function () {
		const r = z1ReadFile(rp);
		if (r !== "") { try { fs.remove(rp); } catch (e) {} if (after) after(r); return; }
		if (++tries > 25) { try { fs.remove(rp); } catch (e) {} z1Toast(label + " 无回执(tick 未跑?)"); if (fail) fail(); return; }
		setTimeout(step, 400);
	};
	setTimeout(step, 400);
}

function z1Load() {
	let dir = "";
	try { dir = app.getResource("kusug/mcp"); } catch (e) {}
	if (!dir) { z1Toast("取不到资源目录"); return; }
	const path = dir + "/" + Z1_MCP_FILE;
	try { if (!fs.exists(path)) { z1Toast("未找到 " + path); return; } } catch (e) {}
	if (Z1_LOADING) { z1Toast("正在加载中, 请稍候"); return; }
	Z1_LOADING = true;
	z1Toast("z1yr 加载中…");
	const done = function () { Z1_LOADING = false; };
	z1Poll(function (rp) {
		return "__main__.KUSUG_MCP['z1load'](" + z1Lit(path) + "," + z1Lit(rp) + ")";
	}, "加载", function (r) {
		done();
		if (r.indexOf("ok:") === 0) {
			z1Toast("已加载: " + r.slice(3));
			if (!z1SyncFrom(z1Cmd("z1stateall", ""))) z1Toast("状态同步失败: 开关方向可能不准");
			z1CfgSeed();
		} else if (r.indexOf("err") === 0) z1Toast("加载失败: " + r.slice(4, 64));
		else z1Toast("加载失败: " + (r || "无回执"));
	}, done);
}

function z1Exit() {
	z1Poll(function (rp) {
		return "__main__.KUSUG_MCP['z1exit'](" + z1Lit(rp) + ")";
	}, "退出", function (r) {
		for (const k in Z1_STATE) delete Z1_STATE[k];
		Z1_CFGSEEDED = false;
		for (const k2 in Z1_CFGVALS) delete Z1_CFGVALS[k2];
		z1Toast(r === "ok" ? "已退出 z1yr 组件" : ("退出异常: " + (r || "无回执")));
	}, null);
}

// z1yr 原生 ClickGUI(.clickgui 专属分支: close_chat + open_clickgui)
function z1ClickGui() {
	z1ChatTick(".clickgui", "ClickGUI");
}

function z1ParamCmd(pk, v) {
	const num = String(Number(v));
	// spammer 三个参数是一条复合命令: .spammer <文本> <延迟> <随机长度>(取记下的全组值)
	if (pk === "z1_spammer_text" || pk === "z1_spammer_delay" || pk === "z1_spammer_rand") {
		const tx = Z1_PARAMVALS["z1_spammer_text"] !== undefined ? String(Z1_PARAMVALS["z1_spammer_text"]) : "";
		if (!tx) return "";
		const dl = Z1_PARAMVALS["z1_spammer_delay"] !== undefined ? String(Number(Z1_PARAMVALS["z1_spammer_delay"])) : "5";
		const rd = Z1_PARAMVALS["z1_spammer_rand"] !== undefined ? String(Math.round(Number(Z1_PARAMVALS["z1_spammer_rand"]))) : "0";
		return ".spammer " + tx + " " + dl + " " + rd;
	}
	// velocity 三轴一条命令
	if (pk === "z1_velocity_x" || pk === "z1_velocity_y" || pk === "z1_velocity_z") {
		const vx = Z1_PARAMVALS["z1_velocity_x"] !== undefined ? String(Number(Z1_PARAMVALS["z1_velocity_x"])) : "0";
		const vy = Z1_PARAMVALS["z1_velocity_y"] !== undefined ? String(Number(Z1_PARAMVALS["z1_velocity_y"])) : "0";
		const vz = Z1_PARAMVALS["z1_velocity_z"] !== undefined ? String(Number(Z1_PARAMVALS["z1_velocity_z"])) : "0";
		return ".velocity " + vx + " " + vy + " " + vz;
	}
	switch (pk) {
		case "z1_killaura_range": return ".killaura range " + num;
		case "z1_killaura_fov": return ".killaura fov " + num;
		case "z1_killaura_cps": return ".killaura cps " + num;
		case "z1_killaura_switchdelay": return ".killaura switchdelay " + Math.round(Number(v));
		case "z1_autoclicker_reach": return ".autoclicker reach " + num;
		case "z1_aimbot_range": return ".aimbot range " + num;
		case "z1_aimbot_fov": return ".aimbot fov " + num;
		case "z1_reach_dist": return ".reach " + num;
		case "z1_fly_speed": return ".fly speed " + num;
		case "z1_ridefly_speed": return ".ridefly speed " + num;
		case "z1_freecam_speed": return ".freecam speed " + num;
		case "z1_autorod_roddelay": return ".autorod roddelay " + num;
		case "z1_respawn_delay": return ".respawn delay " + Math.round(Number(v));
		case "z1_fastanchor_delay": return ".fastanchor delay " + num;
		case "z1_fastanchor_stepdelay": return ".fastanchor stepdelay " + num;
		case "z1_xray_range": return ".xray range " + num;
		case "z1_xray_ylimit": return ".xray ylimit " + Math.round(Number(v));
		case "z1_xray_budget": return ".xray budget " + num;
		case "z1_xray_refresh": return ".xray refresh " + num;
		case "z1_xray_max": return ".xray max " + Math.round(Number(v));
		case "z1_xray_render": return ".xray render " + Math.round(Number(v));
		case "z1_invisible_int": return ".invisible interval " + num;
	}
	return "";
}

// 参数跟随开关: 模块没开就只记值不下发(滑条/文本控件上报与开关无关, 直发会被顺带 enable 误开功能);
// 同值重复(菜单打开上报等)直接忽略; 开关打开时把记下的值补发下去
function z1ParamSend(pk, quiet) {
	const spec = Z1_PARAMS[pk];
	const v = Z1_PARAMVALS[pk];
	const cmd = z1ParamCmd(pk, v);
	if (!cmd) { if (!quiet && pk.indexOf("z1_spammer") === 0) z1Toast("先在文本框输入刷屏内容"); return; }
	z1ChatTick(cmd, Z1_MODS[spec[0]], function () {
		// 原生提示已出(tick 上下文), 这里只静默同步顺带开启的真实状态
		if (Z1_PARAM_AUTOEN[pk]) Z1_STATE[spec[0]] = z1Actual(spec[0], Z1_STATE[spec[0]] === true);
	});
}

function z1ParamSet(pk, args) {
	const spec = Z1_PARAMS[pk];
	const v = argPick(args, pk);
	if (v === undefined || typeof v === "boolean") return;
	if (Z1_PARAMVALS[pk] === v) return;
	Z1_PARAMVALS[pk] = v;
	if (Z1_STATE[spec[0]] !== true) return;
	z1ParamSend(pk, false);
}

const z1yrPanel = {
	tag: "z1yr",
	onModuleEvent(args) {
		if (!args) return;
		const fun = args.fun;
		if (fun === "z1_load") { z1Load(); return; }
		if (fun === "z1_exit") { z1Exit(); return; }
		if (fun === "z1_clickgui") { z1ClickGui(); return; }
		// 子参数事件最优先: 框架只带值字段(pascal 形), fun 甚至是父开关 tag
		let chit = false;
		for (const ck in Z1_CFG) {
			const spec = Z1_CFG[ck];
			let val;
			if (spec[2] === "enum") {
				const mv = argPick(args, ck);
				if (typeof mv === "string" && mv.indexOf(ck + "_") === 0) val = mv.slice(ck.length + 1);
				else {
					const eos = Z1_CFG_OPTS[ck] || [];
					for (let oi = 0; oi < eos.length; oi++) {
						if (args[ck + "_" + eos[oi][0]] === true || argPick(args, ck + "_" + eos[oi][0]) === true) { val = eos[oi][0]; break; }
					}
				}
				if (val === undefined) continue;
			} else if (spec[2] === "bool") {
				const bv = argPick(args, ck);
				if (typeof bv !== "boolean") continue;
				val = bv ? "true" : "false";
			} else {
				const nv = argPick(args, ck);
				if (nv === undefined || typeof nv === "boolean") continue;
				const nn = Number(nv);
				if (isNaN(nn)) { chit = true; continue; }
				val = spec[2] === "int" ? String(Math.round(nn)) : String(nn);
				if (ck === "z1n_killaura_multi_limit" && nn >= 20) val = "inf";
			}
			chit = true;
			if (!Z1_CFGSEEDED) { Z1_CFGVALS[ck] = val; continue; }
			if (z1CfgSame(ck, spec[2], val)) continue;
			Z1_CFGVALS[ck] = val;
			z1CfgTick(ck, val);
		}
		if (chit) return;
		// 参数事件优先: 框架可能只带值字段(形如 Z1_Spammer_Text)而不带 key, fun 甚至是父开关 tag
		// (设备实证: 改文本不生效反而 toggle 了模块 —— 就是掉进下面开关分支导致的)
		let hit = false;
		for (const k2 in Z1_PARAMS) {
			if (argPick(args, k2) !== undefined) { z1ParamSet(k2, args); hit = true; }
		}
		if (hit) return;
		const pk = (args.key && Z1_PARAMS[args.key]) ? args.key : (Z1_PARAMS[fun] ? fun : "");
		if (pk) { z1ParamSet(pk, args); return; }
		if (typeof fun === "string" && fun.indexOf("z1_") === 0) {
			const name = fun.slice(3);
			if (!Z1_MODS[name]) return;
			if (Z1_ONESHOT[name]) {
				if (args.value === false) return; // 开菜单上报 false 不触发, 只有真点(开/无值)才发
				z1ChatTick("." + Z1_ONESHOT[name], Z1_MODS[name]);
				return;
			}
			if (typeof args.value === "boolean" && (Z1_STATE[name] === true) === args.value) return; // 同值跳过(原生无提示我们也不加)
			const want = typeof args.value === "boolean" ? args.value : null;
			if (want !== null) Z1_STATE[name] = want; // 乐观更新; 失败回滚, 回执/读回再校正
			if (Z1_DIRECT[name]) { z1DirectTick(name, want, Z1_MODS[name]); return; } // 直控模块原生多数静默, 保留我们的提示
			z1ChatTick("." + (Z1_CMD[name] || name), Z1_MODS[name], want === null ? null : function () {
				// 聊天分发的原生开关提示在 tick 上下文已正常出, 这里只校正状态不再重复提示
				Z1_STATE[name] = z1Actual(name, want);
				// 开关打开后, 把之前(未启用时)记下的参数补发下去(复合命令组只发主 key 一条)
				if (Z1_STATE[name] === true) {
					const done = {};
					for (const pk2 in Z1_PARAMS) {
						if (Z1_PARAMS[pk2][0] !== name || Z1_PARAMVALS[pk2] === undefined) continue;
						const lead = Z1_COMPOUND_LEAD[pk2] || pk2;
						if (done[lead]) continue;
					done[lead] = true;
					z1ParamSend(lead, true);
				}
			}
		}, want === null ? null : function () { Z1_STATE[name] = !want; });
		return;
		}
	}
};

const Z1_TAGS = [];
for (const k in Z1_MODS) Z1_TAGS.push("z1_" + k);
for (const k2 in Z1_PARAMS) Z1_TAGS.push(k2);
for (const k3 in Z1_CFG) Z1_TAGS.push(k3);
Z1_TAGS.push("z1_load", "z1_exit", "z1_clickgui");
for (const t of Z1_TAGS) safeRegFun(t);
// >>> Z1YR_PANEL_END

const modules = [cookieLogin, moveCamera, likeUser, watermarkUid, javaWatermark, queryPlayer, roomIp, antiKick, msgBrush, killAura, scaffold, nightVision, locateStructure, posPrint, noInvis, getUid, adventureEdit, infDurability, goatEffect, bedColor, bannerColor, ominousBottle, customDamage, attackDrops, autoDrop, attackFx, deathFx, chunkDisplay, selfAttack, ghostBarrier, miniMap, auxEffect, anvilLines, noHunger, skinTryOn, loginVideo, radarHud, gmPanel, checkCmd, structHud, texInject, sendControl, tradeUnlock, fpsHud, killTaunt, attackTaunt, batchCmd, motionBlur, hideClutter, bypassServer, gyroView, bigGyro, customCamera, dirHud, uiVis, crosshair, itemHud, autoSign, eatRepeat, containerBlur, z1yrPanel];
try {
	cookieLogin.boot();
	ensureHud(fpsHud, fpsHud.tag, "FPS显示");
	fpsHud.hud.enabled = true;
} catch (e) {}

const needGameTags = new Set(["fun_room_ip", "fun_get_uid", "fun_pos_print", "fun_locate_structure", "fun_adventure_place_break", "fun_inf_durability", "fun_goat_effect", "fun_attack_drops", "fun_auto_drop", "fun_aux_effect", "fun_msg_brush", "fun_bed_color", "fun_banner_color", "fun_ominous_bottle", "fun_kill_aura", "fun_chunk_display", "fun_self_attack", "fun_ghost_barrier", "fun_minimap", "fun_trade_unlock", "fun_kill_taunt", "fun_attack_taunt", "fun_batch_cmd", "fun_motion_blur", "fun_hide_clutter", "fun_custom_damage", "fun_scaffold", "fun_gyro_view", "fun_big_gyro", "fun_custom_camera", "fun_dir_hud", "fun_crosshair", "fun_item_hud", "fun_auto_sign", "fun_skin_tryon", "fun_eat_repeat", "fun_radar", "fun_container_blur", "fun_death_fx"]);

const onlyLobbyTags = new Set(["fun_bypass_server"]);

const __kusugPrev = {
	callModule: globalThis.onCallModuleEvent,
	tick: globalThis.onTickEvent,
	pyRpcRecv: globalThis.onPyRpcReceiveEvent
};

globalThis.onCallModuleEvent = function (args) {
	const p = __kusugPrev.callModule;
	if (p && !p.__kusug) {
		try { p(args); } catch (e) {}
	}
	if (!args) return;
	if (args.value === true && needGameTags.has(args.fun)) {
		let inGame = true;
		try { inGame = app.isInGame(); } catch (e) {}
		if (!inGame) {
			try { app.showToast("请进入局内后开启"); } catch (e) {}
			return;
		}
	}
	if (args.value === true && onlyLobbyTags.has(args.fun)) {
		let inGame = false;
		try { inGame = app.isInGame(); } catch (e) {}
		if (inGame) {
			try { app.showToast("请局外开启"); } catch (e) {}
			return;
		}
	}
	for (const m of modules) {
		if (m.onModuleEvent) { try { m.onModuleEvent(args); } catch (e) {} }
	}
};
globalThis.onCallModuleEvent.__kusug = true;

function onSAuthJsonHookEvent(cookie) {
	kusugNoticeConsume();
	likeUser.lastLoginUid = "";
	likeUser.start();
	for (const m of modules) {
		if (m.onSAuthJsonHook) {
			const r = m.onSAuthJsonHook(cookie);
			if (r !== undefined && r !== null) return r;
		}
	}
}

const __prevImGuiRender = globalThis.onImGuiRenderEvent;
globalThis.onImGuiRenderEvent = function () {
	if (__prevImGuiRender && !__prevImGuiRender.__kusug) {
		try { __prevImGuiRender(); } catch (e) {}
	}
	try { cookieLogin.onRender(); } catch (e) {}
};
globalThis.onImGuiRenderEvent.__kusug = true;

globalThis.onTickEvent = function () {
	const p = __kusugPrev.tick;
	if (p && !p.__kusug) {
		try { p(); } catch (e) {}
	}
	kusugNoticeConsume();   /* 公告补丁: 只在游戏主循环/宿主事件打, 杜绝工作线程竞态 */
	if (roomIp.wantQuery || roomIp.pendingAddr || roomIp.pendingErr) tickSafe(roomIp);
	if (posPrint.wantRun || posPrint.outbox.length) tickSafe(posPrint);
	if (noInvis.enabled) tickSafe(noInvis);
	if (getUid.wantSend || getUid.pendingEntries) tickSafe(getUid);
	if (moveCamera.enabled) tickSafe(moveCamera);
	if (msgBrush.enabled && msgBrush.text) tickSafe(msgBrush);
	if (sendControl.enabled && sendControl.meQueue.length) tickSafe(sendControl);
	if (batchCmd.enabled) tickSafe(batchCmd);
	if (motionBlur.enabled) tickSafe(motionBlur);
	if (itemHud.enabled) tickSafe(itemHud);
	if (dirHud.enabled) tickSafe(dirHud);
	if (crosshair.enabled) tickSafe(crosshair);
	if (radarHud.enabled) tickSafe(radarHud);
	if (checkCmd.enabled) tickSafe(checkCmd);
	if (structHud.enabled) tickSafe(structHud);
	if (killAura.enabled) tickSafe(killAura);
	if (scaffold.enabled) tickSafe(scaffold);
	if (nightVision.enabled) tickSafe(nightVision);
	if (locateStructure.queue) tickSafe(locateStructure);
	if (adventureEdit.pending) tickSafe(adventureEdit);
	if (infDurability.writesLeft > 0 || infDurability.dropDelay > 0) tickSafe(infDurability);
	if (goatEffect.writesLeft > 0 || goatEffect.dropDelay > 0) tickSafe(goatEffect);
	if (bedColor.writesLeft > 0 || bedColor.dropDelay > 0) tickSafe(bedColor);
	if (bannerColor.writesLeft > 0 || bannerColor.dropDelay > 0) tickSafe(bannerColor);
	if (ominousBottle.writesLeft > 0 || ominousBottle.dropDelay > 0) tickSafe(ominousBottle);
	if (customDamage.writesLeft > 0 || customDamage.dropDelay > 0) tickSafe(customDamage);
	if (attackDrops.pending || attackDrops.running) tickSafe(attackDrops);
	if (autoDrop.enabled) tickSafe(autoDrop);
	if (bigGyro.enabled) tickSafe(bigGyro);
	if (customCamera.enabled) tickSafe(customCamera);
	if (auxEffect.pending || auxEffect.dropDelay > 0) tickSafe(auxEffect);
	if (noHunger.enabled) tickSafe(noHunger);
	if (selfAttack.enabled) tickSafe(selfAttack);
	if (ghostBarrier.enabled) tickSafe(ghostBarrier);
	if (fpsHud.enabled) tickSafe(fpsHud);
	if (deathFx.enabled) tickSafe(deathFx);
	if (kuNative.loaded) kuNative.flushLog();
	if (javaWatermark.enabled) tickSafe(javaWatermark);
	if (autoSign.enabled) tickSafe(autoSign);
};
globalThis.onTickEvent.__kusug = true;

function onReadyEvent() {
	kusugNoticeConsume();
	antiKick.onReady();
	try { cookieLogin.onWorldEnter(); } catch (e) {}
}

function onLeaveGameEvent() {
	for (const m of modules) {
		if (m.onWorldExit) {
			try { m.onWorldExit(); } catch (e) {}
		}
	}
}

globalThis.onPyRpcReceiveEvent = function (id, data, json) {
	const p = __kusugPrev.pyRpcRecv;
	if (p && !p.__kusug) {
		try {
			const r = p(id, data, json);
			if (r) return r;
		} catch (e) {}
	}
	posPrint.onPyRpc(id, data);
	getUid.onPyRpc(id, data, json);
};
globalThis.onPyRpcReceiveEvent.__kusug = true;

likeUser.start();

const sendPacketModules = modules.filter(m => typeof m.onSendServerPacket === "function");

function onSendServerPacketEvent(id, name, bin) {
	for (const m of sendPacketModules) {
		try {
			const r = m.onSendServerPacket(id, name, bin);
			if (r) return r;
		} catch (e) {}
	}
	return false;
}

const buildBlockModules = modules.filter(m => typeof m.onPlayerBuildBlockEvent === "function");

function onPlayerBuildBlockEvent(playerId, x, y, z, face) {
	for (const m of buildBlockModules) {
		try {
			if (m.onPlayerBuildBlockEvent(playerId, x, y, z, face)) return true;
		} catch (e) {}
	}
	return false;
}

const sendChatModules = modules.filter(m => typeof m.onSendChatMessage === "function");

/* 自定义公告: 启动拉取服务端 notice.json, 类方法补丁 LoginAnnounce.update_announce_msg——
   公告+政策双 tab 文本嫁接(数据存类属性, 重载重拉只更新数据幂等)。无开关常驻;
   拉取失败静默(网易原公告照常); 下次登录弹窗生效。
   另 hook LoginMain.on_get_notice_result 清空已读列表——网易"contentUpdateTime 未见过才弹"
   导致补丁形同虚设(设备实证), 强制每次登录都弹出我们的公告 */
function kusugNoticePyEsc(s) {
	return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "").replace(/\n/g, "\\n");
}
function kusugNoticePy(d) {
	const title = kusugNoticePyEsc(d.title);
	const paras = (Array.isArray(d.content) ? d.content : [d.content]).filter(x => x != null && String(x) !== "").map(kusugNoticePyEsc);
	const ptitle = kusugNoticePyEsc(d.policy_title);
	const pparas = (Array.isArray(d.policy_content) ? d.policy_content : [d.policy_content]).filter(x => x != null && String(x) !== "").map(kusugNoticePyEsc);
	const tabA = kusugNoticePyEsc(d.tab_announce || "");
	const tabP = kusugNoticePyEsc(d.tab_policy || "");
	const mainTitle = kusugNoticePyEsc(d.main_title || "");
	const cq = paras.map(x => '"' + x + '"').join(", ");
	const pq = pparas.map(x => '"' + x + '"').join(", ");
	return `# -*- coding: utf-8 -*-
try:
    from gui_2d.ui.login.LoginAnnounce import LoginAnnounce
except Exception:
    LoginAnnounce = None

if LoginAnnounce is not None:
    LoginAnnounce._ks_notice = {'title': u"${title}", 'content': [${cq}], 'ptitle': u"${ptitle}", 'pcontent': [${pq}], 'tab_a': u"${tabA}", 'tab_p': u"${tabP}", 'main_title': u"${mainTitle}"}
    if not getattr(LoginAnnounce, '_ks_orig_ua', None):
        LoginAnnounce._ks_orig_ua = LoginAnnounce.update_announce_msg

        def _ks_hooked_ua(self):
            d = LoginAnnounce._ks_notice
            try:
                from gui_2d import GUI
                new_mode = bool(getattr(GUI.login_mgr, 'use_new_notice', True))
            except Exception:
                new_mode = True
            try:
                if new_mode:
                    self.notice_result['content'] = '<h1>' + d['title'] + '</h1>' + ''.join(['<p>' + c + '</p>' for c in d['content']])
                else:
                    self.notice_result['title'] = d['title']
                    self.notice_result['content'] = chr(10).join(d['content'])
                self.notice_result['policyNotes'] = {'title': d['ptitle'], 'content': chr(10).join(d['pcontent'])}
                if d.get('tab_a'):
                    self.announce_tab.set_tab_info(d['tab_a'], d['tab_a'], self.on_change_announce)
                if d.get('tab_p'):
                    self.policy_tab.set_tab_info(d['tab_p'], d['tab_p'], self.on_change_policy)
                if d.get('main_title'):
                    self.panel_text.text = d['main_title']
            except Exception:
                pass
            LoginAnnounce._ks_orig_ua(self)

        LoginAnnounce.update_announce_msg = _ks_hooked_ua

try:
    from gui_2d.ui.login.LoginMain import LoginMain
except Exception:
    LoginMain = None

if LoginMain is not None and not getattr(LoginMain, '_ks_orig_gnr', None):
    LoginMain._ks_orig_gnr = LoginMain.on_get_notice_result

    def _ks_hooked_gnr(self, response):
        try:
            from gui_2d.utils import config as _cfg
            _cfg.LocalConfig.login_announce_time = []
        except Exception:
            pass
        LoginMain._ks_orig_gnr(self, response)

    LoginMain.on_get_notice_result = _ks_hooked_gnr
`;
}
/* 设备崩溃实证(2026-09-16 native crash, 进程 0.09s): https 回调在工作线程直接 evalPython 补丁,
   与主线程登录/公告初始化竞态 → native sem_wait 空指针崩。载荷只存不跑, 补丁挪 onTickEvent 主循环执行 */
let kusugNoticePending = null;
function kusugNoticeFetch() {
	const url = "https://kusug.bibi.skin/notice.json?t=" + Date.now();
	let done = false;
	const wrap = (code, resp) => {
		if (done) return;
		done = true;
		try {
			if (code !== 200 || !resp) return;
			const d = JSON.parse(resp);
			if (!d || typeof d !== "object" || Array.isArray(d)) return;
			kusugNoticePending = kusugNoticePy(d);
		} catch (e) {}
	};
	try { https.get(url, {}, wrap); } catch (e) {}
	try { https.get(url, wrap); } catch (e) {}
}
try { kusugNoticeFetch(); } catch (e) {}
/* 消费挂三个时机: onSAuthJsonHookEvent(登录鉴权, 必在公告前)/onReadyEvent(插件就绪)/onTickEvent(兜底)——
   设备实证公告登录成功即弹, 单 tick 通道太晚("弹了但显示原文") */
function kusugNoticeConsume() {
	if (!kusugNoticePending) return;
	const npc = kusugNoticePending;
	kusugNoticePending = null;
	try { app.evalPython(npc); } catch (e) {}
}


function onSendChatMessageEvent(message) {
	for (const m of sendChatModules) {
		try {
			const r = m.onSendChatMessage(message);
			if (typeof r === "string") return r;
			if (r) return true;
		} catch (e) {}
	}
	return false;
}

const recvPacketModules = modules.filter(m => typeof m.onReceiveServerPacket === "function");

function onReceiveServerPacketEvent(id, name, bin) {
	for (const m of recvPacketModules) {
		try {
			const r = m.onReceiveServerPacket(id, name, bin);
			if (r) return r;
		} catch (e) {}
	}
	return null;
}

const attackModules = modules.filter(m => typeof m.onPlayerAttack === "function");

function onPlayerAttackEvent(playerId, targetId) {
	for (const m of attackModules) {
		try { m.onPlayerAttack(playerId, targetId); } catch (e) {}
	}
}

const behaviorModules = modules.filter(m => typeof m.onEntityBehavior === "function");

function onEntityBehaviorEvent(entityId, behaviorId, behaviorData) {
	for (const m of behaviorModules) {
		try { m.onEntityBehavior(entityId, behaviorId, behaviorData); } catch (e) {}
	}
}
