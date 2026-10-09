import {describe,expect,it} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {convertHtmlToPdf,parseOfflineHtml,HTML_TO_PDF_MAX_INPUT_BYTES} from './htmlToPdf';
const bytes=(str:string)=>new TextEncoder().encode(str);
describe('non-executing local HTML text subset to PDF',()=>{
  it('reopens a real generated PDF with heading, paragraph, list and code semantics',async()=>{
    const html=bytes('<!doctype html><html><head><title>Private</title></head>'+
      '<body><h1>Project &amp; report</h1><p>Hello <strong>team</strong>!</p>'+
      '<ul><li>First</li><li>Second &lt;3</li></ul>'+
      '<pre>const x = 4;</pre></body></html>');
    const lines=parseOfflineHtml(html);
    expect(lines).toMatchObject([
      {text:'Project & report',style:'heading1'},
      {text:'Hello team!',style:'body'},
      {text:'First',style:'list'},
      {text:'Second <3',style:'list'},
      {text:'const x = 4;',style:'code'},
    ]);
    const output=await convertHtmlToPdf(html);
    expect(output.slice(0,5)).toEqual(Uint8Array.from([37,80,68,70,45]));
    const doc=await PDFDocument.load(output);
    expect(doc.getPageCount()).toBeGreaterThan(0);
    expect(doc.getTitle()).toMatch(/HTML text document/);
  });
  it('treats entities and Unicode literally instead of invoking the HTML interpreter',()=>{
    const parts=parseOfflineHtml(bytes('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; Emoji &#x1F600;</p>'));
    expect(parts[0].text).toContain('<script>alert(1)</script>');
    expect(parts[0].text).toContain('\\ud83d\\ude00');
  });
  it('rejects embedded scripts, CSS, SVG, iframes, image or link fetching',()=>{
    for(const html of [
      '<script>alert(1)</script>',
      '<style>body{background:url(http://evil.test)}</style>',
      '<iframe src="http://evil.test"></iframe>',
      '<svg onload="evil()"></svg>',
      '<img src="http://remote.test/tracker"/>',
      '<link rel="stylesheet" href="http://evil.test/styles.css"/>',
      '<p onclick="evil()">run</p>',
      '<a href="http://evil.test">Click</a>',
    ]){
      expect(()=>parseOfflineHtml(bytes(html))).toThrow(/reviewed renderer|attributes/i);
    }
  });
  it('refuses mismatched, unclosed, invalid and declaration markup',()=>{
    for(const html of [
      '<p>Hello</div>', '<p><strong>hello</p></strong>',
      '<h1>Unclosed', '<!ENTITY x SYSTEM "file:///etc/passwd"><p>text</p>',
      '<p>a < b</p>',
    ]){
      expect(()=>parseOfflineHtml(bytes(html))).toThrow();
    }
  });
  it('rejects empty visible text, malformed UTF-8 and oversized inputs',()=>{
    expect(()=>parseOfflineHtml(bytes('<html><head><title>Only title</title></head><body></body></html>')))
      .toThrow(/no safely convertible/);
    expect(()=>parseOfflineHtml(Uint8Array.from([0xff,0xfe,0xfd])))
      .toThrow(/UTF-8/);
    expect(()=>parseOfflineHtml(new Uint8Array(HTML_TO_PDF_MAX_INPUT_BYTES+1)))
      .toThrow(/1 MB/);
  });
  it('never mutates the HTML source bytes',async()=>{
    const original=bytes('<h2>Report</h2><p>Content &amp; notes</p>');
    const before=Uint8Array.from(original);
    await convertHtmlToPdf(original);
    expect(original).toEqual(before);
  });
});
