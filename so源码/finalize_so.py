# -*- coding: utf-8 -*-
# 编译后回填: 计算 KuSug.so 自身 RX 段哈希 -> 折叠出期望签名 -> 补丁进 ks_slot_sig 槽(.data)
# 用法: python finalize_so.py   (在 zig cc 编译出 KuSug.so / KuSug_sym.so 之后跑)
# 定位方式: 从 KuSug_sym.so 的 .symtab 读 ks_slot_sig 的 vaddr, 再用各文件自己的程序头映射文件偏移
# 注意: 哈希只覆盖 PF_X(可执行)段, 槽在 .data(RW 段), 回填不会使哈希失效

import io, os, struct, sys

base = os.path.dirname(os.path.abspath(__file__))
MARKER = 0xA5C39E17D4F806B1
MASK = 0xFFFFFFFFFFFFFFFF

def ks_hash_seg(h, seg):
    n = len(seg)
    k = 0
    while k + 8 <= n:
        (v,) = struct.unpack_from('<Q', seg, k)
        h ^= (v + 0x9E3779B97F4A7C15 + ((h << 6) & MASK) + (h >> 2)) & MASK
        h &= MASK
        h = (h * 0x100000001B3) & MASK
        h ^= h >> 29
        k += 8
    v = 0
    k = n & ~7
    while k < n:
        v = ((v << 8) | seg[k]) & MASK
        k += 1
    h ^= (v + 0x9E3779B97F4A7C15 + ((h << 6) & MASK) + (h >> 2)) & MASK
    h &= MASK
    h = (h * 0x100000001B3) & MASK
    h ^= h >> 29
    return h

def phdrs(d):
    (phoff,) = struct.unpack_from('<Q', d, 0x20)
    (phentsize, phnum) = struct.unpack_from('<HH', d, 0x36)
    out = []
    for i in range(phnum):
        out.append(struct.unpack_from('<IIQQQQQQ', d, phoff + i * phentsize))
    return out

def self_hash(d):
    assert d[:4] == b'\x7fELF', 'not elf'
    h = 0xCBF29CE484222325
    hit = 0
    for p_type, p_flags, p_offset, p_vaddr, p_paddr, p_filesz, p_memsz, p_align in phdrs(d):
        if p_type != 1 or not (p_flags & 1):
            continue
        h = ks_hash_seg(h, d[p_offset:p_offset + p_filesz])
        hit += 1
    assert hit > 0, 'no RX segment'
    return h

def fold_sig(hv):
    s = 0x9E3779B9
    s = (s * 33 + (hv & 0xFFFFFFFF)) & 0xFFFFFFFF
    s = (s * 33 + (hv >> 32)) & 0xFFFFFFFF
    for k in (0x3C6EF35F, 0x1F123BB7, 0x58F38D17, 0x71A9E4CB, 0x2653C799, 0x5BD1E995):
        s = (s * 33 + k) & 0xFFFFFFFF
    return s

def vaddr_to_off(d, va):
    for p_type, p_flags, p_offset, p_vaddr, p_paddr, p_filesz, p_memsz, p_align in phdrs(d):
        if p_type == 1 and p_vaddr <= va < p_vaddr + p_filesz:
            return p_offset + (va - p_vaddr)
    return None

