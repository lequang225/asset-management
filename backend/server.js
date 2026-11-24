const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const pool = require('./db');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const AUTH_SECRET = process.env.AUTH_SECRET || 'local-dev-secret-change-later';

const ALL_FEATURES = [
  'status',
  'create-asset',
  'categories',
  'allocate',
  'company-setup',
  'report',
  'users'
];

const ROLE_DEFAULT_FEATURES = {
  SUPER_ADMIN: ALL_FEATURES,
  SECONDARY_ADMIN: ALL_FEATURES,
  REPORT_VIEWER: ['status', 'report'],
  PRODUCT_CONTENT_CREATOR: ['status', 'create-asset', 'categories']
};

function normalizePermissions(permissions, role) {
  if (Array.isArray(permissions) && permissions.length > 0) {
    return permissions.filter((f) => ALL_FEATURES.includes(f));
  }
  return ROLE_DEFAULT_FEATURES[role] || ['status'];
}

function hashPassword(plain) {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('base64url');
  if (sig !== expected) return null;
  const decoded = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  if (!decoded.exp || decoded.exp < Date.now()) return null;
  return decoded;
}

async function initSchema() {
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS permissions JSONB
  `);
}

function requireAuth(options = {}) {
  const allowedRoles = Array.isArray(options) ? options : options.roles || [];
  const requiredFeatures = Array.isArray(options) ? [] : options.features || [];

  return async (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ message: 'Vui lòng đăng nhập' });
    }

    try {
      const { rows } = await pool.query(
        'SELECT id, username, full_name, role, is_active, permissions FROM users WHERE id = $1',
        [payload.id]
      );
      const dbUser = rows[0];
      if (!dbUser || !dbUser.is_active) {
        return res.status(401).json({ message: 'Tài khoản không tồn tại hoặc đã bị khóa' });
      }

      const effectivePerms = normalizePermissions(dbUser.permissions, dbUser.role);
      const roleMatched = allowedRoles.length === 0 || allowedRoles.includes(dbUser.role);
      const featureMatched =
        requiredFeatures.length === 0 ||
        requiredFeatures.some((feat) => effectivePerms.includes(feat));

      if (!roleMatched && !featureMatched) {
        return res.status(403).json({ message: 'Không có quyền truy cập chức năng này' });
      }

      req.user = {
        ...dbUser,
        permissions: effectivePerms
      };
      next();
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  };
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Đăng nhập
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await pool.query(
    'SELECT id, username, full_name, role, is_active, permissions FROM users WHERE username = $1 AND password_hash = $2',
    [username, hashPassword(password || '')]
  );
  if (!rows[0] || !rows[0].is_active) {
    return res.status(401).json({ message: 'Sai tên đăng nhập hoặc mật khẩu' });
  }
  const perms = normalizePermissions(rows[0].permissions, rows[0].role);
  const token = signToken({
    id: rows[0].id,
    username: rows[0].username,
    role: rows[0].role,
    exp: Date.now() + 24 * 60 * 60 * 1000
  });
  res.json({
    token,
    user: {
      id: rows[0].id,
      username: rows[0].username,
      full_name: rows[0].full_name,
      role: rows[0].role,
      is_active: rows[0].is_active,
      permissions: perms
    }
  });
});

// Lấy thông tin user hiện tại
app.get('/api/auth/me', requireAuth(), async (req, res) => {
  res.json({ user: req.user });
});

// User & phân quyền nhiều tính năng + Xóa user
app.get('/api/users', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['users'] }), async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, username, full_name, role, is_active, permissions, created_at FROM users ORDER BY id ASC'
  );
  const mapped = rows.map((u) => ({
    ...u,
    permissions: normalizePermissions(u.permissions, u.role)
  }));
  res.json(mapped);
});

app.post('/api/users', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['users'] }), async (req, res) => {
  const { username, password, full_name, role, permissions } = req.body;
  const targetRole = role || 'REPORT_VIEWER';
  const perms = normalizePermissions(permissions, targetRole);
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, full_name, role, permissions)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id, username, full_name, role, is_active, permissions`,
    [username, hashPassword(password || 'Admin@123'), full_name, targetRole, JSON.stringify(perms)]
  );
  res.status(201).json({
    ...rows[0],
    permissions: normalizePermissions(rows[0].permissions, rows[0].role)
  });
});

