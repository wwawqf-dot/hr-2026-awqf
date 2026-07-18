import { useMemo, useState } from 'react';
import { usePermissions } from '../hooks/usePermissions';
import PageHeader from './PageHeader';
import SearchBar from './SearchBar';
import EmployeesTable from './EmployeesTable';
import ExpiringLeavesWidget from './ExpiringLeavesWidget';
import { TableSkeleton } from './SkeletonLoader';
import EmployeeFormModal from './modals/EmployeeFormModal';
import DeductionModal from './modals/DeductionModal';
import ReportModal from './modals/ReportModal';
import StatementModal from './modals/StatementModal';
import FreezeModal from './modals/FreezeModal';
import CustomConfirmModal from './modals/CustomConfirmModal';
import { exportEmployeesToExcel } from '../utils/exportExcel';

// `leaveData` is the single useLeaveData() instance owned by App.jsx and
// shared with SettingsPage — see the comment in App.jsx for why this is
// no longer called independently here.
export default function EmployeesPage({ leaveData }) {
    const { canAdd, canFreeze, canEdit } = usePermissions();
    const {
        employees, years, settings, loading, error,
        addEmployee, updateEmployee, deleteEmployee, toggleFreeze,
        addDeduction, deleteDeduction,
    } = leaveData;

    const [search, setSearch] = useState('');
    const [modal, setModal] = useState(null);
    const [confirmEmp, setConfirmEmp] = useState(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const [deleteError, setDeleteError] = useState('');

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return employees;
        return employees.filter(
            (e) => e.name.toLowerCase().includes(q) || (e.national_id || '').toLowerCase().includes(q)
        );
    }, [employees, search]);

    function closeModal() {
        setModal(null);
    }

    function handleDeleteEmployee(emp) {
        setDeleteError('');
        setConfirmEmp(emp);
    }

    async function confirmDeleteEmployee() {
        setDeleteBusy(true);
        try {
            await deleteEmployee(confirmEmp.id);
            setConfirmEmp(null);
        } catch (err) {
            setConfirmEmp(null);
            setDeleteError(err.message || 'تعذر حذف الموظف');
        } finally {
            setDeleteBusy(false);
        }
    }

    const activeEmployee = modal?.employee
        ? employees.find((e) => e.id === modal.employee.id) || modal.employee
        : null;

    return (
        <>
            <PageHeader>
                <button className="btn btn-report" onClick={() => setModal({ type: 'report' })}>
                    <i className="fas fa-print"></i> طباعة التقارير
                </button>
                <button className="btn btn-report" onClick={() => setModal({ type: 'statement' })}>
                    كشف حساب فردي <i className="fas fa-file-invoice"></i>
                </button>
                <button className="btn btn-report" onClick={() => exportEmployeesToExcel(employees, years)}>
                    <i className="fas fa-file-excel"></i> تصدير Excel
                </button>
                {canFreeze && (
                    <button className="btn btn-report" onClick={() => setModal({ type: 'freeze' })}>
                        تجميد سجل موظف <i className="fas fa-snowflake"></i>
                    </button>
                )}
                {canAdd && (
                    <button className="btn btn-primary" onClick={() => setModal({ type: 'addEmployee' })}>
                        <i className="fas fa-user-plus"></i> إضافة موظف
                    </button>
                )}
            </PageHeader>

            <ExpiringLeavesWidget />

            <SearchBar value={search} onChange={setSearch} />

            {error && <div className="form-error">{error}</div>}
            {deleteError && <div className="form-error">{deleteError}</div>}

            {loading ? (
                <div className="table-container" style={{ padding: 0, overflow: 'hidden' }}>
                    <TableSkeleton rows={7} cols={7} />
                </div>
            ) : (
                <EmployeesTable
                    employees={filtered}
                    years={years}
                    onDeduct={(emp) => setModal({ type: 'deduction', employee: emp })}
                    onEdit={(emp) => setModal({ type: 'editEmployee', employee: emp })}
                    onDelete={handleDeleteEmployee}
                />
            )}

            {modal?.type === 'addEmployee' && (
                <EmployeeFormModal
                    mode="add"
                    years={years}
                    openingBalanceDate={settings.openingBalanceDate}
                    onClose={closeModal}
                    onSubmit={addEmployee}
                />
            )}
            {modal?.type === 'editEmployee' && canEdit && activeEmployee && (
                <EmployeeFormModal
                    mode="edit"
                    employee={activeEmployee}
                    years={years}
                    openingBalanceDate={settings.openingBalanceDate}
                    onClose={closeModal}
                    onSubmit={(payload) => updateEmployee(activeEmployee.id, payload)}
                />
            )}
            {modal?.type === 'deduction' && activeEmployee && (
                <DeductionModal
                    employee={activeEmployee}
                    systemYears={years}
                    onClose={closeModal}
                    onSubmit={addDeduction}
                    onDeleteDeduction={deleteDeduction}
                />
            )}
            {modal?.type === 'report' && (
                <ReportModal
                    years={years}
                    employees={employees}
                    openingBalanceDate={settings.openingBalanceDate}
                    onClose={closeModal}
                />
            )}
            {modal?.type === 'statement' && (
                <StatementModal employees={employees} onClose={closeModal} />
            )}
            {modal?.type === 'freeze' && canFreeze && (
                <FreezeModal employees={employees} onToggleFreeze={toggleFreeze} onClose={closeModal} />
            )}
            {confirmEmp && (
                <CustomConfirmModal
                    title="حذف بيانات الموظف"
                    message={`هل أنت متأكد من حذف الموظف: ${confirmEmp.name}؟\nسيختفي الموظف فوراً من كل الشاشات والتقارير، لكن أرصدته وسجل خصوماته تبقى محفوظة بأمان ويمكن استعادته لاحقاً من "أرشيف الموظفين" في أساسيات النظام.`}
                    confirmLabel="نعم، احذف الموظف"
                    cancelLabel="إلغاء"
                    busy={deleteBusy}
                    onConfirm={confirmDeleteEmployee}
                    onCancel={() => setConfirmEmp(null)}
                />
            )}
        </>
    );
}
