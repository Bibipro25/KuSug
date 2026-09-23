#include <stdint.h>
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
	uint64_t dlpi_addr;
	const char* dlpi_name;
	const Elf64_Phdr* dlpi_phdr;
	uint16_t dlpi_phnum;
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
static long __nb_buf(void) { return (long)nb_buffer; }
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

static long ks_log_flush(void) {
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
		if (dn > 0) { fputs(drop, f); fputc('\n', f); }
		start = total - KS_LOG_CAP;
	}
	for (unsigned i = start; i < total; i++) {
		unsigned slot = i % KS_LOG_CAP;
		if (!ks_log_buf[slot][0]) continue;
		fputs(ks_log_buf[slot], f);
		fputc('\n', f);
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
static unsigned long ks_sv_off = 108036900;
static unsigned long ks_sv_w0 = 0xFC190FE8u;
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
		while (*p && *p != '\n') p++;
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

static long demo_start(void) {
	return ks_boot();
}

static long demo_stop(void) {
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


/* ===== 动态模糊模块 ===== */
static void mb_set_status(const char* s) { ks_set_status(1, s); }
static void mb_status_num(const char* pre, long v) { ks_status_num(1, pre, v); }

static const char MB_VS[] =
	"#version 300 es\n"
	"void main(){\n"
	"    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n"
	"    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n"
	"}\n";
static const char MB_FS[] =
	"#version 300 es\n"
	"precision mediump float;\n"
	"uniform sampler2D uTex;\n"
	"uniform vec2 uRes;\n"
	"uniform float uFade;\n"
	"out vec4 fragColor;\n"
	"void main(){\n"
	"    vec2 uv = gl_FragCoord.xy / uRes;\n"
	"    vec3 p = texture(uTex, uv).rgb;\n"
	"    fragColor = vec4(p, uFade);\n"
	"}\n";
static volatile int mb_g_enable = 0;
static volatile long mb_g_permil = 0;
static float mb_g_aprog = 0.0f;   /* 开关动画进度(强度淡入淡出) */
static long mb_g_aprogT = 0;
static int mb_g_gl_ready = 0;
static GLuint mb_g_prog = 0, mb_g_vao = 0, mb_g_texPrev = 0;
static GLint mb_g_uRes = -1, mb_g_uFade = -1, mb_g_uTex = -1;
static int mb_g_w = 0, mb_g_h = 0;
static int mb_g_valid = 0;
static int mb_g_warm = 0;
static long mb_g_frames = 0;
static EGLContext mb_g_ctx = 0;
static EGLSurface mb_g_surf = 0;
static long mb_g_surfsw = 0;
static int mb_gl_init(void) {
	if (!pglCreateShader || !pglShaderSource || !pglCompileShader || !pglGetShaderiv
		|| !pglCreateProgram || !pglAttachShader || !pglLinkProgram || !pglGetProgramiv
		|| !pglDeleteShader || !pglGenVertexArrays || !pglGetUniformLocation) {
		mb_set_status("gl sym missing");
		return 0;
	}
	GLint ok = 0;
	const char* src[1];
	GLuint vs = pglCreateShader(GL_VERTEX_SHADER);
	if (!vs) { mb_set_status("vs create fail"); return 0; }
	src[0] = MB_VS;
	pglShaderSource(vs, 1, src, 0);
	pglCompileShader(vs);
	pglGetShaderiv(vs, GL_COMPILE_STATUS, &ok);
	if (!ok) { mb_set_status("vs compile fail"); return 0; }
	GLuint fs = pglCreateShader(GL_FRAGMENT_SHADER);
	if (!fs) { mb_set_status("fs create fail"); return 0; }
	src[0] = MB_FS;
	pglShaderSource(fs, 1, src, 0);
	pglCompileShader(fs);
	pglGetShaderiv(fs, GL_COMPILE_STATUS, &ok);
	if (!ok) { mb_set_status("fs compile fail"); return 0; }
	mb_g_prog = pglCreateProgram();
	pglAttachShader(mb_g_prog, vs);
	pglAttachShader(mb_g_prog, fs);
	pglLinkProgram(mb_g_prog);
	pglGetProgramiv(mb_g_prog, GL_LINK_STATUS, &ok);
	pglDeleteShader(vs);
	pglDeleteShader(fs);
	if (!ok) { mb_set_status("link fail"); return 0; }
	pglGenVertexArrays(1, &mb_g_vao);
	mb_g_uRes = pglGetUniformLocation(mb_g_prog, "uRes");
	mb_g_uFade = pglGetUniformLocation(mb_g_prog, "uFade");
	mb_g_uTex = pglGetUniformLocation(mb_g_prog, "uTex");
	mb_set_status("gl ready");
	return 1;
}

static void mb_tex_alloc(GLuint* t, int w, int h) {
	if (*t) pglDeleteTextures(1, t);
	pglGenTextures(1, t);
	pglBindTexture(GL_TEXTURE_2D, *t);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	pglTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
}

static void mb_tex_recreate(int w, int h) {
	mb_tex_alloc(&mb_g_texPrev, w, h);
	mb_g_w = w;
	mb_g_h = h;
	mb_g_valid = 0;
}

#define GL_TEXTURE1 0x84C1

static void mb_render(EGLDisplay dpy, EGLSurface surf) {
	long pm = mb_g_permil;
	float pr = ks_anim(&mb_g_aprog, &mb_g_aprogT, pm > 0);
	if (pm <= 0 && pr <= 0.0005f) { mb_g_valid = 0; return; }
	if (pm > 800) pm = 800;
	float fade = (float)pm / 1000.0f * (pr * pr * (3.0f - 2.0f * pr));   /* 关闭时余晖渐消 */

	EGLint w = 0, h = 0;
	if (peglQuerySurface) {
		peglQuerySurface(dpy, surf, EGL_WIDTH, &w);
		peglQuerySurface(dpy, surf, EGL_HEIGHT, &h);
	}
	long area = (long)w * (long)h;
	if (area < 800L * 480L) return;
	if (area > ks_g_maxarea) ks_g_maxarea = area;
	if (mb_g_gl_ready && peglGetCurrentContext) {   /* 后台切回 GL 上下文已重建: 旧 prog/vao/tex 句柄全废, 转首初始化路径 */
		EGLContext cur = peglGetCurrentContext();
		if (cur != mb_g_ctx) {
			mb_g_prog = 0; mb_g_vao = 0; mb_g_texPrev = 0; mb_g_ctx = 0; mb_g_valid = 0; mb_g_gl_ready = 0;
			ks_logf("[mb]", "gl ctx changed, re-init");
		}
	}
	if (!mb_g_gl_ready) {
		if (mb_g_warm < 10) { mb_g_warm++; mb_g_valid = 0; return; }
		if (!peglGetCurrentContext) { mb_g_enable = 0; return; }
		if (ks_g_swaps < 45 || area < ks_g_maxarea) return;
		EGLContext cur = peglGetCurrentContext();
		if (!cur) return;
		if (wpl_pv_ready() && !wpl_ctx_is_game(cur)) return;
		if (!mb_gl_init()) { mb_g_enable = 0; ks_logf("[mb]", "mb_gl_init fail, module disabled"); return; }
		if (!pglGetIntegerv || !pglIsEnabled || !pglActiveTexture || !pglBindTexture
			|| !pglCopyTexSubImage2D || !pglViewport || !pglDisable || !pglEnable
			|| !pglUseProgram || !pglBindVertexArray || !pglUniform1f || !pglUniform2f
			|| !pglUniform1i || !pglDrawArrays || !pglBlendFuncSeparate || !pglBlendFunc
			|| !pglGenTextures || !pglTexImage2D || !pglTexParameteri || !pglDeleteTextures
			|| !peglQuerySurface) {
			mb_set_status("gl sym missing(render)");
			mb_g_enable = 0;
			ks_logf("[mb]", "gl sym missing(render), module disabled");
			return;
		}
		mb_g_ctx = cur;
		mb_g_surf = surf;
		mb_g_gl_ready = 1;
		ks_logf("[mb]", "gl ready surf=%p ctx=%p size=%dx%d swaps=%ld", (void*)surf, (void*)cur, (int)w, (int)h, ks_g_swaps);
	}
	if (peglGetCurrentContext && peglGetCurrentContext() != mb_g_ctx) return;
	if (surf != mb_g_surf) {
		if (ks_g_swaps - mb_g_surfsw > 120) { mb_g_surf = surf; ks_logf("[mb]", "surface relock surf=%p", (void*)surf); }
		else return;
	}
	mb_g_surfsw = ks_g_swaps;

	GLint oldVp[4] = {0, 0, 0, 0};
	GLint oldProg = 0, oldVao = 0, oldTex = 0, oldTex0 = 0, oldActive = 0;
	GLint oldBS = 0, oldBD = 0, oldBSA = 0, oldBDA = 0;
	pglGetIntegerv(GL_VIEWPORT, oldVp);
	pglGetIntegerv(GL_CURRENT_PROGRAM, &oldProg);
	pglGetIntegerv(GL_VERTEX_ARRAY_BINDING, &oldVao);
	pglGetIntegerv(GL_TEXTURE_BINDING_2D, &oldTex);
	pglGetIntegerv(GL_ACTIVE_TEXTURE, &oldActive);
	pglGetIntegerv(GL_BLEND_SRC_RGB, &oldBS);
	pglGetIntegerv(GL_BLEND_DST_RGB, &oldBD);
	pglGetIntegerv(GL_BLEND_SRC_ALPHA, &oldBSA);
	pglGetIntegerv(GL_BLEND_DST_ALPHA, &oldBDA);
	GLboolean bBlend = pglIsEnabled(GL_BLEND);
	GLboolean bDepth = pglIsEnabled(GL_DEPTH_TEST);
	GLboolean bCull = pglIsEnabled(GL_CULL_FACE);
	GLboolean bSciss = pglIsEnabled(GL_SCISSOR_TEST);
	if (w <= 0 || h <= 0) { w = oldVp[2]; h = oldVp[3]; }
	if (w <= 0 || h <= 0) return;

	pglActiveTexture(GL_TEXTURE0);
	pglGetIntegerv(GL_TEXTURE_BINDING_2D, &oldTex0);
	if (w != mb_g_w || h != mb_g_h || !mb_g_texPrev) mb_tex_recreate(w, h);
	pglBindTexture(GL_TEXTURE_2D, mb_g_texPrev);

	if (mb_g_valid) {
		pglViewport(0, 0, w, h);
		pglDisable(GL_DEPTH_TEST);
		pglDisable(GL_CULL_FACE);
		pglDisable(GL_SCISSOR_TEST);
		pglEnable(GL_BLEND);
		pglBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
		pglUseProgram(mb_g_prog);
		pglBindVertexArray(mb_g_vao);
		pglUniform2f(mb_g_uRes, (GLfloat)w, (GLfloat)h);
		pglUniform1f(mb_g_uFade, fade);
		pglUniform1i(mb_g_uTex, 0);
		pglDrawArrays(GL_TRIANGLES, 0, 3);
		pglCopyTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
	} else {
		pglCopyTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
		mb_g_valid = 1;
	}
	mb_g_frames++;

	pglBindTexture(GL_TEXTURE_2D, (GLuint)oldTex0);
	pglActiveTexture((GLenum)oldActive);
	pglBindTexture(GL_TEXTURE_2D, (GLuint)oldTex);
	pglBindVertexArray((GLuint)oldVao);
	pglUseProgram((GLuint)oldProg);
	pglViewport(oldVp[0], oldVp[1], oldVp[2], oldVp[3]);
	pglBlendFuncSeparate((GLenum)oldBS, (GLenum)oldBD, (GLenum)oldBSA, (GLenum)oldBDA);
	if (bBlend) pglEnable(GL_BLEND); else pglDisable(GL_BLEND);
	if (bDepth) pglEnable(GL_DEPTH_TEST);
	if (bCull) pglEnable(GL_CULL_FACE);
	if (bSciss) pglEnable(GL_SCISSOR_TEST);
}
static long mblur_set(long v) {
	v -= 1;
	if (v < 0) v = 0;
	if (v > 800) v = 800;
	mb_g_permil = v;
	return mb_g_permil;
}

static long mblur_get(void) { return mb_g_permil; }

static int mb_active(void) { return mb_g_permil > 0 || mb_g_aprog > 0.0005f; }
static void mb_disable(void) { mb_g_enable = 0; mb_g_permil = 0; }


/* ===== 掉落物统计模块 ===== */
static void ih_set_status(const char* s) { ks_set_status(2, s); }
static void ih_status_num(const char* pre, long v) { ks_status_num(2, pre, v); }

static double ih_fabs(double x) {
	union { double d; uint64_t u; } v;
	v.d = x;
	v.u &= 0x7FFFFFFFFFFFFFFFULL;
	return v.d;
}
static double ih_floor(double x) {
	double r = (double)(long long)x;
	if (r > x) r -= 1.0;
	return r;
}
static double ih_ceil(double x) {
	double r = (double)(long long)x;
	if (r < x) r += 1.0;
	return r;
}
static double ih_sqrt(double x) {
	if (x <= 0.0) return 0.0;
	union { double d; uint64_t u; } v;
	v.d = x;
	v.u = (v.u >> 1) + 0x1FF7B00000000000ULL;
	double y = v.d;
	for (int i = 0; i < 7; i++) y = 0.5 * (y + x / y);
	return y;
}
static double ih_cbrt(double x) {
	if (x == 0.0) return 0.0;
	double s = x < 0 ? -1.0 : 1.0;
	double a = s * x;
	double y = a;
	for (int i = 0; i < 16; i++) y = (2.0 * y + a / (y * y)) / 3.0;
	return s * y;
}
static double ih_pow(double x, double y) {
	double third = 1.0 / 3.0;
	if (ih_fabs(y - third) < 1e-9) return ih_cbrt(x);
	if (y == 0.0) return 1.0;
	if (y == 1.0) return x;
	if (y == 2.0) return x * x;
	return x;
}
static double ih_fmod(double x, double y) {
	if (y == 0.0) return 0.0;
	double t = x / y;
	double r = x - y * (double)(long long)t;
	return r;
}
static double ih_cos(double x) {
	x = x - 6.283185307179586 * ih_floor(x / 6.283185307179586 + 0.5);
	double x2 = x * x, term = 1.0, s = 1.0;
	for (int k = 1; k <= 10; k++) {
		term = -term * x2 / ((double)(2 * k - 1) * (double)(2 * k));
		s += term;
	}
	return s;
}
static double ih_atan(double t) {
	if (t < 0) return -ih_atan(-t);
	t = t / (1.0 + ih_sqrt(1.0 + t * t));
	double t2 = t * t, p = t, s = 0.0;
	for (int k = 0; k < 9; k++) {
		s += p / (double)(2 * k + 1) * ((k & 1) ? -1.0 : 1.0);
		p *= t2;
	}
	return 2.0 * s;
}
static double ih_acos(double x) {
	if (x >= 1.0) return 0.0;
	if (x <= -1.0) return 3.141592653589793;
	return 2.0 * ih_atan(ih_sqrt((1.0 - x) / (1.0 + x)));
}

#define STBTT_ifloor(x)   ((int) ih_floor(x))
#define STBTT_iceil(x)    ((int) ih_ceil(x))
#define STBTT_sqrt(x)     ih_sqrt(x)
#define STBTT_pow(x, y)   ih_pow(x, y)
#define STBTT_fmod(x, y)  ih_fmod(x, y)
#define STBTT_cos(x)      ih_cos(x)
#define STBTT_acos(x)     ih_acos(x)
#define STBTT_fabs(x)     ih_fabs(x)
#define STBTT_assert(x)   ((void) 0)
#define STB_TRUETYPE_IMPLEMENTATION
#define STBTT_STATIC
#include "stb_truetype.h"
static unsigned char* ih_g_ttf = 0;
static stbtt_fontinfo ih_g_font;
static int ih_g_font_ok = 0;
static int ih_g_font_tried = 0;
static char ih_g_font_path[192];

static int try_font_file(const char* path, int want_cjk) {
	FILE* f = fopen(path, "rb");
	if (!f) return 0;
	fseek(f, 0, 2);
	long sz = ftell(f);
	fseek(f, 0, 0);
	if (sz <= 0 || sz > 90000000L) { fclose(f); return 0; }
	unsigned char* buf = (unsigned char*)malloc((size_t)sz);
	if (!buf) { fclose(f); return 0; }
	if (fread(buf, 1, (size_t)sz, f) != (size_t)sz) { free(buf); fclose(f); return 0; }
	fclose(f);
	int chosen = -1;
	stbtt_fontinfo fi;
	for (int idx = 0; idx < 8; idx++) {
		int off = stbtt_GetFontOffsetForIndex(buf, idx);
		if (off < 0) break;
		stbtt_fontinfo tf;
		if (!stbtt_InitFont(&tf, buf, off)) continue;
		if (chosen < 0) { chosen = idx; fi = tf; }
		if (!want_cjk || stbtt_FindGlyphIndex(&tf, 0x82F9) != 0) {
			chosen = idx;
			fi = tf;
			break;
		}
	}
	if (chosen < 0) { free(buf); return 0; }
	if (want_cjk && stbtt_FindGlyphIndex(&fi, 0x82F9) == 0) { free(buf); return 0; }
	if (ih_g_ttf) free(ih_g_ttf);
	ih_g_ttf = buf;
	ih_g_font = fi;
	ih_g_font_ok = 1;
	strncpy(ih_g_font_path, path, 191);
	ih_g_font_path[191] = 0;
	return 1;
}

static int load_sysfont(void) {
	ih_g_font_tried = 1;
	char fp[192];
	ks_res_path(fp, sizeof(fp), "kusug/so/font.ttf");
	if (try_font_file(fp, 1)) {
		ih_status_num("ttf cjk ok ", 1);
		return 1;
	}
	ih_set_status("font missing");
	return 0;
}

typedef unsigned int GLenum; typedef unsigned int GLuint; typedef int GLint; typedef int GLsizei;
typedef unsigned char GLboolean; typedef float GLfloat; typedef unsigned int GLbitfield; typedef ptrdiff_t GLsizeiptr;
typedef void* EGLDisplay; typedef void* EGLSurface; typedef void* EGLContext; typedef int EGLint; typedef unsigned int EGLBoolean;
static const char IH_VS[] =
	"#version 300 es\n"
	"uniform vec2 uRes;\n"
	"uniform vec2 uOff;\n"
	"uniform vec2 uSize;\n"
	"out vec2 vUv;\n"
	"void main(){\n"
	"    vec2 p = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));\n"
	"    vUv = p;\n"
	"    vec2 px = uOff + p * uSize;\n"
	"    gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);\n"
	"}\n";
static const char IH_FS[] =
	"#version 300 es\n"
	"precision mediump float;\n"
	"uniform sampler2D uTex;\n"
	"uniform float uAlpha;\n"
	"in vec2 vUv;\n"
	"out vec4 fragColor;\n"
	"void main(){\n"
	"    vec4 c = texture(uTex, vUv);\n"
	"    fragColor = vec4(c.rgb, c.a * uAlpha);\n"
	"}\n";
#define MAXROWS 14
typedef struct {
	char name[64];
	long count;
	float y, ty, alpha, talpha;
	float flash;
	float nameW;
	uint8_t used;
	uint8_t nameChk;
} row_t;
static row_t ih_g_rows[MAXROWS];
static volatile int ih_g_lock = 0;
static volatile long ih_g_maxrows = MAXROWS;

static char ih_in[8224];
static long __ihud_in(void) { return (long)ih_in; }

static long ihud_sync(void) {
	ih_g_lock = 1;
	uint32_t n = (uint8_t)ih_in[0] | ((uint32_t)(uint8_t)ih_in[1] << 8) | ((uint32_t)(uint8_t)ih_in[2] << 16) | ((uint32_t)(uint8_t)ih_in[3] << 24);
	if (n > 8000) n = 8000;
	char* buf = ih_in + 4;
	buf[n] = 0;
	for (int i = 0; i < MAXROWS; i++) ih_g_rows[i].talpha = 0;
	int idx = 0;
	long cap = ih_g_maxrows;
	char* p = buf;
	while (*p && idx < MAXROWS && idx < cap) {
		char* eol = p;
		while (*eol && *eol != '\n') eol++;
		char* next = *eol ? eol + 1 : eol;
		*eol = 0;
		char* tab = p;
		while (*tab && *tab != '\t') tab++;
		if (*tab && tab != p) {
			*tab = 0;
			long cnt = 0;
			const char* d = tab + 1;
			while (*d >= '0' && *d <= '9') { cnt = cnt * 10 + (*d - '0'); if (cnt > 999999) { cnt = 999999; break; } d++; }
			if (cnt > 0) {
				int slot = -1;
				for (int i = 0; i < MAXROWS; i++) {
					if (ih_g_rows[i].used && !strcmp(ih_g_rows[i].name, p)) { slot = i; break; }
				}
				if (slot < 0) {
					for (int i = 0; i < MAXROWS; i++) {
						if (!ih_g_rows[i].used) { slot = i; break; }
					}
					if (slot >= 0) {
						memset(&ih_g_rows[slot], 0, sizeof(row_t));
						strncpy(ih_g_rows[slot].name, p, 63);
						ih_g_rows[slot].used = 1;
						ih_g_rows[slot].y = (float)idx + 0.7f;
						ih_g_rows[slot].flash = 1.0f;
					}
				}
					if (slot >= 0) {
						if (ih_g_rows[slot].count != cnt) ih_g_rows[slot].flash = 1.0f;
						ih_g_rows[slot].count = cnt;
						ih_g_rows[slot].ty = (float)idx;
						ih_g_rows[slot].talpha = 1.0f;
						idx++;
					}
			}
		}
		p = next;
	}
	ih_g_lock = 0;
	return idx;
}

#define MAXPW 560
#define MAXPH 1060
static uint8_t ih_g_pix[MAXPW * MAXPH * 4];

#define GCHASH 512
typedef struct { int cp; float scale; int w, h, x0, y0; float adv; unsigned char* bits; } gc_t;
static gc_t ih_g_gc[GCHASH];
static float ih_g_px = 0.0f, ih_g_scale = 0.0f, ih_g_asc = 0.0f, ih_g_desc = 0.0f;

static void gc_fill(gc_t* g, int cp) {
	int x0 = 0, y0 = 0, x1 = 0, y1 = 0, adv = 0, lsb = 0;
	if (stbtt_FindGlyphIndex(&ih_g_font, cp) == 0) cp = '?';
	stbtt_GetCodepointBitmapBox(&ih_g_font, cp, ih_g_scale, ih_g_scale, &x0, &y0, &x1, &y1);
	stbtt_GetCodepointHMetrics(&ih_g_font, cp, &adv, &lsb);
	g->cp = cp;
	g->scale = ih_g_scale;
	g->w = x1 - x0;
	g->h = y1 - y0;
	g->x0 = x0;
	g->y0 = y0;
	g->adv = adv * ih_g_scale;
	if (g->bits) { free(g->bits); g->bits = 0; }
	if (g->w > 0 && g->h > 0 && g->w < 128 && g->h < 128) {
		g->bits = (unsigned char*)malloc((size_t)g->w * (size_t)g->h);
		if (g->bits) stbtt_MakeCodepointBitmap(&ih_g_font, g->bits, g->w, g->h, g->w, ih_g_scale, ih_g_scale, cp);
	}
}

static gc_t* gc_get(int cp) {
	int i = (int)(((unsigned)cp * 2654435761u) & (GCHASH - 1));
	for (int n = 0; n < GCHASH; n++) {
		int s = (i + n) & (GCHASH - 1);
		if (ih_g_gc[s].cp == 0) {
			gc_fill(&ih_g_gc[s], cp);
			return &ih_g_gc[s];
		}
		if (ih_g_gc[s].cp == cp && ih_g_gc[s].scale == ih_g_scale) return &ih_g_gc[s];
	}
	gc_fill(&ih_g_gc[i], cp);
	return &ih_g_gc[i];
}

static void gc_flush(void) {
	for (int i = 0; i < GCHASH; i++) {
		if (ih_g_gc[i].bits) free(ih_g_gc[i].bits);
	}
	memset(ih_g_gc, 0, sizeof(ih_g_gc));
}

static int utf8_next(const char* s, int* i) {
	int b1 = (uint8_t)s[(*i)++];
	if (b1 < 0x80) return b1;
	if (b1 < 0xE0) return ((b1 & 0x1F) << 6) | ((uint8_t)s[(*i)++] & 0x3F);
	if (b1 < 0xF0) return ((b1 & 0x0F) << 12) | (((uint8_t)s[(*i)++] & 0x3F) << 6) | ((uint8_t)s[(*i)++] & 0x3F);
	(*i) += 3;
	return '?';
}

static int ih_g_clipx0 = 0, ih_g_clipx1 = 0;
static void blend_px(int x, int y, int pw, int ph, uint8_t r, uint8_t g, uint8_t b, int a) {
	if (x < 0 || y < 0 || x >= pw || y >= ph) return;
	if (ih_g_clipx1 > ih_g_clipx0 && (x < ih_g_clipx0 || x >= ih_g_clipx1)) return;
	uint8_t* p = ih_g_pix + ((size_t)y * pw + x) * 4;
	int ia = 255 - a;
	p[0] = (uint8_t)((r * a + p[0] * ia) / 255);
	p[1] = (uint8_t)((g * a + p[1] * ia) / 255);
	p[2] = (uint8_t)((b * a + p[2] * ia) / 255);
	int na = a + p[3] * ia / 255;
	p[3] = (uint8_t)(na > 255 ? 255 : na);
}

static float text_w(const char* s) {
	float w = 0;
	int i = 0;
	while (s[i]) {
		int cp = utf8_next(s, &i);
		gc_t* g = gc_get(cp);
		w += g->adv + 1.0f;
	}
	return w;
}

static void draw_text(const char* s, float x, float baseline, int pw, int ph, uint8_t r, uint8_t g, uint8_t b, int a255, int maxx) {
	int i = 0;
	while (s[i]) {
		int cp = utf8_next(s, &i);
		gc_t* gc = gc_get(cp);
		if (gc->bits) {
			for (int py = 0; py < gc->h; py++) {
				for (int px = 0; px < gc->w; px++) {
					int al = (gc->bits[py * gc->w + px] * a255) / 255;
					if (al > 3) {
						int xx = (int)x + gc->x0 + px;
						if (xx > maxx) break;
						blend_px(xx, (int)baseline + gc->y0 + py, pw, ph, r, g, b, al);
					}
				}
			}
		}
		x += gc->adv + 1.0f;
		if ((int)x > maxx) return;
	}
}

static float back_out(float x) {
	float u = x - 1.0f;
	return 1.0f + 2.70158f * u * u * u + 1.70158f * u * u;
}

static float text_w_sp(const char* s, float extra) {
	float w = 0;
	int i = 0;
	while (s[i]) {
		int cp = utf8_next(s, &i);
		gc_t* g = gc_get(cp);
		w += g->adv + 1.0f + extra;
	}
	return w;
}

static void draw_text_sp(const char* s, float x, float baseline, int pw, int ph, uint8_t r, uint8_t g, uint8_t b, int a255, int maxx, float extra) {
	int i = 0;
	while (s[i]) {
		int cp = utf8_next(s, &i);
		gc_t* gc = gc_get(cp);
		if (gc->bits) {
			for (int py = 0; py < gc->h; py++) {
				for (int px = 0; px < gc->w; px++) {
					int al = (gc->bits[py * gc->w + px] * a255) / 255;
					if (al > 3) {
						int xx = (int)x + gc->x0 + px;
						if (xx > maxx) break;
						blend_px(xx, (int)baseline + gc->y0 + py, pw, ph, r, g, b, al);
					}
				}
			}
		}
		x += gc->adv + 1.0f + extra;
		if ((int)x > maxx) return;
	}
}

static void ih_name_check(row_t* r, float truncW) {
	if (r->nameChk) return;
	r->nameChk = 1;
	r->nameW = text_w(r->name);
	if (r->nameW <= truncW) return;
	float ellW = text_w("...");
	float lim = truncW - ellW;
	if (lim < 20.0f) lim = 20.0f;
	float acc = 0.0f;
	int i = 0, cut = 0;
	while (r->name[i]) {
		int save = i;
		int cp = utf8_next(r->name, &i);
		gc_t* gc = gc_get(cp);
		acc += gc->adv + 1.0f;
		if (acc > lim) { cut = save; break; }
	}
	if (!cut) cut = i;
	if (cut > 59) cut = 59;
	r->name[cut] = '.';
	r->name[cut + 1] = '.';
	r->name[cut + 2] = '.';
	r->name[cut + 3] = 0;
	r->nameW = text_w(r->name);
}
static volatile int ih_g_enable = 0;
static int ih_g_gl_ready = 0;
static GLuint ih_g_prog = 0, ih_g_vao = 0, ih_g_tex = 0;
static GLint ih_g_uRes = -1, ih_g_uOff = -1, ih_g_uSize = -1, ih_g_uTex = -1, ih_g_uAlpha = -1;
static float ih_g_aprog = 0.0f;   /* 开关动画进度(侧滑+淡入) */
static long ih_g_aprogT = 0;
static int ih_g_tw = 0, ih_g_th = 0;
static EGLContext ih_g_ctx = 0;
static EGLSurface ih_g_surf = 0;
static long ih_g_surfsw = 0;
static long ih_g_frames = 0;
static double ih_g_lastT = 0.0;
static unsigned long ih_g_rasterSum = 0;
static int ih_g_rasterNz = 0;
static float ih_g_pw = 0, ih_g_ph = 0;
static volatile long ih_g_side = 0;
static volatile long ih_g_offx = 0, ih_g_offy = 0;

static float ih_row_xo(row_t* r) {
	float xo;
	if (r->talpha <= 0.0f) xo = (1.0f - r->alpha) * 14.0f;
	else xo = (1.0f - back_out(r->alpha)) * 20.0f;
	return ih_g_side ? xo : -xo;
}

static void ih_panel_pos(int w, int h, int panelW, int panelH, float* ux, float* uy) {
	float x = ih_g_side ? ((float)(w - panelW) - 8.0f + (float)ih_g_offx) : (8.0f + (float)ih_g_offx);
	float y = (float)((h - panelH) / 2) + (float)ih_g_offy;
	if (x < 0.0f) x = 0.0f;
	if (x > (float)(w - panelW)) x = (float)(w - panelW);
	if (y < 0.0f) y = 0.0f;
	if (y > (float)(h - panelH)) y = (float)(h - panelH);
	*ux = x;
	*uy = y;
}

static double now_sec(void) {
	long ts[2];
	clock_gettime(1, ts);
	return (double)ts[0] + (double)ts[1] / 1e9;
}

static int ih_gl_init(void) {
	if (!pglCreateShader || !pglShaderSource || !pglCompileShader || !pglGetShaderiv
		|| !pglCreateProgram || !pglAttachShader || !pglLinkProgram || !pglGetProgramiv
		|| !pglDeleteShader || !pglGenVertexArrays || !pglGetUniformLocation) {
		ih_set_status("gl sym missing");
		return 0;
	}
	GLint ok = 0;
	const char* src[1];
	GLuint vs = pglCreateShader(GL_VERTEX_SHADER);
	if (!vs) { ih_set_status("vs create fail"); return 0; }
	src[0] = IH_VS;
	pglShaderSource(vs, 1, src, 0);
	pglCompileShader(vs);
	pglGetShaderiv(vs, GL_COMPILE_STATUS, &ok);
	if (!ok) { ih_set_status("vs compile fail"); return 0; }
	GLuint fs = pglCreateShader(GL_FRAGMENT_SHADER);
	if (!fs) { ih_set_status("fs create fail"); return 0; }
	src[0] = IH_FS;
	pglShaderSource(fs, 1, src, 0);
	pglCompileShader(fs);
	pglGetShaderiv(fs, GL_COMPILE_STATUS, &ok);
	if (!ok) { ih_set_status("fs compile fail"); pglDeleteShader(vs); return 0; }
	ih_g_prog = pglCreateProgram();
	if (!ih_g_prog) { ih_set_status("prog create fail"); pglDeleteShader(vs); pglDeleteShader(fs); return 0; }
	pglAttachShader(ih_g_prog, vs);
	pglAttachShader(ih_g_prog, fs);
	pglLinkProgram(ih_g_prog);
	pglGetProgramiv(ih_g_prog, GL_LINK_STATUS, &ok);
	if (!ok) { ih_set_status("link fail"); pglDeleteShader(vs); pglDeleteShader(fs); return 0; }
	pglDeleteShader(vs);
	pglDeleteShader(fs);
	pglGenVertexArrays(1, &ih_g_vao);
	ih_g_uRes = pglGetUniformLocation(ih_g_prog, "uRes");
	ih_g_uOff = pglGetUniformLocation(ih_g_prog, "uOff");
	ih_g_uSize = pglGetUniformLocation(ih_g_prog, "uSize");
	ih_g_uTex = pglGetUniformLocation(ih_g_prog, "uTex");
	ih_g_uAlpha = pglGetUniformLocation(ih_g_prog, "uAlpha");
	ih_set_status("gl ready");
	return 1;
}

static void ih_tex_ensure(int w, int h) {
	if (w == ih_g_tw && h == ih_g_th && ih_g_tex) return;
	if (ih_g_tex) pglDeleteTextures(1, &ih_g_tex);
	pglGenTextures(1, &ih_g_tex);
	pglBindTexture(GL_TEXTURE_2D, ih_g_tex);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	pglTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
	ih_g_tw = w;
	ih_g_th = h;
}

static void ih_render(EGLDisplay dpy, EGLSurface surf) {
	if (ih_g_lock) return;
	float pr = ks_anim(&ih_g_aprog, &ih_g_aprogT, ih_g_enable);
	if (!ih_g_enable && pr <= 0.0005f) return;
	int vis = 0;
	for (int i = 0; i < MAXROWS; i++) if (ih_g_rows[i].used) vis++;
	if (!vis) return;
	EGLint w = 0, h = 0;
	if (peglQuerySurface) {
		peglQuerySurface(dpy, surf, EGL_WIDTH, &w);
		peglQuerySurface(dpy, surf, EGL_HEIGHT, &h);
	}
	if (w <= 0 || h <= 0) {
		GLint vp[4] = { 0, 0, 0, 0 };
		if (pglGetIntegerv) pglGetIntegerv(GL_VIEWPORT, vp);
		w = vp[2];
		h = vp[3];
	}
	long area = (long)w * (long)h;
	if (area < 800L * 480L) return;
	if (area > ks_g_maxarea) ks_g_maxarea = area;
	if (!ih_g_font_ok) {
		if (ih_g_font_tried) {
			if ((ih_g_frames & 63) != 0) return;
		}
		if (!load_sysfont()) return;
	}
	if (ih_g_gl_ready && peglGetCurrentContext) {   /* 后台切回 GL 上下文已重建: 旧 prog/vao/tex 句柄全废, 转首初始化路径 */
		EGLContext cur = peglGetCurrentContext();
		if (cur != ih_g_ctx) {
			ih_g_prog = 0; ih_g_vao = 0; ih_g_tex = 0; ih_g_ctx = 0; ih_g_rasterNz = -1; ih_g_gl_ready = 0;   /* rasterNz=-1 强制重栅化 */
			ks_logf("[hud]", "gl ctx changed, re-init");
		}
	}
	if (!ih_g_gl_ready) {
		if (!peglGetCurrentContext) { ih_g_enable = 0; return; }
		if (ks_g_swaps < 45 || area < ks_g_maxarea) return;
		EGLContext cur = peglGetCurrentContext();
		if (!cur) return;
		if (wpl_pv_ready() && !wpl_ctx_is_game(cur)) return;
		if (!ih_gl_init()) { ih_g_enable = 0; ks_logf("[hud]", "ih_gl_init fail, module disabled"); return; }
		ih_g_ctx = cur;
		ih_g_surf = surf;
		ih_g_gl_ready = 1;
		ks_logf("[hud]", "gl ready surf=%p ctx=%p size=%dx%d swaps=%ld", (void*)surf, (void*)cur, (int)w, (int)h, ks_g_swaps);
	}
	if (peglGetCurrentContext && peglGetCurrentContext() != ih_g_ctx) return;
	if (surf != ih_g_surf) {
		if (ks_g_swaps - ih_g_surfsw > 120) { ih_g_surf = surf; ks_logf("[hud]", "surface relock surf=%p", (void*)surf); }
		else return;
	}
	ih_g_surfsw = ks_g_swaps;
	if (!pglGetIntegerv || !pglIsEnabled || !pglViewport || !pglDisable || !pglEnable
		|| !pglActiveTexture
		|| !pglUseProgram || !pglBindVertexArray || !pglUniform2f || !pglUniform1i || !pglDrawArrays
		|| !pglGenTextures || !pglTexImage2D || !pglTexParameteri || !pglDeleteTextures || !pglBindTexture
		|| !pglBlendFunc || !pglBlendFuncSeparate) return;

	double t = now_sec();
	double dt = t - ih_g_lastT;
	ih_g_lastT = t;
	if (dt <= 0.0 || dt > 0.5) dt = 0.016;
	float xY = (float)(dt * 11.0);
	float kY = xY / (1.0f + xY);
	float xA = (float)(dt * 13.0);
	float kA = xA / (1.0f + xA);

	int fontPx = h / 38;
	if (fontPx < 20) fontPx = 20;
	if (fontPx > 44) fontPx = 44;
	if (fontPx != (int)ih_g_px) {
		ih_g_px = (float)fontPx;
		ih_g_scale = stbtt_ScaleForPixelHeight(&ih_g_font, ih_g_px);
		int a = 0, d = 0, lg = 0;
		stbtt_GetFontVMetrics(&ih_g_font, &a, &d, &lg);
		ih_g_asc = a * ih_g_scale;
		ih_g_desc = d * ih_g_scale;
		gc_flush();
		for (int i = 0; i < MAXROWS; i++) ih_g_rows[i].nameChk = 0;
	}
	int rowH = (int)(ih_g_asc - ih_g_desc) + 10;
	int padX = 10;
	int padT = 5;
	int headerH = rowH;
	int maxTextW = MAXPW - padX * 2 - 8;
	int screenCapW = (int)((long)w * 2 / 5);
	if (maxTextW > screenCapW - padX * 2) maxTextW = screenCapW - padX * 2;
	float nameCap = (float)maxTextW * 5.0f / 8.0f;

	float maxY = -1.0f;
	for (int i = 0; i < MAXROWS; i++) {
		row_t* r = &ih_g_rows[i];
		if (!r->used) continue;
		r->y += (r->ty - r->y) * kY;
		r->alpha += (r->talpha - r->alpha) * kA;
		r->flash -= (float)dt * 2.0f;
		if (r->flash < 0.0f) r->flash = 0.0f;
		if (r->talpha <= 0.0f && r->alpha < 0.03f) { r->used = 0; continue; }
		if (r->y > maxY) maxY = r->y;
	}
	if (maxY < 0.0f) return;
	int nActive = 0;
	for (int i = 0; i < MAXROWS; i++) {
		if (ih_g_rows[i].used && ih_g_rows[i].talpha > 0.0f) nActive++;
	}
	int floorH = (int)((maxY + 1.0f) * rowH) + padT * 2 + headerH;
	int targetH = padT * 2 + headerH + nActive * rowH;
	if (targetH < floorH) targetH = floorH;
	if (targetH > MAXPH) targetH = MAXPH;

	float panelTextW = 0;
	for (int i = 0; i < MAXROWS; i++) {
		row_t* r = &ih_g_rows[i];
		if (!r->used) continue;
		char tail[16];
		int tn = 0;
		tail[tn++] = ' ';
		tail[tn++] = 'x';
		long c = r->count;
		char dig[12];
		int dn = 0;
		do { dig[dn++] = (char)('0' + c % 10); c /= 10; } while (c && dn < 10);
		while (dn) tail[tn++] = dig[--dn];
		tail[tn] = 0;
		ih_name_check(r, nameCap * 1.5f);
		float nw = r->nameW;
		if (nw > nameCap) nw = nameCap;
		float tw = nw + 12.0f + text_w(tail);
		if (tw > panelTextW) panelTextW = tw;
	}
	{
		float hw = text_w_sp("Item", 2.0f) + 20.0f;
		if (hw > panelTextW) panelTextW = hw;
	}
	if (panelTextW > maxTextW) panelTextW = (float)maxTextW;
	int targetW = (int)panelTextW + padX * 2 + 6;
	if (targetW > MAXPW) targetW = MAXPW;
	if (targetW < 24) targetW = 24;
	if (ih_g_pw <= 1.0f || ih_g_ph <= 1.0f || ih_g_frames == 0) {
		ih_g_pw = (float)targetW;
		ih_g_ph = (float)targetH;
	} else {
		ih_g_pw += ((float)targetW - ih_g_pw) * kY;
		ih_g_ph += ((float)targetH - ih_g_ph) * kY;
	}
	int panelW = (int)(ih_g_pw + 0.5f);
	int panelH = (int)(ih_g_ph + 0.5f);
	if (panelW < 24) panelW = 24;
	if (panelH < headerH + rowH) panelH = headerH + rowH;
	if (panelW > MAXPW) panelW = MAXPW;
	if (panelH > MAXPH) panelH = MAXPH;

	memset(ih_g_pix, 0, (size_t)panelW * panelH * 4);
	int rad = 12;
	for (int yy = 0; yy < panelH; yy++) {
		for (int xx = 0; xx < panelW; xx++) {
			uint8_t* p = ih_g_pix + ((size_t)yy * panelW + xx) * 4;
			int edge = (xx == 0 || yy == 0 || xx == panelW - 1 || yy == panelH - 1);
			if (!edge && ((xx < rad || xx >= panelW - rad) && (yy < rad || yy >= panelH - rad))) {
				int cx = xx < rad ? rad - 1 - xx : xx - (panelW - rad);
				int cy = yy < rad ? rad - 1 - yy : yy - (panelH - rad);
				int d2 = cx * cx + cy * cy;
				if (d2 > rad * rad) continue;
				edge = d2 > (rad - 2) * (rad - 2);
			}
			if (edge) { p[0] = 78; p[1] = 92; p[2] = 112; p[3] = 210; }
			else { p[0] = 14; p[1] = 16; p[2] = 21; p[3] = 152; }
		}
	}

	{
		int barX = ih_g_side ? (panelW - 9) : 6;
		for (int yy = padT + 3; yy < panelH - padT - 3; yy++) {
			blend_px(barX, yy, panelW, panelH, 110, 200, 255, 170);
			blend_px(barX + 1, yy, panelW, panelH, 110, 200, 255, 170);
			blend_px(barX + 2, yy, panelW, panelH, 110, 200, 255, 70);
		}
	}
	draw_text_sp("Item", (float)(padX + 6), (float)(padT + ih_g_asc + 3), panelW, panelH, 120, 205, 255, 235, panelW - padX, 2.0f);
	{
		long tot = 0;
		for (int i = 0; i < MAXROWS; i++) {
			if (ih_g_rows[i].used && ih_g_rows[i].talpha > 0.0f) tot += ih_g_rows[i].count;
		}
		char tc[16];
		int tn = 0;
		long c = tot;
		char dig[12];
		int dn = 0;
		if (!c) dig[dn++] = '0';
		while (c) { dig[dn++] = (char)('0' + c % 10); c /= 10; }
		tc[tn++] = ' ';
		while (dn) tc[tn++] = dig[--dn];
		tc[tn] = 0;
		float txr = (float)(panelW - padX) - text_w(tc);
		draw_text(tc, txr, (float)(padT + ih_g_asc + 3), panelW, panelH, 148, 168, 190, 205, panelW - padX);
	}
	for (int xx = padX + 2; xx < panelW - padX - 2; xx++) {
		blend_px(xx, padT + headerH - 3, panelW, panelH, 190, 205, 220, 75);
	}

	for (int i = 0; i < MAXROWS; i++) {
		row_t* r = &ih_g_rows[i];
		if (!r->used || r->alpha < 0.02f) continue;
		int a = (int)(r->alpha * 255.0f);
		float xo = ih_row_xo(r);
		float x = (float)(padX + 6) + xo;
		float baseline = padT + headerH + r->y * rowH + ih_g_asc + 3.0f;
		if (baseline > panelH) continue;
		char tail[16];
		int tn = 0;
		tail[tn++] = ' ';
		tail[tn++] = 'x';
		long c = r->count;
		char dig[12];
		int dn = 0;
		do { dig[dn++] = (char)('0' + c % 10); c /= 10; } while (c && dn < 10);
		while (dn) tail[tn++] = dig[--dn];
		tail[tn] = 0;
		float nx = (float)(panelW - padX) - text_w(tail);
		int af = a + (int)(r->flash * 120.0f);
		if (af > 255) af = 255;
		uint8_t cg = (uint8_t)(215 + (int)(30.0f * r->flash));
		uint8_t cb = (uint8_t)(90 + (int)(120.0f * r->flash));
		float nameOff = 0.0f;
		if (r->nameW > nameCap) {
			float over = r->nameW - nameCap;
			float scrollT = over / 50.0f;
			float cyc = 1.0f + scrollT + 0.6f;
			float u = (float)(t - (double)((long)(t / cyc)) * (double)cyc);
			if (u < 1.0f) nameOff = 0.0f;
			else if (u < 1.0f + scrollT) nameOff = (u - 1.0f) * 50.0f;
			else nameOff = over;
		}
		ih_g_clipx0 = padX + 6;
		ih_g_clipx1 = padX + 6 + (int)(nameCap + 0.5f);
		draw_text(r->name, x - nameOff, baseline, panelW, panelH, 236, 238, 242, a, panelW - padX);
		ih_g_clipx0 = 0;
		ih_g_clipx1 = 0;
		draw_text(tail, nx, baseline, panelW, panelH, 255, cg, cb, af, panelW - padX);
	}

	GLint oldVp[4] = { 0, 0, 0, 0 };
	GLint oldProg = 0, oldVao = 0, oldTex = 0, oldTex0 = 0, oldActive = GL_TEXTURE0;
	GLint oldBS = 0, oldBD = 0, oldBSA = 0, oldBDA = 0;
	GLboolean bBlend = pglIsEnabled(GL_BLEND);
	GLboolean bDepth = pglIsEnabled(GL_DEPTH_TEST);
	GLboolean bCull = pglIsEnabled(GL_CULL_FACE);
	GLboolean bSciss = pglIsEnabled(GL_SCISSOR_TEST);
	pglGetIntegerv(GL_VIEWPORT, oldVp);
	pglGetIntegerv(GL_CURRENT_PROGRAM, &oldProg);
	pglGetIntegerv(GL_VERTEX_ARRAY_BINDING, &oldVao);
	pglGetIntegerv(GL_ACTIVE_TEXTURE, &oldActive);
	pglGetIntegerv(GL_TEXTURE_BINDING_2D, &oldTex);
	pglActiveTexture(GL_TEXTURE0);
	pglGetIntegerv(GL_TEXTURE_BINDING_2D, &oldTex0);
	pglGetIntegerv(GL_BLEND_SRC_RGB, &oldBS);
	pglGetIntegerv(GL_BLEND_DST_RGB, &oldBD);
	pglGetIntegerv(GL_BLEND_SRC_ALPHA, &oldBSA);
	pglGetIntegerv(GL_BLEND_DST_ALPHA, &oldBDA);

	pglBindTexture(GL_TEXTURE_2D, 0);
	ih_tex_ensure(panelW, panelH);
	pglBindTexture(GL_TEXTURE_2D, ih_g_tex);
	pglTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, panelW, panelH, 0, GL_RGBA, GL_UNSIGNED_BYTE, ih_g_pix);

	pglViewport(0, 0, w, h);
	pglDisable(GL_DEPTH_TEST);
	pglDisable(GL_CULL_FACE);
	pglDisable(GL_SCISSOR_TEST);
	pglEnable(GL_BLEND);
	pglBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
	pglUseProgram(ih_g_prog);
	pglBindVertexArray(ih_g_vao);
	pglUniform2f(ih_g_uRes, (GLfloat)w, (GLfloat)h);
	{
		float ux = 8.0f, uy = (GLfloat)((h - panelH) / 2);
		ih_panel_pos(w, h, panelW, panelH, &ux, &uy);
		float e = pr * pr * (3.0f - 2.0f * pr);
		ux += (1.0f - e) * (ih_g_side ? 48.0f : -48.0f);
		pglUniform2f(ih_g_uOff, ux, uy);
		pglUniform1f(ih_g_uAlpha, e);
	}
	pglUniform2f(ih_g_uSize, (GLfloat)panelW, (GLfloat)panelH);
	pglUniform1i(ih_g_uTex, 0);
	pglDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
	{
		unsigned long rs = 0;
		int rz = 0;
		size_t total = (size_t)panelW * (size_t)panelH * 4;
		for (size_t k = 3; k < total; k += 28) {
			rs += ih_g_pix[k];
			if (ih_g_pix[k] > 8) rz++;
		}
		ih_g_rasterSum = rs;
		ih_g_rasterNz = rz;
	}

	pglBindTexture(GL_TEXTURE_2D, (GLuint)oldTex0);
	pglActiveTexture((GLenum)oldActive);
	pglBindTexture(GL_TEXTURE_2D, (GLuint)oldTex);
	pglBindVertexArray((GLuint)oldVao);
	pglUseProgram((GLuint)oldProg);
	pglViewport(oldVp[0], oldVp[1], oldVp[2], oldVp[3]);
	pglBlendFuncSeparate((GLenum)oldBS, (GLenum)oldBD, (GLenum)oldBSA, (GLenum)oldBDA);
	if (!bBlend) pglDisable(GL_BLEND);
	if (bDepth) pglEnable(GL_DEPTH_TEST);
	if (bCull) pglEnable(GL_CULL_FACE);
	if (bSciss) pglEnable(GL_SCISSOR_TEST);
	ih_g_frames++;
}

static long ihud_side(long v) {
	ih_g_side = (v == 2) ? 1 : 0;
	return ih_g_side;
}
static long ihud_offx(long v) {
	v -= 401;
	if (v < -400) v = -400;
	if (v > 400) v = 400;
	ih_g_offx = v;
	return ih_g_offx;
}
static long ihud_offy(long v) {
	v -= 401;
	if (v < -400) v = -400;
	if (v > 400) v = 400;
	ih_g_offy = v;
	return ih_g_offy;
}
static long ihud_maxrows(long v) {
	if (v < 1) v = 1;
	if (v > MAXROWS) v = MAXROWS;
	ih_g_maxrows = v;
	return ih_g_maxrows;
}

static int ih_active(void) { return ih_g_enable != 0 || ih_g_aprog > 0.0005f; }
static void ih_disable(void) { ih_g_enable = 0; }


/* ===== 方向标模块 ===== */
static void dir_set_status(const char* s) { ks_set_status(3, s); }

static volatile int dir_g_enable = 0;
static volatile long dir_g_cdeg = 0;
static float dir_g_disp = 0.0f;
static int dir_g_disp_init = 0;
static int dir_g_gl_ready = 0;
static GLuint dir_g_prog = 0, dir_g_vao = 0, dir_g_tex = 0;
static GLint dir_g_uRes = -1, dir_g_uOff = -1, dir_g_uSize = -1, dir_g_uTex = -1, dir_g_uProg = -1;
static float dir_g_aprog = 0.0f;   /* 开关动画进度(胶囊伸缩) */
static long dir_g_aprogT = 0;
static int dir_g_tw = 0, dir_g_th = 0;
static EGLContext dir_g_ctx = 0;
static EGLSurface dir_g_surf = 0;
static long dir_g_surfsw = 0;
static long dir_g_frames = 0;
static double dir_g_lastT = 0.0;
static volatile long dir_g_offx = 0, dir_g_offy = 0;

static void dir_panel_pos(int w, int h, int panelW, int totalH, float* ux, float* uy) {
	float x = (float)((w - panelW) / 2) + (float)dir_g_offx;
	float y = (float)(h * 7 / 100) + (float)dir_g_offy;
	if (x < 0.0f) x = 0.0f;
	if (x > (float)(w - panelW)) x = (float)(w - panelW);
	if (y < 0.0f) y = 0.0f;
	if (y > (float)(h - totalH)) y = (float)(h - totalH);
	*ux = x;
	*uy = y;
}

#define DIRMAXH 188
static uint8_t dir_g_pix[MAXPW * DIRMAXH * 4];

#define DIRINMAX 512
static uint8_t dir_g_inbuf[4 + DIRINMAX];
static char dir_g_info[192];

static const char* const DIR_CARDS[8] = { "\xe5\x8c\x97", "\xe4\xb8\x9c\xe5\x8c\x97", "\xe4\xb8\x9c", "\xe4\xb8\x9c\xe5\x8d\x97", "\xe5\x8d\x97", "\xe8\xa5\xbf\xe5\x8d\x97", "\xe8\xa5\xbf", "\xe8\xa5\xbf\xe5\x8c\x97" };

static float dir_wrap_delta(float a, float b) {
	float d = a - b;
	while (d > 180.0f) d -= 360.0f;
	while (d < -180.0f) d += 360.0f;
	return d;
}

static void dir_blend_px(int x, int y, int pw, int ph, uint8_t r, uint8_t g, uint8_t b, int a) {
	if (x < 0 || y < 0 || x >= pw || y >= ph) return;
	uint8_t* p = dir_g_pix + ((size_t)y * pw + x) * 4;
	int ia = 255 - a;
	p[0] = (uint8_t)((r * a + p[0] * ia) / 255);
	p[1] = (uint8_t)((g * a + p[1] * ia) / 255);
	p[2] = (uint8_t)((b * a + p[2] * ia) / 255);
	int na = a + p[3] * ia / 255;
	p[3] = (uint8_t)(na > 255 ? 255 : na);
}

static void dir_draw_text(const char* s, float x, float baseline, int pw, int ph, uint8_t r, uint8_t g, uint8_t b, int a255, int maxx) {
	int i = 0;
	while (s[i]) {
		int cp = utf8_next(s, &i);
		gc_t* gc = gc_get(cp);
		if (gc->bits) {
			for (int py = 0; py < gc->h; py++) {
				for (int px = 0; px < gc->w; px++) {
					int al = (gc->bits[py * gc->w + px] * a255) / 255;
					if (al > 3) {
						int xx = (int)x + gc->x0 + px;
						if (xx > maxx) break;
						dir_blend_px(xx, (int)baseline + gc->y0 + py, pw, ph, r, g, b, al);
					}
				}
			}
		}
		x += gc->adv + 1.0f;
		if ((int)x > maxx) return;
	}
}

static void dir_vline(int x, int y0, int y1, int pw, int ph, uint8_t r, uint8_t g, uint8_t b, int a) {
	for (int y = y0; y <= y1; y++) dir_blend_px(x, y, pw, ph, r, g, b, a);
}

static float dir_text_w_scaled(const char* s, float scale) {
	float w = 0.0f;
	int i = 0;
	while (s[i]) {
		int cp = utf8_next(s, &i);
		if (stbtt_FindGlyphIndex(&ih_g_font, cp) == 0) cp = '?';
		int adv = 0, lsb = 0;
		stbtt_GetCodepointHMetrics(&ih_g_font, cp, &adv, &lsb);
		w += adv * scale + 1.0f;
	}
	return w;
}

static void dir_draw_text_scaled(const char* s, float x, float baseline, int pw, int ph, uint8_t r, uint8_t g, uint8_t b, int a255, int maxx, float scale) {
	int i = 0;
	while (s[i]) {
		int cp = utf8_next(s, &i);
		if (stbtt_FindGlyphIndex(&ih_g_font, cp) == 0) cp = '?';
		int adv = 0, lsb = 0;
		stbtt_GetCodepointHMetrics(&ih_g_font, cp, &adv, &lsb);
		int bx0 = 0, by0 = 0, bx1 = 0, by1 = 0;
		stbtt_GetCodepointBitmapBox(&ih_g_font, cp, scale, scale, &bx0, &by0, &bx1, &by1);
		int bw = bx1 - bx0, bh = by1 - by0;
		if (bw > 0 && bh > 0 && bw < 128 && bh < 128) {
			unsigned char* bits = (unsigned char*)malloc((size_t)bw * (size_t)bh);
			if (bits) {
				stbtt_MakeCodepointBitmap(&ih_g_font, bits, bw, bh, bw, scale, scale, cp);
				for (int py = 0; py < bh; py++) {
					for (int px = 0; px < bw; px++) {
						int al = (bits[py * bw + px] * a255) / 255;
						if (al > 3) {
							int xx = (int)x + bx0 + px;
							if (xx > maxx) break;
							dir_blend_px(xx, (int)baseline + by0 + py, pw, ph, r, g, b, al);
						}
					}
				}
				free(bits);
			}
		}
		x += adv * scale + 1.0f;
		if ((int)x > maxx) return;
	}
}

static const char DIR_FS[] =
	"#version 300 es\n"
	"precision highp float;\n"
	"uniform sampler2D uTex;\n"
	"uniform float uProg;\n"
	"in vec2 vUv;\n"
	"out vec4 fragColor;\n"
	"void main(){\n"
	"    vec4 c = texture(uTex, vUv);\n"
	"    fragColor = vec4(c.rgb, c.a * uProg);\n"
	"}\n";

static int dir_gl_init(void) {
	if (!pglCreateShader || !pglShaderSource || !pglCompileShader || !pglGetShaderiv
		|| !pglCreateProgram || !pglAttachShader || !pglLinkProgram || !pglGetProgramiv
		|| !pglDeleteShader || !pglGenVertexArrays || !pglGetUniformLocation) {
		dir_set_status("gl sym missing");
		return 0;
	}
	GLint ok = 0;
	const char* src[1];
	GLuint vs = pglCreateShader(GL_VERTEX_SHADER);
	if (!vs) { dir_set_status("vs create fail"); return 0; }
	src[0] = IH_VS;
	pglShaderSource(vs, 1, src, 0);
	pglCompileShader(vs);
	pglGetShaderiv(vs, GL_COMPILE_STATUS, &ok);
	if (!ok) { dir_set_status("vs compile fail"); return 0; }
	GLuint fs = pglCreateShader(GL_FRAGMENT_SHADER);
	if (!fs) { dir_set_status("fs create fail"); pglDeleteShader(vs); return 0; }
	src[0] = DIR_FS;
	pglShaderSource(fs, 1, src, 0);
	pglCompileShader(fs);
	pglGetShaderiv(fs, GL_COMPILE_STATUS, &ok);
	if (!ok) { dir_set_status("fs compile fail"); pglDeleteShader(vs); return 0; }
	dir_g_prog = pglCreateProgram();
	if (!dir_g_prog) { pglDeleteShader(vs); pglDeleteShader(fs); dir_set_status("prog create fail"); return 0; }
	pglAttachShader(dir_g_prog, vs);
	pglAttachShader(dir_g_prog, fs);
	pglLinkProgram(dir_g_prog);
	pglGetProgramiv(dir_g_prog, GL_LINK_STATUS, &ok);
	pglDeleteShader(vs);
	pglDeleteShader(fs);
	if (!ok) { dir_set_status("link fail"); return 0; }
	pglGenVertexArrays(1, &dir_g_vao);
	dir_g_uRes = pglGetUniformLocation(dir_g_prog, "uRes");
	dir_g_uOff = pglGetUniformLocation(dir_g_prog, "uOff");
	dir_g_uSize = pglGetUniformLocation(dir_g_prog, "uSize");
	dir_g_uTex = pglGetUniformLocation(dir_g_prog, "uTex");
	dir_g_uProg = pglGetUniformLocation(dir_g_prog, "uProg");
	dir_set_status("gl ready");
	return 1;
}

static void dir_tex_ensure(int w, int h) {
	if (w == dir_g_tw && h == dir_g_th && dir_g_tex) return;
	if (dir_g_tex) pglDeleteTextures(1, &dir_g_tex);
	pglGenTextures(1, &dir_g_tex);
	pglBindTexture(GL_TEXTURE_2D, dir_g_tex);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	pglTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
	dir_g_tw = w;
	dir_g_th = h;
}

static void dir_render(EGLDisplay dpy, EGLSurface surf) {
	float pr = ks_anim(&dir_g_aprog, &dir_g_aprogT, dir_g_enable);
	if (!dir_g_enable && pr <= 0.0005f) return;
	EGLint w = 0, h = 0;
	if (peglQuerySurface) {
		peglQuerySurface(dpy, surf, EGL_WIDTH, &w);
		peglQuerySurface(dpy, surf, EGL_HEIGHT, &h);
	}
	if (w <= 0 || h <= 0) {
		GLint vp[4] = { 0, 0, 0, 0 };
		if (pglGetIntegerv) pglGetIntegerv(GL_VIEWPORT, vp);
		w = vp[2];
		h = vp[3];
	}
	long area = (long)w * (long)h;
	if (area < 800L * 480L) return;
	if (area > ks_g_maxarea) ks_g_maxarea = area;
	if (!ih_g_font_ok) {
		if (ih_g_font_tried && (dir_g_frames & 63) != 0) return;
		if (!load_sysfont()) return;
	}
	if (dir_g_gl_ready && peglGetCurrentContext) {   /* 后台切回 GL 上下文已重建: 旧 prog/vao/tex 句柄全废, 转首初始化路径 */
		EGLContext cur = peglGetCurrentContext();
		if (cur != dir_g_ctx) {
			dir_g_prog = 0; dir_g_vao = 0; dir_g_tex = 0; dir_g_ctx = 0; dir_g_gl_ready = 0;   /* dir 内容每帧重传, 无需 dirty */
			ks_logf("[dir]", "gl ctx changed, re-init");
		}
	}
	if (!dir_g_gl_ready) {
		if (!peglGetCurrentContext) { dir_g_enable = 0; return; }
		if (ks_g_swaps < 45 || area < ks_g_maxarea) return;
		EGLContext cur = peglGetCurrentContext();
		if (!cur) return;
		if (wpl_pv_ready() && !wpl_ctx_is_game(cur)) return;
		if (!dir_gl_init()) { dir_g_enable = 0; ks_logf("[dir]", "gl_init fail, module disabled"); return; }
		dir_g_ctx = cur;
		dir_g_surf = surf;
		dir_g_gl_ready = 1;
		ks_logf("[dir]", "gl ready surf=%p ctx=%p size=%dx%d swaps=%ld", (void*)surf, (void*)cur, (int)w, (int)h, ks_g_swaps);
	}
	if (peglGetCurrentContext && peglGetCurrentContext() != dir_g_ctx) return;
	if (surf != dir_g_surf) {
		if (ks_g_swaps - dir_g_surfsw > 120) { dir_g_surf = surf; ks_logf("[dir]", "surface relock surf=%p", (void*)surf); }
		else return;
	}
	dir_g_surfsw = ks_g_swaps;
	if (!pglGetIntegerv || !pglIsEnabled || !pglViewport || !pglDisable || !pglEnable
		|| !pglActiveTexture || !pglUseProgram || !pglBindVertexArray || !pglUniform2f || !pglUniform1i || !pglDrawArrays
		|| !pglGenTextures || !pglTexImage2D || !pglTexParameteri || !pglDeleteTextures || !pglBindTexture
		|| !pglBlendFunc || !pglBlendFuncSeparate) return;

	double t = now_sec();
	double dt = t - dir_g_lastT;
	dir_g_lastT = t;
	if (dt <= 0.0 || dt > 0.5) dt = 0.016;

	float target = (float)(dir_g_cdeg % 36000L) / 100.0f;
	if (!dir_g_disp_init) {
		dir_g_disp = target;
		dir_g_disp_init = 1;
	} else {
		float xK = (float)(dt * 12.0);
		float k = xK / (1.0f + xK);
		dir_g_disp += dir_wrap_delta(target, dir_g_disp) * k;
		if (dir_g_disp < 0.0f) dir_g_disp += 360.0f;
		else if (dir_g_disp >= 360.0f) dir_g_disp -= 360.0f;
	}

	int fontPx = h / 38;
	if (fontPx < 20) fontPx = 20;
	if (fontPx > 44) fontPx = 44;
	if (fontPx != (int)ih_g_px) {
		ih_g_px = (float)fontPx;
		ih_g_scale = stbtt_ScaleForPixelHeight(&ih_g_font, ih_g_px);
		int a = 0, d = 0, lg = 0;
		stbtt_GetFontVMetrics(&ih_g_font, &a, &d, &lg);
		ih_g_asc = a * ih_g_scale;
		ih_g_desc = d * ih_g_scale;
		gc_flush();
	}

	int padT = 4, padB = 5, padX = 8;
	int numH = (int)(ih_g_asc - ih_g_desc);
	int tickH = 12;
	int barY0 = padT + numH + 2;
	int barH = numH + tickH + 4;
	int panelH = barY0 + barH + padB;
	if (panelH > DIRMAXH) return;
	int panelW = (int)((long)w * 46 / 100);
	if (panelW < 260) panelW = 260;
	if (panelW > MAXPW) panelW = MAXPW;
	float pxPerDeg = (float)(panelW - padX * 2) / 110.0f;
	float cx = (float)panelW / 2.0f;

	int hasInfo = dir_g_info[0] != 0;
	float iScale = 0.0f, iAsc = 0.0f, iDesc = 0.0f;
	int infoGap = 6, infoBand = 0;
	if (hasInfo) {
		int ipx = fontPx * 3 / 4;
		if (ipx < 14) ipx = 14;
		iScale = stbtt_ScaleForPixelHeight(&ih_g_font, (float)ipx);
		int ia = 0, id = 0, lg = 0;
		stbtt_GetFontVMetrics(&ih_g_font, &ia, &id, &lg);
		iAsc = ia * iScale;
		iDesc = id * iScale;
		infoBand = (int)(iAsc - iDesc) + 6;
	}
	int totalH = panelH + (hasInfo ? infoGap + infoBand : 0);
	if (totalH > DIRMAXH) { totalH = panelH; hasInfo = 0; }

	memset(dir_g_pix, 0, (size_t)panelW * totalH * 4);
	{
		int rad = totalH / 2;
		for (int yy = 0; yy < totalH; yy++) {
			int bgA = 158 - yy * 18 / totalH;
			for (int xx = 0; xx < panelW; xx++) {
				uint8_t* p = dir_g_pix + ((size_t)yy * panelW + xx) * 4;
				int edge;
				if ((xx < rad || xx >= panelW - rad) && (yy <= rad || yy >= totalH - 1 - rad)) {
					int cqx = xx < rad ? rad - 1 - xx : xx - (panelW - rad);
					int cqy = yy < rad ? rad - 1 - yy : yy - (totalH - rad);
					int d2 = cqx * cqx + cqy * cqy;
					if (d2 > rad * rad) continue;
					edge = d2 > (rad - 2) * (rad - 2);
				} else {
					edge = (yy == 0 || yy == totalH - 1);
				}
				if (edge) { p[0] = 78; p[1] = 92; p[2] = 112; p[3] = 205; }
				else { p[0] = 14; p[1] = 16; p[2] = 21; p[3] = (uint8_t)bgA; }
			}
		}
	}

	{
		int deg = (int)((dir_g_cdeg % 36000L + 50) / 100) % 360 - 180;
		if (deg == -180) deg = 180;
		int ci = (int)((dir_g_cdeg % 36000L + 2250) / 4500) & 7;
		char num[24];
		int nn = 0;
		const char* cs = DIR_CARDS[ci];
		while (*cs && nn < 18) num[nn++] = *cs++;
		num[nn++] = ' ';
		char dig[8];
		int dn = 0;
		int dc = deg;
		if (dc < 0) { num[nn++] = '-'; dc = -dc; }
		if (!dc) dig[dn++] = '0';
		while (dc) { dig[dn++] = (char)('0' + dc % 10); dc /= 10; }
		while (dn && nn < 22) num[nn++] = dig[--dn];
		num[nn] = 0;
		float tw = text_w(num);
		float tx = ((float)panelW - tw) / 2.0f;
		dir_draw_text(num, tx, (float)(padT + ih_g_asc), panelW, panelH, 236, 238, 242, 240, panelW - padX);
	}

	float labelsBase = (float)barY0 + ih_g_asc;
	int tickY0 = barY0 + numH + 2;
	{
		int xc = (int)cx;
		for (int r = 0; r < 5; r++) {
			int yy = barY0 - 5 + r;
			if (yy < 0) yy = 0;
			for (int q = -r; q <= r; q++) dir_blend_px(xc + q, yy, panelW, panelH, 110, 200, 255, 235);
		}
		dir_vline(xc, barY0, barY0 + barH, panelW, panelH, 110, 200, 255, 235);
		dir_vline(xc + 1, barY0, barY0 + barH, panelW, panelH, 110, 200, 255, 130);
	}
	for (int a = 0; a < 360; a += 15) {
		float off = dir_wrap_delta((float)a, dir_g_disp);
		if (off > 58.0f || off < -58.0f) continue;
		int x = (int)(cx + off * pxPerDeg + (off >= 0.0f ? 0.5f : -0.5f));
		if (x < padX || x >= panelW - padX) continue;
		int major = (a % 45) == 0;
		float fade = 1.0f;
		float ao = off < 0.0f ? -off : off;
		if (ao > 40.0f) {
			fade = 1.0f - (ao - 40.0f) / 18.0f;
			if (fade < 0.0f) fade = 0.0f;
		}
		int aTick = (int)((major ? 215 : 135) * fade);
		if (aTick > 8) {
			int tl = major ? tickH : tickH - 5;
			dir_vline(x, tickY0, tickY0 + tl, panelW, panelH, 190, 205, 220, aTick);
			if (major) dir_vline(x + 1, tickY0, tickY0 + tl, panelW, panelH, 190, 205, 220, aTick);
		}
		if (major) {
			int ci = a / 45;
			const char* lb = DIR_CARDS[ci];
			float tw = text_w(lb);
			float tx = (float)x - tw / 2.0f;
			int aTxt = (int)((ci % 2 == 0 ? 235 : 165) * fade);
			if (aTxt > 8) {
				if (ci % 2 == 0) dir_draw_text(lb, tx, labelsBase, panelW, panelH, 236, 238, 242, aTxt, panelW - padX);
				else dir_draw_text(lb, tx, labelsBase, panelW, panelH, 170, 182, 198, aTxt, panelW - padX);
			}
		}
	}

	if (hasInfo) {
		float tw = dir_text_w_scaled(dir_g_info, iScale);
		float tx = ((float)panelW - tw) / 2.0f;
		if (tx < 16.0f) tx = 16.0f;
		float base = (float)(panelH + infoGap) + iAsc;
		dir_draw_text_scaled(dir_g_info, tx + 1.0f, base + 1.0f, panelW, totalH, 0, 0, 0, 160, panelW - 16, iScale);
		dir_draw_text_scaled(dir_g_info, tx, base, panelW, totalH, 216, 222, 232, 228, panelW - 16, iScale);
	}

	GLint oldVp[4] = { 0, 0, 0, 0 };
	GLint oldProg = 0, oldVao = 0, oldTex = 0, oldTex0 = 0, oldActive = GL_TEXTURE0;
	GLint oldBS = 0, oldBD = 0, oldBSA = 0, oldBDA = 0;
	GLboolean bBlend = pglIsEnabled(GL_BLEND);
	GLboolean bDepth = pglIsEnabled(GL_DEPTH_TEST);
	GLboolean bCull = pglIsEnabled(GL_CULL_FACE);
	GLboolean bSciss = pglIsEnabled(GL_SCISSOR_TEST);
	pglGetIntegerv(GL_VIEWPORT, oldVp);
	pglGetIntegerv(GL_CURRENT_PROGRAM, &oldProg);
	pglGetIntegerv(GL_VERTEX_ARRAY_BINDING, &oldVao);
	pglGetIntegerv(GL_ACTIVE_TEXTURE, &oldActive);
	pglGetIntegerv(GL_TEXTURE_BINDING_2D, &oldTex);
	pglActiveTexture(GL_TEXTURE0);
	pglGetIntegerv(GL_TEXTURE_BINDING_2D, &oldTex0);
	pglGetIntegerv(GL_BLEND_SRC_RGB, &oldBS);
	pglGetIntegerv(GL_BLEND_DST_RGB, &oldBD);
	pglGetIntegerv(GL_BLEND_SRC_ALPHA, &oldBSA);
	pglGetIntegerv(GL_BLEND_DST_ALPHA, &oldBDA);

	pglBindTexture(GL_TEXTURE_2D, 0);
	dir_tex_ensure(panelW, totalH);
	pglBindTexture(GL_TEXTURE_2D, dir_g_tex);
	pglTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, panelW, totalH, 0, GL_RGBA, GL_UNSIGNED_BYTE, dir_g_pix);

	pglViewport(0, 0, w, h);
	pglDisable(GL_DEPTH_TEST);
	pglDisable(GL_CULL_FACE);
	pglDisable(GL_SCISSOR_TEST);
	pglEnable(GL_BLEND);
	pglBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
	pglUseProgram(dir_g_prog);
	pglBindVertexArray(dir_g_vao);
	pglUniform2f(dir_g_uRes, (GLfloat)w, (GLfloat)h);
	{
		float e = pr * pr * (3.0f - 2.0f * pr);
		float ux = 0.0f, uy = 0.0f;
		dir_panel_pos(w, h, panelW, totalH, &ux, &uy);
		float cw = (float)panelW * e;   /* 胶囊整体向中线水平伸缩: 宽度压缩使圆端随之收拢, 保持胶囊形(旧方案按 uv 开窗 discard, 露出中段矩形) */
		ux += ((float)panelW - cw) * 0.5f;
		pglUniform2f(dir_g_uOff, ux, uy);
		pglUniform2f(dir_g_uSize, cw, (GLfloat)totalH);
		pglUniform1f(dir_g_uProg, e);
	}
	pglUniform1i(dir_g_uTex, 0);
	pglDrawArrays(GL_TRIANGLE_STRIP, 0, 4);

	pglBindTexture(GL_TEXTURE_2D, (GLuint)oldTex0);
	pglActiveTexture((GLenum)oldActive);
	pglBindTexture(GL_TEXTURE_2D, (GLuint)oldTex);
	pglBindVertexArray((GLuint)oldVao);
	pglUseProgram((GLuint)oldProg);
	pglViewport(oldVp[0], oldVp[1], oldVp[2], oldVp[3]);
	pglBlendFuncSeparate((GLenum)oldBS, (GLenum)oldBD, (GLenum)oldBSA, (GLenum)oldBDA);
	if (!bBlend) pglDisable(GL_BLEND);
	if (bDepth) pglEnable(GL_DEPTH_TEST);
	if (bCull) pglEnable(GL_CULL_FACE);
	if (bSciss) pglEnable(GL_SCISSOR_TEST);

	dir_g_frames++;
}

