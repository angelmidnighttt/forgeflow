import { describe, expect, it } from '@jest/globals';
import { renderEmailLayout } from '../../../src/common/templates/email-layout.template.js';
import { verifyEmailTemplate } from '../../../src/common/templates/verify-email.template.js';
import { escapeHtml } from '../../../src/common/utils/html.util.js';
import { webLink } from '../../../src/common/utils/web-link.util.js';

describe('escapeHtml', () => {
  it('escapes the characters that can open markup or end an attribute', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
});

describe('webLink', () => {
  it('puts the secret in the fragment, never in the query', () => {
    const link = webLink('http://localhost:3000', '/verify-email', 'abc_DEF-123');
    expect(link).toBe('http://localhost:3000/verify-email#token=abc_DEF-123');
    expect(new URL(link).search).toBe('');
  });

  it('builds a plain link without a secret', () => {
    expect(webLink('https://app.example.com', '/forgot-password')).toBe(
      'https://app.example.com/forgot-password',
    );
  });
});

describe('renderEmailLayout', () => {
  const rendered = renderEmailLayout({
    heading: 'Heading <1>',
    paragraphs: ['First & foremost', 'Second "quoted"'],
    action: { label: 'Do it', url: 'https://app.example.com/x#token=abc' },
    footnote: 'Small print',
  });

  it('has a text version with every part and the full link', () => {
    expect(rendered.text).toBe(
      [
        'Heading <1>',
        '',
        'First & foremost',
        '',
        'Second "quoted"',
        '',
        'Do it: https://app.example.com/x#token=abc',
        '',
        'Small print',
        '',
        '— ForgeFlow',
      ].join('\n'),
    );
  });

  it('escapes every value in the HTML version', () => {
    expect(rendered.html).toContain(
      '<h1 style="margin:0 0 24px;font-size:20px">Heading &lt;1&gt;</h1>',
    );
    expect(rendered.html).toContain('First &amp; foremost');
    expect(rendered.html).toContain('Second &quot;quoted&quot;');
    expect(rendered.html).toContain('href="https://app.example.com/x#token=abc"');
  });

  it('leaves out the action and footnote when not given', () => {
    const plain = renderEmailLayout({ heading: 'H', paragraphs: ['P'] });
    expect(plain.html).not.toContain('<a ');
    expect(plain.text).toBe('H\n\nP\n\n— ForgeFlow');
  });
});

describe('verifyEmailTemplate', () => {
  it('greets by name when there is one', () => {
    const withName = verifyEmailTemplate({
      name: 'Ann',
      url: 'https://x/v#token=t',
      expiresInHours: 24,
    });
    const withoutName = verifyEmailTemplate({
      name: null,
      url: 'https://x/v#token=t',
      expiresInHours: 24,
    });
    expect(withName.text).toContain('Hi Ann,');
    expect(withoutName.text).toContain('Hi,');
    expect(withName.text).toContain('expires in 24 hours');
  });
});
