const fs = require("fs");
const app = require("app");
const os = require("os");
const gui = require("gui");

const SO_DIR = app.getResource("kusug/so");
const CACHE_DIR = "/data/data/com.netease.x19/cache/";
const REG_PATH = SO_DIR + "/loaded.json";
const PID_OFF = 4084n;

let busy = false;
const rt = {};

function toast(msg) {
	try { app.showToast(msg); } catch (e) {}
}

function regRead() {
	try {
		const o = JSON.parse(String(fs.read(REG_PATH) || ""));
		return o && typeof o === "object" ? o : {};
	} catch (e) { return {}; }
}
function regWrite(reg) {
	try { fs.write(REG_PATH, JSON.stringify(reg)); } catch (e) {}
}

function readStatus(bufAddr) {
	try {
		const head = new Uint8Array(os.readAddress(BigInt(bufAddr), 4));
		const len = head[0] | (head[1] << 8) | (head[2] << 16) | (head[3] << 24);
		if (len <= 0 || len > 4000) return "";
		const body = new Uint8Array(os.readAddress(BigInt(bufAddr) + 4n, len));
		let s = "";
		for (let i = 0; i < len; i++) s += String.fromCharCode(body[i]);
		return s;
	} catch (e) { return ""; }
}

function mapsText() {
	try {
		return String(fs.read("/proc/self/maps") || "");
	} catch (e) { return null; }
}

function isMapped(dst, maps) {
	if (maps === null) return null;
	return maps.indexOf(dst) !== -1;
}