static long dirhud_enable(long v) {
	dir_g_enable = (v == 1) ? 1 : 0;
	if (!dir_g_enable) dir_g_disp_init = 0;
	return dir_g_enable;
}

static long dirhud_set(long v) {
	long cdeg = v - 1;
	if (cdeg < 0) cdeg = 0;
	if (cdeg >= 36000L) cdeg = 0;
	dir_g_cdeg = cdeg;
	return dir_g_cdeg;
}

static long __dir_in(void) { return (long)(intptr_t)dir_g_inbuf; }

static long dirhud_sync(void) {
	int len = dir_g_inbuf[0] | (dir_g_inbuf[1] << 8) | ((int)dir_g_inbuf[2] << 16) | ((int)dir_g_inbuf[3] << 24);
	if (len < 0 || len > DIRINMAX) return -1L;
	int cap = (int)sizeof(dir_g_info) - 1;
	int n = len < cap ? len : cap;
	for (int k = 0; k < n; k++) dir_g_info[k] = (char)dir_g_inbuf[4 + k];
	dir_g_info[n] = 0;
	return n;
}

static long dirhud_off(void) {
	dir_g_enable = 0;
	dir_g_disp_init = 0;
	dir_g_info[0] = 0;
	return 0;
}

static long dirhud_offx(long v) {
	v -= 401;
	if (v < -400) v = -400;
	if (v > 400) v = 400;
	dir_g_offx = v;
	return dir_g_offx;
}

