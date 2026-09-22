# -*- coding: utf-8 -*-
# Kagura 混淆流水线: build_kusug_so.py 生成 KuSugSo.c -> MSYS2 clang+Kagura 编译 .o -> zig 链接 musl -> finalize 回填
# 用法: python build_obf.py
import os, subprocess, sys, io

base = os.path.dirname(os.path.abspath(__file__))
MSYS_CLANG = r'D:\work\msys64\clang64\bin\clang.exe'
KAGURA_DLL = r'D:\work\kagura-v0.2.0\build\lib\Transforms\KaguraObfuscator.dll'
ZIG = r'D:\work\zig014\zig-x86_64-windows-0.14.1\zig.exe'
ZIG_LIB = r'D:\work\zig014\zig-x86_64-windows-0.14.1\lib'

def run(cmd, tag):
    print('==', tag)
    r = subprocess.call(cmd, cwd=base)
    if r != 0:
        sys.exit('%s 失败 exit=%d' % (tag, r))

# 0) v29 内容为钥: 先构建 JS(内容为密钥派生源), 写 js_f.txt 供生成器烘焙
import hashlib
ROOT2 = os.path.dirname(os.path.dirname(base))
run(['node', os.path.join(ROOT2, '工具', 'build_js_protect.js')], '构建混淆 JS')
_jav = io.open(os.path.join(ROOT2, 'KuSug.js'), 'rb').read()
_fv = int.from_bytes(hashlib.sha256(_jav).digest()[:8], 'little')
io.open(os.path.join(base, 'js_f.txt'), 'w').write('%x' % _fv)
print('js_f.txt = %016x' % _fv)

# 1) 生成源码
run([sys.executable, 'build_kusug_so.py'], 'build_kusug_so.py')

# 2) MSYS2 clang + Kagura 混淆编译(目标 aarch64-linux-musl, 头文件借 zig 的 musl)
# v25 起关闭 kagura-str: 它会改写我们的 ks_enc 字节数组(宿主目标上实证损坏),
# 且对方已有 str 破解脚本——字符串保护由源码层 ks_sd/ks_ld 分钥加密承担,不再依赖 str。
# bcf 30->45;种子每次构建随机并留档,滚动变化让跨版本二进制 diff/特征脚本失效
import random, time
seed = random.randint(1, 2**31 - 1)
incs = [
    '-I' + ZIG_LIB + r'/libc/include/aarch64-linux-musl',
    '-I' + ZIG_LIB + r'/libc/include/any-linux-any',
    '-I' + ZIG_LIB + r'/libc/musl/include',
    '-I' + ZIG_LIB + r'/libc/musl/arch/aarch64',
    '-I' + ZIG_LIB + r'/libc/musl/arch/generic',
]
obj = os.path.join(base, 'kusugso_obf.o')
run([MSYS_CLANG, '-target', 'aarch64-linux-musl', '-O2', '-fPIC',
     '-fpass-plugin=' + KAGURA_DLL,
     '-mllvm', '-kagura-fla', '-mllvm', '-kagura-bcf', '-mllvm', '-kagura-sub',
     '-mllvm', '-kagura-deny=ks_entry,hk_swap,hk_swapd_khr,hk_swapd_ext,hk_sv_render,ks_now_ms,ks_render_active,ks_world_hit,ks_world_install,ks_w_stack_top,ks_wmr_ok,ks_wmr_snap,ks_wmr_hexu64,blend_px,draw_text,mb_*,ih_blend_px,ih_draw_text,ih_render,dir_render,dir_blend_px,dir_draw_text,dir_draw_text_scaled,dir_vline,dir_text_w_scaled,ch_render,ch_ring,ch_disc,ch_diag,ch_cross_arms,ch_rect_outline,wm_render,wm_draw_text,wm_text_w,wm_bounce,wpl_render,wpl_anim_run,wpl_build_base,wpl_build_glow,wpl_build_glow_alpha,wpl_blur3a,wpl_proj_anchor,wpl_pv_pick,wpl_smooth_step,wpl_now_ms,wpl_rr_d,wpl_ctx_is_game,wpl_pv_ready,stbtt_*',
     '-mllvm', '-kagura-bcf-prob=45', '-mllvm', '-kagura-seed=%d' % seed,
     ] + incs + ['-c', 'KuSugSo.c', '-o', obj], 'clang+Kagura 混淆编译')
