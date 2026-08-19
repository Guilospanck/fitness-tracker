// JSON export/import helpers for the Settings screen.
import { exportData, importData } from './db.js';

export async function downloadBackup() {
  const data = await exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fitness-tracker-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function pickAndImport() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(false);
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        await importData(payload);
        resolve(true);
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  });
}
