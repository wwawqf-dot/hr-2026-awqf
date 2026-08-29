import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';

const LEVEL = { admin: 3, data_entry: 2, viewer: 1 };
const gte = (role, min) => (LEVEL[role] || 0) >= (LEVEL[min] || 0);

export function usePermissions() {
    const { user } = useAuth();
    const role = user?.role || 'viewer';

    return useMemo(() => ({
        role,
        isAdmin: role === 'admin',
        isDataEntry: role === 'data_entry',
        isViewer: role === 'viewer',
        canAdd: gte(role, 'data_entry'),
        // Excel export hands over the entire register in one file — every
        // employee, every national ID, every balance — in a form that
        // leaves the system and can be forwarded anywhere. A متابع is
        // there to look, so the button is not theirs. Reading on screen
        // and the individual printed statement stay available to them.
        canExport: gte(role, 'data_entry'),
        canDeduct: gte(role, 'data_entry'),
        canDelete: gte(role, 'admin'),
        canFreeze: gte(role, 'admin'),
        canEdit: gte(role, 'admin'),
    }), [role]);
}
