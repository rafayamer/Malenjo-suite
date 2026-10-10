import { describe, expect, it } from 'vitest';
import {
  STIRLING_FRONTEND_TOOLS,
  STIRLING_OPEN_CORE_PIN,
  parseStirlingOpenApi,
  proposedPdfToolFilename,
  responseIsPdf,
} from './stirlingCore';

describe('Stirling open-core PDF integration contract',()=>{
  it('pins the reviewed upstream commit and complete open-core frontend tool inventory',()=>{
    expect(STIRLING_OPEN_CORE_PIN).toBe('25220cbdbde2d526cebf173b94357884e180b8c1');
    expect(STIRLING_FRONTEND_TOOLS.map((tool)=>tool.id)).toEqual([
      'AddAttachments','AddImage','AddPageNumbers','AddPassword','AddStamp','AddText',
      'AddWatermark','AdjustContrast','AdjustPageScale','Annotate','AutoRename','AutoRotate',
      'Automate','BookletImposition','CertSign','ChangeMetadata','ChangePermissions','Compare',
      'Compress','Convert','CreatePortfolio','Crop','EditTableOfContents','ExtractImages',
      'ExtractPages','Flatten','GetPdfInfo','Merge','OCR','OverlayPdfs','PageLayout','Redact',
      'RemoveAnnotations','RemoveBlanks','RemoveCertificateSign','RemoveImage','RemovePages',
      'RemovePassword','ReorganizePages','Repair','ReplaceColor','Rotate','Sanitize',
      'ScannerImageSplit','ShowJS','Sign','SingleLargePage','Split','SwaggerUI','TimestampPdf',
      'UnlockPdfForms','ValidateSignature','annotate','autoFormDetection','formFill',
      'pdfTextEditor','stamp',
    ]);
    expect(STIRLING_FRONTEND_TOOLS).toHaveLength(57);
  });

  it('parses local v1 OpenAPI operations, multipart files and query fields',()=>{
    const api={
      components:{
        schemas:{
          MergeRequest:{
            type:'object',
            required:['fileInput'],
            properties:{
              fileInput:{type:'array',items:{type:'string',format:'binary'}},
              sortType:{type:'string',enum:['orderProvided','byFileName'],default:'orderProvided'},
            },
          },
        },
      },
      paths:{
        '/api/v1/general/merge-pdfs':{
          post:{
            operationId:'mergePdfs',
            summary:'Merge PDFs',
            tags:['General'],
            requestBody:{
              required:true,
              content:{'multipart/form-data':{schema:{$ref:'#/components/schemas/MergeRequest'}}},
            },
          },
        },
        '/api/v1/info/health':{
          get:{
            operationId:'health',
            summary:'Health',
            parameters:[{name:'verbose',in:'query',schema:{type:'boolean'}}],
          },
        },
        '/admin/not-allowed':{get:{operationId:'admin'}},
      },
    };

    const operations=parseStirlingOpenApi(api);
    expect(operations.map((operation)=>operation.id)).toEqual(['health','mergePdfs']);
    const merge=operations.find((operation)=>operation.id==='mergePdfs')!;
    expect(merge.category).toBe('organize');
    expect(merge.fields).toEqual([
      expect.objectContaining({name:'fileInput',kind:'files',required:true,location:'form'}),
      expect.objectContaining({name:'sortType',kind:'string',enumValues:['orderProvided','byFileName'],defaultValue:'orderProvided'}),
    ]);
    const health=operations.find((operation)=>operation.id==='health')!;
    expect(health.fields[0]).toEqual(expect.objectContaining({name:'verbose',kind:'boolean',location:'query'}));
  });


  it('resolves component parameter and requestBody references instead of dropping provider fields',()=>{
    const api={
      components:{
        parameters:{
          Quality:{name:'quality',in:'query',required:false,schema:{type:'integer',default:80}},
        },
        requestBodies:{
          Upload:{required:true,content:{'multipart/form-data':{schema:{
            type:'object',required:['fileInput'],properties:{fileInput:{type:'string',format:'binary'}},
          }}}},
        },
      },
      paths:{
        '/api/v1/convert/example':{
          post:{
            operationId:'convertExample',
            parameters:[{$ref:'#/components/parameters/Quality'}],
            requestBody:{$ref:'#/components/requestBodies/Upload'},
          },
        },
      },
    };
    const operation=parseStirlingOpenApi(api)[0];
    expect(operation.fields).toEqual([
      expect.objectContaining({name:'quality',kind:'integer',location:'query',defaultValue:80}),
      expect.objectContaining({name:'fileInput',kind:'file',required:true,location:'form'}),
    ]);
  });

  it('requires a real PDF output header rather than trusting provider MIME',()=>{
    expect(responseIsPdf({status:200,contentType:'application/pdf',bytes:[]})).toBe(false);
    expect(responseIsPdf({status:200,contentType:'application/pdf',bytes:[60,104,116,109,108,62]})).toBe(false);
    expect(responseIsPdf({status:500,contentType:'application/pdf',bytes:[37,80,68,70,45]})).toBe(false);
    expect(responseIsPdf({status:200,contentType:'application/octet-stream',bytes:[37,80,68,70,45]})).toBe(true);
    expect(responseIsPdf({status:200,contentType:'application/octet-stream',bytes:[32,10,37,80,68,70,45]})).toBe(true);
    expect(responseIsPdf({status:200,contentType:'application/pdf',bytes:[239,187,191,37,80,68,70,45]})).toBe(true);
    expect(responseIsPdf({status:200,contentType:'text/plain',bytes:[116,101,120,116,32,37,80,68,70,45]})).toBe(false);
    expect(responseIsPdf({status:200,contentType:'application/zip',bytes:[80,75,3,4]})).toBe(false);
  });

  it('proposes safe output types for offline conversion results',()=>{
    expect(proposedPdfToolFilename({status:200,contentType:'application/epub+zip',bytes:[80,75,3,4]},'book')).toBe('book.epub');
    expect(proposedPdfToolFilename({status:200,contentType:'application/x-cbz',bytes:[80,75,3,4]},'comic')).toBe('comic.cbz');
    expect(proposedPdfToolFilename({status:200,contentType:'application/x-cbr',bytes:[82,97,114,33]},'comic')).toBe('comic.cbr');
    expect(proposedPdfToolFilename({status:200,contentType:'image/svg+xml',bytes:[60,115,118,103,62]},'diagram')).toBe('diagram.svg');
    expect(proposedPdfToolFilename({status:200,contentType:'application/xml; charset=utf-8',bytes:[60,63,120,109,108]},'structured')).toBe('structured.xml');
    expect(proposedPdfToolFilename({status:200,contentType:'application/pdf',contentDisposition:'attachment; filename="evil.exe"',bytes:[37,80,68,70,45]},'result')).toBe('result.pdf');
    expect(proposedPdfToolFilename({status:200,contentType:'application/pdf',contentDisposition:'attachment; filename="../safe.pdf"',bytes:[37,80,68,70,45]},'result')).toBe('safe.pdf');
  });
});