static long dirhud_offy(long v) {
	v -= 401;
	if (v < -400) v = -400;
	if (v > 400) v = 400;
	dir_g_offy = v;
	return dir_g_offy;
}

static long dirhud_frames(void) { return dir_g_frames; }

static int dir_active(void) { return dir_g_enable != 0 || dir_g_aprog > 0.0005f; }
static void dir_disable(void) { dir_g_enable = 0; dir_g_disp_init = 0; dir_g_info[0] = 0; }

/* ===== 自定义准星模块 ===== */
static void ch_set_status(const char* s) { ks_set_status(5, s); }

#define CH_MAX 336
static uint8_t ch_g_pix[CH_MAX * CH_MAX * 4];

static volatile int ch_g_enable = 0;
static volatile long ch_g_preset = 0;
static volatile long ch_g_size = 18;
static volatile long ch_g_thick = 3;
static volatile long ch_g_gap = 6;
static volatile long ch_g_rgb = 0xFFFFFF;
static volatile long ch_g_alpha = 230;
static volatile long ch_g_dyn = 3;
static volatile long ch_g_amp = 10;
static volatile long ch_g_offx = -3;
static volatile long ch_g_offy = -3;
static volatile long ch_g_seq = 0;
static long ch_g_seen = 0;
static double ch_g_atkT = -10.0;
static int ch_g_gl_ready = 0;
static GLuint ch_g_prog = 0, ch_g_vao = 0, ch_g_tex = 0;
static GLint ch_g_uRes = -1, ch_g_uOff = -1, ch_g_uSize = -1, ch_g_uTex = -1, ch_g_uAlpha = -1;
static float ch_g_aprog = 0.0f;   /* 开关动画进度(中心弹出+淡入) */
static long ch_g_aprogT = 0;
static int ch_g_tw = 0, ch_g_th = 0;
static int ch_g_raster_valid = 0;
static long ch_g_raster_key[7];
static EGLContext ch_g_ctx = 0;
static EGLSurface ch_g_surf = 0;
static long ch_g_surfsw = 0;
static long ch_g_frames = 0;

static const char CH_VS[] =
	"#version 300 es\n"
	"uniform vec2 uRes;\n"
	"uniform vec2 uOff;\n"
	"uniform vec2 uSize;\n"
	"out vec2 vUv;\n"
	"void main(){\n"
	"    vec2 p = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));\n"
	"    vUv = p;\n"
	"    vec2 px = uOff + p * uSize;\n"
	"    gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);\n"
	"}\n";
static const char CH_FS[] =
	"#version 300 es\n"
	"precision mediump float;\n"
	"uniform sampler2D uTex;\n"
	"uniform float uAlpha;\n"
	"in vec2 vUv;\n"
	"out vec4 fragColor;\n"
	"void main(){\n"
	"    vec4 c = texture(uTex, vUv);\n"
	"    fragColor = vec4(c.rgb, c.a * uAlpha);\n"
	"}\n";

static void ch_blend_px(int x, int y, int pw, int ph, uint8_t r, uint8_t g, uint8_t b, int a) {
	if (x < 0 || y < 0 || x >= pw || y >= ph) return;
	uint8_t* p = ch_g_pix + ((size_t)y * pw + x) * 4;
	int ia = 255 - a;
	p[0] = (uint8_t)((r * a + p[0] * ia) / 255);
	p[1] = (uint8_t)((g * a + p[1] * ia) / 255);
	p[2] = (uint8_t)((b * a + p[2] * ia) / 255);
	int na = a + p[3] * ia / 255;
	p[3] = (uint8_t)(na > 255 ? 255 : na);
}

static void ch_rect(int x0, int y0, int x1, int y1, int pw, int ph, uint8_t r, uint8_t g, uint8_t b, int a) {
	for (int y = y0; y <= y1; y++)
		for (int x = x0; x <= x1; x++)
			ch_blend_px(x, y, pw, ph, r, g, b, a);
}

static void ch_rect_outline(int x0, int y0, int x1, int y1, int pw, int ph, uint8_t r, uint8_t g, uint8_t b, int a, int outline) {
	if (outline) ch_rect(x0 - 1, y0 - 1, x1 + 1, y1 + 1, pw, ph, 0, 0, 0, a > 200 ? 220 : a);
	ch_rect(x0, y0, x1, y1, pw, ph, r, g, b, a);
}

static void ch_cross_arms(int cx, int cy, int from, int len, int t, int pw, int ph, uint8_t r, uint8_t g, uint8_t b, int a, int outline) {
	int t2 = t / 2;
	ch_rect_outline(cx + from, cy - t2, cx + from + len - 1, cy - t2 + t - 1, pw, ph, r, g, b, a, outline);
	ch_rect_outline(cx - from - len + 1, cy - t2, cx - from, cy - t2 + t - 1, pw, ph, r, g, b, a, outline);
	ch_rect_outline(cx - t2, cy + from, cx - t2 + t - 1, cy + from + len - 1, pw, ph, r, g, b, a, outline);
	ch_rect_outline(cx - t2, cy - from - len + 1, cx - t2 + t - 1, cy - from, pw, ph, r, g, b, a, outline);
}

static void ch_diag(int x0, int y0, int x1, int y1, int t, int pw, int ph, uint8_t r, uint8_t g, uint8_t b, int a, int outline) {
	int steps = (x1 > x0 ? x1 - x0 : x0 - x1);
	if (steps < 1) steps = 1;
	int t2 = t / 2;
	for (int i = 0; i <= steps; i++) {
		int x = x0 + (x1 - x0) * i / steps;
		int y = y0 + (y1 - y0) * i / steps;
		if (outline) ch_rect(x - t2 - 1, y - t2 - 1, x - t2 + t, y - t2 + t, pw, ph, 0, 0, 0, a > 200 ? 200 : a);
		ch_rect(x - t2, y - t2, x - t2 + t - 1, y - t2 + t - 1, pw, ph, r, g, b, a);
	}
}

static void ch_ring(int cx, int cy, int rad, int t, int pw, int ph, uint8_t r, uint8_t g, uint8_t b, int a, int outline) {
	int rOut = rad + t / 2 + 1;
	for (int y = cy - rOut; y <= cy + rOut; y++) {
		for (int x = cx - rOut; x <= cx + rOut; x++) {
			double dx = (double)(x - cx);
			double dy = (double)(y - cy);
			double d = ih_sqrt(dx * dx + dy * dy);
			double e = ih_fabs(d - (double)rad);
			if (e <= (double)(t / 2) + 0.5) ch_blend_px(x, y, pw, ph, r, g, b, a);
			else if (outline && e <= (double)(t / 2) + 1.5) ch_blend_px(x, y, pw, ph, 0, 0, 0, a > 200 ? 200 : a);
		}
	}
}

static void ch_disc(int cx, int cy, int rad, int pw, int ph, uint8_t r, uint8_t g, uint8_t b, int a, int outline) {
	int rOut = rad + 2;
	for (int y = cy - rOut; y <= cy + rOut; y++) {
		for (int x = cx - rOut; x <= cx + rOut; x++) {
			double dx = (double)(x - cx);
			double dy = (double)(y - cy);
			double d = ih_sqrt(dx * dx + dy * dy);
			if (d <= (double)rad) ch_blend_px(x, y, pw, ph, r, g, b, a);
			else if (outline && d <= (double)rad + 1.5) ch_blend_px(x, y, pw, ph, 0, 0, 0, a > 200 ? 200 : a);
		}
	}
}

static int ch_gl_init(void) {
	if (!pglCreateShader || !pglShaderSource || !pglCompileShader || !pglGetShaderiv
		|| !pglCreateProgram || !pglAttachShader || !pglLinkProgram || !pglGetProgramiv
		|| !pglDeleteShader || !pglGenVertexArrays || !pglGetUniformLocation) {
		ch_set_status("gl sym missing");
		return 0;
	}
	GLint ok = 0;
	const char* src[1];
	GLuint vs = pglCreateShader(GL_VERTEX_SHADER);
	if (!vs) { ch_set_status("vs create fail"); return 0; }
	src[0] = CH_VS;
	pglShaderSource(vs, 1, src, 0);
	pglCompileShader(vs);
	pglGetShaderiv(vs, GL_COMPILE_STATUS, &ok);
	if (!ok) { ch_set_status("vs compile fail"); return 0; }
	GLuint fs = pglCreateShader(GL_FRAGMENT_SHADER);
	if (!fs) { ch_set_status("fs create fail"); pglDeleteShader(vs); return 0; }
	src[0] = CH_FS;
	pglShaderSource(fs, 1, src, 0);
	pglCompileShader(fs);
	pglGetShaderiv(fs, GL_COMPILE_STATUS, &ok);
	if (!ok) { ch_set_status("fs compile fail"); pglDeleteShader(vs); return 0; }
	ch_g_prog = pglCreateProgram();
	if (!ch_g_prog) { pglDeleteShader(vs); pglDeleteShader(fs); ch_set_status("prog create fail"); return 0; }
	pglAttachShader(ch_g_prog, vs);
	pglAttachShader(ch_g_prog, fs);
	pglLinkProgram(ch_g_prog);
	pglGetProgramiv(ch_g_prog, GL_LINK_STATUS, &ok);
	pglDeleteShader(vs);
	pglDeleteShader(fs);
	if (!ok) { ch_set_status("link fail"); return 0; }
	pglGenVertexArrays(1, &ch_g_vao);
	ch_g_uRes = pglGetUniformLocation(ch_g_prog, "uRes");
	ch_g_uOff = pglGetUniformLocation(ch_g_prog, "uOff");
	ch_g_uSize = pglGetUniformLocation(ch_g_prog, "uSize");
	ch_g_uTex = pglGetUniformLocation(ch_g_prog, "uTex");
	ch_g_uAlpha = pglGetUniformLocation(ch_g_prog, "uAlpha");
	ch_set_status("gl ready");
	return 1;
}

static void ch_tex_ensure(int w, int h) {
	if (w == ch_g_tw && h == ch_g_th && ch_g_tex) return;
	if (ch_g_tex) pglDeleteTextures(1, &ch_g_tex);
	pglGenTextures(1, &ch_g_tex);
	pglBindTexture(GL_TEXTURE_2D, ch_g_tex);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	pglTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
	ch_g_tw = w;
	ch_g_th = h;
}