app.patch('/api/users/:id/permissions', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['users'] }), async (req, res) => {
  const targetId = Number(req.params.id);
  const { permissions, role } = req.body;
  const existingRes = await pool.query('SELECT id, role FROM users WHERE id = $1', [targetId]);
  if (!existingRes.rows[0]) {
    return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
  }
  const nextRole = role || existingRes.rows[0].role;
  const perms = normalizePermissions(permissions, nextRole);
  const { rows } = await pool.query(
    `UPDATE users
     SET role = $1, permissions = $2::jsonb
     WHERE id = $3
     RETURNING id, username, full_name, role, is_active, permissions`,
    [nextRole, JSON.stringify(perms), targetId]
  );
  res.json({
    ...rows[0],
    permissions: normalizePermissions(rows[0].permissions, rows[0].role)
  });
});

app.delete('/api/users/:id', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['users'] }), async (req, res) => {
  const targetId = Number(req.params.id);
  if (req.user.id === targetId) {
    return res.status(400).json({ message: 'Không thể xóa tài khoản đang đăng nhập' });
  }
  const targetRes = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [targetId]);
  if (!targetRes.rows[0]) {
    return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
  }
  if (targetRes.rows[0].role === 'SUPER_ADMIN' && req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ message: 'Không có quyền xóa Quản trị viên cấp cao' });
  }
  await pool.query('DELETE FROM users WHERE id = $1', [targetId]);
  res.json({ message: `Đã xóa tài khoản ${targetRes.rows[0].username}` });
});

app.patch('/api/users/:id/password', requireAuth(), async (req, res) => {
  const targetId = Number(req.params.id);
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ message: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
  }
  const isSelf = req.user.id === targetId;
  const isAdminUser =
    req.user.role === 'SUPER_ADMIN' ||
    req.user.role === 'SECONDARY_ADMIN' ||
    (req.user.permissions || []).includes('users');
  if (!isSelf && !isAdminUser) {
    return res.status(403).json({ message: 'Bạn không có quyền đổi mật khẩu cho tài khoản này' });
  }
  const { rows } = await pool.query(
    'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id, username, full_name, role',
    [hashPassword(new_password), targetId]
  );
  if (!rows[0]) return res.status(404).json({ message: 'Không tìm thấy tài khoản' });
  res.json({ message: 'Đã cập nhật mật khẩu thành công', user: rows[0] });
});

// Công ty (Thêm · Sửa · Xóa)
app.get('/api/companies', requireAuth(), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM companies ORDER BY id ASC');
  res.json(rows);
});

app.post('/api/companies', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['company-setup'] }), async (req, res) => {
  const { name, code, address } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO companies (name, code, address) VALUES ($1, $2, $3) RETURNING *',
    [name, code || null, address || null]
  );
  res.status(201).json(rows[0]);
});

app.patch('/api/companies/:id', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['company-setup'] }), async (req, res) => {
  const { name, code, address } = req.body;
  const { rows } = await pool.query(
    'UPDATE companies SET name = $1, code = $2, address = $3 WHERE id = $4 RETURNING *',
    [name, code || null, address || null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ message: 'Không tìm thấy công ty' });
  res.json(rows[0]);
});

app.delete('/api/companies/:id', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['company-setup'] }), async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM companies WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy công ty' });
    res.json({ message: 'Đã xóa công ty' });
  } catch (err) {
    res.status(400).json({ message: 'Không thể xóa công ty đang có dữ liệu liên kết' });
  }
});

