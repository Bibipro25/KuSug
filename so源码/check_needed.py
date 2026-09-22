# -*- coding: utf-8 -*-

import struct, sys

def needed_list(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'\x7fELF', 'not elf'
    (phoff,) = struct.unpack_from('<Q', d, 0x20)
    (phentsize, phnum) = struct.unpack_from('<HH', d, 0x36)
    dyn_off = dyn_sz = None
    for i in range(phnum):
        off = phoff + i * phentsize
        p_type, p_flags, p_offset, p_vaddr, p_paddr, p_filesz, p_memsz, p_align = struct.unpack_from('<IIQQQQQQ', d, off)
        if p_type == 2:
            dyn_off, dyn_sz = p_offset, p_filesz
    assert dyn_off is not None, 'no PT_DYNAMIC'
    strtab_vaddr = None
    ents = []
    i = 0
    while i < dyn_sz:
        tag, val = struct.unpack_from('<qQ', d, dyn_off + i)
        i += 16
        if tag == 0:
            break
        if tag == 5:
            strtab_vaddr = val
        ents.append((tag, val))

    strtab_off = None
    for j in range(phnum):
        off = phoff + j * phentsize
        p_type, p_flags, p_offset, p_vaddr, p_paddr, p_filesz, p_memsz, p_align = struct.unpack_from('<IIQQQQQQ', d, off)
        if p_type == 1 and p_vaddr <= strtab_vaddr < p_vaddr + p_filesz:
            strtab_off = p_offset + (strtab_vaddr - p_vaddr)
    assert strtab_off is not None, 'strtab not in load'
    out = []
    for tag, val in ents:
        if tag == 1:
            end = d.index(b'\x00', strtab_off + val)
            out.append(d[strtab_off + val:end].decode())
    return out

ok = True
for fn in ['KuSug.so', 'KuSug_sym.so']:
    n = needed_list(fn)
    good = n == ['libc.so']
    if not good:
        ok = False
    print(fn, 'DT_NEEDED =', n, 'PASS' if good else 'FAIL(红线: 仅 libc.so)')
sys.exit(0 if ok else 1)
