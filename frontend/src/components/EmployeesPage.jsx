import { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLeaveData } from '../hooks/useLeaveData';
import PageHeader from './PageHeader';
import SearchBar from './SearchBar';
import EmployeesTable from './EmployeesTable';
import ExpiringLeavesWidget from './ExpiringLeavesWidget';
import EmployeeFormModal from './modals/EmployeeFormModal';
import DeductionModal from './modals/DeductionModal';
import ReportModal from './modals/ReportModal';
import StatementModal from './modals/StatementModal';
import FreezeModal from './modals/FreezeModal';
import CustomConfirmModal from './modals/CustomConfirmModal';

export default function EmployeesPage() {
    const { isAdmin } = useAuth();
    const {
        employees, years, settings, loading, error,
        addEmployee, updateEmployee, deleteEmployee, toggleFreeze,
        addDeduction, deleteDeduction,
    } = useLeaveData();

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
                {isAdmin && (
                    <button className="btn btn-report" onClick={() => setModal({ type: 'freeze' })}>
                        تجميد سجل موظف <i className="fas fa-snowflake"></i>
                    </button>
                )}
                <button className="btn btn-primary" onClick={() => setModal({ type: 'addEmployee' })}>
                    <i className="fas fa-user-plus"></i> إضافة موظف
                </button>
            </PageHeader>

            <ExpiringLeavesWidget />

            <SearchBar value={search} onChange={setSearch} />

            {error && <div className="form-error">{error}</div>}
            {deleteError && <div className="form-error">{deleteError}</div>}

            {loading ? (
                <div className="table-container">
                    <div className="empty-state">جاري التحميل...</div>
                </div>
            ) : (
                <EmployeesTable
                    employees={filtered}
                    years={years}
                    openingBalanceDate={settings.openingBalanceDate}
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
            {modal?.type === 'editEmployee' && isAdmin && activeEmployee && (
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
            {modal?.type === 'freeze' && isAdmin && (
                <FreezeModal employees={employees} onToggleFreeze={toggleFreeze} onClose={closeModal} />
            )}
            {confirmEmp && (
                <CustomConfirmModal
                    title="حذف بيانات الموظف"
                    message={`هل أنت متأكد من حذف بيانات الموظف: ${confirmEmp.name}؟\nسيتم حذف جميع أرصدته وسجل خصوماته نهائياً. لا يمكن التراجع عن هذا الإجراء.`}
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
