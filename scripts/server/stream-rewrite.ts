import { Transform, type TransformCallback } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import { STREAM_OVERLAP } from '../shared/constants';

export class HostStripStream extends Transform {
  private readonly decoder = new StringDecoder('utf-8');
  private overflow = '';
  private readonly absRe: RegExp;
  private readonly protoRelRe: RegExp;

  constructor(targetHost: string) {
    super();
    const escaped = targetHost.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    this.absRe = new RegExp(`https?://${escaped}`, 'gi');
    this.protoRelRe = new RegExp(`//${escaped}`, 'gi');
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    const text = this.overflow + this.decoder.write(chunk);
    if (text.length <= STREAM_OVERLAP) {
      this.overflow = text;
      cb();
      return;
    }
    const splitAt = text.length - STREAM_OVERLAP;
    const safe = text.slice(0, splitAt);
    this.overflow = text.slice(splitAt);
    this.push(Buffer.from(this.rewrite(safe), 'utf-8'));
    cb();
  }

  override _flush(cb: TransformCallback): void {
    const tail = this.overflow + this.decoder.end();
    this.overflow = '';
    if (tail) this.push(Buffer.from(this.rewrite(tail), 'utf-8'));
    cb();
  }

  private rewrite(s: string): string {
    return s.replace(this.absRe, '').replace(this.protoRelRe, '');
  }
}
