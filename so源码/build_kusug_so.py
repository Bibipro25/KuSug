import io, re, os, sys, json, struct

base = os.path.dirname(os.path.abspath(__file__))
mb = io.open(os.path.join(base, 'motion_blur.c'), encoding='utf-8').read()
ih = io.open(os.path.join(base, 'item_hud.c'), encoding='utf-8').read()

def seg(lines, a, b):
    return '\n'.join(lines[a - 1:b])

def cut(text, a, b):
    return text.split('\n%s\n' % a)[1].split('\n%s\n' % b)[0].strip('\n')

mb_shaders = cut(mb, '/*MBA_BEGIN*/', '/*MBA_END*/')
mb_state = cut(mb, '/*MBB_BEGIN*/', '/*MBB_END*/')
mb_body = cut(mb, '/*MBC_BEGIN*/', '/*MBC_END*/')
mb_exports = cut(mb, '/*MBD_BEGIN*/', '/*MBD_END*/')
assert 'VS[]' in mb_shaders and 'FS[]' in mb_shaders, 'MBA markers broken'
assert 'g_enable' in mb_state and 'g_permil' in mb_state, 'MBB markers broken'
assert 'gl_init' in mb_body and 'render(EGLDisplay' in mb_body and 'CopyTexSubImage2D' in mb_body, 'MBC markers broken'
assert 'mblur_set' in mb_exports and 'mblur_get' in mb_exports and 'mblur_frames' not in mb_exports, 'MBD markers broken'

def seg_anchor(lines, start_anchor, end_anchor):
	a = next(i for i, l in enumerate(lines) if start_anchor in l)
	b = next(i for i, l in enumerate(lines) if end_anchor in l and i > a)
	if a >= b:
		raise AssertionError('anchor order broken: %r %r' % (start_anchor, end_anchor))
	return '\n'.join(lines[a:b]).strip('\n')

ihl = ih.split('\n')
ih_math = seg_anchor(ihl, 'static double ih_fabs(double x) {', 'static void guard_check(void) {')
ih_fonts = seg_anchor(ihl, 'static unsigned char* g_ttf = 0;', 'static void (*pglGetIntegerv)')
ih_shaders = seg_anchor(ihl, 'static const char VS[] =', '/*IHA_BEGIN*/')
iht = ih
ih_main1 = iht.split('\n/*IHA_BEGIN*/\n')[1].split('\n/*IHA_END*/\n')[0].strip('\n')
ih_state_render = iht.split('\n/*IHB_BEGIN*/\n')[1].split('\n/*IHB_END*/\n')[0].strip('\n')
assert 'gc_fill' in ih_main1 and 'utf8_next' in ih_main1 and 'name_check' in ih_main1 and '__ihud_in' in ih_main1, 'IHA markers broken'
assert 'render(EGLDisplay' in ih_state_render and 'g_gl_ready' in ih_state_render and 'g_frames++' in ih_state_render, 'IHB markers broken'

dirh = io.open(os.path.join(base, 'dir_hud.c'), encoding='utf-8').read()
dir_body = dirh.split('\n/*DIR_BEGIN*/\n')[1].split('\n/*DIR_END*/\n')[0].strip('\n')
assert 'dirhud_enable' in dir_body and 'dir_render' in dir_body, 'dir_hud.c markers broken'

wmh = io.open(os.path.join(base, 'wm_hud.c'), encoding='utf-8').read()
wm_body = wmh.split('\n/*WM_BEGIN*/\n')[1].split('\n/*WM_END*/\n')[0].strip('\n')
assert 'wmhud_enable' in wm_body and 'wm_render' in wm_body, 'wm_hud.c markers broken'

chh = io.open(os.path.join(base, 'ch_hud.c'), encoding='utf-8').read()
ch_body = chh.split('\n/*CH_BEGIN*/\n')[1].split('\n/*CH_END*/\n')[0].strip('\n')
assert 'chud_enable' in ch_body and 'ch_render' in ch_body and 'ch_cross_arms' in ch_body, 'ch_hud.c markers broken'
assert 'sqrtf' not in ch_body and 'expf' not in ch_body, 'ch_hud.c libm symbols forbidden'

radh = io.open(os.path.join(base, 'radar_hud.c'), encoding='utf-8').read()
rd_body = radh.split('\n/*RD_BEGIN*/\n')[1].split('\n/*RD_END*/\n')[0].strip('\n')
assert 'rd_enable' in rd_body and 'rd_render' in rd_body and '__radar_in' in rd_body and 'rd_commit' in rd_body, 'radar_hud.c markers broken'
assert 'sqrtf' not in rd_body and 'expf' not in rd_body, 'radar_hud.c libm symbols forbidden'

wplh = io.open(os.path.join(base, 'wpl_hud.c'), encoding='utf-8').read()
wpl_body = wplh.split('\n/*WPL_BEGIN*/\n')[1].split('\n/*WPL_END*/\n')[0].strip('\n')
assert 'wpl_enable' in wpl_body and 'wpl_render' in wpl_body and 'wpl_hooks_install' in wpl_body and '__wpl_in' in wpl_body, 'wpl_hud.c markers broken'

texh = io.open(os.path.join(base, 'tex_inject.c'), encoding='utf-8').read()
tex_body = texh.split('\n/*TEX_BEGIN*/\n')[1].split('\n/*TEX_END*/\n')[0].strip('\n')
assert 'tex_apply' in tex_body and '__tex_in' in tex_body and 'tex_inflate' in tex_body and 'tex_jparse' in tex_body, 'tex_inject.c markers broken'
assert 'sqrtf' not in tex_body and 'expf' not in tex_body and ' strtod' not in tex_body, 'tex_inject.c libm symbols forbidden'

def rename(text, pairs):
    for a, b in pairs:
        text = re.sub(a, b, text)
    return text

mb_pairs = [
    (r'\bVS\[\]', 'MB_VS[]'),
    (r'\bFS\[\]', 'MB_FS[]'),
    (r'\bsrc\[0\] = VS;', 'src[0] = MB_VS;'),
    (r'\bsrc\[0\] = FS;', 'src[0] = MB_FS;'),
    (r'\bgl_init\b', 'mb_gl_init'),
    (r'\btex_alloc\b', 'mb_tex_alloc'),
    (r'\btex_recreate\b', 'mb_tex_recreate'),
    (r'\bstatic void render\(EGLDisplay', 'static void mb_render(EGLDisplay'),
    (r'\bset_status\(', 'mb_set_status('),
    (r'\bg_', 'mb_g_'),
]
ih_pairs = [
    (r'\bVS\[\]', 'IH_VS[]'),
    (r'\bFS\[\]', 'IH_FS[]'),
    (r'\bsrc\[0\] = VS;', 'src[0] = IH_VS;'),
    (r'\bsrc\[0\] = FS;', 'src[0] = IH_FS;'),
    (r'\bgl_init\b', 'ih_gl_init'),
    (r'\btex_ensure\b', 'ih_tex_ensure'),
    (r'\bstatic void render\(EGLDisplay', 'static void ih_render(EGLDisplay'),
    (r'\bset_status\(', 'ih_set_status('),
    (r'\bstatus_num\(', 'ih_status_num('),
    (r'\bg_', 'ih_g_'),
]

mb_head = (
	'static void mb_set_status(const char* s) { ks_set_status(1, s); }\n'
	'static void mb_status_num(const char* pre, long v) { ks_status_num(1, pre, v); }\n'
)
mb_all = '\n'.join([mb_head, mb_shaders, mb_state, mb_body, mb_exports])
mb_all = rename(mb_all, mb_pairs)
mb_all += '\n\nstatic int mb_active(void) { return mb_g_permil > 0 || mb_g_aprog > 0.0005f; }\nstatic void mb_disable(void) { mb_g_enable = 0; mb_g_permil = 0; }\n'

ih_head = (
	'static void ih_set_status(const char* s) { ks_set_status(2, s); }\n'
	'static void ih_status_num(const char* pre, long v) { ks_status_num(2, pre, v); }\n'
)
ih_all = '\n'.join([ih_head, ih_math, ih_fonts, ih_shaders, ih_main1, ih_state_render])
ih_all = rename(ih_all, ih_pairs)
ih_all += '\n\nstatic int ih_active(void) { return ih_g_enable != 0 || ih_g_aprog > 0.0005f; }\nstatic void ih_disable(void) { ih_g_enable = 0; }\n'

prologue = '''#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include <stdarg.h>
#include <stdlib.h>

typedef struct { uint32_t p_type; uint32_t p_flags; uint64_t p_offset; uint64_t p_vaddr; uint64_t p_paddr; uint64_t p_filesz; uint64_t p_memsz; uint64_t p_align; } Elf64_Phdr;
typedef struct { int64_t d_tag; union { uint64_t d_val; uint64_t d_ptr; } d_un; } Elf64_Dyn;
typedef struct { uint64_t r_offset; uint64_t r_info; int64_t r_addend; } Elf64_Rela;
typedef struct { uint32_t st_name; unsigned char st_info; unsigned char st_other; uint16_t st_shndx; uint64_t st_value; uint64_t st_size; } Elf64_Sym;
struct dl_phdr_info {
\tuint64_t dlpi_addr;
\tconst char* dlpi_name;
\tconst Elf64_Phdr* dlpi_phdr;
\tuint16_t dlpi_phnum;
};
#define PT_DYNAMIC 2
#define DT_NULL 0
#define DT_PLTRELSZ 2
#define DT_STRTAB 5
#define DT_SYMTAB 6
#define DT_RELA 7
#define DT_RELASZ 8
#define DT_JMPREL 23
#define ELF64_R_SYM(i) ((uint64_t)(i) >> 32)

#define RTLD_NOW 2
extern void* dlopen(const char*, int);
extern void* dlsym(void*, const char*);
extern int dl_iterate_phdr(int (*cb)(struct dl_phdr_info*, size_t, void*), void*);
extern int mprotect(void*, size_t, int);
extern int access(const char*, int);
extern int getpid(void);
extern int nanosleep(const void*, void*);
extern int clock_gettime(int, void*);
#define PROT_READ 1
#define PROT_WRITE 2

static void mb_render(void* dpy, void* surf);
static void ih_render(void* dpy, void* surf);
static void dir_render(void* dpy, void* surf);
static void ch_render(void* dpy, void* surf);
static void rd_render(void* dpy, void* surf);
static void wm_render(void* dpy, void* surf);
static void wpl_render(void* dpy, void* surf);
static int mb_active(void);
static int ih_active(void);
static int dir_active(void);
static int ch_active(void);
static int rd_active(void);
static int wm_active(void);
static int wpl_active(void);
static void mb_disable(void);
static void ih_disable(void);
static void dir_disable(void);
static void ch_disable(void);
static void rd_disable(void);
static void wm_disable(void);
static void wpl_disable(void);
static void wpl_hooks_install(void);
static int wpl_pv_ready(void);
static int wpl_ctx_is_game(void* ctx);
static void wpl_pv_pick(int w, int h);
'''

