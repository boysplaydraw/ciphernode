/**
 * webtorrent-bridge.ts — Electron WebTorrent IPC Köprüsü
 *
 * Sadece Electron'da çalışır. Diğer platformlarda tüm fonksiyonlar
 * hata fırlatır veya null döner.
 *
 * Kullanım:
 *   const { magnetURI } = await seedTorrent({ dataBase64, fileName, mimeType });
 *   // Magnet URI'yi karşı tarafa gönderin (socket mesajı vb.)
 *
 *   const file = await downloadTorrent({ magnetURI });
 *   // file.dataBase64 → deşifre edilip kaydedilebilir
 */

import { isElectron } from "./electron-bridge";

export interface TorrentSeedResult {
  magnetURI: string;
  infoHash: string;
}

export interface TorrentDownloadResult {
  fileName: string;
  dataBase64: string;
  mimeType: string;
}

export interface TorrentProgress {
  progress: number;       // 0–1
  downloadSpeed: number;  // bytes/s
  uploadSpeed: number;    // bytes/s
  numPeers: number;
  done: boolean;
}

/** Dosyayı torrent olarak seed et — magnet URI döner (Electron only) */
export async function seedTorrent(params: {
  dataBase64: string;
  fileName: string;
  mimeType: string;
}): Promise<TorrentSeedResult> {
  if (!isElectron()) {
    throw new Error("WebTorrent yalnızca Electron masaüstü uygulamasında desteklenmektedir.");
  }
  return (window as any).electronAPI.webtorrent.seed(params);
}

/** Magnet URI ile dosyayı indir ve base64 döner (Electron only) */
export async function downloadTorrent(params: {
  magnetURI: string;
}): Promise<TorrentDownloadResult> {
  if (!isElectron()) {
    throw new Error("WebTorrent yalnızca Electron masaüstü uygulamasında desteklenmektedir.");
  }
  return (window as any).electronAPI.webtorrent.download(params);
}

/** Torrent ilerleme durumunu sorgula */
export async function getTorrentProgress(
  infoHash: string,
): Promise<TorrentProgress | null> {
  if (!isElectron()) return null;
  return (window as any).electronAPI.webtorrent.progress(infoHash);
}

/** Torrent'i durdur ve kaldır */
export async function removeTorrent(infoHash: string): Promise<void> {
  if (!isElectron()) return;
  await (window as any).electronAPI.webtorrent.remove(infoHash);
}

/** Platform WebTorrent destekliyor mu? */
export function isWebTorrentAvailable(): boolean {
  return isElectron();
}
