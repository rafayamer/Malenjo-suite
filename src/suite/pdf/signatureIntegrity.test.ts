import {describe,expect,it} from 'vitest';
import {PDFDocument,PDFHexString,PDFName,PDFRef,PDFString} from 'pdf-lib';
import {
  inspectPdfSigningIntegrity,requirePdfUnsignedForMutation,
} from './signatureIntegrity';

async function fixture({field=false,populated=false,certified=false}:{
  field?:boolean;populated?:boolean;certified?:boolean;
}={}):Promise<Uint8Array>{
  const pdf=await PDFDocument.create();
  pdf.addPage([300,400]);
  let signatureRef:PDFRef|undefined;
  if(field||certified){
    const dict=pdf.context.obj({
      Type:PDFName.of('Sig'),
      Filter:PDFName.of('Adobe.PPKLite'),
      SubFilter:PDFName.of('adbe.pkcs7.detached'),
      ByteRange:[0,100,200,300],
      Contents:PDFHexString.of('A0B0C0D0'),
    });
    signatureRef=pdf.context.register(dict);
  }
  if(field){
    const fieldDict=pdf.context.obj({
      FT:PDFName.of('Sig'),T:PDFString.of('Approver'),
    });
    if(populated&&signatureRef)fieldDict.set(PDFName.of('V'),signatureRef);
    const ref=pdf.context.register(fieldDict);
    pdf.catalog.set(PDFName.of('AcroForm'),pdf.context.register(
      pdf.context.obj({Fields:[ref],SigFlags:3}),
    ));
  }
  if(certified&&signatureRef){
    pdf.catalog.set(PDFName.of('Perms'),pdf.context.register(
      pdf.context.obj({DocMDP:signatureRef}),
    ));
  }
  return Uint8Array.from(await pdf.save({useObjectStreams:false}));
}

describe('signed PDF mutation safety',()=>{
  it('allows an ordinary unsigned PDF to use the workspace mutation path',async()=>{
    const original=await fixture();
    expect(await inspectPdfSigningIntegrity(original)).toEqual({
      signatureFieldCount:0,populatedSignatureCount:0,certifiedDocument:false,mayRewrite:true,
    });
    await expect(requirePdfUnsignedForMutation(original)).resolves.toBeUndefined();
  });

  it('does not mistake an empty signature widget for a populated signature',async()=>{
    const unsignedField=await fixture({field:true,populated:false});
    expect(await inspectPdfSigningIntegrity(unsignedField)).toMatchObject({
      signatureFieldCount:1,populatedSignatureCount:0,mayRewrite:true,
    });
    await expect(requirePdfUnsignedForMutation(unsignedField)).resolves.toBeUndefined();
  });

  it('refuses to reserialize a populated digital signature field',async()=>{
    const signed=await fixture({field:true,populated:true});
    expect(await inspectPdfSigningIntegrity(signed)).toMatchObject({
      signatureFieldCount:1,populatedSignatureCount:1,mayRewrite:false,
    });
    const original=Uint8Array.from(signed);
    await expect(requirePdfUnsignedForMutation(signed))
      .rejects.toThrow(/invalidate signatures/i);
    expect(signed).toEqual(original);
  });

  it('blocks certified document policies even without an ordinary signature field',async()=>{
    const certified=await fixture({certified:true});
    expect(await inspectPdfSigningIntegrity(certified)).toMatchObject({
      signatureFieldCount:0,certifiedDocument:true,mayRewrite:false,
    });
    await expect(requirePdfUnsignedForMutation(certified))
      .rejects.toThrow(/certification evidence/i);
  });

  it('detects signed fields with indirect /FT and /V but allows indirect null /V',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([300,400]);
    const indirectType=pdf.context.register(PDFName.of('Sig'));
    const emptyValue=pdf.context.register(pdf.context.obj(null));
    const field=pdf.context.obj({
      FT:indirectType,T:PDFString.of('IndirectSig'),V:emptyValue,
    });
    const fieldRef=pdf.context.register(field);
    pdf.catalog.set(PDFName.of('AcroForm'),pdf.context.register(
      pdf.context.obj({Fields:[fieldRef]}),
    ));
    const empty=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    expect(await inspectPdfSigningIntegrity(empty)).toMatchObject({
      signatureFieldCount:1,populatedSignatureCount:0,mayRewrite:true,
    });

    const signature=pdf.context.register(pdf.context.obj({
      Type:PDFName.of('Sig'),Filter:PDFName.of('Adobe.PPKLite'),
      ByteRange:[0,100,200,300],Contents:PDFHexString.of('AA11BB22'),
    }));
    field.set(PDFName.of('V'),signature);
    const signed=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    expect(await inspectPdfSigningIntegrity(signed)).toMatchObject({
      signatureFieldCount:1,populatedSignatureCount:1,mayRewrite:false,
    });
    await expect(requirePdfUnsignedForMutation(signed))
      .rejects.toThrow(/invalidate signatures/i);
  });

  it('fails closed if an AcroForm field tree is missing or malformed',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([300,400]);
    pdf.catalog.set(PDFName.of('AcroForm'),pdf.context.register(
      pdf.context.obj({NeedsAppearances:true}),
    ));
    const source=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    await expect(requirePdfUnsignedForMutation(source))
      .rejects.toThrow(/field tree is malformed/i);
  });

  it('does not stringify a giant imported non-signature field type',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([300,400]);
    const suspicious=pdf.context.register(pdf.context.obj({
      FT:pdf.context.register(PDFName.of('X'.repeat(70_000))),
      T:PDFString.of('Unrecognized field type'),
    }));
    pdf.catalog.set(PDFName.of('AcroForm'),pdf.context.register(
      pdf.context.obj({Fields:[suspicious]}),
    ));
    const source=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    expect(await inspectPdfSigningIntegrity(source)).toMatchObject({
      signatureFieldCount:0,populatedSignatureCount:0,mayRewrite:true,
    });
  });
});
