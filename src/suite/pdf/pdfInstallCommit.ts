/**
 * Finish the PDF/document-history state transition synchronously. In particular,
 * never await destruction of an old PDF.js worker between installing bytes and
 * committing the corresponding undo/redo entry. The former load can complete
 * later or fail without leaving an installed edit with no history.
 */
export function finishPdfInstallCommit(
  onCommitted: (()=>void)|undefined,
  disposePrevious: ()=>Promise<void>,
):void{
  onCommitted?.();
  try{
    void disposePrevious().catch(()=>{
      // The installed PDF and its history are already committed.
    });
  }catch{
    // A synchronous worker teardown failure is also non-fatal.
  }
}