function probeAlive(bufAddr) {
	try {
		const b = new Uint8Array(os.readAddress(BigInt(bufAddr) + PID_OFF, 8));
		const pid = (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
		const magic = b[4] === 0x4B && b[5] === 0x53 && b[6] === 0x47 && b[7] === 0x32;
		return magic && pid === (Number(os.getPid()) >>> 0);
	} catch (e) { return false; }
}

function ensureDir() {
	try { if (!fs.exists(SO_DIR)) fs.createDirectories(SO_DIR); } catch (e) {}
}

function scanSo() {
	const names = [];
	try {
		const files = fs.list(SO_DIR);
		for (const f of files) {
			if (f && f.name && /\.so$/i.test(f.name)) names.push(f.name);
		}
	} catch (e) {}
	names.sort();
	return names;
}

function rebuild() {
	const reg = regRead();
	const maps = mapsText();
	const names = {};
	for (const n of scanSo()) names[n] = true;
	for (const k in reg) names[k] = true;
	const out = {};
	for (const name in names) {
		const dst = CACHE_DIR + name;
		const mapped = isMapped(dst, maps);
		if (mapped === false) continue;
		const old = reg[name];
		if (mapped === null) {
			if (old) out[name] = old;
			continue;
		}
		let bufAddr = old && old.bufAddr ? old.bufAddr : null;
		if (!bufAddr || !probeAlive(bufAddr)) {
			try { bufAddr = String(os.syscall(dst, "__nb_buf")); } catch (e) { bufAddr = null; }
		}
		let stoppable = !!(old && old.stoppable);
		if (!old) {
			try {
				const h = os.dlopen(dst);
				rt[name] = { handle: h };
				stoppable = !!os.dlsym(h, "demo_stop");
			} catch (e) {}
		}
		out[name] = {
			dst: dst,
			bufAddr: bufAddr,
			state: old && old.state === "stopped" ? "stopped" : "loaded",
			stoppable: stoppable,
			proto: bufAddr && probeAlive(bufAddr) ? 2 : (bufAddr ? 1 : 0)
		};
	}
	regWrite(out);
	return out;
}

function withLock(fn) {
	if (busy) { toast("[SO] 正在处理中，稍候再点"); return; }
	busy = true;
	try { fn(); } catch (e) { toast("[SO] 异常: " + e); }
	busy = false;
}

function actLoad(name) {
	withLock(() => {
		const reg = regRead();
		const dst = CACHE_DIR + name;
		const it = reg[name];
		if (it && it.state !== "stopped" && isMapped(dst, mapsText()) !== false) {
			toast("[SO] " + name + " 已在运行");
			return;
		}
		if (it && it.state === "stopped" && isMapped(dst, mapsText()) !== false) {
			actReviveInner(reg, name, it);
			return;
		}
		const src = SO_DIR + "/" + name;
		let handle = null;
		try {
			fs.write(dst, fs.read(src, "binary"));
			handle = os.dlopen(dst);
		} catch (e) {
			toast("[SO] 加载失败: " + e);
			return;
		}
		rt[name] = { handle: handle };
		let bufAddr = null;
		try { bufAddr = String(os.syscall(dst, "__nb_buf")); } catch (e) {}
		let stoppable = false;
		try { stoppable = !!os.dlsym(handle, "demo_stop"); } catch (e) {}
		const proto = bufAddr && probeAlive(bufAddr) ? 2 : (bufAddr ? 1 : 0);
		reg[name] = { dst: dst, bufAddr: bufAddr, state: "loaded", stoppable: stoppable, proto: proto };
		regWrite(reg);
		const st = bufAddr ? readStatus(bufAddr) : "";
		toast("[SO] 已加载 " + name
			+ (proto === 1 ? "（旧版插件）" : (proto === 0 ? "（无状态缓冲）" : ""))
			+ (st ? " | " + st : ""));
	});
}

function actReviveInner(reg, name, it) {
	let r = -99;
	try { r = Number(os.syscall(it.dst || (CACHE_DIR + name), "demo_start")); } catch (e) {}
	if (r < 0) {
		toast("[SO] " + name + " 复活失败，需重启游戏");
		return;
	}
	it.state = "loaded";
	reg[name] = it;
	regWrite(reg);
	const st = it.bufAddr ? readStatus(it.bufAddr) : "";
	toast("[SO] 已复活 " + name + (st ? " | " + st : ""));
}

function actRevive(name) {
	withLock(() => {
		const reg = regRead();
		const it = reg[name];
		if (!it) { toast("[SO] " + name + " 未加载"); return; }
		if (it.state !== "stopped") { toast("[SO] " + name + " 已在运行"); return; }
		actReviveInner(reg, name, it);
	});
}

function stopOne(reg, name) {
	const it = reg[name];
	const dst = (it && it.dst) || (CACHE_DIR + name);
	const mapped = isMapped(dst, mapsText());
	if (mapped === false) {
		delete reg[name];
		return "gone";
	}
	if (it.state !== "stopped") {
		if (it.stoppable === false) return "nostop";
		let r;
		try { r = Number(os.syscall(dst, "demo_stop")); } catch (e) { return "nostop"; }
		if (r < 0) return "active";
		it.state = "stopped";
	}
	const h = rt[name] && rt[name].handle;
	if (h) {
		try { os.dlclose(h); } catch (e) {}
		rt[name].handle = null;
	} else {
		try {
			const h2 = os.dlopen(dst);
			os.dlclose(h2);
		} catch (e) {}
	}
	const mapped2 = isMapped(dst, mapsText());
	if (mapped2 === false) {
		delete reg[name];
		return "unloaded";
	}
	reg[name] = it;
	return "resident";
}

const STOP_MSG = {
	unloaded: "已卸载",
	resident: "已停用（驻留内存，重启释放）",
	active: "仍在工作，未停用",
	nostop: "不支持停用",
	gone: "本就不在内存"
};

function actStop(name) {
	withLock(() => {
		const reg = regRead();
		if (!reg[name]) { toast("[SO] " + name + " 未加载"); return; }
		const r = stopOne(reg, name);
		regWrite(reg);
		toast("[SO] " + name + " " + STOP_MSG[r]);
	});
}

function stopAll() {
	withLock(() => {
		const reg = regRead();
		const tally = { unloaded: 0, resident: 0, active: 0, nostop: 0, gone: 0 };
		const names = [];
		for (const k in reg) names.push(k);
		for (const name of names) tally[stopOne(reg, name)]++;
		regWrite(reg);
		const parts = [];
		if (tally.unloaded) parts.push("卸出 " + tally.unloaded);
		if (tally.resident) parts.push("驻留 " + tally.resident);
		if (tally.active) parts.push("仍活跃 " + tally.active);
		if (tally.nostop) parts.push("不可停 " + tally.nostop);
		toast("[SO] 全部停用完成" + (parts.length ? ": " + parts.join(" · ") : "，无在册插件"));
	});
}

function showDetail(name) {
	rebuild();
	const reg = regRead();
	const it = reg[name];
	let content, buttons;
	if (!it) {
		content = "状态：未加载";
		buttons = [{ text: "▶ 加载" }];
	} else if (it.state === "stopped") {
		content = "状态：已停用（内存驻留，重启游戏彻底释放）";
		const st = it.bufAddr ? readStatus(it.bufAddr) : "";
		if (st) content += "\n插件自述：" + st;
		buttons = [{ text: "▶ 复活（重新挂钩）" }];
	} else {
		content = "状态：运行中";
		const st = it.bufAddr ? readStatus(it.bufAddr) : "";
		if (st) content += "\n插件自述：" + st;
		buttons = [{ text: "■ 停用" }, { text: "↻ 刷新" }];
	}
	let form;
	try {
		form = JSON.stringify({ type: "form", title: name, content: content, buttons: buttons });
	} catch (e) { return; }
	try {
		gui.addForm(form, function (idx) {
			if (!it) { actLoad(name); showDetail(name); return; }
			if (it.state === "stopped") { actRevive(name); showDetail(name); return; }
			if (idx === 0) { actStop(name); showDetail(name); return; }
			showDetail(name);
		}, function () { showForm(); });
	} catch (e) {
		toast("[SO] 面板打开失败: " + e);
	}
}

function showForm() {
	ensureDir();
	rebuild();
	const names = scanSo();
	const reg = regRead();
	let managed = 0, running = 0;
	for (const k in reg) {
		managed++;
		if (reg[k].state !== "stopped") running++;
	}
	if (!names.length && !managed) {
		toast("[SO] 目录无 .so 文件: " + SO_DIR);
		return;
	}
	const buttons = [];
	for (const n of names) {
		const it = reg[n];
		let label = n;
		if (it && it.state === "stopped") label = "§e[驻留] §r" + n;
		else if (it) label = "§a[运行中] §r" + n;
		buttons.push({ text: label });
	}
	if (managed > 0) buttons.push({ text: "§c■ 全部停用（" + managed + "）§r" });
	const form = JSON.stringify({
		type: "form",
		title: "SO 加载器",
		content: "共 " + names.length + " 个插件 · 运行中 " + running + " · 点名称进控制页",
		buttons: buttons
	});
	try {
		gui.addForm(form, function (idx) {
			if (managed > 0 && idx >= names.length) {
				stopAll();
				showForm();
				return;
			}
			const name = names[idx];
			if (!name) return;
			showDetail(name);
		}, function () {});
	} catch (e) {
		toast("[SO] 表单打开失败: " + e);
	}
}

showForm();