// Chi nhánh (Thêm · Sửa · Xóa)
app.get('/api/branches', requireAuth(), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT b.*, c.name AS company_name
    FROM branches b
    JOIN companies c ON b.company_id = c.id
    ORDER BY b.id ASC
  `);
  res.json(rows);
});

app.post('/api/branches', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['company-setup'] }), async (req, res) => {
  const { company_id, name, short_code, address } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO branches (company_id, name, short_code, address) VALUES ($1, $2, $3, $4) RETURNING *',
    [company_id, name, short_code.trim().toUpperCase(), address]
  );
  res.status(201).json(rows[0]);
});

app.patch('/api/branches/:id', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['company-setup'] }), async (req, res) => {
  const { company_id, name, short_code, address } = req.body;
  const { rows } = await pool.query(
    'UPDATE branches SET company_id = $1, name = $2, short_code = $3, address = $4 WHERE id = $5 RETURNING *',
    [company_id, name, short_code.trim().toUpperCase(), address, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ message: 'Không tìm thấy chi nhánh' });
  res.json(rows[0]);
});

app.delete('/api/branches/:id', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['company-setup'] }), async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM branches WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy chi nhánh' });
    res.json({ message: 'Đã xóa chi nhánh' });
  } catch (err) {
    res.status(400).json({ message: 'Không thể xóa chi nhánh đang có phòng ban hoặc tài sản' });
  }
});

// Phòng ban (Thêm · Sửa · Xóa)
app.get('/api/departments', requireAuth(), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT d.*, b.name AS branch_name, b.short_code AS branch_code
    FROM departments d
    JOIN branches b ON d.branch_id = b.id
    ORDER BY d.id ASC
  `);
  res.json(rows);
});

app.post('/api/departments', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['company-setup'] }), async (req, res) => {
  const { branch_id, name } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO departments (branch_id, name) VALUES ($1, $2) RETURNING *',
    [branch_id, name]
  );
  res.status(201).json(rows[0]);
});

app.patch('/api/departments/:id', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['company-setup'] }), async (req, res) => {
  const { branch_id, name } = req.body;
  const { rows } = await pool.query(
    'UPDATE departments SET branch_id = $1, name = $2 WHERE id = $3 RETURNING *',
    [branch_id, name, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ message: 'Không tìm thấy phòng ban' });
  res.json(rows[0]);
});

app.delete('/api/departments/:id', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['company-setup'] }), async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM departments WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy phòng ban' });
    res.json({ message: 'Đã xóa phòng ban' });
  } catch (err) {
    res.status(400).json({ message: 'Không thể xóa phòng ban đang có nhân viên hoặc tài sản' });
  }
});