static void ch_render(EGLDisplay dpy, EGLSurface surf) {
	float pr = ks_anim(&ch_g_aprog, &ch_g_aprogT, ch_g_enable);
	if (!ch_g_enable && pr <= 0.0005f) return;
	EGLint w = 0, h = 0;
	if (peglQuerySurface) {
		peglQuerySurface(dpy, surf, EGL_WIDTH, &w);
		peglQuerySurface(dpy, surf, EGL_HEIGHT, &h);
	}
	if (w <= 0 || h <= 0) {
		GLint vp[4] = { 0, 0, 0, 0 };
		if (pglGetIntegerv) pglGetIntegerv(GL_VIEWPORT, vp);
		w = vp[2];
		h = vp[3];
	}
	long area = (long)w * (long)h;
	if (area < 800L * 480L) return;
	if (area > ks_g_maxarea) ks_g_maxarea = area;
	if (ch_g_gl_ready && peglGetCurrentContext) {   /* 后台切回 GL 上下文已重建: 旧 prog/vao/tex 句柄全废, 转首初始化路径 */
		EGLContext cur = peglGetCurrentContext();
		if (cur != ch_g_ctx) {
			ch_g_prog = 0; ch_g_vao = 0; ch_g_tex = 0; ch_g_ctx = 0; ch_g_raster_valid = 0; ch_g_gl_ready = 0;   /* raster_valid=0 强制重画 */
			ks_logf("[ch]", "gl ctx changed, re-init");
		}
	}
	if (!ch_g_gl_ready) {
		if (!peglGetCurrentContext) { ch_g_enable = 0; return; }
		if (ks_g_swaps < 45 || area < ks_g_maxarea) return;
		EGLContext cur = peglGetCurrentContext();
		if (!cur) return;
		if (wpl_pv_ready() && !wpl_ctx_is_game(cur)) return;
		if (!ch_gl_init()) { ch_g_enable = 0; ks_logf("[ch]", "gl_init fail, module disabled"); return; }
		ch_g_ctx = cur;
		ch_g_surf = surf;
		ch_g_gl_ready = 1;
		ks_logf("[ch]", "gl ready surf=%p ctx=%p size=%dx%d swaps=%ld", (void*)surf, (void*)cur, (int)w, (int)h, ks_g_swaps);
	}
	if (peglGetCurrentContext && peglGetCurrentContext() != ch_g_ctx) return;
	if (surf != ch_g_surf) {
		if (ks_g_swaps - ch_g_surfsw > 120) { ch_g_surf = surf; ch_g_raster_valid = 0; ks_logf("[ch]", "surface relock surf=%p", (void*)surf); }
		else return;
	}
	ch_g_surfsw = ks_g_swaps;
	if (!pglGetIntegerv || !pglIsEnabled || !pglViewport || !pglDisable || !pglEnable
		|| !pglActiveTexture || !pglUseProgram || !pglBindVertexArray || !pglUniform2f || !pglUniform1i || !pglDrawArrays
		|| !pglGenTextures || !pglTexImage2D || !pglTexParameteri || !pglDeleteTextures || !pglBindTexture
		|| !pglBlendFunc) return;

	if (ch_g_seen != ch_g_seq) {
		ch_g_atkT = now_sec();
		ch_g_seen = ch_g_seq;
	}

	long preset = ch_g_preset;
	long sz = ch_g_size;
	long th = ch_g_thick;
	long gp = ch_g_gap;
	long dyn = ch_g_dyn & 1;
	long amp = ch_g_amp;
	uint8_t cr = (uint8_t)((ch_g_rgb >> 16) & 0xFF);
	uint8_t cg = (uint8_t)((ch_g_rgb >> 8) & 0xFF);
	uint8_t cb = (uint8_t)(ch_g_rgb & 0xFF);
	int ca = (int)ch_g_alpha;
	if (ca <= 0) return;

	double now = now_sec();
	long spread = 0;
	if ((dyn & 1) && amp > 0) {
		double age = now - ch_g_atkT;
		if (age < 0.0) age = 0.0;
		if (age < 0.28) {
			double k = 1.0 - age / 0.28;
			spread = (long)((double)amp * k * k);
		}
	}
	long halfMax = CH_MAX / 2 - 4;
	long gapEff = gp + spread;
	long lenEff = sz + spread * 6 / 10;
	if (gapEff > halfMax) gapEff = halfMax;
	if (gapEff + lenEff > halfMax) lenEff = halfMax - gapEff;
	if (lenEff < 1) lenEff = 1;

	long rasterKey[7] = { preset, sz, th, gapEff, lenEff, ch_g_rgb, ch_g_alpha };
	int redraw = !ch_g_raster_valid || memcmp(ch_g_raster_key, rasterKey, sizeof(rasterKey)) != 0;
	int outline = 1;
	int cw = CH_MAX, chh = CH_MAX;
	int cx = cw / 2, cy = chh / 2;

	if (redraw) {
		memcpy(ch_g_raster_key, rasterKey, sizeof(rasterKey));
		ch_g_raster_valid = 1;
		memset(ch_g_pix, 0, (size_t)CH_MAX * CH_MAX * 4);
	if (preset == 1) {
		long rad = sz + spread;
		if (rad > halfMax) rad = halfMax;
		ch_ring(cx, cy, (int)rad, (int)th, cw, chh, cr, cg, cb, ca, outline);
	} else if (preset == 2) {
		long rad = th + 1 + spread;
		if (rad < 2) rad = 2;
		if (rad > halfMax) rad = halfMax;
		ch_disc(cx, cy, (int)rad, cw, chh, cr, cg, cb, ca, outline);
	} else if (preset == 3) {
		ch_cross_arms(cx, cy, (int)gapEff, (int)lenEff, (int)th, cw, chh, cr, cg, cb, ca, outline);
		long rad = th + 1 + spread;
		if (rad < 2) rad = 2;
		ch_disc(cx, cy, (int)rad, cw, chh, cr, cg, cb, ca, outline);
	} else if (preset == 4) {
		int d0 = (int)(gapEff + 2);
		int d1 = (int)(gapEff + lenEff);
		ch_diag(cx - d0, cy - d0, cx - d1, cy - d1, (int)th, cw, chh, cr, cg, cb, ca, outline);
		ch_diag(cx + d0, cy - d0, cx + d1, cy - d1, (int)th, cw, chh, cr, cg, cb, ca, outline);
		ch_diag(cx - d0, cy + d0, cx - d1, cy + d1, (int)th, cw, chh, cr, cg, cb, ca, outline);
		ch_diag(cx + d0, cy + d0, cx + d1, cy + d1, (int)th, cw, chh, cr, cg, cb, ca, outline);
	} else {
		ch_cross_arms(cx, cy, (int)gapEff, (int)lenEff, (int)th, cw, chh, cr, cg, cb, ca, outline);
	}
	}

	GLint oldVp[4] = { 0, 0, 0, 0 };
	GLint oldProg = 0, oldVao = 0, oldTex = 0, oldTex0 = 0, oldActive = GL_TEXTURE0;
	GLboolean bBlend = pglIsEnabled(GL_BLEND);
	GLboolean bDepth = pglIsEnabled(GL_DEPTH_TEST);
	GLboolean bCull = pglIsEnabled(GL_CULL_FACE);
	GLboolean bSciss = pglIsEnabled(GL_SCISSOR_TEST);
	pglGetIntegerv(GL_VIEWPORT, oldVp);
	pglGetIntegerv(GL_CURRENT_PROGRAM, &oldProg);
	pglGetIntegerv(GL_VERTEX_ARRAY_BINDING, &oldVao);
	pglGetIntegerv(GL_ACTIVE_TEXTURE, &oldActive);
	pglGetIntegerv(GL_TEXTURE_BINDING_2D, &oldTex);
	pglActiveTexture(GL_TEXTURE0);
	pglGetIntegerv(GL_TEXTURE_BINDING_2D, &oldTex0);

	pglBindTexture(GL_TEXTURE_2D, 0);
	ch_tex_ensure(cw, chh);
	pglBindTexture(GL_TEXTURE_2D, ch_g_tex);
	if (redraw) pglTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, cw, chh, 0, GL_RGBA, GL_UNSIGNED_BYTE, ch_g_pix);

	pglViewport(0, 0, w, h);
	pglDisable(GL_DEPTH_TEST);
	pglDisable(GL_CULL_FACE);
	pglDisable(GL_SCISSOR_TEST);
	pglEnable(GL_BLEND);
	pglBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
	pglUseProgram(ch_g_prog);
	pglBindVertexArray(ch_g_vao);
	pglUniform2f(ch_g_uRes, (GLfloat)w, (GLfloat)h);
	{
		float e = pr * pr * (3.0f - 2.0f * pr);
		float k = 0.55f + 0.45f * e;
		pglUniform1f(ch_g_uAlpha, e);
		pglUniform2f(ch_g_uOff, (GLfloat)(w / 2) - (GLfloat)cw * k / 2.0f + (GLfloat)ch_g_offx, (GLfloat)(h / 2) - (GLfloat)chh * k / 2.0f + (GLfloat)ch_g_offy);
		pglUniform2f(ch_g_uSize, (GLfloat)cw * k, (GLfloat)chh * k);
	}
	pglUniform1i(ch_g_uTex, 0);
	pglDrawArrays(GL_TRIANGLE_STRIP, 0, 4);

	pglBindTexture(GL_TEXTURE_2D, (GLuint)oldTex0);
	pglActiveTexture((GLenum)oldActive);
	pglBindTexture(GL_TEXTURE_2D, (GLuint)oldTex);
	pglBindVertexArray((GLuint)oldVao);
	pglUseProgram((GLuint)oldProg);
	pglViewport(oldVp[0], oldVp[1], oldVp[2], oldVp[3]);
	if (!bBlend) pglDisable(GL_BLEND);
	if (bDepth) pglEnable(GL_DEPTH_TEST);
	if (bCull) pglEnable(GL_CULL_FACE);
	if (bSciss) pglEnable(GL_SCISSOR_TEST);

	ch_g_frames++;
}

static long chud_enable(long v) {
	ch_g_enable = (v == 1) ? 1 : 0;
	return ch_g_enable;
}

static long chud_off(void) {
	ch_g_enable = 0;
	ch_g_seq = 0;
	ch_g_seen = 0;
	return 0;
}

static long chud_preset(long v) {
	if (v < 0) v = 0;
	if (v > 4) v = 4;
	ch_g_preset = v;
	return ch_g_preset;
}

static long chud_size(long v) {
	if (v < 4) v = 4;
	if (v > 80) v = 80;
	ch_g_size = v;
	return ch_g_size;
}

static long chud_thick(long v) {
	if (v < 1) v = 1;
	if (v > 12) v = 12;
	ch_g_thick = v;
	return ch_g_thick;
}

static long chud_gap(long v) {
	if (v < 0) v = 0;
	if (v > 40) v = 40;
	ch_g_gap = v;
	return ch_g_gap;
}

static long chud_rgb(long v) {
	v &= 0xFFFFFF;   /* 桥侧 v 按 24 位带符号解包: >=0x800000 的色值(R>=0x80)会到负, 按位与即 mod 2^24 还原 */
	ch_g_rgb = v;
	return ch_g_rgb;
}

static long chud_alpha(long v) {
	if (v < 0) v = 0;
	if (v > 100) v = 100;
	ch_g_alpha = v * 255 / 100;
	return ch_g_alpha;
}

static long chud_dyn(long v) {
	if (v < 0) v = 0;
	if (v > 1) v = 1;
	ch_g_dyn = v;
	return ch_g_dyn;
}

static long chud_amp(long v) {
	if (v < 2) v = 2;
	if (v > 40) v = 40;
	ch_g_amp = v;
	return ch_g_amp;
}

static long ch_clamp_off(long v) {
	if (v < -100) v = -100;
	if (v > 100) v = 100;
	return v;
}

static long chud_offx(long v) {
	ch_g_offx = ch_clamp_off(v);
	return ch_g_offx;
}

static long chud_offy(long v) {
	ch_g_offy = ch_clamp_off(v);
	return ch_g_offy;
}

static long chud_pulse(long t) {
	(void)t;
	ch_g_seq++;
	return ch_g_seq;
}

static long chud_frames(void) { return ch_g_frames; }

static int ch_active(void) { return ch_g_enable != 0 || ch_g_aprog > 0.0005f; }
static void ch_disable(void) { ch_g_enable = 0; }

/* ===== 2D雷达模块 ===== */
static void rd_set_status(const char* s) { ks_set_status(7, s); }

#define RD_PW 300
#define RD_HALF 150
#define RD_DOT_LIM 144
#define RD_MAXE 64

static unsigned char rd_g_inbuf[1 + RD_MAXE * 5];
static long __radar_in(void) { return (long)rd_g_inbuf; }

static uint8_t rd_g_pix[RD_PW * RD_PW * 4];
static float rd_g_dots[RD_MAXE * 3];

static volatile int rd_g_enable = 0;
static volatile long rd_g_xpct = 65;
static volatile long rd_g_ypct = 16;
static volatile long rd_g_yaw_q = 0;
static volatile long rd_g_count = 0;
static int rd_g_vbo_dirty = 0;

static int rd_g_gl_ready = 0;
static GLuint rd_g_prog = 0, rd_g_prog_sweep = 0, rd_g_prog_dot = 0;
static GLuint rd_g_vao = 0, rd_g_vao_dot = 0, rd_g_vbo = 0, rd_g_tex = 0;
static GLint rd_g_uRes = -1, rd_g_uOff = -1, rd_g_uSize = -1, rd_g_uTex = -1;
static GLint rd_g_swRes = -1, rd_g_swOff = -1, rd_g_swSize = -1, rd_g_swDeg = -1;
static GLint rd_g_dtRes = -1, rd_g_dtCenter = -1, rd_g_dtYaw = -1;
static int rd_g_tw = 0, rd_g_th = 0;
static int rd_g_attr = 0;
static EGLContext rd_g_ctx = 0;
static EGLSurface rd_g_surf = 0;
static long rd_g_surfsw = 0;
static long rd_g_frames = 0;
static float rd_g_deg = 0.0f;
static float rd_g_aprog = 0.0f;   /* 开关动画进度(断电闪烁) */
static long rd_g_aprogT = 0;
static GLint rd_g_uAlpha0 = -1, rd_g_swAlpha = -1, rd_g_dtAlpha = -1;
static GLuint rd_g_prog_let = 0, rd_g_lettertex = 0;
static GLint rd_g_ltRes = -1, rd_g_ltCenter = -1, rd_g_ltYaw = -1, rd_g_ltDir = -1, rd_g_ltIdx = -1, rd_g_ltTex = -1, rd_g_ltAlpha = -1;

static const char RD_VS[] =
	"#version 300 es\n"
	"uniform vec2 uRes;\n"
	"uniform vec2 uOff;\n"
	"uniform float uSize;\n"
	"out vec2 vUv;\n"
	"void main(){\n"
	"    vec2 p = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));\n"
	"    vUv = p;\n"
	"    vec2 px = uOff + p * uSize;\n"
	"    gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);\n"
	"}\n";
static const char RD_FS[] =
	"#version 300 es\n"
	"precision highp float;\n"
	"uniform sampler2D uTex;\n"
	"uniform float uAlpha;\n"
	"in vec2 vUv;\n"
	"out vec4 fragColor;\n"
	"void main(){\n"
	"    vec4 c = texture(uTex, vUv);\n"
	"    fragColor = vec4(c.rgb, c.a * uAlpha);\n"
	"}\n";
static const char RD_SWEEP_FS[] =
	"#version 300 es\n"
	"precision highp float;\n"
	"uniform vec2 uRes;\n"
	"uniform vec2 uOff;\n"
	"uniform float uSize;\n"
	"uniform float uDeg;\n"
	"uniform float uAlpha;\n"
	"in vec2 vUv;\n"
	"out vec4 fragColor;\n"
	"void main(){\n"
	"    vec2 rel = (uOff + vUv * uSize) - (uOff + uSize * 0.5);\n"
	"    float rr = uSize * 0.5;\n"
	"    if (dot(rel, rel) > rr * rr) discard;\n"
	"    float ang = degrees(atan(rel.y, rel.x));\n"
	"    float trail = mod(uDeg - ang + 720.0, 360.0);\n"
	"    float a = (1.0 - trail / 70.0) * 0.38;\n"
	"    if (a <= 0.0) discard;\n"
	"    fragColor = vec4(0.176, 0.721, 0.388, a * uAlpha);\n"
	"}\n";
static const char RD_DOT_VS[] =
	"#version 300 es\n"
	"uniform vec2 uRes;\n"
	"uniform vec2 uCenter;\n"
	"uniform float uYaw;\n"
	"uniform float uAlpha;\n"
	"in vec3 aData;\n"
	"out vec4 vColor;\n"
	"void main(){\n"
	"    float c = cos(uYaw), s = sin(uYaw);\n"
	"    vec2 rp = vec2(aData.x * c - aData.y * s, aData.x * s + aData.y * c);\n"
	"    float L = length(rp);\n"
	"    if (L > 144.0) rp *= 144.0 / L;\n"
	"    vec2 px = uCenter + rp;\n"
	"    gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);\n"
	"    gl_PointSize = 7.0;\n"
	"    vColor = (aData.z < 0.5) ? vec4(1.0, 0.15, 0.15, 1.0) : vec4(0.2, 1.0, 0.35, 1.0);\n"
	"    vColor.a *= uAlpha;\n"
	"}\n";
static const char RD_DOT_FS[] =
	"#version 300 es\n"
	"precision highp float;\n"
	"in vec4 vColor;\n"
	"out vec4 fragColor;\n"
	"void main(){\n"
	"    vec2 d = gl_PointCoord - 0.5;\n"
	"    if (dot(d, d) > 0.25) discard;\n"
	"    fragColor = vColor;\n"
	"}\n";
/* 方位字(动态东南西北): 环形排布随视角旋转。图集横向 [北 东 南 西], 顶点着色器内做同款 yaw 旋转,
   方向向量直接取世界四正方向(北=-z 东=+x 南=+z 西=-x), 与目标点共用一套旋转约定 */
static const char RD_LET_VS[] =
	"#version 300 es\n"
	"uniform vec2 uRes;\n"
	"uniform vec2 uCenter;\n"
	"uniform float uYaw;\n"
	"uniform vec2 uDir;\n"
	"uniform float uIdx;\n"
	"out vec2 vUv;\n"
	"void main(){\n"
	"    vec2 p = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));\n"
	"    float c = cos(uYaw), s = sin(uYaw);\n"
	"    vec2 rp = vec2(uDir.x * c - uDir.y * s, uDir.x * s + uDir.y * c) * 126.0;\n"
	"    vec2 px = uCenter + rp + (p - 0.5) * 26.0;\n"
	"    vUv = vec2((uIdx + p.x) * 0.25, p.y);\n"
	"    gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);\n"
	"}\n";

static void rd_px(int x, int y, uint8_t r, uint8_t g, uint8_t b, int a) {
	if (x < 0 || y < 0 || x >= RD_PW || y >= RD_PW) return;
	uint8_t* p = rd_g_pix + ((size_t)y * RD_PW + x) * 4;
	int ia = 255 - a;
	p[0] = (uint8_t)((r * a + p[0] * ia) / 255);
	p[1] = (uint8_t)((g * a + p[1] * ia) / 255);
	p[2] = (uint8_t)((b * a + p[2] * ia) / 255);
	int na = a + p[3] * ia / 255;
	p[3] = (uint8_t)(na > 255 ? 255 : na);
}

static void rd_fill_round(int x0, int y0, int x1, int y1, int rad, uint8_t r, uint8_t g, uint8_t b, int a) {
	for (int y = y0; y <= y1; y++) {
		for (int x = x0; x <= x1; x++) {
			int dx = 0, dy = 0;
			if (x < x0 + rad) dx = x0 + rad - x; else if (x > x1 - rad) dx = x - (x1 - rad);
			if (y < y0 + rad) dy = y0 + rad - y; else if (y > y1 - rad) dy = y - (y1 - rad);
			if (dx && dy && dx * dx + dy * dy > rad * rad) continue;
			rd_px(x, y, r, g, b, a);
		}
	}
}

static void rd_ringo(int cx, int cy, int rad, uint8_t r, uint8_t g, uint8_t b, int a) {
	int r2 = rad * rad;
	for (int y = cy - rad - 1; y <= cy + rad + 1; y++) {
		for (int x = cx - rad - 1; x <= cx + rad + 1; x++) {
			int dx = x - cx, dy = y - cy;
			int d2 = dx * dx + dy * dy - r2;
			if (d2 < 0) d2 = -d2;
			if (d2 <= 2 * rad) rd_px(x, y, r, g, b, a);
		}
	}
}

static void rd_dot_px(int px, int py, uint8_t r, uint8_t g, uint8_t b) {
	for (int y = py - 1; y <= py + 1; y++)
		for (int x = px - 1; x <= px + 1; x++)
			rd_px(x, y, r, g, b, 255);
}

static void rd_raster(void) {
	memset(rd_g_pix, 0, sizeof(rd_g_pix));
	int c = RD_PW / 2;
	rd_fill_round(0, 0, RD_PW - 1, RD_PW - 1, 40, 13, 17, 23, 205);
	rd_ringo(c, c, RD_HALF / 3, 255, 255, 255, 30);
	rd_ringo(c, c, RD_HALF * 2 / 3, 255, 255, 255, 30);
	rd_ringo(c, c, RD_HALF, 255, 255, 255, 56);
	for (int i = -RD_HALF; i <= RD_HALF; i++) {
		rd_px(c + i, c, 255, 255, 255, 22);
		rd_px(c, c + i, 255, 255, 255, 22);
	}
	for (int y = c - RD_HALF; y <= c - RD_HALF + 4; y++) rd_px(c, y, 255, 255, 255, 110);   /* 前向刻度: 面板正上=面朝方向 */
	for (int dy = 0; dy <= 9; dy++) {   /* 中心朝向箭头: 固定指上, 实体点随视角绕其旋转 */
		int hw = dy * 4 / 9;
		for (int x = c - hw; x <= c + hw; x++) rd_px(x, c - 6 + dy, 255, 255, 255, 255);
	}
}

static int rd_compile(GLuint* prog, int pid, const char* vs_src, const char* fs_src, GLint* u1, const char* n1, GLint* u2, const char* n2, GLint* u3, const char* n3, GLint* u4, const char* n4) {
	GLint ok = 0;
	char lb[160];
	GLint ln = 0;
	const char* src[1];
	GLuint vs = pglCreateShader(GL_VERTEX_SHADER);
	if (!vs) { ks_logf("[rd]", "compile fail pid=%d stage=1", pid); rd_set_status("vs create fail"); return 0; }
	src[0] = vs_src;
	pglShaderSource(vs, 1, src, 0);
	pglCompileShader(vs);
	pglGetShaderiv(vs, GL_COMPILE_STATUS, &ok);
	if (!ok) {
		lb[0] = 0; if (pglGetShaderInfoLog) { pglGetShaderInfoLog(vs, 150, &ln, lb); lb[ln > 0 && ln < 160 ? ln : 0] = 0; }
		ks_logf("[rd]", "cfail pid=%d st=2: %s", pid, lb);
		rd_set_status("vs compile fail");
		pglDeleteShader(vs);
		return 0;
	}
	GLuint fs = pglCreateShader(GL_FRAGMENT_SHADER);
	if (!fs) { ks_logf("[rd]", "compile fail pid=%d stage=3", pid); rd_set_status("fs create fail"); pglDeleteShader(vs); return 0; }
	src[0] = fs_src;
	pglShaderSource(fs, 1, src, 0);
	pglCompileShader(fs);
	pglGetShaderiv(fs, GL_COMPILE_STATUS, &ok);
	if (!ok) {
		lb[0] = 0; ln = 0; if (pglGetShaderInfoLog) { pglGetShaderInfoLog(fs, 150, &ln, lb); lb[ln > 0 && ln < 160 ? ln : 0] = 0; }
		ks_logf("[rd]", "cfail pid=%d st=4: %s", pid, lb);
		rd_set_status("fs compile fail");
		pglDeleteShader(vs);
		pglDeleteShader(fs);
		return 0;
	}
	*prog = pglCreateProgram();
	if (!*prog) { ks_logf("[rd]", "compile fail pid=%d stage=5", pid); pglDeleteShader(vs); pglDeleteShader(fs); rd_set_status("prog create fail"); return 0; }
	pglAttachShader(*prog, vs);
	pglAttachShader(*prog, fs);
	pglLinkProgram(*prog);
	pglGetProgramiv(*prog, GL_LINK_STATUS, &ok);
	pglDeleteShader(vs);
	pglDeleteShader(fs);
	if (!ok) {
		lb[0] = 0; ln = 0; if (pglGetProgramInfoLog) { pglGetProgramInfoLog(*prog, 150, &ln, lb); lb[ln > 0 && ln < 160 ? ln : 0] = 0; }
		ks_logf("[rd]", "cfail pid=%d st=6: %s", pid, lb);
		rd_set_status("link fail");
		return 0;
	}
	if (u1) *u1 = pglGetUniformLocation(*prog, n1);
	if (u2) *u2 = pglGetUniformLocation(*prog, n2);
	if (u3) *u3 = pglGetUniformLocation(*prog, n3);
	if (u4) *u4 = pglGetUniformLocation(*prog, n4);
	return 1;
}

static int rd_gl_init(void) {
	if (!pglCreateShader || !pglShaderSource || !pglCompileShader || !pglGetShaderiv
		|| !pglCreateProgram || !pglAttachShader || !pglLinkProgram || !pglGetProgramiv
		|| !pglDeleteShader || !pglGenVertexArrays || !pglGetUniformLocation
		|| !pglGenBuffers || !pglBindBuffer || !pglBufferData || !pglVertexAttribPointer || !pglEnableVertexAttribArray || !pglGetAttribLocation) {
		ks_logf("[rd]", "sym miss genbuf=%p bindbuf=%p bufdata=%p vap=%p eva=%p gal=%p",
			(void*)pglGenBuffers, (void*)pglBindBuffer, (void*)pglBufferData, (void*)pglVertexAttribPointer, (void*)pglEnableVertexAttribArray, (void*)pglGetAttribLocation);
		rd_set_status("gl sym missing");
		return 0;
	}
	if (!rd_compile(&rd_g_prog, 0, RD_VS, RD_FS, &rd_g_uRes, "uRes", &rd_g_uOff, "uOff", &rd_g_uSize, "uSize", &rd_g_uTex, "uTex")) return 0;
	if (!rd_compile(&rd_g_prog_sweep, 1, RD_VS, RD_SWEEP_FS, &rd_g_swRes, "uRes", &rd_g_swOff, "uOff", &rd_g_swSize, "uSize", &rd_g_swDeg, "uDeg")) return 0;
	if (!rd_compile(&rd_g_prog_dot, 2, RD_DOT_VS, RD_DOT_FS, &rd_g_dtRes, "uRes", &rd_g_dtCenter, "uCenter", &rd_g_dtYaw, "uYaw", 0, 0)) return 0;
	if (!rd_compile(&rd_g_prog_let, 3, RD_LET_VS, RD_FS, &rd_g_ltRes, "uRes", &rd_g_ltCenter, "uCenter", &rd_g_ltYaw, "uYaw", &rd_g_ltDir, "uDir")) return 0;
	rd_g_ltIdx = pglGetUniformLocation(rd_g_prog_let, "uIdx");
	rd_g_ltTex = pglGetUniformLocation(rd_g_prog_let, "uTex");
	rd_g_ltAlpha = pglGetUniformLocation(rd_g_prog_let, "uAlpha");
	rd_g_uAlpha0 = pglGetUniformLocation(rd_g_prog, "uAlpha");
	rd_g_swAlpha = pglGetUniformLocation(rd_g_prog_sweep, "uAlpha");
	rd_g_dtAlpha = pglGetUniformLocation(rd_g_prog_dot, "uAlpha");
	rd_g_attr = pglGetAttribLocation(rd_g_prog_dot, "aData");
	if (rd_g_attr < 0) { ks_logf("[rd]", "attrib aData missing"); rd_set_status("attrib missing"); return 0; }
	pglGenVertexArrays(1, &rd_g_vao);
	pglGenVertexArrays(1, &rd_g_vao_dot);
	pglGenBuffers(1, &rd_g_vbo);
	pglBindVertexArray(rd_g_vao_dot);
	pglBindBuffer(GL_ARRAY_BUFFER, rd_g_vbo);
	pglBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(RD_MAXE * 3 * 4), 0, GL_STATIC_DRAW);
	pglEnableVertexAttribArray((GLuint)rd_g_attr);
	pglVertexAttribPointer((GLuint)rd_g_attr, 3, GL_FLOAT, 0, 12, 0);
	pglBindVertexArray(0);
	pglBindBuffer(GL_ARRAY_BUFFER, 0);
	rd_set_status("gl ready");
	return 1;
}

static void rd_tex_ensure(int w, int h) {
	if (w == rd_g_tw && h == rd_g_th && rd_g_tex) return;
	if (rd_g_tex) pglDeleteTextures(1, &rd_g_tex);
	pglGenTextures(1, &rd_g_tex);
	pglBindTexture(GL_TEXTURE_2D, rd_g_tex);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	pglTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, rd_g_pix);
	rd_g_tw = w;
	rd_g_th = h;
}

static void rd_gl_reset(void) {
	rd_g_prog = 0; rd_g_prog_sweep = 0; rd_g_prog_dot = 0; rd_g_prog_let = 0;
	rd_g_vao = 0; rd_g_vao_dot = 0; rd_g_vbo = 0; rd_g_tex = 0; rd_g_lettertex = 0;
	rd_g_tw = 0; rd_g_th = 0; rd_g_ctx = 0; rd_g_attr = 0; rd_g_gl_ready = 0;
}

/* 方位字图集: 复用 ih 共享字体光栅 北东南西 四字形(白字+alpha), 只建一次 */
#define RD_LET_PX 22
#define RD_LET_CELL 32
static uint8_t rd_g_letterpix[RD_LET_CELL * 4 * RD_LET_CELL * 4];

static void rd_letter_ensure(void) {
	if (rd_g_lettertex) return;
	if (!ih_g_font_ok) {
		if (ih_g_font_tried) return;
		if (!load_sysfont()) return;
	}
	static const int RD_LET_CP[4] = { 0x5317, 0x4E1C, 0x5357, 0x897F };   /* 北东南西 */
	memset(rd_g_letterpix, 0, sizeof(rd_g_letterpix));
	float sc = stbtt_ScaleForPixelHeight(&ih_g_font, (float)RD_LET_PX);
	for (int i = 0; i < 4; i++) {
		int bx0 = 0, by0 = 0, bx1 = 0, by1 = 0;
		stbtt_GetCodepointBitmapBox(&ih_g_font, RD_LET_CP[i], sc, sc, &bx0, &by0, &bx1, &by1);
		int bw = bx1 - bx0, bh = by1 - by0;
		if (bw <= 0 || bh <= 0 || bw >= RD_LET_CELL || bh >= RD_LET_CELL) continue;
		unsigned char* bits = (unsigned char*)malloc((size_t)bw * (size_t)bh);
		if (!bits) continue;
		stbtt_MakeCodepointBitmap(&ih_g_font, bits, bw, bh, bw, sc, sc, RD_LET_CP[i]);
		int ox = i * RD_LET_CELL + (RD_LET_CELL - bw) / 2;
		int oy = (RD_LET_CELL - bh) / 2;
		for (int y = 0; y < bh; y++)
			for (int x = 0; x < bw; x++) {
				uint8_t* p = rd_g_letterpix + ((size_t)(oy + y) * (RD_LET_CELL * 4) + (size_t)(ox + x)) * 4;
				p[0] = 255; p[1] = 255; p[2] = 255;
				p[3] = bits[y * bw + x];
			}
		free(bits);
	}
	pglGenTextures(1, &rd_g_lettertex);
	pglBindTexture(GL_TEXTURE_2D, rd_g_lettertex);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	pglTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, RD_LET_CELL * 4, RD_LET_CELL, 0, GL_RGBA, GL_UNSIGNED_BYTE, rd_g_letterpix);
}

