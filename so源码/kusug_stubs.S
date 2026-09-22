    .text

/* 全现场保存 stub: 保存 x0-x8/q0-q7/x29/x30, 调 ks_world_hit(idx, sp), 恢复后按 ks_tramp_slots[idx] 跳原函数
   mesh 收浮点参数、mtx 入口读 x8(间接结果寄存器)——C 钩体会把它们当临时寄存器破坏(v31 探针实证崩溃), 必须全现场 */
.macro KS_STUB name, idx
    .globl ks_stub_\name
    .hidden ks_stub_\name
    .p2align 2
ks_stub_\name:
    bti c
    sub sp, sp, #208
    stp x0, x1, [sp, #0]
    stp x2, x3, [sp, #16]
    stp x4, x5, [sp, #32]
    stp x6, x7, [sp, #48]
    str x8, [sp, #64]
    stp q0, q1, [sp, #80]
    stp q2, q3, [sp, #96]
    stp q4, q5, [sp, #112]
    stp q6, q7, [sp, #128]
    stp x29, x30, [sp, #160]
    mov x0, #\idx
    mov x1, sp
    bl ks_world_hit
    ldp x29, x30, [sp, #160]
    ldp q6, q7, [sp, #128]
    ldp q4, q5, [sp, #112]
    ldp q2, q3, [sp, #96]
    ldp q0, q1, [sp, #80]
    ldr x8, [sp, #64]
    ldp x6, x7, [sp, #48]
    ldp x4, x5, [sp, #32]
    ldp x2, x3, [sp, #16]
    ldp x0, x1, [sp, #0]
    add sp, sp, #208
    mov w16, #\idx
    b ks_stub_tail
.endm

KS_STUB mesh, 0
KS_STUB mtx, 1

    .globl ks_stub_tail
    .hidden ks_stub_tail
    .p2align 2
ks_stub_tail:
    adrp x17, ks_tramp_slots
    add x17, x17, :lo12:ks_tramp_slots
    uxtw x16, w16
    ldr x16, [x17, x16, lsl #3]
    br x16