core = '''
static void ks_res_path(char* out, int cap, const char* suffix);
static const char* ks_sd(const volatile unsigned char* enc, int n);
static void ks_lkd(char* out, const volatile unsigned char* enc, int n);
static volatile int ks_rk_ready = 0;

static void guard_check(void) {
	char path[192];
	ks_res_path(path, sizeof(path), ks_sd((const unsigned char[]){ @@GUARD_SUFFIX_ENC@@ }, @@GUARD_SUFFIX_LEN@@));
	if (access(path, 0) != 0) {
		*(volatile unsigned char*)0 = 0xAA;
	}
}

static char nb_buffer[4096];
static char ks_slot[8][192];
/* 模块标签混合层加密,首用解码;JS 未投钥(ctor 期)时跳过解码且不落缓存,投钥后自愈 */
static const unsigned char ks_enc_tags[8][7] = { @@TAGS_ENC@@ };
static const unsigned char ks_tag_len[8] = { @@TAGS_LEN@@ };
static char ks_tag_dec[7][8];
static int ks_tag_ok = 0;
static void ks_flush_status(void) {
	char body[600];
	int n = 0;
	body[0] = 0;
	if (ks_rk_ready && !ks_tag_ok) {
		int k;
		for (k = 0; k < 7; k++) ks_lkd(ks_tag_dec[k], ks_enc_tags[k], ks_tag_len[k]);
		ks_tag_ok = 1;
	}
	for (int i = 0; i < 7; i++) {
		if (!ks_slot[i][0]) continue;
		const char* t = ks_tag_ok ? ks_tag_dec[i] : "";
		while (*t && n < 580) body[n++] = *t++;
		const char* s = ks_slot[i];
		while (*s && n < 580) body[n++] = *s++;
		if (n < 578) body[n++] = ' ', body[n++] = '|', body[n++] = ' ';
	}
	body[n] = 0;
	if (n > 4000) n = 4000;
	nb_buffer[0] = n & 255; nb_buffer[1] = (n >> 8) & 255; nb_buffer[2] = 0; nb_buffer[3] = 0;
	memcpy(nb_buffer + 4, body, n);
	nb_buffer[4 + n] = 0;
}
long __nb_buf(void) { return (long)nb_buffer; }
static void nb_stamp(void) {
	unsigned int* p = (unsigned int*)(nb_buffer + 4084);
	p[0] = (unsigned int)getpid();
	nb_buffer[4088] = 'K'; nb_buffer[4089] = 'S'; nb_buffer[4090] = 'G'; nb_buffer[4091] = '3';
}
static void nb_drain(void) {
	long ts[2] = { 0, 80000000L };
	nanosleep(ts, 0);
}
static void ks_set_status(int mod, const char* s) {
	int n = 0;
	while (s[n] && n < 180) { ks_slot[mod][n] = s[n]; n++; }
	ks_slot[mod][n] = 0;
	ks_flush_status();
}
static void ks_status_num(int mod, const char* s, long v) {
	char tmp[128];
	int n = 0;
	while (s[n] && n < 100) { tmp[n] = s[n]; n++; }
	if (v < 0) { tmp[n++] = '-'; v = -v; }
	char dig[24]; int dn = 0;
	if (!v) dig[dn++] = '0';
	while (v) { dig[dn++] = (char)('0' + v % 10); v /= 10; }
	while (dn) tmp[n++] = dig[--dn];
	tmp[n] = 0;
	ks_set_status(mod, tmp);
}

/* ===== 渲染链路全量诊断日志 =====
   环形内存缓冲，钩子热路径零 libc 文件 I/O 零锁；
   ks_log_flush 由 JS 线程节流调用落盘 kusug/so/render_full.log（追加）。
   缓冲 96x128；并发写仅可能乱序/丢条，不会崩。 */
static void ks_res_path(char* out, int cap, const char* suffix);
#define KS_LOG_CAP 96
#define KS_LOG_LEN 128
static char ks_log_buf[KS_LOG_CAP][KS_LOG_LEN];
static volatile unsigned ks_log_total = 0;
static volatile unsigned ks_log_flushed = 0;
static volatile int ks_log_off = 0;

/* ===== 分钥字符串保护(v29 内容为钥) =====
   运行时层(ks_ld/ks_lkd): 明文 = 密文 ^ S(i) ^ R(i,ks_rk); S 为文件内静态位置流,
   R 由 ks_rk 派生,ks_rk = smx(KF ^ F64) ^ KF2 —— F64 = SHA-256(KuSug.js) 前 8 字节 LE,
   由 so 在 boot 期自行读取 JS 文件算出(内容为钥,JS 侧零秘密、桥上无密钥流)。
   只偷 so: 没有 JS 文件就没有 F64,静态分析数学上不可解;整包盗取改 JS: F64 变→密钥错→符号名全垃圾→so 死。
   未派生/错文件时输出垃圾(不崩,优雅降级)。
   静态层(ks_sd): 与 ks_dec 同算法,仅供 ctor 期必需的少数串(res 路径骨架/校验后缀/guard)。
   竞态纪律: 文件路径/符号名等正确性敏感串一律解码进调用者栈缓冲(ks_dec/ks_lkd);
   旋转缓冲(ks_sd/ks_ld)只用于日志/状态等装饰性输出。 */
static unsigned long long ks_rk = 0;
static unsigned long long ks_smx(unsigned long long x) {
	x += 0x9E3779B97F4A7C15ULL;
	x = (x ^ (x >> 30)) * 0xBF58476D1CE4E5B9ULL;
	x = (x ^ (x >> 27)) * 0x94D049BB133111EBULL;
	return x ^ (x >> 31);
}
#define KS_KF  0xC3A5C85C97CB3127ULL
#define KS_KF2 0x9E3779B97F4A7C15ULL
static unsigned char ks_rbyte(unsigned long long i) { return (unsigned char)(ks_smx(ks_rk + i) >> 24); }
static void ks_key_derive(unsigned long long f) { ks_rk = ks_smx(KS_KF ^ f) ^ KS_KF2; ks_rk_ready = 1; }

static __attribute__((noinline, noipa)) const char* ks_sd(const volatile unsigned char* enc, int n) {
	static char bufs[4][96];
	static unsigned slot = 0;
	char* out = bufs[slot & 3];
	slot++;
	int i = 0;
	for (; i < n && i < 95; i++) out[i] = (char)(enc[i] ^ (unsigned char)(0x5A + i * 7));
	out[i] = 0;
	return out;
}

/* 静态层栈解码: 校验路径/包名/路径骨架等正确性敏感串专用(竞态纪律);
   noinline+noipa: 阻断编译期常量折叠把明文算回 rodata */
static __attribute__((noinline, noipa)) void ks_dec(char* out, const volatile unsigned char* enc, int n) {
	int i = 0;
	while (i < n) {
		out[i] = (char)(enc[i] ^ (unsigned char)(0x5A + i * 7));
		i++;
	}
	out[n] = 0;
}

static __attribute__((noinline, noipa)) void ks_lkd(char* out, const volatile unsigned char* enc, int n) {
	int i = 0;
	for (; i < n; i++) out[i] = (char)(enc[i] ^ (unsigned char)(0xA5 + i * 3) ^ ks_rbyte((unsigned long long)i));
	out[n] = 0;
}
#define KS_LKS(var, ...) unsigned char var##_e[] = { __VA_ARGS__ }; char var[sizeof(var##_e) + 1]; ks_lkd(var, var##_e, (int)sizeof(var##_e))

/* 日志/状态串运行时解码(混合层);旋转 4 缓冲,单调用点最多 2 串;
   noinline+noipa+volatile 源: 阻断编译期常量折叠,防明文被算回 rodata */
static __attribute__((noinline, noipa)) const char* ks_ld(const volatile unsigned char* enc, int n) {
	static char bufs[4][192];
	static unsigned slot = 0;
	char* out = bufs[slot & 3];
	slot++;
	int i = 0;
	for (; i < n && i < 191; i++) out[i] = (char)(enc[i] ^ (unsigned char)(0xA5 + i * 3) ^ ks_rbyte((unsigned long long)i));
	out[i] = 0;
	return out;
}

/* 金丝雀: JS 投钥后自检——解固定校验串比对散列,验证 so 与 JS 密钥配套(不配套=版本错配,优雅停用) */
static long ks_key_check(void) {
	static const unsigned char ec[] = { @@CANARY_ENC@@ };
	char t[24];
	unsigned h = 2166136261u;
	int i;
	if (!ks_rk_ready) return 0;
	ks_lkd(t, ec, (int)sizeof(ec));
	for (i = 0; t[i]; i++) h = (h ^ (unsigned char)t[i]) * 16777619u;
	return h == @@CANARY_HASH@@ ? 1 : 0;
}


static void ks_logf(const char* tag, const char* fmt, ...) {
	if (ks_log_off) return;
	char tmp[192];
	int n = 0;
	while (tag[n] && n < 20) { tmp[n] = tag[n]; n++; }
	tmp[n++] = ' ';
	va_list ap;
	va_start(ap, fmt);
	vsnprintf(tmp + n, sizeof(tmp) - n, fmt, ap);
	va_end(ap);
	tmp[sizeof(tmp) - 1] = 0;
	unsigned slot = ks_log_total % KS_LOG_CAP;
	ks_log_total++;
	int i = 0;
	while (tmp[i] && i < KS_LOG_LEN - 1) { ks_log_buf[slot][i] = tmp[i]; i++; }
	ks_log_buf[slot][i] = 0;
}

long ks_log_flush(void) {
	unsigned total = ks_log_total;
	unsigned flushed = ks_log_flushed;
	if (total == flushed) return 0;
	char p[192];
	ks_res_path(p, sizeof(p), "kusug/so/render_full.log");
	FILE* f = fopen(p, "ab");
	if (!f) { ks_log_off = 1; return -1; }
	unsigned start = flushed;
	if (total - flushed > KS_LOG_CAP) {
		char drop[64];
		int dn = snprintf(drop, sizeof(drop), "[ring overwritten, %u entries dropped]", total - flushed - KS_LOG_CAP);
		if (dn > 0) { fputs(drop, f); fputc('\\n', f); }
		start = total - KS_LOG_CAP;
	}
	for (unsigned i = start; i < total; i++) {
		unsigned slot = i % KS_LOG_CAP;
		if (!ks_log_buf[slot][0]) continue;
		fputs(ks_log_buf[slot], f);
		fputc('\\n', f);
	}
	ks_log_flushed = total;
	fclose(f);
	return (long)(total - start);
}

/* ===== 包名动态解析：读 /proc/self/cmdline（进程名=包名，可能带 :子进程 后缀），失败回退原硬编码 ===== */
static char ks_g_pkg[64] = {0};
static const char* ks_pkg(void) {
	if (ks_g_pkg[0]) return ks_g_pkg;
	static const unsigned char enc_proc[] = { @@PROC_CMDLINE_ENC@@ };
	char proc[24];
	ks_dec(proc, enc_proc, (int)sizeof(enc_proc));
	FILE* f = fopen(proc, "rb");
	if (f) {
		char buf[128];
		size_t n = fread(buf, 1, sizeof(buf) - 1, f);
		fclose(f);
		if (n > 0) {
			int i = 0, dot = 0;
			while (i < 63 && i < (int)n && buf[i] && buf[i] != ':') {
				char c = buf[i];
				if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '.') {
					ks_g_pkg[i++] = c;
					if (c == '.') dot = 1;
				} else break;
			}
			ks_g_pkg[i] = 0;
			if (i > 3 && dot) return ks_g_pkg;
		}
	}
	{
		static const unsigned char enc_fb[] = { @@PKG_FALLBACK_ENC@@ };
		char fb[24];
		int i = 0;
		ks_dec(fb, enc_fb, (int)sizeof(enc_fb));
		while (fb[i]) { ks_g_pkg[i] = fb[i]; i++; }
		ks_g_pkg[i] = 0;
	}
	return ks_g_pkg;
}

/* 拼 resources 下绝对路径：/storage/emulated/0/Android/data/<pkg>/files/resources/<suffix> */
static void ks_res_path(char* out, int cap, const char* suffix) {
	static char PRE[40];
	static char MID[24];
	static int pre_ok = 0;
	if (!pre_ok) {   /* 幂等首用解码: 多线程撞车也只是写两遍相同字节 */
		static const unsigned char enc_pre[] = { @@RES_PRE_ENC@@ };
		static const unsigned char enc_mid[] = { @@RES_MID_ENC@@ };
		ks_dec(PRE, enc_pre, (int)sizeof(enc_pre));
		ks_dec(MID, enc_mid, (int)sizeof(enc_mid));
		pre_ok = 1;
	}
	const char* pkg = ks_pkg();
	int n = 0, i;
	for (i = 0; PRE[i] && n < cap - 1; i++) out[n++] = PRE[i];
	for (i = 0; pkg[i] && n < cap - 1; i++) out[n++] = pkg[i];
	for (i = 0; MID[i] && n < cap - 1; i++) out[n++] = MID[i];
	for (i = 0; suffix[i] && n < cap - 1; i++) out[n++] = suffix[i];
	out[n] = 0;
}

/* ===== 自身代码段哈希: 从内存读自身 RX 段算多轮混合哈希,改名/重打包均免疫 ===== */
static volatile unsigned long long ks_slot_sig = 0xA5C39E17D4F806B1ULL;  /* finalize_so.py 回填期望签名(marker=未回填时渲染不降级,防漏跑) */
static volatile unsigned long long ks_js_exp = 0x51F2A7C400000000ULL;  /* finalize_so.py js 回填 KuSug.js keyed-FNV 期望值;高 32 位 marker 在=未回填,校验不动作(防漏跑) */
static unsigned long long ks_g_hv = 0;
static char ks_anchor = 0;

/* 单段混合: 8 字节一组喂入,尾字节单独一轮;构建侧 finalize_so.py 有逐位一致的 Python 实现 */
static unsigned long long ks_hash_seg(unsigned long long h, const unsigned char* seg, unsigned long long n) {
	unsigned long long k;
	for (k = 0; k + 8 <= n; k += 8) {
		unsigned long long v;
		__builtin_memcpy(&v, seg + k, 8);
		h ^= v + 0x9E3779B97F4A7C15ULL + (h << 6) + (h >> 2);
		h *= 0x100000001B3ULL;
		h ^= h >> 29;
	}
	unsigned long long v = 0;
	for (k = n & ~7ULL; k < n; k++) v = (v << 8) | seg[k];
	h ^= v + 0x9E3779B97F4A7C15ULL + (h << 6) + (h >> 2);
	h *= 0x100000001B3ULL;
	h ^= h >> 29;
	return h;
}

static int ks_find_self_cb(struct dl_phdr_info* info, size_t size, void* data) {
	uintptr_t self = (uintptr_t)(void*)&ks_anchor;
	int i;
	(void)size;
	for (i = 0; i < info->dlpi_phnum; i++) {
		if (info->dlpi_phdr[i].p_type != 1) continue;
		uintptr_t lo = (uintptr_t)info->dlpi_addr + (uintptr_t)info->dlpi_phdr[i].p_vaddr;
		uintptr_t hi = lo + (uintptr_t)info->dlpi_phdr[i].p_memsz;
		if (self >= lo && self < hi) {
			*(uintptr_t*)data = (uintptr_t)info->dlpi_addr;
			return 1;
		}
	}
	return 0;
}

static unsigned long long ks_self_hash(void) {
	uintptr_t base = 0;
	dl_iterate_phdr(ks_find_self_cb, &base);
	if (!base) return 0xC0FFEE11C0FFEE11ULL;
	const unsigned char* eh = (const unsigned char*)base;
	unsigned long long phoff = *(const unsigned long long*)(eh + 0x20);
	unsigned short phentsize = *(const unsigned short*)(eh + 0x36);
	unsigned short phnum = *(const unsigned short*)(eh + 0x38);
	unsigned long long h = 0xCBF29CE484222325ULL;
	int i;
	for (i = 0; i < (int)phnum; i++) {
		const unsigned char* ph = eh + phoff + (unsigned long long)i * phentsize;
		unsigned int p_type = *(const unsigned int*)ph;
		unsigned int p_flags = *(const unsigned int*)(ph + 4);
		if (p_type != 1 || !(p_flags & 1)) continue;
		unsigned long long p_vaddr = *(const unsigned long long*)(ph + 0x10);
		unsigned long long p_filesz = *(const unsigned long long*)(ph + 0x20);
		h = ks_hash_seg(h, (const unsigned char*)(base + p_vaddr), p_filesz);
	}
	return h;
}

/* ===== 资源完整性校验（宿主测试定义 KS_SKIP_VERIFY 桩掉;KS_HOST_TEST 下崩溃点改为记录 ks_died_mask） ===== */
static unsigned ks_g_sig = 0x9E3779B9u;   /* 校验签名: 初始即"未完成校验"的错误态 */
static int ks_g_sig_armed = 0;            /* 仅设备端构造函数完成校验后置 1,渲染层据此启用签名门 */

#ifndef KS_SKIP_VERIFY
/* manifest.json 里 enable 字段必须为字面 true（容错冒号前后空白,键名经栈解码不明文落盘）。
   三态返回: 1=通过 0=打不开(不可判定) 2=读到内容但明确不符 */
static int ks_manifest_enabled(void) {
    static const unsigned char enc_mf[] = { @@SFX_MANIFEST_ENC@@ };
    static const unsigned char enc_key[] = { @@KEY_ENABLE_ENC@@ };
    char sfx[48];
    char mf[192];
    char key[8];
    ks_dec(sfx, enc_mf, (int)sizeof(enc_mf));
    ks_res_path(mf, sizeof(mf), sfx);
    FILE* f = fopen(mf, "rb");
    if (!f) return 0;
    char buf[4096];
    size_t n = fread(buf, 1, sizeof(buf) - 1, f);
    fclose(f);
    buf[n] = 0;
    ks_dec(key, enc_key, (int)sizeof(enc_key));
    /* 搜 enable 并验证两侧引号，避免误匹配 enabled 之类 */
    const char* p = strstr(buf, key);
    while (p && !(p > buf && p[-1] == '"' && p[6] == '"')) p = strstr(p + 1, key);
    if (!p) return 2;
    p += 7;
    while (*p == ' ' || *p == '\\t' || *p == '\\r' || *p == '\\n') p++;
    if (*p != ':') return 2;
    p++;
    while (*p == ' ' || *p == '\\t' || *p == '\\r' || *p == '\\n') p++;
    return (p[0] == 't' && p[1] == 'r' && p[2] == 'u' && p[3] == 'e') ? 1 : 2;
}

/* FNV-1a 32: 校验目标的期望值只以散列常量驻留二进制，不明文落盘 */
static unsigned ks_fnv(const char* p, int n) {
    unsigned h = 2166136261u;
    int i = 0;
    while (i < n) {
        h = (h ^ (unsigned char)p[i]) * 16777619u;
        i++;
    }
    return h;
}

static const unsigned char ks_enc_menu_path[] = { @@MENU_PATH_ENC@@ };
static const unsigned char ks_enc_uidef_path[] = { @@UUIDEF_PATH_ENC@@ };

/* 从 from 起找带引号的 key（两侧引号校验，防 $menu_title_xxx 之类误配），找不到返回 0 */
static const char* ks_json_key(const char* buf, const char* from, const char* key) {
    int klen = 0;
    while (key[klen]) klen++;
    const char* p = strstr(from, key);
    while (p && !(p > buf && p[-1] == '"' && p[klen] == '"')) p = strstr(p + 1, key);
    return p;
}

/* 定位 key 的字符串值区间: p 指向 key 文本（去掉了开引号），冒号两侧容忍空白;
   成功返回 0 并给出值起点/长度（值按 JSON 源字节，不展开转义） */
static int ks_json_val_pos(const char* p, int klen, const char** vp, int* vn) {
    p += klen + 1;
    while (*p == ' ' || *p == '\\t' || *p == '\\r' || *p == '\\n') p++;
    if (*p != ':') return -1;
    p++;
    while (*p == ' ' || *p == '\\t' || *p == '\\r' || *p == '\\n') p++;
    if (*p != '"') return -1;
    p++;
    const char* s = p;
    while (*p && *p != '"') p++;
    if (!*p) return -1;
    *vp = s;
    *vn = (int)(p - s);
    return 0;
}

/* 主菜单 title.name 的散列必须匹配（title 对象内无嵌套对象，其后首个 name 即 title 的 name）;三态返回 */
static int ks_menu_title_ok(void) {
    char rp[64];
    ks_dec(rp, ks_enc_menu_path, (int)sizeof(ks_enc_menu_path));
    char mf[192];
    ks_res_path(mf, sizeof(mf), rp);
    FILE* f = fopen(mf, "rb");
    if (!f) return 0;
    char buf[8192];
    size_t n = fread(buf, 1, sizeof(buf) - 1, f);
    fclose(f);
    buf[n] = 0;
    static const unsigned char enc_kt[] = { @@KEY_TITLE_ENC@@ };
    static const unsigned char enc_kn[] = { @@KEY_NAME_ENC@@ };
    char kt[8], kn[8];
    ks_dec(kt, enc_kt, (int)sizeof(enc_kt));
    ks_dec(kn, enc_kn, (int)sizeof(enc_kn));
    const char* t = ks_json_key(buf, buf, kt);
    if (!t) return 2;
    const char* nm = ks_json_key(buf, t + 6, kn);
    if (!nm) return 2;
    const char* vp;
    int vn;
    if (ks_json_val_pos(nm, 4, &vp, &vn) != 0) return 2;
    return ks_fnv(vp, vn) == @@HASH_KUSUG@@ ? 1 : 2;
}

/* ui_definition 顶层 name 的散列必须匹配;三态返回 */
static int ks_uidef_name_ok(void) {
    char rp[64];
    ks_dec(rp, ks_enc_uidef_path, (int)sizeof(ks_enc_uidef_path));
    char mf[192];
    ks_res_path(mf, sizeof(mf), rp);
    FILE* f = fopen(mf, "rb");
    if (!f) return 0;
    char buf[4096];
    size_t n = fread(buf, 1, sizeof(buf) - 1, f);
    fclose(f);
    buf[n] = 0;
    static const unsigned char enc_kn2[] = { @@KEY_NAME_ENC@@ };
    char kn2[8];
    ks_dec(kn2, enc_kn2, (int)sizeof(enc_kn2));
    const char* nm = ks_json_key(buf, buf, kn2);
    if (!nm) return 2;
    const char* vp;
    int vn;
    if (ks_json_val_pos(nm, 4, &vp, &vn) != 0) return 2;
    return ks_fnv(vp, vn) == @@HASH_UUIDEF@@ ? 1 : 2;
}

/* 分散崩溃点: 六处形态互不相同，无法靠单一特征批量定位 NOP;KS_HOST_TEST 下仅记录掩码 */
static int ks_died_mask = 0;
static void ks_die_a(void) {
#ifdef KS_HOST_TEST
    ks_died_mask |= 1;
    return;
#else
    *(volatile unsigned char*)0 = 0xA1;
#endif
}
static void ks_die_b(void) {
#ifdef KS_HOST_TEST
    ks_died_mask |= 2;
    return;
#else
    *(volatile unsigned short*)0 = 0xB2B2;
#endif
}
static void ks_die_c(void) {
#ifdef KS_HOST_TEST
    ks_died_mask |= 4;
    return;
#else
    __builtin_trap();
#endif
}
static void ks_die_d(void) {
#ifdef KS_HOST_TEST
    ks_died_mask |= 8;
    return;
#else
    *(volatile unsigned long long*)1 = 0xD4D4D4D4ull;
#endif
}
static void ks_die_e(void) {
#ifdef KS_HOST_TEST
    ks_died_mask |= 16;
    return;
#else
    __asm__ volatile(".word 0x00000000");
#endif
}
static void ks_die_f(void) {
#ifdef KS_HOST_TEST
    ks_died_mask |= 32;
    return;
#else
    *(volatile unsigned char*)0 = 0xF6;
    __builtin_trap();
#endif
}
static void ks_die_g(void) {
#ifdef KS_HOST_TEST
    ks_died_mask |= 64;
    return;
#else
    *(volatile unsigned char*)0 = 0x7B;
    __builtin_trap();
#endif
}

/* 六项校验: 任一项不过就地崩溃（每点指令形态不同）;
   每通过一项折叠一项进签名，最终正确签名由构建脚本预算,
   渲染层按签名决定画面——NOP 掉全部崩溃点也救不回错误签名 */
static int ks_verify_files(void) {
    static const unsigned char enc_js[] = { @@SFX_KSJS_ENC@@ };
    static const unsigned char enc_jv[] = { @@SFX_JAVAPLUGIN_ENC@@ };
    int ok = 1;
    char sfx[64];
    char p[192];
    ks_dec(sfx, enc_js, (int)sizeof(enc_js));
    ks_res_path(p, sizeof(p), sfx);
    if (access(p, 0) != 0) { ok = 0; ks_die_a(); } else ks_g_sig = ks_g_sig * 33u + 0x3C6EF35Fu;
    ks_dec(sfx, enc_jv, (int)sizeof(enc_jv));
    ks_res_path(p, sizeof(p), sfx);
    if (access(p, 0) != 0) { ok = 0; ks_die_b(); } else ks_g_sig = ks_g_sig * 33u + 0x1F123BB7u;
    int st = ks_manifest_enabled();
    if (st != 1) { ok = 0; ks_die_c(); } else ks_g_sig = ks_g_sig * 33u + 0x58F38D17u;
    st = ks_menu_title_ok();
    if (st != 1) { ok = 0; ks_die_d(); } else ks_g_sig = ks_g_sig * 33u + 0x71A9E4CBu;
    st = ks_uidef_name_ok();
    if (st != 1) { ok = 0; ks_die_e(); } else ks_g_sig = ks_g_sig * 33u + 0x2653C799u;
    return ok;
}

/* ===== SHA-256(自包含零依赖;boot 期给 KuSug.js 取内容指纹用;宿主测试锁标准向量) ===== */
static const unsigned ks_shk[64] = {
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
    0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
    0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
    0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u
};
typedef struct { unsigned h[8]; unsigned char blk[64]; unsigned long long total; unsigned used; } ks_sha_t;
static void ks_sha_block(ks_sha_t* c, const unsigned char* p) {
    unsigned w[64];
    int i;
    for (i = 0; i < 16; i++)
        w[i] = ((unsigned)p[i * 4] << 24) | ((unsigned)p[i * 4 + 1] << 16) | ((unsigned)p[i * 4 + 2] << 8) | (unsigned)p[i * 4 + 3];
    for (i = 16; i < 64; i++) {
        unsigned s0 = ((w[i - 15] >> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >> 3);
        unsigned s1 = ((w[i - 2] >> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    unsigned a = c->h[0], b = c->h[1], cc = c->h[2], d = c->h[3], e = c->h[4], f = c->h[5], g = c->h[6], hh = c->h[7];
    for (i = 0; i < 64; i++) {
        unsigned S1 = ((e >> 6) | (e << 26)) ^ ((e >> 11) | (e << 21)) ^ ((e >> 25) | (e << 7));
        unsigned ch = (e & f) ^ (~e & g);
        unsigned t1 = hh + S1 + ch + ks_shk[i] + w[i];
        unsigned S0 = ((a >> 2) | (a << 30)) ^ ((a >> 13) | (a << 19)) ^ ((a >> 22) | (a << 10));
        unsigned mj = (a & b) ^ (a & cc) ^ (b & cc);
        unsigned t2 = S0 + mj;
        hh = g; g = f; f = e; e = d + t1; d = cc; cc = b; b = a; a = t1 + t2;
    }
    c->h[0] += a; c->h[1] += b; c->h[2] += cc; c->h[3] += d; c->h[4] += e; c->h[5] += f; c->h[6] += g; c->h[7] += hh;
}
static void ks_sha_init(ks_sha_t* c) {
    static const unsigned h0[8] = { 0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au, 0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u };
    int i;
    for (i = 0; i < 8; i++) c->h[i] = h0[i];
    c->total = 0; c->used = 0;
}
static void ks_sha_update(ks_sha_t* c, const unsigned char* d, unsigned long long n) {
    c->total += n;
    while (n > 0) {
        unsigned long long room = 64 - c->used;
        unsigned long long take = n < room ? n : room;
        unsigned long long i;
        for (i = 0; i < take; i++) c->blk[c->used + i] = d[i];
        c->used += (unsigned)take; d += take; n -= take;
        if (c->used == 64) { ks_sha_block(c, c->blk); c->used = 0; }
    }
}
static void ks_sha_final(ks_sha_t* c, unsigned char out[32]) {
    unsigned long long bits = c->total * 8;
    unsigned char pad = 0x80, z = 0, lenb[8];
    int i;
    ks_sha_update(c, &pad, 1);
    while (c->used != 56) ks_sha_update(c, &z, 1);
    for (i = 0; i < 8; i++) lenb[i] = (unsigned char)(bits >> (56 - i * 8));
    ks_sha_update(c, lenb, 8);
    for (i = 0; i < 8; i++) {
        out[i * 4] = (unsigned char)(c->h[i] >> 24);
        out[i * 4 + 1] = (unsigned char)(c->h[i] >> 16);
        out[i * 4 + 2] = (unsigned char)(c->h[i] >> 8);
        out[i * 4 + 3] = (unsigned char)(c->h[i]);
    }
}

/* 第八项校验(boot 期): so 自读 KuSug.js 取内容指纹 F64(SHA-256 前 8 字节 LE),
   低 32 位比对 ks_js_exp 槽(finalize_so.py js 回填),并输出 F64 供 ks_key_derive 派生运行时密钥(内容为钥);
   三态: 1 通过 / 0 不符 / -1 不动作(不可读/槽未回填) */
static int ks_verify_js(unsigned long long* f_out) {
    static const unsigned char enc_js2[] = { @@SFX_KSJS_ENC@@ };
    char sfx[64];
    char p[192];
    unsigned char dg[32];
    unsigned char buf[4096];
    ks_sha_t cx;
    FILE* f;
    size_t n;
    int i;
    ks_dec(sfx, enc_js2, (int)sizeof(enc_js2));
    ks_res_path(p, sizeof(p), sfx);
    f = fopen(p, "rb");
    if (!f) return -1;
    ks_sha_init(&cx);
    while ((n = fread(buf, 1, sizeof buf, f)) > 0) ks_sha_update(&cx, buf, (unsigned long long)n);
    fclose(f);
    ks_sha_final(&cx, dg);
    {
        unsigned long long fv = 0;
        for (i = 0; i < 8; i++) fv |= (unsigned long long)dg[i] << (i * 8);
        *f_out = fv;
    }
    if ((unsigned long long)(ks_js_exp >> 32) != 0x51F2A7C4ULL) return -1;  /* 槽结构损坏: 不动作 */
    if ((unsigned)(ks_js_exp & 0xFFFFFFFFu) == 0) return -1;                /* 低 32 位 0 = 未回填 */
    return ((unsigned)*f_out == (unsigned)(ks_js_exp & 0xFFFFFFFFu)) ? 1 : 0;
}
#endif /* KS_SKIP_VERIFY */

typedef unsigned int GLenum; typedef unsigned int GLuint; typedef int GLint; typedef int GLsizei;
typedef unsigned char GLboolean; typedef float GLfloat; typedef unsigned int GLbitfield; typedef ptrdiff_t GLsizeiptr;
typedef void* EGLDisplay; typedef void* EGLSurface; typedef void* EGLContext; typedef int EGLint; typedef unsigned int EGLBoolean;

static void (*pglGetIntegerv)(GLenum, GLint*);
static GLboolean (*pglIsEnabled)(GLenum);
static void (*pglViewport)(GLint, GLint, GLsizei, GLsizei);
static void (*pglEnable)(GLenum);
static void (*pglDisable)(GLenum);
static void (*pglBlendFunc)(GLenum, GLenum);
static void (*pglBlendFuncSeparate)(GLenum, GLenum, GLenum, GLenum);
static void (*pglGenBuffers)(GLsizei, GLuint*);
static void (*pglDeleteBuffers)(GLsizei, const GLuint*);
static void (*pglBindBuffer)(GLenum, GLuint);
static void (*pglBufferData)(GLenum, GLsizeiptr, const void*, GLenum);
static void (*pglVertexAttribPointer)(GLuint, GLint, GLenum, GLboolean, GLsizei, const void*);
static void (*pglEnableVertexAttribArray)(GLuint);
static GLint (*pglGetAttribLocation)(GLuint, const char*);
static GLuint (*pglCreateShader)(GLenum);
static void (*pglShaderSource)(GLuint, GLsizei, const char* const*, const GLint*);
static void (*pglCompileShader)(GLuint);
static void (*pglGetShaderiv)(GLuint, GLenum, GLint*);
static GLuint (*pglCreateProgram)(void);
static void (*pglAttachShader)(GLuint, GLuint);
static void (*pglLinkProgram)(GLuint);
static void (*pglGetProgramiv)(GLuint, GLenum, GLint*);
static void (*pglGetShaderInfoLog)(GLuint, GLsizei, GLsizei*, char*);
static void (*pglGetProgramInfoLog)(GLuint, GLsizei, GLsizei*, char*);
static void (*pglUseProgram)(GLuint);
static void (*pglGenVertexArrays)(GLsizei, GLuint*);
static void (*pglBindVertexArray)(GLuint);
static void (*pglDrawArrays)(GLenum, GLint, GLsizei);
static GLint (*pglGetUniformLocation)(GLuint, const char*);
static void (*pglUniform1f)(GLint, GLfloat);
static void (*pglUniform2f)(GLint, GLfloat, GLfloat);
static void (*pglUniform1i)(GLint, GLint);
static void (*pglDeleteShader)(GLuint);
static void (*pglGenTextures)(GLsizei, GLuint*);
static void (*pglDeleteTextures)(GLsizei, const GLuint*);
static void (*pglBindTexture)(GLenum, GLuint);
static void (*pglTexImage2D)(GLenum, GLint, GLint, GLsizei, GLsizei, GLint, GLenum, GLenum, const void*);
static void (*pglTexSubImage2D)(GLenum, GLint, GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, const void*);
static void (*pglTexParameteri)(GLenum, GLenum, GLint);
static void (*pglCopyTexSubImage2D)(GLenum, GLint, GLint, GLint, GLint, GLint, GLsizei, GLsizei);
static void (*pglActiveTexture)(GLenum);
static EGLBoolean (*peglQuerySurface)(EGLDisplay, EGLSurface, EGLint, EGLint*);
static EGLContext (*peglGetCurrentContext)(void);
static EGLDisplay (*peglGetCurrentDisplay)(void) = 0;
static EGLSurface (*peglGetCurrentSurface)(EGLint) = 0;   /* sv 兜底模式取当前绘制面(EGL_DRAW=0x3059) */

#define GL_TRIANGLES 0x0004
#define GL_TRIANGLE_STRIP 0x0005
#define GL_BLEND 0x0BE2
#define GL_DEPTH_TEST 0x0B71
#define GL_CULL_FACE 0x0B44
#define GL_SCISSOR_TEST 0x0C11
#define GL_SRC_ALPHA 0x0302
#define GL_ONE_MINUS_SRC_ALPHA 0x0303
#define GL_ARRAY_BUFFER_BINDING 0x8894
#define GL_ARRAY_BUFFER 0x8892
#define GL_STATIC_DRAW 0x88E4
#define GL_FLOAT 0x1406
#define GL_POINTS 0x0000
#define GL_CURRENT_PROGRAM 0x8B8D
#define GL_VERTEX_ARRAY_BINDING 0x85B5
#define GL_VIEWPORT 0x0BA2
#define GL_BLEND_SRC_RGB 0x80C9
#define GL_BLEND_DST_RGB 0x80C8
#define GL_BLEND_SRC_ALPHA 0x80CB
#define GL_BLEND_DST_ALPHA 0x80CA
#define GL_VERTEX_SHADER 0x8B31
#define GL_FRAGMENT_SHADER 0x8B30
#define GL_COMPILE_STATUS 0x8B81
#define GL_LINK_STATUS 0x8B82
#define GL_TEXTURE_2D 0x0DE1
#define GL_TEXTURE_BINDING_2D 0x8069
#define GL_TEXTURE_MIN_FILTER 0x2801
#define GL_TEXTURE_MAG_FILTER 0x2800
#define GL_TEXTURE_WRAP_S 0x2802
#define GL_TEXTURE_WRAP_T 0x2803
#define GL_LINEAR 0x2601
#define GL_CLAMP_TO_EDGE 0x812F
#define GL_RGBA 0x1908
#define GL_UNSIGNED_BYTE 0x1401
#define GL_TEXTURE0 0x84C0
#define GL_ACTIVE_TEXTURE 0x84E0
#define EGL_WIDTH 0x3057
#define EGL_HEIGHT 0x3056

static volatile int ks_rlock = 0;
static volatile long ks_g_swaps = 0;
static long ks_sv_frames = 0, ks_sv_missed = 0, ks_sv_tailsw = 0;   /* 帧尾驱动打点: 总帧数/丢帧数(=用户感知的整闪)/切尾次数 */
static long ks_wproj_rej = 0;   /* 非主世界投影拒绝数(mtx 多数决锁) */
static long ks_wmr_snaps = 0;   /* maps 快照刷新次数 */
static volatile long ks_g_maxarea = 0;
static int ks_g_logged_dispatch = 0;
static int ks_try_enter(void) { return __sync_lock_test_and_set(&ks_rlock, 1) == 0; }
static void ks_leave(void) { __sync_lock_release(&ks_rlock); }

static void ks_render_active(EGLDisplay dpy, EGLSurface surf) {
    if (!ks_try_enter()) return;
    int a = (mb_active() ? 1 : 0) | (ih_active() ? 2 : 0) | (dir_active() ? 4 : 0) | (ch_active() ? 8 : 0) | (wm_active() ? 16 : 0) | (wpl_active() ? 32 : 0);
    if (!ks_g_logged_dispatch) {
        ks_g_logged_dispatch = 1;
        ks_logf("[core]", "first dispatch swaps=%ld active=%02x dpy=%p surf=%p", ks_g_swaps, a, (void*)dpy, (void*)surf);
    }
    if ((ks_g_swaps % 600) == 0) {
        ks_logf("[core]", "heartbeat swaps=%ld active=%02x miss=%ld/%ld tailsw=%ld prej=%ld snap=%ld dpy=%p surf=%p",
            ks_g_swaps, a, ks_sv_missed, ks_sv_frames, ks_sv_tailsw, ks_wproj_rej, ks_wmr_snaps, (void*)dpy, (void*)surf);
    }
    /* 签名织染: 校验签名错误时按帧计数奇偶随机丢模块渲染——画面闪烁降级但游戏不崩;
       NOP 掉构造函数的崩溃点救不回错误签名,因为折叠只发生在真实通过的分支里;
       期望值在 finalize_so.py 回填进 .data 槽(含自身代码段哈希),marker 未回填时不降级防漏跑 */
    unsigned bad = 0u;
    if (ks_g_sig_armed) {
        unsigned long long slot = ks_slot_sig;
        if (slot != 0xA5C39E17D4F806B1ULL) bad = ks_g_sig ^ (unsigned)slot;
    }
#ifndef KS_SKIP_VERIFY
    /* 惰性复检: 每 1800 帧复查三项内容校验+自身代码段哈希,内容明确不符或代码被改即定罪(文件暂不可读不动作) */
    if (ks_g_sig_armed && ks_g_swaps > 0 && (ks_g_swaps % 1800) == 0) {
        if (ks_menu_title_ok() == 2 || ks_uidef_name_ok() == 2 || ks_manifest_enabled() == 2) {
            ks_g_sig = 0xBADC0DE1u;
        } else if (ks_self_hash() != ks_g_hv) {
            ks_g_sig = 0xDEADBEEFu;
        }
    }
#endif
    if (bad) {
        if (mb_active() && ((ks_g_swaps + (long)bad) % 2)) mb_render(dpy, surf);
        if (ih_active() && ((ks_g_swaps + (long)bad) % 3)) ih_render(dpy, surf);
        if (dir_active() && ((ks_g_swaps + (long)bad) % 2)) dir_render(dpy, surf);
        if (ch_active() && ((ks_g_swaps + (long)bad) % 3)) ch_render(dpy, surf);
        if (rd_active() && ((ks_g_swaps + (long)bad) % 3)) rd_render(dpy, surf);
        if (wm_active() && ((ks_g_swaps + (long)bad) % 2)) wm_render(dpy, surf);
        if (wpl_active() && ((ks_g_swaps + (long)bad) % 5)) wpl_render(dpy, surf);
        ks_leave();
        return;
    }
    if (mb_active()) mb_render(dpy, surf);
    if (ih_active()) ih_render(dpy, surf);
    if (dir_active()) dir_render(dpy, surf);
    if (ch_active()) ch_render(dpy, surf);
    if (rd_active()) rd_render(dpy, surf);
    if (wm_active()) wm_render(dpy, surf);
    if (wpl_active()) wpl_render(dpy, surf);
    ks_leave();
}

/* ===== v31 渲染驱动: 仅 sv(ScreenView::render) 游戏函数钩, swap/GOT 兜底通道已移除 ===== */

/* ===== v30 通用 inline hook(苦力怕式函数头补丁,16B 绝对跳转 + 32B trampoline) =====
   与 wpl_ihook 同构但: 1) 16B 补丁跨页时两页都 mprotect; 2) 带恢复注册表(demo_stop 用) */
#ifndef MAP_PRIVATE
#define MAP_PRIVATE 2
#endif
#ifndef MAP_ANONYMOUS
#define MAP_ANONYMOUS 0x20
#endif
#ifndef PROT_EXEC
#define PROT_EXEC 4
#endif
extern void* mmap(void*, size_t, int, int, int, long);

static long ks_now_ms(void) {
	struct ks_ts { long s; long ns; } ts;
	ts.s = 0; ts.ns = 0;
	clock_gettime(1, &ts);   /* CLOCK_MONOTONIC;宿主桩返回 0 时恒 0,不影响宿主测试 */
	return ts.s * 1000 + ts.ns / 1000000;
}
static long ks_now_us(void) {
	struct ks_ts { long s; long ns; } ts;
	ts.s = 0; ts.ns = 0;
	clock_gettime(1, &ts);
	return ts.s * 1000000 + ts.ns / 1000;
}
/* 开关动画推进(全渲染模块共享): on=目标, 300ms 线性推进, 返回 0..1; 调用方自行 ease/花式映射 */
static float ks_anim(float* p, long* pt, int on) {
	long t = ks_now_ms();
	long dt = t - *pt;
	*pt = t;
	if (dt <= 0 || dt > 500) dt = 16;
	*p += (float)dt / 300.0f * (on ? 1.0f : -1.0f);
	if (*p > 1.0f) *p = 1.0f;
	if (*p < 0.0f) *p = 0.0f;
	return *p;
}

typedef struct { void* fn; unsigned char saved[16]; } KsIhReg;
static KsIhReg ks_ih_reg[8];
static int ks_ih_regn = 0;
static char* ks_ih_page = 0;
static int ks_ih_used = 0;

static int ks_ih_unsafe(unsigned w) {
	if ((w & 0x9F000000) == 0x10000000) return 1;  /* ADR */
	if ((w & 0x9F000000) == 0x90000000) return 1;  /* ADRP */
	if ((w & 0xFC000000) == 0x14000000) return 1;  /* B */
	if ((w & 0xFC000000) == 0x94000000) return 1;  /* BL */
	if ((w & 0xFF000010) == 0x54000000) return 1;  /* B.cond */
	if ((w & 0x7E000000) == 0x34000000) return 1;  /* CBZ/CBNZ */
	if ((w & 0x7E000000) == 0x36000000) return 1;  /* TBZ/TBNZ */
	if ((w & 0x3B000000) == 0x18000000) return 1;  /* LDR literal */
	return 0;
}

static void* ks_ihook(void* fn, void* hook) {
	if (!fn || !hook || ks_ih_regn >= 8) return 0;
	if (!ks_ih_page || ks_ih_used > 4096 - 64) {
		ks_ih_page = (char*)mmap(0, 4096, PROT_READ | PROT_WRITE | PROT_EXEC, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
		ks_ih_used = 0;
		if ((uintptr_t)ks_ih_page == (uintptr_t)-1) { ks_ih_page = 0; return 0; }
	}
	unsigned* src = (unsigned*)fn;
	int i;
	for (i = 0; i < 4; i++) if (ks_ih_unsafe(src[i])) return 0;
	unsigned* tramp = (unsigned*)(ks_ih_page + ks_ih_used);
	ks_ih_used += 32;
	for (i = 0; i < 4; i++) tramp[i] = src[i];
	tramp[4] = 0x58000051;   /* ldr x17, #8 */
	tramp[5] = 0xD61F0220;   /* br x17 */
	*(void**)(tramp + 6) = (char*)fn + 16;
	__builtin___clear_cache((char*)tramp, (char*)tramp + 32);
	unsigned patch[4];
	patch[0] = 0x58000051;
	patch[1] = 0xD61F0220;
	*(void**)(patch + 2) = hook;
	uintptr_t p0 = (uintptr_t)fn & ~(uintptr_t)4095;
	uintptr_t p1 = ((uintptr_t)fn + 15) & ~(uintptr_t)4095;
	mprotect((void*)p0, 4096, PROT_READ | PROT_WRITE | PROT_EXEC);
	if (p1 != p0) mprotect((void*)p1, 4096, PROT_READ | PROT_WRITE | PROT_EXEC);
	memcpy(ks_ih_reg[ks_ih_regn].saved, fn, 16);
	ks_ih_reg[ks_ih_regn].fn = fn;
	ks_ih_regn++;
	memcpy(fn, patch, 16);
	__builtin___clear_cache((char*)fn, (char*)fn + 16);
	mprotect((void*)p0, 4096, PROT_READ | PROT_EXEC);
	if (p1 != p0) mprotect((void*)p1, 4096, PROT_READ | PROT_EXEC);
	return tramp;
}

static void ks_ihook_restore_all(void) {
	int i;
	for (i = 0; i < ks_ih_regn; i++) {
		void* fn = ks_ih_reg[i].fn;
		uintptr_t p0 = (uintptr_t)fn & ~(uintptr_t)4095;
		uintptr_t p1 = ((uintptr_t)fn + 15) & ~(uintptr_t)4095;
		mprotect((void*)p0, 4096, PROT_READ | PROT_WRITE | PROT_EXEC);
		if (p1 != p0) mprotect((void*)p1, 4096, PROT_READ | PROT_WRITE | PROT_EXEC);
		memcpy(fn, ks_ih_reg[i].saved, 16);
		__builtin___clear_cache((char*)fn, (char*)fn + 16);
		mprotect((void*)p0, 4096, PROT_READ | PROT_EXEC);
		if (p1 != p0) mprotect((void*)p1, 4096, PROT_READ | PROT_EXEC);
	}
	ks_ih_regn = 0;
}

/* ---- v31 主通道: ScreenView::render 游戏函数 inline 打钩(苦力怕同法) ----
   偏移烘焙自 参考/FuncOffset-3.9.15.297907.json,函数头首字烘焙自游戏 bin;
   游戏更新后重跑签名扫描链出 JSON 再重建即可。首字不符=版本漂移,静默弃打不崩。
   每帧 UI 渲染必经、GL 上下文当前、世界 pass 已完成的稳定绘制点;每帧多次命中,
   14ms 限频一帧只驱动一次。sv 静默(未装/漂移)时 swap 通道 250ms 后接管兜底 */
static unsigned long ks_sv_off = @@KS_SV_OFF@@;
static unsigned long ks_sv_w0 = @@KS_SV_W0@@;
static uint64_t ks_mc_base = 0;
static int ks_sv_state = 0;   /* 0 未试 1 已打 -1 放弃 */
static long ks_sv_frame_us = 0;   /* 上次 sv 命中时间(任意屏幕, µs) */
static int ks_sv_drew = 0;
static void* ks_sv_tail = 0;      /* 帧尾屏幕指针(自适应学习): 每帧最后一次命中的 ScreenView */
static void* ks_sv_last_this = 0; /* 上一次命中的 ScreenView */
static long ks_sv_drove_us = 0;   /* 上次驱动时间(µs, 帧尾同帧重复命中防护) */
static long ks_sv_per_us = 8333;  /* 帧间隔滚动估计(µs, EMA; 初始按 120Hz) */
static long ks_sv_lastb_us = 0;   /* 上次帧边界结算时间(µs) */
static void* ks_sv_pend = 0;      /* 切尾候选: 须连续 2 帧最后出线才切换(瞬时第三屏抢尾 = 全 HUD 闪一帧) */
static int ks_sv_pend_n = 0;
static int ks_sv_drove_infra = 0; /* 本帧是否已驱动(帧边界处据此计丢帧) */
typedef void (*ks_sv_fn)(void*, void*);
static ks_sv_fn ks_sv_orig = 0;

static void hk_sv_render(void* self, void* ctx) {
	if (ks_sv_orig) ks_sv_orig(self, ctx);
	long now = ks_now_us();
	/* 阈值随帧节奏自适应(v33): 固定 5ms 在 120Hz(8.3ms 帧)下 ms 粒度直接失效——帧间空隙与帧内间隔同量级,
	   边界不结算 + 去重窗误杀帧尾 = 周期性整层灭帧(用户感知的闪一下)。改为 µs 钟 + 帧间隔 EMA 比例阈值 */
	long gap_th = ks_sv_per_us / 2;
	if (gap_th < 2500) gap_th = 2500;
	if (gap_th > 5500) gap_th = 5500;
	long dup_th = ks_sv_per_us / 4;
	if (dup_th < 1000) dup_th = 1000;
	if (dup_th > 5000) dup_th = 5000;
	if (ks_sv_frame_us && now - ks_sv_frame_us > gap_th && ks_sv_last_this) {
		void* cand = ks_sv_last_this;
		if (!ks_sv_drove_infra) ks_sv_missed++;           /* 刚结束的这帧没驱动 = 全 HUD 灭一帧 */
		ks_sv_drove_infra = 0;
		ks_sv_frames++;
		if (ks_sv_lastb_us) {
			long per = now - ks_sv_lastb_us;
			if (per > 2000 && per < 100000) ks_sv_per_us = ks_sv_per_us * 7 / 8 + per / 8;
		}
		ks_sv_lastb_us = now;
		if (cand == ks_sv_tail) { ks_sv_pend = 0; ks_sv_pend_n = 0; }
		else if (cand == ks_sv_pend && ++ks_sv_pend_n >= 2) {
			if (ks_sv_tailsw < 8) ks_logf("[core]", "sv tail switch %p -> %p f=%ld", ks_sv_tail, cand, ks_sv_frames);
			ks_sv_tailsw++;
			ks_sv_tail = cand; ks_sv_pend = 0; ks_sv_pend_n = 0;
		} else if (cand != ks_sv_pend) { ks_sv_pend = cand; ks_sv_pend_n = 1; }
	}
	ks_sv_frame_us = now;
	ks_sv_last_this = self;
	if (self != ks_sv_tail) return;                     /* 只在帧尾屏幕驱动: 一帧一次, 画在整帧 UI 之上 */
	if (now - ks_sv_drove_us < dup_th) return;          /* 帧尾同帧重复命中防护 */
	ks_sv_drove_us = now;
	ks_sv_drove_infra = 1;
	ks_g_swaps++;
	if (!peglGetCurrentDisplay || !peglGetCurrentSurface) return;
	EGLDisplay dpy = peglGetCurrentDisplay();
	EGLSurface surf = peglGetCurrentSurface(0x3059);   /* EGL_DRAW */
	if (!dpy || !surf) return;
	if (!ks_sv_drew) { ks_sv_drew = 1; ks_logf("[core]", "sv 主通道接管渲染(帧尾屏幕锁定) dpy=%p surf=%p", (void*)dpy, (void*)surf); }
	ks_render_active(dpy, surf);
}

static int ks_mc_phdr_cb(struct dl_phdr_info* info, size_t size, void* data) {
	KS_LKS(n_libmc, @@N_LIBMC_ENC@@);
	(void)size; (void)data;
	if (info->dlpi_name && strstr(info->dlpi_name, n_libmc) && info->dlpi_addr) {
		ks_mc_base = (uint64_t)info->dlpi_addr;
		return 1;
	}
	return 0;
}

static uint64_t ks_mc_base_maps(void) {
	KS_LKS(n_libmc2, @@N_LIBMC_ENC@@);
	KS_LKS(n_maps, @@N_MAPS_ENC@@);
	FILE* f = fopen(n_maps, "r");
	if (!f) return 0;
	char line[512];
	uint64_t base = 0;
	while (fgets(line, (int)sizeof(line), f)) {
		if (!strstr(line, n_libmc2)) continue;
		unsigned long long lo = 0;
		if (sscanf(line, "%llx-", &lo) == 1 && (!base || lo < base)) base = lo;
	}
	fclose(f);
	return base;
}

static uint64_t ks_game_base(void) {
	if (!ks_mc_base) {
		dl_iterate_phdr(ks_mc_phdr_cb, 0);
		if (!ks_mc_base) ks_mc_base = ks_mc_base_maps();
	}
	return ks_mc_base;
}

static void ks_sv_install(void) {
	if (ks_sv_state != 0) return;
	ks_sv_state = -1;
	if (!ks_sv_off) { ks_logf("[core]", "sv hook: 未烘焙偏移, 跳过"); return; }
	if (!ks_game_base()) { ks_logf("[core]", "sv hook: libminecraftpe 基址未找到"); return; }
	volatile unsigned* pc = (volatile unsigned*)(uintptr_t)(ks_mc_base + ks_sv_off);
	unsigned w0 = *pc;
	if (ks_sv_w0 && w0 != (unsigned)ks_sv_w0) {
		ks_logf("[core]", "sv hook: 函数头不符 exp=%08lx got=%08x (游戏版本漂移), 弃打", ks_sv_w0, w0);
		return;
	}
	void* t = ks_ihook((void*)(uintptr_t)(ks_mc_base + ks_sv_off), (void*)hk_sv_render);
	if (!t) { ks_logf("[core]", "sv hook: 函数头含 PC 相对指令不可搬, 弃打 w0=%08x", w0); return; }
	ks_sv_orig = (ks_sv_fn)t;
	ks_sv_state = 1;
	ks_logf("[core]", "sv hook ok base=%llx off=%lx", (unsigned long long)ks_mc_base, ks_sv_off);
}

/* ---- v32 世界矩阵管线(探针实证配方): mesh 钩发现常驻 Camera, mtx 钩缓存世界 pass 矩阵 ----
   mesh=MeshHelpers::renderMeshImmediately @0x7B83EC8 首字 A9BC7BFD: 仅 UI 即时绘制调用(720/s),
   x0=ctx, ctx+0x20 指向常驻 Camera 对象; Camera 内三栈相邻: +0x00 视图/+0x48 模型/+0x90 投影,
   栈顶=map[(f28+f20-1)>>6]+((f28+f20-1)&63)*64 (map=栈+8, f20=栈+0x20, f28=栈+0x28, 元素 64B)。
   mtx=MatrixStack::push @0x8F947BC 首字 A9BE7BFD: 世界 pass 期间高频(15k/s)。
   两钩均走汇编全现场 stub(mesh 收浮点参数、mtx 入口读 x8, C 钩体会破坏 ABI——v31 探针实证) */
#ifndef KS_SKIP_VERIFY
extern void ks_stub_mesh(void);
extern void ks_stub_mtx(void);
#endif
__attribute__((visibility("hidden"))) void* ks_tramp_slots[2];

static unsigned long long ks_wcam = 0;   /* mesh 钩发现并经内容校验的常驻 Camera 指针 */
static void* ks_game_ctx = 0;            /* 游戏 GL 上下文(mesh 钩相机校验处登记, 供 wpl_ctx_is_game 门用) */
static volatile long ks_game_ctx_ms = 0;
static float ks_wview[16], ks_wproj[16];
static volatile long ks_wmat_ms = 0;     /* 矩阵缓存新鲜度 */
static int ks_w_state = 0;               /* 0 未试 1 已打 -1 放弃 */

/* 可读映射缓存(矩阵读取护栏): 2s 刷新 */
static struct { unsigned long long lo, hi; } ks_wmr[16384];
static int ks_wmr_n = 0;
static long ks_wmr_ms = 0;
static int ks_wmr_last = 0;   /* 上次命中区间下标(热路径 O(1)) */

static char* ks_wmr_hexu64(char* p, unsigned long long* out) {
	unsigned long long v = 0;
	int nd = 0, d;
	for (;; p++) {
		char c = *p;
		if (c >= '0' && c <= '9') d = c - '0';
		else if (c >= 'a' && c <= 'f') d = c - 'a' + 10;
		else break;
		v = (v << 4) | (unsigned long long)d;
		nd++;
	}
	*out = v;
	return nd ? p : (char*)0;
}

/* 整读+手工解析 ~0.3ms; 旧的 fgets+sscanf 逐行在 ~6800 条 maps 上要 5-15ms, 每秒一次砸在渲染线程 = 整屏周期性闪帧 */
static void ks_wmr_snap(void) {
	KS_LKS(n_maps2, @@N_MAPS_ENC@@);
	FILE* f = fopen(n_maps2, "r");
	static char buf[1048576];
	long n = 0, r;
	char* p;
	int m = 0;
	if (!f) return;
	while (n < (long)sizeof(buf) - 1 && (r = fread(buf + n, 1, (size_t)(sizeof(buf) - 1 - (unsigned long)n), f)) > 0) n += r;
	fclose(f);
	buf[n] = 0;
	p = buf;
	while (m < 16384 && *p) {
		unsigned long long lo = 0, hi = 0;
		char* q = ks_wmr_hexu64(p, &lo);
		if (q && *q == '-') {
			q = ks_wmr_hexu64(q + 1, &hi);
			if (q && *q == ' ' && q[1] == 'r' && lo < hi) {
				ks_wmr[m].lo = lo;
				ks_wmr[m].hi = hi;
				m++;
			}
		}
		while (*p && *p != '\\n') p++;
		if (*p) p++;
	}
	ks_wmr_n = m;
	ks_wmr_last = 0;
	ks_wmr_ms = ks_now_ms();
	ks_wmr_snaps++;
}

static int ks_wmr_ok(unsigned long long p, unsigned long long len) {
	int i;
	p &= 0x00FFFFFFFFFFFFFFULL;   /* 剥 TBI 标签(Android 堆指针顶字节) */
	if (p < 0x10000 || !len || p + len < p) return 0;
	if (ks_now_ms() - ks_wmr_ms > 2000) ks_wmr_snap();
	i = ks_wmr_last;
	if (i < ks_wmr_n && p >= ks_wmr[i].lo && p + len <= ks_wmr[i].hi) return 1;
	for (i = 0; i < ks_wmr_n; i++)
		if (p >= ks_wmr[i].lo && p + len <= ks_wmr[i].hi) { ks_wmr_last = i; return 1; }
	return 0;
}

/* 读 MatrixStack 栈顶 16 浮点(探针验证配方), 失败返回 0 */
static int ks_w_stack_top_once(unsigned long long stack, float* out16) {
	unsigned long long map, f20, f28, combined, blk, top;
	if (!ks_wmr_ok(stack, 0x30)) return 0;
	map = (*(const unsigned long long*)(uintptr_t)(stack + 8)) & 0x00FFFFFFFFFFFFFFULL;
	f20 = *(const unsigned long long*)(uintptr_t)(stack + 0x20);
	f28 = *(const unsigned long long*)(uintptr_t)(stack + 0x28);
	if (!f28 || f28 > 0x10000 || f20 > 0x10000) return 0;
	combined = f28 + f20 - 1;
	if (!ks_wmr_ok(map + (combined >> 6) * 8, 8)) return 0;
	blk = (*(const unsigned long long*)(uintptr_t)(map + (combined >> 6) * 8)) & 0x00FFFFFFFFFFFFFFULL;
	top = blk + (combined & 63) * 64;
	if (!ks_wmr_ok(top, 64)) return 0;
	memcpy(out16, (const void*)(uintptr_t)top, 64);
	return 1;
}

static int ks_w_stack_top(unsigned long long stack, float* out16) {
	if (ks_w_stack_top_once(stack, out16)) return 1;
	if (ks_now_ms() - ks_wmr_ms > 200) {   /* 疑似快照过期(deque 扩容搬新页): 立即刷新重试一次 */
		ks_wmr_snap();
		return ks_w_stack_top_once(stack, out16);
	}
	return 0;
}

static int ks_w_affine(const float* m) {
	return m[3] == 0.0f && m[7] == 0.0f && m[11] == 0.0f && m[15] == 1.0f;
}

/* ---- v34 主世界投影滑窗众数锁 ----
   旧"连续 3 窗一致"锁在换世界后多 pass(手持物/界面 3D)交替下永远凑不齐一致(设备 prej 加速)。
   改为 64 样本环形窗按 p[0] 量化计票: 票王=主世界投影;
   初锁需满窗且票王严格领先(无平局); 换主需挑战者领先 8 票且连续 2 次评估保持(滞后防抖)。
   方案经 sim_vote.py 仿真: 冷启动/疾跑换主/噪声连击/均分/换世界重学/低占比全部通过 */
#define KS_PVQ_WIN 64
#define KS_PVQ_MARGIN 8
#define KS_PVQ_MAXV 8
static long ks_pvq_ring[KS_PVQ_WIN];
static int ks_pvq_head = 0, ks_pvq_filled = 0;
static long ks_pvq_v[KS_PVQ_MAXV];
static int ks_pvq_c[KS_PVQ_MAXV];
static int ks_pvq_n = 0;
static long ks_pvq_main = -1;
static long ks_pvq_pend = -1;
static int ks_pvq_pendn = 0;

static long ks_pvq_quant(float p0) {
	return (long)(p0 * 1024.0f + (p0 >= 0.0f ? 0.5f : -0.5f));
}
static int ks_pvq_idx(long q) {
	int i;
	for (i = 0; i < ks_pvq_n; i++) if (ks_pvq_v[i] == q) return i;
	return -1;
}
static void ks_pvq_bump(long q, int d) {
	int i = ks_pvq_idx(q);
	if (i < 0) {
		if (d > 0 && ks_pvq_n < KS_PVQ_MAXV) {
			ks_pvq_v[ks_pvq_n] = q;
			ks_pvq_c[ks_pvq_n] = d;
			ks_pvq_n++;
		}
		return;
	}
	ks_pvq_c[i] += d;
	if (ks_pvq_c[i] <= 0) {
		ks_pvq_n--;
		ks_pvq_v[i] = ks_pvq_v[ks_pvq_n];
		ks_pvq_c[i] = ks_pvq_c[ks_pvq_n];
	}
}
static void ks_pvq_reset(void) {
	ks_pvq_head = 0; ks_pvq_filled = 0; ks_pvq_n = 0;
	ks_pvq_main = -1; ks_pvq_pend = -1; ks_pvq_pendn = 0;
}
/* 喂一个透视 p[0]; 返回 1=本样本属于主世界投影(可更新矩阵) */
static int ks_pvq_feed(float p0) {
	long q = ks_pvq_quant(p0);
	int i, bi, second, mk, mc;
	if (ks_pvq_filled == KS_PVQ_WIN) ks_pvq_bump(ks_pvq_ring[ks_pvq_head], -1);
	else ks_pvq_filled++;
	ks_pvq_ring[ks_pvq_head] = q;
	ks_pvq_head = (ks_pvq_head + 1) % KS_PVQ_WIN;
	ks_pvq_bump(q, 1);
	if (!ks_pvq_n) return 0;
	bi = 0;
	for (i = 1; i < ks_pvq_n; i++) if (ks_pvq_c[i] > ks_pvq_c[bi]) bi = i;
	if (ks_pvq_main < 0) {
		second = 0;
		for (i = 0; i < ks_pvq_n; i++)
			if (i != bi && ks_pvq_c[i] > second) second = ks_pvq_c[i];
		if (ks_pvq_filled >= KS_PVQ_WIN && ks_pvq_c[bi] > second) {
			ks_pvq_main = ks_pvq_v[bi];
			ks_logf("[core]", "world proj lock p0=%ld/1024 c=%d/%d", ks_pvq_main, ks_pvq_c[bi], KS_PVQ_WIN);
		}
	} else {
		mk = ks_pvq_idx(ks_pvq_main);
		mc = mk >= 0 ? ks_pvq_c[mk] : 0;
		if (ks_pvq_v[bi] != ks_pvq_main && ks_pvq_c[bi] > mc + KS_PVQ_MARGIN) {
			if (ks_pvq_pend == ks_pvq_v[bi]) ks_pvq_pendn++;
			else { ks_pvq_pend = ks_pvq_v[bi]; ks_pvq_pendn = 1; }
			if (ks_pvq_pendn >= 2) {
				ks_logf("[core]", "world proj main %ld -> %ld (c=%d mc=%d)", ks_pvq_main, ks_pvq_v[bi], ks_pvq_c[bi], mc);
				ks_pvq_main = ks_pvq_v[bi];
				ks_pvq_pend = -1;
				ks_pvq_pendn = 0;
			}
		} else {
			ks_pvq_pend = -1;
			ks_pvq_pendn = 0;
		}
	}
	return ks_pvq_main >= 0 && q == ks_pvq_main;
}

/* asm stub 入口: idx 0=mesh(相机发现) 1=mtx(矩阵缓存); regs=stub 保存的 x0-x8/q0-q7/x29/x30 */
__attribute__((visibility("hidden"))) void ks_world_hit(long idx, const unsigned long long* regs) {
	if (idx == 0) {
		static int reval = 0;
		unsigned long long ctx = regs[0] & 0x00FFFFFFFFFFFFFFULL;
		unsigned long long cam;
		if (ctx < 0x10000 || !ks_wmr_ok(ctx, 0x28)) return;
		cam = (*(const unsigned long long*)(uintptr_t)(ctx + 0x20)) & 0x00FFFFFFFFFFFFFFULL;
		if (cam == ks_wcam) {
			if (peglGetCurrentContext) { ks_game_ctx = (void*)peglGetCurrentContext(); ks_game_ctx_ms = ks_now_ms(); }
			return;
		}
		if (ks_wcam && (reval++ % 600) != 0) return;
		{
			float v[16], p[16];
			if (!ks_w_stack_top(cam, v)) return;
			if (!ks_w_stack_top(cam + 0x90, p)) return;
			if (!ks_w_affine(v)) return;
			if (p[11] != -1.0f && p[15] != 1.0f) return;
			ks_wcam = cam;
			ks_pvq_reset();   /* 相机更换: 投影计票清零重新学习 */
			if (peglGetCurrentContext) { ks_game_ctx = (void*)peglGetCurrentContext(); ks_game_ctx_ms = ks_now_ms(); }
			ks_logf("[core]", "world cam found cam=%llx", ks_wcam);
		}
		return;
	} else if (idx == 1 && ks_wcam) {
		static long last_ms = 0;
		long now = ks_now_ms();
		float v[16], p[16];
		if (now - last_ms < 4) return;
		if (!ks_w_stack_top(ks_wcam, v)) return;
		if (!ks_w_stack_top(ks_wcam + 0x90, p)) return;
		if (!ks_w_affine(v)) return;
		if (p[11] != -1.0f) return;   /* 仅世界 pass(投影栈顶为透视阵) */
		if (!ks_pvq_feed(p[0])) {   /* v34 滑窗众数锁: 非主世界投影(手持物/界面 3D 等) */
			if (ks_wproj_rej < 6 || (ks_wproj_rej % 200) == 0)
				ks_logf("[core]", "world proj reject p0=%g main=%ld/1024 n=%ld", (double)p[0], ks_pvq_main, ks_wproj_rej);
			ks_wproj_rej++;
			last_ms = now;
			return;
		}
		memcpy(ks_wview, v, 64);
		memcpy(ks_wproj, p, 64);
		ks_wmat_ms = now;
		last_ms = now;
	}
}

static void ks_world_install(void) {
	unsigned char* pm;
	unsigned char* px;
	void* t1;
	void* t2;
	if (ks_w_state != 0) return;
	ks_w_state = -1;
	if (!ks_game_base()) return;
	pm = (unsigned char*)(uintptr_t)(ks_mc_base + 0x7B83EC8UL);
	px = (unsigned char*)(uintptr_t)(ks_mc_base + 0x8F947BCUL);
	if (*(volatile unsigned*)pm != 0xA9BC7BFDu || *(volatile unsigned*)px != 0xA9BE7BFDu) {
		ks_logf("[core]", "world hook: 首字不符(版本漂移) mesh=%08x mtx=%08x, 弃打", *(volatile unsigned*)pm, *(volatile unsigned*)px);
		return;
	}
#ifndef KS_SKIP_VERIFY
	t1 = ks_ihook(pm, (void*)ks_stub_mesh);
	t2 = ks_ihook(px, (void*)ks_stub_mtx);
	if (!t1 || !t2) { ks_logf("[core]", "world hook: ihook 失败 mesh=%p mtx=%p", t1, t2); return; }
	ks_tramp_slots[0] = t1;
	ks_tramp_slots[1] = t2;
#endif
	ks_w_state = 1;
	ks_logf("[core]", "world hook ok (mesh+mtx)");
}

static int ks_wmat_stale_logged = 0;

/* 模块 API: 世界 pass 矩阵新鲜(<100ms)则乘出 mvp=P*V 返回 1 */
static int ks_world_mvp(float* out16) {
	long now = ks_now_ms();
	int c, r, k;
	if (!ks_wmat_ms || now - ks_wmat_ms > 100) {
		if (ks_wmat_ms && !ks_wmat_stale_logged) {   /* 断供打点: 面板"断开再瞄准"溯源 */
			ks_wmat_stale_logged = 1;
			ks_logf("[core]", "world mvp stale age=%ld cam=%llx wstate=%d", now - ks_wmat_ms, ks_wcam, ks_w_state);
		}
		return 0;
	}
	ks_wmat_stale_logged = 0;
	for (c = 0; c < 4; c++)
		for (r = 0; r < 4; r++) {
			float s = 0.0f;
			for (k = 0; k < 4; k++) s += ks_wproj[k * 4 + r] * ks_wview[c * 4 + k];
			out16[c * 4 + r] = s;
		}
	return 1;
}

static int ks_resolve(void) {
	KS_LKS(n_libegl, @@N_LIBEGL_ENC@@);
	KS_LKS(n_libgl, @@N_LIBGL_ENC@@);
	KS_LKS(n_gpa, @@N_GPA_ENC@@);
	KS_LKS(n_qsurf, @@N_QSURF_ENC@@);
	KS_LKS(n_curctx, @@N_CURCTX_ENC@@);
	KS_LKS(n_curdsp, @@N_CURDSP_ENC@@);
	KS_LKS(n_cursur, @@N_CURSUR_ENC@@);
	void* hEGL = dlopen(n_libegl, RTLD_NOW);
	void* hGL = dlopen(n_libgl, RTLD_NOW);
	if (!hEGL || !hGL) { ks_set_status(0, "dlopen EGL/GL fail"); ks_logf("[core]", "resolve fail: dlopen egl=%p gl=%p", (void*)hEGL, (void*)hGL); return 0; }
	void* (*pGPA)(const char*) = (void* (*)(const char*))dlsym(hEGL, n_gpa);
	peglQuerySurface = (EGLBoolean(*)(EGLDisplay, EGLSurface, EGLint, EGLint*))dlsym(hEGL, n_qsurf);
	peglGetCurrentContext = (EGLContext(*)(void))dlsym(hEGL, n_curctx);
	peglGetCurrentDisplay = (EGLDisplay(*)(void))dlsym(hEGL, n_curdsp);
	peglGetCurrentSurface = (EGLSurface(*)(EGLint))dlsym(hEGL, n_cursur);
	void* h = hGL;
#define RA2(field, ...) do { unsigned char e[] = { __VA_ARGS__ }; char sn[48]; ks_lkd(sn, e, (int)sizeof(e)); field = (void*)dlsym(h, sn); if (!field && pGPA) field = (void*)pGPA(sn); } while (0)
	RA(pglGetIntegerv, "glGetIntegerv")
	RA(pglIsEnabled, "glIsEnabled")
	RA(pglViewport, "glViewport")
	RA(pglEnable, "glEnable")
	RA(pglDisable, "glDisable")
	RA(pglBlendFunc, "glBlendFunc")
	RA(pglBlendFuncSeparate, "glBlendFuncSeparate")
	RA(pglGenBuffers, "glGenBuffers")
	RA(pglDeleteBuffers, "glDeleteBuffers")
	RA(pglBindBuffer, "glBindBuffer")
	RA(pglBufferData, "glBufferData")
	RA(pglVertexAttribPointer, "glVertexAttribPointer")
	RA(pglEnableVertexAttribArray, "glEnableVertexAttribArray")
	RA(pglGetAttribLocation, "glGetAttribLocation")
	RA(pglCreateShader, "glCreateShader")
	RA(pglShaderSource, "glShaderSource")
	RA(pglCompileShader, "glCompileShader")
	RA(pglGetShaderiv, "glGetShaderiv")
	RA(pglCreateProgram, "glCreateProgram")
	RA(pglAttachShader, "glAttachShader")
	RA(pglLinkProgram, "glLinkProgram")
	RA(pglGetProgramiv, "glGetProgramiv")
	RA(pglGetShaderInfoLog, "glGetShaderInfoLog")
	RA(pglGetProgramInfoLog, "glGetProgramInfoLog")
	RA(pglUseProgram, "glUseProgram")
	RA(pglGenVertexArrays, "glGenVertexArrays")
	RA(pglBindVertexArray, "glBindVertexArray")
	RA(pglDrawArrays, "glDrawArrays")
	RA(pglGetUniformLocation, "glGetUniformLocation")
	RA(pglUniform1f, "glUniform1f")
	RA(pglUniform2f, "glUniform2f")
	RA(pglUniform1i, "glUniform1i")
	RA(pglDeleteShader, "glDeleteShader")
	RA(pglGenTextures, "glGenTextures")
	RA(pglDeleteTextures, "glDeleteTextures")
	RA(pglBindTexture, "glBindTexture")
	RA(pglTexImage2D, "glTexImage2D")
	RA(pglTexSubImage2D, "glTexSubImage2D")
	RA(pglTexParameteri, "glTexParameteri")
	RA(pglCopyTexSubImage2D, "glCopyTexSubImage2D")
	RA(pglActiveTexture, "glActiveTexture")
#undef RA2
	ks_logf("[core]", "resolve: qsurf=%p curctx=%p gpa=%p gl=%p",
		(void*)peglQuerySurface, (void*)peglGetCurrentContext, (void*)pGPA, (void*)pglDrawArrays);
	return 1;
}

/* 引导: 首次做符号解析+wpl 内联钩子,随后装 sv 渲染驱动(demo_stop 后可重挂)。
   由 JS 经 ks_entry(52) 在投钥后显式触发——ctor 不再触碰 dlopen/dlsym */
static int ks_boot_done = 0;
static int ks_js_ok = 0;   /* 0 未通过(每次 boot 重试); 通过即折叠签名并置 1; 不符直接 ks_die_g */
static long ks_boot(void) {
	if (!ks_boot_done) {
#ifndef KS_SKIP_VERIFY
		if (!ks_js_ok) {
			unsigned long long fv = 0;
			int jst = ks_verify_js(&fv);
			if (jst == 0) ks_die_g();
			if (jst == 1) { ks_key_derive(fv); ks_g_sig = ks_g_sig * 33u + 0x5BD1E995u; ks_js_ok = 1; }
			if (!ks_rk_ready) return 0;   /* 文件暂不可读: 不置完成,下次调用再试 */
		}
#endif
		ks_logf("[core]", "boot start pid=%d", (int)getpid());
		if (!ks_resolve()) return 0;
		wpl_hooks_install();
		ks_boot_done = 1;
	}
	ks_sv_install();   /* v31 起唯一渲染驱动: 幂等,首字不符=版本漂移静默弃打 */
#ifndef KS_SKIP_VERIFY
	ks_world_install();   /* v32 世界矩阵管线: mesh/mtx asm stub 钩, 幂等 */
#endif
	return 1;
}

long demo_start(void) {
	return ks_boot();
}

long demo_stop(void) {
	mb_disable();
	ih_disable();
	dir_disable();
	ch_disable();
	rd_disable();
	wm_disable();
	wpl_disable();
	ks_ihook_restore_all();
	ks_sv_state = 0;
	ks_w_state = 0;
	ks_wmat_ms = 0;
	ks_wmat_stale_logged = 0;
	ks_pvq_reset();
	ks_sv_orig = 0;
	ks_sv_drew = 0;
	ks_sv_frame_us = 0;
	ks_sv_tail = 0;
	ks_sv_last_this = 0;
	ks_sv_drove_us = 0;
	ks_sv_pend = 0;
	ks_sv_pend_n = 0;
	ks_sv_drove_infra = 0;
	nb_drain();
	ks_set_status(0, "stopped");
	return 0;
}
'''