static void rd_render(EGLDisplay dpy, EGLSurface surf) {
	float pr = ks_anim(&rd_g_aprog, &rd_g_aprogT, rd_g_enable);
	if (!rd_g_enable && pr <= 0.0005f) return;
	float rdA = pr * pr * (3.0f - 2.0f * pr);
	if (pr < 1.0f) {   /* 断电闪烁: 动画途中按段爆闪, 开=闪稳 关=闪灭 */
		int seg = (int)(pr * 7.0f);
		if (seg & 1) rdA *= 0.22f;
	}
	EGLint w = 0, h = 0;
	if (peglQuerySurface) {
		peglQuerySurface(dpy, surf, EGL_WIDTH, &w);
		peglQuerySurface(dpy, surf, EGL_HEIGHT, &h);
	}
	if (w <= 0 || h <= 0) {
		GLint vp[4] = { 0, 0, 0, 0 };
		if (pglGetIntegerv) pglGetIntegerv(GL_VIEWPORT, vp);
		w = vp[2];
		h = vp[3];
	}
	long area = (long)w * (long)h;
	if (area < 800L * 480L) return;
	if (area > ks_g_maxarea) ks_g_maxarea = area;
	if (rd_g_gl_ready && peglGetCurrentContext) {   /* 后台切回 GL 上下文重建: 句柄全废, 转首初始化路径 */
		EGLContext cur = peglGetCurrentContext();
		if (cur != rd_g_ctx) {
			rd_gl_reset();
			ks_logf("[rd]", "gl ctx changed, re-init");
		}
	}
	if (!rd_g_gl_ready) {
		if (!peglGetCurrentContext) { rd_g_enable = 0; return; }
		if (ks_g_swaps < 45 || area < ks_g_maxarea) return;
		EGLContext cur = peglGetCurrentContext();
		if (!cur) return;
		if (wpl_pv_ready() && !wpl_ctx_is_game(cur)) return;
		rd_raster();
		if (!rd_gl_init()) { rd_g_enable = 0; ks_logf("[rd]", "gl_init fail, module disabled"); return; }
		rd_g_ctx = cur;
		rd_g_surf = surf;
		rd_g_vbo_dirty = 1;
		rd_g_gl_ready = 1;
		ks_logf("[rd]", "gl ready surf=%p ctx=%p size=%dx%d swaps=%ld", (void*)surf, (void*)cur, (int)w, (int)h, ks_g_swaps);
	}
	if (peglGetCurrentContext && peglGetCurrentContext() != rd_g_ctx) return;
	if (surf != rd_g_surf) {
		if (ks_g_swaps - rd_g_surfsw > 120) { rd_g_surf = surf; ks_logf("[rd]", "surface relock surf=%p", (void*)surf); }
		else return;
	}
	rd_g_surfsw = ks_g_swaps;
	if (!pglGetIntegerv || !pglIsEnabled || !pglViewport || !pglDisable || !pglEnable
		|| !pglActiveTexture || !pglUseProgram || !pglBindVertexArray || !pglUniform2f || !pglUniform1i || !pglUniform1f || !pglDrawArrays
		|| !pglGenTextures || !pglTexImage2D || !pglTexParameteri || !pglDeleteTextures || !pglBindTexture
		|| !pglBlendFunc || !pglBlendFuncSeparate) return;

	GLint oldVp[4] = { 0, 0, 0, 0 };
	GLint oldProg = 0, oldVao = 0, oldTex = 0, oldTex0 = 0, oldActive = GL_TEXTURE0, oldVbo = 0;
	GLint oldBS = 0, oldBD = 0, oldBSA = 0, oldBDA = 0;
	GLboolean bBlend = pglIsEnabled(GL_BLEND);
	GLboolean bDepth = pglIsEnabled(GL_DEPTH_TEST);
	GLboolean bCull = pglIsEnabled(GL_CULL_FACE);
	GLboolean bSciss = pglIsEnabled(GL_SCISSOR_TEST);
	pglGetIntegerv(GL_VIEWPORT, oldVp);
	pglGetIntegerv(GL_CURRENT_PROGRAM, &oldProg);
	pglGetIntegerv(GL_VERTEX_ARRAY_BINDING, &oldVao);
	pglGetIntegerv(GL_ACTIVE_TEXTURE, &oldActive);
	pglGetIntegerv(GL_TEXTURE_BINDING_2D, &oldTex);
	pglGetIntegerv(GL_BLEND_SRC_RGB, &oldBS);
	pglGetIntegerv(GL_BLEND_DST_RGB, &oldBD);
	pglGetIntegerv(GL_BLEND_SRC_ALPHA, &oldBSA);
	pglGetIntegerv(GL_BLEND_DST_ALPHA, &oldBDA);
	pglGetIntegerv(GL_ARRAY_BUFFER_BINDING, &oldVbo);
	pglActiveTexture(GL_TEXTURE0);
	pglGetIntegerv(GL_TEXTURE_BINDING_2D, &oldTex0);

	float px = (float)(w * rd_g_xpct) / 100.0f;
	float py = (float)(h * rd_g_ypct) / 100.0f;

	pglViewport(0, 0, w, h);
	pglDisable(GL_DEPTH_TEST);
	pglDisable(GL_CULL_FACE);
	pglDisable(GL_SCISSOR_TEST);
	pglEnable(GL_BLEND);
	pglBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

	/* 1 面板 */
	pglActiveTexture(GL_TEXTURE0);
	pglBindTexture(GL_TEXTURE_2D, 0);
	rd_tex_ensure(RD_PW, RD_PW);
	pglBindTexture(GL_TEXTURE_2D, rd_g_tex);
	pglUseProgram(rd_g_prog);
	pglBindVertexArray(rd_g_vao);
	pglUniform2f(rd_g_uRes, (GLfloat)w, (GLfloat)h);
	pglUniform2f(rd_g_uOff, px, py);
	pglUniform1f(rd_g_uSize, (GLfloat)RD_PW);
	pglUniform1i(rd_g_uTex, 0);
	if (rd_g_uAlpha0 >= 0) pglUniform1f(rd_g_uAlpha0, rdA);
	pglDrawArrays(GL_TRIANGLE_STRIP, 0, 4);

	/* 2 扫描光 */
	rd_g_deg += 1.0f;
	if (rd_g_deg >= 360.0f) rd_g_deg -= 360.0f;
	pglUseProgram(rd_g_prog_sweep);
	pglUniform2f(rd_g_swRes, (GLfloat)w, (GLfloat)h);
	pglUniform2f(rd_g_swOff, px, py);
	pglUniform1f(rd_g_swSize, (GLfloat)RD_PW);
	pglUniform1f(rd_g_swDeg, rd_g_deg);
	if (rd_g_swAlpha >= 0) pglUniform1f(rd_g_swAlpha, rdA);
	pglDrawArrays(GL_TRIANGLE_STRIP, 0, 4);

	float rdTheta = (float)((double)rd_g_yaw_q / 64.0 * 0.017453292519943295);   /* 设备实测: yaw 0=北且向西递增(90=西), 取 θ=+yaw; 取反时误差=2倍已转角——正南/正北碰巧全对, 东/西朝向实体前后颠倒 */

	/* 3 目标点 */
	if (rd_g_count > 0) {
		if (rd_g_vbo_dirty) {
			rd_g_vbo_dirty = 0;
			pglBindBuffer(GL_ARRAY_BUFFER, rd_g_vbo);
			pglBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(rd_g_count * 3 * 4), rd_g_dots, GL_STATIC_DRAW);
		}
		pglUseProgram(rd_g_prog_dot);
		pglBindVertexArray(rd_g_vao_dot);
		pglUniform2f(rd_g_dtRes, (GLfloat)w, (GLfloat)h);
		pglUniform2f(rd_g_dtCenter, px + RD_PW * 0.5f, py + RD_PW * 0.5f);
		pglUniform1f(rd_g_dtYaw, rdTheta);
		if (rd_g_dtAlpha >= 0) pglUniform1f(rd_g_dtAlpha, rdA);
		pglDrawArrays(GL_POINTS, 0, (GLsizei)rd_g_count);
	}

	/* 4 方位字(东南西北随视角绕环旋转) */
	rd_letter_ensure();
	if (rd_g_lettertex) {
		static const float RD_DIRS[4][2] = { { 0.0f, -1.0f }, { 1.0f, 0.0f }, { 0.0f, 1.0f }, { -1.0f, 0.0f } };   /* 北东南西 */
		pglBindTexture(GL_TEXTURE_2D, rd_g_lettertex);
		pglUseProgram(rd_g_prog_let);
		pglBindVertexArray(rd_g_vao);
		pglUniform2f(rd_g_ltRes, (GLfloat)w, (GLfloat)h);
		pglUniform2f(rd_g_ltCenter, px + RD_PW * 0.5f, py + RD_PW * 0.5f);
		if (rd_g_ltYaw >= 0) pglUniform1f(rd_g_ltYaw, rdTheta);
		if (rd_g_ltTex >= 0) pglUniform1i(rd_g_ltTex, 0);
		if (rd_g_ltAlpha >= 0) pglUniform1f(rd_g_ltAlpha, rdA);
		for (int i = 0; i < 4; i++) {
			pglUniform2f(rd_g_ltDir, RD_DIRS[i][0], RD_DIRS[i][1]);
			pglUniform1f(rd_g_ltIdx, (GLfloat)i);
			pglDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
		}
	}

	pglBindVertexArray((GLuint)oldVao);
	pglBindBuffer(GL_ARRAY_BUFFER, (GLuint)oldVbo);
	pglBindTexture(GL_TEXTURE_2D, (GLuint)oldTex0);
	pglActiveTexture((GLenum)oldActive);
	pglBindTexture(GL_TEXTURE_2D, (GLuint)oldTex);
	pglUseProgram((GLuint)oldProg);
	pglViewport(oldVp[0], oldVp[1], oldVp[2], oldVp[3]);
	pglBlendFuncSeparate((GLenum)oldBS, (GLenum)oldBD, (GLenum)oldBSA, (GLenum)oldBDA);
	if (bBlend) pglEnable(GL_BLEND); else pglDisable(GL_BLEND);
	if (bDepth) pglEnable(GL_DEPTH_TEST);
	if (bCull) pglEnable(GL_CULL_FACE);
	if (bSciss) pglEnable(GL_SCISSOR_TEST);

	rd_g_frames++;
}

static long rd_enable(long v) {
	rd_g_enable = (v == 1) ? 1 : 0;
	if (!rd_g_enable) { rd_g_count = 0; rd_g_vbo_dirty = 0; }
	return (long)__radar_in();
}

static long rd_pos(long v) {
	rd_g_xpct = (v & 0xFF);
	rd_g_ypct = ((v >> 8) & 0xFF);
	return v;
}

static long rd_yaw(long v) {
	if (v < 0) v = 0;
	if (v > 23040) v = 23040;
	rd_g_yaw_q = v;
	return v;
}

static long rd_commit(long v) {
	long n = rd_g_inbuf[0];
	(void)v;
	if (n > RD_MAXE) n = RD_MAXE;
	for (long i = 0; i < n; i++) {
		const unsigned char* e = rd_g_inbuf + 1 + i * 5;
		long qx = (long)(e[0] | (e[1] << 8));
		if (qx >= 32768) qx -= 65536;
		long qz = (long)(e[2] | (e[3] << 8));
		if (qz >= 32768) qz -= 65536;
		rd_g_dots[i * 3] = (float)qx * 0.25f;
		rd_g_dots[i * 3 + 1] = (float)qz * 0.25f;
		rd_g_dots[i * 3 + 2] = (float)e[4];
	}
	rd_g_count = n;
	rd_g_vbo_dirty = 1;
	return n;
}

static long rd_frames(void) { return rd_g_frames; }

static int rd_active(void) { return rd_g_enable != 0 || rd_g_aprog > 0.0005f; }
static void rd_disable(void) { rd_g_enable = 0; }

/* ===== 动态水印模块 ===== */
static void wm_set_status(const char* s) { ks_set_status(4, s); }
static volatile int wm_g_enable = 0;
static int wm_g_gl_ready = 0;
static GLuint wm_g_prog = 0, wm_g_vao = 0, wm_g_tex = 0;
static GLint wm_g_uRes = -1, wm_g_uOff = -1, wm_g_uSize = -1, wm_g_uTex = -1, wm_g_uAlpha = -1;
static float wm_g_aprog = 0.0f;
static long wm_g_aprogT = 0;
static int wm_g_tw = 0, wm_g_th = 0;
static int wm_g_tex_dirty = 1;
static EGLContext wm_g_ctx = 0;
static EGLSurface wm_g_surf = 0;
static long wm_g_surfsw = 0;
static long wm_g_frames = 0;
static double wm_g_lastT = 0.0;

#define WMMAXW 512
#define WMMAXH 384
static uint8_t wm_g_pix[WMMAXW * WMMAXH * 4];

static float wm_g_x1 = 0.0f, wm_g_y1 = 0.0f, wm_g_vx1 = 0.0f, wm_g_vy1 = 0.0f;
static float wm_g_x2 = 0.0f, wm_g_y2 = 0.0f, wm_g_vx2 = 0.0f, wm_g_vy2 = 0.0f;
static int wm_g_pos_init = 0;

static void wm_blend_px(int x, int y, int pw, int ph, uint8_t r, uint8_t g, uint8_t b, int a) {
	if (x < 0 || y < 0 || x >= pw || y >= ph) return;
	uint8_t* p = wm_g_pix + ((size_t)y * pw + x) * 4;
	int ia = 255 - a;
	p[0] = (uint8_t)((r * a + p[0] * ia) / 255);
	p[1] = (uint8_t)((g * a + p[1] * ia) / 255);
	p[2] = (uint8_t)((b * a + p[2] * ia) / 255);
	int na = a + p[3] * ia / 255;
	p[3] = (uint8_t)(na > 255 ? 255 : na);
}

static float wm_text_w(const char* s, float scale) {
	float w = 0.0f;
	int i = 0;
	while (s[i]) {
		int cp = utf8_next(s, &i);
		if (stbtt_FindGlyphIndex(&ih_g_font, cp) == 0) cp = '?';
		int adv = 0, lsb = 0;
		stbtt_GetCodepointHMetrics(&ih_g_font, cp, &adv, &lsb);
		w += adv * scale + 1.0f;
	}
	return w;
}

static void wm_draw_text(const char* s, float x, float baseline, int pw, int ph, uint8_t r, uint8_t g, uint8_t b, int a255, float scale) {
	int i = 0;
	while (s[i]) {
		int cp = utf8_next(s, &i);
		if (stbtt_FindGlyphIndex(&ih_g_font, cp) == 0) cp = '?';
		int adv = 0, lsb = 0;
		stbtt_GetCodepointHMetrics(&ih_g_font, cp, &adv, &lsb);
		int bx0 = 0, by0 = 0, bx1 = 0, by1 = 0;
		stbtt_GetCodepointBitmapBox(&ih_g_font, cp, scale, scale, &bx0, &by0, &bx1, &by1);
		int bw = bx1 - bx0, bh = by1 - by0;
		if (bw > 0 && bh > 0 && bw < 128 && bh < 128) {
			unsigned char* bits = (unsigned char*)malloc((size_t)bw * (size_t)bh);
			if (bits) {
				stbtt_MakeCodepointBitmap(&ih_g_font, bits, bw, bh, bw, scale, scale, cp);
				for (int py = 0; py < bh; py++) {
					for (int px = 0; px < bw; px++) {
						int al = (bits[py * bw + px] * a255) / 255;
						if (al > 3) wm_blend_px((int)x + bx0 + px, (int)baseline + by0 + py, pw, ph, r, g, b, al);
					}
				}
				free(bits);
			}
		}
		x += adv * scale + 1.0f;
		if ((int)x >= pw) return;
	}
}

static int wm_gl_init(void) {
	if (!pglCreateShader || !pglShaderSource || !pglCompileShader || !pglGetShaderiv
		|| !pglCreateProgram || !pglAttachShader || !pglLinkProgram || !pglGetProgramiv
		|| !pglDeleteShader || !pglGenVertexArrays || !pglGetUniformLocation) {
		wm_set_status("gl sym missing");
		return 0;
	}
	GLint ok = 0;
	const char* src[1];
	GLuint vs = pglCreateShader(GL_VERTEX_SHADER);
	if (!vs) { wm_set_status("vs create fail"); return 0; }
	src[0] = IH_VS;
	pglShaderSource(vs, 1, src, 0);
	pglCompileShader(vs);
	pglGetShaderiv(vs, GL_COMPILE_STATUS, &ok);
	if (!ok) { wm_set_status("vs compile fail"); return 0; }
	GLuint fs = pglCreateShader(GL_FRAGMENT_SHADER);
	if (!fs) { wm_set_status("fs create fail"); pglDeleteShader(vs); return 0; }
	src[0] = IH_FS;
	pglShaderSource(fs, 1, src, 0);
	pglCompileShader(fs);
	pglGetShaderiv(fs, GL_COMPILE_STATUS, &ok);
	if (!ok) { wm_set_status("fs compile fail"); pglDeleteShader(vs); return 0; }
	wm_g_prog = pglCreateProgram();
	if (!wm_g_prog) { pglDeleteShader(vs); pglDeleteShader(fs); wm_set_status("prog create fail"); return 0; }
	pglAttachShader(wm_g_prog, vs);
	pglAttachShader(wm_g_prog, fs);
	pglLinkProgram(wm_g_prog);
	pglGetProgramiv(wm_g_prog, GL_LINK_STATUS, &ok);
	pglDeleteShader(vs);
	pglDeleteShader(fs);
	if (!ok) { wm_set_status("link fail"); return 0; }
	pglGenVertexArrays(1, &wm_g_vao);
	wm_g_uRes = pglGetUniformLocation(wm_g_prog, "uRes");
	wm_g_uOff = pglGetUniformLocation(wm_g_prog, "uOff");
	wm_g_uSize = pglGetUniformLocation(wm_g_prog, "uSize");
	wm_g_uTex = pglGetUniformLocation(wm_g_prog, "uTex");
	wm_g_uAlpha = pglGetUniformLocation(wm_g_prog, "uAlpha");
	wm_set_status("gl ready");
	return 1;
}

static void wm_tex_ensure(int w, int h) {
	if (w == wm_g_tw && h == wm_g_th && wm_g_tex) return;
	if (wm_g_tex) pglDeleteTextures(1, &wm_g_tex);
	pglGenTextures(1, &wm_g_tex);
	pglBindTexture(GL_TEXTURE_2D, wm_g_tex);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	pglTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
	wm_g_tw = w;
	wm_g_th = h;
	wm_g_tex_dirty = 1;
}

static void wm_bounce(float* px, float* py, float* pvx, float* pvy, float dt, int w, int h, int bw, int bh) {
	*px += *pvx * dt;
	*py += *pvy * dt;
	float mx = (float)(w - bw);
	float my = (float)(h - bh);
	if (mx < 0.0f) mx = 0.0f;
	if (my < 0.0f) my = 0.0f;
	if (*px < 0.0f) { *px = 0.0f; *pvx = -*pvx; }
	else if (*px > mx) { *px = mx; *pvx = -*pvx; }
	if (*py < 0.0f) { *py = 0.0f; *pvy = -*pvy; }
	else if (*py > my) { *py = my; *pvy = -*pvy; }
}

static void wm_render(EGLDisplay dpy, EGLSurface surf) {
	float pr = ks_anim(&wm_g_aprog, &wm_g_aprogT, wm_g_enable);
	if (!wm_g_enable && pr <= 0.0005f) return;
	EGLint w = 0, h = 0;
	if (peglQuerySurface) {
		peglQuerySurface(dpy, surf, EGL_WIDTH, &w);
		peglQuerySurface(dpy, surf, EGL_HEIGHT, &h);
	}
	if (w <= 0 || h <= 0) {
		GLint vp[4] = { 0, 0, 0, 0 };
		if (pglGetIntegerv) pglGetIntegerv(GL_VIEWPORT, vp);
		w = vp[2];
		h = vp[3];
	}
	long area = (long)w * (long)h;
	if (area < 800L * 480L) return;
	if (area > ks_g_maxarea) ks_g_maxarea = area;
	if (!ih_g_font_ok) {
		if (ih_g_font_tried && (wm_g_frames & 63) != 0) return;
		if (!load_sysfont()) return;
	}
	if (wm_g_gl_ready && peglGetCurrentContext) {   /* 后台切回 GL 上下文已重建: 旧 prog/vao/tex 句柄全废, 转首初始化路径 */
		EGLContext cur = peglGetCurrentContext();
		if (cur != wm_g_ctx) {
			wm_g_prog = 0; wm_g_vao = 0; wm_g_tex = 0; wm_g_ctx = 0; wm_g_tex_dirty = 1; wm_g_gl_ready = 0;
			ks_logf("[wm]", "gl ctx changed, re-init");
		}
	}
	if (!wm_g_gl_ready) {
		if (!peglGetCurrentContext) { wm_g_enable = 0; return; }
		if (ks_g_swaps < 45 || area < ks_g_maxarea) return;
		EGLContext cur = peglGetCurrentContext();
		if (!cur) return;
		if (wpl_pv_ready() && !wpl_ctx_is_game(cur)) return;
		if (!wm_gl_init()) { wm_g_enable = 0; ks_logf("[wm]", "gl_init fail, module disabled"); return; }
		wm_g_ctx = cur;
		wm_g_surf = surf;
		wm_g_gl_ready = 1;
		ks_logf("[wm]", "gl ready surf=%p ctx=%p size=%dx%d swaps=%ld", (void*)surf, (void*)cur, (int)w, (int)h, ks_g_swaps);
	}
	if (peglGetCurrentContext && peglGetCurrentContext() != wm_g_ctx) return;
	if (surf != wm_g_surf) {
		if (ks_g_swaps - wm_g_surfsw > 120) { wm_g_surf = surf; wm_g_tex_dirty = 1; ks_logf("[wm]", "surface relock surf=%p", (void*)surf); }
		else return;
	}
	wm_g_surfsw = ks_g_swaps;
	if (!pglGetIntegerv || !pglIsEnabled || !pglViewport || !pglDisable || !pglEnable
		|| !pglActiveTexture || !pglUseProgram || !pglBindVertexArray || !pglUniform2f || !pglUniform1i || !pglDrawArrays
		|| !pglGenTextures || !pglTexImage2D || !pglTexParameteri || !pglDeleteTextures || !pglBindTexture
		|| !pglBlendFunc) return;

	double t = now_sec();
	double dt = t - wm_g_lastT;
	wm_g_lastT = t;
	if (dt <= 0.0 || dt > 0.5) dt = 0.016;

	int fontPx = h / 10;
	if (fontPx < 72) fontPx = 72;
	if (fontPx > 160) fontPx = 160;
	float scale = stbtt_ScaleForPixelHeight(&ih_g_font, (float)fontPx);
	int fa = 0, fd = 0, flg = 0;
	stbtt_GetFontVMetrics(&ih_g_font, &fa, &fd, &flg);
	float fasc = fa * scale, fdesc = fd * scale;
	int lineH = (int)(fasc - fdesc) + 4;

	const char* l1 = "RunAway";
	const char* l2 = "\xe4\xb8\x8d\xe5\x94\xae\xe5\x8d\x96";
	float w1 = wm_text_w(l1, scale);
	float w2 = wm_text_w(l2, scale);
	float mw = w1 > w2 ? w1 : w2;
	int pad = 6;
	int boxW = (int)(mw + 0.5f) + pad * 2;
	int boxH = lineH * 2 + pad;
	if (boxW > WMMAXW || boxH > WMMAXH) return;

	if (boxW != wm_g_tw || boxH != wm_g_th) {
		memset(wm_g_pix, 0, (size_t)boxW * boxH * 4);
		float base1 = (float)pad + fasc;
		float base2 = base1 + lineH;
		float tx1 = ((float)boxW - w1) / 2.0f;
		float tx2 = ((float)boxW - w2) / 2.0f;
		wm_draw_text(l1, tx1, base1, boxW, boxH, 255, 255, 255, 141, scale);
		wm_draw_text(l1, tx1 + 1.0f, base1, boxW, boxH, 255, 255, 255, 141, scale);
		wm_draw_text(l2, tx2, base2, boxW, boxH, 255, 255, 255, 141, scale);
		wm_draw_text(l2, tx2 + 1.0f, base2, boxW, boxH, 255, 255, 255, 141, scale);
		wm_g_tex_dirty = 1;
	}

	if (!wm_g_pos_init) {
		wm_g_x1 = (float)w * 0.15f;
		wm_g_y1 = (float)h * 0.15f;
		wm_g_vx1 = 240.0f;
		wm_g_vy1 = 240.0f;
		wm_g_x2 = (float)w * 0.60f;
		wm_g_y2 = (float)h * 0.65f;
		wm_g_vx2 = -240.0f;
		wm_g_vy2 = -240.0f;
		wm_g_pos_init = 1;
	}
	wm_bounce(&wm_g_x1, &wm_g_y1, &wm_g_vx1, &wm_g_vy1, (float)dt, w, h, boxW, boxH);
	wm_bounce(&wm_g_x2, &wm_g_y2, &wm_g_vx2, &wm_g_vy2, (float)dt, w, h, boxW, boxH);

	GLint oldVp[4] = { 0, 0, 0, 0 };
	GLint oldProg = 0, oldVao = 0, oldTex = 0, oldTex0 = 0, oldActive = GL_TEXTURE0;
	GLboolean bBlend = pglIsEnabled(GL_BLEND);
	GLboolean bDepth = pglIsEnabled(GL_DEPTH_TEST);
	GLboolean bCull = pglIsEnabled(GL_CULL_FACE);
	GLboolean bSciss = pglIsEnabled(GL_SCISSOR_TEST);
	pglGetIntegerv(GL_VIEWPORT, oldVp);
	pglGetIntegerv(GL_CURRENT_PROGRAM, &oldProg);
	pglGetIntegerv(GL_VERTEX_ARRAY_BINDING, &oldVao);
	pglGetIntegerv(GL_ACTIVE_TEXTURE, &oldActive);
	pglGetIntegerv(GL_TEXTURE_BINDING_2D, &oldTex);
	pglActiveTexture(GL_TEXTURE0);
	pglGetIntegerv(GL_TEXTURE_BINDING_2D, &oldTex0);

	pglBindTexture(GL_TEXTURE_2D, 0);
	wm_tex_ensure(boxW, boxH);
	pglBindTexture(GL_TEXTURE_2D, wm_g_tex);
	if (wm_g_tex_dirty) {
		pglTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, boxW, boxH, 0, GL_RGBA, GL_UNSIGNED_BYTE, wm_g_pix);
		wm_g_tex_dirty = 0;
	}

	pglViewport(0, 0, w, h);
	pglDisable(GL_DEPTH_TEST);
	pglDisable(GL_CULL_FACE);
	pglDisable(GL_SCISSOR_TEST);
	pglEnable(GL_BLEND);
	pglBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
	pglUseProgram(wm_g_prog);
	pglBindVertexArray(wm_g_vao);
	pglUniform2f(wm_g_uRes, (GLfloat)w, (GLfloat)h);
	pglUniform2f(wm_g_uSize, (GLfloat)boxW, (GLfloat)boxH);
	pglUniform1i(wm_g_uTex, 0);
	pglUniform1f(wm_g_uAlpha, pr * pr * (3.0f - 2.0f * pr));
	pglUniform2f(wm_g_uOff, wm_g_x1, wm_g_y1);
	pglDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
	pglUniform2f(wm_g_uOff, wm_g_x2, wm_g_y2);
	pglDrawArrays(GL_TRIANGLE_STRIP, 0, 4);

	pglBindTexture(GL_TEXTURE_2D, (GLuint)oldTex0);
	pglActiveTexture((GLenum)oldActive);
	pglBindTexture(GL_TEXTURE_2D, (GLuint)oldTex);
	pglBindVertexArray((GLuint)oldVao);
	pglUseProgram((GLuint)oldProg);
	pglViewport(oldVp[0], oldVp[1], oldVp[2], oldVp[3]);
	if (!bBlend) pglDisable(GL_BLEND);
	if (bDepth) pglEnable(GL_DEPTH_TEST);
	if (bCull) pglEnable(GL_CULL_FACE);
	if (bSciss) pglEnable(GL_SCISSOR_TEST);

	wm_g_frames++;
}

static long wmhud_enable(long v) {
	wm_g_enable = (v == 1) ? 1 : 0;
	if (!wm_g_enable) wm_g_pos_init = 0;
	return wm_g_enable;
}

static long wmhud_off(void) {
	wm_g_enable = 0;
	wm_g_pos_init = 0;
	return 0;
}

static long wmhud_frames(void) { return wm_g_frames; }

static int wm_active(void) { return wm_g_enable != 0 || wm_g_aprog > 0.0005f; }
static void wm_disable(void) { wm_g_enable = 0; wm_g_pos_init = 0; }

/* ===== 世界面板模块 ===== */
static void wpl_set_status(const char* s) { ks_set_status(6, s); }
static void wpl_status_num(const char* pre, long v) { ks_status_num(6, pre, v); }

static volatile int wpl_g_enable = 0;
static volatile int g_wpl_show = 0;
static int g_wpl_target[3];
static float g_wpl_cam[3];

#ifndef DT_HASH
#define DT_HASH 4
#endif
#ifndef DT_GNU_HASH
#define DT_GNU_HASH 0x6ffffef5
#endif
#ifndef PROT_EXEC
#define PROT_EXEC 4
#endif
#ifndef MAP_PRIVATE
#define MAP_PRIVATE 2
#endif
#ifndef MAP_ANONYMOUS
#define MAP_ANONYMOUS 0x20
#endif
extern void* mmap(void*, size_t, int, int, int, long);

static float wpl_g_pv[16];
static long wpl_g_pv_frame = -1;

#define WPL_GL_STENCIL_TEST 0x0B90
#define WPL_GL_COLOR_WRITEMASK 0x0C23
#define WPL_GL_FRAMEBUFFER 0x8D40
#define WPL_GL_FRAMEBUFFER_BINDING 0x8CA6
#define WPL_GL_DEPTH_FUNC 0x0B74
#define WPL_GL_DEPTH_WRITEMASK 0x0B72

static int wpl_g_hook_state = 0;
static int wpl_g_logged_surf = 0;
static int wpl_g_pvmiss_logged = 0;
static EGLSurface wpl_g_surf = 0;
static EGLContext wpl_g_gamectx = 0;
static long wpl_g_surfsw = 0;

static int wpl_pv_ready(void) { return wpl_g_hook_state == 1; }

/* v32: 游戏 GL 上下文由 mesh 钩(相机校验通过处)登记进 ks_game_ctx; 旧的捕获钩上下文追踪已随驱动钩拆除 */
static int wpl_ctx_is_game(void* ctx) {
	if (!ctx || !ks_game_ctx) return 0;
	if (ctx != ks_game_ctx) return 0;
	return (ks_now_ms() - ks_game_ctx_ms) < 1000;
}

static void (*wpl_pglGetBooleanv)(GLenum, GLboolean*);
static void (*wpl_pglDepthMask)(GLboolean);
static void (*wpl_pglDepthFunc)(GLenum);
static void (*wpl_pglColorMask)(GLboolean, GLboolean, GLboolean, GLboolean);
static void (*wpl_pglBindFramebuffer)(GLenum, GLuint);

static void wpl_hooks_install(void) {
	if (wpl_g_hook_state == 1) return;
	KS_LKS(n_libegl, "libEGL.so");
	KS_LKS(n_libgl, "libGLESv2.so");
	void* hEGL = dlopen(n_libegl, 2);
	void* hGL = dlopen(n_libgl, 2);
	if (!hEGL || !hGL) { wpl_set_status("egl/gl dlopen fail,retry"); return; }
	KS_LKS(n_gpa, "eglGetProcAddress");
	void* (*pGPA)(const char*) = (void* (*)(const char*))dlsym(hEGL, n_gpa);
	void* h = hGL;
#define WRA(field, name) do { field = (void*)dlsym(h, name); if (!field && pGPA) field = (void*)pGPA(name); } while (0)
	WRA(wpl_pglGetBooleanv, "glGetBooleanv");
	WRA(wpl_pglDepthMask, "glDepthMask");
	WRA(wpl_pglDepthFunc, "glDepthFunc");
	WRA(wpl_pglColorMask, "glColorMask");
	WRA(wpl_pglBindFramebuffer, "glBindFramebuffer");
#undef WRA
	wpl_g_hook_state = 1;
	ks_logf("[wpl]", "pv install ok (v32 世界矩阵直读, 不钩驱动 uniform)");
}

/* v32: PV 矩阵改由 ks_world_mvp 直读(游戏内 Camera 栈, 探针实证配方);
   替代驱动层 glUniformMatrix4fv 捕获(4 候选符号+GOT 兜底的设备兼容包袱已卸) */
static void wpl_pv_pick(int w, int h) {
	(void)w; (void)h;
	if (ks_world_mvp(wpl_g_pv)) wpl_g_pv_frame = ks_g_swaps;
}

static long wpl_g_drew_n = 0;
static int g_wpl_target[3] = {0, -999, 0};
static float g_wpl_cam[3] = {0, 0, 0};
static float g_wpl_cam_prv[3] = {0, 0, 0};
static long g_wpl_cam_ts = 0, g_wpl_cam_pts = 0;
static int g_wpl_gl = 0;
static GLuint g_wpl_prog = 0, g_wpl_tex = 0, g_wpl_vao = 0;
static GLint g_wpl_ures = -1, g_wpl_uoff = -1, g_wpl_usize = -1, g_wpl_utex = -1, g_wpl_uvmax = -1, g_wpl_ualpha = -1;
static float wpl_g_aprog = 0.0f;   /* 开关动画进度(淡入淡出) */
static long wpl_g_aprogT = 0;
static float g_wpl_ax = 0.0f, g_wpl_ay = 0.0f;
static float g_wpl_bh = 60.0f;

