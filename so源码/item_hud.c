#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
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
	nb_buffer[0] = n & 255; nb_buffer[1] = (n >> 8) & 255; nb_buffer[2] = (n >> 16) & 255; nb_buffer[3] = (n >> 24) & 255;
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

static unsigned char* g_ttf = 0;
static stbtt_fontinfo g_font;
static int g_font_ok = 0;
static int g_font_tried = 0;
static char g_font_path[192];

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
	if (g_ttf) free(g_ttf);
	g_ttf = buf;
	g_font = fi;
	g_font_ok = 1;
	strncpy(g_font_path, path, 191);
	g_font_path[191] = 0;
	return 1;
}

static int load_sysfont(void) {
	g_font_tried = 1;
	char fp[192];
	ks_res_path(fp, sizeof(fp), "kusug/so/font.ttf");
	if (try_font_file(fp, 1)) {
		status_num("ttf cjk ok ", 1);
		return 1;
	}
	set_status("font missing");
	return 0;
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
static void (*pglGetProgramInfoLog)(GLuint, GLsizei, GLsizei*, char*);
static void (*pglGetShaderInfoLog)(GLuint, GLsizei, GLsizei*, char*);
static void (*pglUseProgram)(GLuint);
static void (*pglGenVertexArrays)(GLsizei, GLuint*);
static void (*pglBindVertexArray)(GLuint);
static void (*pglDrawArrays)(GLenum, GLint, GLsizei);
static GLint (*pglGetUniformLocation)(GLuint, const char*);
static void (*pglUniform2f)(GLint, GLfloat, GLfloat);
static void (*pglUniform1i)(GLint, GLint);
static void (*pglDeleteShader)(GLuint);
static void (*pglGenTextures)(GLsizei, GLuint*);
static void (*pglDeleteTextures)(GLsizei, const GLuint*);
static void (*pglBindTexture)(GLenum, GLuint);
static void (*pglActiveTexture)(GLenum);
static void (*pglTexImage2D)(GLenum, GLint, GLenum, GLsizei, GLsizei, GLint, GLenum, GLenum, const void*);
static void (*pglTexParameteri)(GLenum, GLenum, GLint);
static EGLBoolean (*peglQuerySurface)(EGLDisplay, EGLSurface, EGLint, EGLint*);
static EGLContext (*peglGetCurrentContext)(void);

#define GL_TRIANGLE_STRIP 0x0005
#define GL_BLEND 0x0BE2
#define GL_DEPTH_TEST 0x0B71
#define GL_CULL_FACE 0x0B44
#define GL_SCISSOR_TEST 0x0C11
#define GL_SRC_ALPHA 0x0302
#define GL_ONE_MINUS_SRC_ALPHA 0x0303
#define GL_ARRAY_BUFFER_BINDING 0x8894
#define GL_CURRENT_PROGRAM 0x8B8D
#define GL_BLEND_SRC_RGB 0x80C9
#define GL_BLEND_DST_RGB 0x80C8
#define GL_BLEND_SRC_ALPHA 0x80CB
#define GL_BLEND_DST_ALPHA 0x80CA
#define GL_VERTEX_ARRAY_BINDING 0x85B5
#define GL_VIEWPORT 0x0BA2
#define GL_COMPILE_STATUS 0x8B81
#define GL_LINK_STATUS 0x8B82
#define GL_FRAGMENT_SHADER 0x8B30
#define GL_VERTEX_SHADER 0x8B31
#define GL_TEXTURE_2D 0x0DE1
#define GL_TEXTURE_BINDING_2D 0x8069
#define GL_TEXTURE0 0x84C0
#define GL_ACTIVE_TEXTURE 0x84E0
#define GL_TEXTURE_MIN_FILTER 0x2801
#define GL_TEXTURE_MAG_FILTER 0x2800
#define GL_TEXTURE_WRAP_S 0x2802
#define GL_TEXTURE_WRAP_T 0x2803
#define GL_LINEAR 0x2601
#define GL_CLAMP_TO_EDGE 0x812F
#define GL_RGBA 0x1908
#define GL_UNSIGNED_BYTE 0x1401
#define EGL_WIDTH 0x3057
#define EGL_HEIGHT 0x3056

static const char VS[] =
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
static const char FS[] =
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

/*IHA_BEGIN*/
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
static row_t g_rows[MAXROWS];
static volatile int g_lock = 0;
static volatile long g_maxrows = MAXROWS;

static char ih_in[8224];
long __ihud_in(void) { return (long)ih_in; }

long ihud_sync(void) {
	g_lock = 1;
	uint32_t n = (uint8_t)ih_in[0] | ((uint32_t)(uint8_t)ih_in[1] << 8) | ((uint32_t)(uint8_t)ih_in[2] << 16) | ((uint32_t)(uint8_t)ih_in[3] << 24);
	if (n > 8000) n = 8000;
	char* buf = ih_in + 4;
	buf[n] = 0;
	for (int i = 0; i < MAXROWS; i++) g_rows[i].talpha = 0;
	int idx = 0;
	long cap = g_maxrows;
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
					if (g_rows[i].used && !strcmp(g_rows[i].name, p)) { slot = i; break; }
				}
				if (slot < 0) {
					for (int i = 0; i < MAXROWS; i++) {
						if (!g_rows[i].used) { slot = i; break; }
					}
					if (slot >= 0) {
						memset(&g_rows[slot], 0, sizeof(row_t));
						strncpy(g_rows[slot].name, p, 63);
						g_rows[slot].used = 1;
						g_rows[slot].y = (float)idx + 0.7f;
						g_rows[slot].flash = 1.0f;
					}
				}
					if (slot >= 0) {
						if (g_rows[slot].count != cnt) g_rows[slot].flash = 1.0f;
						g_rows[slot].count = cnt;
						g_rows[slot].ty = (float)idx;
						g_rows[slot].talpha = 1.0f;
						idx++;
					}
			}
		}
		p = next;
	}
	g_lock = 0;
	return idx;
}

