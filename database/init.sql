CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE,
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS branches (
    id SERIAL PRIMARY KEY,
    company_id INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    short_code VARCHAR(30) NOT NULL,
    address TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, short_code)
);

CREATE TABLE IF NOT EXISTS departments (
    id SERIAL PRIMARY KEY,
    branch_id INT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    department_id INT NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    employee_code VARCHAR(50) UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS asset_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    short_code VARCHAR(30) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assets (
    id SERIAL PRIMARY KEY,
    asset_code VARCHAR(100) NOT NULL UNIQUE,
    branch_id INT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
    category_id INT NOT NULL REFERENCES asset_categories(id) ON DELETE RESTRICT,
    sequence_number INT NOT NULL,
    product_name VARCHAR(255),
    product_spec TEXT,
    purchase_date DATE NOT NULL,
    warranty_months INT NOT NULL DEFAULT 12,
    warranty_expiry_date DATE NOT NULL,
    vendor VARCHAR(255) NOT NULL,
    serial_number VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (branch_id, category_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS asset_allocations (
    id SERIAL PRIMARY KEY,
    asset_id INT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    department_id INT NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    employee_id INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    received_date DATE NOT NULL,
    returned_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (
        role IN ('SUPER_ADMIN', 'SECONDARY_ADMIN', 'REPORT_VIEWER', 'PRODUCT_CONTENT_CREATOR')
    ),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO companies (name, code, address)
VALUES ('Công ty TNHH Giải Pháp Công Nghệ Việt', 'VTSOL', '123 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh')
ON CONFLICT DO NOTHING;

INSERT INTO branches (company_id, name, short_code, address)
VALUES
  (1, 'Chi nhánh Hồ Chí Minh', 'HCM', '123 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh'),
  (1, 'Chi nhánh Hà Nội', 'HN', '45 Trần Hưng Đạo, Hoàn Kiếm, Hà Nội')
ON CONFLICT DO NOTHING;

INSERT INTO departments (branch_id, name)
VALUES (1, 'Phòng IT & Hạ tầng'), (1, 'Phòng Hành chính - Nhân sự'), (2, 'Phòng Kinh doanh')
ON CONFLICT DO NOTHING;

INSERT INTO employees (department_id, employee_code, full_name, is_active)
VALUES
  (1, 'NV001', 'Nguyễn Minh Khoa', TRUE),
  (2, 'NV002', 'Trần Thu Hà', TRUE),
  (3, 'NV003', 'Phạm Quốc Bảo', TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO asset_categories (name, short_code)
VALUES ('Laptop', 'LAP'), ('Màn hình', 'MON'), ('Thiết bị văn phòng', 'OFF')
ON CONFLICT DO NOTHING;

INSERT INTO users (username, password_hash, full_name, role)
VALUES
  ('admin', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'Quản trị viên cấp cao', 'SUPER_ADMIN'),
  ('admin2', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'Quản trị viên thứ 2', 'SECONDARY_ADMIN'),
  ('reporter', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'Nhân viên báo cáo', 'REPORT_VIEWER'),
  ('creator', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'Nhân viên tạo nội dung sản phẩm', 'PRODUCT_CONTENT_CREATOR')
ON CONFLICT (username) DO NOTHING;