io.open(os.path.join(base, 'build_info.txt'), 'a', encoding='utf-8').write(
    '%s seed=%d bcf=45\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), seed))

# 3) zig 链接(保留 musl 集成) + 剥 .comment(工具链指纹: v24 泄露 MSYS2/LLD 版本,对方同类指纹曾被我们用来画像)
OBJCOPY = r'D:\work\msys64\clang64\bin\llvm-objcopy.exe'
# 3.1) v32 世界矩阵管线的汇编 stub(mesh/mtx 全现场钩)单独编译进链接
sobj = os.path.join(base, 'kusugso_stubs.o')
run([ZIG, 'cc', '-target', 'aarch64-linux-musl', '-c', 'kusug_stubs.S', '-o', sobj], 'zig 编译汇编 stub')
run([ZIG, 'cc', '-target', 'aarch64-linux-musl', '-shared', '-fPIC', '-O2', '-s',
     '-Wl,--hash-style=both', '-o', 'KuSug.so', obj, sobj], 'zig 链接 strip 版')
run([ZIG, 'cc', '-target', 'aarch64-linux-musl', '-shared', '-fPIC', '-O2',
     '-Wl,--hash-style=both', '-o', 'KuSug_sym.so', obj, sobj], 'zig 链接符号版')
run([OBJCOPY, '--remove-section=.comment', 'KuSug.so'], '剥 .comment (strip 版)')
run([OBJCOPY, '--remove-section=.comment', 'KuSug_sym.so'], '剥 .comment (符号版)')

# 4) finalize 回填自校验签名槽
run([sys.executable, 'finalize_so.py'], 'finalize_so.py')
# so 重建会把 ks_js_exp 槽重置回 marker——用当前根 KuSug.js 立即重填,保持 so↔JS 配对
if os.path.isfile(os.path.join(os.path.dirname(os.path.dirname(base)), 'KuSug.js')):
    run([sys.executable, 'finalize_so.py', 'js'], 'finalize_so.py js(重填配对)')

# 5) 红线检查
run([sys.executable, 'check_needed.py'], 'check_needed.py')
run(['node', '../so_deps.js', 'KuSug.so'], 'so_deps')

# 6) 交付归集: 当前配对产物复制到 KuSug全套/交付/ —— 部署只认这一个目录, 不用翻 so探针
import shutil
DIST = os.path.join(ROOT2, '交付')
if not os.path.isdir(DIST):
    os.makedirs(DIST)
shutil.copy2(os.path.join(base, 'KuSug.so'), os.path.join(DIST, 'KuSug.so'))
shutil.copy2(os.path.join(base, 'KuSug_sym.so'), os.path.join(DIST, 'KuSug_sym.so'))
shutil.copy2(os.path.join(ROOT2, 'KuSug.js'), os.path.join(DIST, 'KuSug.js'))
_so_sha = hashlib.sha256(io.open(os.path.join(DIST, 'KuSug.so'), 'rb').read()).hexdigest()
io.open(os.path.join(DIST, '说明.txt'), 'w', encoding='utf-8').write(
    u'本目录由 build_obf.py 自动更新, 为当前构建的配对交付物:\n'
    u'  KuSug.js + KuSug.so   —— 部署用, 两个必须一起换(内容为钥配对)\n'
    u'  KuSug_sym.so          —— 符号版, 仅崩溃定位用, 不部署\n'
    u'构建时间: %s\nKuSug.so SHA-256: %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), _so_sha))
print('交付已更新: ' + DIST)
print('混淆构建完成: KuSug.so / KuSug_sym.so')
