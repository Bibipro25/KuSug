

 与 /*CH_END*/ 之间的内容，
 * 追加到 KuSugSo.c 方向标模块之后、动态水印模块之前（派发顺序 mb→ih→dir→ch→wm）。
 * 无文字无实体数据，纯光栅；不依赖 ih 字体管线，依赖核心层 GL/EGL 符号与 ih 数学函数(ih_sqrt)、now_sec()。
 * 标识符已全部带 ch_ 前缀，无需重命名。
 * JS 通道（全部单 long 参数，恒值/无参两段式开关）：
 *   os.syscall(soDst, "chud_enable", 1) / os.syscall(soDst, "chud_off")
 *   os.syscall(soDst, "chud_preset", 0..4)   0十字 1圆环 2圆点 3十字点 4斜十字
 *   os.syscall(soDst, "chud_size", 4..80)    主尺寸（十字半长/圆环半径）
 *   os.syscall(soDst, "chud_thick", 1..12)   线宽
 *   os.syscall(soDst, "chud_gap", 0..40)     中心距
 *   os.syscall(soDst, "chud_offx", -100..100) 屏幕偏移X(负=左)
 *   os.syscall(soDst, "chud_offy", -100..100) 屏幕偏移Y(负=上)
 *   os.syscall(soDst, "chud_rgb", 0xRRGGBB)
 *   os.syscall(soDst, "chud_alpha", 0..100)
 *   os.syscall(soDst, "chud_dyn", 0..1)             bit0 攻击/命中缩放脉冲(准星本体飞移/缩放)
 *   os.syscall(soDst, "chud_amp", 2..40)            动态幅度
 *   os.syscall(soDst, "chud_pulse", 1|2)     1=攻击(扩散) 2=命中(标记+扩散)
 */

/*CH_BEGIN*/
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

long chud_enable(long v) {
	ch_g_enable = (v == 1) ? 1 : 0;
	return ch_g_enable;
}

long chud_off(void) {
	ch_g_enable = 0;
	ch_g_seq = 0;
	ch_g_seen = 0;
	return 0;
}

long chud_preset(long v) {
	if (v < 0) v = 0;
	if (v > 4) v = 4;
	ch_g_preset = v;
	return ch_g_preset;
}

long chud_size(long v) {
	if (v < 4) v = 4;
	if (v > 80) v = 80;
	ch_g_size = v;
	return ch_g_size;
}

long chud_thick(long v) {
	if (v < 1) v = 1;
	if (v > 12) v = 12;
	ch_g_thick = v;
	return ch_g_thick;
}

long chud_gap(long v) {
	if (v < 0) v = 0;
	if (v > 40) v = 40;
	ch_g_gap = v;
	return ch_g_gap;
}

long chud_rgb(long v) {
	v &= 0xFFFFFF;   /* 桥侧 v 按 24 位带符号解包: >=0x800000 的色值(R>=0x80)会到负, 按位与即 mod 2^24 还原 */
	ch_g_rgb = v;
	return ch_g_rgb;
}

long chud_alpha(long v) {
	if (v < 0) v = 0;
	if (v > 100) v = 100;
	ch_g_alpha = v * 255 / 100;
	return ch_g_alpha;
}

long chud_dyn(long v) {
	if (v < 0) v = 0;
	if (v > 1) v = 1;
	ch_g_dyn = v;
	return ch_g_dyn;
}

long chud_amp(long v) {
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

long chud_offx(long v) {
	ch_g_offx = ch_clamp_off(v);
	return ch_g_offx;
}

long chud_offy(long v) {
	ch_g_offy = ch_clamp_off(v);
	return ch_g_offy;
}

long chud_pulse(long t) {
	(void)t;
	ch_g_seq++;
	return ch_g_seq;
}

long chud_frames(void) { return ch_g_frames; }

static int ch_active(void) { return ch_g_enable != 0 || ch_g_aprog > 0.0005f; }
static void ch_disable(void) { ch_g_enable = 0; }
/*CH_END*/
