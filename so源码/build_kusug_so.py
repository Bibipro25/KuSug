# 2026-09-22 起: 保护体系退役——本生成器产出纯功能 KuSugSo.c(无校验/无加密/无配对), Kagura/finalize/apply_hardening 不再使用
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

static char nb_buffer[4096];
static char ks_slot[8][192];
static const char* ks_tags[8] = { "[core] ", "[mb] ", "[hud] ", "[dir] ", "[wm] ", "[ch] ", "[wpl] ", "[rd] " };
static void ks_flush_status(void) {
	char body[600];
	int n = 0;
	body[0] = 0;
	for (int i = 0; i < 7; i++) {
		if (!ks_slot[i][0]) continue;
		const char* t = ks_tags[i];
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

/* 字符串直存直读(保护体系已退役 2026-09-22): KS_LKS 仅保留"声明 char 数组"形式 */
#define KS_LKS(var, s) char var[] = s


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
	char proc[24] = "/proc/self/cmdline";
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
		const char* fb = "com.netease.x19";
		int i = 0;
		while (fb[i]) { ks_g_pkg[i] = fb[i]; i++; }
		ks_g_pkg[i] = 0;
	}
	return ks_g_pkg;
}

/* 拼 resources 下绝对路径：/storage/emulated/0/Android/data/<pkg>/files/resources/<suffix> */
static void ks_res_path(char* out, int cap, const char* suffix) {
	static const char PRE[] = "/storage/emulated/0/Android/data/";
	static const char MID[] = "/files/resources/";
	const char* pkg = ks_pkg();
	int n = 0, i;
	for (i = 0; PRE[i] && n < cap - 1; i++) out[n++] = PRE[i];
	for (i = 0; pkg[i] && n < cap - 1; i++) out[n++] = pkg[i];
	for (i = 0; MID[i] && n < cap - 1; i++) out[n++] = MID[i];
	for (i = 0; suffix[i] && n < cap - 1; i++) out[n++] = suffix[i];
	out[n] = 0;
}



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
	KS_LKS(n_libmc, "libminecraftpe");
	(void)size; (void)data;
	if (info->dlpi_name && strstr(info->dlpi_name, n_libmc) && info->dlpi_addr) {
		ks_mc_base = (uint64_t)info->dlpi_addr;
		return 1;
	}
	return 0;
}

static uint64_t ks_mc_base_maps(void) {
	KS_LKS(n_libmc2, "libminecraftpe");
	KS_LKS(n_maps, "/proc/self/maps");
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
extern void ks_stub_mesh(void);
extern void ks_stub_mtx(void);
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
	KS_LKS(n_maps2, "/proc/self/maps");
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
	t1 = ks_ihook(pm, (void*)ks_stub_mesh);
	t2 = ks_ihook(px, (void*)ks_stub_mtx);
	if (!t1 || !t2) { ks_logf("[core]", "world hook: ihook 失败 mesh=%p mtx=%p", t1, t2); return; }
	ks_tramp_slots[0] = t1;
	ks_tramp_slots[1] = t2;
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
	KS_LKS(n_libegl, "libEGL.so");
	KS_LKS(n_libgl, "libGLESv2.so");
	KS_LKS(n_gpa, "eglGetProcAddress");
	KS_LKS(n_qsurf, "eglQuerySurface");
	KS_LKS(n_curctx, "eglGetCurrentContext");
	KS_LKS(n_curdsp, "eglGetCurrentDisplay");
	KS_LKS(n_cursur, "eglGetCurrentSurface");
	void* hEGL = dlopen(n_libegl, RTLD_NOW);
	void* hGL = dlopen(n_libgl, RTLD_NOW);
	if (!hEGL || !hGL) { ks_set_status(0, "dlopen EGL/GL fail"); ks_logf("[core]", "resolve fail: dlopen egl=%p gl=%p", (void*)hEGL, (void*)hGL); return 0; }
	void* (*pGPA)(const char*) = (void* (*)(const char*))dlsym(hEGL, n_gpa);
	peglQuerySurface = (EGLBoolean(*)(EGLDisplay, EGLSurface, EGLint, EGLint*))dlsym(hEGL, n_qsurf);
	peglGetCurrentContext = (EGLContext(*)(void))dlsym(hEGL, n_curctx);
	peglGetCurrentDisplay = (EGLDisplay(*)(void))dlsym(hEGL, n_curdsp);
	peglGetCurrentSurface = (EGLSurface(*)(EGLint))dlsym(hEGL, n_cursur);
	void* h = hGL;
#define RA(field, name) do { field = (void*)dlsym(h, name); if (!field && pGPA) field = (void*)pGPA(name); } while (0)
	RA(pglGetIntegerv, "glGetIntegerv");
	RA(pglIsEnabled, "glIsEnabled");
	RA(pglViewport, "glViewport");
	RA(pglEnable, "glEnable");
	RA(pglDisable, "glDisable");
	RA(pglBlendFunc, "glBlendFunc");
	RA(pglBlendFuncSeparate, "glBlendFuncSeparate");
	RA(pglGenBuffers, "glGenBuffers");
	RA(pglDeleteBuffers, "glDeleteBuffers");
	RA(pglBindBuffer, "glBindBuffer");
	RA(pglBufferData, "glBufferData");
	RA(pglVertexAttribPointer, "glVertexAttribPointer");
	RA(pglEnableVertexAttribArray, "glEnableVertexAttribArray");
	RA(pglGetAttribLocation, "glGetAttribLocation");
	RA(pglCreateShader, "glCreateShader");
	RA(pglShaderSource, "glShaderSource");
	RA(pglCompileShader, "glCompileShader");
	RA(pglGetShaderiv, "glGetShaderiv");
	RA(pglCreateProgram, "glCreateProgram");
	RA(pglAttachShader, "glAttachShader");
	RA(pglLinkProgram, "glLinkProgram");
	RA(pglGetProgramiv, "glGetProgramiv");
	RA(pglGetShaderInfoLog, "glGetShaderInfoLog");
	RA(pglGetProgramInfoLog, "glGetProgramInfoLog");
	RA(pglUseProgram, "glUseProgram");
	RA(pglGenVertexArrays, "glGenVertexArrays");
	RA(pglBindVertexArray, "glBindVertexArray");
	RA(pglDrawArrays, "glDrawArrays");
	RA(pglGetUniformLocation, "glGetUniformLocation");
	RA(pglUniform1f, "glUniform1f");
	RA(pglUniform2f, "glUniform2f");
	RA(pglUniform1i, "glUniform1i");
	RA(pglDeleteShader, "glDeleteShader");
	RA(pglGenTextures, "glGenTextures");
	RA(pglDeleteTextures, "glDeleteTextures");
	RA(pglBindTexture, "glBindTexture");
	RA(pglTexImage2D, "glTexImage2D");
	RA(pglTexSubImage2D, "glTexSubImage2D");
	RA(pglTexParameteri, "glTexParameteri");
	RA(pglCopyTexSubImage2D, "glCopyTexSubImage2D");
	RA(pglActiveTexture, "glActiveTexture");
#undef RA
	ks_logf("[core]", "resolve: qsurf=%p curctx=%p gpa=%p gl=%p",
		(void*)peglQuerySurface, (void*)peglGetCurrentContext, (void*)pGPA, (void*)pglDrawArrays);
	return 1;
}

