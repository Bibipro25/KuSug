(() => {
	const app = require("app");
	const menu = require("menu");
	const packet = require("packet");
	const fs = require("fs");
	const minecraft = require("minecraft");

	const RPC_ID = 98247598;

	let baseDir = ".";
	try { baseDir = app.getResource(); } catch (e) {}
	const LOG_DIR = baseDir + "/KuSug";
	try { fs.createDirectories(LOG_DIR); } catch (e) {}
	const SEND_FILE = LOG_DIR + "/pyrpc_send.log";
	const RECV_FILE = LOG_DIR + "/pyrpc_recv.log";
	const MAX_CHAT_QUEUE = 50;

	const HEX256 = [];
	for (let i = 0; i < 256; i++) HEX256.push(i.toString(16).padStart(2, "0"));

	function hexToUint8Array(hex) {
		const bytes = [];
		for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
		return new Uint8Array(bytes).buffer;
	}

	function bytesToHex(data) {
		if (!data) return "";
		let u8;
		try {
			if (data instanceof ArrayBuffer) u8 = new Uint8Array(data);
			else if (ArrayBuffer.isView(data)) u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
			else u8 = new Uint8Array(data);
		} catch (e) {
			return "";
		}
		const parts = new Array(u8.length);
		for (let i = 0; i < u8.length; i++) parts[i] = HEX256[u8[i]];
		return parts.join("");
	}

	function stringToHex(str) {
		let hex = "";
		for (let i = 0; i < str.length; i++) {
			const c = str.charCodeAt(i);
			if (c > 127) hex += encodeURIComponent(str[i]).replace(/%/g, "").toLowerCase();
			else hex += c.toString(16).padStart(2, "0");
		}
		return hex;
	}

	function hexToUtf8(hex) {
		let str = "";
		for (let i = 0; i < hex.length; i += 2) str += "%" + hex.substr(i, 2);
		try { return decodeURIComponent(str); } catch (e) { return hex; }
	}

	function timeStr() {
		const d = new Date();
		const p = n => (n < 10 ? "0" : "") + n;
		return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
	}

	function msg(text) {
		try { minecraft.clientMessage("§b[RPC] §f" + text); } catch (e) {}
	}

	function notifyToggle(name, enabled, extra) {
		try {
			minecraft.clientMessage("§b[" + name + "] " + (enabled ? "§a已开启" : "§c已关闭") + (enabled && extra ? " §7" + extra : ""));
		} catch (e) {}
	}

	function compileTerms(text) {
		const out = [];
		const t = String(text === undefined || text === null ? "" : text).trim();
		if (!t) return out;
		for (const raw of t.split(/[,，\s]+/)) {
			if (!raw) continue;
			out.push({ raw: raw, isHex: /^[0-9A-Fa-f]+$/.test(raw), lower: raw.toLowerCase(), textHex: stringToHex(raw) });
		}
		return out;
	}

	function toTypedJson(obj) {
		if (obj === null) return { type: "nil" };
		if (typeof obj === "boolean") return { type: "boolean", value: obj };
		if (typeof obj === "number") return { type: "int", value: obj };
		if (typeof obj === "string") {
			if (!isNaN(Number(obj.slice(1)))) {
				switch (obj[0]) {
					case "u": return { type: "uint", value: Number(obj.slice(1)) };
					case "f": return { type: "float", value: Number(obj.slice(1)) };
					case "d": return { type: "double", value: Number(obj.slice(1)) };
				}
			}
			return { type: "binary", value: obj };
		}
		if (Array.isArray(obj)) return { type: "array", value: obj.map(toTypedJson) };
		if (typeof obj === "object") {
			return {
				type: "object",
				value: Object.entries(obj).map(([k, v]) => ({
					key: { type: "binary", value: k },
					value: toTypedJson(v)
				}))
			};
		}
		throw new TypeError("Unsupported type: " + typeof obj);
	}

	function toPythonMsgpack(node) {
		if (!node || typeof node !== "object" || !("type" in node)) return node;
		switch (node.type) {
			case "array": return node.value.map(toPythonMsgpack);
			case "object": {
				const obj = {};
				for (const pair of node.value) obj[toPythonMsgpack(pair.key)] = toPythonMsgpack(pair.value);
				return obj;
			}
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

	function decodeMsgpack(u8) {
		let pos = 0;
		function need(n) { if (pos + n > u8.length) throw new Error("数据截断"); }
		function read(n) { need(n); const s = u8.slice(pos, pos + n); pos += n; return s; }
		function uint(n) { let v = 0; const b = read(n); for (let i = 0; i < n; i++) v = v * 256 + b[i]; return v; }
		function sint(n) { const v = uint(n); const max = Math.pow(2, n * 8); return v >= max / 2 ? v - max : v; }
		function f32() { const b = read(4); const dv = new DataView(new ArrayBuffer(4)); for (let i = 0; i < 4; i++) dv.setUint8(i, b[i]); return dv.getFloat32(0); }
		function f64() { const b = read(8); const dv = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 8; i++) dv.setUint8(i, b[i]); return dv.getFloat64(0); }
		function utf8(bytes) {
			let s = "";
			for (let i = 0; i < bytes.length; i++) s += "%" + bytes[i].toString(16).padStart(2, "0");
			try { return decodeURIComponent(s); } catch (e) {
				let h = "";
				for (let i = 0; i < bytes.length; i++) h += bytes[i].toString(16).padStart(2, "0");
				return "hex:" + h;
			}
		}
		function arr(n) { const a = []; for (let i = 0; i < n; i++) a.push(node()); return a; }
		function map(n) { const o = {}; for (let i = 0; i < n; i++) { const k = node(); o[String(k)] = node(); } return o; }
		function node() {
			need(1);
			const b = u8[pos++];
			if (b <= 0x7f) return b;
			if (b >= 0xe0) return b - 256;
			if (b >= 0x80 && b <= 0x8f) return map(b & 0x0f);
			if (b >= 0x90 && b <= 0x9f) return arr(b & 0x0f);
			if (b >= 0xa0 && b <= 0xbf) return utf8(read(b & 0x1f));
			switch (b) {
				case 0xc0: return null;
				case 0xc2: return false;
				case 0xc3: return true;
				case 0xc4: return utf8(read(uint(1)));
				case 0xc5: return utf8(read(uint(2)));
				case 0xc6: return utf8(read(uint(4)));
				case 0xca: return "f" + f32();
				case 0xcb: return "d" + f64();
				case 0xcc: return "u" + uint(1);
				case 0xcd: return "u" + uint(2);
				case 0xce: return "u" + uint(4);
				case 0xcf: return "u" + uint(8);
				case 0xd0: return sint(1);
				case 0xd1: return sint(2);
				case 0xd2: return sint(4);
				case 0xd3: return sint(8);
				case 0xd9: return utf8(read(uint(1)));
				case 0xda: return utf8(read(uint(2)));
				case 0xdb: return utf8(read(uint(4)));
				case 0xdc: return arr(uint(2));
				case 0xdd: return arr(uint(4));
				case 0xde: return map(uint(2));
				case 0xdf: return map(uint(4));
			}
			throw new Error("未知类型字节 0x" + b.toString(16));
		}
		const root = node();
		if (pos !== u8.length) throw new Error("存在尾部数据");
		return root;
	}

	function hexToBytes(hex) {
		const u8 = new Uint8Array(hex.length / 2);
		for (let i = 0; i < u8.length; i++) u8[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
		return u8;
	}

	function decodePayload(json, hex) {
		if (json) {
			try {
				const root = JSON.parse(json);
				const node = Array.isArray(root) ? root.map(toPythonMsgpack) : toPythonMsgpack(root);
				return JSON.stringify(node);
			} catch (e) {}
		}
		if (!hex) return "";
		try {
			return JSON.stringify(toPythonMsgpack(decodeMsgpack(hexToBytes(hex))));
		} catch (e) {}
		try {
			let text = "";
			const u8 = hexToBytes(hex);
			for (let i = 0; i < u8.length; i++) {
				if (u8[i] < 0x20 || u8[i] > 0x7e) return "";
				text += String.fromCharCode(u8[i]);
			}
			return text ? "text:" + text : "";
		} catch (e) {}
		return "";
	}

	const mgr = {
		logSend: false,
		logRecv: false,
		logChat: true,
		logFile: true,
		parseOn: true,
		filterOn: false,
		filterText: "",
		_filterTerms: [],
		blockOn: false,
		blockInput: "",
		_blockTerms: [],
		fakeOn: false,
		fakeMatch: "",
		_fakeHex: "",
		fakeData: "",
		sendOn: false,
		sendLoop: false,
		sendData: "",
		sendCount: 5,
		sendDelay: 5,
		buildTick: 0,
		replayIndex: 1,
		decodeText: "",
		fileQueue: [],
		chatQueue: [],
		sendQueue: [],
		history: [],
		onModuleEvent(args) {
			if (!args) return;
			if (typeof args.exit !== "undefined") {
				this.shutdown();
				return;
			}
			if (args.fun && "value" in args) {
				const value = Boolean(args.value);
				switch (args.fun) {
					case "fun_pyrpc_log_send":
						if (value !== this.logSend) {
							this.logSend = value;
							notifyToggle("记录发送", value);
						}
						return;
					case "fun_pyrpc_log_recv":
						if (value !== this.logRecv) {
							this.logRecv = value;
							notifyToggle("记录接收", value);
						}
						return;
					case "fun_pyrpc_block":
						if (value !== this.blockOn) {
							this.blockOn = value;
							notifyToggle("字段拦截", value);
						}
						return;
					case "fun_pyrpc_fake":
						if (value !== this.fakeOn) {
							this.fakeOn = value;
							notifyToggle("伪造响应", value);
						}
						return;
					case "fun_pyrpc_send":
						if (value === this.sendOn) return;
						if (!value) {
							this.sendOn = false;
							notifyToggle("循环发送", false);
							return;
						}
						if (!this.sendData.trim()) {
							msg("§e先在发送区填写 RPC内容");
							return;
						}
						if (this.sendLoop) {
							this.sendOn = true;
							this.buildTick = 0;
							notifyToggle("循环发送", true, "间隔" + this.sendDelay + "tick 数量" + this.sendCount);
						} else {
							const once = this.sendBuilt();
							notifyToggle("单次发送", true, once > 0 ? "已发出" + once + "个" : "发送失败");
						}
						return;
				}
			}
			if (args.fun === "pyrpc_act_history") { this.showHistory(); return; }
			if (args.fun === "pyrpc_act_replay") { this.replayNow(); return; }
			if (args.fun === "pyrpc_act_decode") { this.decodeShow(); return; }
			if (typeof args.pyrpc_log_chat !== "undefined") this.logChat = Boolean(args.pyrpc_log_chat);
			if (typeof args.pyrpc_log_file !== "undefined") this.logFile = Boolean(args.pyrpc_log_file);
			if (typeof args.pyrpc_parse !== "undefined") this.parseOn = Boolean(args.pyrpc_parse);
			if (typeof args.pyrpc_filter_on !== "undefined") this.filterOn = Boolean(args.pyrpc_filter_on);
			if (typeof args.pyrpc_filter === "string") {
				this.filterText = args.pyrpc_filter;
				this._filterTerms = compileTerms(this.filterText);
			}
			if (typeof args.pyrpc_block_text === "string") {
				this.blockInput = args.pyrpc_block_text;
				this._blockTerms = compileTerms(this.blockInput);
			}
			if (typeof args.pyrpc_fake_match === "string") {
				this.fakeMatch = args.pyrpc_fake_match;
				this._fakeHex = stringToHex(args.pyrpc_fake_match.trim());
			}
			if (typeof args.pyrpc_fake_data === "string") this.fakeData = args.pyrpc_fake_data;
			if (typeof args.pyrpc_send_data === "string") this.sendData = args.pyrpc_send_data;
			if (typeof args.pyrpc_send_loop !== "undefined") this.sendLoop = Boolean(args.pyrpc_send_loop);
			const cnt = Number(args.pyrpc_send_count);
			if (!isNaN(cnt) && cnt > 0) this.sendCount = Math.max(1, Math.min(100, Math.floor(cnt)));
			const dly = Number(args.pyrpc_send_delay);
			if (!isNaN(dly) && dly > 0) this.sendDelay = Math.max(1, Math.min(100, Math.floor(dly)));
			const ridx = Number(args.pyrpc_replay_index);
			if (!isNaN(ridx) && ridx >= 1) this.replayIndex = Math.max(1, Math.min(20, Math.floor(ridx)));
			if (typeof args.pyrpc_decode_text === "string") this.decodeText = args.pyrpc_decode_text;
		},
		shutdown() {
			this.logSend = false;
			this.logRecv = false;
			this.blockOn = false;
			this.fakeOn = false;
			this.sendOn = false;
			this.sendLoop = false;
			this.fileQueue = [];
			this.chatQueue = [];
			this.sendQueue = [];
			this.buildTick = 0;
			msg("§c已退出");
			try { exit(); } catch (e) {}
		},
		matchTerms(terms, id, hex) {
			const sid = String(id);
			for (const t of terms) {
				if (sid === t.raw) return t.raw;
				if (t.isHex && hex.indexOf(t.lower) !== -1) return t.raw;
				if (hex.indexOf(t.textHex) !== -1) return t.raw;
			}
			return "";
		},
		matchFilter(id, hex) {
			if (!this.filterOn) return true;
			if (!this._filterTerms.length) return true;
			return this.matchTerms(this._filterTerms, id, hex) !== "";
		},
		record(id, hex, decoded, isSend, marker) {
			const dir = isSend ? "C→S" : "S→C";
			const head = "id=" + id + " len=" + (hex.length / 2) + (marker ? " " + marker : "");
			const shown = this.parseOn ? decoded : "";
			if (this.logFile) {
				this.fileQueue.push({
					path: isSend ? SEND_FILE : RECV_FILE,
					text: timeStr() + " [" + dir + "] " + head + "\nhex: " + (hex || "(空)") + "\nparse: " + (shown || "(无)") + "\n\n"
				});
			}
			if (this.logChat) {
				const brief = hex.length > 64 ? hex.slice(0, 64) + "..." : hex;
				this.chatQueue.push("§b[RPC] §f[" + dir + "] §7" + head + " §f" + (shown || brief || "(空)"));
				if (this.chatQueue.length > MAX_CHAT_QUEUE) this.chatQueue.shift();
			}
			this.history.unshift({ id: id, hex: hex, send: isSend, brief: (decoded || hex).slice(0, 50) });
			if (this.history.length > 20) this.history.pop();
		},
		onRpc(id, data, json, isSend) {
			const wantBlock = this.blockOn && this._blockTerms.length > 0;
			const wantFake = !isSend && this.fakeOn && this._fakeHex.length > 0;
			const wantRec = isSend ? this.logSend : this.logRecv;
			if (!wantBlock && !wantFake && !wantRec) return false;
			let hex = null;
			const getHex = () => {
				if (hex === null) hex = bytesToHex(data);
				return hex;
			};
			if (wantBlock) {
				const hit = this.matchTerms(this._blockTerms, id, getHex());
				if (hit) {
					if (wantRec) this.record(id, getHex(), decodePayload(json, getHex()), isSend, "已拦截(" + hit + ")");
					return true;
				}
			}
			if (wantFake) {
				const h = getHex();
				if (h && h.indexOf(this._fakeHex) !== -1) {
					if (this.fakeData.trim()) this.sendQueue.push(this.fakeData);
					if (wantRec) this.record(id, h, decodePayload(json, h), isSend, "已伪造(" + this.fakeMatch.trim() + ")");
					return true;
				}
			}
			if (wantRec && this.matchFilter(id, getHex())) {
				const h = getHex();
				this.record(id, h, decodePayload(json, h), isSend, "");
			}
			return false;
		},
		sendRpc(text) {
			try {
				const data = JSON.parse(text);
				if (Array.isArray(data)) {
					packet.sendPyRpcPacket(RPC_ID, JSON.stringify(toTypedJson(data)));
					return true;
				}
				if (typeof data === "object" && data !== null) {
					packet.sendPyRpcPacket(RPC_ID, JSON.stringify(data));
					return true;
				}
			} catch (e) {}
			if (/^[0-9A-Fa-f]+$/.test(text)) {
				try {
					packet.sendPyRpcPacket(RPC_ID, hexToUint8Array(text));
					return true;
				} catch (e) {}
			}
			return false;
		},
		sendBuilt() {
			const t = this.sendData.trim();
			if (!t) return 0;
			let count = 0;
			for (let i = 0; i < this.sendCount; i++) {
				if (this.sendRpc(t)) count++;
			}
			return count;
		},
		replayNow() {
			const h = this.history[this.replayIndex - 1];
			if (!h || !h.hex) {
				msg("§e历史序号 " + this.replayIndex + " 无记录");
				return;
			}
			try {
				packet.sendPyRpcPacket(h.id, hexToUint8Array(h.hex));
				msg("已重放历史 #" + this.replayIndex + " id=" + h.id);
			} catch (e) {
				msg("§c重放失败: " + e);
			}
		},
		showHistory() {
			let text = "暂无记录";
			if (this.history.length) {
				const lines = [];
				for (let i = 0; i < this.history.length; i++) {
					const h = this.history[i];
					lines.push("#" + (i + 1) + " " + (h.send ? "[发]" : "[收]") + " id=" + h.id + " " + h.brief);
				}
				text = lines.join("\n");
			}
			this.showText("记录历史 (序号1=最新)", text);
		},
		showText(title, text) {
			const lines = text.split("\n");
			const pythonCode = `# -*- coding: utf-8 -*-
import json
import minecraft
from gui_2d import GUI, ui_const

TITLE = json.loads(${JSON.stringify(JSON.stringify(title))})
TEXT = json.loads(${JSON.stringify(JSON.stringify(text))})
LINES = json.loads(${JSON.stringify(JSON.stringify(lines))})

def on_copy():
	try:
		minecraft.instance.copyToClipboard(TEXT)
		GUI.ui_mgr.show_toast(u'已复制到粘贴板')
	except Exception:
		pass

try:
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
		},
		decodeShow() {
			const t = this.decodeText.trim();
			if (!t) {
				msg("§e先在解码区填写内容");
				return;
			}
			let result = "";
			if (/^[0-9A-Fa-f\s]+$/.test(t)) {
				const hex = t.replace(/\s+/g, "");
				try {
					result = JSON.stringify(decodeMsgpack(new Uint8Array(hexToUint8Array(hex))), null, 1);
				} catch (e) {
					result = "msgpack解码失败: " + e;
				}
			} else {
				try {
					result = JSON.stringify(toPythonMsgpack(JSON.parse(t)), null, 1);
				} catch (e) {
					result = "typed-json解析失败: " + e;
				}
			}
			this.showText("RPC解码", result);
		},
		onTick() {
			if (this.sendOn && this.sendLoop) {
				this.buildTick++;
				if (this.buildTick >= this.sendDelay) {
					this.buildTick = 0;
					const good = this.sendBuilt();
					if (!good) {
						this.sendOn = false;
						msg("§e循环发送已停止：构造内容无效或发送失败");
					}
				}
			}
			if (this.sendQueue.length) {
				const items = this.sendQueue;
				this.sendQueue = [];
				for (const text of items) this.sendRpc(text);
			}
			if (this.fileQueue.length) {
				const items = this.fileQueue;
				this.fileQueue = [];
				for (const it of items) {
					try { fs.write(it.path, it.text, true); } catch (e) {}
				}
			}
			if (this.chatQueue.length) {
				const items = this.chatQueue;
				this.chatQueue = [];
				for (const text of items) {
					try { minecraft.clientMessage(text); } catch (e) {}
				}
			}
		}
	};

	function safeRegFun(tag) {
		try { menu.regFun(tag); } catch (e) {}
	}

	safeRegFun("fun_pyrpc_log_send");
	safeRegFun("fun_pyrpc_log_recv");
	safeRegFun("fun_pyrpc_block");
	safeRegFun("fun_pyrpc_fake");
	safeRegFun("fun_pyrpc_send");
	safeRegFun("pyrpc_act_history");
	safeRegFun("pyrpc_act_replay");
	safeRegFun("pyrpc_act_decode");

	function chain(name, fn) {
		const prev = globalThis[name];
		const prevIsMine = !!(prev && prev.__pyrpcMgr);
		const self = function () {
			let prevResult;
			if (prev && !prevIsMine) {
				try { prevResult = prev.apply(null, arguments); } catch (e) {}
			}
			if (prevResult === true) return true;
			let own;
			try { own = fn.apply(null, arguments); } catch (e) {}
			if (own !== undefined) {
				if (own !== false || prevResult === undefined) return own;
			}
			return prevResult;
		};
		self.__pyrpcMgr = true;
		globalThis[name] = self;
	}

	chain("onCallModuleEvent", function (args) {
		mgr.onModuleEvent(args);
	});
	chain("onTickEvent", function () {
		mgr.onTick();
	});
	chain("onPyRpcReceiveEvent", function (id, data, json) {
		return mgr.onRpc(id, data, json, false);
	});
	chain("onPyRpcSendEvent", function (id, data, json) {
		return mgr.onRpc(id, data, json, true);
	});
	msg("§a加载成功");
})();
