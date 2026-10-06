import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function text(path:string):string{
  return readFileSync(path,'utf8');
}

describe('Windows PDF provider packaging contract',()=>{
  it('maps Stirling and qpdf to stable Tauri resource destinations',()=>{
    const config=JSON.parse(text('src-tauri/tauri.conf.json')) as {
      bundle:{resources:Record<string,string>};
    };
    expect(config.bundle.resources['../provider-packs/stirling-core/']).toBe('provider-packs/stirling-core/');
    expect(config.bundle.resources['../provider-packs/qpdf/']).toBe('provider-packs/qpdf/');
  });

  it('keeps generated qpdf layout and native packaged lookup aligned',()=>{
    const builder=text('scripts/build-qpdf-windows.ps1');
    const native=text('src-tauri/src/suite/stirling.rs');

    expect(builder).toContain("$RuntimeDir = Join-Path $PackDir 'runtime'");
    expect(builder).toContain("$DistributionRoot = $Qpdf.Directory.Parent.FullName");
    expect(native).toContain('../provider-packs/qpdf/runtime/bin/qpdf.exe');
    expect(native).toContain('provider-packs/qpdf/runtime/bin/qpdf.exe');
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
