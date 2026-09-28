#!/usr/bin/env python3
"""Disassemble one method (with bytecode offsets) for debugging the JS JVM."""
import struct, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classdump import parse

NAMES = ["nop","aconst_null","iconst_m1","iconst_0","iconst_1","iconst_2","iconst_3","iconst_4","iconst_5","lconst_0","lconst_1","fconst_0","fconst_1","fconst_2","dconst_0","dconst_1","bipush","sipush","ldc","ldc_w","ldc2_w","iload","lload","fload","dload","aload","iload_0","iload_1","iload_2","iload_3","lload_0","lload_1","lload_2","lload_3","fload_0","fload_1","fload_2","fload_3","dload_0","dload_1","dload_2","dload_3","aload_0","aload_1","aload_2","aload_3","iaload","laload","faload","daload","aaload","baload","caload","saload","istore","lstore","fstore","dstore","astore","istore_0","istore_1","istore_2","istore_3","lstore_0","lstore_1","lstore_2","lstore_3","fstore_0","fstore_1","fstore_2","fstore_3","dstore_0","dstore_1","dstore_2","dstore_3","astore_0","astore_1","astore_2","astore_3","iastore","lastore","fastore","dastore","aastore","bastore","castore","sastore","pop","pop2","dup","dup_x1","dup_x2","dup2","dup2_x1","dup2_x2","swap","iadd","ladd","fadd","dadd","isub","lsub","fsub","dsub","imul","lmul","fmul","dmul","idiv","ldiv","fdiv","ddiv","irem","lrem","frem","drem","ineg","lneg","fneg","dneg","ishl","lshl","ishr","lshr","iushr","lushr","iand","land","ior","lor","ixor","lxor","iinc","i2l","i2f","i2d","l2i","l2f","l2d","f2i","f2l","f2d","d2i","d2l","d2f","i2b","i2c","i2s","lcmp","fcmpl","fcmpg","dcmpl","dcmpg","ifeq","ifne","iflt","ifge","ifgt","ifle","if_icmpeq","if_icmpne","if_icmplt","if_icmpge","if_icmpgt","if_icmple","if_acmpeq","if_acmpne","goto","jsr","ret","tableswitch","lookupswitch","ireturn","lreturn","freturn","dreturn","areturn","return","getstatic","putstatic","getfield","putfield","invokevirtual","invokespecial","invokestatic","invokeinterface","invokedynamic","new","newarray","anewarray","arraylength","athrow","checkcast","instanceof","monitorenter","monitorexit","wide","multianewarray","ifnull","ifnonnull","goto_w","jsr_w"]


def refstr(c, idx):
    cp = c['raw']; utf = c['utf']
    e = cp[idx]
    if not e:
        return str(idx)
    if e[0] == 'Ref':
        ci, nti = e[2], e[3]
        nt = cp[nti]
        return utf(cp[ci][1]) + '.' + utf(nt[1]) + utf(nt[2])
    if e[0] == 'Int':
        return str(e[1])
    if e[0] == 'String':
        return repr(utf(e[1]))
    if e[0] == 'Class':
        return utf(e[1])
    return str(e)


def main():
    path, want, desc = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else None)
    c = parse(path)
    for af, name, d, attrs in c['methods']:
        if name != want or (desc and d != desc):
            continue
        for an, av in attrs:
            if an != 'Code':
                continue
            clen = struct.unpack('>I', av[4:8])[0]
            code = av[8:8+clen]
            print('=== %s%s  len=%d' % (name, d, clen))
            pc = 0
            while pc < len(code):
                op = code[pc]
                out = '  %5d: %-16s' % (pc, NAMES[op] if op < len(NAMES) else 'op%d' % op)
                if op == 0xaa:
                    pad = (4 - (pc + 1) % 4) % 4
                    j = pc + 1 + pad
                    df, lo, hi = struct.unpack('>iii', code[j:j+12])
                    out += 'lo=%d hi=%d default=%d' % (lo, hi, pc + df)
                    print(out)
                    for t in range(hi - lo + 1):
                        off = struct.unpack('>i', code[j+12+4*t:j+16+4*t])[0]
                        print('           case %d -> %d' % (lo + t, pc + off))
                    pc = j + 12 + 4 * (hi - lo + 1)
                elif op == 0xab:
                    pad = (4 - (pc + 1) % 4) % 4
                    j = pc + 1 + pad
                    df, np = struct.unpack('>ii', code[j:j+8])
                    print(out + 'default=%d npairs=%d' % (pc + df, np))
                    for t in range(np):
                        k, off = struct.unpack('>ii', code[j+8+8*t:j+16+8*t])
                        print('           case %d -> %d' % (k, pc + off))
                    pc = j + 8 + 8 * np
                elif op == 0xc4:
                    print(out + 'wide')
                    pc += 6 if code[pc+1] == 0x84 else 4
                elif op in (0xb9, 0xba, 0xc8, 0xc9):
                    idx = struct.unpack('>H', code[pc+1:pc+3])[0]
                    print(out + refstr(c, idx))
                    pc += 5
                elif op == 0xc5:
                    idx = struct.unpack('>H', code[pc+1:pc+3])[0]
                    print(out + refstr(c, idx) + ' dims=' + str(code[pc+3]))
                    pc += 4
                elif op == 0x10:
                    print(out + str((code[pc+1] << 24) >> 24))
                    pc += 2
                elif op == 0x11:
                    print(out + str(struct.unpack('>h', code[pc+1:pc+3])[0]))
                    pc += 3
                elif op == 0x12:
                    print(out + refstr(c, code[pc+1]))
                    pc += 2
                elif op in (0x13, 0x14):
                    idx = struct.unpack('>H', code[pc+1:pc+3])[0]
                    print(out + refstr(c, idx))
                    pc += 3
                elif op in (0x15, 0x16, 0x17, 0x18, 0x19, 0x36, 0x37, 0x38, 0x39, 0x3a, 0xbc, 0xa9):
                    print(out + str(code[pc+1]))
                    pc += 2
                elif op in (0xb2, 0xb3, 0xb4, 0xb5, 0xbb, 0xbd, 0xb6, 0xb7, 0xb8, 0xc0, 0xc1):
                    idx = struct.unpack('>H', code[pc+1:pc+3])[0]
                    print(out + refstr(c, idx))
                    pc += 3
                elif op == 0x84:
                    print(out + 'local %d by %d' % (code[pc+1], (code[pc+2] << 24) >> 24))
                    pc += 3
                elif (0x99 <= op <= 0xa8) or op in (0xc6, 0xc7):
                    off = struct.unpack('>h', code[pc+1:pc+3])[0]
                    print(out + '-> %d' % (pc + off))
                    pc += 3
                else:
                    print(out)
                    pc += 1
        break


if __name__ == '__main__':
    main()