#define MAXPW 560
#define MAXPH 1060
static uint8_t g_pix[MAXPW * MAXPH * 4];

#define GCHASH 512
typedef struct { int cp; float scale; int w, h, x0, y0; float adv; unsigned char* bits; } gc_t;
static gc_t g_gc[GCHASH];
static float g_px = 0.0f, g_scale = 0.0f, g_asc = 0.0f, g_desc = 0.0f;

static void gc_fill(gc_t* g, int cp) {
	int x0 = 0, y0 = 0, x1 = 0, y1 = 0, adv = 0, lsb = 0;
	if (stbtt_FindGlyphIndex(&g_font, cp) == 0) cp = '?';
	stbtt_GetCodepointBitmapBox(&g_font, cp, g_scale, g_scale, &x0, &y0, &x1, &y1);
	stbtt_GetCodepointHMetrics(&g_font, cp, &adv, &lsb);
	g->cp = cp;
	g->scale = g_scale;
	g->w = x1 - x0;
	g->h = y1 - y0;
	g->x0 = x0;
	g->y0 = y0;
	g->adv = adv * g_scale;
	if (g->bits) { free(g->bits); g->bits = 0; }
	if (g->w > 0 && g->h > 0 && g->w < 128 && g->h < 128) {
		g->bits = (unsigned char*)malloc((size_t)g->w * (size_t)g->h);
		if (g->bits) stbtt_MakeCodepointBitmap(&g_font, g->bits, g->w, g->h, g->w, g_scale, g_scale, cp);
	}
}

