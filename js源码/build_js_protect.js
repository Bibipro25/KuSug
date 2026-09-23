// JS 直出构建(保护体系已退役 2026-09-22): 母本剥注释后落盘为根 KuSug.js
// 注释剥离: acorn 全量解析拿注释区间, 仅抹字符保留换行(行号与母本对齐, 设备报错栈可对行)
// 用法: node 工具/build_js_protect.js
const fs = require("fs");
const path = require("path");
const acorn = require(path.join(__dirname, "node_modules", "acorn"));

const ROOT = path.dirname(__dirname);
const SRC = path.join(ROOT, "工具", "src", "KuSug_main.js");
const OUT = path.join(ROOT, "KuSug.js");

const s = fs.readFileSync(SRC, "utf8");
if (s.indexOf("const kuNative = {") === -1) {
	console.error("源内 kuNative 标记缺失(源文件不对?)");
	process.exit(1);
}
new Function(s);   // 语法闸①: 母本必须可解析

const comments = [];
acorn.parse(s, { ecmaVersion: 2020, onComment: comments });
const chars = s.split("");
for (const c of comments) {
	for (let i = c.start; i < c.end; i++) {
		if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
	}
}
const out = chars.join("");
new Function(out);   // 语法闸②: 剥后必须仍可解析
const chk = [];
acorn.parse(out, { ecmaVersion: 2020, onComment: chk });
if (chk.length !== 0) { console.error("剥注释后仍有残留 " + chk.length); process.exit(1); }

fs.writeFileSync(OUT, out);
console.log("KuSug.js 直出 %dB(剥注释 %d 处, 母本 %dB)", Buffer.byteLength(out), comments.length, Buffer.byteLength(s));
