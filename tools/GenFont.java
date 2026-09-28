import java.awt.*;
import java.awt.font.FontRenderContext;
import java.awt.font.GlyphVector;
import java.awt.image.BufferedImage;
import java.util.Base64;

/**
 * Generates clean bitmap font data (base64) for the JS port.
 * Each glyph is rendered large, then area-downsampled into the target cell
 * so glyphs are complete and readable.
 */
public class GenFont {

    public static void main(String[] args) throws Exception {
        // medium: glyph 6x10 (cell 7); small: glyph 5x8 (cell 6)
        System.out.println("var FONT_MEDIUM = \"" + gen(6, 10, 13, 10) + "\";");
        System.out.println("var FONT_SMALL = \"" + gen(5, 8, 10, 8) + "\";");
    }

    static String gen(int gw, int gh, int lineH, int ascent) throws Exception {
        final int S = 6; // supersample factor
        Font font = new Font("SansSerif", Font.BOLD, lineH * S);
        byte[] out = new byte[95 * ((gw * gh + 7) / 8)];
        int oi = 0;
        for (int ch = 32; ch < 127; ch++) {
            byte[] glyphBits = new byte[(gw * gh + 7) / 8];
            if (ch != 32) {
                BufferedImage img = new BufferedImage(gw * S, gh * S, BufferedImage.TYPE_BYTE_GRAY);
                Graphics2D g = img.createGraphics();
                g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
                g.setFont(font);
                g.setColor(Color.BLACK);
                g.fillRect(0, 0, gw * S, gh * S);
                g.setColor(Color.WHITE);
                // draw so the baseline sits at 'ascent' rows from the top
                int baseline = ascent * S;
                g.drawString(String.valueOf((char) ch), 0, baseline);
                g.dispose();
                int bit = 0;
                for (int y = 0; y < gh; y++) {
                    for (int x = 0; x < gw; x++) {
                        int sum = 0;
                        for (int sy = 0; sy < S; sy++) {
                            for (int sx = 0; sx < S; sx++) {
                                sum += img.getRaster().getSample(x * S + sx, y * S + sy, 0);
                            }
                        }
                        double cov = sum / (double) (S * S * 255);
                        if (cov > 0.42) glyphBits[(bit) >> 3] |= (byte) (1 << (7 - (bit & 7)));
                        bit++;
                    }
                }
            }
            System.arraycopy(glyphBits, 0, out, oi, glyphBits.length);
            oi += glyphBits.length;
        }
        return Base64.getEncoder().encodeToString(out);
    }
}