static gc_t* gc_get(int cp) {
	int i = (int)(((unsigned)cp * 2654435761u) & (GCHASH - 1));
	for (int n = 0; n < GCHASH; n++) {
		int s = (i + n) & (GCHASH - 1);
		if (g_gc[s].cp == 0) {
			gc_fill(&g_gc[s], cp);
			return &g_gc[s];
		}
		if (g_gc[s].cp == cp && g_gc[s].scale == g_scale) return &g_gc[s];
	}
	gc_fill(&g_gc[i], cp);
	return &g_gc[i];
}

static void gc_flush(void) {
	for (int i = 0; i < GCHASH; i++) {
		if (g_gc[i].bits) free(g_gc[i].bits);
	}
	memset(g_gc, 0, sizeof(g_gc));
}

static int utf8_next(const char* s, int* i) {
	int b1 = (uint8_t)s[(*i)++];
	if (b1 < 0x80) return b1;
	if (b1 < 0xE0) return ((b1 & 0x1F) << 6) | ((uint8_t)s[(*i)++] & 0x3F);
	if (b1 < 0xF0) return ((b1 & 0x0F) << 12) | (((uint8_t)s[(*i)++] & 0x3F) << 6) | ((uint8_t)s[(*i)++] & 0x3F);
	(*i) += 3;
	return '?';
}

static int g_clipx0 = 0, g_clipx1 = 0;
static void blend_px(int x, int y, int pw, int ph, uint8_t r, uint8_t g, uint8_t b, int a) {
	if (x < 0 || y < 0 || x >= pw || y >= ph) return;
	if (g_clipx1 > g_clipx0 && (x < g_clipx0 || x >= g_clipx1)) return;
	uint8_t* p = g_pix + ((size_t)y * pw + x) * 4;
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
/*IHA_END*/

/*IHB_BEGIN*/
static volatile int g_enable = 0;
static int g_gl_ready = 0;
static GLuint g_prog = 0, g_vao = 0, g_tex = 0;
static GLint g_uRes = -1, g_uOff = -1, g_uSize = -1, g_uTex = -1, g_uAlpha = -1;
static float g_aprog = 0.0f;   /* 开关动画进度(侧滑+淡入) */
static long g_aprogT = 0;
static int g_tw = 0, g_th = 0;
static EGLContext g_ctx = 0;
static EGLSurface g_surf = 0;
static long g_surfsw = 0;
static long g_frames = 0;
static double g_lastT = 0.0;
static unsigned long g_rasterSum = 0;
static int g_rasterNz = 0;
static float g_pw = 0, g_ph = 0;
static volatile long g_side = 0;
static volatile long g_offx = 0, g_offy = 0;

static float ih_row_xo(row_t* r) {
	float xo;
	if (r->talpha <= 0.0f) xo = (1.0f - r->alpha) * 14.0f;
	else xo = (1.0f - back_out(r->alpha)) * 20.0f;
	return g_side ? xo : -xo;
}

static void ih_panel_pos(int w, int h, int panelW, int panelH, float* ux, float* uy) {
	float x = g_side ? ((float)(w - panelW) - 8.0f + (float)g_offx) : (8.0f + (float)g_offx);
	float y = (float)((h - panelH) / 2) + (float)g_offy;
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
	if (!ok) { set_status("fs compile fail"); pglDeleteShader(vs); return 0; }
	g_prog = pglCreateProgram();
	if (!g_prog) { set_status("prog create fail"); pglDeleteShader(vs); pglDeleteShader(fs); return 0; }
	pglAttachShader(g_prog, vs);
	pglAttachShader(g_prog, fs);
	pglLinkProgram(g_prog);
	pglGetProgramiv(g_prog, GL_LINK_STATUS, &ok);
	if (!ok) { set_status("link fail"); pglDeleteShader(vs); pglDeleteShader(fs); return 0; }
	pglDeleteShader(vs);
	pglDeleteShader(fs);
	pglGenVertexArrays(1, &g_vao);
	g_uRes = pglGetUniformLocation(g_prog, "uRes");
	g_uOff = pglGetUniformLocation(g_prog, "uOff");
	g_uSize = pglGetUniformLocation(g_prog, "uSize");
	g_uTex = pglGetUniformLocation(g_prog, "uTex");
	g_uAlpha = pglGetUniformLocation(g_prog, "uAlpha");
	set_status("gl ready");
	return 1;
}

static void tex_ensure(int w, int h) {
	if (w == g_tw && h == g_th && g_tex) return;
	if (g_tex) pglDeleteTextures(1, &g_tex);
	pglGenTextures(1, &g_tex);
	pglBindTexture(GL_TEXTURE_2D, g_tex);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	pglTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	pglTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, 0);
	g_tw = w;
	g_th = h;
}

