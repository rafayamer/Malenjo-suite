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

interface SensitivePattern{
  kind:SensitiveKind;
  regex:RegExp;
  accept?:(value:string,start:number,text:string)=>boolean;
}

function digitCount(value:string):number{
  return (value.match(/\d/g)??[]).length;
}

function passesLuhn(value:string):boolean{
  const digits=value.replace(/\D/g,'');
  if(digits.length<13||digits.length>19)return false;
  let sum=0;
  let double=false;
  for(let index=digits.length-1;index>=0;index-=1){
    let digit=Number(digits[index]);
    if(double){
      digit*=2;
      if(digit>9)digit-=9;
    }
    sum+=digit;
    double=!double;
  }
  return sum%10===0;
}

function isPaymentCardCandidate(value:string):boolean{
  return passesLuhn(value);
}

function isPhoneCandidate(value:string,start:number,text:string):boolean{
  const before=start>0?text[start-1]:'';
  const after=text[start+value.length]??'';
  if(/\d/.test(before)||/\d/.test(after))return false;

  const trimmed=value.trim();
  const digits=digitCount(trimmed);
  if(digits<8||digits>15)return false;

  // Avoid treating common date/reference layouts as phone numbers.
  if(/^\d{4}-\d{2}-\d{2}$/.test(trimmed))return false;
  if(/^\d{2}-\d{2}-\d{4}$/.test(trimmed))return false;
  if(/^\d{4}-\d{4}$/.test(trimmed))return false;

  return true;
}

function patterns():SensitivePattern[]{
  return [
    {kind:'email',regex:/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi},
    {kind:'national-id-like',regex:/\b\d{5}-\d{7}-\d\b/g},
    {kind:'payment-card-like',regex:/\b(?:\d[ -]*?){13,19}\b/g,accept:(value)=>isPaymentCardCandidate(value)},
    // RFC 6750 bearer credentials can use ALPHA / DIGIT / "-" / "." / "_" /
    // "~" / "+" / "/" and optional "=" padding. Keep the whole credential
    // inside the finding so redaction cannot leave a valid suffix behind.
    {kind:'access-token-like',regex:/\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*(?![A-Za-z0-9._~+\/=\-])/gi},
    {kind:'access-token-like',regex:/\b(?:api[_-]?key|access[_-]?token|token|secret|sk)\s*[:=]\s*[A-Za-z0-9._~+\/-]{12,}=*(?![A-Za-z0-9._~+\/=\-])/gi},
    {kind:'access-token-like',regex:/\b(?:sk|api|token)[-_ ]?[A-Za-z0-9._~+\/-]{12,}=*(?![A-Za-z0-9._~+\/=\-])/gi},
    // Deliberately avoid lookbehind because the production browser target
    // includes Safari 13. Digit boundaries are checked in isPhoneCandidate().
    {kind:'phone-like',regex:/\+?\d[\d ()-]{6,}\d/g,accept:isPhoneCandidate},
  ];
}

export function findSensitiveData(text:string):SensitiveFinding[]{
  const findings:SensitiveFinding[]=[];
  for(const {kind,regex,accept} of patterns()){
    // Regex instances are created per call, so matchAll state is not shared.
    for(const match of text.matchAll(regex)){
      const start=match.index??0;
      const value=match[0];
      if(accept&&!accept(value,start,text))continue;
      findings.push({kind,start,end:start+value.length});
    }
  }

  const sorted=findings.sort((a,b)=>a.start-b.start||b.end-a.end);
  const retained:SensitiveFinding[]=[];
  for(const finding of sorted){
    const previous=retained.length?retained[retained.length-1]:undefined;
    if(previous&&finding.start<previous.end)continue;
    retained.push(finding);
  }
  return retained;
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
