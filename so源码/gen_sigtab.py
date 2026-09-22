# -*- coding: utf-8 -*-

import json, re, struct, sys, io, os

LIB = sys.argv[1] if len(sys.argv) > 1 else u'临时/libminecraftpe.bin'
JSN = sys.argv[2] if len(sys.argv) > 2 else u'参考/FuncOffset-3.9.5.297103-503.json'
OUT = sys.argv[3] if len(sys.argv) > 3 else u'工具/签名表.txt'
VER = sys.argv[4] if len(sys.argv) > 4 else u'3.9.5.297103-503'
SIGLEN = 192

d = open(LIB, 'rb').read()
assert d[:4] == b'\x7fELF', 'not elf'
(phoff,) = struct.unpack_from('<Q', d, 0x20)
(phentsize, phnum) = struct.unpack_from('<HH', d, 0x36)
execs = []
alls = []
for i in range(phnum):
    off = phoff + i * phentsize
    p_type, p_flags, p_offset, p_vaddr, p_paddr, p_filesz, p_memsz, p_align = struct.unpack_from('<IIQQQQQQ', d, off)
    if p_type == 1:
        alls.append((p_offset, p_vaddr, p_filesz))
        if p_flags & 1:
            execs.append((p_offset, p_vaddr, p_filesz))
assert execs, 'no exec segment'

def rva2foff(rva):
    for p_offset, p_vaddr, p_filesz in alls:
        if p_vaddr <= rva < p_vaddr + p_filesz:
            return p_offset + (rva - p_vaddr)
    return None

def is_code(rva):
    for p_offset, p_vaddr, p_filesz in execs:
        if p_vaddr <= rva < p_vaddr + p_filesz:
            return True
    return False

def word_mask(w, prev_adrp_rd):
    op6 = w & 0xFC000000
    if op6 == 0x94000000 or op6 == 0x14000000:
        return 0xFC000000, None
    if (w & 0x9F000000) == 0x90000000:
        return 0x9F00001F, w & 31
    if (w & 0x9F000000) == 0x10000000:
        return 0x1F00001F, None
    if (w & 0x3B000000) == 0x18000000:
        return 0x3B00001F, None
    if (w & 0x7E000000) == 0x34000000:
        return 0x7F00001F, None
    if (w & 0x7E000000) == 0x36000000:
        return 0xFFF8001F, None
    if (w & 0xFF000010) == 0x54000000:
        return 0xFF00001F, None
    if (w & 0x1F800000) == 0x12800000:
        return 0xFFE0001F, None
    if (w & 0x1F000000) == 0x11000000:
        rn = (w >> 5) & 31
        rd = w & 31
        if rn == 31 or rd == 31 or (prev_adrp_rd is not None and rn == prev_adrp_rd and rn == rd):
            return 0xFF8003FF, None
        return 0xFFFFFFFF, None
    if (w & 0x3B000000) == 0x39000000:
        rn = (w >> 5) & 31
        if rn == 31 or (prev_adrp_rd is not None and rn == prev_adrp_rd):
            return 0xFFC003FF, None
        return 0xFFFFFFFF, None
    if (w & 0x3A000000) == 0x28000000:
        rn = (w >> 5) & 31
        if rn == 31:
            return 0xFF807FFF, None
        return 0xFFFFFFFF, None
    return 0xFFFFFFFF, None

def gen_sig(foff):
    raw = d[foff:foff + SIGLEN]
    if len(raw) < SIGLEN:
        return None
    keep = bytearray()
    prev_adrp = None
    for i in range(0, SIGLEN, 4):
        (w,) = struct.unpack_from('<I', raw, i)
        m, adrp_rd = word_mask(w, prev_adrp)
        keep += struct.pack('<I', m)
        prev_adrp = adrp_rd
    return raw, bytes(keep)

