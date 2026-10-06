import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function text(path:string):string{
  return readFileSync(path,'utf8');
}

describe('Windows PDF provider packaging contract',()=>{
  it('maps Stirling, qpdf and Tesseract to stable Tauri resource destinations',()=>{
    const config=JSON.parse(text('src-tauri/tauri.conf.json')) as {
      bundle:{resources:Record<string,string>};
    };
    expect(config.bundle.resources['../provider-packs/stirling-core/']).toBe('provider-packs/stirling-core/');
    expect(config.bundle.resources['../provider-packs/qpdf/']).toBe('provider-packs/qpdf/');
    expect(config.bundle.resources['../provider-packs/tesseract/']).toBe('provider-packs/tesseract/');
  });

  it('keeps generated qpdf layout and native packaged lookup aligned',()=>{
    const builder=text('scripts/build-qpdf-windows.ps1');
    const native=text('src-tauri/src/suite/stirling.rs');

    expect(builder).toContain("$RuntimeDir = Join-Path $PackDir 'runtime'");
    expect(builder).toContain("$DistributionRoot = $Qpdf.Directory.Parent.FullName");
    expect(native).toContain('../provider-packs/qpdf/runtime/bin/qpdf.exe');
    expect(native).toContain('provider-packs/qpdf/runtime/bin/qpdf.exe');
  });

  it('keeps generated Tesseract layout, model pins and native packaged lookup aligned',()=>{
    const builder=text('scripts/build-tesseract-windows.ps1');
    const native=text('src-tauri/src/suite/stirling.rs');

    expect(builder).toContain("$RuntimeBin = Join-Path $RuntimeDir 'bin'");
    expect(builder).toContain("$TessdataDir = Join-Path $RuntimeDir 'tessdata'");
    expect(builder).toContain("65727574dfcd264acbb0c3e07860e4e9e9b22185");
    expect(builder).toContain("bbef4675053b5b468cdb477053e28b1c698ba08e");
    expect(builder).toContain("527457ca8f8fe1fda7c2f88bce3c0e4be12be9d0");
    expect(native).toContain('../provider-packs/tesseract/runtime/bin/tesseract.exe');
    expect(native).toContain('provider-packs/tesseract/runtime/bin/tesseract.exe');
    expect(native).toContain('TESSDATA_PREFIX');
  });

  it('pins the MALENJO Stirling Java-effects patch in both provider builders',()=>{
    const windows=text('scripts/build-stirling-core.ps1');
    const linux=text('scripts/build-stirling-core.sh');
    const patch=text('third_party/stirling-pdf/patches/0001-malenjo-java-effect-alternatives.patch');

    expect(windows).toContain('0001-malenjo-java-effect-alternatives.patch');
    expect(windows).toContain('git apply --check');
    expect(linux).toContain('0001-malenjo-java-effect-alternatives.patch');
    expect(linux).toContain('git apply --check');
    expect(patch).toContain('addEndpointAlternative("replace-invert-pdf", "Java")');
    expect(patch).toContain('addEndpointAlternative("scanner-effect", "Java")');
  });

  it('retains qpdf transitive notices in the generated component pack',()=>{
    const builder=text('scripts/build-qpdf-windows.ps1');
    for(const notice of [
      'qpdf-LICENSE.txt',
      'qpdf-NOTICE.md',
      'libjpeg-turbo-LICENSE.md',
      'libjpeg-turbo-README.ijg',
      'openssl-LICENSE.txt',
      'zlib-LICENSE.txt',
    ]){
      expect(builder).toContain(notice);
    }
    expect(builder).toContain('integration-approved-release-gated');
  });
});