epilogue = '''
long ihud_enable(long v) {
	ih_g_enable = (v == 1) ? 1 : 0;
	return ih_g_enable;
}

__attribute__((constructor))
static void ks_nb_init(void) {
	guard_check();
	nb_stamp();
	/* 七项校验：自身代码段哈希(第 0 项,织入签名) + KuSug.json（guard_check，缺失即崩）+ KuSug.js + JavaPlugin.java
	   + manifest enable==true + 主菜单 title.name==KuSug + ui_definition name 匹配,任一不过直接崩溃;
	   ctor 只做校验——符号解析/打钩统一由 ks_entry(52) 引导(JS 投钥后),ctor 期零 dlopen 零依赖运行时密钥 */
#ifndef KS_SKIP_VERIFY
	ks_g_hv = ks_self_hash();
	ks_g_sig = ks_g_sig * 33u + (unsigned)ks_g_hv;
	ks_g_sig = ks_g_sig * 33u + (unsigned)(ks_g_hv >> 32);
	if (!ks_verify_files()) { ks_die_f(); }
	ks_g_sig_armed = 1;
#endif
	ks_set_status(0, ks_sd((const unsigned char[]){ @@ST_LOADED_ENC@@ }, @@ST_LOADED_LEN@@));
	ks_logf(ks_sd((const unsigned char[]){ @@CTOR_TAG_ENC@@ }, @@CTOR_TAG_LEN@@),
		ks_sd((const unsigned char[]){ @@CTOR_FMT_ENC@@ }, @@CTOR_FMT_LEN@@), (int)getpid());
}

/* ===== 统一入口: JS 经 os.syscall(so,"ks_entry",code) 调用,code = op*2^24 + (v & 0xFFFFFF) =====
   桥参数仅 int32(v25 首日回声自检实锤),故 op 占高 6 位(code<2^30 恒正,免疫截断与符号);
   v 为 24 位带符号;wpl 坐标(op44-49)超宽:先 op56 投递高 24 位暂存,再随调用拼成 48 位。
   61=密钥金丝雀 62=就绪探针(密钥已自派生) 63=回声(桥参数位宽自检,返回 code+1) */
long long ks_entry(long long code) {
	static long long ks_arg_hi = 0;
	unsigned op = (unsigned)((unsigned long long)code >> 24);
	long long a = code & 0xFFFFFF;
	if (a & 0x800000) a -= 0x1000000;
	if (op == 56) { ks_arg_hi = a; return 1; }
	if (op >= 44 && op <= 49) a = (ks_arg_hi << 24) | (long long)(code & 0xFFFFFF);
	switch (op) {
	case 1: return (long)__nb_buf();
	case 2: return demo_start();
	case 3: return demo_stop();
	case 4: return ks_log_flush();
	case 5: return mblur_set(a);
	case 6: return mblur_get();
	case 7: return ihud_enable(a);
	case 8: return ihud_sync();
	case 9: return ihud_side(a);
	case 10: return ihud_offx(a);
	case 11: return ihud_offy(a);
	case 12: return ihud_maxrows(a);
	case 13: return (long)__ihud_in();
	case 14: return dirhud_enable(a);
	case 15: return dirhud_set(a);
	case 16: return dirhud_sync();
	case 17: return dirhud_off();
	case 18: return dirhud_offx(a);
	case 19: return dirhud_offy(a);
	case 20: return dirhud_frames();
	case 21: return (long)__dir_in();
	case 22: return chud_enable(a);
	case 23: return chud_off();
	case 24: return chud_preset(a);
	case 25: return chud_rgb(a);
	case 26: return chud_alpha(a);
	case 27: return chud_amp(a);
	case 28: return chud_pulse(a);
	case 29: return chud_size(a);
	case 30: return chud_thick(a);
	case 31: return chud_gap(a);
	case 32: return chud_offx(a);
	case 33: return chud_offy(a);
	case 34: return chud_dyn(a);
	case 35: return chud_frames();
	case 57: return rd_enable(a);
	case 58: return rd_pos(a);
	case 59: return rd_yaw(a);
	case 60: return rd_commit(a);
	case 36: return wmhud_enable(a);
	case 37: return wmhud_off();
	case 38: return wmhud_frames();
	case 39: return tex_apply(a);
	case 40: return (long)__tex_in();
	case 41: return wpl_enable(a);
	case 42: return wpl_sync();
	case 43: return wpl_show(a);
	case 44: return wpl_px(a);
	case 45: return wpl_py(a);
	case 46: return wpl_pz(a);
	case 47: return wpl_tx(a);
	case 48: return wpl_ty(a);
	case 49: return wpl_tz(a);
	case 50: return wpl_drew();
	case 51: return (long)__wpl_in();
	case 52: return ks_boot();
	case 61: return ks_key_check();
	case 62: return ks_rk_ready ? 1 : 0;   /* 就绪探针(v29 起密钥由 so 自派生,JS 不再投递) */
	case 63: return code + 1;
	}
	return 0;
}
'''


