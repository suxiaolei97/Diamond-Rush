#!/usr/bin/env python3
"""Abstract-simulate a method and compare with the JS VM [ops] trace.

Usage: stackcheck.py <class-file> <method-name> <trace-file>
"""
import re, struct, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from classdump import parse


def parse_code(c, want):
    for af, name, desc, attrs in c['methods']:
        if name != want:
            continue
        for an, av in attrs:
            if an == 'Code':
                return av[8:8 + struct.unpack('>I', av[4:8])[0]], desc
    return None, None


def instruction_list(code):
    """Return list of (pc, op, operand, next_pc)."""
    out = []
    i = 0
    n = len(code)
    while i < n:
        pc = i
        op = code[i]
        operand = None
        if op in (0x10, 0x12, 0x15, 0x16, 0x17, 0x18, 0x19, 0x36, 0x37, 0x38, 0x39, 0x3a, 0xbc, 0xa9):
            operand = code[i + 1]; i += 2
        elif op in (0x11, 0x13, 0x84):
            operand = struct.unpack('>h', code[i + 1:i + 3])[0]; i += 3
        elif op in (0x14, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xbb, 0xbd, 0xc0, 0xc1):
            operand = struct.unpack('>H', code[i + 1:i + 3])[0]; i += 3
        elif op == 0xb9:
            operand = struct.unpack('>H', code[i + 1:i + 3])[0]; i += 5
        elif op in (0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xc6, 0xc7):
            operand = struct.unpack('>h', code[i + 1:i + 3])[0]; i += 3
        elif op == 0xaa:
            pad = (4 - (i + 1) % 4) % 4
            j = i + 1 + pad
            df, lo, hi = struct.unpack('>iii', code[j:j + 12])
            operand = (df, lo, hi, [struct.unpack('>i', code[j + 12 + 4 * t:j + 16 + 4 * t])[0] for t in range(hi - lo + 1)])
            i = j + 12 + 4 * (hi - lo + 1)
        elif op == 0xab:
            pad = (4 - (i + 1) % 4) % 4
            j = i + 1 + pad
            df, np = struct.unpack('>ii', code[j:j + 8])
            operand = (df, [struct.unpack('>ii', code[j + 8 + 8 * t:j + 16 + 8 * t]) for t in range(np)])
            i = j + 8 + 8 * np
        elif op == 0xc5:
            operand = (struct.unpack('>H', code[i + 1:i + 3])[0], code[i + 3]); i += 4
        else:
            i += 1
        out.append((pc, op, operand, i))
    return out


def argcount(desc):
    i, n = 1, 0
    while desc[i] != ')':
        c = desc[i]
        if c == '[':
            n += 1; i += 1
            while desc[i] == '[':
                i += 1
            if desc[i] == 'L':
                while desc[i] != ';':
                    i += 1
            i += 1
        elif c == 'L':
            while desc[i] != ';':
                i += 1
            i += 1; n += 1
        else:
            i += 1; n += 1
    return n


def rettype(desc):
    return desc[desc.index(')') + 1:]


def main():
    cf = parse(sys.argv[1])
    code, mdesc = parse_code(cf, sys.argv[2])
    if not code:
        print('method not found'); return
    insns = instruction_list(code)
    by_pc = {pc: (op, operand, nxt) for pc, op, operand, nxt in insns}
    refs = cf['raw']; utf = cf['utf']

    def ref(idx):
        e = refs[idx]
        if e and e[0] == 'Ref':
            nt = refs[e[3]]
            return utf(nt[1]), utf(nt[2])
        return ('?', '?')

    def fieldtype(idx):
        _, d = ref(idx)
        return d

    def methodinfo(idx):
        _, d = ref(idx)
        return d

    trace = []
    for line in open(sys.argv[3], errors='replace'):
        m = re.search(r'\[ops\] (\d+) (\d+) (\d+)', line)
        if m:
            trace.append((int(m.group(1)), int(m.group(2)), int(m.group(3))))

    print('trace ops:', len(trace), 'method code:', len(code))
    sim = []  # marks: 'J' long else '1'
    for n, (pc, sp_before, opcode) in enumerate(trace):
        op, operand, nxt = by_pc[pc]
        if op != opcode:
            print('TRACE OP MISMATCH at pc=%d: trace=0x%02x disasm=0x%02x' % (pc, opcode, op))
            return
        try:
            apply(sim, op, operand, code, pc, ref, fieldtype, methodinfo, argcount, rettype)
        except IndexError:
            print('SIM UNDERFLOW at pc=%d op=0x%02x sp_before=%d' % (pc, op, sp_before))
            return
        actual_next = trace[n + 1][1] if n + 1 < len(trace) else len(sim)
        if len(sim) != actual_next:
            print('MISMATCH after pc=%d op=0x%02x: sim_depth=%d actual_next_sp=%d' % (pc, op, len(sim), actual_next))
            for k in range(max(0, n - 8), min(len(trace), n + 3)):
                tpc, tsp, top = trace[k]
                dop, dopnd, dnxt = by_pc[tpc]
                print('   pc=%-5d sp=%-2d op=0x%02x (operand=%s)' % (tpc, tsp, top, dopnd))
            return
    print('stack simulation matches trace for all %d instructions' % len(trace))