#define WPL_PW 500
#define WPL_PH 320
#define WPL_GM 40
#define WPL_TW (WPL_PW + WPL_GM * 2)
#define WPL_TH (WPL_PH + WPL_GM * 2)
static unsigned char g_wpl_base[WPL_TW * WPL_TH * 4];
static unsigned char g_wpl_up[WPL_TW * WPL_TH * 4];
static unsigned char g_wpl_glow_a[WPL_TW * WPL_TH];   /* 辉光 alpha 形状缓存: 只随面板几何变, 帧脉冲仅换色 */
static int g_wpl_glow_a_ok = 0;
static short g_wpl_span0[WPL_TH], g_wpl_span1[WPL_TH];   /* 每行 alpha>0 的 x 区间(空行 x0>x1) */

#define WPL_MAXLINE 14
#define WPL_LINESZ 512
static char g_wpl_lines[WPL_MAXLINE][WPL_LINESZ];
static int g_wpl_lines_ok = 0;
/* 默认面板行(直存);渲染/同步入口各兜一次 */
static void wpl_lines_ensure(void) {
	if (g_wpl_lines_ok) return;
	KS_LKS(blob, "/say KuSug\0方块类型:脉冲\0条件:无条件\0红石:红石控制\0延迟:0\0");
	const char* p = blob;
	for (int i = 0; i < 5 && *p; i++) {
		int n = 0;
		while (p[n] && n < WPL_LINESZ - 1) { g_wpl_lines[i][n] = p[n]; n++; }
		g_wpl_lines[i][n] = 0;
		p += n + 1;
	}
	g_wpl_lines_ok = 1;
}
static volatile int g_wpl_dirty = 1;
static char g_wpl_inbuf[8200];
static long g_wpl_glow_ts = 0;

static long wpl_now_ms(void) {
	long ts[2] = {0, 0};
	clock_gettime(1, ts);
	return ts[0] * 1000L + ts[1] / 1000000L;
}

static unsigned char* wpl_g_ttf = 0;
static stbtt_fontinfo wpl_g_font;
static int wpl_g_font_ok = 0, wpl_g_font_tried = 0;
static float wpl_g_scale = 0.0f, wpl_g_ascent = 0.0f;
#define WPL_GCHASH 256
typedef struct { int cp; int w, h, x0, y0; float adv; unsigned char* bits; } wgc_t;
static wgc_t wpl_g_gc[WPL_GCHASH];

static int wpl_try_font(const char* path) {
	FILE* f = fopen(path, "rb");
	if (!f) return 0;
	fseek(f, 0, 2);
	long sz = ftell(f);
	fseek(f, 0, 0);
	if (sz <= 0 || sz > 90000000L) { fclose(f); return 0; }
	unsigned char* buf = (unsigned char*)malloc((size_t)sz);
	if (!buf) { fclose(f); return 0; }
	if (fread(buf, 1, (size_t)sz, f) != (size_t)sz) { free(buf); fclose(f); return 0; }
	fclose(f);
	int chosen = -1;
	stbtt_fontinfo fi;
	for (int idx = 0; idx < 8; idx++) {
		int off = stbtt_GetFontOffsetForIndex(buf, idx);
		if (off < 0) break;
		stbtt_fontinfo tf;
		if (!stbtt_InitFont(&tf, buf, off)) continue;
		chosen = idx; fi = tf;
		if (stbtt_FindGlyphIndex(&tf, 0x82F9) != 0) break;
	}
	if (chosen < 0 || stbtt_FindGlyphIndex(&fi, 0x82F9) == 0) { free(buf); return 0; }
	if (wpl_g_ttf) free(wpl_g_ttf);
	wpl_g_ttf = buf;
	wpl_g_font = fi;
	wpl_g_font_ok = 1;
	return 1;
}

static int wpl_load_font(void) {
	if (wpl_g_font_tried) return wpl_g_font_ok;
	wpl_g_font_tried = 1;
	char fp[192];
	ks_res_path(fp, sizeof(fp), "kusug/so/font.ttf");
	if (wpl_try_font(fp)) {
		int asc = 0, desc = 0, lg = 0;
		wpl_g_scale = stbtt_ScaleForPixelHeight(&wpl_g_font, 18.0f);
		stbtt_GetFontVMetrics(&wpl_g_font, &asc, &desc, &lg);
		wpl_g_ascent = (float)asc * wpl_g_scale;
		return 1;
	}
	wpl_set_status("font missing");
	return 0;
}

static void wgc_fill(wgc_t* g, int cp) {
	int x0 = 0, y0 = 0, x1 = 0, y1 = 0, adv = 0, lsb = 0;
	if (!wpl_g_font_ok) {   /* 字体未加载(pv 未就绪时 gl_init 不会跑): 置空 glyph, 防 stbtt 空指针 */
		g->cp = cp; g->w = 0; g->h = 0; g->x0 = 0; g->y0 = 0; g->adv = 0.0f;
		if (g->bits) { free(g->bits); g->bits = 0; }
		return;
	}
	if (stbtt_FindGlyphIndex(&wpl_g_font, cp) == 0) cp = '?';
	stbtt_GetCodepointBitmapBox(&wpl_g_font, cp, wpl_g_scale, wpl_g_scale, &x0, &y0, &x1, &y1);
	stbtt_GetCodepointHMetrics(&wpl_g_font, cp, &adv, &lsb);
	g->cp = cp;
	g->w = x1 - x0; g->h = y1 - y0; g->x0 = x0; g->y0 = y0;
	g->adv = (float)adv * wpl_g_scale;
	if (g->bits) { free(g->bits); g->bits = 0; }
	if (g->w > 0 && g->h > 0 && g->w < 128 && g->h < 128) {
		g->bits = (unsigned char*)malloc((size_t)g->w * (size_t)g->h);
		if (g->bits) stbtt_MakeCodepointBitmap(&wpl_g_font, g->bits, g->w, g->h, g->w, wpl_g_scale, wpl_g_scale, cp);
	}
}

static wgc_t* wgc_get(int cp) {
	int i = (int)(((unsigned)cp * 2654435761u) & (WPL_GCHASH - 1));
	for (int n = 0; n < WPL_GCHASH; n++) {
		int s = (i + n) & (WPL_GCHASH - 1);
		if (wpl_g_gc[s].cp == 0) { wgc_fill(&wpl_g_gc[s], cp); return &wpl_g_gc[s]; }
		if (wpl_g_gc[s].cp == cp) return &wpl_g_gc[s];
	}
	wgc_fill(&wpl_g_gc[i], cp);
	return &wpl_g_gc[i];
}

static int wpl_u8(const char* s, int* i) {
	int b1 = (unsigned char)s[(*i)++];
	if (b1 < 0x80) return b1;
	if (b1 < 0xE0) return ((b1 & 0x1F) << 6) | ((unsigned char)s[(*i)++] & 0x3F);
	if (b1 < 0xF0) return ((b1 & 0x0F) << 12) | (((unsigned char)s[(*i)++] & 0x3F) << 6) | ((unsigned char)s[(*i)++] & 0x3F);
	(*i) += 3;
	return '?';
}

static void wpl_blend(int x, int y, int r, int g, int b, int a) {
	if (x < 0 || y < 0 || x >= WPL_TW || y >= WPL_TH || a <= 0) return;
	if (a > 255) a = 255;
	unsigned char* p = g_wpl_base + ((long)y * WPL_TW + x) * 4;
	int ia = 255 - a;
	p[0] = (unsigned char)((r * a + p[0] * ia) / 255);
	p[1] = (unsigned char)((g * a + p[1] * ia) / 255);
	p[2] = (unsigned char)((b * a + p[2] * ia) / 255);
	int na = a + p[3] * ia / 255;
	p[3] = (unsigned char)(na > 255 ? 255 : na);
}

static float wpl_rr_d(float px, float py, float x, float y, float w, float h, float r) {
	float qx = px - (x + w * 0.5f); if (qx < 0) qx = -qx;
	float qy = py - (y + h * 0.5f); if (qy < 0) qy = -qy;
	qx -= (w * 0.5f - r); qy -= (h * 0.5f - r);
	float ox = qx > 0 ? qx : 0.0f, oy = qy > 0 ? qy : 0.0f;
	float mx = qx > qy ? qx : qy; if (mx > 0) mx = 0.0f;
	return __builtin_sqrtf(ox * ox + oy * oy) + mx - r;
}

static void wpl_rr(float x, float y, float w, float h, float r, int cr, int cg, int cb, int ca) {
	int j0 = (int)y - 1, j1 = (int)(y + h) + 1, i0 = (int)x - 1, i1 = (int)(x + w) + 1;
	for (int j = j0; j <= j1; j++) {
		for (int i = i0; i <= i1; i++) {
			float d = wpl_rr_d((float)i + 0.5f, (float)j + 0.5f, x, y, w, h, r);
			float a = 0.5f - d;
			if (a <= 0.0f) continue;
			if (a > 1.0f) a = 1.0f;
			wpl_blend(i, j, cr, cg, cb, (int)(ca * a));
		}
	}
}

static void wpl_text(float x, float y, const char* s) {
	int i = 0;
	float cx = x;
	while (s[i]) {
		int cp = wpl_u8(s, &i);
		wgc_t* g = wgc_get(cp);
		if (g->bits) {
			int bx = (int)(cx + (float)g->x0), by = (int)(y + (float)g->y0);
			for (int j = 0; j < g->h; j++) {
				for (int k = 0; k < g->w; k++) {
					int a = g->bits[j * g->w + k];
					if (a) wpl_blend(bx + k, by + j, 255, 255, 255, a);
				}
			}
		}
		cx += g->adv;
	}
}

static int wpl_wrap(const char* s, float maxw, char out[][WPL_LINESZ], int maxl) {
	int n = 0, i = 0, oi = 0;
	float cx = 0.0f;
	while (s[i] && n < maxl) {
		int save = i;
		int cp = wpl_u8(s, &i);
		float adv = wgc_get(cp)->adv;
		if (cx + adv > maxw && oi > 0) {
			out[n][oi] = 0;
			n++; oi = 0; cx = 0.0f;
			if (n >= maxl) break;
		}
		for (int k = save; k < i && oi < WPL_LINESZ - 1; k++) out[n][oi++] = s[k];
		cx += adv;
	}
	if (n < maxl) { out[n][oi] = 0; n++; }
	if (s[i] && n > 0) {
		int L = (int)strlen(out[n - 1]);
		if (L < WPL_LINESZ - 4) memcpy(out[n - 1] + L, "...", 4);
	}
	return n;
}

static int g_wpl_ph = WPL_PH;
static int g_wpl_dbg_nameh = 0, g_wpl_dbg_boxh = 0, g_wpl_dbg_infon = 0;

static int wpl_is_title(int i) {
	return g_wpl_lines[i][0] == 'n' && g_wpl_lines[i][1] == ':';
}

static void wpl_layout(void) {
	int nameH = 0;
	for (int i = 1; i < WPL_MAXLINE; i++) if (wpl_is_title(i)) { nameH = 26; break; }
	char wl[4][WPL_LINESZ];
	int n = wpl_wrap(g_wpl_lines[0], (float)(WPL_PW - 50), wl, 4);
	if (n < 1) n = 1;
	int boxH = n * 22 + 16;
	int infoN = 0;
	for (int i = 1; i < WPL_MAXLINE; i++) if (g_wpl_lines[i][0] && !wpl_is_title(i)) infoN++;
	int infoH = infoN ? ((infoN + 1) / 2) * 25 + 8 : 0;
	g_wpl_ph = 15 + nameH + boxH + infoH + 14;
	g_wpl_dbg_nameh = nameH; g_wpl_dbg_boxh = boxH; g_wpl_dbg_infon = infoN;
}

static void wpl_build_base(void) {
	memset(g_wpl_base, 0, sizeof(g_wpl_base));
	g_wpl_glow_a_ok = 0;   /* 面板几何变了: 辉光形状缓存作废(下次脉冲重建一次) */
	wpl_rr((float)WPL_GM, (float)WPL_GM, (float)WPL_PW, (float)g_wpl_ph, 40.0f, 0, 0, 0, 0x80);
	if (wpl_g_font_ok) {
		int nameH = 0;
		int titleIdx = -1;
		for (int i = 1; i < WPL_MAXLINE; i++) if (wpl_is_title(i)) { titleIdx = i; break; }
		if (titleIdx >= 0) nameH = 26;
		float bx = (float)(WPL_GM + 25);
		if (titleIdx >= 0) wpl_text(bx, (float)(WPL_GM + 15) + wpl_g_ascent, g_wpl_lines[titleIdx] + 2);
		char wl[4][WPL_LINESZ];
		int n = wpl_wrap(g_wpl_lines[0], (float)(WPL_PW - 50), wl, 4);
		if (n < 1) n = 1;
		int boxH = n * 22 + 16;
		float boxY = (float)(WPL_GM + 15 + nameH);
		wpl_rr((float)(WPL_GM + 15), boxY, (float)(WPL_PW - 30), (float)boxH, 20.0f, 255, 255, 255, 0x1A);
		for (int j = 0; j < 14; j++) {
			int half = 14 - j;
			int yy = WPL_GM + g_wpl_ph - 2 + j;
			for (int i = -half; i <= half; i++) wpl_blend(WPL_TW / 2 + i, yy, 0, 0, 0, 0x80);
		}
		float by = boxY + 8.0f + wpl_g_ascent;
		for (int i = 0; i < n; i++) { wpl_text(bx, by, wl[i]); by += 22.0f; }
		float ly = boxY + (float)boxH + 8.0f + wpl_g_ascent;
		float col2 = bx + (float)(WPL_PW - 50) * 0.5f;
		int shown = 0;
		for (int i = 1; i < WPL_MAXLINE; i++) {
			if (!g_wpl_lines[i][0] || wpl_is_title(i)) continue;
			wpl_text(shown % 2 ? col2 : bx, ly, g_wpl_lines[i]);
			if (shown % 2) ly += 25.0f;
			shown++;
		}
	} else {
		for (int j = 0; j < 14; j++) {
			int half = 14 - j;
			int yy = WPL_GM + g_wpl_ph - 2 + j;
			for (int i = -half; i <= half; i++) wpl_blend(WPL_TW / 2 + i, yy, 0, 0, 0, 0x80);
		}
	}
}

static void wpl_chroma(int count, long ms, unsigned char* rgb) {
	int angle = (int)((ms / 18 + count) % 360);
	if (angle >= 180) angle = 360 - angle;
	angle *= 2;
	float t = (float)angle / 360.0f;
	rgb[0] = (unsigned char)(231.0f + (147.0f - 231.0f) * t);
	rgb[1] = (unsigned char)(169.0f + (185.0f - 169.0f) * t);
	rgb[2] = 255;
}

static void wpl_blur3a(void) {   /* 单通道 13 taps×3 趟滑窗模糊: 一次性, 只在面板几何变化时跑 */
	static unsigned char tmp[WPL_TW * WPL_TH];
	for (int pass = 0; pass < 3; pass++) {
		for (int y = 0; y < WPL_TH; y++) {
			int s = 0;
			unsigned char* row = g_wpl_glow_a + (long)y * WPL_TW;
			unsigned char* out = tmp + (long)y * WPL_TW;
			for (int x = -7; x < WPL_TW; x++) {
				int xa = x + 6; if (xa >= WPL_TW) xa = WPL_TW - 1; if (xa < 0) xa = 0;
				s += row[xa];
				int xr = x - 7;
				if (xr >= 0) s -= row[xr];
				if (x >= 0) out[x] = (unsigned char)(s / 13);
			}
		}
		for (int x = 0; x < WPL_TW; x++) {
			int s = 0;
			for (int y = -7; y < WPL_TH; y++) {
				int ya = y + 6; if (ya >= WPL_TH) ya = WPL_TH - 1; if (ya < 0) ya = 0;
				s += tmp[(long)ya * WPL_TW + x];
				int yr = y - 7;
				if (yr >= 0) s -= tmp[(long)yr * WPL_TW + x];
				if (y >= 0) g_wpl_glow_a[(long)y * WPL_TW + x] = (unsigned char)(s / 13);
			}
		}
	}
}

static void wpl_build_glow_alpha(void) {   /* 贵: 232k 像素圆角距离场+模糊——只在脏时跑一次 */
	memset(g_wpl_glow_a, 0, sizeof(g_wpl_glow_a));
	float x = (float)WPL_GM, y = (float)WPL_GM, w = (float)WPL_PW, h = (float)g_wpl_ph;
	for (int j = 0; j < WPL_TH; j++) {
		for (int i = 0; i < WPL_TW; i++) {
			float d = wpl_rr_d((float)i + 0.5f, (float)j + 0.5f, x, y, w, h, 40.0f);
			if (d < -2.0f) continue;
			float a = 1.0f - (d + 2.0f) / 26.0f;
			if (a <= 0.0f) continue;
			if (a > 1.0f) a = 1.0f;
			g_wpl_glow_a[(long)j * WPL_TW + i] = (unsigned char)(a * 255.0f);
		}
	}
	wpl_blur3a();
	for (int j = 0; j < WPL_TH; j++) {
		int x0 = WPL_TW, x1 = -1;
		const unsigned char* row = g_wpl_glow_a + (long)j * WPL_TW;
		for (int i = 0; i < WPL_TW; i++) if (row[i]) { if (i < x0) x0 = i; if (i > x1) x1 = i; }
		g_wpl_span0[j] = (short)x0;
		g_wpl_span1[j] = (short)x1;
	}
	g_wpl_glow_a_ok = 1;
}

static void wpl_build_glow(long now) {   /* 每 90ms: 形状走缓存, 仅脉冲换色合成(~0.3ms), 渲染线程不再算距离场 */
	unsigned char c00[3], c10[3], c01[3], c11[3];
	float x = (float)WPL_GM, y = (float)WPL_GM, w = (float)WPL_PW, h = (float)g_wpl_ph;
	if (!g_wpl_glow_a_ok) wpl_build_glow_alpha();
	wpl_chroma(270, now, c00); wpl_chroma(0, now, c10);
	wpl_chroma(90, now, c01); wpl_chroma(180, now, c11);
	memcpy(g_wpl_up, g_wpl_base, sizeof(g_wpl_up));
	for (int j = 0; j < WPL_TH; j++) {
		int i0 = g_wpl_span0[j], i1 = g_wpl_span1[j];
		float v = ((float)j + 0.5f - y) / h;
		if (v < 0.0f) v = 0.0f; if (v > 1.0f) v = 1.0f;
		for (int i = i0; i <= i1; i++) {
			int ga = g_wpl_glow_a[(long)j * WPL_TW + i];
			if (!ga) continue;
			float u = ((float)i + 0.5f - x) / w;
			if (u < 0.0f) u = 0.0f; if (u > 1.0f) u = 1.0f;
			int gc[3];
			unsigned char* o = g_wpl_up + ((long)j * WPL_TW + i) * 4;
			int ba = o[3], oa;
			for (int ch = 0; ch < 3; ch++) {
				float top = (float)c00[ch] + ((float)c10[ch] - (float)c00[ch]) * u;
				float bot = (float)c01[ch] + ((float)c11[ch] - (float)c01[ch]) * u;
				gc[ch] = (int)(top + (bot - top) * v);
			}
			oa = ba + ga * (255 - ba) / 255;
			for (int ch = 0; ch < 3; ch++)
				o[ch] = (unsigned char)((o[ch] * ba + gc[ch] * ga * (255 - ba) / 255) / oa);
			o[3] = (unsigned char)(oa > 255 ? 255 : oa);
		}
	}
}

static float g_wpl_av = 0.0f, g_wpl_astart = 0.0f, g_wpl_adest = 0.0f;
static long g_wpl_at0 = 0;
static int g_wpl_afin = 1;

static void wpl_anim_run(float dest, long now) {
	if (dest != g_wpl_adest) {
		g_wpl_adest = dest; g_wpl_at0 = now; g_wpl_astart = g_wpl_av; g_wpl_afin = 0;
	}
	if (g_wpl_afin) return;
	if (now - g_wpl_at0 > 200) { g_wpl_afin = 1; g_wpl_av = dest; return; }
	float p = (float)(now - g_wpl_at0) / 200.0f;
	float e = 1.0f - (p - 1.0f) * (p - 1.0f);
	g_wpl_av = g_wpl_astart + (dest - g_wpl_astart) * e;
}

static const char WPL_VS[] =
	"#version 300 es\n"
	"uniform vec2 uRes;\n"
	"uniform vec2 uOff;\n"
	"uniform vec2 uSize;\n"
	"uniform float uVMax;\n"
	"out vec2 vUv;\n"
	"void main(){\n"
	"    vec2 p = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));\n"
	"    vUv = vec2(p.x, p.y * uVMax);\n"
	"    vec2 px = uOff + p * uSize;\n"
	"    gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);\n"
	"}\n";
static const char WPL_FS[] =
	"#version 300 es\n"
	"precision mediump float;\n"
	"uniform sampler2D uTex;\n"
	"uniform float uAlpha;\n"
	"in vec2 vUv;\n"
	"out vec4 fragColor;\n"
	"void main(){\n"
	"    vec4 c = texture(uTex, vUv);\n"
	"    fragColor = vec4(c.rgb, c.a * uAlpha);\n"
	"}\n";

static GLuint wpl_shader(GLenum type, const char* src) {
	GLuint s = pglCreateShader(type);
	pglShaderSource(s, 1, &src, 0);
	pglCompileShader(s);
	GLint ok = 0;
	pglGetShaderiv(s, GL_COMPILE_STATUS, &ok);
	if (!ok) {
		char il[256];
		il[0] = 0;
		if (pglGetShaderInfoLog) { GLsizei got = 0; pglGetShaderInfoLog(s, sizeof(il) - 1, &got, il); il[got < 0 ? 0 : (got > 255 ? 255 : got)] = 0; }
		ks_logf("[wpl]", "shader compile fail type=%x log=%s", (unsigned)type, il);
		pglDeleteShader(s);
		return 0;
	}
	return s;
}

static int wpl_gl_init(void) {
	if (g_wpl_gl) return g_wpl_gl == 1;
	ks_logf("[wpl]", "gl_init begin fn=%d%d%d%d%d%d%d%d%d",
		pglCreateProgram ? 1 : 0, pglUniform2f ? 1 : 0, pglGenVertexArrays ? 1 : 0,
		wpl_pglGetBooleanv ? 1 : 0, wpl_pglDepthMask ? 1 : 0, wpl_pglDepthFunc ? 1 : 0,
		wpl_pglColorMask ? 1 : 0, wpl_pglBindFramebuffer ? 1 : 0, pglGetShaderInfoLog ? 1 : 0);
	if (!pglCreateProgram || !pglUniform2f || !pglGenVertexArrays || !wpl_pglGetBooleanv || !wpl_pglDepthMask || !wpl_pglDepthFunc || !wpl_pglColorMask || !wpl_pglBindFramebuffer) {
		g_wpl_gl = -1;
		wpl_set_status("gl sym missing");
		ks_logf("[wpl]", "gl_init fnptr miss");
		return 0;
	}
	GLuint vs = wpl_shader(GL_VERTEX_SHADER, WPL_VS);
	GLuint fs = wpl_shader(GL_FRAGMENT_SHADER, WPL_FS);
	if (!vs || !fs) { g_wpl_gl = -1; wpl_set_status("shader fail"); return 0; }
	g_wpl_prog = pglCreateProgram();
	pglAttachShader(g_wpl_prog, vs);
	pglAttachShader(g_wpl_prog, fs);
	pglLinkProgram(g_wpl_prog);
	pglDeleteShader(vs);
	pglDeleteShader(fs);
	GLint ok = 0;
	pglGetProgramiv(g_wpl_prog, GL_LINK_STATUS, &ok);
	if (!ok) {
		char il[256];
		il[0] = 0;
		if (pglGetProgramInfoLog) { GLsizei got = 0; pglGetProgramInfoLog(g_wpl_prog, sizeof(il) - 1, &got, il); il[got < 0 ? 0 : (got > 255 ? 255 : got)] = 0; }
		g_wpl_gl = -1;
		wpl_set_status("link fail");
		ks_logf("[wpl]", "gl_init link fail log=%s", il);
		return 0;
	}
	g_wpl_ures = pglGetUniformLocation(g_wpl_prog, "uRes");
	g_wpl_uoff = pglGetUniformLocation(g_wpl_prog, "uOff");
	g_wpl_usize = pglGetUniformLocation(g_wpl_prog, "uSize");
	g_wpl_utex = pglGetUniformLocation(g_wpl_prog, "uTex");
	g_wpl_uvmax = pglGetUniformLocation(g_wpl_prog, "uVMax");
	g_wpl_ualpha = pglGetUniformLocation(g_wpl_prog, "uAlpha");
	pglGenTextures(1, &g_wpl_tex);
	pglBindTexture(GL_TEXTURE_2D, g_wpl_tex);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	pglTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, WPL_TW, WPL_TH, 0, GL_RGBA, GL_UNSIGNED_BYTE, g_wpl_up);
	pglGenVertexArrays(1, &g_wpl_vao);
	wpl_load_font();
	g_wpl_gl = 1;
	ks_logf("[wpl]", "gl_init ok prog=%u uRes=%d uOff=%d uSize=%d uTex=%d uVMax=%d tex=%u vao=%u font=%d",
		(unsigned)g_wpl_prog, (int)g_wpl_ures, (int)g_wpl_uoff, (int)g_wpl_usize, (int)g_wpl_utex, (int)g_wpl_uvmax, (unsigned)g_wpl_tex, (unsigned)g_wpl_vao, wpl_g_font_ok);
	return 1;
}

static const float* wpl_smooth_step(float dtms, const float* tgt, float* sm, int* init) {
	int i;
	if (!*init) {
		for (i = 0; i < 3; i++) sm[i] = tgt[i];
		*init = 1;
		return sm;
	}
	{
		float j2 = 0.0f;
		for (i = 0; i < 3; i++) { float d = tgt[i] - sm[i]; j2 += d * d; }
		if (j2 > 25.0f) {
			for (i = 0; i < 3; i++) sm[i] = tgt[i];
			return sm;
		}
	}
	{
		float al = dtms / (dtms + 50.0f);
		if (al > 1.0f) al = 1.0f;
		for (i = 0; i < 3; i++) sm[i] += (tgt[i] - sm[i]) * al;
	}
	return sm;
}

static float g_wpl_camsm[3] = {0, 0, 0};
static int g_wpl_caminit = 0;
static long g_wpl_slast = 0;

static int g_wpl_anchinit = 0;
static int wpl_proj_anchor(const float* m, const float* cam, int w, int h, long fdt) {
	float minx = 1e30f, miny = 1e30f, maxx = -1e30f, maxy = -1e30f;
	int clipped = 0, projOk = 0;
	for (int c = 0; c < 8; c++) {
		float wx = (float)(g_wpl_target[0] + (c & 1)) - cam[0];
		float wy = (float)(g_wpl_target[1] + ((c >> 1) & 1)) - cam[1];
		float wz = (float)(g_wpl_target[2] + ((c >> 2) & 1)) - cam[2];
		float qx = m[0] * wx + m[4] * wy + m[8] * wz + m[12];
		float qy = m[1] * wx + m[5] * wy + m[9] * wz + m[13];
		float qw = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
		if (qw < 0.05f) { clipped = 1; continue; }
		float sx = (qx / qw * 0.5f + 0.5f) * (float)w;
		float sy = (0.5f - qy / qw * 0.5f) * (float)h;
		float bx0 = -(float)w * 2.0f, bx1 = (float)w * 3.0f;
		float by0 = -(float)h * 2.0f, by1 = (float)h * 3.0f;
		if (sx < bx0) sx = bx0; if (sx > bx1) sx = bx1;
		if (sy < by0) sy = by0; if (sy > by1) sy = by1;
		if (sx < minx) minx = sx; if (sx > maxx) maxx = sx;
		if (sy < miny) miny = sy; if (sy > maxy) maxy = sy;
		projOk = 1;
	}
	if (!projOk) { g_wpl_anchinit = 0; return 0; }
	float tax, tay, tbh = maxy - miny;
	if (tbh < 8.0f) tbh = 8.0f;
	float sEst = tbh / 140.0f;
	if (sEst < 0.55f) sEst = 0.55f;
	if (sEst > 1.25f) sEst = 1.25f;
	float tipEst = miny - tbh * 0.75f - 4.0f;
	float topEst = tipEst - (float)(56 + g_wpl_ph) * sEst;
	if (clipped || topEst < (float)h * 0.02f || tipEst > (float)h * 0.98f) {
		float spn = 0.62f * (float)h / (float)(60 + g_wpl_ph);
		if (spn > 1.25f) spn = 1.25f;
		if (spn < 0.50f) spn = 0.50f;
		tbh = 140.0f * spn;
		tax = (float)w * 0.5f;
		tay = (float)h * 0.34f + (float)(56 + g_wpl_ph) * spn * 0.5f + tbh * 0.75f + 4.0f;
	} else {
		tax = (minx + maxx) * 0.5f;
		tay = miny;
	}
	if (!g_wpl_anchinit) {
		g_wpl_anchinit = 1;
		g_wpl_ax = tax; g_wpl_ay = tay; g_wpl_bh = tbh;
		return 1;
	}
	float dx = tax - g_wpl_ax, dy = tay - g_wpl_ay, dz = tbh - g_wpl_bh;
	if (dx * dx + dy * dy > (float)w * (float)w) {
		g_wpl_ax = tax; g_wpl_ay = tay; g_wpl_bh = tbh;
		return 1;
	}
	float al = (float)fdt / ((float)fdt + 45.0f);
	if (al > 1.0f) al = 1.0f;
	g_wpl_ax += dx * al;
	g_wpl_ay += dy * al;
	g_wpl_bh += dz * al;
	return 1;
}