def ks_fnv_py(b):
	h = 2166136261
	for x in b:
		h = ((h ^ x) * 16777619) & 0xFFFFFFFF
	return h

def ks_enc_py(s):
	b = s.encode('utf-8')
	return ', '.join(str(b[i] ^ ((0x5A + i * 7) & 0xFF)) for i in range(len(b)))

HASH_KUSUG = ks_fnv_py(b'KuSug')
HASH_UUIDEF = ks_fnv_py('KuSug\\nBy_Bi匕匕Bi'.encode('utf-8'))

core = core.replace('@@MENU_PATH_ENC@@', ks_enc_py('ui/KuSug/主菜单.json'))
core = core.replace('@@UUIDEF_PATH_ENC@@', ks_enc_py('ui/ui_definition.json'))
core = core.replace('@@HASH_KUSUG@@', '0x%08Xu' % HASH_KUSUG)
core = core.replace('@@HASH_UUIDEF@@', '0x%08Xu' % HASH_UUIDEF)
print('构建常量: HASH_KUSUG=%08X HASH_UUIDEF=%08X (签名期望值由 finalize_so.py 回填)' % (HASH_KUSUG, HASH_UUIDEF))

out = '\n'.join([
	prologue,
	core,
	'',
	'/* ===== 动态模糊模块 ===== */',
	mb_all,
	'',
	'/* ===== 掉落物统计模块 ===== */',
	ih_all,
	'',
	'/* ===== 方向标模块 ===== */',
	dir_body,
	'',
	'/* ===== 自定义准星模块 ===== */',
	ch_body,
	'',
	'/* ===== 2D雷达模块 ===== */',
	rd_body,
	'',
	'/* ===== 动态水印模块 ===== */',
	wm_body,
	'',
'/* ===== 世界面板模块 ===== */',
wpl_body,
'',
'/* ===== 材质包注入模块 ===== */',
	tex_body,
	'',
	epilogue,
])

