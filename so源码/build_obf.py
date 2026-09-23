# -*- coding: utf-8 -*-
# 纯功能构建流水线(保护体系已退役 2026-09-22):
#   build_js_protect.js 母本直出 KuSug.js -> build_kusug_so.py 生成 KuSugSo.c
#   -> MSYS2 clang 直编(无 Kagura) -> zig 链接 musl -> 红线检查 -> 交付
# 用法: python build_obf.py
import os, subprocess, sys, io, time, hashlib

base = os.path.dirname(os.path.abspath(__file__))
MSYS_CLANG = r'D:\work\msys64\clang64\bin\clang.exe'
ZIG = r'D:\work\zig014\zig-x86_64-windows-0.14.1\zig.exe'
ZIG_LIB = r'D:\work\zig014\zig-x86_64-windows-0.14.1\lib'
ROOT2 = os.path.dirname(os.path.dirname(base))

def run(cmd, tag):
    print('==', tag)
    r = subprocess.call(cmd, cwd=base)
    if r != 0:
        sys.exit('%s 失败 exit=%d' % (tag, r))

# 0) JS 直出
run(['node', os.path.join(ROOT2, '工具', 'build_js_protect.js')], 'JS 母本直出')

# 1) 生成源码
run([sys.executable, 'build_kusug_so.py'], 'build_kusug_so.py')

# 2) MSYS2 clang 直编(目标 aarch64-linux-musl, 头文件借 zig 的 musl)
incs = [
    '-I' + ZIG_LIB + r'/libc/include/aarch64-linux-musl',
    '-I' + ZIG_LIB + r'/libc/include/any-linux-any',
    '-I' + ZIG_LIB + r'/libc/musl/include',
    '-I' + ZIG_LIB + r'/libc/musl/arch/aarch64',
    '-I' + ZIG_LIB + r'/libc/musl/arch/generic',
]
obj = os.path.join(base, 'kusugso_plain.o')
run([MSYS_CLANG, '-target', 'aarch64-linux-musl', '-O2', '-fPIC',
     ] + incs + ['-c', 'KuSugSo.c', '-o', obj], 'clang 直编')
io.open(os.path.join(base, 'build_info.txt'), 'a', encoding='utf-8').write(
    '%s plain\n' % time.strftime('%Y-%m-%d %H:%M:%S'))

# 3) zig 链接(汇编 stub + 双版本) + 剥 .comment
OBJCOPY = r'D:\work\msys64\clang64\bin\llvm-objcopy.exe'
sobj = os.path.join(base, 'kusugso_stubs.o')
run([ZIG, 'cc', '-target', 'aarch64-linux-musl', '-c', 'kusug_stubs.S', '-o', sobj], 'zig 编译汇编 stub')
run([ZIG, 'cc', '-target', 'aarch64-linux-musl', '-shared', '-fPIC', '-O2', '-s',
     '-Wl,--hash-style=both', '-o', 'KuSug.so', obj, sobj], 'zig 链接 strip 版')
run([ZIG, 'cc', '-target', 'aarch64-linux-musl', '-shared', '-fPIC', '-O2',
     '-Wl,--hash-style=both', '-o', 'KuSug_sym.so', obj, sobj], 'zig 链接符号版')
run([OBJCOPY, '--remove-section=.comment', 'KuSug.so'], '剥 .comment (strip 版)')
run([OBJCOPY, '--remove-section=.comment', 'KuSug_sym.so'], '剥 .comment (符号版)')

# 4) 红线检查
run([sys.executable, 'check_needed.py'], 'check_needed.py')
run(['node', '../so_deps.js', 'KuSug.so'], 'so_deps')

# 5) 交付归集: 纯功能产物复制到 KuSug全套/交付/
import shutil
DIST = os.path.join(ROOT2, '交付')
if not os.path.isdir(DIST):
    os.makedirs(DIST)
shutil.copy2(os.path.join(base, 'KuSug.so'), os.path.join(DIST, 'KuSug.so'))
shutil.copy2(os.path.join(base, 'KuSug_sym.so'), os.path.join(DIST, 'KuSug_sym.so'))
shutil.copy2(os.path.join(ROOT2, 'KuSug.js'), os.path.join(DIST, 'KuSug.js'))
_so_sha = hashlib.sha256(io.open(os.path.join(DIST, 'KuSug.so'), 'rb').read()).hexdigest()
io.open(os.path.join(DIST, '说明.txt'), 'w', encoding='utf-8').write(
    u'本目录由 build_obf.py 自动更新, 为当前构建产物:\n'
    u'  KuSug.js + KuSug.so   —— 部署用; 纯功能直出版, 无配对约束, 可各自单独更换\n'
    u'  KuSug_sym.so          —— 符号版, 仅崩溃定位用, 不部署\n'
    u'构建时间: %s\nKuSug.so SHA-256: %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), _so_sha))
print('交付已更新: ' + DIST)
print('纯功能构建完成: KuSug.so / KuSug_sym.so')
