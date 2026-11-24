import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const ROLE_LABEL = {
  SUPER_ADMIN: 'Quản trị viên cấp cao',
  SECONDARY_ADMIN: 'Quản trị viên thứ 2',
  REPORT_VIEWER: 'Xem & Lấy báo cáo',
  PRODUCT_CONTENT_CREATOR: 'Tạo nội dung sản phẩm'
};

const STATUS_LABEL = {
  ACTIVE: 'Còn hoạt động',
  WARRANTY: 'Bảo hành',
  REPAIR: 'Sửa chữa',
  BROKEN: 'Hư hỏng',
  WARRANTY_REPAIR: 'Bảo hành / Sửa chữa'
};

const FEATURE_OPTIONS = [
  { key: 'status', label: 'Tổng quan (Trạng thái tài sản)' },
  { key: 'create-asset', label: 'Khai báo tài sản' },
  { key: 'categories', label: 'Loại thiết bị' },
  { key: 'allocate', label: 'Cấp phát & Thu hồi' },
  { key: 'company-setup', label: 'Khai báo công ty (Công ty · Chi nhánh · Phòng ban · Nhân viên)' },
  { key: 'report', label: 'Báo cáo & Xuất Excel' },
  { key: 'users', label: 'Cài đặt nâng cao (Phân quyền & User)' }
];

const ROLE_DEFAULT_FEATURES = {
  SUPER_ADMIN: FEATURE_OPTIONS.map((f) => f.key),
  SECONDARY_ADMIN: FEATURE_OPTIONS.map((f) => f.key),
  REPORT_VIEWER: ['status', 'report'],
  PRODUCT_CONTENT_CREATOR: ['status', 'create-asset', 'categories']
};

function getEffectivePermissions(user) {
  if (!user) return [];
  if (Array.isArray(user.permissions) && user.permissions.length > 0) {
    return user.permissions;
  }
  return ROLE_DEFAULT_FEATURES[user.role] || ['status'];
}

