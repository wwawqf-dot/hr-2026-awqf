import { api } from '../api/client';
import { getLibyaDateStr, getLibyaTime } from './libyaTime.js';

// One implementation of "write the backup to a file", shared by the manual
// button in Settings and the automatic download that fires on an admin's
// login. Two copies of this would drift, and a backup that silently writes
// a different shape depending on which path produced it is worse than no
// backup at all.
//
// A Blob URL rather than the `data:` URI this replaced: the export carries
// every employee, every year row and the whole deduction register, and a
// data: URI long enough to hold that is refused outright by some browsers.
// The failure mode there is a download that simply never appears.
export async function downloadBackupFile({ auto = false } = {}) {
    const data = await api.exportBackup();
    const date = getLibyaDateStr();

    // The automatic file carries a clock stamp as well as a date: an admin
    // may sign in several times a day, and without it every file after the
    // first arrives as "…(1).json", "…(2).json" with nothing on the name
    // to say which is which.
    let name;
    if (auto) {
        const t = getLibyaTime();
        const hhmm = `${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}`;
        name = `نسخة_تلقائية_عند_الدخول_${date}_${hhmm}.json`;
    } else {
        name = `نسخة_تصدير_منظومة_الإجازات_${date}.json`;
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return data;
}
