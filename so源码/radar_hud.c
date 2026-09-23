
/* 2D 雷达模块(复刻苦力怕 Radar: 圆角面板+旋转扫描光+敌我目标点):
   三路 GL 原生绘制——静态面板纹理(只光栅一次) / 扫描楔形着色器(每帧一个 uDeg uniform) /
   目标点 VBO 点精灵(顶点着色器内做 yaw 旋转, 转向平滑; 数据只在 JS 提交时更新)。
   数据流: JS 每 tick op59 投递 yaw(度*64), 每 4 tick 扫描实体写共享缓冲 + op60 提交。
   缓冲布局: __radar_in = [count][qx s16LE, qz s16LE, type u8]×N, q = round(世界偏移格数*16), type 0=玩家(红) 1=其他(绿)。
   比例尺 4px/格(与苦力怕一致), 超出面板半径的点钳到边缘。位置按视口百分比(op58)。
   标识符全部 rd_ 前缀。JS 通道: op57 rd_enable(0/1) 返回缓冲地址 / op58 rd_pos(y%<<8|x%) / op59 rd_yaw(度*64) / op60 rd_commit(0) */

/*RD_BEGIN*/
static void rd_set_status(const char* s) { ks_set_status(7, s); }

#define RD_PW 300
#define RD_HALF 150
#define RD_DOT_LIM 144
#define RD_MAXE 64

static unsigned char rd_g_inbuf[1 + RD_MAXE * 5];
long __radar_in(void) { return (long)rd_g_inbuf; }

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

long rd_enable(long v) {
	rd_g_enable = (v == 1) ? 1 : 0;
	if (!rd_g_enable) { rd_g_count = 0; rd_g_vbo_dirty = 0; }
	return (long)__radar_in();
}

long rd_pos(long v) {
	rd_g_xpct = (v & 0xFF);
	rd_g_ypct = ((v >> 8) & 0xFF);
	return v;
}

long rd_yaw(long v) {
	if (v < 0) v = 0;
	if (v > 23040) v = 23040;
	rd_g_yaw_q = v;
	return v;
}

long rd_commit(long v) {
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

long rd_frames(void) { return rd_g_frames; }

static int rd_active(void) { return rd_g_enable != 0 || rd_g_aprog > 0.0005f; }
static void rd_disable(void) { rd_g_enable = 0; }
/*RD_END*/
