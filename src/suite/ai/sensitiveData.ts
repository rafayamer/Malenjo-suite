export type AiTransport='local-loopback'|'remote';
export type SensitiveKind='email'|'phone-like'|'payment-card-like'|'national-id-like'|'access-token-like';

export interface SensitiveFinding{
  kind:SensitiveKind;
  start:number;
  end:number;
}

export interface AiSensitiveAssessment{
  findings:SensitiveFinding[];
  action:'allow'|'warn'|'block';
  reason:string;
}

function patterns():Array<{kind:SensitiveKind;regex:RegExp}>{
  return [
    {kind:'email',regex:/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi},
    {kind:'national-id-like',regex:/\b\d{5}-\d{7}-\d\b/g},
    {kind:'payment-card-like',regex:/\b(?:\d[ -]*?){13,19}\b/g},
    {kind:'access-token-like',regex:/\b(?:sk|api|token|bearer)[-_ ]?[A-Za-z0-9._-]{12,}\b/gi},
    {kind:'phone-like',regex:/(?<!\d)\+?\d[\d ()-]{7,}\d(?!\d)/g},
  ];
}

export function findSensitiveData(text:string):SensitiveFinding[]{
  const findings:SensitiveFinding[]=[];
  for(const {kind,regex} of patterns()){
    for(const match of text.matchAll(regex)){
      const start=match.index??0;
      findings.push({kind,start,end:start+match[0].length});
    }
  }
  return findings
    .sort((a,b)=>a.start-b.start||b.end-a.end)
    .filter((item,index,all)=>index===0||item.start>=all[index-1]!.end);
}

export function assessAiSensitiveData(text:string,transport:AiTransport):AiSensitiveAssessment{
  const findings=findSensitiveData(text);
  if(!findings.length)return {findings,action:'allow',reason:'No sensitive-data pattern was detected.'};
  if(transport==='remote'){
    return {findings,action:'block',reason:'Sensitive-data patterns are blocked from remote AI transport.'};
  }
  return {
    findings,
    action:'warn',
    reason:'Sensitive-data patterns were detected. Local loopback inference is allowed, but the user should review the content before sending it to the local model.',
  };
}

export function redactSensitiveData(text:string):string{
  const findings=findSensitiveData(text);
  let output=text;
  for(const finding of [...findings].reverse()){
    output=`${output.slice(0,finding.start)}[REDACTED:${finding.kind}]${output.slice(finding.end)}`;
  }
  return output;
}
