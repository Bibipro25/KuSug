const app = require("app");
const minecraft = require("minecraft");
const fs = require("fs");
const packet = require("packet");
const menu = require("menu");

let resDir = ".";
try { resDir = app.getResource(); } catch (e) {}
try { fs.createDirectories(resDir + "/KuSug"); } catch (e) {}

function safeRegFun(tag) {
	try { menu.regFun(tag); } catch (e) {}
}

[
	"fun_pkt_send_listen", "fun_pkt_recv_listen", "fun_pkt_chat_print", "fun_pkt_file_live",
	"fun_pkt_filter", "fun_pkt_block_send", "fun_pkt_block_recv", "fun_pkt_replace",
	"fun_pkt_save", "fun_pkt_clear", "fun_pkt_stats", "fun_pkt_find", "fun_pkt_diff",
	"fun_pkt_replay", "fun_pkt_craft"
].forEach(safeRegFun);

const STORE_MAX = 8192;
const HEX_FILE_MAX = 4096;

const mgr = {
	sendListen: false,
	recvListen: false,
	chatPrint: false,
	fileLive: false,
	filterIds: new Set(),
	filterMode: 0,
	blockSendOn: false,
	blockRecvOn: false,
	blockSendIds: new Set(),
	blockRecvIds: new Set(),
	replaceOn: false,
	replaceMode: 0,
	rules: [],
	ruleHits: 0,
	records: [],
	seq: 0,
	cap: 5000,
	droppedSend: 0,
	droppedRecv: 0,
	pendingChats: [],
	pendingActions: [],
	pendingResend: [],
	jobs: [],
	sendingDepth: 0,
	liveLines: [],
	livePath: "",
	liveInit: false,
	findHex: "",
	diffSeqs: "",
	replaySeq: "",
	replayHex: "",
	replayUseRules: false,
	replayDir: "server",
	craftId: "",
	craftHex: "",
	craftTimes: "1",
	craftGap: 1,
	craftDir: "server"
};

function utf8(u8, start, len) {
	let s = "";
	const end = start + len;
	let i = start;
	while (i < end) {
		const b = u8[i++];
		if (b < 0x80) {
			s += String.fromCharCode(b);
		} else if (b < 0xE0 && i < end) {
			s += String.fromCharCode(((b & 31) << 6) | (u8[i++] & 63));
		} else if (b < 0xF0 && i + 1 < end) {
			s += String.fromCharCode(((b & 15) << 12) | ((u8[i++] & 63) << 6) | (u8[i++] & 63));
		} else if (i + 2 < end) {
			let cp = ((b & 7) << 18) | ((u8[i++] & 63) << 12) | ((u8[i++] & 63) << 6) | (u8[i++] & 63);
			cp -= 0x10000;
			s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 1023));
		} else {
			break;
		}
	}
	return s;
}

function makeReader(u8) {
	const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
	let pos = 0;
	function need(n) {
		if (pos + n > u8.length) throw new Error("eof");
	}
	return {
		get left() { return u8.length - pos; },
		u8() { need(1); const v = dv.getUint8(pos); pos += 1; return v; },
		bool() { return this.u8() !== 0; },
		i32() { need(4); const v = dv.getInt32(pos, true); pos += 4; return v; },
		u32() { need(4); const v = dv.getUint32(pos, true); pos += 4; return v; },
		f32() { need(4); const v = dv.getFloat32(pos, true); pos += 4; return v; },
		f64() { need(8); const v = dv.getFloat64(pos, true); pos += 8; return v; },
		uvarint() {
			let v = 0, s = 0;
			for (;;) {
				need(1);
				const b = dv.getUint8(pos); pos += 1;
				v += (b & 127) * Math.pow(2, s);
				if (!(b & 128)) return v;
				s += 7;
				if (s > 35) throw new Error("varint");
			}
		},
		uvarlong() {
			let v = 0n, s = 0n;
			for (;;) {
				need(1);
				const b = dv.getUint8(pos); pos += 1;
				v |= BigInt(b & 127) << s;
				if (!(b & 128)) return v;
				s += 7n;
				if (s > 70n) throw new Error("varlong");
			}
		},
		bytes(n) { need(n); const r = u8.slice(pos, pos + n); pos += n; return r; },
		str() { const n = this.uvarint(); const b = this.bytes(n); return utf8(b, 0, b.length); },
		skip(n) { need(n); pos += n; }
	};
}

function f1(v) { return v.toFixed(1); }
function f2(v) { return v.toFixed(2); }
function q(s) { return '"' + String(s).slice(0, 60) + '"'; }

