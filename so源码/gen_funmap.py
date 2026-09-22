# -*- coding: utf-8 -*-

import json, re, struct, sys, io, os
import numpy as np

LIB = sys.argv[1] if len(sys.argv) > 1 else u'临时/libminecraftpe.bin'
SYM = sys.argv[2] if len(sys.argv) > 2 else u'临时/符号抓取.txt'
SIG = sys.argv[3] if len(sys.argv) > 3 else u'工具/签名表.txt'
JSN = sys.argv[4] if len(sys.argv) > 4 else u'参考/FuncOffset-3.9.5.297103-503.json'
VER = sys.argv[5] if len(sys.argv) > 5 else u'3.9.5'
OUT_MAP = u'工具/函数映射-%s.txt' % VER
OUT_VT = u'工具/虚表-%s.txt' % VER

d = open(LIB, 'rb').read()
assert d[:4] == b'\x7fELF'
(phoff,) = struct.unpack_from('<Q', d, 0x20)
(phentsize, phnum) = struct.unpack_from('<HH', d, 0x36)
loads = []
dyn = None
for i in range(phnum):
    off = phoff + i * phentsize
    p_type, p_flags, p_offset, p_vaddr, p_paddr, p_filesz, p_memsz, p_align = struct.unpack_from('<IIQQQQQQ', d, off)
    if p_type == 1:
        loads.append((p_offset, p_vaddr, p_filesz))
    elif p_type == 2:
        dyn = (p_offset, p_filesz)

def v2o(v):
    for o, vv, fs in loads:
        if vv <= v < vv + fs:
            return o + (v - vv)
    return None

execs = []
(shoff,) = struct.unpack_from('<Q', d, 0x28)
(shentsize, shnum, shstrndx) = struct.unpack_from('<HHH', d, 0x3A)
if shoff and 0 < shnum < 60000:
    for i in range(shnum):
        (s_name, s_type, s_flags, s_addr, s_off, s_size) = struct.unpack_from('<IIQQQQ', d, shoff + i * shentsize)
        if s_addr and s_size and s_off + s_size <= len(d) and (s_flags & 4):
            execs.append((s_off, s_addr, s_size))
if not execs:
    for p_offset, p_vaddr, p_filesz in loads:
        execs.append((p_offset, p_vaddr, p_filesz))

def in_exec(v):
    for _, ev, es in execs:
        if ev <= v < ev + es:
            return True
    return False

do_, dfs = dyn
rela = relasz = jmprel = pltsz = symtab_v = strtab_v = gnu_v = 0
i = 0
while i < dfs:
    tag, val = struct.unpack_from('<qQ', d, do_ + i)
    i += 16
    if tag == 0:
        break
    if tag == 7:
        rela = val
    elif tag == 8:
        relasz = val
    elif tag == 23:
        jmprel = val
    elif tag == 2:
        pltsz = val
    elif tag == 6:
        symtab_v = val
    elif tag == 5:
        strtab_v = val
    elif tag == 0x6ffffef5:
        gnu_v = val

nsyms = 0
if gnu_v:
    go = v2o(gnu_v)
    nbuckets, symoffset, bloom_size, bloom_shift = struct.unpack_from('<IIII', d, go)
    buckets = go + 16 + bloom_size * 8
    for b in range(nbuckets):
        ix = struct.unpack_from('<I', d, buckets + b * 4)[0]
        if ix < symoffset:
            continue
        while True:
            c = struct.unpack_from('<I', d, buckets + nbuckets * 4 + (ix - symoffset) * 4)[0]
            ix += 1
            if c & 1:
                break
        nsyms = max(nsyms, ix)

so = v2o(symtab_v)
symvals = []
for k in range(nsyms):
    st_name, st_info, st_other, st_shndx, st_value, st_size = struct.unpack_from('<IBBHQQ', d, so + k * 24)
    symvals.append(st_value)