static void wpl_render(EGLDisplay dpy, EGLSurface surf) {
	wpl_lines_ensure();
	float pr = ks_anim(&wpl_g_aprog, &wpl_g_aprogT, wpl_g_enable);
	if (!wpl_g_enable && pr <= 0.0005f) return;
	if (wpl_g_hook_state == 0) wpl_hooks_install();
	int w = 0, h = 0;
	if (peglQuerySurface) {
		peglQuerySurface(dpy, surf, EGL_WIDTH, &w);
		peglQuerySurface(dpy, surf, EGL_HEIGHT, &h);
	}
	wpl_pv_pick(w, h);
	if (!wpl_g_logged_surf) {
		wpl_g_logged_surf = 1;
		ks_logf("[wpl]", "first render enabled: surface %dx%d hookState=%d pvFrame=%ld swaps=%ld",
			w, h, wpl_g_hook_state, wpl_g_pv_frame, ks_g_swaps);
	}
	if (wpl_g_pv_frame < 0 || ks_g_swaps - wpl_g_pv_frame > 5) {
		if (!wpl_g_pvmiss_logged) {
			wpl_g_pvmiss_logged = 1;
			ks_logf("[wpl]", "pv not ready/missing: hookState=%d pvFrame=%ld swaps=%ld", wpl_g_hook_state, wpl_g_pv_frame, ks_g_swaps);
		}
		return;
	}
	wpl_g_pvmiss_logged = 0;
	{
		EGLContext cur = peglGetCurrentContext ? peglGetCurrentContext() : 0;
		if (wpl_g_gamectx && cur && cur != wpl_g_gamectx) {   /* 后台切回 GL 上下文已重建: 旧 prog/tex/vao 全废, 重锁重建 */
			if (wpl_g_hook_state == 1 && !wpl_ctx_is_game(cur)) return;
			ks_logf("[wpl]", "ctx changed %p -> %p, gl re-init", (void*)wpl_g_gamectx, (void*)cur);
			wpl_g_gamectx = cur; wpl_g_surf = 0; g_wpl_gl = 0;
		}
	}
	if (!wpl_gl_init()) return;
	{
		EGLContext cur = peglGetCurrentContext ? peglGetCurrentContext() : 0;
		if (!wpl_g_surf) {
			if (cur && wpl_g_hook_state == 1 && !wpl_ctx_is_game(cur)) return;
			wpl_g_surf = surf;
			if (cur && !wpl_g_gamectx) wpl_g_gamectx = cur;
			ks_logf("[wpl]", "surface locked: surf=%p ctx=%p", (void*)surf, (void*)cur);
		} else if (surf != wpl_g_surf) {
			if (cur && wpl_g_gamectx && cur == wpl_g_gamectx && ks_g_swaps - wpl_g_surfsw > 120) {
				wpl_g_surf = surf;
				ks_logf("[wpl]", "surface relock: surf=%p", (void*)surf);
			} else return;
		}
		wpl_g_surfsw = ks_g_swaps;
	}
	if (w <= 0 || h <= 0) return;
	long now = wpl_now_ms();

	float tgt[3];
	{
		float dt = (float)(now - g_wpl_cam_ts) / 1000.0f;
		float pdt = (float)(g_wpl_cam_ts - g_wpl_cam_pts) / 1000.0f;
		float k = 0.0f;
		if (pdt > 0.01f && pdt < 0.5f && dt > 0.0f && dt < 0.3f) {
			k = dt / pdt; if (k > 1.5f) k = 1.5f;
		}
		for (int i = 0; i < 3; i++) tgt[i] = g_wpl_cam[i] + (g_wpl_cam[i] - g_wpl_cam_prv[i]) * k;
	}
	if (now - g_wpl_cam_ts > 600) g_wpl_caminit = 0;
	long fdt = g_wpl_slast ? now - g_wpl_slast : 16;
	g_wpl_slast = now;
	if (fdt < 0) fdt = 0;
	if (fdt > 250) fdt = 250;
	const float* cam = wpl_smooth_step((float)fdt, tgt, g_wpl_camsm, &g_wpl_caminit);

	int projOk = 0;
	if (g_wpl_target[1] > -500) projOk = wpl_proj_anchor(wpl_g_pv, cam, w, h, fdt);
	else g_wpl_anchinit = 0;

	wpl_anim_run((g_wpl_show && projOk) ? 1.0f : 0.0f, now);
	if (g_wpl_afin && g_wpl_av < 0.004f) return;

	GLint oldProg = 0, oldVp[4] = {0}, oldTex = 0, oldVao = 0, oldFbo = 0, oldActive = 0;
	GLint oldBsrc = 0, oldBdst = 0, oldBsrcA = 0, oldBdstA = 0, oldDfunc = 0;
	GLboolean oldDmask = 1, oldCmask[4] = {1, 1, 1, 1};
	GLboolean enBlend = 0, enDepth = 0, enCull = 0, enScissor = 0, enStencil = 0;
	pglGetIntegerv(GL_CURRENT_PROGRAM, &oldProg);
	pglGetIntegerv(GL_VIEWPORT, oldVp);
	pglGetIntegerv(GL_TEXTURE_BINDING_2D, &oldTex);
	pglGetIntegerv(GL_ACTIVE_TEXTURE, &oldActive);
	pglGetIntegerv(GL_VERTEX_ARRAY_BINDING, &oldVao);
	pglGetIntegerv(GL_BLEND_SRC_RGB, &oldBsrc);
	pglGetIntegerv(GL_BLEND_DST_RGB, &oldBdst);
	pglGetIntegerv(GL_BLEND_SRC_ALPHA, &oldBsrcA);
	pglGetIntegerv(GL_BLEND_DST_ALPHA, &oldBdstA);
	pglGetIntegerv(WPL_GL_DEPTH_FUNC, &oldDfunc);
	wpl_pglGetBooleanv(WPL_GL_DEPTH_WRITEMASK, &oldDmask);
	enBlend = pglIsEnabled(GL_BLEND);
	enDepth = pglIsEnabled(GL_DEPTH_TEST);
	enCull = pglIsEnabled(GL_CULL_FACE);
	enScissor = pglIsEnabled(GL_SCISSOR_TEST);
	enStencil = pglIsEnabled(WPL_GL_STENCIL_TEST);
	pglGetIntegerv(WPL_GL_FRAMEBUFFER_BINDING, &oldFbo);
	wpl_pglGetBooleanv(WPL_GL_COLOR_WRITEMASK, oldCmask);

	wpl_pglBindFramebuffer(WPL_GL_FRAMEBUFFER, 0);
	wpl_pglColorMask(1, 1, 1, 1);
	if (enStencil) pglDisable(WPL_GL_STENCIL_TEST);
	pglViewport(0, 0, w, h);
	pglUseProgram(g_wpl_prog);
	pglBindVertexArray(g_wpl_vao);
	if (g_wpl_utex >= 0) pglUniform1i(g_wpl_utex, 0);
	if (enScissor) pglDisable(GL_SCISSOR_TEST);
	if (enCull) pglDisable(GL_CULL_FACE);
	pglDisable(GL_DEPTH_TEST);
	wpl_pglDepthMask(0);
	pglEnable(GL_BLEND);
	pglBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
	pglActiveTexture(GL_TEXTURE0);
	pglBindTexture(GL_TEXTURE_2D, g_wpl_tex);

	if (g_wpl_dirty || now - g_wpl_glow_ts > 90) {
		if (g_wpl_dirty) { wpl_build_base(); g_wpl_dirty = 0; }
		wpl_build_glow(now);
		g_wpl_glow_ts = now;
		if (pglTexSubImage2D) pglTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, WPL_TW, WPL_TH, GL_RGBA, GL_UNSIGNED_BYTE, g_wpl_up);   /* 存储已在 gl_init 分配: 只换像素, 免每 90ms 重分配卡顿 */
		else pglTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, WPL_TW, WPL_TH, 0, GL_RGBA, GL_UNSIGNED_BYTE, g_wpl_up);
	}

	float s = g_wpl_bh / 140.0f;
	if (s < 0.55f) s = 0.55f;
	if (s > 1.25f) s = 1.25f;
	float v = g_wpl_av * s;
	float px = g_wpl_ax;
	float tip = g_wpl_ay - g_wpl_bh * 0.75f - 4.0f;
	float rt = (float)(WPL_GM + g_wpl_ph + 12);
	float uh = (float)(WPL_GM + g_wpl_ph + 16);
	float x0 = px - (float)(WPL_TW / 2) * v, x1 = px + (float)(WPL_TW / 2) * v;
	float y0 = tip - rt * v, y1 = tip + (uh - rt) * v;
	if (g_wpl_ures >= 0) pglUniform2f(g_wpl_ures, (float)w, (float)h);
	if (g_wpl_uoff >= 0) pglUniform2f(g_wpl_uoff, x0, y0);
	if (g_wpl_usize >= 0) pglUniform2f(g_wpl_usize, x1 - x0, y1 - y0);
	if (g_wpl_uvmax >= 0) pglUniform1f(g_wpl_uvmax, uh / (float)WPL_TH);
	if (g_wpl_ualpha >= 0) pglUniform1f(g_wpl_ualpha, pr * pr * (3.0f - 2.0f * pr));
	pglDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
	wpl_g_drew_n++;

	wpl_pglBindFramebuffer(WPL_GL_FRAMEBUFFER, (GLuint)oldFbo);
	wpl_pglColorMask(oldCmask[0], oldCmask[1], oldCmask[2], oldCmask[3]);
	if (enStencil) pglEnable(WPL_GL_STENCIL_TEST);
	if (oldDmask) wpl_pglDepthMask(1);
	wpl_pglDepthFunc((GLenum)oldDfunc);
	if (!enDepth) pglDisable(GL_DEPTH_TEST);
	if (!enBlend) pglDisable(GL_BLEND);
	else pglBlendFuncSeparate((GLenum)oldBsrc, (GLenum)oldBdst, (GLenum)oldBsrcA, (GLenum)oldBdstA);
	if (enCull) pglEnable(GL_CULL_FACE);
	if (enScissor) pglEnable(GL_SCISSOR_TEST);
	pglActiveTexture((GLenum)oldActive);   /* 先还原激活单元再绑旧纹理: 免把游戏 unit1 的状态绑到 unit0 */
	pglBindTexture(GL_TEXTURE_2D, (GLuint)oldTex);
	pglBindVertexArray((GLuint)oldVao);
	pglUseProgram((GLuint)oldProg);
	pglViewport(oldVp[0], oldVp[1], oldVp[2], oldVp[3]);
}

static int wpl_active(void) { return wpl_g_enable != 0 || wpl_g_aprog > 0.0005f; }
static void wpl_disable(void) { wpl_g_enable = 0; g_wpl_caminit = 0; }

static long wpl_enable(long v) {
	wpl_g_enable = (v == 1) ? 1 : 0;
	ks_logf("[wpl]", "enable=%ld hookState=%d", v, wpl_g_hook_state);
	if (wpl_g_enable && wpl_g_hook_state != 1) wpl_hooks_install();
	return wpl_g_enable;
}
static long wpl_px(long v) { g_wpl_cam_prv[0] = g_wpl_cam[0]; g_wpl_cam[0] = (float)v / 1000.0f; g_wpl_cam_pts = g_wpl_cam_ts; g_wpl_cam_ts = wpl_now_ms(); return 1; }
static long wpl_py(long v) { g_wpl_cam_prv[1] = g_wpl_cam[1]; g_wpl_cam[1] = (float)v / 1000.0f + 1.62f; g_wpl_cam_pts = g_wpl_cam_ts; g_wpl_cam_ts = wpl_now_ms(); return 1; }
static long wpl_pz(long v) { g_wpl_cam_prv[2] = g_wpl_cam[2]; g_wpl_cam[2] = (float)v / 1000.0f; g_wpl_cam_pts = g_wpl_cam_ts; g_wpl_cam_ts = wpl_now_ms(); return 1; }
static long wpl_tx(long v) { g_wpl_target[0] = (int)v; return 1; }
static long wpl_ty(long v) { g_wpl_target[1] = (int)v; return 1; }
static long wpl_tz(long v) { g_wpl_target[2] = (int)v; return 1; }
static long wpl_show(long v) {
	g_wpl_show = v ? 1 : 0;
	return g_wpl_show;
}
static long wpl_drew(void) { return wpl_g_drew_n; }
static long __wpl_in(void) { return (long)(intptr_t)g_wpl_inbuf; }
static long wpl_sync(void) {
	static char last[8000];
	static int last_len = -1;
	wpl_lines_ensure();
	int len = (unsigned char)g_wpl_inbuf[0] | ((unsigned char)g_wpl_inbuf[1] << 8) | ((unsigned char)g_wpl_inbuf[2] << 16) | ((unsigned char)g_wpl_inbuf[3] << 24);
	if (len <= 0 || len > 8000) {
		ks_logf("[wpl]", "sync bad len=%d", len);
		return 0;
	}
	const char* s = g_wpl_inbuf + 4;
	if (len == last_len && memcmp(s, last, (size_t)len) == 0) return 1;   /* 内容未变: 免重排重栅化(渲染线程卡顿源) */
	memcpy(last, s, (size_t)len);
	last_len = len;
	int li = 0, oi = 0;
	for (int i = 0; i < len && li < WPL_MAXLINE; i++) {
		char ch = s[i];
		if (ch == '\n') { g_wpl_lines[li][oi] = 0; li++; oi = 0; continue; }
		if (oi < WPL_LINESZ - 1) g_wpl_lines[li][oi++] = ch;
	}
	if (li < WPL_MAXLINE) { g_wpl_lines[li][oi] = 0; li++; }
	while (li < WPL_MAXLINE) g_wpl_lines[li++][0] = 0;
	wpl_layout();
	g_wpl_dirty = 1;
	ks_logf("[wpl]", "sync len=%d lines=%d ph=%d first=%.40s", len, li, g_wpl_ph, g_wpl_lines[0]);
	return 1;
}

/* ===== 材质包注入模块 ===== */
#include <dirent.h>
#include <sys/stat.h>
#ifdef _WIN32
#include <direct.h>
#define TEX_MKDIR(p) _mkdir(p)
#define TEX_RMDIR(p) _rmdir(p)
#else
#include <unistd.h>
#define TEX_MKDIR(p) mkdir((p), 0755)
#define TEX_RMDIR(p) rmdir(p)
#endif

static int tex_isfile(const char* p) {
	FILE* f = fopen(p, "rb");
	if (!f) return 0;
	fclose(f);
	return 1;
}
static int tex_isdir(const char* p) {
	DIR* d = opendir(p);
	if (!d) return 0;
	closedir(d);
	return 1;
}
static void tex_mkdirs(const char* p) {
	char tmp[1024];
	int n = 0;
	while (p[n] && n < 1000) { tmp[n] = p[n]; n++; }
	tmp[n] = 0;
	for (int i = 1; i < n; i++) {
		if (tmp[i] == '/') {
			tmp[i] = 0;
			TEX_MKDIR(tmp);
			tmp[i] = '/';
		}
	}
	TEX_MKDIR(tmp);
}
static int tex_copyfile(const char* src, const char* dst) {
	FILE* a = fopen(src, "rb");
	if (!a) return 0;
	FILE* b = fopen(dst, "wb");
	if (!b) { fclose(a); return 0; }
	char buf[16384];
	size_t r;
	while ((r = fread(buf, 1, sizeof(buf), a)) > 0) fwrite(buf, 1, r, b);
	fclose(b);
	fclose(a);
	return 1;
}
static unsigned char* tex_readfile(const char* p, size_t* len) {
	FILE* f = fopen(p, "rb");
	if (!f) return 0;
	fseek(f, 0, SEEK_END);
	long n = ftell(f);
	fseek(f, 0, SEEK_SET);
	if (n < 0) { fclose(f); return 0; }
	unsigned char* b = (unsigned char*)malloc((size_t)n + 1);
	if (!b) { fclose(f); return 0; }
	size_t got = fread(b, 1, (size_t)n, f);
	fclose(f);
	b[got] = 0;
	*len = got;
	return b;
}
static int tex_writefile(const char* p, const unsigned char* d, size_t n) {
	FILE* f = fopen(p, "wb");
	if (!f) return 0;
	fwrite(d, 1, n, f);
	fclose(f);
	return 1;
}

static void tex_rmdir_chain(const char* dir) {

	char tmp[1024];
	int n = 0;
	while (dir[n] && n < 1000) { tmp[n] = dir[n]; n++; }
	tmp[n] = 0;
	while (n > 0) {
		if (TEX_RMDIR(tmp) != 0) break;
		while (n > 0 && tmp[n - 1] != '/') n--;
		if (n > 0) tmp[--n] = 0;
		else break;
	}
}
static int tex_ends_ic(const char* s, const char* suf) {
	int a = 0, b = 0;
	while (s[a]) a++;
	while (suf[b]) b++;
	if (a < b) return 0;
	s += a - b;
	for (int i = 0; i < b; i++) {
		char x = s[i], y = suf[i];
		if (x >= 'A' && x <= 'Z') x += 32;
		if (y >= 'A' && y <= 'Z') y += 32;
		if (x != y) return 0;
	}
	return 1;
}
static int tex_contains_ic(const char* s, const char* sub) {
	int sl = 0;
	while (sub[sl]) sl++;
	for (int i = 0; s[i]; i++) {
		int j = 0;
		while (j < sl) {
			char x = s[i + j], y = sub[j];
			if (!x) return 0;
			if (x >= 'A' && x <= 'Z') x += 32;
			if (y >= 'A' && y <= 'Z') y += 32;
			if (x != y) break;
			j++;
		}
		if (j == sl) return 1;
	}
	return 0;
}

static const char TEX_PACK_EXACT[] = "3.9_FirstPatch_2024_res_s1_texture_647d7cd2-1f2d-5959-a82f-c1093988afd0_0_0_2";

static char* tex_g_rep = 0;
static size_t tex_g_replen = 0, tex_g_repcap = 0;
static void tex_rep(const char* s) {
	size_t n = strlen(s);
	if (tex_g_replen + n + 2 > tex_g_repcap) {
		size_t nc = tex_g_repcap ? tex_g_repcap * 2 : 8192;
		while (nc < tex_g_replen + n + 2) nc *= 2;
		char* p = (char*)realloc(tex_g_rep, nc);
		if (!p) return;
		tex_g_rep = p;
		tex_g_repcap = nc;
	}
	memcpy(tex_g_rep + tex_g_replen, s, n);
	tex_g_replen += n;
	tex_g_rep[tex_g_replen] = 0;
}
static void tex_repln(const char* tag, const char* msg) {
	tex_rep(tag);
	tex_rep(" ");
	tex_rep(msg);
	tex_rep("\n");
}
static void tex_repnum(const char* tag, const char* pre, long v) {
	char buf[64];
	snprintf(buf, sizeof(buf), "%s %s%ld", tag, pre, v);
	tex_rep(buf);
	tex_rep("\n");
}

typedef struct { uint32_t h[4]; uint64_t len; unsigned char blk[64]; size_t bn; } tex_md5;
static uint32_t tex_rotl(uint32_t x, int c) { return (x << c) | (x >> (32 - c)); }
static void tex_md5_block(tex_md5* m, const unsigned char* p) {
	static const uint32_t K[64] = {
		0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
		0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,
		0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
		0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
		0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
		0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
		0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
		0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391 };
	static const int S[64] = {
		7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
		5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
		4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
		6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21 };
	uint32_t w[16];
	for (int i = 0; i < 16; i++)
		w[i] = (uint32_t)p[i * 4] | ((uint32_t)p[i * 4 + 1] << 8) | ((uint32_t)p[i * 4 + 2] << 16) | ((uint32_t)p[i * 4 + 3] << 24);
	uint32_t a = m->h[0], b = m->h[1], c = m->h[2], d = m->h[3];
	for (int i = 0; i < 64; i++) {
		uint32_t f; int g;
		if (i < 16) { f = (b & c) | (~b & d); g = i; }
		else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
		else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
		else { f = c ^ (b | ~d); g = (7 * i) & 15; }
		uint32_t t = d;
		d = c;
		c = b;
		b = b + tex_rotl(a + f + K[i] + w[g], S[i]);
		a = t;
	}
	m->h[0] += a; m->h[1] += b; m->h[2] += c; m->h[3] += d;
}
static void tex_md5_init(tex_md5* m) {
	m->h[0] = 0x67452301; m->h[1] = 0xefcdab89; m->h[2] = 0x98badcfe; m->h[3] = 0x10325476;
	m->len = 0; m->bn = 0;
}
static void tex_md5_upd(tex_md5* m, const unsigned char* p, size_t n) {
	m->len += n;
	while (n) {
		size_t take = 64 - m->bn;
		if (take > n) take = n;
		memcpy(m->blk + m->bn, p, take);
		m->bn += take; p += take; n -= take;
		if (m->bn == 64) { tex_md5_block(m, m->blk); m->bn = 0; }
	}
}
static void tex_md5_hex(tex_md5* m, char out[33]) {
	uint64_t bits = m->len * 8;
	unsigned char pad = 0x80;
	tex_md5_upd(m, &pad, 1);
	pad = 0;
	while (m->bn != 56) tex_md5_upd(m, &pad, 1);
	unsigned char lb[8];
	for (int i = 0; i < 8; i++) lb[i] = (unsigned char)(bits >> (8 * i));
	tex_md5_upd(m, lb, 8);
	static const char HX[] = "0123456789abcdef";
	for (int i = 0; i < 4; i++)
		for (int j = 0; j < 4; j++) {
			out[i * 8 + j * 2] = HX[(m->h[i] >> (j * 8 + 4)) & 15];
			out[i * 8 + j * 2 + 1] = HX[(m->h[i] >> (j * 8)) & 15];
		}
	out[32] = 0;
}
static void tex_md5_of(const unsigned char* d, size_t n, char out[33]) {
	tex_md5 m;
	tex_md5_init(&m);
	tex_md5_upd(&m, d, n);
	tex_md5_hex(&m, out);
}

typedef struct { const unsigned char* d; size_t len, pos; unsigned acc; int nb; } tex_bits;
static unsigned tex_gb(tex_bits* b, int n) {
	while (b->nb < n) {
		unsigned c = 0;
		if (b->pos < b->len) c = b->d[b->pos++];
		b->acc |= c << b->nb;
		b->nb += 8;
	}
	unsigned r = b->acc & ((1u << n) - 1);
	b->acc >>= n;
	b->nb -= n;
	return r;
}
typedef struct { uint16_t cnt[16]; uint16_t sym[320]; } tex_huff;
static void tex_hbuild(tex_huff* h, const unsigned char* lens, int n) {
	for (int i = 0; i < 16; i++) h->cnt[i] = 0;
	for (int i = 0; i < n; i++) if (lens[i] > 0 && lens[i] < 16) h->cnt[lens[i]]++;
	uint16_t offs[16];
	offs[1] = 0;
	for (int l = 1; l < 15; l++) offs[l + 1] = (uint16_t)(offs[l] + h->cnt[l]);
	for (int i = 0; i < n; i++) if (lens[i] > 0 && lens[i] < 16) h->sym[offs[lens[i]]++] = (uint16_t)i;
}
static int tex_hdec(tex_bits* b, const tex_huff* h) {
	int code = 0, first = 0, index = 0;
	for (int len = 1; len <= 15; len++) {
		code |= (int)tex_gb(b, 1);
		int c = h->cnt[len];
		if (code - first < c) return h->sym[index + code - first];
		index += c;
		first = (first + c) << 1;
		code <<= 1;
	}
	return -1;
}
static int tex_inflate_codes(tex_bits* b, unsigned char* out, size_t cap, size_t* op, const tex_huff* lh, const tex_huff* dh) {
	static const uint16_t LB[29] = { 3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258 };
	static const unsigned char LE[29] = { 0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0 };
	static const uint16_t DB[30] = { 1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577 };
	static const unsigned char DE[30] = { 0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13 };
	for (;;) {
		int s = tex_hdec(b, lh);
		if (s < 0) return 0;
		if (s < 256) {
			if (*op >= cap) return 0;
			out[(*op)++] = (unsigned char)s;
			continue;
		}
		if (s == 256) return 1;
		s -= 257;
		if (s > 28) return 0;
		size_t len = LB[s] + tex_gb(b, LE[s]);
		int ds = tex_hdec(b, dh);
		if (ds < 0 || ds > 29) return 0;
		size_t dist = DB[ds] + tex_gb(b, DE[ds]);
		if (dist > *op || *op + len > cap) return 0;
		for (size_t i = 0; i < len; i++) {
			out[*op] = out[*op - dist];
			(*op)++;
		}
	}
}

static int tex_inflate(const unsigned char* in, size_t inlen, unsigned char* out, size_t cap, size_t* op) {
	tex_bits b;
	b.d = in; b.len = inlen; b.pos = 0; b.acc = 0; b.nb = 0;
	*op = 0;
	for (;;) {
		unsigned final = tex_gb(&b, 1);
		unsigned type = tex_gb(&b, 2);
		if (type == 0) {
			b.acc = 0; b.nb = 0;
			if (b.pos + 4 > b.len) return 0;
			unsigned ln = b.d[b.pos] | (b.d[b.pos + 1] << 8);
			unsigned nln = b.d[b.pos + 2] | (b.d[b.pos + 3] << 8);
			b.pos += 4;
			if ((ln & 0xffff) != (~nln & 0xffff)) return 0;
			if (b.pos + ln > b.len || *op + ln > cap) return 0;
			memcpy(out + *op, b.d + b.pos, ln);
			b.pos += ln;
			*op += ln;
		} else if (type == 1 || type == 2) {
			tex_huff lh, dh;
			if (type == 1) {
				unsigned char ll[288], dd[30];
				for (int i = 0; i < 144; i++) ll[i] = 8;
				for (int i = 144; i < 256; i++) ll[i] = 9;
				for (int i = 256; i < 280; i++) ll[i] = 7;
				for (int i = 280; i < 288; i++) ll[i] = 8;
				for (int i = 0; i < 30; i++) dd[i] = 5;
				tex_hbuild(&lh, ll, 288);
				tex_hbuild(&dh, dd, 30);
			} else {
				unsigned hlit = tex_gb(&b, 5) + 257;
				unsigned hdist = tex_gb(&b, 5) + 1;
				unsigned hclen = tex_gb(&b, 4) + 4;
				if (hlit > 286 || hdist > 30) return 0;
				static const unsigned char ORD[19] = { 16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15 };
				unsigned char cl[19];
				for (int i = 0; i < 19; i++) cl[i] = 0;
				for (unsigned i = 0; i < hclen; i++) cl[ORD[i]] = (unsigned char)tex_gb(&b, 3);
				tex_huff ch;
				tex_hbuild(&ch, cl, 19);
				unsigned char lens[320];
				unsigned total = hlit + hdist;
				unsigned i = 0;
				while (i < total) {
					int s = tex_hdec(&b, &ch);
					if (s < 0 || s > 18) return 0;
					if (s < 16) { lens[i++] = (unsigned char)s; continue; }
					unsigned rep; unsigned char v = 0;
					if (s == 16) {
						if (i == 0) return 0;
						v = lens[i - 1];
						rep = tex_gb(&b, 2) + 3;
					} else if (s == 17) rep = tex_gb(&b, 3) + 3;
					else rep = tex_gb(&b, 7) + 11;
					if (i + rep > total) return 0;
					while (rep--) lens[i++] = v;
				}
				tex_hbuild(&lh, lens, (int)hlit);
				tex_hbuild(&dh, lens + hlit, (int)hdist);
			}
			if (!tex_inflate_codes(&b, out, cap, op, &lh, &dh)) return 0;
		} else return 0;
		if (final) break;
	}
	return *op == cap;
}

static unsigned tex_u16(const unsigned char* p) { return p[0] | (p[1] << 8); }
static uint32_t tex_u32(const unsigned char* p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }

typedef struct {
	const unsigned char* zip;
	size_t zlen;
	const unsigned char* cd;
	unsigned entries;
	unsigned idx;
} tex_zr;
static int tex_zopen(tex_zr* z, const unsigned char* data, size_t len) {
	if (len < 22) return 0;
	size_t lo = len > 66000 ? len - 66000 : 0;
	size_t eocd = 0;
	int found = 0;
	for (size_t i = len - 22;; i--) {
		if (tex_u32(data + i) == 0x06054b50u) { eocd = i; found = 1; break; }
		if (i == lo) break;
	}
	if (!found) return 0;
	z->entries = (unsigned)tex_u16(data + eocd + 10);
	z->cd = data + tex_u32(data + eocd + 16);
	z->zip = data;
	z->zlen = len;
	z->idx = 0;
	return z->entries > 0;
}

static int tex_znext(tex_zr* z, char* nbuf, int ncap, unsigned char** out, size_t* outlen) {
	nbuf[0] = 0;
	if (z->idx >= z->entries) return 0;
	const unsigned char* p = z->cd;
	for (unsigned i = 0; i < z->idx; i++) {
		if (p + 46 > z->zip + z->zlen || tex_u32(p) != 0x02014b50u) return 0;
		p += 46 + tex_u16(p + 28) + tex_u16(p + 30) + tex_u16(p + 32);
	}
	if (p + 46 > z->zip + z->zlen || tex_u32(p) != 0x02014b50u) return 0;
	z->idx++;
	unsigned method = tex_u16(p + 10);
	uint32_t csize = tex_u32(p + 20), usize = tex_u32(p + 24);
	unsigned nl = tex_u16(p + 28), el = tex_u16(p + 30), cl = tex_u16(p + 32);
	uint32_t lho = tex_u32(p + 42);
	if (p + 46 + nl + el + cl > z->zip + z->zlen) return 0;
	if ((int)nl >= ncap) return 1;
	memcpy(nbuf, p + 46, nl);
	nbuf[nl] = 0;
	const unsigned char* q = z->zip + lho;
	if (tex_u32(q) != 0x04034b50u) { nbuf[0] = 0; return 1; }
	const unsigned char* dat = q + 30 + tex_u16(q + 26) + tex_u16(q + 28);
	if (dat + csize > z->zip + z->zlen) { nbuf[0] = 0; return 1; }
	*outlen = usize;
	*out = 0;
	if (method == 0) {
		if (csize != usize) { nbuf[0] = 0; return 1; }
		*out = (unsigned char*)malloc(usize ? usize : 1);
		if (*out) memcpy(*out, dat, usize);
	} else if (method == 8) {
		*out = (unsigned char*)malloc(usize ? usize : 1);
		if (*out) {
			size_t op = 0;
			if (!tex_inflate(dat, csize, *out, usize, &op)) { free(*out); *out = 0; }
		}
	}
	if (!*out && usize == 0) *out = (unsigned char*)malloc(1);
	if (!*out) nbuf[0] = 0;
	return 1;
}

