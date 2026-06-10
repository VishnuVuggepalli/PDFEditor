import { describe, expect, it } from 'vitest';
import { editCodepoints, hasSubsetPrefix, pickBase14, stripSubsetPrefix } from './mupdfFonts';

describe('subset prefix handling', () => {
  it('strips the six-letter subset tag', () => {
    expect(stripSubsetPrefix('ABCDEF+Helvetica')).toBe('Helvetica');
    expect(stripSubsetPrefix('QOGDZQ+DroidSansFallback')).toBe('DroidSansFallback');
  });

  it('leaves untagged names alone', () => {
    expect(stripSubsetPrefix('Helvetica-Bold')).toBe('Helvetica-Bold');
    expect(stripSubsetPrefix('ABC+Font')).toBe('ABC+Font'); // tag must be 6 letters
  });

  it('detects tagged names', () => {
    expect(hasSubsetPrefix('ABCDEF+Foo')).toBe(true);
    expect(hasSubsetPrefix('Foo')).toBe(false);
  });
});

describe('pickBase14', () => {
  const span = (name: string, family = 'sans-serif', weight = 'normal', style = 'normal') => ({
    name,
    family,
    weight,
    style,
  });

  it('passes exact standard-14 names through, even subset-tagged', () => {
    expect(pickBase14(span('Times-Bold', 'serif', 'bold'))).toBe('Times-Bold');
    expect(pickBase14(span('ABCDEF+Helvetica-Oblique'))).toBe('Helvetica-Oblique');
    expect(pickBase14(span('Courier'))).toBe('Courier');
  });

  it('maps metric clones to their standard-14 equivalent', () => {
    expect(pickBase14(span('Arial-BoldMT', 'sans-serif', 'bold'))).toBe('Helvetica-Bold');
    expect(pickBase14(span('TimesNewRomanPSMT', 'serif'))).toBe('Times-Roman');
    expect(pickBase14(span('TimesNewRomanPS-ItalicMT', 'serif', 'normal', 'italic'))).toBe(
      'Times-Italic',
    );
    expect(pickBase14(span('NimbusRoman-Regular', 'serif'))).toBe('Times-Roman');
    expect(pickBase14(span('LiberationMono', 'monospace'))).toBe('Courier');
    expect(pickBase14(span('CourierNewPS-BoldMT', 'monospace', 'bold'))).toBe('Courier-Bold');
  });

  it('detects weight/style from name hints when stext flags are missing', () => {
    expect(pickBase14(span('Lato-Black'))).toBe('Helvetica-Bold');
    expect(pickBase14(span('SomeFont-Oblique'))).toBe('Helvetica-Oblique');
    expect(pickBase14(span('Georgia-BoldItalic', 'serif'))).toBe('Times-BoldItalic');
  });

  it('falls back to the stext family for unknown names', () => {
    expect(pickBase14(span('Mystery', 'serif', 'bold', 'italic'))).toBe('Times-BoldItalic');
    expect(pickBase14(span('Mystery', 'monospace'))).toBe('Courier');
    expect(pickBase14(span('Mystery', 'sans-serif'))).toBe('Helvetica');
  });

  it('is deterministic', () => {
    const s = span('DejaVuSerif-Bold', 'serif', 'bold');
    expect(pickBase14(s)).toBe(pickBase14(s));
    expect(pickBase14(s)).toBe('Times-Bold');
  });
});

describe('editCodepoints', () => {
  it('collects unique Latin-1 codepoints', () => {
    expect(editCodepoints('AbA')).toEqual([65, 98]);
  });

  it('maps non-Latin-1 and control characters to "?"', () => {
    expect(editCodepoints('€')).toEqual([63]);
    expect(editCodepoints('\t')).toEqual([63]);
  });

  it('skips newline/CR (escaped, not drawn)', () => {
    expect(editCodepoints('a\nb\r')).toEqual([97, 98]);
  });
});
