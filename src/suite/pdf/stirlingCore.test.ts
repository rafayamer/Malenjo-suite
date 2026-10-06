import { describe, expect, it } from 'vitest';
import {
  STIRLING_FRONTEND_TOOLS,
  STIRLING_OPEN_CORE_PIN,
  parseStirlingOpenApi,
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

  it('recognizes PDF output by content type or signature',()=>{
    expect(responseIsPdf({status:200,contentType:'application/pdf',bytes:[]})).toBe(true);
    expect(responseIsPdf({status:200,contentType:'application/octet-stream',bytes:[37,80,68,70,45]})).toBe(true);
    expect(responseIsPdf({status:200,contentType:'application/zip',bytes:[80,75,3,4]})).toBe(false);
  });
});