# ===== 分钥字符串保护(构建期加密引擎) =====
# 静态层 S1(i)=0x5A+7i: ctor 期必需串(校验/包名/路径骨架),与 ks_dec/ks_sd 对应
# 混合层 S2(i)=0xA5+3i^R(i): R 由 ks_rk 派生,ks_rk=smx(KF^F64)^KF2;F64=SHA-256(KuSug.js)指纹,
# so 单文件缺 JS 文件本体不可解——与 C 侧 ks_smx/ks_rbyte 逐位一致
# v29 内容为钥: F64 = SHA-256(KuSug.js) 前 8 字节 LE,由 build_obf.py 流水线写入 js_f.txt
_f64_file = os.path.join(base, 'js_f.txt')
if not os.path.isfile(_f64_file):
	sys.exit('缺 js_f.txt —— 先跑 build_obf.py(它会先构建 JS 再写入指纹);手动调试可 echo 0 > js_f.txt')
F64 = int(io.open(_f64_file, encoding='utf-8').read().strip(), 16)
_M64 = (1 << 64) - 1

def ks_smx_py(x):
	x = (x + 0x9E3779B97F4A7C15) & _M64
	x = ((x ^ (x >> 30)) * 0xBF58476D1CE4E5B9) & _M64
	x = ((x ^ (x >> 27)) * 0x94D049BB133111EB) & _M64
	return x ^ (x >> 31)

