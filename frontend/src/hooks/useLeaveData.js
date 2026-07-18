import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

// `enabled` gates the initial fetch — pass `!!user` from a component that
// mounts before authentication resolves (e.g. a top-level App calling this
// once and sharing it via props), so the very first fetch attempt doesn't
// fire against a session that doesn't exist yet. Defaults to true so every
// existing call site (a component that only ever mounts post-login) is
// unaffected.
export function useLeaveData(enabled = true) {
    const [employees, setEmployees] = useState([]);
    const [years, setYears] = useState([]);
    const [settings, setSettings] = useState({ openingBalanceDate: '' });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [empData, settingsData] = await Promise.all([api.getEmployees(), api.getSettings()]);
            setEmployees(empData.employees);
            setYears(empData.years);
            setSettings(settingsData.settings);
        } catch (err) {
            setError(err.message || 'تعذر تحميل بيانات الموظفين');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!enabled) return;
        refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refresh, enabled]);

    async function addEmployee(payload) {
        const data = await api.addEmployee(payload);
        setEmployees((prev) => [...prev, data.employee]);
        return data.employee;
    }

    async function updateEmployee(id, payload) {
        const data = await api.updateEmployee(id, payload);
        // Optimistic merge: swap in the fresh row (including is_unpaid_leave)
        // immediately, so the table/print components re-render with the
        // correct zeros on this same tick — no reload needed.
        setEmployees((prev) => prev.map((e) => (e.id === id ? data.employee : e)));
        // Cache invalidation safety net: re-fetch the full roster in the
        // background afterward, so the entire cache is guaranteed to match
        // the database exactly, not just the one row merged above. Fired
        // without awaiting so it never delays the instant UI update or the
        // modal closing; a background failure here is non-fatal (the
        // optimistic merge above already reflects the save).
        refresh().catch(() => {});
        return data.employee;
    }

    async function deleteEmployee(id) {
        await api.deleteEmployee(id);
        setEmployees((prev) => prev.filter((e) => e.id !== id));
    }

    // Trash bin: archived employees/years are never destroyed, so they can
    // always be brought back. These are separate reads (not part of the
    // normal `employees`/`years` state) since the trash view is opened
    // rarely, from Settings, not on every page load.
    async function getArchivedEmployees() {
        const data = await api.getArchivedEmployees();
        return data.employees;
    }

    async function restoreEmployee(id) {
        const data = await api.restoreEmployee(id);
        await refresh();
        return data.employee;
    }

    async function getArchivedYears() {
        const data = await api.getArchivedYears();
        return data.years;
    }

    async function restoreYear(year) {
        const data = await api.restoreYear(year);
        setYears(data.years);
        await refresh();
        return data.years;
    }

    async function toggleFreeze(id, includeInPrint) {
        const data = await api.toggleFreeze(id, includeInPrint);
        setEmployees((prev) => prev.map((e) => (e.id === id ? data.employee : e)));
        refresh().catch(() => {});
        return data.employee;
    }

    async function bulkAddEmployees(rows) {
        const data = await api.bulkAddEmployees(rows);
        await refresh();
        return data;
    }

    async function addYear(payload) {
        const data = await api.addYear(payload);
        setYears(data.years);
        await refresh();
        return data.years;
    }

    async function deleteYear(year) {
        const data = await api.deleteYear(year);
        setYears(data.years);
        await refresh();
        return data.years;
    }

    async function updateSettings(payload) {
        const data = await api.updateSettings(payload);
        setSettings(data.settings);
        return data.settings;
    }

    async function addDeduction(employeeId, payload) {
        const data = await api.addDeduction(employeeId, payload);
        setEmployees((prev) => prev.map((e) => (e.id === employeeId ? data.employee : e)));
        return data.employee;
    }

    async function deleteDeduction(employeeId, deductionId) {
        const data = await api.deleteDeduction(deductionId);
        setEmployees((prev) => prev.map((e) => (e.id === employeeId ? data.employee : e)));
        return data.employee;
    }

    async function exportBackup() {
        return api.exportBackup();
    }

    async function serverBackup() {
        return api.serverBackup();
    }

    async function importBackup(payload) {
        const data = await api.importBackup(payload);
        await refresh();
        return data;
    }

    async function deleteAllRecords() {
        const data = await api.deleteAllRecords();
        await refresh();
        return data;
    }

    return {
        employees,
        years,
        settings,
        loading,
        error,
        refresh,
        addEmployee,
        updateEmployee,
        deleteEmployee,
        getArchivedEmployees,
        restoreEmployee,
        toggleFreeze,
        bulkAddEmployees,
        addYear,
        deleteYear,
        getArchivedYears,
        restoreYear,
        updateSettings,
        addDeduction,
        deleteDeduction,
        exportBackup,
        serverBackup,
        importBackup,
        deleteAllRecords,
    };
}