export default function App() {
  const [auth, setAuth] = useState(() => {
    const saved = localStorage.getItem('asset_auth');
    return saved ? JSON.parse(saved) : null;
  });
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [loginError, setLoginError] = useState('');

  const [tab, setTab] = useState('status');
  const [openGroups, setOpenGroups] = useState({
    assetManagement: true,
    companySetup: true
  });

  const [companies, setCompanies] = useState([]);
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [categories, setCategories] = useState([]);
  const [assets, setAssets] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [users, setUsers] = useState([]);
  const [toast, setToast] = useState('');

  const [searchName, setSearchName] = useState('');
  const [searchSerial, setSearchSerial] = useState('');
  const [statusDistFilter, setStatusDistFilter] = useState('ALL');

  const [allocAssetSearch, setAllocAssetSearch] = useState('');
  const [allocAssetFilter, setAllocAssetFilter] = useState('UNALLOCATED');
  const [allocEmpCodeSearch, setAllocEmpCodeSearch] = useState('');
  const [allocEmpNameSearch, setAllocEmpNameSearch] = useState('');

  // Form tạo user + chọn nhiều tính năng
  const [newUserForm, setNewUserForm] = useState({
    username: '',
    password: '',
    full_name: '',
    role: 'REPORT_VIEWER',
    permissions: ['status', 'report']
  });

  // Form sửa tính năng cho user hiện có
  const [editingPermUserId, setEditingPermUserId] = useState('');
  const [editingPermList, setEditingPermList] = useState([]);

  const [passwordForm, setPasswordForm] = useState({
    user_id: '',
    new_password: ''
  });

  const [compForm, setCompForm] = useState({ name: '', code: '', address: '' });
  const [editingCompanyId, setEditingCompanyId] = useState(null);

  const [branchForm, setBranchForm] = useState({ company_id: '', name: '', short_code: '', address: '' });
  const [editingBranchId, setEditingBranchId] = useState(null);

  const [catForm, setCatForm] = useState({ name: '', short_code: '' });
  const [editingCatId, setEditingCatId] = useState(null);

  const [deptForm, setDeptForm] = useState({ branch_id: '', name: '' });
  const [editingDeptId, setEditingDeptId] = useState(null);

  const [empForm, setEmpForm] = useState({
    department_id: '',
    employee_code: '',
    full_name: '',
    email: '',
    is_active: true
  });
  const [editingEmpId, setEditingEmpId] = useState(null);

  const today = new Date().toISOString().split('T')[0];
  const [assetForm, setAssetForm] = useState({
    branch_id: '',
    category_id: '',
    product_name: '',
    product_spec: '',
    purchase_date: today,
    warranty_months: 12,
    warranty_expiry_date: '',
    vendor: '',
    serial_number: '',
    status: 'ACTIVE'
  });
  const [previewCode, setPreviewCode] = useState('');
  const [submittingAsset, setSubmittingAsset] = useState(false);

  const [allocForm, setAllocForm] = useState({
    department_id: '',
    employee_id: '',
    asset_ids: [],
    received_date: today,
    returned_date: '',
    notes: ''
  });

  const [editingAllocId, setEditingAllocId] = useState(null);
  const [editAllocForm, setEditAllocForm] = useState({
    asset_id: '',
    department_id: '',
    employee_id: '',
    received_date: today,
    returned_date: '',
    notes: ''
  });

  const [reportCompanyId, setReportCompanyId] = useState('');

  const role = auth?.user?.role;
  const isAdmin = role === 'SUPER_ADMIN' || role === 'SECONDARY_ADMIN';
  const perms = useMemo(() => getEffectivePermissions(auth?.user), [auth]);

  const hasFeature = (feat) => isAdmin || perms.includes(feat);
  const canManageUsers = hasFeature('users');
  const canCreateProductContent = hasFeature('create-asset') || hasFeature('categories');
  const canViewReport = hasFeature('report');

  const authHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      Authorization: auth?.token ? `Bearer ${auth.token}` : ''
    }),
    [auth]
  );

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const togglePermissionItem = (currentList, featKey) => {
    if (currentList.includes(featKey)) {
      return currentList.filter((k) => k !== featKey);
    }
    return [...currentList, featKey];
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.message || 'Đăng nhập thất bại');
        return;
      }
      localStorage.setItem('asset_auth', JSON.stringify(data));
      setAuth(data);
    } catch {
      setLoginError('Không kết nối được tới máy chủ Backend');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('asset_auth');
    setAuth(null);
  };

  const loadAll = async () => {
    if (!auth?.token) return;
    const h = { headers: { Authorization: `Bearer ${auth.token}` } };

    // Đồng bộ lại thông tin & quyền của user đang đăng nhập
    const meRes = await fetch(`${API_URL}/api/auth/me`, h);
    if (meRes.ok) {
      const meData = await meRes.json();
      if (meData.user) {
        setAuth((prev) => {
          const updated = { ...prev, user: meData.user };
          localStorage.setItem('asset_auth', JSON.stringify(updated));
          return updated;
        });
      }
    }

    const [cRes, bRes, dRes, eRes, catRes, aRes, alRes] = await Promise.all([
      fetch(`${API_URL}/api/companies`, h).then((r) => r.json()),
      fetch(`${API_URL}/api/branches`, h).then((r) => r.json()),
      fetch(`${API_URL}/api/departments`, h).then((r) => r.json()),
      fetch(`${API_URL}/api/employees`, h).then((r) => r.json()),
      fetch(`${API_URL}/api/categories`, h).then((r) => r.json()),
      fetch(`${API_URL}/api/assets`, h).then((r) => r.json()),
      fetch(`${API_URL}/api/allocations`, h).then((r) => r.json())
    ]);
    const cList = Array.isArray(cRes) ? cRes : [];
    const bList = Array.isArray(bRes) ? bRes : [];
    const dList = Array.isArray(dRes) ? dRes : [];
    const eList = Array.isArray(eRes) ? eRes : [];
    const catList = Array.isArray(catRes) ? catRes : [];
    const aList = Array.isArray(aRes) ? aRes : [];
    const alList = Array.isArray(alRes) ? alRes : [];

    setCompanies(cList);
    setBranches(bList);
    setDepartments(dList);
    setEmployees(eList);
    setCategories(catList);
    setAssets(aList);
    setAllocations(alList);

    if (isAdmin) {
      const uRes = await fetch(`${API_URL}/api/users`, h).then((r) => r.json());
      if (Array.isArray(uRes)) {
        setUsers(uRes);
        if (uRes[0]) {
          setPasswordForm((p) => ({ ...p, user_id: p.user_id || uRes[0].id }));
          if (!editingPermUserId) {
            setEditingPermUserId(uRes[0].id);
            setEditingPermList(getEffectivePermissions(uRes[0]));
          }
        }
      }
    }

    setBranchForm((p) => ({ ...p, company_id: p.company_id || cList[0]?.id || '' }));
    setDeptForm((p) => ({ ...p, branch_id: p.branch_id || bList[0]?.id || '' }));
    setEmpForm((p) => ({ ...p, department_id: p.department_id || dList[0]?.id || '' }));
    setAssetForm((p) => ({
      ...p,
      branch_id: p.branch_id || bList[0]?.id || '',
      category_id: p.category_id || catList[0]?.id || ''
    }));
    setAllocForm((p) => ({ ...p, department_id: p.department_id || dList[0]?.id || '' }));
  };

  useEffect(() => {
    loadAll();
  }, [auth?.token]);

  useEffect(() => {
    if (!assetForm.purchase_date) return;
    const d = new Date(assetForm.purchase_date);
    d.setMonth(d.getMonth() + Number(assetForm.warranty_months || 0));
    setAssetForm((prev) => ({ ...prev, warranty_expiry_date: d.toISOString().split('T')[0] }));
  }, [assetForm.purchase_date, assetForm.warranty_months]);

  useEffect(() => {
    if (!auth?.token || !assetForm.branch_id || !assetForm.category_id) return;
    fetch(
      `${API_URL}/api/assets/next-code?branch_id=${assetForm.branch_id}&category_id=${assetForm.category_id}`,
      { headers: { Authorization: `Bearer ${auth.token}` } }
    )
      .then((r) => r.json())
      .then((d) => {
        if (d.asset_code) setPreviewCode(d.asset_code);
      })
      .catch(() => {});
  }, [assetForm.branch_id, assetForm.category_id, assets, auth]);

  const handleCreateAsset = async (e) => {
    e.preventDefault();
    if (!assetForm.branch_id || !assetForm.category_id) {
      notify('Vui lòng chọn Chi nhánh và Loại thiết bị');
      return;
    }
    setSubmittingAsset(true);
    try {
      const res = await fetch(`${API_URL}/api/assets`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(assetForm)
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data.message || 'Không thể tạo mã tài sản');
        return;
      }
      setAssetForm((p) => ({
        ...p,
        product_name: '',
        product_spec: '',
        serial_number: '',
        vendor: '',
        status: 'ACTIVE'
      }));
      await loadAll();
      notify(`Đã tạo mã tài sản: ${data.asset_code}`);
    } catch {
      notify('Lỗi kết nối tới Backend khi tạo mã');
    } finally {
      setSubmittingAsset(false);
    }
  };

  const isAssetCurrentlyAllocated = (a) => Boolean(a.allocation_id && !a.returned_date);

  const searchedAssets = useMemo(() => {
    const qName = searchName.trim().toLowerCase();
    const qSerial = searchSerial.trim().toLowerCase();
    return assets.filter((a) => {
      const nameMatch =
        !qName ||
        String(a.product_name || '').toLowerCase().includes(qName) ||
        String(a.asset_code || '').toLowerCase().includes(qName) ||
        String(a.category_name || '').toLowerCase().includes(qName);
      const serialMatch =
        !qSerial || String(a.serial_number || '').toLowerCase().includes(qSerial);
      const distMatch =
        statusDistFilter === 'ALL' ||
        (statusDistFilter === 'UNASSIGNED' && !isAssetCurrentlyAllocated(a)) ||
        (statusDistFilter === 'ASSIGNED' && isAssetCurrentlyAllocated(a));
      return nameMatch && serialMatch && distMatch;
    });
  }, [assets, searchName, searchSerial, statusDistFilter]);

  const selectableAllocAssets = useMemo(() => {
    const q = allocAssetSearch.trim().toLowerCase();
    return assets.filter((a) => {
      const allocated = isAssetCurrentlyAllocated(a);
      const textMatch =
        !q ||
        String(a.asset_code || '').toLowerCase().includes(q) ||
        String(a.product_name || '').toLowerCase().includes(q) ||
        String(a.serial_number || '').toLowerCase().includes(q) ||
        String(a.category_name || '').toLowerCase().includes(q);

      if (allocAssetFilter === 'UNALLOCATED') {
        if (q) return textMatch;
        return !allocated;
      }
      if (allocAssetFilter === 'ALLOCATED') {
        return allocated && textMatch;
      }
      return textMatch;
    });
  }, [assets, allocAssetSearch, allocAssetFilter]);

  const availableAssetsForEdit = useMemo(() => {
    return assets.filter(
      (a) => !isAssetCurrentlyAllocated(a) || String(a.id) === String(editAllocForm.asset_id)
    );
  }, [assets, editAllocForm.asset_id]);

  const filteredAllocations = useMemo(() => {
    const qCode = allocEmpCodeSearch.trim().toLowerCase();
    const qName = allocEmpNameSearch.trim().toLowerCase();
    return allocations.filter((al) => {
      const codeMatch = !qCode || String(al.employee_code || '').toLowerCase().includes(qCode);
      const nameMatch = !qName || String(al.employee_name || '').toLowerCase().includes(qName);
      return codeMatch && nameMatch;
    });
  }, [allocations, allocEmpCodeSearch, allocEmpNameSearch]);

  const activeDeptEmployees = useMemo(
    () =>
      employees.filter(
        (e) => String(e.department_id) === String(allocForm.department_id) && e.is_active !== false
      ),
    [employees, allocForm.department_id]
  );

  const filteredReportAssets = useMemo(() => {
    const list = reportCompanyId
      ? assets.filter((a) => String(a.company_id) === String(reportCompanyId))
      : assets;
    return [...list].sort((a, b) => a.asset_code.localeCompare(b.asset_code));
  }, [assets, reportCompanyId]);

  const exportExcelClient = () => {
    const compObj = companies.find((c) => String(c.id) === String(reportCompanyId));
    const companyTitle = compObj ? compObj.name : 'Tất cả công ty';
    const wsData = [
      [`Tên công ty: ${companyTitle}`],
      [`Ngày báo cáo: ${new Date().toLocaleDateString('vi-VN')}`],
      [],
      [
        'Mã tài sản',
        'Tên sản phẩm',
        'Cấu hình',
        'Loại thiết bị',
        'Phòng ban nhận',
        'Người nhận',
        'Ngày nhận',
        'Ngày trả',
        'Serial',
        'Tình trạng'
      ],
      ...filteredReportAssets.map((a) => [
        a.asset_code,
        a.product_name || '-',
        a.product_spec || '-',
        a.category_name,
        a.returned_date ? `${a.current_department_name || ''} (Đã trả)` : (a.current_department_name || 'Chưa cấp phát'),
        a.returned_date ? '-' : (a.current_employee_name || '-'),
        a.received_date ? String(a.received_date).slice(0, 10) : '-',
        a.returned_date ? String(a.returned_date).slice(0, 10) : 'Chưa trả',
        a.serial_number || 'Không có (Thiết bị VP)',
        STATUS_LABEL[a.status] || a.status
      ])
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, 'BaoCaoTaiSan');
    XLSX.writeFile(wb, 'bao-cao-tai-san.xlsx');
  };

  if (!auth) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <form onSubmit={handleLogin} className="bg-white p-6 rounded-xl shadow-sm w-full max-w-md space-y-4">
          <h1 className="text-xl font-bold text-slate-900">Đăng nhập Quản lý Tài sản</h1>
          {loginError && <div className="bg-red-50 text-red-700 text-sm p-2.5 rounded-lg">{loginError}</div>}
          <div>
            <label className="block text-xs font-medium mb-1">Tên đăng nhập</label>
            <input
              className="w-full border rounded-lg p-2.5 text-sm"
              value={loginForm.username}
              onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
              placeholder="admin / admin2 / reporter / creator"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Mật khẩu</label>
            <input
              type="password"
              className="w-full border rounded-lg p-2.5 text-sm"
              value={loginForm.password}
              onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              required
            />
          </div>
          <button type="submit" className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium">
            Đăng nhập
          </button>
        </form>
      </div>
    );
  }

  const assetMgmtItems = [
    { key: 'create-asset', label: 'Khai báo tài sản', allowed: hasFeature('create-asset') },
    { key: 'categories', label: 'Loại thiết bị', allowed: hasFeature('categories') },
    { key: 'allocate', label: 'Cấp phát & Thu hồi', allowed: hasFeature('allocate') }
  ].filter((item) => item.allowed);

  const companySetupItems = [
    { key: 'companies', label: 'Công ty', allowed: hasFeature('company-setup') },
    { key: 'branches', label: 'Chi nhánh', allowed: hasFeature('company-setup') },
    { key: 'departments', label: 'Phòng ban', allowed: hasFeature('company-setup') },
    { key: 'employees', label: 'Nhân viên', allowed: hasFeature('company-setup') }
  ].filter((item) => item.allowed);

  const renderSearchBar = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-50 p-3 rounded-lg border">
      <input
        type="text"
        className="w-full border rounded-lg p-2 text-sm bg-white"
        placeholder="Tìm theo tên tài sản / mã tài sản / loại..."
        value={searchName}
        onChange={(e) => setSearchName(e.target.value)}
      />
      <input
        type="text"
        className="w-full border rounded-lg p-2 text-sm bg-white"
        placeholder="Tìm theo số Serial..."
        value={searchSerial}
        onChange={(e) => setSearchSerial(e.target.value)}
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col md:flex-row">
      <aside className="w-full md:w-64 bg-white border-r border-slate-200 flex-shrink-0 flex flex-col justify-between">
        <div className="p-4 space-y-4">
          <div className="border-b pb-3">
            <h1 className="text-lg font-bold text-slate-900">Quản Lý Tài Sản</h1>
            <p className="text-xs text-slate-500 mt-1">
              <strong>{auth.user.full_name}</strong> ({auth.user.username})
            </p>
            <span className="inline-block mt-1 text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
              {ROLE_LABEL[role]}
            </span>
          </div>

          <nav className="space-y-1.5 text-sm">
            {hasFeature('status') && (
              <button
                type="button"
                onClick={() => setTab('status')}
                className={`w-full text-left px-3 py-2 rounded-lg font-medium ${
                  tab === 'status' ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                Tổng quan
              </button>
            )}

            {assetMgmtItems.length > 0 && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroups((prev) => ({ ...prev, assetManagement: !prev.assetManagement }))
                  }
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg font-semibold text-slate-800 hover:bg-slate-100"
                >
                  <span>Quản lý tài sản</span>
                  <span className="text-xs">{openGroups.assetManagement ? '▾' : '▸'}</span>
                </button>
                {openGroups.assetManagement && (
                  <div className="mt-1 ml-3 pl-2 border-l border-slate-200 space-y-1">
                    {assetMgmtItems.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setTab(item.key)}
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-sm ${
                          tab === item.key
                            ? 'bg-blue-600 text-white font-medium'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {companySetupItems.length > 0 && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroups((prev) => ({ ...prev, companySetup: !prev.companySetup }))
                  }
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg font-semibold text-slate-800 hover:bg-slate-100"
                >
                  <span>Khai báo công ty</span>
                  <span className="text-xs">{openGroups.companySetup ? '▾' : '▸'}</span>
                </button>
                {openGroups.companySetup && (
                  <div className="mt-1 ml-3 pl-2 border-l border-slate-200 space-y-1">
                    {companySetupItems.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setTab(item.key)}
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-sm ${
                          tab === item.key
                            ? 'bg-blue-600 text-white font-medium'
                            : 'text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {canViewReport && (
              <button
                type="button"
                onClick={() => setTab('report')}
                className={`w-full text-left px-3 py-2 rounded-lg font-medium ${
                  tab === 'report' ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                Báo cáo
              </button>
            )}

            <button
              type="button"
              onClick={() => setTab('users')}
              className={`w-full text-left px-3 py-2 rounded-lg font-medium ${
                tab === 'users' ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              Cài đặt nâng cao
            </button>
          </nav>
        </div>
      </aside>

      <main className="flex-1 p-6 overflow-x-auto">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">Hệ Thống Quản Lý Tài Sản</h2>
            {toast && (
              <div className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium">
                {toast}
              </div>
            )}
          </div>

          {tab === 'status' && hasFeature('status') && (
            <div className="bg-white rounded-xl shadow-sm p-5 space-y-4 overflow-x-auto">
              <h2 className="text-lg font-semibold">Tổng quan & Trạng thái tài sản</h2>
              {renderSearchBar()}
              <div className="flex flex-wrap gap-2">
                {[
                  ['ALL', `Tất cả (${assets.length})`],
                  ['UNASSIGNED', `Chưa phân phối phòng ban (${assets.filter((a) => !isAssetCurrentlyAllocated(a)).length})`],
                  ['ASSIGNED', `Đã phân phối (${assets.filter((a) => isAssetCurrentlyAllocated(a)).length})`]
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStatusDistFilter(key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                      statusDistFilter === key
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="border-b bg-slate-50">
                    <th className="p-3">Mã tài sản</th>
                    <th className="p-3">Tên / Cấu hình / Serial</th>
                    <th className="p-3">Phòng ban nhận</th>
                    <th className="p-3">Người nhận</th>
                    <th className="p-3">Ngày nhận</th>
                    <th className="p-3">Ngày trả</th>
                    <th className="p-3">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {searchedAssets.map((a) => (
                    <tr key={a.id} className="border-b">
                      <td className="p-3 font-semibold text-blue-700">{a.asset_code}</td>
                      <td className="p-3">
                        <div className="font-medium">{a.product_name || a.category_name}</div>
                        <div className="text-xs text-slate-500">
                          {a.product_spec ? `${a.product_spec} · ` : ''}
                          Serial: {a.serial_number || 'Không có (Thiết bị VP)'}
                        </div>
                      </td>
                      <td className="p-3">
                        {a.returned_date || !a.current_department_name
                          ? 'Chưa phân phối'
                          : a.current_department_name}
                      </td>
                      <td className="p-3">
                        {a.returned_date ? '-' : (a.current_employee_name || '-')}
                        {!a.returned_date && a.current_employee_name && a.employee_is_active === false && (
                          <span className="ml-2 text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded">
                            Đã nghỉ việc — cần nhập ngày trả
                          </span>
                        )}
                      </td>
                      <td className="p-3">{a.received_date ? String(a.received_date).slice(0, 10) : '-'}</td>
                      <td className="p-3">
                        {a.allocation_id && hasFeature('allocate') ? (
                          <input
                            type="date"
                            value={a.returned_date ? String(a.returned_date).slice(0, 10) : ''}
                            onChange={async (e) => {
                              await fetch(`${API_URL}/api/allocations/${a.allocation_id}/return`, {
                                method: 'PATCH',
                                headers: authHeaders,
                                body: JSON.stringify({ returned_date: e.target.value })
                              });
                              await loadAll();
                              notify('Đã cập nhật ngày trả');
                            }}
                            className="border rounded px-2 py-1 text-xs"
                          />
                        ) : (
                          a.returned_date ? String(a.returned_date).slice(0, 10) : '-'
                        )}
                      </td>
                      <td className="p-3">
                        {hasFeature('allocate') ? (
                          <select
                            value={a.status}
                            onChange={async (e) => {
                              await fetch(`${API_URL}/api/assets/${a.id}/status`, {
                                method: 'PATCH',
                                headers: authHeaders,
                                body: JSON.stringify({ status: e.target.value })
                              });
                              await loadAll();
                              notify('Đã cập nhật trạng thái tài sản');
                            }}
                            className="border rounded px-2 py-1 text-xs"
                          >
                            <option value="ACTIVE">Còn hoạt động</option>
                            <option value="WARRANTY">Bảo hành</option>
                            <option value="REPAIR">Sửa chữa</option>
                            <option value="BROKEN">Hư hỏng</option>
                          </select>
                        ) : (
                          STATUS_LABEL[a.status] || a.status
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'create-asset' && hasFeature('create-asset') && (
            <div className="space-y-6">
              <form
                onSubmit={handleCreateAsset}
                className="bg-white rounded-xl shadow-sm p-6 grid grid-cols-1 md:grid-cols-3 gap-4"
              >
                <div className="md:col-span-3 flex items-center justify-between bg-blue-50 p-4 rounded-lg">
                  <span className="text-sm font-medium">Mã tài sản sẽ được tạo tự động:</span>
                  <span className="text-lg font-bold text-blue-700">{previewCode || '---'}</span>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">Chi nhánh</label>
                  <select
                    className="w-full border rounded-lg p-2 text-sm"
                    value={assetForm.branch_id}
                    onChange={(e) => setAssetForm({ ...assetForm, branch_id: e.target.value })}
                    required
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.short_code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">Loại thiết bị</label>
                  <select
                    className="w-full border rounded-lg p-2 text-sm"
                    value={assetForm.category_id}
                    onChange={(e) => setAssetForm({ ...assetForm, category_id: e.target.value })}
                    required
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.short_code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">Tên sản phẩm</label>
                  <input
                    type="text"
                    className="w-full border rounded-lg p-2 text-sm"
                    placeholder="VD: Dell Latitude 5440, Màn hình LG 27 inch..."
                    value={assetForm.product_name}
                    onChange={(e) => setAssetForm({ ...assetForm, product_name: e.target.value })}
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium mb-1">Cấu hình sản phẩm</label>
                  <input
                    type="text"
                    className="w-full border rounded-lg p-2 text-sm"
                    placeholder="VD: Core i5-1345U, RAM 16GB, SSD 512GB / FHD IPS 100Hz..."
                    value={assetForm.product_spec}
                    onChange={(e) => setAssetForm({ ...assetForm, product_spec: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">Đơn vị mua</label>
                  <input
                    type="text"
                    className="w-full border rounded-lg p-2 text-sm"
                    value={assetForm.vendor}
                    onChange={(e) => setAssetForm({ ...assetForm, vendor: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">Ngày mua</label>
                  <input
                    type="date"
                    className="w-full border rounded-lg p-2 text-sm"
                    value={assetForm.purchase_date}
                    onChange={(e) => setAssetForm({ ...assetForm, purchase_date: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">Bảo hành (tháng)</label>
                  <input
                    type="number"
                    min="0"
                    className="w-full border rounded-lg p-2 text-sm"
                    value={assetForm.warranty_months}
                    onChange={(e) => setAssetForm({ ...assetForm, warranty_months: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">Ngày hết hạn bảo hành</label>
                  <input
                    type="date"
                    className="w-full border rounded-lg p-2 text-sm"
                    value={assetForm.warranty_expiry_date}
                    onChange={(e) => setAssetForm({ ...assetForm, warranty_expiry_date: e.target.value })}
                    required
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-medium mb-1">
                    Serial (bỏ trống nếu là thiết bị văn phòng)
                  </label>
                  <input
                    type="text"
                    className="w-full border rounded-lg p-2 text-sm"
                    value={assetForm.serial_number}
                    onChange={(e) => setAssetForm({ ...assetForm, serial_number: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1">Trạng thái tài sản</label>
                  <select
                    className="w-full border rounded-lg p-2 text-sm"
                    value={assetForm.status}
                    onChange={(e) => setAssetForm({ ...assetForm, status: e.target.value })}
                  >
                    <option value="ACTIVE">Còn hoạt động</option>
                    <option value="WARRANTY">Bảo hành</option>
                    <option value="REPAIR">Sửa chữa</option>
                    <option value="BROKEN">Hư hỏng</option>
                  </select>
                </div>

                <div className="md:col-span-3">
                  <button
                    type="submit"
                    disabled={submittingAsset}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-lg text-sm font-medium"
                  >
                    {submittingAsset ? 'Đang tạo...' : 'Tạo mã'}
                  </button>
                </div>
              </form>

              <div className="bg-white rounded-xl shadow-sm p-6 space-y-4 overflow-x-auto">
                <h3 className="text-lg font-semibold">
                  Danh sách tất cả mã tài sản ({searchedAssets.length}/{assets.length})
                </h3>
                {renderSearchBar()}
                <table className="w-full text-sm text-left border-collapse">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="p-3">Mã tài sản</th>
                      <th className="p-3">Tên sản phẩm</th>
                      <th className="p-3">Cấu hình</th>
                      <th className="p-3">Loại / Chi nhánh</th>
                      <th className="p-3">Serial</th>
                      <th className="p-3">Đơn vị mua / Bảo hành</th>
                      <th className="p-3">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchedAssets.map((a) => (
                      <tr key={a.id} className="border-b">
                        <td className="p-3 font-semibold text-blue-700">{a.asset_code}</td>
                        <td className="p-3 font-medium">{a.product_name || '-'}</td>
                        <td className="p-3 text-xs text-slate-600">{a.product_spec || '-'}</td>
                        <td className="p-3">
                          <div>{a.category_name}</div>
                          <div className="text-xs text-slate-500">{a.branch_name} ({a.branch_code})</div>
                        </td>
                        <td className="p-3">{a.serial_number || 'Không có (Thiết bị VP)'}</td>
                        <td className="p-3 text-xs">
                          <div>NCC: {a.vendor}</div>
                          <div className="text-slate-500">
                            Mua: {a.purchase_date ? String(a.purchase_date).slice(0, 10) : '-'} · BH: {a.warranty_months}th
                          </div>
                        </td>
                        <td className="p-3">
                          {hasFeature('allocate') ? (
                            <select
                              value={a.status}
                              onChange={async (e) => {
                                await fetch(`${API_URL}/api/assets/${a.id}/status`, {
                                  method: 'PATCH',
                                  headers: authHeaders,
                                  body: JSON.stringify({ status: e.target.value })
                                });
                                await loadAll();
                                notify('Đã cập nhật trạng thái tài sản');
                              }}
                              className="border rounded px-2 py-1 text-xs"
                            >
                              <option value="ACTIVE">Còn hoạt động</option>
                              <option value="WARRANTY">Bảo hành</option>
                              <option value="REPAIR">Sửa chữa</option>
                              <option value="BROKEN">Hư hỏng</option>
                            </select>
                          ) : (
                            STATUS_LABEL[a.status] || a.status
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'categories' && hasFeature('categories') && (
            <div className="space-y-6">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const url = editingCatId ? `${API_URL}/api/categories/${editingCatId}` : `${API_URL}/api/categories`;
                  const method = editingCatId ? 'PATCH' : 'POST';
                  const res = await fetch(url, { method, headers: authHeaders, body: JSON.stringify(catForm) });
                  const data = await res.json();
                  if (!res.ok) {
                    notify(data.message || 'Thao tác loại thiết bị thất bại');
                    return;
                  }
                  setCatForm({ name: '', short_code: '' });
                  setEditingCatId(null);
                  await loadAll();
                  notify(editingCatId ? 'Đã cập nhật loại thiết bị' : 'Đã tạo mã loại thiết bị');
                }}
                className="bg-white rounded-xl shadow-sm p-5 grid grid-cols-1 md:grid-cols-3 gap-3"
              >
                <div className="md:col-span-3 flex items-center justify-between">
                  <h3 className="font-semibold">{editingCatId ? 'Chỉnh sửa Loại thiết bị' : 'Tạo mã loại thiết bị'}</h3>
                  {editingCatId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCatId(null);
                        setCatForm({ name: '', short_code: '' });
                      }}
                      className="text-xs text-slate-500 underline"
                    >
                      Hủy sửa
                    </button>
                  )}
                </div>
                <input
                  className="border rounded-lg p-2 text-sm"
                  placeholder="Tên loại thiết bị"
                  value={catForm.name}
                  onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                  required
                />
                <input
                  className="border rounded-lg p-2 text-sm"
                  placeholder="Tên viết tắt (VD: LAP, PRT)"
                  value={catForm.short_code}
                  onChange={(e) => setCatForm({ ...catForm, short_code: e.target.value })}
                  required
                />
                <button type="submit" className="bg-slate-800 text-white rounded-lg text-sm font-medium">
                  {editingCatId ? 'Cập nhật loại thiết bị' : 'Lưu loại thiết bị'}
                </button>
              </form>

              <div className="bg-white p-5 rounded-xl shadow-sm overflow-x-auto">
                <h3 className="font-semibold mb-3">Danh sách Loại thiết bị</h3>
                <table className="w-full text-sm text-left border-collapse">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="p-3">Tên viết tắt</th>
                      <th className="p-3">Tên loại thiết bị</th>
                      <th className="p-3">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((c) => (
                      <tr key={c.id} className="border-b">
                        <td className="p-3 font-semibold text-blue-700">{c.short_code}</td>
                        <td className="p-3 font-medium">{c.name}</td>
                        <td className="p-3 space-x-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCatId(c.id);
                              setCatForm({ name: c.name || '', short_code: c.short_code || '' });
                            }}
                            className="text-xs bg-amber-100 text-amber-800 px-2.5 py-1 rounded"
                          >
                            Sửa
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const res = await fetch(`${API_URL}/api/categories/${c.id}`, {
                                method: 'DELETE',
                                headers: authHeaders
                              });
                              const data = await res.json();
                              if (!res.ok) {
                                notify(data.message || 'Xóa loại thiết bị thất bại');
                                return;
                              }
                              if (editingCatId === c.id) {
                                setEditingCatId(null);
                                setCatForm({ name: '', short_code: '' });
                              }
                              await loadAll();
                              notify('Đã xóa loại thiết bị');
                            }}
                            className="text-xs bg-red-100 text-red-700 px-2.5 py-1 rounded"
                          >
                            Xóa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'allocate' && hasFeature('allocate') && (
            <div className="space-y-6">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (allocForm.asset_ids.length === 0) {
                    notify('Vui lòng chọn ít nhất 1 tài sản để cấp phát');
                    return;
                  }
                  const res = await fetch(`${API_URL}/api/allocations/batch`, {
                    method: 'POST',
                    headers: authHeaders,
                    body: JSON.stringify(allocForm)
                  });
                  if (!res.ok) {
                    const errData = await res.json();
                    notify(errData.message || 'Cấp phát thất bại');
                    return;
                  }
                  setAllocForm((p) => ({ ...p, asset_ids: [], returned_date: '', notes: '' }));
                  await loadAll();
                  notify('Đã cấp phát tài sản thành công');
                }}
                className="bg-white rounded-xl shadow-sm p-6 space-y-4"
              >
                <h2 className="text-lg font-semibold">Cấp phát nhiều tài sản</h2>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <select
                    className="border rounded-lg p-2 text-sm"
                    value={allocForm.department_id}
                    onChange={(e) => setAllocForm({ ...allocForm, department_id: e.target.value, employee_id: '' })}
                  >
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  <select
                    className="border rounded-lg p-2 text-sm"
                    value={allocForm.employee_id}
                    onChange={(e) => setAllocForm({ ...allocForm, employee_id: e.target.value })}
                    required
                  >
                    <option value="">-- Chọn người nhận (còn đi làm) --</option>
                    {activeDeptEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.full_name} {emp.employee_code ? `(${emp.employee_code})` : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    className="border rounded-lg p-2 text-sm"
                    value={allocForm.received_date}
                    onChange={(e) => setAllocForm({ ...allocForm, received_date: e.target.value })}
                    required
                  />
                  <input
                    type="date"
                    className="border rounded-lg p-2 text-sm"
                    value={allocForm.returned_date}
                    onChange={(e) => setAllocForm({ ...allocForm, returned_date: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-50 p-3 rounded-lg border">
                  <input
                    type="text"
                    className="md:col-span-2 border rounded-lg p-2 text-sm bg-white"
                    placeholder="Tìm kiếm sản phẩm (mã, tên, serial) — nhập từ khóa để hiện cả sản phẩm đã cấp phát..."
                    value={allocAssetSearch}
                    onChange={(e) => setAllocAssetSearch(e.target.value)}
                  />
                  <select
                    className="border rounded-lg p-2 text-sm bg-white"
                    value={allocAssetFilter}
                    onChange={(e) => setAllocAssetFilter(e.target.value)}
                  >
                    <option value="UNALLOCATED">Sản phẩm chưa cấp phát (mặc định)</option>
                    <option value="ALLOCATED">Sản phẩm đã cấp phát</option>
                    <option value="ALL">Tất cả sản phẩm</option>
                  </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 max-h-60 overflow-y-auto border p-3 rounded-lg">
                  {selectableAllocAssets.length === 0 ? (
                    <div className="md:col-span-3 text-xs text-slate-500 py-4 text-center">
                      {allocAssetFilter === 'UNALLOCATED' && !allocAssetSearch.trim()
                        ? 'Tất cả sản phẩm đã được cấp phát. Nhập tên/mã/serial ở ô tìm kiếm hoặc chọn "Sản phẩm đã cấp phát" để tìm.'
                        : 'Không tìm thấy sản phẩm phù hợp.'}
                    </div>
                  ) : (
                    selectableAllocAssets.map((a) => {
                      const checked = allocForm.asset_ids.includes(a.id);
                      const allocated = isAssetCurrentlyAllocated(a);
                      return (
                        <label key={a.id} className="flex items-center gap-2 text-sm p-2 rounded hover:bg-slate-50">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setAllocForm((prev) => ({
                                ...prev,
                                asset_ids: checked ? prev.asset_ids.filter((id) => id !== a.id) : [...prev.asset_ids, a.id]
                              }))
                            }
                          />
                          <span>
                            <strong>{a.asset_code}</strong> — {a.product_name || a.category_name}
                            {allocated && (
                              <span className="ml-1.5 text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                                Đã cấp phát ({a.current_employee_name || ''})
                              </span>
                            )}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>

                <button type="submit" className="bg-emerald-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium">
                  Xác nhận cấp phát ({allocForm.asset_ids.length})
                </button>
              </form>

              {editingAllocId && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const res = await fetch(`${API_URL}/api/allocations/${editingAllocId}`, {
                      method: 'PATCH',
                      headers: authHeaders,
                      body: JSON.stringify(editAllocForm)
                    });
                    if (!res.ok) {
                      notify('Cập nhật bản ghi cấp phát thất bại');
                      return;
                    }
                    setEditingAllocId(null);
                    await loadAll();
                    notify('Đã cập nhật thông tin & sản phẩm cấp phát');
                  }}
                  className="bg-white rounded-xl shadow-sm p-6 border-2 border-amber-300 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-amber-900">
                      Chỉnh sửa cấp phát #{editingAllocId} (Có thể đổi sang sản phẩm khác)
                    </h3>
                    <button
                      type="button"
                      onClick={() => setEditingAllocId(null)}
                      className="text-xs text-slate-500 underline"
                    >
                      Hủy sửa
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1">
                        Sản phẩm cấp phát (chọn sản phẩm khác để đổi/thay thế)
                      </label>
                      <select
                        className="w-full border rounded-lg p-2 text-sm"
                        value={editAllocForm.asset_id}
                        onChange={(e) => setEditAllocForm({ ...editAllocForm, asset_id: e.target.value })}
                        required
                      >
                        {availableAssetsForEdit.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.asset_code} — {a.product_name || a.category_name}{' '}
                            {a.serial_number ? `(SN: ${a.serial_number})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1">Phòng ban nhận</label>
                      <select
                        className="w-full border rounded-lg p-2 text-sm"
                        value={editAllocForm.department_id}
                        onChange={(e) => setEditAllocForm({ ...editAllocForm, department_id: e.target.value })}
                        required
                      >
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1">Người nhận</label>
                      <select
                        className="w-full border rounded-lg p-2 text-sm"
                        value={editAllocForm.employee_id}
                        onChange={(e) => setEditAllocForm({ ...editAllocForm, employee_id: e.target.value })}
                        required
                      >
                        <option value="">-- Chọn nhân viên --</option>
                        {employees.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.full_name} {emp.employee_code ? `(${emp.employee_code})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-medium mb-1">Ngày nhận</label>
                        <input
                          type="date"
                          className="w-full border rounded-lg p-2 text-sm"
                          value={editAllocForm.received_date}
                          onChange={(e) => setEditAllocForm({ ...editAllocForm, received_date: e.target.value })}
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">Ngày trả</label>
                        <input
                          type="date"
                          className="w-full border rounded-lg p-2 text-sm"
                          value={editAllocForm.returned_date}
                          onChange={(e) => setEditAllocForm({ ...editAllocForm, returned_date: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>

                  <input
                    type="text"
                    className="w-full border rounded-lg p-2 text-sm"
                    placeholder="Ghi chú đổi / sửa sản phẩm..."
                    value={editAllocForm.notes}
                    onChange={(e) => setEditAllocForm({ ...editAllocForm, notes: e.target.value })}
                  />

                  <button type="submit" className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium">
                    Lưu thay đổi
                  </button>
                </form>
              )}

              <div className="bg-white rounded-xl shadow-sm p-6 space-y-4 overflow-x-auto">
                <h3 className="text-lg font-semibold">
                  Danh sách cấp phát & thu hồi ({filteredAllocations.length}/{allocations.length})
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-50 p-3 rounded-lg border">
                  <input
                    type="text"
                    className="border rounded-lg p-2 text-sm bg-white"
                    placeholder="Tìm kiếm theo Mã nhân viên (VD: NV001)..."
                    value={allocEmpCodeSearch}
                    onChange={(e) => setAllocEmpCodeSearch(e.target.value)}
                  />
                  <input
                    type="text"
                    className="border rounded-lg p-2 text-sm bg-white"
                    placeholder="Tìm kiếm theo Tên nhân viên..."
                    value={allocEmpNameSearch}
                    onChange={(e) => setAllocEmpNameSearch(e.target.value)}
                  />
                </div>

                <table className="w-full text-sm text-left border-collapse">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="p-3">Mã tài sản / Sản phẩm</th>
                      <th className="p-3">Mã NV</th>
                      <th className="p-3">Người nhận</th>
                      <th className="p-3">Phòng ban</th>
                      <th className="p-3">Ngày nhận</th>
                      <th className="p-3">Ngày trả</th>
                      <th className="p-3">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAllocations.map((al) => (
                      <tr key={al.id} className="border-b">
                        <td className="p-3">
                          <strong className="text-blue-700">{al.asset_code}</strong> — {al.product_name || al.category_name}
                        </td>
                        <td className="p-3">{al.employee_code || '-'}</td>
                        <td className="p-3 font-medium">{al.employee_name}</td>
                        <td className="p-3">{al.department_name}</td>
                        <td className="p-3">{al.received_date ? String(al.received_date).slice(0, 10) : '-'}</td>
                        <td className="p-3">
                          <input
                            type="date"
                            value={al.returned_date ? String(al.returned_date).slice(0, 10) : ''}
                            onChange={async (e) => {
                              await fetch(`${API_URL}/api/allocations/${al.id}/return`, {
                                method: 'PATCH',
                                headers: authHeaders,
                                body: JSON.stringify({ returned_date: e.target.value })
                              });
                              await loadAll();
                              notify('Đã cập nhật ngày thu hồi');
                            }}
                            className="border rounded px-2 py-1 text-xs"
                          />
                        </td>
                        <td className="p-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingAllocId(al.id);
                              setEditAllocForm({
                                asset_id: al.asset_id,
                                department_id: al.department_id,
                                employee_id: al.employee_id,
                                received_date: al.received_date ? String(al.received_date).slice(0, 10) : today,
                                returned_date: al.returned_date ? String(al.returned_date).slice(0, 10) : '',
                                notes: al.notes || ''
                              });
                            }}
                            className="text-xs bg-amber-100 text-amber-800 px-2.5 py-1 rounded"
                          >
                            Sửa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'companies' && hasFeature('company-setup') && (
            <div className="space-y-6">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const url = editingCompanyId ? `${API_URL}/api/companies/${editingCompanyId}` : `${API_URL}/api/companies`;
                  const method = editingCompanyId ? 'PATCH' : 'POST';
                  const res = await fetch(url, { method, headers: authHeaders, body: JSON.stringify(compForm) });
                  const data = await res.json();
                  if (!res.ok) {
                    notify(data.message || 'Thao tác công ty thất bại');
                    return;
                  }
                  setCompForm({ name: '', code: '', address: '' });
                  setEditingCompanyId(null);
                  await loadAll();
                  notify(editingCompanyId ? 'Đã cập nhật công ty' : 'Đã thêm công ty');
                }}
                className="bg-white p-5 rounded-xl shadow-sm grid grid-cols-1 md:grid-cols-3 gap-3"
              >
                <div className="md:col-span-3 flex items-center justify-between">
                  <h3 className="font-semibold">{editingCompanyId ? 'Chỉnh sửa Công ty' : 'Thêm Công ty mới'}</h3>
                  {editingCompanyId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCompanyId(null);
                        setCompForm({ name: '', code: '', address: '' });
                      }}
                      className="text-xs text-slate-500 underline"
                    >
                      Hủy sửa
                    </button>
                  )}
                </div>
                <input
                  className="border rounded-lg p-2 text-sm"
                  placeholder="Tên công ty"
                  value={compForm.name}
                  onChange={(e) => setCompForm({ ...compForm, name: e.target.value })}
                  required
                />
                <input
                  className="border rounded-lg p-2 text-sm"
                  placeholder="Mã công ty"
                  value={compForm.code}
                  onChange={(e) => setCompForm({ ...compForm, code: e.target.value })}
                />
                <input
                  className="border rounded-lg p-2 text-sm"
                  placeholder="Địa chỉ công ty"
                  value={compForm.address}
                  onChange={(e) => setCompForm({ ...compForm, address: e.target.value })}
                />
                <div className="md:col-span-3">
                  <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
                    {editingCompanyId ? 'Cập nhật công ty' : 'Thêm công ty'}
                  </button>
                </div>
              </form>

              <div className="bg-white p-5 rounded-xl shadow-sm overflow-x-auto">
                <h3 className="font-semibold mb-3">Danh sách Công ty</h3>
                <table className="w-full text-sm text-left border-collapse">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="p-3">Mã</th>
                      <th className="p-3">Tên công ty</th>
                      <th className="p-3">Địa chỉ</th>
                      <th className="p-3">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((c) => (
                      <tr key={c.id} className="border-b">
                        <td className="p-3">{c.code || '-'}</td>
                        <td className="p-3 font-medium">{c.name}</td>
                        <td className="p-3">{c.address || '-'}</td>
                        <td className="p-3 space-x-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCompanyId(c.id);
                              setCompForm({ name: c.name || '', code: c.code || '', address: c.address || '' });
                            }}
                            className="text-xs bg-amber-100 text-amber-800 px-2.5 py-1 rounded"
                          >
                            Sửa
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const res = await fetch(`${API_URL}/api/companies/${c.id}`, {
                                method: 'DELETE',
                                headers: authHeaders
                              });
                              const data = await res.json();
                              if (!res.ok) {
                                notify(data.message || 'Xóa công ty thất bại');
                                return;
                              }
                              if (editingCompanyId === c.id) {
                                setEditingCompanyId(null);
                                setCompForm({ name: '', code: '', address: '' });
                              }
                              await loadAll();
                              notify('Đã xóa công ty');
                            }}
                            className="text-xs bg-red-100 text-red-700 px-2.5 py-1 rounded"
                          >
                            Xóa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'branches' && hasFeature('company-setup') && (
            <div className="space-y-6">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const url = editingBranchId ? `${API_URL}/api/branches/${editingBranchId}` : `${API_URL}/api/branches`;
                  const method = editingBranchId ? 'PATCH' : 'POST';
                  const res = await fetch(url, { method, headers: authHeaders, body: JSON.stringify(branchForm) });
                  const data = await res.json();
                  if (!res.ok) {
                    notify(data.message || 'Thao tác chi nhánh thất bại');
                    return;
                  }
                  setBranchForm((p) => ({ ...p, name: '', short_code: '', address: '' }));
                  setEditingBranchId(null);
                  await loadAll();
                  notify(editingBranchId ? 'Đã cập nhật chi nhánh' : 'Đã thêm chi nhánh');
                }}
                className="bg-white p-5 rounded-xl shadow-sm grid grid-cols-1 md:grid-cols-4 gap-3"
              >
                <div className="md:col-span-4 flex items-center justify-between">
                  <h3 className="font-semibold">{editingBranchId ? 'Chỉnh sửa Chi nhánh' : 'Thêm Chi nhánh mới'}</h3>
                  {editingBranchId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingBranchId(null);
                        setBranchForm((p) => ({ ...p, name: '', short_code: '', address: '' }));
                      }}
                      className="text-xs text-slate-500 underline"
                    >
                      Hủy sửa
                    </button>
                  )}
                </div>
                <select
                  className="border rounded-lg p-2 text-sm"
                  value={branchForm.company_id}
                  onChange={(e) => setBranchForm({ ...branchForm, company_id: e.target.value })}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <input
                  className="border rounded-lg p-2 text-sm"
                  placeholder="Tên chi nhánh"
                  value={branchForm.name}
                  onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
                  required
                />
                <input
                  className="border rounded-lg p-2 text-sm"
                  placeholder="Tên viết tắt (VD: HCM)"
                  value={branchForm.short_code}
                  onChange={(e) => setBranchForm({ ...branchForm, short_code: e.target.value })}
                  required
                />
                <input
                  className="border rounded-lg p-2 text-sm"
                  placeholder="Địa chỉ chi nhánh"
                  value={branchForm.address}
                  onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })}
                  required
                />
                <div className="md:col-span-4">
                  <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
                    {editingBranchId ? 'Cập nhật chi nhánh' : 'Thêm chi nhánh'}
                  </button>
                </div>
              </form>

              <div className="bg-white p-5 rounded-xl shadow-sm overflow-x-auto">
                <h3 className="font-semibold mb-3">Danh sách Chi nhánh</h3>
                <table className="w-full text-sm text-left border-collapse">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="p-3">Tên viết tắt</th>
                      <th className="p-3">Tên chi nhánh</th>
                      <th className="p-3">Công ty</th>
                      <th className="p-3">Địa chỉ</th>
                      <th className="p-3">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branches.map((b) => (
                      <tr key={b.id} className="border-b">
                        <td className="p-3 font-semibold text-blue-700">{b.short_code}</td>
                        <td className="p-3 font-medium">{b.name}</td>
                        <td className="p-3">{b.company_name}</td>
                        <td className="p-3">{b.address}</td>
                        <td className="p-3 space-x-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingBranchId(b.id);
                              setBranchForm({
                                company_id: b.company_id,
                                name: b.name || '',
                                short_code: b.short_code || '',
                                address: b.address || ''
                              });
                            }}
                            className="text-xs bg-amber-100 text-amber-800 px-2.5 py-1 rounded"
                          >
                            Sửa
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const res = await fetch(`${API_URL}/api/branches/${b.id}`, {
                                method: 'DELETE',
                                headers: authHeaders
                              });
                              const data = await res.json();
                              if (!res.ok) {
                                notify(data.message || 'Xóa chi nhánh thất bại');
                                return;
                              }
                              if (editingBranchId === b.id) {
                                setEditingBranchId(null);
                                setBranchForm((p) => ({ ...p, name: '', short_code: '', address: '' }));
                              }
                              await loadAll();
                              notify('Đã xóa chi nhánh');
                            }}
                            className="text-xs bg-red-100 text-red-700 px-2.5 py-1 rounded"
                          >
                            Xóa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'departments' && hasFeature('company-setup') && (
            <div className="space-y-6">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const url = editingDeptId ? `${API_URL}/api/departments/${editingDeptId}` : `${API_URL}/api/departments`;
                  const method = editingDeptId ? 'PATCH' : 'POST';
                  const res = await fetch(url, { method, headers: authHeaders, body: JSON.stringify(deptForm) });
                  const data = await res.json();
                  if (!res.ok) {
                    notify(data.message || 'Thao tác phòng ban thất bại');
                    return;
                  }
                  setDeptForm((p) => ({ ...p, name: '' }));
                  setEditingDeptId(null);
                  await loadAll();
                  notify(editingDeptId ? 'Đã cập nhật phòng ban' : 'Đã thêm phòng ban');
                }}
                className="bg-white p-5 rounded-xl shadow-sm grid grid-cols-1 md:grid-cols-3 gap-3"
              >
                <div className="md:col-span-3 flex items-center justify-between">
                  <h3 className="font-semibold">{editingDeptId ? 'Chỉnh sửa Phòng ban' : 'Thêm Phòng ban mới'}</h3>
                  {editingDeptId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingDeptId(null);
                        setDeptForm((p) => ({ ...p, name: '' }));
                      }}
                      className="text-xs text-slate-500 underline"
                    >
                      Hủy sửa
                    </button>
                  )}
                </div>
                <select
                  className="border rounded-lg p-2 text-sm"
                  value={deptForm.branch_id}
                  onChange={(e) => setDeptForm({ ...deptForm, branch_id: e.target.value })}
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name} ({b.short_code})</option>
                  ))}
                </select>
                <input
                  className="border rounded-lg p-2 text-sm"
                  placeholder="Tên phòng ban"
                  value={deptForm.name}
                  onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })}
                  required
                />
                <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
                  {editingDeptId ? 'Cập nhật phòng ban' : 'Thêm phòng ban'}
                </button>
              </form>

              <div className="bg-white p-5 rounded-xl shadow-sm overflow-x-auto">
                <h3 className="font-semibold mb-3">Danh sách Phòng ban</h3>
                <table className="w-full text-sm text-left border-collapse">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="p-3">Tên phòng ban</th>
                      <th className="p-3">Chi nhánh</th>
                      <th className="p-3">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {departments.map((d) => (
                      <tr key={d.id} className="border-b">
                        <td className="p-3 font-medium">{d.name}</td>
                        <td className="p-3">{d.branch_name} ({d.branch_code})</td>
                        <td className="p-3 space-x-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingDeptId(d.id);
                              setDeptForm({ branch_id: d.branch_id, name: d.name || '' });
                            }}
                            className="text-xs bg-amber-100 text-amber-800 px-2.5 py-1 rounded"
                          >
                            Sửa
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const res = await fetch(`${API_URL}/api/departments/${d.id}`, {
                                method: 'DELETE',
                                headers: authHeaders
                              });
                              const data = await res.json();
                              if (!res.ok) {
                                notify(data.message || 'Xóa phòng ban thất bại');
                                return;
                              }
                              if (editingDeptId === d.id) {
                                setEditingDeptId(null);
                                setDeptForm((p) => ({ ...p, name: '' }));
                              }
                              await loadAll();
                              notify('Đã xóa phòng ban');
                            }}
                            className="text-xs bg-red-100 text-red-700 px-2.5 py-1 rounded"
                          >
                            Xóa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'employees' && hasFeature('company-setup') && (
            <div className="space-y-6">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const url = editingEmpId ? `${API_URL}/api/employees/${editingEmpId}` : `${API_URL}/api/employees`;
                  const method = editingEmpId ? 'PATCH' : 'POST';
                  const res = await fetch(url, { method, headers: authHeaders, body: JSON.stringify(empForm) });
                  const data = await res.json();
                  if (!res.ok) {
                    notify(data.message || 'Thao tác nhân viên thất bại');
                    return;
                  }
                  setEmpForm((p) => ({ ...p, employee_code: '', full_name: '', email: '', is_active: true }));
                  setEditingEmpId(null);
                  await loadAll();
                  notify(editingEmpId ? 'Đã cập nhật nhân viên' : 'Đã thêm nhân viên');
                }}
                className="bg-white p-5 rounded-xl shadow-sm grid grid-cols-1 md:grid-cols-5 gap-3"
              >
                <div className="md:col-span-5 flex items-center justify-between">
                  <h3 className="font-semibold">{editingEmpId ? 'Chỉnh sửa Nhân viên' : 'Thêm Nhân viên mới'}</h3>
                  {editingEmpId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingEmpId(null);
                        setEmpForm((p) => ({ ...p, employee_code: '', full_name: '', email: '', is_active: true }));
                      }}
                      className="text-xs text-slate-500 underline"
                    >
                      Hủy sửa
                    </button>
                  )}
                </div>
                <select
                  className="border rounded-lg p-2 text-sm"
                  value={empForm.department_id}
                  onChange={(e) => setEmpForm({ ...empForm, department_id: e.target.value })}
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <input
                  className="border rounded-lg p-2 text-sm"
                  placeholder="Mã nhân viên"
                  value={empForm.employee_code}
                  onChange={(e) => setEmpForm({ ...empForm, employee_code: e.target.value })}
                />
                <input
                  className="border rounded-lg p-2 text-sm"
                  placeholder="Họ tên nhân viên"
                  value={empForm.full_name}
                  onChange={(e) => setEmpForm({ ...empForm, full_name: e.target.value })}
                  required
                />
                <input
                  className="border rounded-lg p-2 text-sm"
                  placeholder="Email (tùy chọn)"
                  value={empForm.email}
                  onChange={(e) => setEmpForm({ ...empForm, email: e.target.value })}
                />
                <select
                  className="border rounded-lg p-2 text-sm"
                  value={empForm.is_active ? 'true' : 'false'}
                  onChange={(e) => setEmpForm({ ...empForm, is_active: e.target.value === 'true' })}
                >
                  <option value="true">Còn đi làm</option>
                  <option value="false">Đã nghỉ việc</option>
                </select>
                <div className="md:col-span-5">
                  <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">
                    {editingEmpId ? 'Cập nhật nhân viên' : 'Thêm nhân viên'}
                  </button>
                </div>
              </form>

              <div className="bg-white p-5 rounded-xl shadow-sm overflow-x-auto">
                <h3 className="font-semibold mb-3">Danh sách Nhân viên</h3>
                <table className="w-full text-sm text-left border-collapse">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="p-3">Mã NV</th>
                      <th className="p-3">Họ tên</th>
                      <th className="p-3">Phòng ban</th>
                      <th className="p-3">Trạng thái làm việc</th>
                      <th className="p-3">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp) => (
                      <tr key={emp.id} className="border-b">
                        <td className="p-3">{emp.employee_code || '-'}</td>
                        <td className="p-3 font-medium">{emp.full_name}</td>
                        <td className="p-3">{emp.department_name}</td>
                        <td className="p-3">
                          <select
                            value={emp.is_active !== false ? 'true' : 'false'}
                            onChange={async (e) => {
                              const nextActive = e.target.value === 'true';
                              await fetch(`${API_URL}/api/employees/${emp.id}/status`, {
                                method: 'PATCH',
                                headers: authHeaders,
                                body: JSON.stringify({ is_active: nextActive })
                              });
                              await loadAll();
                              notify(
                                nextActive
                                  ? `Đã chuyển ${emp.full_name} sang Còn đi làm`
                                  : `Đã đánh dấu ${emp.full_name} Đã nghỉ việc — hãy cập nhật ngày trả tài sản nếu có`
                              );
                            }}
                            className="border rounded px-2 py-1 text-xs"
                          >
                            <option value="true">Còn đi làm</option>
                            <option value="false">Đã nghỉ việc</option>
                          </select>
                        </td>
                        <td className="p-3 space-x-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingEmpId(emp.id);
                              setEmpForm({
                                department_id: emp.department_id,
                                employee_code: emp.employee_code || '',
                                full_name: emp.full_name || '',
                                email: emp.email || '',
                                is_active: emp.is_active !== false
                              });
                            }}
                            className="text-xs bg-amber-100 text-amber-800 px-2.5 py-1 rounded"
                          >
                            Sửa
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const res = await fetch(`${API_URL}/api/employees/${emp.id}`, {
                                method: 'DELETE',
                                headers: authHeaders
                              });
                              const data = await res.json();
                              if (!res.ok) {
                                notify(data.message || 'Xóa nhân viên thất bại');
                                return;
                              }
                              if (editingEmpId === emp.id) {
                                setEditingEmpId(null);
                                setEmpForm((p) => ({ ...p, employee_code: '', full_name: '', email: '', is_active: true }));
                              }
                              await loadAll();
                              notify('Đã xóa nhân viên');
                            }}
                            className="text-xs bg-red-100 text-red-700 px-2.5 py-1 rounded"
                          >
                            Xóa
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'report' && canViewReport && (
            <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Báo cáo tài sản (theo mã tài sản)</h2>
                  <p className="text-sm text-slate-500">Ngày báo cáo: {new Date().toLocaleDateString('vi-VN')}</p>
                </div>
                <div className="flex items-center gap-3">
                  <select
                    className="border rounded-lg px-3 py-2 text-sm"
                    value={reportCompanyId}
                    onChange={(e) => setReportCompanyId(e.target.value)}
                  >
                    <option value="">Tất cả công ty</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={exportExcelClient}
                    className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    Xuất file Excel (.xlsx)
                  </button>
                </div>
              </div>
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="border-b bg-slate-50">
                    <th className="p-3">Mã tài sản</th>
                    <th className="p-3">Tên / Cấu hình</th>
                    <th className="p-3">Loại</th>
                    <th className="p-3">Phòng ban</th>
                    <th className="p-3">Người nhận</th>
                    <th className="p-3">Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReportAssets.map((a) => (
                    <tr key={a.id} className="border-b">
                      <td className="p-3 font-semibold">{a.asset_code}</td>
                      <td className="p-3">
                        {a.product_name || '-'}
                        {a.product_spec ? ` (${a.product_spec})` : ''}
                      </td>
                      <td className="p-3">{a.category_name}</td>
                      <td className="p-3">{a.current_department_name || 'Chưa phân phối'}</td>
                      <td className="p-3">{a.returned_date ? '-' : (a.current_employee_name || '-')}</td>
                      <td className="p-3">{STATUS_LABEL[a.status] || a.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'users' && (
            <div className="space-y-6">
              <div className="bg-white p-5 rounded-xl shadow-sm flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Phiên đăng nhập hiện tại</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Đang đăng nhập với tài khoản <strong>{auth.user.full_name}</strong> ({auth.user.username}) ·{' '}
                    {ROLE_LABEL[role]}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Đăng xuất
                </button>
              </div>

              {canManageUsers && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Tạo user + Chọn nhiều tính năng */}
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const res = await fetch(`${API_URL}/api/users`, {
                          method: 'POST',
                          headers: authHeaders,
                          body: JSON.stringify(newUserForm)
                        });
                        const data = await res.json();
                        if (!res.ok) {
                          notify(data.message || 'Tạo user thất bại');
                          return;
                        }
                        setNewUserForm({
                          username: '',
                          password: '',
                          full_name: '',
                          role: 'REPORT_VIEWER',
                          permissions: ['status', 'report']
                        });
                        await loadAll();
                        notify('Đã tạo tài khoản & gán tính năng');
                      }}
                      className="bg-white p-5 rounded-xl shadow-sm space-y-3"
                    >
                      <h3 className="font-semibold">Tạo tài khoản & Chọn nhiều tính năng</h3>
                      <input
                        className="w-full border rounded-lg p-2 text-sm"
                        placeholder="Tên đăng nhập"
                        value={newUserForm.username}
                        onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                        required
                      />
                      <input
                        className="w-full border rounded-lg p-2 text-sm"
                        placeholder="Họ tên"
                        value={newUserForm.full_name}
                        onChange={(e) => setNewUserForm({ ...newUserForm, full_name: e.target.value })}
                        required
                      />
                      <input
                        type="password"
                        className="w-full border rounded-lg p-2 text-sm"
                        placeholder="Mật khẩu (mặc định Admin@123)"
                        value={newUserForm.password}
                        onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                      />
                      <div>
                        <label className="block text-xs font-medium mb-1">Chọn nhiều tính năng được phép sử dụng:</label>
                        <div className="border rounded-lg p-2.5 space-y-1.5 max-h-44 overflow-y-auto bg-slate-50">
                          {FEATURE_OPTIONS.map((feat) => (
                            <label key={feat.key} className="flex items-center gap-2 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={newUserForm.permissions.includes(feat.key)}
                                onChange={() =>
                                  setNewUserForm((prev) => ({
                                    ...prev,
                                    permissions: togglePermissionItem(prev.permissions, feat.key)
                                  }))
                                }
                              />
                              <span>{feat.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Tạo user</button>
                    </form>

                    {/* Đổi mật khẩu + Cập nhật nhiều tính năng cho user hiện có */}
                    <div className="space-y-6">
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const res = await fetch(`${API_URL}/api/users/${passwordForm.user_id}/password`, {
                            method: 'PATCH',
                            headers: authHeaders,
                            body: JSON.stringify({ new_password: passwordForm.new_password })
                          });
                          const data = await res.json();
                          if (!res.ok) {
                            notify(data.message || 'Đổi mật khẩu thất bại');
                            return;
                          }
                          setPasswordForm((p) => ({ ...p, new_password: '' }));
                          notify(`Đã đổi mật khẩu cho ${data.user.username}`);
                        }}
                        className="bg-white p-5 rounded-xl shadow-sm space-y-3"
                      >
                        <h3 className="font-semibold">Đổi mật khẩu tài khoản</h3>
                        <select
                          className="w-full border rounded-lg p-2 text-sm"
                          value={passwordForm.user_id}
                          onChange={(e) => setPasswordForm({ ...passwordForm, user_id: e.target.value })}
                          required
                        >
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.full_name} ({u.username})
                            </option>
                          ))}
                        </select>
                        <input
                          type="password"
                          className="w-full border rounded-lg p-2 text-sm"
                          placeholder="Mật khẩu mới (tối thiểu 6 ký tự)"
                          value={passwordForm.new_password}
                          onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
                          required
                        />
                        <button type="submit" className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm">
                          Cập nhật mật khẩu
                        </button>
                      </form>

                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!editingPermUserId) return;
                          const res = await fetch(`${API_URL}/api/users/${editingPermUserId}/permissions`, {
                            method: 'PATCH',
                            headers: authHeaders,
                            body: JSON.stringify({ permissions: editingPermList })
                          });
                          const data = await res.json();
                          if (!res.ok) {
                            notify(data.message || 'Cập nhật tính năng thất bại');
                            return;
                          }
                          await loadAll();
                          notify(`Đã cập nhật tính năng cho ${data.username}`);
                        }}
                        className="bg-white p-5 rounded-xl shadow-sm space-y-3"
                      >
                        <h3 className="font-semibold">Cập nhật tính năng cho user có sẵn</h3>
                        <select
                          className="w-full border rounded-lg p-2 text-sm"
                          value={editingPermUserId}
                          onChange={(e) => {
                            const uid = e.target.value;
                            setEditingPermUserId(uid);
                            const found = users.find((u) => String(u.id) === String(uid));
                            setEditingPermList(found ? getEffectivePermissions(found) : []);
                          }}
                        >
                          {users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.full_name} ({u.username})
                            </option>
                          ))}
                        </select>
                        <div className="border rounded-lg p-2.5 space-y-1.5 max-h-40 overflow-y-auto bg-slate-50">
                          {FEATURE_OPTIONS.map((feat) => (
                            <label key={feat.key} className="flex items-center gap-2 text-xs cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editingPermList.includes(feat.key)}
                                onChange={() =>
                                  setEditingPermList((prev) => togglePermissionItem(prev, feat.key))
                                }
                              />
                              <span>{feat.label}</span>
                            </label>
                          ))}
                        </div>
                        <button type="submit" className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm">
                          Lưu tính năng
                        </button>
                      </form>
                    </div>
                  </div>

                  {/* Danh sách tài khoản + Xóa user */}
                  <div className="bg-white p-5 rounded-xl shadow-sm space-y-3">
                    <h3 className="font-semibold">Danh sách tài khoản</h3>
                    {users.map((u) => {
                      const uPerms = getEffectivePermissions(u);
                      const isSelf = Number(u.id) === Number(auth?.user?.id);
                      return (
                        <div
                          key={u.id}
                          className="flex flex-wrap items-center justify-between gap-3 border-b py-3 text-sm"
                        >
                          <div>
                            <div>
                              <strong>{u.full_name}</strong> <span className="text-slate-500">({u.username})</span>
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {uPerms.map((pKey) => {
                                const fObj = FEATURE_OPTIONS.find((f) => f.key === pKey);
                                return (
                                  <span
                                    key={pKey}
                                    className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded"
                                  >
                                    {fObj ? fObj.label.split(' (')[0] : pKey}
                                  </span>
                                );
                              })}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPermUserId(u.id);
                                setEditingPermList(uPerms);
                              }}
                              className="text-xs bg-amber-100 text-amber-800 px-2.5 py-1 rounded"
                            >
                              Sửa quyền
                            </button>
                            <button
                              type="button"
                              disabled={isSelf}
                              onClick={async () => {
                                const res = await fetch(`${API_URL}/api/users/${u.id}`, {
                                  method: 'DELETE',
                                  headers: authHeaders
                                });
                                const data = await res.json();
                                if (!res.ok) {
                                  notify(data.message || 'Xóa user thất bại');
                                  return;
                                }
                                await loadAll();
                                notify(data.message || 'Đã xóa tài khoản');
                              }}
                              className="text-xs bg-red-100 text-red-700 disabled:opacity-40 px-2.5 py-1 rounded"
                            >
                              Xóa
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}