import type {PdfProviderStatus,PdfToolProvider} from './backend';

type Starter=Pick<PdfToolProvider,'status'|'start'>;

// A PDF may have several mounted tabs or provider panels. Avoid parallel
// start attempts racing to spawn multiple sidecars on the same loopback port.
const pendingStarts=new WeakMap<Starter,Promise<PdfProviderStatus>>();

/** Starts an installed local provider at most once per concurrent request.
 * Failures are returned to the caller and never block the PDF renderer.
 * A failed attempt is not cached, so a later explicit retry is possible.
 */
export function ensurePdfProviderRunning(provider:Starter):Promise<PdfProviderStatus>{
  const existing=pendingStarts.get(provider);
  if(existing)return existing;

  const attempt=(async()=>{
    const status=await provider.status();
    if(status.running)return status;
    if(!status.installed){
      throw new Error(status.message||'The offline PDF processing engine is not installed.');
    }
    const started=await provider.start();
    if(!started.running){
      throw new Error(started.message||'The local PDF processing engine could not start.');
    }
    return started;
  })();

  pendingStarts.set(provider,attempt);
  void attempt.then(
    ()=>{if(pendingStarts.get(provider)===attempt)pendingStarts.delete(provider);},
    ()=>{if(pendingStarts.get(provider)===attempt)pendingStarts.delete(provider);},
  );
  return attempt;
}
