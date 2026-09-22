// JS 层保护构建器(纯混淆直出版): gen_tbcui → javascript-obfuscator → acorn 安全折行 → 直接落盘
// 用法: node 工具/build_js_protect.js
// 产物: 根 KuSug.js 与 TBCUI/TBCUI.js —— 混淆后的源码直接作为脚本文件,无装载器/无加密层。
// 设计说明(v27):装载器+密文路线在设备上被引擎桥接/体量限制连续阻击(见更新日志 v26 热修①-④),弃用;
//         机密分量本来就在 so(分钥加密),JS 侧只保留混淆提阅读门槛。
//         so 侧 op53/54/55 取钥孔保留不用(无害占位);金丝雀(op61/62)仍由载荷 kuNative.load 正常驱动。
const fs = require("fs");
const path = require("path");
const child_process = require("child_process");
const JavaScriptObfuscator = require(path.join(__dirname, "node_modules", "javascript-obfuscator"));
const acorn = require(path.join(__dirname, "node_modules", "acorn"));

const ROOT = path.dirname(__dirname);
const SRC_MAIN = path.join(ROOT, "工具", "src", "KuSug_main.js");
const TBCUI_DIR = path.join(ROOT, "TBCUI");
const OUT_MAIN = path.join(ROOT, "KuSug.js");
const OUT_TBCUI = path.join(TBCUI_DIR, "TBCUI.js");

const OBF_OPTS = {
	compact: true,
	simplify: true,
	identifierNamesGenerator: "hexadecimal",
	renameGlobals: false,          // 引擎按全局名回调,函数声明必须保名
	stringArray: true,
	stringArrayThreshold: 1,
	stringArrayEncoding: [],       // base64 实测占启动执行 ~93%(vm 基准: 156ms→8ms),且公开反混淆器一键还原,不设防
	stringArrayRotate: false,      // 轮转环同样只挡静态索引映射,启动白转几万次
	stringArrayShuffle: true,
	stringArrayWrappersCount: 1,
	stringArrayWrappersType: "function",
	splitStrings: true,            // 唯一作用: 给无编码长串(PY 载荷全转义后单 token 可达 57K 字符)制造折行断点;
	splitStringsChunkLength: 200,  // 200 是体积/断点密度平衡点(断点间距实测 ≤800,远低于 4000 折行闸)
	controlFlowFlattening: true,
	controlFlowFlatteningThreshold: 0.2,
	numbersToExpressions: false,   // 纯体积税(-4%),数字混淆可折叠还原
	deadCodeInjection: false,
	selfDefending: false,
	sourceMap: false,
	seed: 0
};

// 断点只取 acorn token 流里的二元 + 与逗号 punctuator 结束位置——绝不落在字符串/正则/注释内;
// 在 + 或 , 后断行对表达式语法完全安全(无 ASI 风险)。compact 单行输出折到 ≤4000 字符/行,
// 防一切行宽敏感的下游(设备管线/传输工具/diff 工具)。
function wrapLongLines(code, maxLen) {
	const toks = [];
	acorn.parse(code, { ecmaVersion: 2020, onToken: toks });
	const bps = [];
	for (const t of toks) if ((t.type.label === "+/-" && t.value === "+") || t.type.label === ",") bps.push(t.end);
	bps.sort((a, b) => a - b);
	let bi = 0;
	const out = [];
	let offset = 0;
	for (const line of code.split("\n")) {
		const end = offset + line.length;
		if (line.length <= maxLen) { out.push(line); offset = end + 1; continue; }
		while (bi < bps.length && bps[bi] <= offset) bi++;
		let segStart = offset;
		while (segStart < end) {
			const limit = segStart + maxLen;
			let cut = -1;
			let j = bi;
			while (j < bps.length && bps[j] <= Math.min(limit, end)) { cut = bps[j]; j++; }
			if (cut === -1) { out.push(line.slice(segStart - offset)); segStart = end; }
			else { out.push(line.slice(segStart - offset, cut - offset)); segStart = cut; bi = j; }
		}
		offset = end + 1;
	}
	return out.join("\n");
}

const SWEEP = ["掉落物统计", "动态模糊", "世界面板", "KuSug_main", "fun_scaffold", "fun_kill_aura"];

function emitProtected(srcText, outPath, tag) {
	const t0 = Date.now();
	let obf = JavaScriptObfuscator.obfuscate(srcText, OBF_OPTS).getObfuscatedCode();
	obf = wrapLongLines(obf, 4000);
	const ll = obf.split("\n").reduce((m, l) => Math.max(m, l.length), 0);
	if (ll > 8000) throw new Error(tag + ": 折行后仍有超长行 " + ll);
	acorn.parse(obf, { ecmaVersion: 2020 });   // 折行后必须仍可解析
	// 哨兵串在母本均为多用(×2/×3): stringArray 一旦失效内联,出现次数必然 >1;
	// 正常时每串全文件仅数组里 1 份(乱序无编码,门槛在重命名+控制流+间接寻址)
	for (const s of SWEEP) {
		let n = 0, i = -1;
		while ((i = obf.indexOf(s, i + 1)) !== -1) n++;
		if (n > 1) throw new Error(tag + ": 生成物明文串重复内联(stringArray 失效?): " + s + " ×" + n);
	}
	fs.writeFileSync(outPath, obf);
	console.log("[%s] 源 %dB → 落盘 %dB(最长行 %d, %dms)", tag, Buffer.byteLength(srcText), Buffer.byteLength(obf), ll, Date.now() - t0);
}

function main() {
	console.log("== gen_tbcui");
	const r = child_process.spawnSync("python", [path.join(ROOT, "工具", "gen_tbcui.py")], { stdio: "inherit" });
	if (r.status !== 0) { console.error("gen_tbcui 失败"); process.exit(1); }

	const seed = (Date.now() ^ (Math.random() * 0x7FFFFFFF)) >>> 0;
	OBF_OPTS.seed = seed;

	const mainSrc = fs.readFileSync(SRC_MAIN, "utf8");
	if (mainSrc.indexOf("const kuNative = {") === -1) {
		console.error("源内 kuNative 标记缺失(源文件不对?)");
		process.exit(1);
	}
	console.log("== 混淆主干");
	emitProtected(mainSrc, OUT_MAIN, "KuSug");

	console.log("== so 回填 JS 内容指纹(校验槽同步)");
	const fr = child_process.spawnSync("python", [path.join(ROOT, "工具", "so探针", "finalize_so.py"), "js", OUT_MAIN], { stdio: "inherit" });
	if (fr.status !== 0) { console.error("js 指纹回填失败: 先跑 工具/so探针/build_obf.py 构建 so"); process.exit(1); }
	console.log("*** 内容为钥(v29): 若 KuSug.js 内容较上次构建有变,必须重建 so(python 工具/so探针/build_obf.py)——否则密钥派生错位,设备引导失败 ***");

	fs.copyFileSync(OUT_TBCUI, path.join(ROOT, "工具", "src", "TBCUI_gen.js"));
	console.log("== 混淆 TBCUI");
	emitProtected(fs.readFileSync(OUT_TBCUI, "utf8"), OUT_TBCUI, "TBCUI");

	fs.writeFileSync(path.join(ROOT, "工具", "js_protect_info.txt"), "seed=" + seed + "\n");
	console.log("完成 (混淆 seed=" + seed + ")");
}

main();