KS_KF = 0xC3A5C85C97CB3127
KS_KF2 = 0x9E3779B97F4A7C15
KS_KC = 0x9E3779B9E3779B97
KS_RK = ks_smx_py(KS_KF ^ F64) ^ KS_KF2

def ks_rbyte_py(i):
	return (ks_smx_py((KS_RK + i) & _M64) >> 24) & 0xFF

def _bytes(s):
	return s.encode('utf-8') if isinstance(s, str) else bytes(s)

def enc_s1(s):
	b = _bytes(s)
	return [b[i] ^ ((0x5A + i * 7) & 0xFF) for i in range(len(b))]

def enc_s2(s):
	b = _bytes(s)
	return [b[i] ^ ((0xA5 + i * 3) & 0xFF) ^ ks_rbyte_py(i) for i in range(len(b))]

def lst(bs):
	return ', '.join(str(x) for x in bs)

def lk(s):   # 混合层表达式包装(ks_ld 旋转缓冲)
	bs = enc_s2(s)
	return 'ks_ld((const unsigned char[]){%s}, %d)' % (lst(bs), len(bs))

# ---- ks_logf(tag, fmt) 两串 ----
def _logf_repl(m):
	return 'ks_logf(%s, %s' % (lk(m.group(1)), lk(m.group(2)))