def apply(sim, op, operand, code, pc, ref, fieldtype, methodinfo, argcount, rettype):
    def pop():
        sim.pop()
    def push(t='1'):
        sim.append(t)
    if op == 0x00:
        pass
    elif op in (0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13):
        push()
    elif op in (0x09, 0x0a, 0x14):
        push('J')
    elif op in (0x15, 0x1a, 0x1b, 0x1c, 0x1d, 0x2a, 0x2b, 0x2c, 0x2d):
        push()
    elif op in (0x16, 0x1e, 0x1f, 0x20, 0x21):
        push('J')
    elif op in (0x17, 0x22, 0x23, 0x24, 0x25):
        push()
    elif op in (0x18, 0x26, 0x27, 0x28, 0x29):
        push()
    elif op in (0x19,):
        push()
    elif op in (0x2e, 0x30, 0x31, 0x33, 0x34, 0x35, 0x32):
        pop(); pop(); push()
    elif op in (0x2f,):
        pop(); pop(); push('J')
    elif op in (0x36, 0x3b, 0x3c, 0x3d, 0x3e, 0x38, 0x39, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e):
        pop()
    elif op in (0x37, 0x3f, 0x40, 0x41, 0x42):
        pop()
    elif op in (0x3a,):
        pop()
    elif op in (0x4f, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x50):
        pop(); pop(); pop()
    elif op == 0x57:
        pop()
    elif op == 0x58:
        if sim[-1] == 'J':
            pop()
        else:
            pop(); pop()
    elif op == 0x59:
        push(sim[-1])
    elif op == 0x5a:
        v1 = pop(); v2 = pop()
        push(v1); push(v2); push(v1)
    elif op == 0x5b:
        v1 = pop(); v2 = pop(); v3 = pop()
        push(v1); push(v3); push(v2); push(v1)
    elif op == 0x5c:
        if sim[-1] == 'J':
            push('J')
        else:
            a = sim[-2]; b = sim[-1]
            push(a); push(b)
    elif op == 0x5d:
        if sim[-1] == 'J':
            a = pop(); b = pop()
            push(a); push(b); push(a)
        else:
            a = pop(); b = pop(); c = pop()
            push(b); push(a); push(c); push(b); push(a)
    elif op == 0x5e:
        if sim[-1] == 'J':
            a = pop(); b = pop(); c = pop()
            push(a); push(c); push(b); push(a)
        else:
            a = pop(); b = pop(); c = pop(); d = pop()
            push(c); push(a); push(d); push(b); push(c); push(a)
    elif op == 0x5f:
        a = pop(); b = pop()
        push(a); push(b)
    elif op in (0x60, 0x64, 0x68, 0x6c, 0x70, 0x78, 0x7a, 0x7c, 0x7e, 0x80, 0x82):
        pop(); pop(); push()
    elif op in (0x61, 0x65, 0x69, 0x6d, 0x71, 0x7f, 0x81, 0x83):
        pop(); pop(); push('J')
    elif op == 0x74:
        pass
    elif op == 0x75:
        sim[-1] = 'J'
    elif op == 0x84:
        pass
    elif op in (0x85,):
        sim[-1] = 'J'
    elif op in (0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e, 0x8f, 0x90, 0x91, 0x92, 0x93):
        sim[-1] = '1'
    elif op == 0x94:
        pop(); pop(); push()
    elif op in (0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e):
        pop()
    elif op in (0x9f, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6):
        pop(); pop()
    elif op == 0xa7:
        pass
    elif op in (0xac, 0xad, 0xae, 0xaf, 0xb0):
        pop()
    elif op == 0xb1:
        pass
    elif op == 0xb2:
        d = fieldtype(operand)
        push('J' if d == 'J' else '1')
    elif op == 0xb3:
        pop()
    elif op == 0xb4:
        pop(); push('J' if fieldtype(operand) == 'J' else '1')
    elif op == 0xb5:
        pop(); pop()
    elif op in (0xb6, 0xb7, 0xb9):
        d = methodinfo(operand)
        for _ in range(argcount(d)):
            pop()
        pop()
        rt = rettype(d)
        if rt != 'V':
            push('J' if rt == 'J' else '1')
    elif op == 0xb8:
        d = methodinfo(operand)
        for _ in range(argcount(d)):
            pop()
        rt = rettype(d)
        if rt != 'V':
            push('J' if rt == 'J' else '1')
    elif op == 0xbb:
        push()
    elif op in (0xbc, 0xbd):
        pop(); push()
    elif op == 0xbe:
        pop(); push()
    elif op == 0xbf:
        pop()
    elif op == 0xc0:
        pass
    elif op == 0xc1:
        pop(); push()
    elif op in (0xc2, 0xc3):
        pop()
    elif op == 0xc5:
        for _ in range(operand[1]):
            pop()
        push()
    elif op in (0xc6, 0xc7):
        pop()
    else:
        raise Exception('unhandled op 0x%02x' % op)


if __name__ == '__main__':
    main()