byoff = {}
def eat_rela(vaddr, size):
    fo = v2o(vaddr)
    if fo is None:
        return
    for k in range(size // 24):
        r_off, r_info, r_add = struct.unpack_from('<QQq', d, fo + k * 24)
        t = r_info & 0xffffffff
        if t == 0x403:
            byoff[r_off] = r_add
        elif t == 0x101:
            si = r_info >> 32
            byoff[r_off] = (symvals[si] + r_add) if si < len(symvals) else r_add
        elif t == 0x401 or t == 0x402:
            si = r_info >> 32
            byoff[r_off] = symvals[si] if si < len(symvals) else 0

eat_rela(rela, relasz)
eat_rela(jmprel, pltsz)

def read_cstr(vaddr):
    fo = v2o(vaddr)
    if fo is None:
        return None
    end = d.find(b'\x00', fo, fo + 260)
    if end < 0:
        return None
    s = d[fo:end]
    if 2 <= len(s) <= 200 and all(32 <= c < 127 for c in s):
        return s
    return None

typeinfos = {}
for slot, target in byoff.items():
    s = read_cstr(target)
    if s is None:
        continue
    t = s.decode('ascii', 'replace')
    if not (t[0].isdigit() or t[0] in 'NStSPPKRDi'):
        continue
    typeinfos.setdefault(slot - 8, t)

vtables = []
for slot, target in byoff.items():
    if target not in typeinfos:
        continue
    v = slot + 8
    ott_rel = byoff.get(v - 16)
    slots = []
    j = v
    while len(slots) < 600:
        t2 = byoff.get(j)
        if t2 is None:
            break
        if t2 == 0:
            slots.append(0)
            j += 8
            continue
        if not in_exec(t2):
            break
        slots.append(t2)
        j += 8
    if slots:
        vtables.append((v, target, ott_rel, slots))

def dem_lite(n):
    if not n:
        return n
    if n[0].isdigit():
        parts = []
        i = 0
        ok = True
        while i < len(n):
            j = i
            while j < len(n) and n[j].isdigit():
                j += 1
            if j == i:
                ok = False
                break
            ln = int(n[i:j])
            part = n[j:j + ln]
            if len(part) != ln:
                ok = False
                break
            parts.append(part)
            i = j + ln
        if ok and parts:
            return '::'.join(parts)
    if n[0] == 'N' and n.endswith('E') and len(n) > 2:
        inner = n[1:-1]
        out = dem_lite(inner)
        return out if out != inner else n
    return n

names = {}
if os.path.exists(SYM):
    for ln in io.open(SYM, 'r', encoding='utf-8', errors='replace'):
        if len(ln) < 44 or ln[0] != '0':
            continue
        p = ln.split(' ', 4)
        if len(p) < 5:
            continue
        try:
            rva = int(p[0], 16)
        except ValueError:
            continue
        if rva not in names:
            names[rva] = p[4].strip()
if os.path.exists(SIG):
    for ln in io.open(SIG, 'r', encoding='utf-8', errors='replace'):
        if ln.startswith('#') or '\t' not in ln:
            continue
        p = ln.rstrip('\n').split('\t')
        if len(p) >= 2:
            try:
                rva = int(p[1], 16)
            except ValueError:
                continue
            names.setdefault(rva, p[0])

starts = {}
for p_offset, p_vaddr, p_filesz in execs:
    seg = d[p_offset:p_offset + p_filesz]
    a = np.frombuffer(seg, dtype='<u4')
    m = (a == 0xD503233F) | (a == 0xD503237F)
    m |= (a & np.uint32(0xFFFFFF1F)) == np.uint32(0xD503241F)
    m |= (a & np.uint32(0xFFC0FFFF)) == np.uint32(0xA9807BFD)
    m |= (a & np.uint32(0xFFC0FFFF)) == np.uint32(0xA9007BFD)
    prev = np.empty(len(a), dtype=np.uint32)
    prev[0] = 0
    prev[1:] = a[:-1]
    boundary = (prev & np.uint32(0xFFFFFC1F)) == np.uint32(0xD65F0000)
    boundary |= (prev & np.uint32(0xFFFFFC1F)) == np.uint32(0xD61F0000)
    boundary |= (prev & np.uint32(0xFC000000)) == np.uint32(0x14000000)
    boundary |= prev == 0
    boundary |= prev == 0xD503201F
    boundary[0] = True
    m |= ((a & np.uint32(0xFFB003FF)) == np.uint32(0xD10003FF)) & boundary
    m |= ((a & np.uint32(0xFFC003E0)) == np.uint32(0xA98003E0)) & boundary
    m |= ((a & np.uint32(0xFFC003E0)) == np.uint32(0xA90003E0)) & boundary
    idx = np.nonzero(m)[0]
    for i2 in idx:
        starts[p_vaddr + int(i2) * 4] = 1
for _, _, _, sl in vtables:
    for fv in sl:
        if fv:
            starts[fv] = 1
for rva in names:
    if in_exec(rva):
        starts[rva] = 1

vt_of_func = {}
out = io.open(OUT_VT, 'w', encoding='utf-8', newline='\n')
out.write(u'# 虚表/RTTI libminecraftpe %s (rela 重建指针, ott=offset_to_top)\n' % VER)
out.write(u'# 类型 %d  虚表 %d\n' % (len(typeinfos), len(vtables)))
for v, ti, ott, slots in sorted(vtables):
    raw = typeinfos.get(ti, '?')
    disp = dem_lite(raw)
    primary = ott is None or ott == 0 or (-0x10000 < (ott - (1 << 64) if ott >= (1 << 63) else ott) < 0x10000)
    out.write(u'VTABLE 0x%X %s slots=%d ott=%s ti=0x%X%s%s\n' % (v, disp, len(slots), ('0x%X' % ott) if ott is not None else '0', ti, u'' if disp == raw else u' raw=' + raw, u'' if primary else u' SECONDARY/SUSPECT'))
    for k, fv in enumerate(slots):
        out.write(u'  [%d] 0x%X\n' % (k, fv))
        if fv and primary:
            vt_of_func.setdefault(fv, []).append((disp, v, k))
out.close()

named = 0
out = io.open(OUT_MAP, 'w', encoding='utf-8', newline='\n')
out.write(u'# 函数起点图 libminecraftpe %s  函数数=%d(exec段序言扫描)\n' % (VER, len(starts)))
out.write(u'# 列: 偏移  名称或sub_偏移  (虚表类[slot])\n')
for rva in sorted(starts.keys()):
    nm = names.get(rva)
    vt = vt_of_func.get(rva)
    if nm or vt:
        named += 1
    line = u'0x%08X %s' % (rva, nm if nm else u'sub_%08X' % rva)
    if vt:
        line += u'  ' + u', '.join(u'%s[%d]' % (c, k) for c, _, k in vt[:3])
    out.write(line + u'\n')
if os.path.exists(JSN):
    doc = json.load(io.open(JSN, 'r', encoding='utf-8'))
    out.write(u'# ---- 数据符号 ----\n')
    for e in doc:
        ptr = int(e.get('ptr', 0))
        if ptr < 0x1000:
            continue
        if not in_exec(ptr):
            out.write(u'# DATA 0x%X %s\n' % (ptr, e.get('fn', '')))
out.close()

print('exec secs MB=%.1f  relocs=%d  nsyms=%d' % (sum(s for _, _, s in execs) / 1048576, len(byoff), nsyms))
print('functions=%d named-src=%d annotated=%d' % (len(starts), len(names), named))
print('typeinfos=%d vtables=%d vt-funcs=%d' % (len(typeinfos), len(vtables), len(vt_of_func)))
print('->', OUT_MAP, os.path.getsize(OUT_MAP), 'bytes')
print('->', OUT_VT, os.path.getsize(OUT_VT), 'bytes')