function parse144(u8) {
	const r = makeReader(u8);
	const pitch = r.f32(), yaw = r.f32();
	const px = r.f32(), py = r.f32(), pz = r.f32();
	const mx = r.f32(), mz = r.f32();
	const head = r.f32();
	const input = r.uvarlong();
	const bits = [];
	for (let i = 0n; i < 64n; i++) {
		if ((input >> i) & 1n) bits.push(Number(i));
	}
	const im = r.uvarint(), pm = r.uvarint(), nim = r.uvarint();
	const irx = r.f32(), iry = r.f32();
	const tick = r.uvarint();
	let delta = "?";
	if (r.left >= 12) {
		delta = f2(r.f32()) + "," + f2(r.f32()) + "," + f2(r.f32());
	}
	return "pos=(" + f2(px) + "," + f2(py) + "," + f2(pz) + ") delta=(" + delta + ") rot=(" + f1(pitch) + "," + f1(yaw) + "," + f1(head) + ") move=(" + f2(mx) + "," + f2(mz) + ") irot=(" + f1(irx) + "," + f1(iry) + ") input=[" + bits.join(",") + "] mode=" + im + "/" + pm + "/" + nim + " tick=" + tick;
}

function parse19(u8) {
	const r = makeReader(u8);
	const rid = r.uvarlong();
	const px = r.f32(), py = r.f32(), pz = r.f32();
	const pitch = r.f32(), yaw = r.f32(), head = r.f32();
	const mode = r.u8();
	const ground = r.u8();
	let out = "rid=" + rid + " pos=(" + f2(px) + "," + f2(py) + "," + f2(pz) + ") rot=(" + f1(pitch) + "," + f1(yaw) + "," + f1(head) + ") mode=" + mode + " ground=" + ground;
	try { out += " riding=" + r.uvarlong(); } catch (e) {}
	if (mode === 2) {
		try { out += " cause=" + r.i32() + " srcType=" + r.i32(); } catch (e) {}
	}
	try { out += " tick=" + r.uvarlong(); } catch (e) {}
	return out;
}

function parse9(u8) {
	const r = makeReader(u8);
	const type = r.u8();
	const nt = r.bool();
	const src = r.str();
	const msg = r.str();
	let out = "type=" + type + " trans=" + (nt ? 1 : 0) + " from=" + q(src) + " msg=" + q(msg);
	try {
		const pc = r.uvarint();
		if (pc <= 8) {
			const ps = [];
			for (let i = 0; i < pc; i++) ps.push(r.str());
			if (pc) out += " params=" + JSON.stringify(ps);
		}
		out += " xuid=" + q(r.str());
		out += " chatId=" + q(r.str());
	} catch (e) {}
	return out;
}

function parse75(u8) {
	const r = makeReader(u8);
	const cmd = r.str();
	let out = "cmd=" + q(cmd);
	try { out += " originType=" + r.uvarint(); } catch (e) { return out; }
	try { r.skip(16); } catch (e) { return out; }
	try { out += " req=" + q(r.str()); } catch (e) { return out; }
	try { out += " internal=" + r.u8(); } catch (e) {}
	return out;
}

function parseAuto(u8) {
	const strs = [];
	let run = -1;
	for (let i = 0; i <= u8.length; i++) {
		const ok = i < u8.length && u8[i] >= 0x20 && u8[i] <= 0x7E;
		if (ok && run < 0) run = i;
		if (!ok && run >= 0) {
			if (i - run >= 4 && strs.length < 6) strs.push(utf8(u8, run, i - run).slice(0, 48));
			run = -1;
		}
	}
	const vars = [];
	try {
		const r = makeReader(u8);
		for (let i = 0; i < 4 && r.left > 0; i++) vars.push(r.uvarint());
	} catch (e) {}
	let out = "";
	if (vars.length) out += "uvar=[" + vars.join(",") + "] ";
	if (strs.length) out += "str=" + JSON.stringify(strs);
	if (!out) out = "(无启发结果)";
	return out;
}

const parsers = { 144: parse144, 19: parse19, 9: parse9, 75: parse75 };

function parseSummary(id, u8) {
	const p = parsers[id];
	try {
		if (p) return p(u8);
		return parseAuto(u8);
	} catch (e) {
		try { return parseAuto(u8); } catch (e2) { return "(解析失败)"; }
	}
}

