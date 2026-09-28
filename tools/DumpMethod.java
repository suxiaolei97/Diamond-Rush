import org.objectweb.asm.*;
import java.util.zip.*;
import java.io.*;

/** Prints bytecode with offsets for one method of a class in a jar. */
public class DumpMethod {
    public static void main(String[] args) throws Exception {
        String jar = args[0], cls = args[1], method = args[2], desc = args.length > 3 ? args[3] : null;
        ZipFile zf = new ZipFile(jar);
        ZipEntry e = zf.getEntry(cls + ".class");
        ClassReader cr = new ClassReader(zf.getInputStream(e));
        cr.accept(new ClassVisitor(Opcodes.ASM9) {
            public MethodVisitor visitMethod(int a, String n, String d, String s, String[] ex) {
                if (!n.equals(method)) return null;
                if (desc != null && !d.equals(desc)) return null;
                System.out.println("=== " + n + d);
                return new MethodVisitor(Opcodes.ASM9) {
                    public void visitInsn(int op) { System.out.println("  " + op + ": " + opName(op)); }
                    public void visitIntInsn(int op, int v) { System.out.println("  " + op + ": " + opName(op) + " " + v); }
                    public void visitVarInsn(int op, int v) { System.out.println("  " + op + ": " + opName(op) + " " + v); }
                    public void visitTypeInsn(int op, String t) { System.out.println("  " + op + ": " + opName(op) + " " + t); }
                    public void visitFieldInsn(int op, String o, String n, String d) { System.out.println("  " + op + ": " + opName(op) + " " + o + "." + n + ":" + d); }
                    public void visitMethodInsn(int op, String o, String n, String d, boolean itf) { System.out.println("  " + op + ": " + opName(op) + " " + o + "." + n + d); }
                    public void visitJumpInsn(int op, Label l) { System.out.println("  " + op + ": " + opName(op) + " -> " + l); }
                    public void visitLabel(Label l) { System.out.println("  " + opcode(l) + ": " + l); }
                };
            }
            int opcode(Label l) { return 0; }
        }, 0);
    }
    static String opName(int op) {
        final String[] names = {"nop","aconst_null","iconst_m1","iconst_0","iconst_1","iconst_2","iconst_3","iconst_4","iconst_5","lconst_0","lconst_1","fconst_0","fconst_1","fconst_2","dconst_0","dconst_1","bipush","sipush","ldc","ldc_w","ldc2_w","iload","lload","fload","dload","aload","iload_0","iload_1","iload_2","iload_3","lload_0","lload_1","lload_2","lload_3","fload_0","fload_1","fload_2","fload_3","dload_0","dload_1","dload_2","dload_3","aload_0","aload_1","aload_2","aload_3","iaload","laload","faload","daload","aaload","baload","caload","saload","istore","lstore","fstore","dstore","astore","istore_0","istore_1","istore_2","istore_3","lstore_0","lstore_1","lstore_2","lstore_3","fstore_0","fstore_1","fstore_2","fstore_3","dstore_0","dstore_1","dstore_2","dstore_3","astore_0","astore_1","astore_2","astore_3","iastore","lastore","fastore","dastore","aastore","bastore","castore","sastore","pop","pop2","dup","dup_x1","dup_x2","dup2","dup2_x1","dup2_x2","swap","iadd","ladd","fadd","dadd","isub","lsub","fsub","dsub","imul","lmul","fmul","dmul","idiv","ldiv","fdiv","ddiv","irem","lrem","frem","drem","ineg","lneg","fneg","dneg","ishl","lshl","ishr","lshr","iushr","lushr","iand","land","ior","lor","ixor","lxor","iinc","i2l","i2f","i2d","l2i","l2f","l2d","f2i","f2l","f2d","d2i","d2l","d2f","i2b","i2c","i2s","lcmp","fcmpl","fcmpg","dcmpl","dcmpg","ifeq","ifne","iflt","ifge","ifgt","ifle","if_icmpeq","if_icmpne","if_icmplt","if_icmpge","if_icmpgt","if_icmple","if_acmpeq","if_acmpne","goto","jsr","ret","tableswitch","lookupswitch","ireturn","lreturn","freturn","dreturn","areturn","return","getstatic","putstatic","getfield","putfield","invokevirtual","invokespecial","invokestatic","invokeinterface","invokedynamic","new","newarray","anewarray","arraylength","athrow","checkcast","instanceof","monitorenter","monitorexit","wide","multianewarray","ifnull","ifnonnull","goto_w","jsr_w"};
        return op >= 0 && op < names.length ? names[op] : ("op" + op);
    }
}
