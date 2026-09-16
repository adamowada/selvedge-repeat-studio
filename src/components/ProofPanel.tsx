import { useEffect, useRef, useState } from 'react';
import type { ExportResult } from '../core/export';
import { drawProof } from '../core/proof';
import { proofStatus } from '../ui/presentation';
import { Icon } from './Icon';

interface DecodeState { blob: Blob; decoded: boolean; error: string | null }
export function ProofPanel({ result, fingerprint }: { result: ExportResult | null; fingerprint: string }) {
  const proof = useRef<HTMLCanvasElement>(null);
  const [decode, setDecode] = useState<DecodeState | null>(null);
  // Key the visible state to the exact Blob. A new export must never display
  // the previous canvas or its success badge while the new decode is pending.
  const current = result && decode?.blob === result.blob ? decode : null;
  const decoded = !!current?.decoded;
  const error = current?.error;
  const stale = !!result && result.fingerprint !== fingerprint;
  const status = proofStatus(result?.fingerprint ?? null, fingerprint, decoded, !!error);
  useEffect(() => {
    const controller = new AbortController();
    if (result && proof.current) {
      setDecode({ blob: result.blob, decoded: false, error: null });
      drawProof(result.blob, proof.current, controller.signal).then(() => {
        if (!controller.signal.aborted) setDecode({ blob: result.blob, decoded: true, error: null });
      }).catch(error => {
        if (!controller.signal.aborted) setDecode({ blob: result.blob, decoded: false, error: error instanceof Error ? error.message : 'Proof failed.' });
      });
    }
    return () => controller.abort();
  }, [result]);
  const statusText = {
    empty: 'Export to verify the downloaded PNG.',
    decoding: 'Decoding exported PNG…',
    verified: 'Decoded PNG · dimensions verified',
    stale: 'Previous export · edits not included',
    failed: 'PNG verification failed',
  }[status];
  return <section className="proof-section" aria-labelledby="proof-heading">
    <div className="section-heading"><h2 id="proof-heading">PNG verification</h2>
      {status === 'verified' && <Icon name="check" size={16} />}</div>
    {stale && <span className="proof-badge" data-testid="proof-stale">Out of date</span>}
    <div className={`proof-container checker ${!decoded ? 'no-proof' : ''}`} aria-busy={!!result && !decoded && !error}>
      <canvas ref={proof} aria-label="Tiled proof from decoded exported PNG" data-testid="export-proof" hidden={!decoded} />
      {!decoded && <p>{result ? error ? 'Proof unavailable' : 'Decoding PNG…' : 'No exported PNG yet'}</p>}
    </div>
    <p className={`proof-status ${stale ? 'stale' : ''}`} data-testid="proof-status" role="status">{statusText}</p>
    {result ? <p className="small-note">{result.width} × {result.height} px · tiled from the download</p>
      : <p className="small-note">The downloaded PNG is decoded and tiled here, not the live scene.</p>}
    {error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}