out = re.sub(r'ks_logf\("([^"]*)",\s*"((?:[^"\\]|\\.)*)"', _logf_repl, out)

# ---- ks_set_status / ks_status_num 及模块包装 ----
out = re.sub(r'\bks_set_status\((\d+),\s*"((?:[^"\\]|\\.)*)"\)',
	lambda m: 'ks_set_status(%s, %s)' % (m.group(1), lk(m.group(2))), out)
out = re.sub(r'\b((?:mb|ih|dir|ch|wm|wpl|tex|rd)_(?:set_status|status_num))\("((?:[^"\\]|\\.)*)"',
	lambda m: '%s(%s' % (m.group(1), lk(m.group(2))), out)

# ---- pglGetUniformLocation(prog, "uXxx") uniform 名 ----
out = re.sub(r'\bpglGetUniformLocation\((\w+),\s*"([^"]+)"\)',
	lambda m: 'pglGetUniformLocation(%s, %s)' % (m.group(1), lk(m.group(2))), out)

# ---- ks_res_path(var, sizeof(var), "literal") 残点 -> 栈解码 ----
out = re.sub(r'\bks_res_path\((\w+), (sizeof\(\w+\)), "((?:[^"\\]|\\.)*)"\);',
	lambda m: '{ KS_LKS(rp_sfx, %s); ks_res_path(%s, %s, rp_sfx); }' % (lst(enc_s2(m.group(3))), m.group(1), m.group(2)), out)
out = re.sub(r'\bks_status_num\((\d+),\s*"((?:[^"\\]|\\.)*)"',
	lambda m: 'ks_status_num(%s, %s' % (m.group(1), lk(m.group(2))), out)

# ---- RA/WRA(field, "sym") -> RA2/WRA2(field, <混合层字节>);(do-while 宏需补分号) ----
out = re.sub(r'\bWRA\((\w+),\s*"([^"]+)"\)',
	lambda m: 'WRA2(%s, %s);' % (m.group(1), lst(enc_s2(m.group(2)))), out)
out = re.sub(r'\bRA\((\w+),\s*"([^"]+)"\)',
	lambda m: 'RA2(%s, %s);' % (m.group(1), lst(enc_s2(m.group(2)))), out)

# ---- GLSL 着色器: 静态字面量 -> 加密 blob + 首用解码 getter ----
def c_unescape_cat(group):
	buf = bytearray()
	for piece in re.findall(r'"((?:[^"\\]|\\.)*)"', group):
		i = 0
		while i < len(piece):
			c = piece[i]
			if c != '\\':
				buf.extend(c.encode('utf-8'))
				i += 1
				continue
			n = piece[i + 1]
			if n == 'n': buf.append(10)
			elif n == 't': buf.append(9)
			elif n == 'r': buf.append(13)
			elif n == '0': buf.append(0)
			elif n == '\\': buf.append(92)
			elif n == '"': buf.append(34)
			elif n == "'": buf.append(39)
			else: raise AssertionError('GLSL 未知转义: \\' + n)
			i += 2
	return bytes(buf)

