import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Fetches the "leaves ending soon" feed once on mount. Fails soft: any error
// just yields an empty list so the widget never breaks the dashboard.
export function useExpiringLeaves() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        api.getExpiringLeaves()
            .then((data) => { if (active) setItems(data.expiring || []); })
            .catch(() => { if (active) setItems([]); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    return { items, loading };
}
