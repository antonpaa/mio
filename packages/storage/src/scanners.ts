import { connect } from 'node:net';
import type { Scanner, ScanResult } from './port.js';

/**
 * The EICAR test string: the industry's agreed harmless "virus". The
 * dev scanner flags it so the rejection path is exercisable without
 * ClamAV; real ClamAV flags it too, by design.
 */
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export function createDevScanner(): Scanner {
  return {
    async scan(bytes): Promise<ScanResult> {
      const text = new TextDecoder('latin1').decode(bytes.slice(0, 4096));
      if (text.includes(EICAR)) {
        return { verdict: 'infected', detail: 'dev-scanner: Eicar-Test-Signature' };
      }
      return { verdict: 'clean', detail: 'dev-scanner: no scan performed' };
    },
  };
}

/**
 * ClamAV over clamd's TCP INSTREAM protocol - forty lines against a
 * documented wire format beats a client dependency (ADR-0009). Chunked:
 * 4-byte big-endian length + data, zero-length terminates; the daemon
 * answers "stream: OK" or "stream: <sig> FOUND".
 */
export function createClamAvScanner(address: string): Scanner {
  const [host, portText] = address.split(':');
  const port = Number(portText ?? 3310);
  return {
    scan(bytes): Promise<ScanResult> {
      return new Promise((resolve, reject) => {
        const socket = connect({ host: host ?? 'localhost', port }, () => {
          socket.write('zINSTREAM\0');
          const CHUNK = 64 * 1024;
          for (let offset = 0; offset < bytes.length; offset += CHUNK) {
            const slice = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length));
            const header = Buffer.alloc(4);
            header.writeUInt32BE(slice.length, 0);
            socket.write(header);
            socket.write(slice);
          }
          const terminator = Buffer.alloc(4);
          socket.write(terminator);
        });
        socket.setTimeout(30_000, () => {
          socket.destroy();
          reject(new Error('clamd timeout'));
        });
        let response = '';
        socket.on('data', (data) => {
          response += data.toString('utf8');
        });
        socket.on('error', reject);
        socket.on('close', () => {
          const text = response.replace(/\0/g, '').trim();
          if (text.endsWith('OK')) {
            resolve({ verdict: 'clean', detail: `clamav: ${text}` });
          } else if (text.endsWith('FOUND')) {
            resolve({ verdict: 'infected', detail: `clamav: ${text}` });
          } else {
            reject(new Error(`clamd unexpected response: ${text}`));
          }
        });
      });
    },
  };
}