// Nhân viên (Thêm · Sửa · Xóa)
app.get('/api/employees', requireAuth(), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT e.*, d.name AS department_name, b.name AS branch_name
    FROM employees e
    JOIN departments d ON e.department_id = d.id
    JOIN branches b ON d.branch_id = b.id
    ORDER BY e.id ASC
  `);
  res.json(rows);
});

app.post('/api/employees', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['company-setup'] }), async (req, res) => {
  const { department_id, employee_code, full_name, email, is_active } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO employees (department_id, employee_code, full_name, email, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [
      department_id,
      employee_code || null,
      full_name,
      email || null,
      is_active !== undefined ? Boolean(is_active) : true
    ]
  );
  res.status(201).json(rows[0]);
});

app.patch('/api/employees/:id', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['company-setup'] }), async (req, res) => {
  const { department_id, employee_code, full_name, email, is_active } = req.body;
  const { rows } = await pool.query(
    `UPDATE employees
     SET department_id = $1, employee_code = $2, full_name = $3, email = $4, is_active = $5
     WHERE id = $6 RETURNING *`,
    [
      department_id,
      employee_code || null,
      full_name,
      email || null,
      is_active !== undefined ? Boolean(is_active) : true,
      req.params.id
    ]
  );
  if (!rows[0]) return res.status(404).json({ message: 'Không tìm thấy nhân viên' });
  res.json(rows[0]);
});

app.patch('/api/employees/:id/status', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['company-setup'] }), async (req, res) => {
  const { is_active } = req.body;
  const { rows } = await pool.query(
    'UPDATE employees SET is_active = $1 WHERE id = $2 RETURNING *',
    [Boolean(is_active), req.params.id]
  );
  res.json(rows[0]);
});

app.delete('/api/employees/:id', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['company-setup'] }), async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM employees WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy nhân viên' });
    res.json({ message: 'Đã xóa nhân viên' });
  } catch (err) {
    res.status(400).json({ message: 'Không thể xóa nhân viên đang có lịch sử cấp phát tài sản' });
  }
});

// Loại thiết bị (Thêm · Sửa · Xóa)
app.get('/api/categories', requireAuth(), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM asset_categories ORDER BY id ASC');
  res.json(rows);
});

app.post(
  '/api/categories',
  requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN', 'PRODUCT_CONTENT_CREATOR'], features: ['categories'] }),
  async (req, res) => {
    const { name, short_code } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO asset_categories (name, short_code) VALUES ($1, $2) RETURNING *',
      [name, short_code.trim().toUpperCase()]
    );
    res.status(201).json(rows[0]);
  }
);

app.patch(
  '/api/categories/:id',
  requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN', 'PRODUCT_CONTENT_CREATOR'], features: ['categories'] }),
  async (req, res) => {
    const { name, short_code } = req.body;
    const { rows } = await pool.query(
      'UPDATE asset_categories SET name = $1, short_code = $2 WHERE id = $3 RETURNING *',
      [name, short_code.trim().toUpperCase(), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ message: 'Không tìm thấy loại thiết bị' });
    res.json(rows[0]);
  }
);

app.delete(
  '/api/categories/:id',
  requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN', 'PRODUCT_CONTENT_CREATOR'], features: ['categories'] }),
  async (req, res) => {
    try {
      const { rowCount } = await pool.query('DELETE FROM asset_categories WHERE id = $1', [req.params.id]);
      if (!rowCount) return res.status(404).json({ message: 'Không tìm thấy loại thiết bị' });
      res.json({ message: 'Đã xóa loại thiết bị' });
    } catch (err) {
      res.status(400).json({ message: 'Không thể xóa loại thiết bị đang có tài sản' });
    }
  }
);

// Sinh mã tài sản tự động & quản lý tài sản
app.get('/api/assets/next-code', requireAuth(), async (req, res) => {
  const { branch_id, category_id } = req.query;
  const branchRes = await pool.query('SELECT short_code FROM branches WHERE id = $1', [branch_id]);
  const catRes = await pool.query('SELECT short_code FROM asset_categories WHERE id = $1', [category_id]);
  if (!branchRes.rows[0] || !catRes.rows[0]) {
    return res.status(404).json({ message: 'Không tìm thấy chi nhánh hoặc loại thiết bị' });
  }
  const seqRes = await pool.query(
    'SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq FROM assets WHERE branch_id = $1 AND category_id = $2',
    [branch_id, category_id]
  );
  const nextSeq = seqRes.rows[0].next_seq;
  const assetCode = `${branchRes.rows[0].short_code}-${catRes.rows[0].short_code}-${String(nextSeq).padStart(3, '0')}`;
  res.json({ sequence_number: nextSeq, asset_code: assetCode });
});

app.post(
  '/api/assets',
  requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN', 'PRODUCT_CONTENT_CREATOR'], features: ['create-asset'] }),
  async (req, res) => {
    const {
      branch_id,
      category_id,
      product_name,
      product_spec,
      purchase_date,
      warranty_months,
      warranty_expiry_date,
      vendor,
      serial_number,
      status
    } = req.body;

    if (!branch_id || !category_id) {
      return res.status(400).json({ message: 'Vui lòng chọn chi nhánh và loại thiết bị' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const branchRes = await client.query('SELECT short_code FROM branches WHERE id = $1', [branch_id]);
      const catRes = await client.query('SELECT short_code FROM asset_categories WHERE id = $1', [category_id]);
      if (!branchRes.rows[0] || !catRes.rows[0]) {
        throw new Error('Chi nhánh hoặc loại thiết bị không tồn tại');
      }

      await client.query(
        'SELECT id FROM assets WHERE branch_id = $1 AND category_id = $2 FOR UPDATE',
        [branch_id, category_id]
      );
      const seqRes = await client.query(
        'SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq FROM assets WHERE branch_id = $1 AND category_id = $2',
        [branch_id, category_id]
      );
      const nextSeq = seqRes.rows[0].next_seq;
      const assetCode = `${branchRes.rows[0].short_code}-${catRes.rows[0].short_code}-${String(nextSeq).padStart(3, '0')}`;

      let expiryDate = warranty_expiry_date;
      if (!expiryDate) {
        const d = new Date(purchase_date);
        d.setMonth(d.getMonth() + Number(warranty_months || 0));
        expiryDate = d.toISOString().split('T')[0];
      }

      const { rows } = await client.query(
        `INSERT INTO assets (
          asset_code, branch_id, category_id, sequence_number,
          product_name, product_spec, purchase_date, warranty_months,
          warranty_expiry_date, vendor, serial_number, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          assetCode,
          branch_id,
          category_id,
          nextSeq,
          product_name ? product_name.trim() : null,
          product_spec ? product_spec.trim() : null,
          purchase_date,
          Number(warranty_months || 0),
          expiryDate,
          vendor,
          serial_number ? serial_number.trim() : null,
          status || 'ACTIVE'
        ]
      );
      await client.query('COMMIT');
      res.status(201).json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ message: err.message });
    } finally {
      client.release();
    }
  }
);

