import * as path from 'node:path';

export const LOADERIO_TOKEN = 'loaderio-213257cff0bbdbf549a9fff9d55a3d2b';
export const LOADERIO_FILE = path.join(process.cwd(), `${LOADERIO_TOKEN}.txt`);

export const IP_PROBE = 'https://api.ipify.org?format=json';

export const SERVER_IP_CACHE_MS = 60 * 60 * 1000;
