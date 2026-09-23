

/*TEX_BEGIN*/
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
long __tex_in(void) { return (long)(intptr_t)tex_g_in; }

long tex_apply(long mode) {

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
/*TEX_END*/
