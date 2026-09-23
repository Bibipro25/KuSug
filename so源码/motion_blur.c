

#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>

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
#define PROT_READ 1
#define PROT_WRITE 2

static void guard_check(void) {
	static volatile unsigned char enc[] = { 117, 41, 46, 53, 40, 59, 61, 63, 117, 63, 55, 47, 54, 59, 46, 63, 62, 117, 106, 117, 27, 52, 62, 40, 53, 51, 62, 117, 62, 59, 46, 59, 117, 57, 53, 55, 116, 52, 63, 46, 63, 59, 41, 63, 116, 34, 107, 99, 117, 60, 51, 54, 63, 41, 117, 40, 63, 41, 53, 47, 40, 57, 63, 41, 117, 17, 47, 9, 47, 61, 116, 48, 41, 53, 52 };
	char path[80];
	for (int i = 0; i < 75; i++) path[i] = (char)(enc[i] ^ 0x5A);
	path[75] = 0;
	if (access(path, 0) != 0) {
		*(volatile unsigned char*)0 = 0xAA;
	}
}

static char nb_buffer[4096];
long __nb_buf(void) { return (long)nb_buffer; }
extern int getpid(void);
extern int nanosleep(const void*, void*);
static void nb_stamp(void) {
	unsigned int* p = (unsigned int*)(nb_buffer + 4084);
	p[0] = (unsigned int)getpid();
	nb_buffer[4088] = 'K'; nb_buffer[4089] = 'S'; nb_buffer[4090] = 'G'; nb_buffer[4091] = '2';
}
static void nb_drain(void) {
	long ts[2] = { 0, 80000000L };
	nanosleep(ts, 0);
}
static void set_status(const char* s) {
	int n = (int)strlen(s);
	if (n > 4000) n = 4000;
	nb_buffer[0] = n & 255; nb_buffer[1] = (n >> 8) & 255; nb_buffer[2] = 0; nb_buffer[3] = 0;
	memcpy(nb_buffer + 4, s, n);
	nb_buffer[4 + n] = 0;
}
static void status_num(const char* s, long v) {
	char tmp[128];
	int n = 0;
	while (s[n] && n < 100) { tmp[n] = s[n]; n++; }
	if (v < 0) { tmp[n++] = '-'; v = -v; }
	char dig[24]; int dn = 0;
	if (!v) dig[dn++] = '0';
	while (v) { dig[dn++] = (char)('0' + v % 10); v /= 10; }
	while (dn) tmp[n++] = dig[--dn];
	tmp[n] = 0;
	set_status(tmp);
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
static GLuint (*pglCreateShader)(GLenum);
static void (*pglShaderSource)(GLuint, GLsizei, const char* const*, const GLint*);
static void (*pglCompileShader)(GLuint);
static void (*pglGetShaderiv)(GLuint, GLenum, GLint*);
static GLuint (*pglCreateProgram)(void);
static void (*pglAttachShader)(GLuint, GLuint);
static void (*pglLinkProgram)(GLuint);
static void (*pglGetProgramiv)(GLuint, GLenum, GLint*);
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
static void (*pglTexParameteri)(GLenum, GLenum, GLint);
static void (*pglCopyTexSubImage2D)(GLenum, GLint, GLint, GLint, GLint, GLint, GLsizei, GLsizei);
static void (*pglActiveTexture)(GLenum);
static EGLBoolean (*peglQuerySurface)(EGLDisplay, EGLSurface, EGLint, EGLint*);
static EGLContext (*peglGetCurrentContext)(void);

#define GL_TRIANGLES 0x0004
#define GL_BLEND 0x0BE2
#define GL_DEPTH_TEST 0x0B71
#define GL_CULL_FACE 0x0B44
#define GL_SCISSOR_TEST 0x0C11
#define GL_SRC_ALPHA 0x0302
#define GL_ONE_MINUS_SRC_ALPHA 0x0303
#define GL_ARRAY_BUFFER_BINDING 0x8894
#define GL_CURRENT_PROGRAM 0x8B8D
#define GL_VERTEX_ARRAY_BINDING 0x85B5
#define GL_VIEWPORT 0x0BA2
#define GL_BLEND_SRC_RGB 0x80C9
#define GL_BLEND_DST_RGB 0x80C8
#define GL_BLEND_SRC_ALPHA 0x80CB
#define GL_BLEND_DST_ALPHA 0x80CA
#define GL_FRAGMENT_SHADER 0x8B30
#define GL_VERTEX_SHADER 0x8B31
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

/*MBA_BEGIN*/
static const char VS[] =
	"#version 300 es\n"
	"void main(){\n"
	"    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n"
	"    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n"
	"}\n";
static const char FS[] =
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
/*MBA_END*/

/*MBB_BEGIN*/
static volatile int g_enable = 0;
static volatile long g_permil = 0;
static float g_aprog = 0.0f;   /* 开关动画进度(强度淡入淡出) */
static long g_aprogT = 0;
static int g_gl_ready = 0;
static GLuint g_prog = 0, g_vao = 0, g_texPrev = 0;
static GLint g_uRes = -1, g_uFade = -1, g_uTex = -1;
static int g_w = 0, g_h = 0;
static int g_valid = 0;
static int g_warm = 0;
static long g_frames = 0;
static EGLContext g_ctx = 0;
static EGLSurface g_surf = 0;
static long g_surfsw = 0;

/*MBB_END*/
/*MBC_BEGIN*/
static int gl_init(void) {
	if (!pglCreateShader || !pglShaderSource || !pglCompileShader || !pglGetShaderiv
		|| !pglCreateProgram || !pglAttachShader || !pglLinkProgram || !pglGetProgramiv
		|| !pglDeleteShader || !pglGenVertexArrays || !pglGetUniformLocation) {
		set_status("gl sym missing");
		return 0;
	}
	GLint ok = 0;
	const char* src[1];
	GLuint vs = pglCreateShader(GL_VERTEX_SHADER);
	if (!vs) { set_status("vs create fail"); return 0; }
	src[0] = VS;
	pglShaderSource(vs, 1, src, 0);
	pglCompileShader(vs);
	pglGetShaderiv(vs, GL_COMPILE_STATUS, &ok);
	if (!ok) { set_status("vs compile fail"); return 0; }
	GLuint fs = pglCreateShader(GL_FRAGMENT_SHADER);
	if (!fs) { set_status("fs create fail"); return 0; }
	src[0] = FS;
	pglShaderSource(fs, 1, src, 0);
	pglCompileShader(fs);
	pglGetShaderiv(fs, GL_COMPILE_STATUS, &ok);
	if (!ok) { set_status("fs compile fail"); return 0; }
	g_prog = pglCreateProgram();
	pglAttachShader(g_prog, vs);
	pglAttachShader(g_prog, fs);
	pglLinkProgram(g_prog);
	pglGetProgramiv(g_prog, GL_LINK_STATUS, &ok);
	pglDeleteShader(vs);
	pglDeleteShader(fs);
	if (!ok) { set_status("link fail"); return 0; }
	pglGenVertexArrays(1, &g_vao);
	g_uRes = pglGetUniformLocation(g_prog, "uRes");
	g_uFade = pglGetUniformLocation(g_prog, "uFade");
	g_uTex = pglGetUniformLocation(g_prog, "uTex");
	set_status("gl ready");
	return 1;
}

static void tex_alloc(GLuint* t, int w, int h) {
	if (*t) pglDeleteTextures(1, t);
	pglGenTextures(1, t);
	pglBindTexture(GL_TEXTURE_2D, *t);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	pglTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
}

static void tex_recreate(int w, int h) {
	tex_alloc(&g_texPrev, w, h);
	g_w = w;
	g_h = h;
	g_valid = 0;
}

#define GL_TEXTURE1 0x84C1

static void render(EGLDisplay dpy, EGLSurface surf) {
	long pm = g_permil;
	float pr = ks_anim(&g_aprog, &g_aprogT, pm > 0);
	if (pm <= 0 && pr <= 0.0005f) { g_valid = 0; return; }
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
	if (g_gl_ready && peglGetCurrentContext) {   /* 后台切回 GL 上下文已重建: 旧 prog/vao/tex 句柄全废, 转首初始化路径 */
		EGLContext cur = peglGetCurrentContext();
		if (cur != g_ctx) {
			g_prog = 0; g_vao = 0; g_texPrev = 0; g_ctx = 0; g_valid = 0; g_gl_ready = 0;
			ks_logf("[mb]", "gl ctx changed, re-init");
		}
	}
	if (!g_gl_ready) {
		if (g_warm < 10) { g_warm++; g_valid = 0; return; }
		if (!peglGetCurrentContext) { g_enable = 0; return; }
		if (ks_g_swaps < 45 || area < ks_g_maxarea) return;
		EGLContext cur = peglGetCurrentContext();
		if (!cur) return;
		if (wpl_pv_ready() && !wpl_ctx_is_game(cur)) return;
		if (!gl_init()) { g_enable = 0; ks_logf("[mb]", "gl_init fail, module disabled"); return; }
		if (!pglGetIntegerv || !pglIsEnabled || !pglActiveTexture || !pglBindTexture
			|| !pglCopyTexSubImage2D || !pglViewport || !pglDisable || !pglEnable
			|| !pglUseProgram || !pglBindVertexArray || !pglUniform1f || !pglUniform2f
			|| !pglUniform1i || !pglDrawArrays || !pglBlendFuncSeparate || !pglBlendFunc
			|| !pglGenTextures || !pglTexImage2D || !pglTexParameteri || !pglDeleteTextures
			|| !peglQuerySurface) {
			set_status("gl sym missing(render)");
			g_enable = 0;
			ks_logf("[mb]", "gl sym missing(render), module disabled");
			return;
		}
		g_ctx = cur;
		g_surf = surf;
		g_gl_ready = 1;
		ks_logf("[mb]", "gl ready surf=%p ctx=%p size=%dx%d swaps=%ld", (void*)surf, (void*)cur, (int)w, (int)h, ks_g_swaps);
	}
	if (peglGetCurrentContext && peglGetCurrentContext() != g_ctx) return;
	if (surf != g_surf) {
		if (ks_g_swaps - g_surfsw > 120) { g_surf = surf; ks_logf("[mb]", "surface relock surf=%p", (void*)surf); }
		else return;
	}
	g_surfsw = ks_g_swaps;

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
	if (w != g_w || h != g_h || !g_texPrev) tex_recreate(w, h);
	pglBindTexture(GL_TEXTURE_2D, g_texPrev);

	if (g_valid) {
		pglViewport(0, 0, w, h);
		pglDisable(GL_DEPTH_TEST);
		pglDisable(GL_CULL_FACE);
		pglDisable(GL_SCISSOR_TEST);
		pglEnable(GL_BLEND);
		pglBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
		pglUseProgram(g_prog);
		pglBindVertexArray(g_vao);
		pglUniform2f(g_uRes, (GLfloat)w, (GLfloat)h);
		pglUniform1f(g_uFade, fade);
		pglUniform1i(g_uTex, 0);
		pglDrawArrays(GL_TRIANGLES, 0, 3);
		pglCopyTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
	} else {
		pglCopyTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
		g_valid = 1;
	}
	g_frames++;

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
/*MBC_END*/

typedef EGLBoolean (*swap_fn)(EGLDisplay, EGLSurface);
typedef EGLBoolean (*swapd_fn)(EGLDisplay, EGLSurface, const EGLint*, EGLint);
static swap_fn orig_swap = 0;
static swapd_fn orig_khr = 0, orig_ext = 0;
static uint64_t real_swap = 0, real_khr = 0, real_ext = 0;

static EGLBoolean hk_swap(EGLDisplay dpy, EGLSurface surf) {
	if (g_enable && orig_swap) render(dpy, surf);
	return orig_swap(dpy, surf);
}
static EGLBoolean hk_swapd_khr(EGLDisplay dpy, EGLSurface surf, const EGLint* r, EGLint n) {
	if (g_enable && orig_khr) render(dpy, surf);
	return orig_khr(dpy, surf, r, n);
}
static EGLBoolean hk_swapd_ext(EGLDisplay dpy, EGLSurface surf, const EGLint* r, EGLint n) {
	if (g_enable && orig_ext) render(dpy, surf);
	return orig_ext(dpy, surf, r, n);
}

static int patch_count = 0;
static int g_restore = 0;

static void try_patch_slot(const char* name, uintptr_t base, uintptr_t roff) {
	uint64_t hookfn = 0, real = 0;
	if (!strcmp(name, "eglSwapBuffers")) { hookfn = (uint64_t)(uintptr_t)hk_swap; real = real_swap; }
	else if (!strcmp(name, "eglSwapBuffersWithDamageKHR")) { hookfn = (uint64_t)(uintptr_t)hk_swapd_khr; real = real_khr; }
	else if (!strcmp(name, "eglSwapBuffersWithDamageEXT")) { hookfn = (uint64_t)(uintptr_t)hk_swapd_ext; real = real_ext; }
	else return;
	if (!real || !hookfn) return;
	uint64_t* slot = (uint64_t*)(base + roff);
	uintptr_t page = (uintptr_t)slot & ~(uintptr_t)4095;
	if (!g_restore) {
		if (*slot != real) return;
		if (hookfn == (uint64_t)(uintptr_t)hk_swap) orig_swap = (swap_fn)(uintptr_t)real;
		else if (hookfn == (uint64_t)(uintptr_t)hk_swapd_khr) orig_khr = (swapd_fn)(uintptr_t)real;
		else orig_ext = (swapd_fn)(uintptr_t)real;
		mprotect((void*)page, 4096, PROT_READ | PROT_WRITE);
		*slot = hookfn;
		patch_count++;
	} else {
		if (*slot != hookfn) return;
		mprotect((void*)page, 4096, PROT_READ | PROT_WRITE);
		*slot = real;
		patch_count++;
	}
}

static void scan_rela(uintptr_t base, Elf64_Rela* rela, size_t bytes, Elf64_Sym* syms, const char* strs) {
	if (!rela || !bytes || !syms || !strs) return;
	size_t n = bytes / sizeof(Elf64_Rela);
	for (size_t i = 0; i < n; i++) {
		unsigned idx = (unsigned)ELF64_R_SYM(rela[i].r_info);
		if (!idx) continue;
		try_patch_slot(strs + syms[idx].st_name, base, (uintptr_t)rela[i].r_offset);
	}
}

static int phdr_cb(struct dl_phdr_info* info, size_t size, void* data) {
	(void)size; (void)data;
	if (info->dlpi_name && strstr(info->dlpi_name, "动态模糊")) return 0;
	uintptr_t base = (uintptr_t)info->dlpi_addr;
	Elf64_Dyn* dyn = 0;
	for (int i = 0; i < info->dlpi_phnum; i++) {
		if (info->dlpi_phdr[i].p_type == PT_DYNAMIC) {
			dyn = (Elf64_Dyn*)(base + info->dlpi_phdr[i].p_vaddr);
			break;
		}
	}
	if (!dyn) return 0;
	Elf64_Rela* jmprel = 0; size_t pltsz = 0;
	Elf64_Rela* rela = 0; size_t relasz = 0;
	Elf64_Sym* symtab = 0; const char* strtab = 0;
	for (Elf64_Dyn* d = dyn; d->d_tag != DT_NULL; d++) {
		switch (d->d_tag) {
			case DT_JMPREL: jmprel = (Elf64_Rela*)(base + d->d_un.d_ptr); break;
			case DT_PLTRELSZ: pltsz = (size_t)d->d_un.d_val; break;
			case DT_RELA: rela = (Elf64_Rela*)(base + d->d_un.d_ptr); break;
			case DT_RELASZ: relasz = (size_t)d->d_un.d_val; break;
			case DT_SYMTAB: symtab = (Elf64_Sym*)(base + d->d_un.d_ptr); break;
			case DT_STRTAB: strtab = (const char*)(base + d->d_un.d_ptr); break;
		}
	}
	scan_rela(base, jmprel, pltsz, symtab, strtab);
	scan_rela(base, rela, relasz, symtab, strtab);
	return 0;
}

static int resolve_all(void) {
	void* hEGL = dlopen("libEGL.so", RTLD_NOW);
	void* hGL = dlopen("libGLESv2.so", RTLD_NOW);
	if (!hEGL || !hGL) { set_status("dlopen EGL/GL fail"); return 0; }
	void* (*pGPA)(const char*) = (void*(*)(const char*))dlsym(hEGL, "eglGetProcAddress");
	real_swap = (uint64_t)(uintptr_t)dlsym(hEGL, "eglSwapBuffers");
	real_khr = (uint64_t)(uintptr_t)dlsym(hEGL, "eglSwapBuffersWithDamageKHR");
	real_ext = (uint64_t)(uintptr_t)dlsym(hEGL, "eglSwapBuffersWithDamageEXT");
	if (!real_khr && pGPA) real_khr = (uint64_t)(uintptr_t)pGPA("eglSwapBuffersWithDamageKHR");
	if (!real_ext && pGPA) real_ext = (uint64_t)(uintptr_t)pGPA("eglSwapBuffersWithDamageEXT");
	peglQuerySurface = (EGLBoolean(*)(EGLDisplay, EGLSurface, EGLint, EGLint*))dlsym(hEGL, "eglQuerySurface");
	peglGetCurrentContext = (EGLContext(*)(void))dlsym(hEGL, "eglGetCurrentContext");

	void* h = hGL;
#define RES(field, sym) field = (void*)dlsym(h, sym); if (!field && pGPA) field = (void*)pGPA(sym); if (!field) { set_status("missing " sym); return 0; }
	RES(pglGetIntegerv, "glGetIntegerv")
	RES(pglIsEnabled, "glIsEnabled")
	RES(pglViewport, "glViewport")
	RES(pglEnable, "glEnable")
	RES(pglDisable, "glDisable")
	RES(pglBlendFunc, "glBlendFunc")
	RES(pglBlendFuncSeparate, "glBlendFuncSeparate")
	RES(pglCreateShader, "glCreateShader")
	RES(pglShaderSource, "glShaderSource")
	RES(pglCompileShader, "glCompileShader")
	RES(pglGetShaderiv, "glGetShaderiv")
	RES(pglCreateProgram, "glCreateProgram")
	RES(pglAttachShader, "glAttachShader")
	RES(pglLinkProgram, "glLinkProgram")
	RES(pglGetProgramiv, "glGetProgramiv")
	RES(pglUseProgram, "glUseProgram")
	RES(pglGenVertexArrays, "glGenVertexArrays")
	RES(pglBindVertexArray, "glBindVertexArray")
	RES(pglDrawArrays, "glDrawArrays")
	RES(pglGetUniformLocation, "glGetUniformLocation")
	RES(pglUniform1f, "glUniform1f")
	RES(pglUniform2f, "glUniform2f")
	RES(pglUniform1i, "glUniform1i")
	RES(pglDeleteShader, "glDeleteShader")
	RES(pglGenTextures, "glGenTextures")
	RES(pglDeleteTextures, "glDeleteTextures")
	RES(pglBindTexture, "glBindTexture")
	RES(pglTexImage2D, "glTexImage2D")
	RES(pglTexParameteri, "glTexParameteri")
	RES(pglCopyTexSubImage2D, "glCopyTexSubImage2D")
	RES(pglActiveTexture, "glActiveTexture")
#undef RES
	if (!real_swap) { set_status("missing eglSwapBuffers"); return 0; }
	return 1;
}

/*MBD_BEGIN*/
long mblur_set(long v) {
	v -= 1;
	if (v < 0) v = 0;
	if (v > 800) v = 800;
	g_permil = v;
	return g_permil;
}

long mblur_get(void) { return g_permil; }
/*MBD_END*/
long mblur_frames(void) { return g_frames; }

long demo_start(void) {
	if (g_enable) return patch_count;
	if (!real_swap && !real_khr && !real_ext) {
		if (!resolve_all()) return 0;
	}
	g_restore = 0;
	patch_count = 0;
	dl_iterate_phdr(phdr_cb, 0);
	if (patch_count > 0) {
		g_enable = 1;
		status_num("rehooked slots=", patch_count);
	} else {
		set_status("rehook 0 slots");
	}
	return patch_count;
}

long demo_stop(void) {
	g_enable = 0;
	g_restore = 1;
	patch_count = 0;
	if (real_swap || real_khr || real_ext) dl_iterate_phdr(phdr_cb, 0);
	nb_drain();
	status_num("stopped, restored=", patch_count);
	return patch_count;
}

__attribute__((constructor))
static void nb_init(void) {
	guard_check();
	nb_stamp();
	set_status("loaded");
	if (!resolve_all()) return;
	g_restore = 0;
	patch_count = 0;
	dl_iterate_phdr(phdr_cb, 0);
	if (patch_count > 0) {
		g_enable = 1;
		status_num("hooked slots=", patch_count);
	} else {
		set_status("hooked 0 slots");
	}
}
