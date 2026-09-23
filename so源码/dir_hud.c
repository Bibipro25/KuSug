

 与 /*DIR_END*/ 之间的内容，
 * 追加到 KuSugSo.c 掉落物统计模块之后、epilogue 之前。
 * 依赖核心层 GL/EGL 符号与 ih 模块字体管线（load_sysfont/gc_get/utf8_next/text_w/ih_g_*），像素写入用自带 dir_blend_px/dir_draw_text，
 * 标识符已全部带 dir_ 前缀，无需重命名。
 * JS 通道：os.syscall(soDst, "dirhud_enable", 0|1) / os.syscall(soDst, "dirhud_set", 方位角*100)
 * 信息行通道：__dir_in 取共享缓冲地址，JS 写 [len32][utf8 文本] 后 os.syscall(soDst, "dirhud_sync")，
 * 文本即最终显示内容（如 "KuSug · X -12 Y 64 Z 2087 · 60 FPS"），C 侧只做截断与渲染。
 * 方位角约定：0=北 90=东 180=南 270=西（JS 侧换算: 设备实测 yaw 0=北且向西递增(90=西), 取 360-yaw; 旧按 MC 惯例 +180 换算, 北/南互换、东西碰巧对——与雷达 θ 符号同根因）。
 * 顶部读数按基岩惯例显示 ±180°（0=南 90=西 ±180=北 -90=东），刻度/方位字仍按方位角。
 */

/*DIR_BEGIN*/
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

long dirhud_enable(long v) {
	dir_g_enable = (v == 1) ? 1 : 0;
	if (!dir_g_enable) dir_g_disp_init = 0;
	return dir_g_enable;
}

long dirhud_set(long v) {
	long cdeg = v - 1;
	if (cdeg < 0) cdeg = 0;
	if (cdeg >= 36000L) cdeg = 0;
	dir_g_cdeg = cdeg;
	return dir_g_cdeg;
}

long __dir_in(void) { return (long)(intptr_t)dir_g_inbuf; }

long dirhud_sync(void) {
	int len = dir_g_inbuf[0] | (dir_g_inbuf[1] << 8) | ((int)dir_g_inbuf[2] << 16) | ((int)dir_g_inbuf[3] << 24);
	if (len < 0 || len > DIRINMAX) return -1L;
	int cap = (int)sizeof(dir_g_info) - 1;
	int n = len < cap ? len : cap;
	for (int k = 0; k < n; k++) dir_g_info[k] = (char)dir_g_inbuf[4 + k];
	dir_g_info[n] = 0;
	return n;
}

long dirhud_off(void) {
	dir_g_enable = 0;
	dir_g_disp_init = 0;
	dir_g_info[0] = 0;
	return 0;
}

long dirhud_offx(long v) {
	v -= 401;
	if (v < -400) v = -400;
	if (v > 400) v = 400;
	dir_g_offx = v;
	return dir_g_offx;
}

long dirhud_offy(long v) {
	v -= 401;
	if (v < -400) v = -400;
	if (v > 400) v = 400;
	dir_g_offy = v;
	return dir_g_offy;
}

long dirhud_frames(void) { return dir_g_frames; }

static int dir_active(void) { return dir_g_enable != 0 || dir_g_aprog > 0.0005f; }
static void dir_disable(void) { dir_g_enable = 0; dir_g_disp_init = 0; dir_g_info[0] = 0; }
/*DIR_END*/