def count_matches(sigb, sigm):
    best_run = 0
    best_pos = 0
    cur = 0
    start = 0
    for i in range(SIGLEN):
        if sigm[i] == 0xFF:
            if cur == 0:
                start = i
            cur += 1
            if cur > best_run:
                best_run = cur
                best_pos = start
        else:
            cur = 0
    if best_run < 6:
        for i in range(SIGLEN):
            if sigm[i] == 0xFF:
                best_run = 1
                best_pos = i
                break
    needle = sigb[best_pos:best_pos + best_run]
    hits = []
    for p_offset, p_vaddr, p_filesz in execs:
        seg = d[p_offset:p_offset + p_filesz]
        p = seg.find(needle)
        while p >= 0:
            cand = p - best_pos
            if cand >= 0 and cand % 4 == 0 and cand + SIGLEN <= len(seg):
                ok = True
                for j in range(0, SIGLEN, 4):
                    cw = struct.unpack_from('<I', seg, cand + j)[0]
                    sw = struct.unpack_from('<I', sigb, j)[0]
                    mw = struct.unpack_from('<I', sigm, j)[0]
                    if (cw ^ sw) & mw:
                        ok = False
                        break
                if ok:
                    hits.append(p_vaddr + cand)
            p = seg.find(needle, p + 1)
    return hits

def short_name(fn, used):
    n = fn
    if n.startswith('_ZNK') or n.startswith('_ZNV'):
        n = n[4:]
    elif n.startswith('_ZN'):
        n = n[3:]
    elif n.startswith('_Z'):
        n = n[2:]
    if n and n[0].isdigit():
        parts = []
        i = 0
        while i < len(n):
            j = i
            while j < len(n) and n[j].isdigit():
                j += 1
            if j == i:
                parts.append(n[i:])
                break
            ln = int(n[i:j])
            parts.append(n[j:j + ln])
            i = j + ln
        n = '::'.join(parts)
    n = re.sub(r'<[^<>]*>', '', n)
    n = re.sub(r'\(.*$', '', n)
    n = re.sub(r'[^A-Za-z0-9_:~.]', '', n)
    if len(n) > 60:
        n = n[:52] + '_' + ('%07x' % (hash(fn) & 0xFFFFFFF))
    base = n
    k = 2
    while n in used:
        n = base[:56] + '_' + str(k)
        k += 1
    used.add(n)
    return n

doc = json.load(io.open(JSN, 'r', encoding='utf-8'))
seen = set()
targets = []
for e in doc:
    fn = e.get('fn', '')
    ptr = int(e.get('ptr', 0))
    if ptr < 0x1000 or (fn, ptr) in seen:
        continue
    seen.add((fn, ptr))
    targets.append((fn, ptr))

used = set()
ok_lines = []
drop = []
data = []
for fn, ptr in targets:
    if not is_code(ptr):
        data.append((fn, ptr))
        continue
    foff = rva2foff(ptr)
    if foff is None:
        drop.append((fn, ptr, 'nofoff'))
        continue
    gs = gen_sig(foff)
    if not gs:
        drop.append((fn, ptr, 'short'))
        continue
    sigb, sigm = gs
    hits = count_matches(sigb, sigm)
    if len(hits) == 1 and hits[0] == ptr:
        ok_lines.append((short_name(fn, used), ptr, sigb, sigm))
    elif len(hits) == 1:
        drop.append((fn, ptr, 'shift@0x%X' % hits[0]))
    else:
        drop.append((fn, ptr, 'multi=%d' % len(hits)))

out = io.open(OUT, 'w', encoding='utf-8', newline='\n')
out.write(u'# 签名表 libminecraftpe %s\n' % VER)
out.write(u'# 生成: gen_sigtab.py  唯一性: 全库验证  代码命中 %d  数据跳过 %d  剔除 %d\n' % (len(ok_lines), len(data), len(drop)))
for name, ptr, sigb, sigm in sorted(ok_lines, key=lambda x: x[1]):
    out.write(u'%s\t0x%X\t%d\t%s\t%s\n' % (name, ptr, SIGLEN, sigb.hex().upper(), sigm.hex().upper()))
out.write(u'# ---- 数据符号(签名不可扫,偏移仅本版本) ----\n')
for fn, ptr in data:
    out.write(u'# DATA %s\t0x%X\n' % (fn, ptr))
out.write(u'# ---- 剔除(非唯一/异常) ----\n')
for fn, ptr, why in drop:
    out.write(u'# DROP %s\t0x%X\t%s\n' % (fn, ptr, why))
out.close()

print('exec segs:', [(hex(v), hex(s)) for _, v, s in execs])
print('targets=%d code-ok=%d data=%d drop=%d' % (len(targets), len(ok_lines), len(data), len(drop)))
for fn, ptr, why in drop:
    print('  DROP %-60s 0x%X %s' % (fn[:60], ptr, why))
print('data:', len(data), 'entries (注释进表)')
print('->', OUT, os.path.getsize(OUT), 'bytes')