function hexDump(u8, max) {
	const n = Math.min(u8.length, max || u8.length);
	const lines = [];
	for (let i = 0; i < n; i += 16) {
		let hex = "", asc = "";
		for (let j = 0; j < 16; j++) {
			const k = i + j;
			if (k < n) {
				const b = u8[k];
				hex += b.toString(16).padStart(2, "0") + " ";
				asc += (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : ".";
			} else {
				hex += "   ";
			}
		}
		lines.push(i.toString(16).padStart(4, "0") + "  " + hex + " " + asc);
	}
	if (n < u8.length) lines.push("... 共 " + u8.length + " 字节，仅显示前 " + n);
	return lines.join("\n");
}

function ts() {
	const d = new Date();
	const p = (n, l) => String(n).padStart(l || 2, "0");
	return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()) + "." + p(d.getMilliseconds(), 3);
}

function stamp() {
	const d = new Date();
	const p = (n) => String(n).padStart(2, "0");
	return p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function dirMark(dir) { return dir === "send" ? "C->S" : "S->C"; }

function chatLine(rec) {
	return "§b[包] §7#" + rec.seq + " " + dirMark(rec.dir) + (rec.note ? " §e" + rec.note : "") + " §f" + rec.name + "(" + rec.id + ") §7" + rec.len + "B §f" + rec.summary.slice(0, 100);
}

function formatFile(rec) {
	return "#" + rec.seq + " " + rec.time + " " + dirMark(rec.dir) + " " + rec.name + "(" + rec.id + ") len=" + rec.len + (rec.truncated ? " 已截断" : "") + (rec.note ? " [" + rec.note + "]" : "") + "\n" + rec.summary + "\n" + hexDump(rec.bytes, HEX_FILE_MAX) + "\n\n";
}

function passFilter(id) {
	if (mgr.filterMode === 1) return mgr.filterIds.has(id);
	if (mgr.filterMode === 2) return !mgr.filterIds.has(id);
	return true;
}

function toView(bin) {
	try {
		if (bin instanceof ArrayBuffer) return new Uint8Array(bin);
		if (bin && bin.buffer) return new Uint8Array(bin.buffer, bin.byteOffset || 0, bin.byteLength !== undefined ? bin.byteLength : bin.length);
	} catch (e) {}
	return null;
}

function capture(dir, id, name, bin, note) {
	const u8 = toView(bin);
	if (!u8) return;
	const full = u8.length;
	const stored = full > STORE_MAX ? u8.slice(0, STORE_MAX) : u8.slice(0);
	const rec = {
		seq: ++mgr.seq,
		dir: dir,
		id: id,
		name: String(name == null ? "?" : name),
		len: full,
		truncated: full > STORE_MAX,
		bytes: stored,
		summary: parseSummary(id, stored),
		time: ts(),
		note: note || ""
	};
	mgr.records.push(rec);
	if (mgr.records.length > mgr.cap) mgr.records.splice(0, mgr.records.length - mgr.cap);
	if (mgr.chatPrint) mgr.pendingChats.push(chatLine(rec));
	if (mgr.fileLive) mgr.liveLines.push(formatFile(rec));
}

function say(msg) {
	try { minecraft.clientMessage("§b[包] " + msg); } catch (e) {}
}

function toast(msg) {
	try { app.showToast(msg); } catch (e) {}
}

function hexToU8(str) {
	const cleaned = String(str === undefined || str === null ? "" : str).replace(/0x/gi, "").replace(/[^0-9a-fA-F]/g, "");
	if (!cleaned.length || cleaned.length % 2) return null;
	const u8 = new Uint8Array(cleaned.length / 2);
	for (let i = 0; i < u8.length; i++) u8[i] = parseInt(cleaned.substr(i * 2, 2), 16);
	return u8;
}

function hexOf(u8, max) {
	const n = Math.min(u8.length, max || 32);
	let s = "";
	for (let i = 0; i < n; i++) s += u8[i].toString(16).padStart(2, "0") + " ";
	if (n < u8.length) s += "..";
	return s.trim();
}

function parseIdList(text) {
	const s = new Set();
	if (text === undefined || text === null) return s;
	const parts = String(text).split(/[^0-9]+/);
	for (const part of parts) {
		if (!part) continue;
		const n = Number(part);
		if (Number.isInteger(n) && n >= 0 && n <= 512) s.add(n);
	}
	return s;
}

function parseRules(text) {
	const rules = [];
	for (const rawLine of String(text === undefined || text === null ? "" : text).split(/\r?\n/)) {
		const t = rawLine.trim();
		if (!t) continue;
		const parts = t.split(/[\s,，:]+/).filter(x => x);
		if (parts.length < 4) continue;
		const d = parts[0].toUpperCase();
		if (d !== "S" && d !== "R" && d !== "A") continue;
		const id = Number(parts[1]);
		if (!Number.isInteger(id) || id < 0 || id > 512) continue;
		const find = parts[2] === "*" ? null : hexToU8(parts[2]);
		const rep = hexToU8(parts[3]);
		if (rep === null) continue;
		if (parts[2] !== "*" && (find === null || !find.length)) continue;
		rules.push({ dir: d, id: id, find: find, rep: rep });
	}
	return rules;
}

function findAll(u8, pat) {
	const idxs = [];
	if (!pat.length || pat.length > u8.length) return idxs;
	outer: for (let i = 0; i + pat.length <= u8.length && idxs.length < 16; i++) {
		for (let j = 0; j < pat.length; j++) {
			if (u8[i + j] !== pat[j]) continue outer;
		}
		idxs.push(i);
		i += pat.length - 1;
	}
	return idxs;
}

function applySendRules(id, bin) {
	if (!mgr.replaceOn || !mgr.rules.length) return null;
	const matched = mgr.rules.filter(r => r.id === id && (r.dir === "S" || r.dir === "A"));
	if (!matched.length) return null;
	const view = toView(bin);
	if (!view || !view.length) return null;
	let patched = false, block = false, resend = null;
	const notes = [];
	for (const rule of matched) {
		if (rule.find === null) {
			if (rule.rep.length === view.length) {
				view.set(rule.rep);
				patched = true;
				notes.push("整包同长改写");
			} else if (mgr.replaceMode === 1) {
				resend = rule.rep.slice(0);
				block = true;
				notes.push("整包拦发新");
			}
			continue;
		}
		const idxs = findAll(view, rule.find);
		if (!idxs.length) continue;
		if (rule.find.length === rule.rep.length) {
			for (const ix of idxs) view.set(rule.rep, ix);
			patched = true;
			notes.push("原位x" + idxs.length);
		} else if (mgr.replaceMode === 1 && !block) {
			const ix = idxs[0];
			const out = new Uint8Array(view.length - rule.find.length + rule.rep.length);
			out.set(view.slice(0, ix), 0);
			out.set(rule.rep, ix);
			out.set(view.slice(ix + rule.find.length), ix + rule.rep.length);
			resend = out;
			block = true;
			notes.push("变长拦发@" + ix);
		}
	}
	if (!patched && !block) return null;
	mgr.ruleHits++;
	return { patched: patched, block: block, resend: resend, note: notes.join("/") };
}

function applyRecvRules(id, bin) {
	if (!mgr.replaceOn || !mgr.rules.length) return null;
	const matched = mgr.rules.filter(r => r.id === id && (r.dir === "R" || r.dir === "A"));
	if (!matched.length) return null;
	const view = toView(bin);
	if (!view || !view.length) return null;
	const r = offlineApply(id, view, "R");
	if (!r.note) return null;
	mgr.ruleHits++;
	if (r.bytes.length === view.length) view.set(r.bytes);
	return { bytes: r.bytes, note: r.note };
}

function offlineApply(id, src, dirChar) {
	let cur = src.slice(0);
	const notes = [];
	for (const rule of mgr.rules) {
		if (rule.id !== id || (rule.dir !== dirChar && rule.dir !== "A")) continue;
		if (rule.find === null) {
			cur = rule.rep.slice(0);
			notes.push("整包");
			continue;
		}
		const idxs = findAll(cur, rule.find);
		if (!idxs.length) continue;
		if (rule.find.length === rule.rep.length) {
			for (const ix of idxs) cur.set(rule.rep, ix);
			notes.push("改写x" + idxs.length);
		} else {
			const ix = idxs[0];
			const out = new Uint8Array(cur.length - rule.find.length + rule.rep.length);
			out.set(cur.slice(0, ix), 0);
			out.set(rule.rep, ix);
			out.set(cur.slice(ix + rule.find.length), ix + rule.rep.length);
			cur = out;
			notes.push("变长@" + ix);
		}
	}
	return { bytes: cur, note: notes.join("/") };
}

function sendRaw(id, bytes, dir) {
	mgr.sendingDepth++;
	try {
		const p = new packet.Packet();
		p.buffer = bytes.slice(0).buffer;
		return dir === "local" ? p.sendToLocal(id) : p.sendToServer(id);
	} finally {
		mgr.sendingDepth--;
	}
}

function doAction(a) {
	if (a.type === "save") {
		if (!mgr.records.length) return say("§c记录为空");
		const parts = ["数据包管理器导出 " + ts() + " 共 " + mgr.records.length + " 条\n\n"];
		for (const r of mgr.records) parts.push(formatFile(r));
		const file = "数据包_保存_" + stamp() + ".txt";
		try {
			fs.write(resDir + "/KuSug/" + file, parts.join(""), false);
		} catch (e) { return say("§c保存失败: " + e.message); }
		say("§a已保存 " + mgr.records.length + " 条 -> KuSug/" + file);
		toast("已保存到 KuSug 目录");
		return;
	}
	if (a.type === "clear") {
		mgr.records.length = 0;
		say("§a已清空记录");
		toast("记录已清空");
		return;
	}
	if (a.type === "stats") {
		const map = new Map();
		for (const r of mgr.records) {
			const k = dirMark(r.dir) + " " + r.name + "(" + r.id + ")";
			map.set(k, (map.get(k) || 0) + 1);
		}
		const arr = [...map.entries()].sort((x, y) => y[1] - x[1]);
		say("§f缓冲 " + mgr.records.length + " 条 §7| 拦截丢弃: 发" + mgr.droppedSend + " 收" + mgr.droppedRecv + " | 替换命中 " + mgr.ruleHits + " | 规则 " + mgr.rules.length + " 条");
		for (const e of arr.slice(0, 10)) say("§7" + e[0] + " §fx" + e[1]);
		if (!mgr.records.length) say("§7（缓冲为空，以上为累计计数）");
		return;
	}
	if (a.type === "find") {
		const pat = hexToU8(a.hex);
		if (pat === null || !pat.length) return say("§c查找HEX非法: " + a.hex);
		const hits = [];
		for (const r of mgr.records) {
			const idxs = findAll(r.bytes, pat);
			if (idxs.length) hits.push("#" + r.seq + " " + dirMark(r.dir) + " " + r.name + " @" + idxs.slice(0, 5).join(",") + (idxs.length > 5 ? ".." : ""));
		}
		say("§f查找 " + hexOf(pat) + " §7命中 " + hits.length + " 条");
		for (const h of hits.slice(0, 20)) say("§7" + h);
		if (hits.length > 20) say("§7...其余 " + (hits.length - 20) + " 条省略");
		return;
	}
	if (a.type === "diff") {
		const nums = String(a.seqs || "").split(/[^0-9]+/).filter(x => x).map(Number);
		if (nums.length < 2) return say("§c对比序号非法: " + a.seqs);
		const ra = mgr.records.find(r => r.seq === nums[0]);
		const rb = mgr.records.find(r => r.seq === nums[1]);
		if (!ra) return say("§c未找到记录 #" + nums[0]);
		if (!rb) return say("§c未找到记录 #" + nums[1]);
		const A = ra.bytes, B = rb.bytes;
		const n = Math.min(A.length, B.length);
		const diffs = [];
		for (let i = 0; i < n; i++) {
			if (A[i] !== B[i]) diffs.push(i);
		}
		say("§f#" + ra.seq + " vs #" + rb.seq + " §7长度 " + A.length + "/" + B.length + " 差异 " + diffs.length + " 处" + (A.length !== B.length ? "（尾部长度不同）" : ""));
		for (const i of diffs.slice(0, 20)) {
			say("§7" + i.toString(16).padStart(4, "0") + ": " + A[i].toString(16).padStart(2, "0") + " -> " + B[i].toString(16).padStart(2, "0"));
		}
		if (diffs.length > 20) say("§7...其余 " + (diffs.length - 20) + " 处省略");
		return;
	}
	if (a.type === "replay") {
		const seq = Number(a.seq);
		if (!Number.isInteger(seq) || seq <= 0) return say("§c序号非法: " + a.seq);
		const rec = mgr.records.find(r => r.seq === seq);
		if (!rec) return say("§c未找到记录 #" + seq + "（缓冲内最早 #" + (mgr.records.length ? mgr.records[0].seq : "?") + "）");
		let body = rec.bytes;
		let note = "";
		if (String(a.hex || "").trim()) {
			const u8 = hexToU8(a.hex);
			if (u8 === null) return say("§c覆盖HEX非法");
			body = u8;
			note = "hex覆盖";
		} else if (rec.truncated) {
			return say("§c记录 #" + seq + " 已截断，原样重放被拒绝（可用HEX覆盖）");
		}
		if (a.useRules && mgr.rules.length) {
			const r = offlineApply(rec.id, body, a.dir === "local" ? "R" : "S");
			body = r.bytes;
			if (r.note) note = (note ? note + "+" : "") + "规则:" + r.note;
		}
		let out = null;
		try {
			out = sendRaw(rec.id, body, a.dir);
		} catch (e) { return say("§c重放异常: " + e.message); }
		say((out ? "§a" : "§c") + "重放 #" + seq + " " + rec.name + "(" + rec.id + ") " + body.length + "B -> " + (a.dir === "local" ? "本地" : "服务器") + " 返回:" + out + (note ? " §7[" + note + "]" : ""));
		return;
	}
	if (a.type === "craft") {
		const id = Number(a.id);
		if (!Number.isInteger(id) || id < 0 || id > 512) return say("§c包ID非法: " + a.id);
		const u8 = hexToU8(a.hex);
		if (u8 === null) return say("§cHEX 非法（需偶数个十六进制字符）");
		if (u8.length > 65536) return say("§c包体过长");
		let times = Number(a.times);
		if (!Number.isInteger(times) || times < 1) times = 1;
		if (times > 1000) times = 1000;
		const gap = Math.max(0, Math.min(40, Math.floor(a.gap || 0)));
		mgr.jobs.push({ id: id, bytes: u8, dir: a.dir, left: times, gap: gap, wait: 0 });
		say("§a已入队 id=" + id + " " + u8.length + "B x" + times + (times > 1 ? " 间隔" + gap + "tick" : "") + " -> " + (a.dir === "local" ? "本地" : "服务器"));
		return;
	}
}

function onArgs(args) {
	if (!args) return;
	let v = pick(args, "pkt_filter_ids");
	if (v !== undefined) mgr.filterIds = parseIdList(v);
	v = pick(args, "pkt_block_send_ids");
	if (v !== undefined) mgr.blockSendIds = parseIdList(v);
	v = pick(args, "pkt_block_recv_ids");
	if (v !== undefined) mgr.blockRecvIds = parseIdList(v);
	v = pick(args, "pkt_replace_rules");
	if (v !== undefined) mgr.rules = parseRules(v);
	v = pick(args, "pkt_find_hex");
	if (v !== undefined) mgr.findHex = String(v);
	v = pick(args, "pkt_diff_seqs");
	if (v !== undefined) mgr.diffSeqs = String(v);
	v = pick(args, "pkt_replay_seq");
	if (v !== undefined) mgr.replaySeq = String(v);
	v = pick(args, "pkt_replay_hex");
	if (v !== undefined) mgr.replayHex = String(v);
	v = pick(args, "pkt_craft_id");
	if (v !== undefined) mgr.craftId = String(v);
	v = pick(args, "pkt_craft_hex");
	if (v !== undefined) mgr.craftHex = String(v);
	v = pick(args, "pkt_craft_times");
	if (v !== undefined) mgr.craftTimes = String(v);
	v = radioNum(args, "pkt_filter_mode");
	if (v !== undefined && v >= 0 && v <= 2) mgr.filterMode = v;
	v = radioNum(args, "pkt_replace_mode");
	if (v !== undefined && v >= 0 && v <= 1) mgr.replaceMode = v;
	v = radioNum(args, "pkt_replay_dir");
	if (v !== undefined) mgr.replayDir = v === 1 ? "local" : "server";
	v = radioNum(args, "pkt_craft_dir");
	if (v !== undefined) mgr.craftDir = v === 1 ? "local" : "server";
	v = pick(args, "pkt_buf_size");
	if (v !== undefined) {
		const n = Number(v);
		if (!isNaN(n) && n >= 100) {
			mgr.cap = Math.min(20000, Math.floor(n));
			if (mgr.records.length > mgr.cap) mgr.records.splice(0, mgr.records.length - mgr.cap);
		}
	}
	v = pick(args, "pkt_craft_gap");
	if (v !== undefined) {
		const n = Number(v);
		if (!isNaN(n) && n >= 1) mgr.craftGap = Math.min(40, Math.floor(n));
	}
	v = pick(args, "pkt_replay_rules");
	if (v !== undefined) mgr.replayUseRules = Boolean(v);
	updateRecvHook();
	if (typeof args.fun !== "string" || !("value" in args)) return;
	const on = Boolean(args.value);
	switch (args.fun) {
		case "fun_pkt_send_listen":
			mgr.sendListen = on;
			toast(on ? "发包监听已开" : "发包监听已关");
			break;
		case "fun_pkt_recv_listen":
			mgr.recvListen = on;
			toast(on ? "收包监听已开（该事件已知可能崩溃）" : "收包监听已关");
			break;
		case "fun_pkt_chat_print":
			mgr.chatPrint = on;
			toast(on ? "聊天栏显示已开" : "聊天栏显示已关");
			break;
		case "fun_pkt_file_live":
			mgr.fileLive = on;
			if (on) {
				mgr.livePath = resDir + "/KuSug/数据包_实时_" + stamp() + ".txt";
				mgr.liveInit = false;
				toast("实时记录: KuSug/数据包_实时_" + stamp() + ".txt");
			} else {
				toast("实时记录已关");
			}
			break;
		case "fun_pkt_block_send":
			mgr.blockSendOn = on;
			toast(on ? "发包拦截已开" : "发包拦截已关");
			break;
		case "fun_pkt_block_recv":
			mgr.blockRecvOn = on;
			toast(on ? "收包拦截已开（该事件已知可能崩溃）" : "收包拦截已关");
			break;
		case "fun_pkt_replace":
			mgr.replaceOn = on;
			toast(on ? "字节替换已开（" + mgr.rules.length + " 条规则）" : "字节替换已关");
			break;
		case "fun_pkt_save":
			if (on) { mgr.pendingActions.push({ type: "save" }); toast("保存已排队"); }
			break;
		case "fun_pkt_clear":
			if (on) { mgr.pendingActions.push({ type: "clear" }); toast("清空已排队"); }
			break;
		case "fun_pkt_stats":
			if (on) { mgr.pendingActions.push({ type: "stats" }); toast("统计已排队"); }
			break;
		case "fun_pkt_find":
			if (on) { mgr.pendingActions.push({ type: "find", hex: mgr.findHex }); toast("查找已排队"); }
			break;
		case "fun_pkt_diff":
			if (on) { mgr.pendingActions.push({ type: "diff", seqs: mgr.diffSeqs }); toast("对比已排队"); }
			break;
		case "fun_pkt_replay":
			if (on) { mgr.pendingActions.push({ type: "replay", seq: mgr.replaySeq, hex: mgr.replayHex, useRules: mgr.replayUseRules, dir: mgr.replayDir }); toast("重放已排队"); }
			break;
		case "fun_pkt_craft":
			if (on) { mgr.pendingActions.push({ type: "craft", id: mgr.craftId, hex: mgr.craftHex, times: mgr.craftTimes, gap: mgr.craftGap, dir: mgr.craftDir }); toast("构造包已排队"); }
			break;
	}
	updateRecvHook();
}

function capKey(k) {
	return k.replace(/(^|_)([a-z])/g, (m, p, c) => p + c.toUpperCase());
}

function pick(args, k) {
	if (args[k] !== undefined) return args[k];
	const c = capKey(k);
	if (args[c] !== undefined) return args[c];
	return undefined;
}

function radioNum(args, base) {
	const v = pick(args, base);
	if (typeof v === "string") {
		const m = new RegExp("^" + base + "_(\\d+)$").exec(v);
		if (m) return Number(m[1]);
	}
	for (const k in args) {
		const m = new RegExp("^" + base + "_(\\d+)$").exec(k);
		if (m && args[k] === true) return Number(m[1]);
	}
	return undefined;
}

const __pktPrev = {
	callModule: globalThis.onCallModuleEvent,
	tick: globalThis.onTickEvent,
	send: globalThis.onSendServerPacketEvent,
	recv: undefined
};

let recvMounted = false;

function pktRecvHandler(id, name, bin) {
	let r;
	const p = __pktPrev.recv;
	if (p && !p.__pktMgr) {
		try { r = p(id, name, bin); } catch (e) {}
	}
	if (mgr.sendingDepth > 0) return r === undefined ? null : r;
	try {
		if (mgr.blockRecvOn && mgr.blockRecvIds.has(id)) {
			mgr.droppedRecv++;
			capture("recv", id, name, bin, "已拦截");
			return true;
		}
		const rr = applyRecvRules(id, bin);
		if (rr) {
			capture("recv", id, name, rr.bytes, "重构:" + rr.note);
			return rr.bytes.slice(0).buffer;
		}
		if (mgr.recvListen && passFilter(id)) capture("recv", id, name, bin, "");
	} catch (e) {}
	return r === undefined ? null : r;
}
pktRecvHandler.__pktMgr = true;

function wantRecv() {
	if (mgr.recvListen || mgr.blockRecvOn) return true;
	if (mgr.replaceOn) {
		for (const r of mgr.rules) {
			if (r.dir === "R" || r.dir === "A") return true;
		}
	}
	return false;
}

function updateRecvHook() {
	const want = wantRecv();
	if (want && !recvMounted) {
		recvMounted = true;
		__pktPrev.recv = globalThis.onReceiveServerPacketEvent;
		globalThis.onReceiveServerPacketEvent = pktRecvHandler;
		toast("收包钩子已挂载（该事件已知易崩溃）");
		return;
	}
	if (!want && recvMounted) {
		recvMounted = false;
		if (globalThis.onReceiveServerPacketEvent === pktRecvHandler) {
			if (__pktPrev.recv === undefined) {
				try {
					delete globalThis.onReceiveServerPacketEvent;
				} catch (e) {
					globalThis.onReceiveServerPacketEvent = undefined;
				}
			} else {
				globalThis.onReceiveServerPacketEvent = __pktPrev.recv;
			}
		}
		toast("收包钩子已卸载");
	}
}

globalThis.onCallModuleEvent = function (args) {
	const p = __pktPrev.callModule;
	if (p && !p.__pktMgr) {
		try { p(args); } catch (e) {}
	}
	try { onArgs(args); } catch (e) {}
};
globalThis.onCallModuleEvent.__pktMgr = true;

globalThis.onTickEvent = function () {
	const p = __pktPrev.tick;
	if (p && !p.__pktMgr) {
		try { p(); } catch (e) {}
	}
	try {
		let n = 0;
		while (mgr.pendingChats.length && n < 6) {
			try { minecraft.clientMessage(mgr.pendingChats.shift()); } catch (e) {}
			n++;
		}
		if (mgr.pendingChats.length > 200) {
			const drop = mgr.pendingChats.length;
			mgr.pendingChats.length = 0;
			try { minecraft.clientMessage("§b[包] §c显示过载，已丢弃 " + drop + " 条积压"); } catch (e) {}
		}
		if (mgr.fileLive && mgr.liveLines.length) {
			const txt = mgr.liveLines.join("");
			mgr.liveLines.length = 0;
			try {
				fs.write(mgr.livePath, txt, mgr.liveInit);
				mgr.liveInit = true;
			} catch (e) {}
		}
		while (mgr.pendingActions.length) {
			const a = mgr.pendingActions.shift();
			try { doAction(a); } catch (e) {}
		}
		while (mgr.pendingResend.length) {
			const r = mgr.pendingResend.shift();
			mgr.jobs.push({ id: r.id, bytes: r.bytes, dir: "server", left: 1, gap: 0, wait: 0 });
		}
		for (let i = mgr.jobs.length - 1; i >= 0; i--) {
			const j = mgr.jobs[i];
			if (j.wait > 0) { j.wait--; continue; }
			let out = null;
			let err = null;
			try {
				out = sendRaw(j.id, j.bytes, j.dir);
			} catch (e) { err = e; }
			if (err) {
				say("§c发送异常 id=" + j.id + ": " + err.message);
				mgr.jobs.splice(i, 1);
				continue;
			}
			j.left--;
			if (j.left <= 0) {
				mgr.jobs.splice(i, 1);
				say((out ? "§a" : "§c") + "连发完成 id=" + j.id + " 末次返回:" + out);
			} else {
				j.wait = j.gap;
			}
		}
	} catch (e) {}
};
globalThis.onTickEvent.__pktMgr = true;

globalThis.onSendServerPacketEvent = function (id, name, bin) {
	let r;
	const p = __pktPrev.send;
	if (p && !p.__pktMgr) {
		try { r = p(id, name, bin); } catch (e) {}
	}
	if (mgr.sendingDepth > 0) return r === undefined ? false : r;
	try {
		if (mgr.blockSendOn && mgr.blockSendIds.has(id)) {
			mgr.droppedSend++;
			capture("send", id, name, bin, "已拦截");
			return true;
		}
		const rr = applySendRules(id, bin);
		if (rr) {
			if (rr.block) {
				capture("send", id, name, bin, rr.note);
				mgr.pendingResend.push({ id: id, bytes: rr.resend });
				return true;
			}
			if (rr.patched) {
				capture("send", id, name, bin, rr.note);
				return r === undefined ? false : r;
			}
		}
		if (mgr.sendListen && passFilter(id)) capture("send", id, name, bin, "");
	} catch (e) {}
	return r === undefined ? false : r;
};
globalThis.onSendServerPacketEvent.__pktMgr = true;

try { minecraft.clientMessage("§b[包] §a数据包管理器已加载（收包钩子未挂载，开收包类功能时自动挂载）"); } catch (e) {}
