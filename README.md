# Hệ Thống Quản Lý Tài Sản

Ứng dụng web quản lý tài sản nội bộ gồm **Frontend (React + Vite)** và **Backend (Node.js/Express)**, hỗ trợ quản lý công ty, chi nhánh, phòng ban, nhân viên, sinh mã tài sản tự động, cấp phát/thu hồi, phân quyền nhiều tính năng và xuất file Excel (`.xlsx`).

---

## Cấu Trúc Thư Mục

```text
asset-management/
├── backend/
│   ├── server.js
│   ├── db.js
│   ├── package.json
│   └── .env
└── frontend/
    ├── src/
    │   └── App.jsx
    ├── package.json
    └── .env
    
Cách Triển Khai Trên 3 Hệ Điều Hành
1. Linux (Ubuntu)
Mở 2 terminal để chạy riêng Backend và Frontend:

# Terminal 1 - Backend
cd ~/asset-management/backend
npm install
npm start

# Terminal 2 - Frontend
cd ~/asset-management/frontend
npm install
npm run dev

2. macOS
Cài Node.js nếu chưa có (brew install node), sau đó mở 2 cửa sổ Terminal:

# Terminal 1 - Backend
cd ~/asset-management/backend
npm install
npm start

# Terminal 2 - Frontend
cd ~/asset-management/frontend
npm install
npm run dev

3. Windows
Cài Node.js LTS từ nodejs.org, sau đó mở 2 cửa sổ PowerShell:

# PowerShell 1 - Backend
cd $HOME\asset-management\backend
npm install
npm start

# PowerShell 2 - Frontend
cd $HOME\asset-management\frontend
npm install
npm run dev

Truy Cập Ứng Dụng
Backend: http://localhost:4000/health

Frontend: http://localhost:5173