static void render(EGLDisplay dpy, EGLSurface surf) {
	if (g_lock) return;
	float pr = ks_anim(&g_aprog, &g_aprogT, g_enable);
	if (!g_enable && pr <= 0.0005f) return;
	int vis = 0;
	for (int i = 0; i < MAXROWS; i++) if (g_rows[i].used) vis++;
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
	if (!g_font_ok) {
		if (g_font_tried) {
			if ((g_frames & 63) != 0) return;
		}
		if (!load_sysfont()) return;
	}
	if (g_gl_ready && peglGetCurrentContext) {   /* 后台切回 GL 上下文已重建: 旧 prog/vao/tex 句柄全废, 转首初始化路径 */
		EGLContext cur = peglGetCurrentContext();
		if (cur != g_ctx) {
			g_prog = 0; g_vao = 0; g_tex = 0; g_ctx = 0; g_rasterNz = -1; g_gl_ready = 0;   /* rasterNz=-1 强制重栅化 */
			ks_logf("[hud]", "gl ctx changed, re-init");
		}
	}
	if (!g_gl_ready) {
		if (!peglGetCurrentContext) { g_enable = 0; return; }
		if (ks_g_swaps < 45 || area < ks_g_maxarea) return;
		EGLContext cur = peglGetCurrentContext();
		if (!cur) return;
		if (wpl_pv_ready() && !wpl_ctx_is_game(cur)) return;
		if (!gl_init()) { g_enable = 0; ks_logf("[hud]", "gl_init fail, module disabled"); return; }
		g_ctx = cur;
		g_surf = surf;
		g_gl_ready = 1;
		ks_logf("[hud]", "gl ready surf=%p ctx=%p size=%dx%d swaps=%ld", (void*)surf, (void*)cur, (int)w, (int)h, ks_g_swaps);
	}
	if (peglGetCurrentContext && peglGetCurrentContext() != g_ctx) return;
	if (surf != g_surf) {
		if (ks_g_swaps - g_surfsw > 120) { g_surf = surf; ks_logf("[hud]", "surface relock surf=%p", (void*)surf); }
		else return;
	}
	g_surfsw = ks_g_swaps;
	if (!pglGetIntegerv || !pglIsEnabled || !pglViewport || !pglDisable || !pglEnable
		|| !pglActiveTexture
		|| !pglUseProgram || !pglBindVertexArray || !pglUniform2f || !pglUniform1i || !pglDrawArrays
		|| !pglGenTextures || !pglTexImage2D || !pglTexParameteri || !pglDeleteTextures || !pglBindTexture
		|| !pglBlendFunc || !pglBlendFuncSeparate) return;

	double t = now_sec();
	double dt = t - g_lastT;
	g_lastT = t;
	if (dt <= 0.0 || dt > 0.5) dt = 0.016;
	float xY = (float)(dt * 11.0);
	float kY = xY / (1.0f + xY);
	float xA = (float)(dt * 13.0);
	float kA = xA / (1.0f + xA);

	int fontPx = h / 38;
	if (fontPx < 20) fontPx = 20;
	if (fontPx > 44) fontPx = 44;
	if (fontPx != (int)g_px) {
		g_px = (float)fontPx;
		g_scale = stbtt_ScaleForPixelHeight(&g_font, g_px);
		int a = 0, d = 0, lg = 0;
		stbtt_GetFontVMetrics(&g_font, &a, &d, &lg);
		g_asc = a * g_scale;
		g_desc = d * g_scale;
		gc_flush();
		for (int i = 0; i < MAXROWS; i++) g_rows[i].nameChk = 0;
	}
	int rowH = (int)(g_asc - g_desc) + 10;
	int padX = 10;
	int padT = 5;
	int headerH = rowH;
	int maxTextW = MAXPW - padX * 2 - 8;
	int screenCapW = (int)((long)w * 2 / 5);
	if (maxTextW > screenCapW - padX * 2) maxTextW = screenCapW - padX * 2;
	float nameCap = (float)maxTextW * 5.0f / 8.0f;

	float maxY = -1.0f;
	for (int i = 0; i < MAXROWS; i++) {
		row_t* r = &g_rows[i];
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
		if (g_rows[i].used && g_rows[i].talpha > 0.0f) nActive++;
	}
	int floorH = (int)((maxY + 1.0f) * rowH) + padT * 2 + headerH;
	int targetH = padT * 2 + headerH + nActive * rowH;
	if (targetH < floorH) targetH = floorH;
	if (targetH > MAXPH) targetH = MAXPH;

	float panelTextW = 0;
	for (int i = 0; i < MAXROWS; i++) {
		row_t* r = &g_rows[i];
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
	if (g_pw <= 1.0f || g_ph <= 1.0f || g_frames == 0) {
		g_pw = (float)targetW;
		g_ph = (float)targetH;
	} else {
		g_pw += ((float)targetW - g_pw) * kY;
		g_ph += ((float)targetH - g_ph) * kY;
	}
	int panelW = (int)(g_pw + 0.5f);
	int panelH = (int)(g_ph + 0.5f);
	if (panelW < 24) panelW = 24;
	if (panelH < headerH + rowH) panelH = headerH + rowH;
	if (panelW > MAXPW) panelW = MAXPW;
	if (panelH > MAXPH) panelH = MAXPH;

	memset(g_pix, 0, (size_t)panelW * panelH * 4);
	int rad = 12;
	for (int yy = 0; yy < panelH; yy++) {
		for (int xx = 0; xx < panelW; xx++) {
			uint8_t* p = g_pix + ((size_t)yy * panelW + xx) * 4;
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
		int barX = g_side ? (panelW - 9) : 6;
		for (int yy = padT + 3; yy < panelH - padT - 3; yy++) {
			blend_px(barX, yy, panelW, panelH, 110, 200, 255, 170);
			blend_px(barX + 1, yy, panelW, panelH, 110, 200, 255, 170);
			blend_px(barX + 2, yy, panelW, panelH, 110, 200, 255, 70);
		}
	}
	draw_text_sp("Item", (float)(padX + 6), (float)(padT + g_asc + 3), panelW, panelH, 120, 205, 255, 235, panelW - padX, 2.0f);
	{
		long tot = 0;
		for (int i = 0; i < MAXROWS; i++) {
			if (g_rows[i].used && g_rows[i].talpha > 0.0f) tot += g_rows[i].count;
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
		draw_text(tc, txr, (float)(padT + g_asc + 3), panelW, panelH, 148, 168, 190, 205, panelW - padX);
	}
	for (int xx = padX + 2; xx < panelW - padX - 2; xx++) {
		blend_px(xx, padT + headerH - 3, panelW, panelH, 190, 205, 220, 75);
	}

	for (int i = 0; i < MAXROWS; i++) {
		row_t* r = &g_rows[i];
		if (!r->used || r->alpha < 0.02f) continue;
		int a = (int)(r->alpha * 255.0f);
		float xo = ih_row_xo(r);
		float x = (float)(padX + 6) + xo;
		float baseline = padT + headerH + r->y * rowH + g_asc + 3.0f;
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
		g_clipx0 = padX + 6;
		g_clipx1 = padX + 6 + (int)(nameCap + 0.5f);
		draw_text(r->name, x - nameOff, baseline, panelW, panelH, 236, 238, 242, a, panelW - padX);
		g_clipx0 = 0;
		g_clipx1 = 0;
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
	tex_ensure(panelW, panelH);
	pglBindTexture(GL_TEXTURE_2D, g_tex);
	pglTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, panelW, panelH, 0, GL_RGBA, GL_UNSIGNED_BYTE, g_pix);

	pglViewport(0, 0, w, h);
	pglDisable(GL_DEPTH_TEST);
	pglDisable(GL_CULL_FACE);
	pglDisable(GL_SCISSOR_TEST);
	pglEnable(GL_BLEND);
	pglBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
	pglUseProgram(g_prog);
	pglBindVertexArray(g_vao);
	pglUniform2f(g_uRes, (GLfloat)w, (GLfloat)h);
	{
		float ux = 8.0f, uy = (GLfloat)((h - panelH) / 2);
		ih_panel_pos(w, h, panelW, panelH, &ux, &uy);
		float e = pr * pr * (3.0f - 2.0f * pr);
		ux += (1.0f - e) * (g_side ? 48.0f : -48.0f);
		pglUniform2f(g_uOff, ux, uy);
		pglUniform1f(g_uAlpha, e);
	}
	pglUniform2f(g_uSize, (GLfloat)panelW, (GLfloat)panelH);
	pglUniform1i(g_uTex, 0);
	pglDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
	{
		unsigned long rs = 0;
		int rz = 0;
		size_t total = (size_t)panelW * (size_t)panelH * 4;
		for (size_t k = 3; k < total; k += 28) {
			rs += g_pix[k];
			if (g_pix[k] > 8) rz++;
		}
		g_rasterSum = rs;
		g_rasterNz = rz;
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
	g_frames++;
}

long ihud_side(long v) {
	g_side = (v == 2) ? 1 : 0;
	return g_side;
}
long ihud_offx(long v) {
	v -= 401;
	if (v < -400) v = -400;
	if (v > 400) v = 400;
	g_offx = v;
	return g_offx;
}
long ihud_offy(long v) {
	v -= 401;
	if (v < -400) v = -400;
	if (v > 400) v = 400;
	g_offy = v;
	return g_offy;
}
long ihud_maxrows(long v) {
	if (v < 1) v = 1;
	if (v > MAXROWS) v = MAXROWS;
	g_maxrows = v;
	return g_maxrows;
}
/*IHB_END*/

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
	if (info->dlpi_name && strstr(info->dlpi_name, "掉落物")) return 0;
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
	RES(pglGetProgramInfoLog, "glGetProgramInfoLog")
	RES(pglGetShaderInfoLog, "glGetShaderInfoLog")
	RES(pglUseProgram, "glUseProgram")
	RES(pglGenVertexArrays, "glGenVertexArrays")
	RES(pglBindVertexArray, "glBindVertexArray")
	RES(pglDrawArrays, "glDrawArrays")
	RES(pglGetUniformLocation, "glGetUniformLocation")
	RES(pglUniform2f, "glUniform2f")
	RES(pglUniform1i, "glUniform1i")
	RES(pglDeleteShader, "glDeleteShader")
	RES(pglGenTextures, "glGenTextures")
	RES(pglDeleteTextures, "glDeleteTextures")
	RES(pglBindTexture, "glBindTexture")
	RES(pglActiveTexture, "glActiveTexture")
	RES(pglTexImage2D, "glTexImage2D")
	RES(pglTexParameteri, "glTexParameteri")
#undef RES
	if (!real_swap) { set_status("missing eglSwapBuffers"); return 0; }
	return 1;
}

long ihud_frames(void) { return g_frames; }

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
	memset(g_rows, 0, sizeof(g_rows));
	set_status("loaded");
	load_sysfont();
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
