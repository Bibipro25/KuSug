

 与 /*WM_END*/ 之间的内容，
 * 追加到 KuSugSo.c 方向标模块之后、epilogue 之前。
 * 依赖核心层 GL/EGL 符号与 ih 模块字体管线（load_sysfont/utf8_next/ih_g_font），像素写入用自带 wm_blend_px。
 * 两个 "RunAway 不售卖" 白字半透明文本框全屏弹跳（dt 驱动、帧率无关），文本为 C 侧常量，无需数据通道。
 * JS 通道：os.syscall(soDst, "wmhud_enable", 1) 开 / os.syscall(soDst, "wmhud_off") 关（无参）。
 */

/*WM_BEGIN*/
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

long wmhud_enable(long v) {
	wm_g_enable = (v == 1) ? 1 : 0;
	if (!wm_g_enable) wm_g_pos_init = 0;
	return wm_g_enable;
}

long wmhud_off(void) {
	wm_g_enable = 0;
	wm_g_pos_init = 0;
	return 0;
}

long wmhud_frames(void) { return wm_g_frames; }

static int wm_active(void) { return wm_g_enable != 0 || wm_g_aprog > 0.0005f; }
static void wm_disable(void) { wm_g_enable = 0; wm_g_pos_init = 0; }
/*WM_END*/
