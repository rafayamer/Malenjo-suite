import {describe,expect,it} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {convertEmlToPdf,parseEmlPdfLines,EML_TO_PDF_MAX_BYTES} from './emlToPdf';
const bytes=(value:string)=>new TextEncoder().encode(value);
const message=(body:string,extras='')=>bytes(
  'From: sender@example.test\r\nTo: recipient@example.test\r\n'+
  'Subject: Unit testing & symbols\r\nDate: Fri, 09 Oct 2026 16:01:00 +0000\r\n'+
  extras+'\r\n'+body,
);
describe('offline EML text-only MIME to searchable PDF',()=>{
  it('renders actual plain-text message content and reopens the generated PDF',async()=>{
    const original=message('Hello team,\r\nRead this literal <script> text.\r\nRegards.');
    const snapshot=Uint8Array.from(original);
    const text=parseEmlPdfLines(original).map(x=>x.text).join('\n');
    expect(text).toContain('Unit testing & symbols');
    expect(text).toContain('Read this literal <script> text.');
    const converted=await convertEmlToPdf(original);
    expect(converted.slice(0,5)).toEqual(Uint8Array.from([37,80,68,70,45]));
    const reopened=await PDFDocument.load(converted);
    expect(reopened.getPageCount()).toBeGreaterThan(0);
    expect(reopened.getTitle()).toContain('Email message');
    expect(original).toEqual(snapshot);
  });
  it('decodes a quoted-printable text/plain body without executing markup',()=>{
    const mail=message('Hello=20user=0A=3Cscript=3Eharmless=3C/script=3E',
      'Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n');
    const lines=parseEmlPdfLines(mail).map(x=>x.text).join('\n');
    expect(lines).toContain('Hello user');
    expect(lines).toContain('<script>harmless</script>');
  });
  it('accepts base64 encoded UTF-8 text/plain and preserves non-ASCII visibly',()=>{
    const content='Message body: café 😀';
    const packed=btoa(String.fromCharCode(...new TextEncoder().encode(content)));
    const mail=message(packed,'Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n');
    const lines=parseEmlPdfLines(mail).map(x=>x.text).join('\n');
    expect(lines).toContain('caf\\u00e9');
    expect(lines).toContain('\\ud83d\\ude00');
  });
  it('extracts only the text/plain alternative and never executes HTML content',()=>{
    const input=message(
      '--mail_boundary\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n'+
      'Safe plain body\r\n--mail_boundary\r\nContent-Type: text/html\r\n\r\n'+
      '<img src="http://remote.test/tracker"><script>evil</script>\r\n--mail_boundary--',
      'MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="mail_boundary"\r\n',
    );
    const text=parseEmlPdfLines(input).map(line=>line.text).join('\n');
    expect(text).toContain('Safe plain body');
    expect(text).not.toContain('remote.test');
    expect(text).not.toContain('<script>evil</script>');
  });
  it('refuses attachments and unsupported binary MIME members instead of silently dropping them',()=>{
    const mail=message(
      '--m\r\nContent-Type: text/plain\r\n\r\nHello\r\n'+
      '--m\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="private.pdf"\r\n'+
      'Content-Transfer-Encoding: base64\r\n\r\nUEs=\r\n--m--',
      'Content-Type: multipart/mixed; boundary="m"\r\n',
    );
    expect(()=>parseEmlPdfLines(mail)).toThrow(/attachment/i);
  });
  it('refuses HTML-only mail and malformed MIME boundaries',()=>{
    expect(()=>parseEmlPdfLines(message('<script>alert(1)</script>',
      'Content-Type: text/html\r\n'))).toThrow(/HTML-only/);
    expect(()=>parseEmlPdfLines(message('--missing\r\nBody',
      'Content-Type: multipart/alternative; boundary="missing"\r\n')))
      .toThrow(/incomplete/);
  });
  it('rejects malformed base64, illegal quoted-printable and ambiguous duplicate MIME headers',()=>{
    expect(()=>parseEmlPdfLines(message('a@@@',
      'Content-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n')))
      .toThrow(/base64/);
    expect(()=>parseEmlPdfLines(message('abc=XZ',
      'Content-Type: text/plain\r\nContent-Transfer-Encoding: quoted-printable\r\n')))
      .toThrow(/quoted-printable/);
    expect(()=>parseEmlPdfLines(message('abc',
      'Content-Type: text/plain\r\nContent-Type: text/html\r\n')))
      .toThrow(/duplicate MIME/);
  });
  it('rejects oversized source, missing headers and unsupported text encodings',()=>{
    expect(()=>parseEmlPdfLines(new Uint8Array(EML_TO_PDF_MAX_BYTES+1))).toThrow(/2 MB/);
    expect(()=>parseEmlPdfLines(bytes('Not an email'))).toThrow(/RFC 5322/);
    expect(()=>parseEmlPdfLines(message('Text','Content-Type: text/plain; charset="utf-16le"\r\n')))
      .toThrow(/character set/);
  });
});