app.get('/api/assets', requireAuth(), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      a.*,
      b.name AS branch_name,
      b.short_code AS branch_code,
      b.company_id,
      c.name AS company_name,
      cat.name AS category_name,
      cat.short_code AS category_code,
      alloc.id AS allocation_id,
      alloc.department_id AS current_department_id,
      d.name AS current_department_name,
      alloc.employee_id AS current_employee_id,
      e.employee_code AS current_employee_code,
      e.full_name AS current_employee_name,
      e.is_active AS employee_is_active,
      alloc.received_date,
      alloc.returned_date,
      alloc.notes AS allocation_notes
    FROM assets a
    JOIN branches b ON a.branch_id = b.id
    JOIN companies c ON b.company_id = c.id
    JOIN asset_categories cat ON a.category_id = cat.id
    LEFT JOIN LATERAL (
      SELECT * FROM asset_allocations al WHERE al.asset_id = a.id ORDER BY al.id DESC LIMIT 1
    ) alloc ON TRUE
    LEFT JOIN departments d ON alloc.department_id = d.id
    LEFT JOIN employees e ON alloc.employee_id = e.id
    ORDER BY a.asset_code ASC
  `);
  res.json(rows);
});

app.patch('/api/assets/:id/status', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['status', 'allocate'] }), async (req, res) => {
  const { status } = req.body;
  const { rows } = await pool.query('UPDATE assets SET status = $1 WHERE id = $2 RETURNING *', [status, req.params.id]);
  res.json(rows[0]);
});

// Cấp phát & thu hồi
app.get('/api/allocations', requireAuth(), async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      al.*,
      a.asset_code,
      a.product_name,
      a.product_spec,
      a.serial_number,
      a.status AS asset_status,
      cat.name AS category_name,
      d.name AS department_name,
      e.employee_code,
      e.full_name AS employee_name,
      e.is_active AS employee_is_active
    FROM asset_allocations al
    JOIN assets a ON al.asset_id = a.id
    JOIN asset_categories cat ON a.category_id = cat.id
    JOIN departments d ON al.department_id = d.id
    JOIN employees e ON al.employee_id = e.id
    ORDER BY al.id DESC
  `);
  res.json(rows);
});

app.post('/api/allocations/batch', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['allocate'] }), async (req, res) => {
  const { asset_ids, department_id, employee_id, received_date, returned_date, notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const assetId of asset_ids || []) {
      await client.query(
        `INSERT INTO asset_allocations
          (asset_id, department_id, employee_id, received_date, returned_date, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [assetId, department_id, employee_id, received_date, returned_date || null, notes || null]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ message: 'Cấp phát thành công' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
});

app.patch('/api/allocations/:id', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['allocate'] }), async (req, res) => {
  const { asset_id, department_id, employee_id, received_date, returned_date, notes } = req.body;
  const { rows } = await pool.query(
    `UPDATE asset_allocations
     SET asset_id = COALESCE($1, asset_id),
         department_id = $2,
         employee_id = $3,
         received_date = $4,
         returned_date = $5,
         notes = $6
     WHERE id = $7 RETURNING *`,
    [asset_id || null, department_id, employee_id, received_date, returned_date || null, notes || null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ message: 'Không tìm thấy bản ghi cấp phát' });
  res.json(rows[0]);
});

app.patch('/api/allocations/:id/return', requireAuth({ roles: ['SUPER_ADMIN', 'SECONDARY_ADMIN'], features: ['allocate', 'status'] }), async (req, res) => {
  const { returned_date } = req.body;
  const { rows } = await pool.query(
    'UPDATE asset_allocations SET returned_date = $1 WHERE id = $2 RETURNING *',
    [returned_date || null, req.params.id]
  );
  res.json(rows[0]);
});

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Schema init failed:', err);
    process.exit(1);
  });