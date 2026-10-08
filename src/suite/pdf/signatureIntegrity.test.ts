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
  // An empty signature field must not create an unrelated populated signature.
  if((field&&populated)||certified){
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

  it('rejects an orphaned populated signature widget omitted from AcroForm Fields',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([300,400]);
    const signedValue=pdf.context.obj({
      Type:PDFName.of('Sig'),ByteRange:[0,10,20,30],
      Contents:PDFHexString.of('A0B0C0'),
    });
    const orphan=pdf.context.register(pdf.context.obj({
      Type:PDFName.of('Annot'),Subtype:PDFName.of('Widget'),
      FT:PDFName.of('Sig'),Rect:[10,10,40,30],V:signedValue,
    }));
    pdf.getPage(0).node.set(PDFName.of('Annots'),pdf.context.obj([orphan]));
    pdf.catalog.set(PDFName.of('AcroForm'),pdf.context.register(
      pdf.context.obj({Fields:[]}),
    ));
    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    expect(await inspectPdfSigningIntegrity(bytes)).toMatchObject({
      signatureFieldCount:0,populatedSignatureCount:0,mayRewrite:false,
    });
    await expect(requirePdfUnsignedForMutation(bytes))
      .rejects.toThrow(/invalidate signatures/i);
  });

  it('finds orphaned indirect signature dictionaries with ByteRange evidence',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([300,400]);
    pdf.context.register(pdf.context.obj({
      Type:PDFName.of('Sig'),ByteRange:[0,100,200,300],
      Contents:PDFHexString.of('ABCD'),
    }));
    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    expect(await inspectPdfSigningIntegrity(bytes)).toMatchObject({
      signatureFieldCount:0,mayRewrite:false,
    });
  });

  it('inherits a signature value supplied by a non-signature ancestor',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([300,400]);
    const child=pdf.context.register(pdf.context.obj({
      FT:PDFName.of('Sig'),T:PDFString.of('Approval'),
    }));
    const parent=pdf.context.register(pdf.context.obj({
      T:PDFString.of('Parent'),Kids:[child],
      V:pdf.context.obj({
        Type:PDFName.of('Sig'),ByteRange:[0,100,200,300],
        Contents:PDFHexString.of('ABCD'),
      }),
    }));
    pdf.catalog.set(PDFName.of('AcroForm'),pdf.context.register(
      pdf.context.obj({Fields:[parent]}),
    ));
    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    expect(await inspectPdfSigningIntegrity(bytes)).toMatchObject({
      signatureFieldCount:1,populatedSignatureCount:1,mayRewrite:false,
    });
  });

  it('checks a signed secondary document separately from an unsigned merge source',async()=>{
    const unsigned=await fixture();
    const signedSecondary=await fixture({field:true,populated:true});
    await expect(requirePdfUnsignedForMutation(unsigned)).resolves.toBeUndefined();
    await expect(requirePdfUnsignedForMutation(signedSecondary))
      .rejects.toThrow(/invalidate signatures/i);
  });

  it('blocks an orphaned widget inheriting /FT and direct /V from an indirect parent chain',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([300,400]);
    const ancestor=pdf.context.register(pdf.context.obj({
      FT:PDFName.of('Sig'),
      V:pdf.context.obj({
        Type:PDFName.of('Sig'),ByteRange:[0,100,200,300],
        Contents:PDFHexString.of('1234ABCD'),
      }),
    }));
    const middle=pdf.context.register(pdf.context.obj({Parent:ancestor}));
    const widget=pdf.context.register(pdf.context.obj({
      Type:PDFName.of('Annot'),Subtype:PDFName.of('Widget'),
      Rect:[10,10,50,40],Parent:middle,
    }));
    pdf.getPage(0).node.set(PDFName.of('Annots'),pdf.context.obj([widget]));
    pdf.catalog.set(PDFName.of('AcroForm'),pdf.context.register(pdf.context.obj({Fields:[]})));
    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    expect(await inspectPdfSigningIntegrity(bytes)).toMatchObject({
      signatureFieldCount:0,populatedSignatureCount:0,mayRewrite:false,
    });
    await expect(requirePdfUnsignedForMutation(bytes)).rejects.toThrow(/invalidate signatures/i);
  });

  it('does not carry inherited /FT Sig past an explicit /FT Tx override',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([300,400]);
    const child=pdf.context.register(pdf.context.obj({
      FT:PDFName.of('Tx'),T:PDFString.of('FreeText'),
      V:PDFString.of('ordinary unsigned text'),
    }));
    const parent=pdf.context.register(pdf.context.obj({
      FT:PDFName.of('Sig'),T:PDFString.of('AncestorSignature'),Kids:[child],
    }));
    pdf.catalog.set(PDFName.of('AcroForm'),pdf.context.register(
      pdf.context.obj({Fields:[parent]}),
    ));
    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    expect(await inspectPdfSigningIntegrity(bytes)).toMatchObject({
      signatureFieldCount:1,populatedSignatureCount:0,mayRewrite:true,
    });
    await expect(requirePdfUnsignedForMutation(bytes)).resolves.toBeUndefined();
  });

  it('honors a widget /FT Tx override even if its orphan parent has /FT Sig',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([300,400]);
    const parent=pdf.context.register(pdf.context.obj({
      FT:PDFName.of('Sig'),
    }));
    const widget=pdf.context.register(pdf.context.obj({
      Type:PDFName.of('Annot'),Subtype:PDFName.of('Widget'),
      Parent:parent,FT:PDFName.of('Tx'),V:PDFString.of('Unsigned'),
      Rect:[10,10,50,40],
    }));
    pdf.getPage(0).node.set(PDFName.of('Annots'),pdf.context.obj([widget]));
    pdf.catalog.set(PDFName.of('AcroForm'),pdf.context.register(pdf.context.obj({Fields:[]})));
    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    expect(await inspectPdfSigningIntegrity(bytes)).toMatchObject({mayRewrite:true});
  });

  it('fails closed for cyclic orphan widget parent chains',async()=>{
    const pdf=await PDFDocument.create();
    pdf.addPage([300,400]);
    const a=pdf.context.obj({FT:PDFName.of('Tx')});
    const b=pdf.context.obj({});
    const aRef=pdf.context.register(a);
    const bRef=pdf.context.register(b);
    a.set(PDFName.of('Parent'),bRef);
    b.set(PDFName.of('Parent'),aRef);
    const widget=pdf.context.register(pdf.context.obj({
      Type:PDFName.of('Annot'),Subtype:PDFName.of('Widget'),
      Parent:aRef,Rect:[10,10,50,40],
    }));
    pdf.getPage(0).node.set(PDFName.of('Annots'),pdf.context.obj([widget]));
    const bytes=Uint8Array.from(await pdf.save({useObjectStreams:false}));
    await expect(requirePdfUnsignedForMutation(bytes)).rejects.toThrow(/cycle|parent tree/i);
  });
});