def find_sym_vaddr(d, want):
    (e_shoff,) = struct.unpack_from('<Q', d, 0x28)
    (esz, enum_, estr) = struct.unpack_from('<HHH', d, 0x3A)
    shstr = struct.unpack_from('<Q', d, e_shoff + estr * esz + 0x18)[0]
    secs = {}
    for i in range(enum_):
        off = e_shoff + i * esz
        no, ty, fl, addr, offset, size = struct.unpack_from('<IIQQQQ', d, off)
        end = d.index(b'\x00', shstr + no)
        secs[d[shstr+no:end].decode()] = (addr, offset, size)
    if '.symtab' not in secs:
        return None
    symtab_off, symtab_size = secs['.symtab'][1], secs['.symtab'][2]
    strtab_off = secs['.strtab'][1]
    for i in range(symtab_size // 24):
        off = symtab_off + i * 24
        st_name, st_info, st_other, st_shndx, st_value, st_size = struct.unpack_from('<IBBHQQ', d, off)
        if st_name == 0:
            continue
        end = d.index(b'\x00', strtab_off + st_name)
        if d[strtab_off+st_name:end].decode() == want:
            return st_value
    return None

marker_bytes = struct.pack('<Q', MARKER)

def find_slot_off(d):
    """在 RW(可写)LOAD 段的文件范围内搜 marker; 恰好 1 处才视为签名槽。
    不跨文件套 vaddr: strip/sym 两次链接的布局不同, vaddr 会错位。"""
    hits = []
    for p_type, p_flags, p_offset, p_vaddr, p_paddr, p_filesz, p_memsz, p_align in phdrs(d):
        if p_type != 1 or not (p_flags & 2):
            continue
        seg = bytes(d[p_offset:p_offset + p_filesz])
        i = seg.find(marker_bytes)
        while i >= 0:
            hits.append(p_offset + i)
            i = seg.find(marker_bytes, i + 1)
    if len(hits) != 1:
        sys.exit('marker 在 RW 段出现 %d 处(期望 1;已回填过请重新构建)' % len(hits))
    return hits[0]

def main_self_hash():
    for fn in ['KuSug.so', 'KuSug_sym.so']:
        path = os.path.join(base, fn)
        d = bytearray(io.open(path, 'rb').read())
        off = find_slot_off(d)
        hv = self_hash(d)
        sig = fold_sig(hv)
        struct.pack_into('<Q', d, off, sig)
        io.open(path, 'wb').write(bytes(d))
        d2 = io.open(path, 'rb').read()
        hv2 = self_hash(d2)
        assert hv2 == hv, '回填后哈希变化, 槽位置异常'
        (got,) = struct.unpack_from('<Q', d2, off)
        assert got == sig, '回读校验失败'
        print('%s: H=%016X 签名=%08X 槽@%#x 回填+复检 OK' % (fn, hv, sig, off))
    print('完成')

# ===== js 子命令: KuSug.js 内容指纹(SHA-256 前 8 字节 LE)回填 ks_js_exp 槽 =====
# 与 C 侧 ks_verify_js 逐位一致;v29 起该指纹同时是运行时密钥派生源(内容为钥)
import hashlib
JS_MARKER_HI = 0x51F2A7C4

def js_fingerprint(data):
    return int.from_bytes(hashlib.sha256(data).digest()[:8], 'little')

def keyed_fnv(data):
    return js_fingerprint(data) & 0xFFFFFFFF

def find_js_slot_off(d):
    hi = struct.pack('<I', JS_MARKER_HI)
    hits = []
    for p_type, p_flags, p_offset, p_vaddr, p_paddr, p_filesz, p_memsz, p_align in phdrs(d):
        if p_type != 1 or not (p_flags & 2):
            continue
        seg = bytes(d[p_offset:p_offset + p_filesz])
        for i in range(0, len(seg) - 8 + 1):
            if seg[i + 4:i + 8] == hi:
                hits.append(p_offset + i)
    if len(hits) != 1:
        sys.exit('js 槽 marker 高32位在 RW 段出现 %d 处(期望 1)' % len(hits))
    return hits[0]

def main_js(js_path):
    data = io.open(js_path, 'rb').read()
    want = keyed_fnv(data)
    if want == 0:
        sys.exit('js 哈希恰为 0(概率 2^-32),与未回填标记冲突——请重跑 build_js_protect.js(混淆种子随机,重跑即变)')
    for fn in ['KuSug.so', 'KuSug_sym.so']:
        path = os.path.join(base, fn)
        d = bytearray(io.open(path, 'rb').read())
        off = find_js_slot_off(d)
        old_lo = struct.unpack_from('<I', d, off)[0]
        struct.pack_into('<I', d, off, want)
        io.open(path, 'wb').write(bytes(d))
        got = struct.unpack_from('<I', io.open(path, 'rb').read(), off)[0]
        assert got == want, 'js 槽回读校验失败'
        print('%s: js哈希=%08X 槽@%#x %08X->%08X OK' % (fn, want, off, old_lo, got))
    print('js 哈希回填完成(%s)' % js_path)

if len(sys.argv) > 1 and sys.argv[1] == 'js':
    js = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.dirname(base)), 'KuSug.js')
    if not os.path.isfile(js):
        sys.exit('找不到 ' + js)
    main_js(js)
else:
    main_self_hash()
