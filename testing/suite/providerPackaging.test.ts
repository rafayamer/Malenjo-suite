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
    const licensePatch=text('third_party/stirling-pdf/patches/0002-malenjo-core-license-overrides.patch');
    const attributes=text('.gitattributes');

    expect(windows).toContain('0001-malenjo-java-effect-alternatives.patch');
    expect(windows).toContain('git config core.autocrlf false');
    expect(windows).toContain('git apply --check');
    expect(linux).toContain('git config core.autocrlf false');
    expect(linux).toContain('0001-malenjo-java-effect-alternatives.patch');
    expect(linux).toContain('git apply --check');
    expect(patch).toContain('addEndpointAlternative("replace-invert-pdf", "Java")');
    expect(patch).toContain('addEndpointAlternative("scanner-effect", "Java")');
    expect(windows).toContain('0002-malenjo-core-license-overrides.patch');
    expect(linux).toContain('0002-malenjo-core-license-overrides.patch');
    expect(licensePatch).toContain('com.hubspot.immutables:immutables-exceptions:1.9');
    expect(licensePatch).toContain('com.hubspot:algebra:1.5');
    expect(licensePatch).toContain('+{}');
    expect(attributes).toContain('*.patch text eol=lf');
  });

  it('pins and ships the embedded Stirling Office Convert provider contract',()=>{
    const windows=text('scripts/build-stirling-core.ps1');
    const linux=text('scripts/build-stirling-core.sh');
    const native=text('src-tauri/src/suite/stirling.rs');
    const provenance=text('third_party/stirling-office-convert/PROVENANCE.md');

    for(const source of [windows,linux]){
      expect(source).toContain('0.2.2');
      expect(source).toContain('673aab8d6ac784524cd1d90141c95e74b9fd26ae');
      expect(source).toContain('stirling-office-convert-topdf');
      expect(source).toContain('stirling-office-convert-legacy');
      expect(source).toContain('checkLicense generateLicenseReport --no-parallel');
      expect(source).toContain('stirling-dependency-licenses.json');
      expect(source).toContain('stirling-office-convert-LICENSE.txt');
      expect(source).toContain('pinned-published-sha256');
      expect(source).toContain('ARTIFACTS.sha256');
      expect(source).toContain('licenseArtifacts');
    }
    expect(native).toContain('--system.stirlingOfficeConversion=true');
    expect(provenance).toContain('v0.2.2');
    expect(provenance).toContain('673aab8d6ac784524cd1d90141c95e74b9fd26ae');
    const artifactPins=text('third_party/stirling-office-convert/ARTIFACTS.sha256');
    const licenseReportPin=text('third_party/stirling-office-convert/DEPENDENCY_LICENSE_REPORT.sha256');
    expect(artifactPins).toContain('79e67f69843095cfc557f3cb040bf0c34489ee51f86b815abf0faf5bd8b47a0c  stirling-office-convert-0.2.2.jar');
    expect(artifactPins).toContain('f57b17c14c91318e27c109e462955bc04d64fd3d67c6e79a50073e863425fe37  stirling-office-convert-legacy-0.2.2.jar');
    expect(artifactPins).toContain('210e212dd1345598080ef142c53fbba805cb83dbed150fa0970505bb290df741  stirling-office-convert-topdf-0.2.2.jar');
    expect(licenseReportPin).toContain('05c4ef33b49a9f16d7029c81575938bb9673ddcaea28da91d90fb50b66260cf1  stirling-dependency-licenses.json');
  });

  it('requires native source verification before embedded Office capability is advertised',()=>{
    const native=text('src-tauri/src/suite/stirling.rs');
    const fixture=text('scripts/write-table-pdf-smoke-fixture.ps1');

    expect(native).toContain('stirling-office-convert');
    expect(native).toContain('OFFICE_CONVERT_VERSION');
    expect(native).toContain('OFFICE_CONVERT_SOURCE_COMMIT');
    expect(native).toContain('sha256_file_hex');
    expect(native).toContain('dependencyLicenseReport');
    expect(native).toContain('licenseArtifacts');
    expect(native).toContain('pinned-published-sha256');
    expect(native).toContain('ARTIFACTS.sha256');
    expect(native).toContain('MALENJO_STIRLING_JAR override is not eligible');
    expect(native).toContain('server.servlet.context-path');
    expect(native).toContain('stirling_port_in_use');
    expect(native).toContain('already occupied by a process that MALENJO did not start');
    expect(native).toContain('BOOT-INF/lib/');
    expect(native).toContain('embedded_office_artifacts_match');
    expect(native).toContain('OFFICE_CONVERT_LICENSE_TEXT');
    expect(native).toContain('OFFICE_CONVERT_DEPENDENCIES_TEXT');
    expect(fixture).toContain('%PDF-1.4`n');
    expect(fixture).toContain('(MALENJO) Tj');
  });

  it('keeps WeasyPrint at inventory-only status until transitive Windows licensing closes',()=>{
    const builder=text('scripts/build-weasyprint-windows.ps1');
    const provenance=text('third_party/weasyprint/PROVENANCE.md');

    expect(builder).toContain("$Version = '70.0'");
    expect(builder).toContain('4d3b7b6449e3494f59c7c2f36b512d129225679c');
    expect(builder).toContain('ab1151f210b4e6bb7aa7a79e91a67e8ddb760094c107bfda55241b6aaefe7d53');
    expect(builder).toContain("redistribution = 'inventory-only-not-approved'");
    expect(builder).toContain('capabilityEnabled = $false');
    expect(builder).toContain('WEASYPRINT_INVENTORY_BEGIN');
    expect(builder).toContain('WEASYPRINT_PYTHON_PACKAGES_BEGIN');
    expect(builder).toContain('pythonPackages = $PythonPackages');
    expect(provenance).toContain('HTML→PDF, URL→PDF and EML→PDF remain unavailable');
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