/* 引导: 首次做符号解析+wpl 内联钩子,随后装 sv 渲染驱动(demo_stop 后可重挂)。
   由 JS 经 ks_entry(52) 显式触发——ctor 不触碰 dlopen/dlsym */
static int ks_boot_done = 0;
static long ks_boot(void) {
	if (!ks_boot_done) {
		ks_logf("[core]", "boot start pid=%d", (int)getpid());
		if (!ks_resolve()) return 0;
		wpl_hooks_install();
		ks_boot_done = 1;
	}
	ks_sv_install();   /* v31 起唯一渲染驱动: 幂等,首字不符=版本漂移静默弃打 */
	ks_world_install();   /* v32 世界矩阵管线: mesh/mtx asm stub 钩, 幂等 */
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
	nb_stamp();
	ks_set_status(0, "loaded");
	ks_logf("[core]", "ctor ok pid=%d", (int)getpid());
}

/* ===== 统一入口: JS 经 os.syscall(so,"ks_entry",code) 调用,code = op*2^24 + (v & 0xFFFFFF) =====
   桥参数仅 int32(v25 首日回声自检实锤),故 op 占高 6 位(code<2^30 恒正,免疫截断与符号);
   v 为 24 位带符号;wpl 坐标(op44-49)超宽:先 op56 投递高 24 位暂存,再随调用拼成 48 位。
   61/62=历史配对探针(恒 1) 63=回声(桥参数位宽自检,返回 code+1) */
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
	case 61: return 1;
	case 62: return 1;
	case 63: return code + 1;
	}
	return 0;
}
'''



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
	'@@KS_SV_OFF@@': _KS_SV_OFF,
	'@@KS_SV_W0@@': _KS_SV_W0,
}
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
assert 'ks_res_path' in out and 'com.netease.x19' in out, 'pkg dynamic assembly check'
assert 'wpl_render' in out and 'wpl_hooks_install' in out and '__wpl_in' in out, 'wpl assembly check'
assert 'tex_apply' in out and '__tex_in' in out and 'tex_inflate' in out, 'tex assembly check'
assert '\nlong long ks_entry(long long code)' in out, 'ks_entry 缺失'
for bad in ['ks_lkd', 'ks_ld(', 'ks_sd(', 'ks_dec(', 'ks_rk', 'guard_check', 'KS_SKIP_VERIFY',
        'KS_HOST_TEST', 'ks_verify', 'ks_key_check', 'ks_self_hash', 'finalize_so', '@@']:
	assert bad not in out, '保护残留: ' + bad
io.open(os.path.join(base, 'KuSugSo.c'), 'w', encoding='utf-8', newline='\n').write(out)
print('生成 KuSugSo.c:', len(out.split(chr(10))), '行')
