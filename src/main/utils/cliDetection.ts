import { execFileNoThrow } from './execFile';

let cloudflaredInstalledCache: boolean | null = null;

export async function isCloudflaredInstalled(): Promise<boolean> {
  // Return cached result if available
  if (cloudflaredInstalledCache !== null) {
    return cloudflaredInstalledCache;
  }

  // Use 'which' on macOS/Linux, 'where' on Windows
  const command = process.platform === 'win32' ? 'where' : 'which';
  const result = await execFileNoThrow(command, ['cloudflared']);
  cloudflaredInstalledCache = result.exitCode === 0;

  return cloudflaredInstalledCache;
}

export function clearCloudflaredCache(): void {
  cloudflaredInstalledCache = null;
}