GLSL_NAMES = ['MB_VS', 'MB_FS', 'IH_VS', 'IH_FS', 'CH_VS', 'CH_FS', 'WPL_VS', 'WPL_FS', 'RD_VS', 'RD_FS', 'RD_SWEEP_FS', 'RD_DOT_VS', 'RD_DOT_FS', 'RD_LET_VS', 'DIR_FS']

def _glsl_repl(name, m):
	raw = c_unescape_cat(m.group(1))
	low = name.lower()
	bs = enc_s2(raw)
	return ('static const unsigned char ks_enc_%s[] = { %s };\n'
		'static char %s_buf[%d];\n'
		'static int %s_ok = 0;\n'
		'static const char* %s_get(void) { if (!%s_ok) { %s_ok = 1; ks_lkd(%s_buf, ks_enc_%s, (int)sizeof(ks_enc_%s)); } return %s_buf; }'
		% (low, lst(bs), low, len(raw) + 1, low, low, low, low, low, low, low, low))

for nm in GLSL_NAMES:
	out, cnt = re.subn(r'static const char %s\[\] =\s*((?:\s*"(?:[^"\\]|\\.)*")+)\s*;' % nm,
		lambda m: _glsl_repl(nm, m), out)
	assert cnt == 1, 'GLSL 声明 %s 匹配 %d 次(期望 1)' % (nm, cnt)
	out = re.sub(r'\b%s\b' % nm, '%s_get()' % nm.lower(), out)

# ---- 手工 token 占位(core/epilogue/母本里的 @@..@@) ----
CANARY = 'KuSugKeyOk-7'
TAGS = ['[core] ', '[mb] ', '[hud] ', '[dir] ', '[wm] ', '[ch] ', '[wpl] ', '[rd] ']
_tags_rows = []
for t in TAGS:
	row = enc_s2(t)
	row += [0] * (7 - len(row))
	_tags_rows.append('{ %s }' % lst(row))

def _tok(s, layer):
	bs = (enc_s1 if layer == 1 else enc_s2)(s)
	return lst(bs)

# ---- v30: ScreenView::render 兜底钩偏移烘焙 ----
# 偏移源 = 参考/FuncOffset-3.9.15.297907.json(sigscan 链产物);首字源 = 临时/libminecraftpe.bin。
# 游戏版本更新: 重跑签名扫描链更新 JSON 后重建即可;两者缺失则烘焙 0,运行时静默跳过兜底钩。
_KS_SV_OFF = '0'
_KS_SV_W0 = '0u'
_sv_off = 0
_fj = os.path.normpath(os.path.join(base, '..', '..', '参考', 'FuncOffset-3.9.15.297907.json'))
if os.path.exists(_fj):
	for _e in json.load(io.open(_fj, 'r', encoding='utf-8')):
		if _e.get('fn') == '_ZN10ScreenView6renderER15UIRenderContext' and int(_e.get('ptr', 0)) > 0x1000:
			_sv_off = int(_e['ptr'])
			break
else:
	print('WARN 缺 FuncOffset JSON, sv 兜底钩不烘焙')
if _sv_off:
	_mb = os.path.normpath(os.path.join(base, '..', '..', '临时', 'libminecraftpe.bin'))
	_sv_w0 = 0
	if os.path.exists(_mb):
		_bd = open(_mb, 'rb').read(0x40)
		if _bd[:4] == b'\x7fELF':
			_phoff = struct.unpack('<Q', _bd[0x20:0x28])[0]
			_phes = struct.unpack('<H', _bd[0x36:0x38])[0]
			_phnum = struct.unpack('<H', _bd[0x38:0x3A])[0]
			_foff = None
			with open(_mb, 'rb') as _bf:
				for _i in range(_phnum):
					_bf.seek(_phoff + _i * _phes)
					_ph = _bf.read(_phes)
					if struct.unpack('<I', _ph[0:4])[0] != 1:
						continue
					_pfo, _pva, _pfs = struct.unpack('<Q', _ph[8:16])[0], struct.unpack('<Q', _ph[16:24])[0], struct.unpack('<Q', _ph[32:40])[0]
					if _pva <= _sv_off < _pva + _pfs:
						_foff = _pfo + (_sv_off - _pva)
						break
				if _foff is not None:
					_bf.seek(_foff)
					_w0b = _bf.read(4)
					if len(_w0b) == 4:
						_sv_w0 = struct.unpack('<I', _w0b)[0]
	if _sv_w0 and _sv_w0 != 0xFFFFFFFF:
		_KS_SV_OFF = str(_sv_off)
		_KS_SV_W0 = '0x%08Xu' % _sv_w0
		print('sv 兜底钩烘焙: off=0x%X w0=0x%08X' % (_sv_off, _sv_w0))
	else:
		print('WARN sv 首字读取失败, 兜底钩不烘焙')
else:
	print('WARN sv 偏移未找到, 兜底钩不烘焙')

TOKENS = {
	# guard 目标 = <resources>/KuSug.json(设备实锤: 2026-09-09 误写成 ui/KuSug/KuSug.json 导致 ctor 必崩;
	# 与 v20 初版 75 字节硬编码解码值一致,UI 目录下的 主菜单.json 是另一项校验别混)
	'@@GUARD_SUFFIX_ENC@@': _tok('KuSug.json', 1),
	'@@GUARD_SUFFIX_LEN@@': '10',
	'@@PROC_CMDLINE_ENC@@': _tok('/proc/self/cmdline', 1),
	'@@PKG_FALLBACK_ENC@@': _tok('com.netease.x19', 1),
	'@@RES_PRE_ENC@@': _tok('/storage/emulated/0/Android/data/', 1),
	'@@RES_MID_ENC@@': _tok('/files/resources/', 1),
	'@@SFX_MANIFEST_ENC@@': _tok('plugins/main/manifest.json', 1),
	'@@SFX_KSJS_ENC@@': _tok('script/KuSug.js', 1),
	'@@SFX_JAVAPLUGIN_ENC@@': _tok('plugins/main/src/JavaPlugin.java', 1),
	'@@TAGS_ENC@@': ',\n\t'.join(_tags_rows),
	'@@TAGS_LEN@@': ', '.join(str(len(t)) for t in TAGS),
	'@@ST_LOADED_ENC@@': _tok('loaded', 1),
	'@@ST_LOADED_LEN@@': '6',
	'@@CTOR_TAG_ENC@@': _tok('[core]', 1),
	'@@CTOR_TAG_LEN@@': '6',
	'@@CTOR_FMT_ENC@@': _tok('ctor ok pid=%d', 1),
	'@@CTOR_FMT_LEN@@': '14',
	'@@CANARY_ENC@@': _tok(CANARY, 2),
	'@@CANARY_HASH@@': '0x%08Xu' % ks_fnv_py(CANARY.encode('utf-8')),
	'@@N_LIBEGL_ENC@@': _tok('libEGL.so', 2),
	'@@N_LIBGL_ENC@@': _tok('libGLESv2.so', 2),
	'@@N_GPA_ENC@@': _tok('eglGetProcAddress', 2),
	'@@N_QSURF_ENC@@': _tok('eglQuerySurface', 2),
	'@@N_CURCTX_ENC@@': _tok('eglGetCurrentContext', 2),
	'@@N_CURDSP_ENC@@': _tok('eglGetCurrentDisplay', 2),
	'@@N_CURSUR_ENC@@': _tok('eglGetCurrentSurface', 2),
	'@@N_LIBMC_ENC@@': _tok('libminecraftpe', 2),
	'@@N_MAPS_ENC@@': _tok('/proc/self/maps', 2),
	'@@KS_SV_OFF@@': _KS_SV_OFF,
	'@@KS_SV_W0@@': _KS_SV_W0,
	'@@WPL_LINES_ENC@@': _tok(b'/say KuSug\0\xe6\x96\xb9\xe5\x9d\x97\xe7\xb1\xbb\xe5\x9e\x8b:\xe8\x84\x89\xe5\x86\xb2\0\xe6\x9d\xa1\xe4\xbb\xb6:\xe6\x97\xa0\xe6\x9d\xa1\xe4\xbb\xb6\0\xe7\xba\xa2\xe7\x9f\xb3:\xe7\xba\xa2\xe7\x9f\xb3\xe6\x8e\xa7\xe5\x88\xb6\0\xe5\xbb\xb6\xe8\xbf\x9f:0\0', 2),
	'@@TEX_PACK_EXACT_ENC@@': _tok('3.9_FirstPatch_2024_res_s1_texture_647d7cd2-1f2d-5959-a82f-c1093988afd0_0_0_2', 2),
	'@@TEX_PACK_EXACT_LEN@@': '77',
	'@@TEX_FMT_DATAFILES_ENC@@': _tok('/data/data/%s/files', 2),
	'@@TEX_FMT_SDFILES_ENC@@': _tok('/storage/emulated/0/Android/data/%s/files', 2),
	'@@TEX_FMT_RP_ENC@@': _tok('%s/games/com.netease/resource_packs', 2),
	'@@TEX_FMT_FMD5_ENC@@': _tok('%s/folder_md5.json', 2),
	'@@TEX_FMT_FMAN_ENC@@': _tok('%s/manifest.json', 2),
	'@@TEX_FMT_FCON_ENC@@': _tok('%s/contents.json', 2),
	'@@TEX_FMT_BKD_ENC@@': _tok('%s/KuSug/材质备份', 2),
	'@@TEX_FMT_META_TXT_ENC@@': _tok('%s/meta.txt', 2),
	'@@TEX_FMT_META_JSON_ENC@@': _tok('%s/meta.json', 2),
	'@@TEX_FMT_WTEST_ENC@@': _tok('%s/.kusug_wtest', 2),
	'@@TEX_FMT_BAK_MD5_ENC@@': _tok('%s/folder_md5.json.bak', 2),
	'@@TEX_FMT_BAK_MAN_ENC@@': _tok('%s/manifest.json.bak', 2),
	'@@TEX_FMT_BAK_CON_ENC@@': _tok('%s/contents.json.bak', 2),
	'@@TEX_FILESMARK_ENC@@': _tok('/files__', 2),
	'@@TEX_BL0_ENC@@': _tok('manifest.json', 2),
	'@@TEX_BL1_ENC@@': _tok('pack_manifest.json', 2),
	'@@TEX_BL2_ENC@@': _tok('contents.json', 2),
	'@@TEX_BL3_ENC@@': _tok('folder_md5.json', 2),
	'@@KEY_ENABLE_ENC@@': _tok('enable', 1),
	'@@KEY_TITLE_ENC@@': _tok('title', 1),
	'@@KEY_NAME_ENC@@': _tok('name', 1),
}
# TEX_PACK_EXACT 用法 -> getter(声明已在母本手改为加密 blob)
out, _tex_pack_n = re.subn(r'\bTEX_PACK_EXACT\b', 'tex_pack_exact()', out)
assert _tex_pack_n == 2, 'TEX_PACK_EXACT 用法=%d(期望 2)' % _tex_pack_n
for tk, val in TOKENS.items():
	assert tk in out, 'token 缺失: ' + tk
	out = out.replace(tk, val)

# ---- 导出收敛: 全部功能符号静态化,只留 ks_entry ----
EXPORTS = ['__nb_buf', 'demo_start', 'demo_stop', 'ks_log_flush',
	'mblur_set', 'mblur_get',
	'ihud_enable', 'ihud_sync', 'ihud_side', 'ihud_offx', 'ihud_offy', 'ihud_maxrows', '__ihud_in',
	'dirhud_enable', 'dirhud_set', 'dirhud_sync', 'dirhud_off', 'dirhud_offx', 'dirhud_offy', 'dirhud_frames', '__dir_in',
	'chud_enable', 'chud_off', 'chud_preset', 'chud_rgb', 'chud_alpha', 'chud_amp', 'chud_pulse',
	'chud_size', 'chud_thick', 'chud_gap', 'chud_offx', 'chud_offy', 'chud_dyn', 'chud_frames',
	'rd_enable', 'rd_pos', 'rd_yaw', 'rd_commit', 'rd_frames', '__radar_in',
	'wmhud_enable', 'wmhud_off', 'wmhud_frames',
	'tex_apply', '__tex_in',
	'wpl_enable', 'wpl_sync', 'wpl_show', 'wpl_px', 'wpl_py', 'wpl_pz', 'wpl_tx', 'wpl_ty', 'wpl_tz', 'wpl_drew', '__wpl_in']
for nm in EXPORTS:
	pat = '\\nlong %s\\(' % re.escape(nm)
	cnt = len(re.findall(pat, out))
	assert cnt == 1, '导出符号 %s 定义处数=%d(期望 1)' % (nm, cnt)
	out = re.sub(pat, '\nstatic long %s(' % nm, out)

assert '@@' not in out, 'token 未替换完整'
assert 'ks_logf("' not in out, 'logf 明文串未清空'
assert 'ks_res_path' in out and out.count('com.netease.x19') == 0, 'pkg dynamic assembly check'
assert 'wpl_render' in out and 'wpl_hooks_install' in out and '__wpl_in' in out, 'wpl assembly check'
assert 'tex_apply' in out and '__tex_in' in out and 'tex_inflate' in out, 'tex assembly check'
assert '\nlong long ks_entry(long long code)' in out, 'ks_entry 缺失'
for bad in ['"eglSwapBuffers"', '"glEnable"', '"libEGL.so"', '"libGLESv2.so"', '"/proc/self/cmdline"',
		'"script/KuSug.js"', '"plugins/main/manifest.json"', '/say KuSug', '"KuSug"',
		'"libGLESv2_adreno.so"', '"libGLES_mali.so"', '"glUniformMatrix4fv"', '"3.9_FirstPatch',
		'"%s/games/com.netease/resource_packs"', '"/files__"', '"pack_manifest.json"',
		'"kusug/so/', '"title"', '"enable"']:
	assert bad not in out, '残留明文: ' + bad
assert not re.search(r'\bW?RA\(\w+, "', out), 'RA/WRA 明文残留'
assert not re.search(r'pglGetUniformLocation\(\w+, "', out), 'uniform 明文残留'
assert not re.search(r'ks_res_path\(\w+, sizeof\(\w+\), "', out), 'res_path 明文残留'
io.open(os.path.join(base, 'KuSugSo.c'), 'w', encoding='utf-8', newline='\n').write(out)
print('生成 KuSugSo.c:', len(out.split(chr(10))), '行')
