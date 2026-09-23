

/*WPL_BEGIN*/
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

long wpl_enable(long v) {
	wpl_g_enable = (v == 1) ? 1 : 0;
	ks_logf("[wpl]", "enable=%ld hookState=%d", v, wpl_g_hook_state);
	if (wpl_g_enable && wpl_g_hook_state != 1) wpl_hooks_install();
	return wpl_g_enable;
}
long wpl_px(long v) { g_wpl_cam_prv[0] = g_wpl_cam[0]; g_wpl_cam[0] = (float)v / 1000.0f; g_wpl_cam_pts = g_wpl_cam_ts; g_wpl_cam_ts = wpl_now_ms(); return 1; }
long wpl_py(long v) { g_wpl_cam_prv[1] = g_wpl_cam[1]; g_wpl_cam[1] = (float)v / 1000.0f + 1.62f; g_wpl_cam_pts = g_wpl_cam_ts; g_wpl_cam_ts = wpl_now_ms(); return 1; }
long wpl_pz(long v) { g_wpl_cam_prv[2] = g_wpl_cam[2]; g_wpl_cam[2] = (float)v / 1000.0f; g_wpl_cam_pts = g_wpl_cam_ts; g_wpl_cam_ts = wpl_now_ms(); return 1; }
long wpl_tx(long v) { g_wpl_target[0] = (int)v; return 1; }
long wpl_ty(long v) { g_wpl_target[1] = (int)v; return 1; }
long wpl_tz(long v) { g_wpl_target[2] = (int)v; return 1; }
long wpl_show(long v) {
	g_wpl_show = v ? 1 : 0;
	return g_wpl_show;
}
long wpl_drew(void) { return wpl_g_drew_n; }
long __wpl_in(void) { return (long)(intptr_t)g_wpl_inbuf; }
long wpl_sync(void) {
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
/*WPL_END*/