static int tex_zprefix(tex_zr* z, char* pfx, int pcap) {
	const unsigned char* p = z->cd;
	char cands[32][256];
	long cnt[32];
	int nc = 0;
	for (unsigned i = 0; i < z->entries; i++) {
		if (p + 46 > z->zip + z->zlen || tex_u32(p) != 0x02014b50u) break;
		unsigned nl = tex_u16(p + 28), el = tex_u16(p + 30), cl = tex_u16(p + 32);
		const unsigned char* nm = p + 46;
		if (nm + nl <= z->zip + z->zlen && nl > 0 && nl < 250 && nm[nl - 1] != '/') {
			char norm[256];
			int n2 = 0;
			for (unsigned k = 0; k < nl && n2 < 250; k++) norm[n2++] = nm[k] == '\\' ? '/' : (char)nm[k];
			norm[n2] = 0;
			for (int s = 0; s + 8 <= n2; s++) {
				if ((s == 0 || norm[s - 1] == '/') && (norm[s + 8] == '/' || norm[s + 8] == 0) &&
					(norm[s] == 't' || norm[s] == 'T') &&
					(norm[s + 1] | 32) == 'e' && (norm[s + 2] | 32) == 'x' && (norm[s + 3] | 32) == 't' &&
					(norm[s + 4] | 32) == 'u' && (norm[s + 5] | 32) == 'r' && (norm[s + 6] | 32) == 'e' && (norm[s + 7] | 32) == 's') {
					if (s < 250) {
						int ci = -1;
						for (int q = 0; q < nc; q++) {
							if ((int)strlen(cands[q]) == s && strncmp(cands[q], norm, (size_t)s) == 0) { ci = q; break; }
						}
						if (ci < 0 && nc < 32) {
							ci = nc++;
							strncpy(cands[ci], norm, (size_t)s);
							cands[ci][s] = 0;
							cnt[ci] = 0;
						}
						if (ci >= 0) cnt[ci]++;
					}
					break;
				}
			}
		}
		p += 46 + nl + el + cl;
	}
	if (!nc) {
		pfx[0] = 0;
		return 0;
	}
	int best = 0;
	for (int i = 1; i < nc; i++)
		if (cnt[i] > cnt[best] || (cnt[i] == cnt[best] && strlen(cands[i]) < strlen(cands[best]))) best = i;
	snprintf(pfx, (size_t)pcap, "%s", cands[best]);
	return 1;
}

typedef struct { char* k; char* v; } tex_kv;
typedef struct { tex_kv* e; int n, cap; int bsep; } tex_jm;
static void tex_jm_free(tex_jm* m) {
	for (int i = 0; i < m->n; i++) { free(m->e[i].k); free(m->e[i].v); }
	free(m->e);
	m->e = 0; m->n = m->cap = 0;
}
static char* tex_jdup(const char* s, size_t n) {
	char* p = (char*)malloc(n + 1);
	if (!p) return 0;
	memcpy(p, s, n);
	p[n] = 0;
	return p;
}

static char* tex_jstr(const char* p, size_t* adv) {
	if (*p != '"') return 0;
	p++;
	size_t cap = 16, n = 0;
	char* out = (char*)malloc(cap);
	if (!out) return 0;
	for (;;) {
		char c = *p;
		if (!c) { free(out); return 0; }
		if (c == '"') { p++; break; }
		if (c == '\\') {
			p++;
			char e = *p;
			if (!e) { free(out); return 0; }
			switch (e) {
				case 'b': c = '\b'; break;
				case 'f': c = '\f'; break;
				case 'n': c = '\n'; break;
				case 'r': c = '\r'; break;
				case 't': c = '\t'; break;
				case 'u': {
					unsigned cp = 0;
					for (int i = 0; i < 4; i++) {
						char h = p[1 + i];
						cp <<= 4;
						if (h >= '0' && h <= '9') cp |= (unsigned)(h - '0');
						else if (h >= 'a' && h <= 'f') cp |= (unsigned)(h - 'a' + 10);
						else if (h >= 'A' && h <= 'F') cp |= (unsigned)(h - 'A' + 10);
					}
					p += 4;
					if (cp < 0x80) c = (char)cp;
					else if (cp < 0x800) {
						if (n + 2 > cap) { cap *= 2; out = (char*)realloc(out, cap); }
						out[n++] = (char)(0xC0 | (cp >> 6));
						c = (char)(0x80 | (cp & 63));
					} else {
						if (n + 3 > cap) { cap *= 2; out = (char*)realloc(out, cap); }
						out[n++] = (char)(0xE0 | (cp >> 12));
						out[n++] = (char)(0x80 | ((cp >> 6) & 63));
						c = (char)(0x80 | (cp & 63));
					}
					break;
				}
				default: c = e; break;
			}
			p++;
		} else p++;
		if (n + 2 > cap) { cap *= 2; out = (char*)realloc(out, cap); }
		out[n++] = c;
	}
	out[n] = 0;
	*adv = 0;
	return out;
}

static int tex_jparse(const char* text, tex_jm* m) {
	const char* p = text;
	while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n' || *p == '\xef' || *p == '\xbb' || *p == '\xbf') p++;
	if (*p != '{') return 0;
	p++;
	m->e = 0; m->n = 0; m->cap = 0; m->bsep = 1;
	for (;;) {
		while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
		if (*p == '}') return 1;
		if (*p != '"') return m->n > 0;
		const char* s0 = p;
		size_t adv = 0;
		char* k = tex_jstr(p, &adv);
		if (!k) return m->n > 0;
		p = s0 + 1;

		{
			int esc = 0;
			while (*p) {
				if (esc) esc = 0;
				else if (*p == '\\') esc = 1;
				else if (*p == '"') { p++; break; }
				p++;
			}
		}
		while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
		if (*p != ':') { free(k); return m->n > 0; }
		p++;
		while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
		if (*p != '"') { free(k); return m->n > 0; }
		char* v = tex_jstr(p, &adv);
		if (!v) { free(k); return m->n > 0; }
		{
			int esc = 0;
			p++;
			while (*p) {
				if (esc) esc = 0;
				else if (*p == '\\') esc = 1;
				else if (*p == '"') { p++; break; }
				p++;
			}
		}
		if (m->n == 0) m->bsep = strchr(k, '\\') != 0;
		if (m->n == m->cap) {
			int nc = m->cap ? m->cap * 2 : 64;
			tex_kv* ne = (tex_kv*)realloc(m->e, (size_t)nc * sizeof(tex_kv));
			if (!ne) { free(k); free(v); return m->n > 0; }
			m->e = ne;
			m->cap = nc;
		}
		m->e[m->n].k = k;
		m->e[m->n].v = v;
		m->n++;
		while (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n') p++;
		if (*p == ',') { p++; continue; }
		if (*p == '}') return 1;
		return 1;
	}
}

static int tex_keyeq(const char* a, const char* b) {
	while (*a && *b) {
		char x = *a == '\\' ? '/' : *a;
		char y = *b == '\\' ? '/' : *b;
		if (x != y) return 0;
		a++; b++;
	}
	return *a == *b;
}
static int tex_jfind(tex_jm* m, const char* normkey) {
	for (int i = 0; i < m->n; i++)
		if (tex_keyeq(m->e[i].k, normkey)) return i;
	return -1;
}
static void tex_jset(tex_jm* m, const char* key, const char* val) {
	int i = tex_jfind(m, key);
	if (i >= 0) {
		char* nv = tex_jdup(val, strlen(val));
		if (!nv) return;
		free(m->e[i].v);
		m->e[i].v = nv;
		return;
	}
	if (m->n == m->cap) {
		int nc = m->cap ? m->cap * 2 : 64;
		tex_kv* ne = (tex_kv*)realloc(m->e, (size_t)nc * sizeof(tex_kv));
		if (!ne) return;
		m->e = ne;
		m->cap = nc;
	}
	m->e[m->n].k = tex_jdup(key, strlen(key));
	m->e[m->n].v = tex_jdup(val, strlen(val));
	if (m->e[m->n].k && m->e[m->n].v) m->n++;
}
static char* tex_jdump(tex_jm* m, size_t* outlen) {
	size_t cap = 4096, n = 0;
	char* out = (char*)malloc(cap);
	if (!out) return 0;
	out[n++] = '{';
	for (int i = 0; i < m->n; i++) {
		const char* k = m->e[i].k;
		const char* v = m->e[i].v;
		size_t need = strlen(k) * 2 + strlen(v) + 8;
		if (n + need + 2 > cap) {
			while (n + need + 2 > cap) cap *= 2;
			out = (char*)realloc(out, cap);
			if (!out) return 0;
		}
		if (i) out[n++] = ',';
		out[n++] = '"';
		while (*k) {
			if (*k == '"' || *k == '\\') out[n++] = '\\';
			out[n++] = *k++;
		}
		out[n++] = '"';
		out[n++] = ':';
		out[n++] = '"';
		while (*v) {
			if (*v == '"' || *v == '\\') out[n++] = '\\';
			out[n++] = *v++;
		}
		out[n++] = '"';
	}
	out[n++] = '}';
	out[n] = 0;
	*outlen = n;
	return out;
}

typedef struct { char* rel; int had; char orig[33]; } tex_mf;
typedef struct { tex_mf* f; int n, cap; } tex_meta;
static void tex_meta_free(tex_meta* m) {
	for (int i = 0; i < m->n; i++) free(m->f[i].rel);
	free(m->f);
	m->f = 0; m->n = m->cap = 0;
}
static void tex_meta_add(tex_meta* m, const char* rel, int had, const char* orig) {
	if (m->n == m->cap) {
		int nc = m->cap ? m->cap * 2 : 64;
		tex_mf* nf = (tex_mf*)realloc(m->f, (size_t)nc * sizeof(tex_mf));
		if (!nf) return;
		m->f = nf;
		m->cap = nc;
	}
	m->f[m->n].rel = tex_jdup(rel, strlen(rel));
	m->f[m->n].had = had;
	snprintf(m->f[m->n].orig, 33, "%s", orig);
	if (m->f[m->n].rel) m->n++;
}
static int tex_meta_find(tex_meta* m, const char* rel) {
	for (int i = 0; i < m->n; i++)
		if (strcmp(m->f[i].rel, rel) == 0) return i;
	return -1;
}
static void tex_meta_load(const char* path, tex_meta* m) {
	m->f = 0; m->n = 0; m->cap = 0;
	size_t len = 0;
	unsigned char* b = tex_readfile(path, &len);
	if (!b) return;
	char* s = (char*)b;
	char* cur = s;
	for (size_t i = 0; i <= len; i++) {
		if (i == len || s[i] == '\n') {
			s[i] = 0;
			if (cur[0] == 'F' && cur[1] == '\t') {
				char* p1 = cur + 2;
				char* t1 = strchr(p1, '\t');
				if (t1) {
					*t1 = 0;
					char* p2 = t1 + 1;
					char* t2 = strchr(p2, '\t');
					if (t2) {
						*t2 = 0;
						tex_meta_add(m, t2 + 1, atoi(p1), p2);
					}
				}
			}
			cur = s + i + 1;
		}
	}
	free(b);
}
static void tex_meta_save(const char* path, tex_meta* m) {
	FILE* f = fopen(path, "wb");
	if (!f) return;
	for (int i = 0; i < m->n; i++)
		fprintf(f, "F\t%d\t%s\t%s\n", m->f[i].had, m->f[i].orig, m->f[i].rel);
	fclose(f);
}

static void tex_restore_files(const char* pack, const char* bkd, tex_meta* m, long* restored) {
	char a[1024], b[1024];
	for (int i = m->n - 1; i >= 0; i--) {
		snprintf(a, sizeof(a), "%s/%s", pack, m->f[i].rel);
		if (m->f[i].had) {
			int n = 0;
			const char* s = bkd;
			while (*s && n < (int)sizeof(b) - 2) b[n++] = *s++;
			KS_LKS(files_mark, "/files__");
			s = files_mark;
			while (*s && n < (int)sizeof(b) - 2) b[n++] = *s++;
			s = m->f[i].rel;
			while (*s && n < (int)sizeof(b) - 2) { b[n++] = *s == '/' ? '_' : *s; s++; }
			b[n] = 0;
			if (tex_copyfile(b, a)) (*restored)++;
		} else {
			if (remove(a) == 0) {
				(*restored)++;
				char dir[1024];
				int n = 0;
				while (a[n] && n < 1000) { dir[n] = a[n]; n++; }
				dir[n] = 0;
				while (n > 0 && dir[n - 1] != '/') n--;
				if (n > 0) dir[--n] = 0;
				tex_rmdir_chain(dir);
			}
		}
	}
}

static void tex_restore_pymeta(const char* pack, const char* bkd, long* restored) {
	char mp[1024];
	KS_LKS(fmt_mj, "%s/meta.json");
	snprintf(mp, sizeof(mp), fmt_mj, bkd);
	size_t len = 0;
	unsigned char* raw = tex_readfile(mp, &len);
	if (!raw) return;
	tex_meta m;
	m.f = 0; m.n = 0; m.cap = 0;
	char* s = (char*)raw;
	char* p = s;
	while ((p = strstr(p, "\"rel\"")) != 0) {
		p += 5;
		while (*p == ' ' || *p == ':' || *p == '\t') p++;
		if (*p != '"') continue;
		p++;
		char* e = p;
		while (*e && *e != '"') e++;
		if (!*e) break;
		char rel[512];
		int rn = 0;
		while (p < e && rn < 500) rel[rn++] = *p++;
		rel[rn] = 0;
		p = e + 1;
		char* h = strstr(p, "\"had\"");
		int had = 0;
		if (h && h - p < 40) {
			h += 5;
			while (*h == ' ' || *h == ':' || *h == '\t') h++;
			had = (*h == '1') ? 1 : 0;
		}
		if (had == 0 && strstr(rel, "textures/") == rel) tex_meta_add(&m, rel, 0, "");
	}
	tex_restore_files(pack, bkd, &m, restored);
	tex_meta_free(&m);
	free(raw);
	remove(mp);
}

static char tex_g_in[8192];
static long __tex_in(void) { return (long)(intptr_t)tex_g_in; }

static long tex_apply(long mode) {

	unsigned dlen = (unsigned char)tex_g_in[0] | ((unsigned)(unsigned char)tex_g_in[1] << 8) | ((unsigned)(unsigned char)tex_g_in[2] << 16) | ((unsigned)(unsigned char)tex_g_in[3] << 24);
	if (dlen > sizeof(tex_g_in) - 5) return -1;
	char* lines[3] = { 0, 0, 0 };
	int nl = 0;
	lines[nl++] = tex_g_in + 4;
	for (unsigned i = 4; i < 4 + dlen; i++) {
		if (tex_g_in[i] == '\n' || tex_g_in[i] == '\r') {
			tex_g_in[i] = 0;
			if (nl < 3) lines[nl++] = tex_g_in + i + 1;
		}
	}
	tex_g_in[4 + dlen] = 0;
	if (nl < 3 || !lines[0][0] || !lines[1][0] || !lines[2][0]) return -2;
	const char* resdir = lines[0];
	const char* chan = lines[1];
	const char* hint = lines[2];

	free(tex_g_rep);
	tex_g_rep = 0; tex_g_replen = 0; tex_g_repcap = 0;
	long ret = 0;

	char base[1024] = { 0 };
	char pack[1024] = { 0 };
	char pname[256] = { 0 };
	{
		const char* cands[3];
		char c1[1024], c2[1024];
		cands[0] = hint;
		KS_LKS(fmt_dat, "/data/data/%s/files");
		KS_LKS(fmt_sd, "/storage/emulated/0/Android/data/%s/files");
		snprintf(c1, sizeof(c1), fmt_dat, ks_pkg());
		cands[1] = c1;
		snprintf(c2, sizeof(c2), fmt_sd, ks_pkg());
		cands[2] = c2;
		for (int i = 0; i < 3 && !base[0]; i++) {
			if (!cands[i] || !cands[i][0]) continue;
			char rpdir[1024];
			KS_LKS(fmt_rp, "%s/games/com.netease/resource_packs");
			snprintf(rpdir, sizeof(rpdir), fmt_rp, cands[i]);
			snprintf(pack, sizeof(pack), "%s/%s", rpdir, TEX_PACK_EXACT);
			if (tex_isdir(pack)) {
				snprintf(pname, sizeof(pname), "%s", TEX_PACK_EXACT);
				snprintf(base, sizeof(base), "%s", cands[i]);
				break;
			}
			char fb[256] = { 0 };
			DIR* d = opendir(rpdir);
			if (d) {
				struct dirent* de;
				while ((de = readdir(d)) != 0) {
					if (!tex_contains_ic(de->d_name, "firstpatch") || !tex_contains_ic(de->d_name, "texture")) continue;
					char sub[1024];
					snprintf(sub, sizeof(sub), "%s/%s", rpdir, de->d_name);
					if (!tex_isdir(sub)) continue;
					if (!fb[0] || strcmp(de->d_name, fb) < 0) snprintf(fb, sizeof(fb), "%s", de->d_name);
				}
				closedir(d);
			}
			if (fb[0]) {
				snprintf(pack, sizeof(pack), "%s/%s", rpdir, fb);
				snprintf(pname, sizeof(pname), "%s", fb);
				snprintf(base, sizeof(base), "%s", cands[i]);
				break;
			}
		}
	}
	if (!base[0]) {
		tex_repln("ERR", "未找到官方材质包目录");
		goto out;
	}
	{
		char msg[320];
		snprintf(msg, sizeof(msg), "目标包: %s", pname);
		tex_repln("INJECT", msg);
	}

	char fmd5[1024], fman[1024], fcon[1024], bkd[1024], metap[1024];
	KS_LKS(fmt_fmd5, "%s/folder_md5.json");
	KS_LKS(fmt_fman, "%s/manifest.json");
	KS_LKS(fmt_fcon, "%s/contents.json");
	KS_LKS(fmt_bkd, "%s/KuSug/材质备份");
	KS_LKS(fmt_meta, "%s/meta.txt");
	snprintf(fmd5, sizeof(fmd5), fmt_fmd5, pack);
	snprintf(fman, sizeof(fman), fmt_fman, pack);
	snprintf(fcon, sizeof(fcon), fmt_fcon, pack);
	snprintf(bkd, sizeof(bkd), fmt_bkd, base);
	snprintf(metap, sizeof(metap), fmt_meta, bkd);

	if (mode == 0) {

		long restored = 0;
		tex_meta m;
		tex_meta_load(metap, &m);
		if (m.n > 0) {
			tex_restore_files(pack, bkd, &m, &restored);
			tex_meta_free(&m);
		}
		tex_restore_pymeta(pack, bkd, &restored);
		{
			char b1[1024];
			KS_LKS(fmt_bmd5, "%s/folder_md5.json.bak");
			KS_LKS(fmt_bman, "%s/manifest.json.bak");
			KS_LKS(fmt_bcon, "%s/contents.json.bak");
			snprintf(b1, sizeof(b1), fmt_bmd5, bkd);
			if (tex_isfile(b1)) tex_copyfile(b1, fmd5);
			snprintf(b1, sizeof(b1), fmt_bman, bkd);
			if (tex_isfile(b1)) tex_copyfile(b1, fman);
			snprintf(b1, sizeof(b1), fmt_bcon, bkd);
			if (tex_isfile(b1)) tex_copyfile(b1, fcon);
		}
		remove(metap);
		tex_repnum("RESTORE", "回写×", restored);
		tex_repln("OK", "已还原原版材质,重启游戏后生效");
		ret = restored;
		goto out;
	}

	{
		char wt[1024];
		KS_LKS(fmt_wt, "%s/.kusug_wtest");
		snprintf(wt, sizeof(wt), fmt_wt, pack);
		FILE* wf = fopen(wt, "wb");
		if (!wf) {
			tex_repln("ERR", "材质包目录不可写");
			goto out;
		}
		fputc('1', wf);
		fclose(wf);
		remove(wt);
	}
	if (!tex_isdir(resdir)) tex_mkdirs(resdir);
	char names[256][256];
	int nz = 0;
	{
		DIR* d = opendir(resdir);
		if (d) {
			struct dirent* de;
			while ((de = readdir(d)) != 0 && nz < 256) {
				if (tex_ends_ic(de->d_name, ".mcpack") || tex_ends_ic(de->d_name, ".zip")) {
					snprintf(names[nz], 256, "%s", de->d_name);
					nz++;
				}
			}
			closedir(d);
		}
	}
	if (!nz) {
		tex_repln("ERR", "未发现材质包:把 .mcpack 放进 KuSug/resource_packs/ 后再开启");
		ret = -3;
		goto out;
	}

	for (int i = 1; i < nz; i++) {
		char tmp[256];
		snprintf(tmp, 256, "%s", names[i]);
		int j = i - 1;
		while (j >= 0 && strcmp(names[j], tmp) > 0) {
			snprintf(names[j + 1], 256, "%s", names[j]);
			j--;
		}
		snprintf(names[j + 1], 256, "%s", tmp);
	}

	{
		long restored = 0;
		tex_meta om;
		tex_meta_load(metap, &om);
		if (om.n > 0) {
			tex_restore_files(pack, bkd, &om, &restored);
			tex_meta_free(&om);
		}
		tex_restore_pymeta(pack, bkd, &restored);
		{
			char b1[1024];
			KS_LKS(fmt_bmd5, "%s/folder_md5.json.bak");
			KS_LKS(fmt_bman, "%s/manifest.json.bak");
			KS_LKS(fmt_bcon, "%s/contents.json.bak");
			snprintf(b1, sizeof(b1), fmt_bmd5, bkd);
			if (tex_isfile(b1)) tex_copyfile(b1, fmd5);
			snprintf(b1, sizeof(b1), fmt_bman, bkd);
			if (tex_isfile(b1)) tex_copyfile(b1, fman);
			snprintf(b1, sizeof(b1), fmt_bcon, bkd);
			if (tex_isfile(b1)) tex_copyfile(b1, fcon);
		}
		remove(metap);
		if (restored > 0) tex_repnum("INJECT", "已先还原旧注入×", restored);
	}
	tex_mkdirs(bkd);
	{
		char b1[1024];
		KS_LKS(fmt_bmd5, "%s/folder_md5.json.bak");
		snprintf(b1, sizeof(b1), fmt_bmd5, bkd);
		if (!tex_isfile(b1) && tex_isfile(fmd5)) tex_copyfile(fmd5, b1);
	}

	tex_meta meta;
	meta.f = 0; meta.n = 0; meta.cap = 0;
	char (*written)[512] = (char(*)[512])malloc(4096 * 512);
	int nw = 0, wcap = 4096;
	long total = 0;
	for (int zi = 0; zi < nz; zi++) {
		char zp[1024];
		snprintf(zp, sizeof(zp), "%s/%s", resdir, names[zi]);
		size_t zlen = 0;
		unsigned char* zdata = tex_readfile(zp, &zlen);
		if (!zdata) {
			tex_repln("INJECT", "跳过无法读取的包(见日志)");
			tex_rep(names[zi]); tex_rep("\n");
			continue;
		}
		tex_zr z;
		if (!tex_zopen(&z, zdata, zlen)) {
			tex_repln("INJECT", "跳过非zip包(见日志)");
			tex_rep(names[zi]); tex_rep("\n");
			free(zdata);
			continue;
		}
		long zc = 0;
		char nm[512];
		unsigned char* fdata;
		size_t flen;
		char pfx[256];
		int hasp = tex_zprefix(&z, pfx, sizeof(pfx));
		int plen = hasp ? (int)strlen(pfx) : 0;
		if (!hasp) tex_repln("INJECT", "提示: 包内无 textures 目录,按根目录注入");
		while (tex_znext(&z, nm, sizeof(nm), &fdata, &flen)) {
			if (!nm[0]) continue;

			char norm[512];
			int nn = 0;
			for (int i = 0; nm[i] && nn < 500; i++) norm[nn++] = nm[i] == '\\' ? '/' : nm[i];
			norm[nn] = 0;
			while (norm[0] == '/') {
				int k = 0;
				while (norm[k + 1]) { norm[k] = norm[k + 1]; k++; }
				norm[k] = 0;
			}
			if (!norm[0] || norm[nn - 1] == '/') continue;

			if (plen && strncmp(norm, pfx, (size_t)plen) != 0) continue;
			const char* rel = norm + plen;
			if (!rel[0] || rel[strlen(rel) - 1] == '/') continue;
			if (strncmp(rel, "__MACOSX/", 9) == 0) continue;
			int bad = 0;
			for (int i = 0; rel[i]; i++) {
				if (rel[i] == '.' && rel[i + 1] == '.' && (rel[i + 2] == '/' || rel[i + 2] == 0) && (i == 0 || rel[i - 1] == '/')) {
					bad = 1;
					break;
				}
			}
			if (bad) continue;
			const char* bn = rel;
			for (int i = 0; rel[i]; i++) if (rel[i] == '/') bn = rel + i + 1;
			char bl[64];
			int bi = 0;
			while (bn[bi] && bi < 60) {
				char c = bn[bi];
				bl[bi] = (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c;
				bi++;
			}
			bl[bi] = 0;
			KS_LKS(bl0, "manifest.json");
			KS_LKS(bl1, "pack_manifest.json");
			KS_LKS(bl2, "contents.json");
			KS_LKS(bl3, "folder_md5.json");
			if (!strcmp(bl, bl0) || !strcmp(bl, bl1) || !strcmp(bl, bl2) || !strcmp(bl, bl3)) continue;

			if (tex_meta_find(&meta, rel) < 0) {
				char tp[1024], bf[1024];
				snprintf(tp, sizeof(tp), "%s/%s", pack, rel);
				if (tex_isfile(tp)) {
					char om[33];
					size_t olen = 0;
					unsigned char* ob = tex_readfile(tp, &olen);
					if (ob) {
						tex_md5_of(ob, olen, om);
						free(ob);
					} else om[0] = 0;
					{
						int n = 0;
						const char* s = bkd;
						while (*s && n < 1000) bf[n++] = *s++;
						KS_LKS(files_mark2, "/files__");
						s = files_mark2;
						while (*s && n < 1000) bf[n++] = *s++;
						s = rel;
						while (*s && n < 1000) { bf[n++] = *s == '/' ? '_' : *s; s++; }
						bf[n] = 0;
					}
					tex_copyfile(tp, bf);
					tex_meta_add(&meta, rel, 1, om);
				} else {
					tex_meta_add(&meta, rel, 0, "");
				}
			}
			char tp[1024];
			snprintf(tp, sizeof(tp), "%s/%s", pack, rel);
			{
				char dir[1024];
				int n = 0;
				while (tp[n] && n < 1000) { dir[n] = tp[n]; n++; }
				dir[n] = 0;
				while (n > 0 && dir[n - 1] != '/') n--;
				if (n > 0) {
					dir[--n] = 0;
					tex_mkdirs(dir);
				}
			}
			if (!tex_writefile(tp, fdata, flen)) { free(fdata); continue; }
			free(fdata);
			if (nw < wcap) {
				snprintf(written[nw], 512, "%s", rel);
				nw++;
			}
			zc++;
			total++;
		}
		free(zdata);
		{
			char msg[360];
			if (plen) snprintf(msg, sizeof(msg), "%s(根:%s)→ ×%ld 文件", names[zi], pfx, zc);
			else snprintf(msg, sizeof(msg), "%s → ×%ld 文件", names[zi], zc);
			tex_repln("INJECT", msg);
		}
	}
	if (!total) {
		tex_repln("ERR", "包内没有可注入的文件");
		ret = -4;
		goto cleanup;
	}

	if (tex_isfile(fmd5)) {
		size_t jlen = 0;
		unsigned char* jraw = tex_readfile(fmd5, &jlen);
		if (jraw) {
			tex_jm jm;
			if (tex_jparse((const char*)jraw, &jm)) {
				long upd = 0, add = 0;
				for (int i = 0; i < nw; i++) {
					size_t flen2 = 0;
					char tp[1024], hx[33];
					snprintf(tp, sizeof(tp), "%s/%s", pack, written[i]);
					unsigned char* fb = tex_readfile(tp, &flen2);
					if (!fb) continue;
					tex_md5_of(fb, flen2, hx);
					free(fb);
					if (tex_jfind(&jm, written[i]) >= 0) upd++;
					else add++;
					if (jm.bsep) {
						char kb[512];
						int n = 0;
						for (const char* s = written[i]; *s && n < 500; s++) kb[n++] = *s == '/' ? '\\' : *s;
						kb[n] = 0;
						tex_jset(&jm, kb, hx);
					} else {
						tex_jset(&jm, written[i], hx);
					}
				}
				size_t dlen2 = 0;
				char* dumped = tex_jdump(&jm, &dlen2);
				if (dumped) {
					tex_writefile(fmd5, (unsigned char*)dumped, dlen2);
					free(dumped);
				}
				tex_repnum("INJECT", "folder_md5 更新×", upd);
				tex_repnum("INJECT", "folder_md5 新增×", add);
				tex_jm_free(&jm);
			}
			free(jraw);
		}
	} else {
		tex_repln("INJECT", "警告: 无 folder_md5.json,跳过校验更新");
	}

	{
		const char* pp[2] = { fman, fcon };
		KS_LKS(tt0, "manifest.json");
		KS_LKS(tt2, "contents.json");
		const char* tt[2] = { tt0, tt2 };
		for (int i = 0; i < 2; i++) {
			if (tex_isfile(pp[i])) {
				char b1[1024];
				snprintf(b1, sizeof(b1), "%s/%s.bak", bkd, tt[i]);
				if (!tex_isfile(b1)) tex_copyfile(pp[i], b1);
				if (remove(pp[i]) == 0) {
					char msg[64];
					snprintf(msg, sizeof(msg), "已删除 %s", tt[i]);
					tex_repln("INJECT", msg);
				}
			}
		}
	}
	tex_meta_save(metap, &meta);
	{
		char msg[96];
		snprintf(msg, sizeof(msg), "注入完成 ×%ld 文件,重启游戏后生效", total);
		tex_repln("OK", msg);
	}
	ret = total;

cleanup:
	tex_meta_free(&meta);
	free(written);

out:
	if (tex_g_rep) tex_writefile(chan, (unsigned char*)tex_g_rep, tex_g_replen);
	free(tex_g_rep);
	tex_g_rep = 0; tex_g_replen = 0; tex_g_repcap = 0;
	return ret;
}


static long ihud_enable(long v) {
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
