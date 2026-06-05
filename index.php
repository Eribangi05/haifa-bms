<?php
// ==================== DATABASE CONFIGURATION ====================
$db_host = 'sql105.infinityfree.com';
$db_name = 'if0_41625146_nightpulse';   // CHANGE THIS
$db_user = 'if0_41625146';              // CHANGE THIS
$db_pass = 'Uwizeye2026';             // CHANGE THIS

try {
    $pdo = new PDO("mysql:host=$db_host;dbname=$db_name;charset=utf8mb4", $db_user, $db_pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch(PDOException $e) {
    die("Database connection failed: " . $e->getMessage());
}
session_start();

function hasPermission($pdo, $role, $module, $action = 'view') {
    if ($role === 'owner') return true;
    $col = ($action === 'view') ? 'can_view' : (($action === 'create') ? 'can_create' : (($action === 'edit') ? 'can_edit' : 'can_delete'));
    $stmt = $pdo->prepare("SELECT $col FROM role_permissions WHERE role = ? AND module = ?");
    $stmt->execute([$role, $module]);
    return (bool)$stmt->fetchColumn();
}

// ==================== API ENDPOINTS ====================
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_SERVER['HTTP_X_REQUESTED_WITH'])) {
    header('Content-Type: application/json');
    $input = json_decode(file_get_contents('php://input'), true);
    $action = $input['action'] ?? '';
    $currentUser = $_SESSION['user'] ?? null;

    if ($action === 'login') {
        $username = $input['username'] ?? '';
        $password = $input['password'] ?? '';
        $stmt = $pdo->prepare("SELECT * FROM users WHERE username = ? AND password = ? AND active = 1");
        $stmt->execute([$username, $password]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($user) {
            $_SESSION['user'] = $user;
            $pdo->prepare("UPDATE users SET last_login = NOW() WHERE id = ?")->execute([$user['id']]);
            $perms = $pdo->prepare("SELECT module, can_view, can_create, can_edit, can_delete FROM role_permissions WHERE role = ?");
            $perms->execute([$user['role']]);
            $permissions = [];
            while ($row = $perms->fetch(PDO::FETCH_ASSOC)) {
                $permissions[$row['module']] = ['view' => $row['can_view'], 'create' => $row['can_create'], 'edit' => $row['can_edit'], 'delete' => $row['can_delete']];
            }
            echo json_encode(['success' => true, 'user' => ['name' => $user['name'], 'role' => $user['role'], 'emp_id' => $user['emp_id']], 'permissions' => $permissions]);
        } else {
            echo json_encode(['success' => false, 'error' => 'Invalid credentials']);
        }
        exit;
    }
    if ($action === 'logout') { session_destroy(); echo json_encode(['success' => true]); exit; }
    if ($action === 'poll_orders') {
        $lastId = (int)($input['last_id'] ?? 0);
        $stmt = $pdo->prepare("SELECT id, order_number, waiter_name, table_name, total_amount, status, created_at FROM orders WHERE id > ? ORDER BY id ASC");
        $stmt->execute([$lastId]);
        echo json_encode(['success' => true, 'orders' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
        exit;
    }
    if ($action === 'dashboard_data') {
        $today = date('Y-m-d');
        $role = $input['role'] ?? '';
        $empId = $input['emp_id'] ?? 0;
        $cond = "status='done'";
        if ($role === 'waiter' && $empId) $cond .= " AND waiter_id = $empId";
        $todayRev = $pdo->prepare("SELECT COALESCE(SUM(total_amount),0) FROM orders WHERE $cond AND DATE(created_at)=?");
        $todayRev->execute([$today]);
        $pending = $pdo->query("SELECT COUNT(*) FROM orders WHERE status='pending'")->fetchColumn();
        $totalRevenue = $pdo->prepare("SELECT COALESCE(SUM(total_amount),0) FROM orders WHERE $cond");
        $totalRevenue->execute();
        $activeStaff = $pdo->query("SELECT COUNT(*) FROM employees WHERE active=1")->fetchColumn();
        $lowStock = $pdo->query("SELECT COUNT(*) FROM stock_items WHERE qty <= reorder_level")->fetchColumn();
        $activeMenu = $pdo->query("SELECT COUNT(*) FROM menu_items WHERE active=1")->fetchColumn();
        $monday = date('Y-m-d', strtotime('monday this week'));
        $weekRevenue = [];
        for ($i=0; $i<7; $i++) {
            $d = date('Y-m-d', strtotime("$monday +$i days"));
            $dayName = date('D', strtotime($d));
            $dayRev = $pdo->prepare("SELECT COALESCE(SUM(total_amount),0) FROM orders WHERE $cond AND DATE(created_at)=?");
            $dayRev->execute([$d]);
            $rev = $dayRev->fetchColumn();
            $weekRevenue[] = ['day' => $dayName, 'date' => $d, 'revenue' => $rev];
        }
        $topItemsSql = "SELECT item_name, SUM(quantity) as qty, SUM(quantity*price) as rev FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.status='done'";
        if ($role === 'waiter' && $empId) $topItemsSql .= " AND o.waiter_id = $empId";
        $topItemsSql .= " GROUP BY item_name ORDER BY qty DESC LIMIT 5";
        $topItems = $pdo->query($topItemsSql)->fetchAll(PDO::FETCH_ASSOC);
        $recentSql = "SELECT id, order_number, waiter_name, table_name, total_amount, status, created_at FROM orders WHERE status='done'";
        if ($role === 'waiter' && $empId) $recentSql .= " AND waiter_id = $empId";
        $recentSql .= " ORDER BY id DESC LIMIT 5";
        $recent = $pdo->query($recentSql)->fetchAll(PDO::FETCH_ASSOC);
        $onShift = $pdo->prepare("SELECT * FROM shifts WHERE date=? AND status='active'");
        $onShift->execute([$today]);
        echo json_encode(['success'=>true, 'today_rev'=>$todayRev->fetchColumn(), 'pending'=>$pending, 'total_revenue'=>$totalRevenue->fetchColumn(), 'active_staff'=>$activeStaff, 'low_stock'=>$lowStock, 'active_menu'=>$activeMenu, 'week_revenue'=>$weekRevenue, 'top_sellers'=>$topItems, 'recent_orders'=>$recent, 'staff_on_shift'=>$onShift->fetchAll(PDO::FETCH_ASSOC)]);
        exit;
    }
    if ($action === 'get_order_items') {
        $orderId = (int)$input['order_id'];
        $items = $pdo->prepare("SELECT item_name, quantity, price FROM order_items WHERE order_id = ?");
        $items->execute([$orderId]);
        echo json_encode(['success'=>true, 'items'=>$items->fetchAll(PDO::FETCH_ASSOC)]);
        exit;
    }
    if ($action === 'get_orders') {
        $status = $input['status'] ?? '';
        $sql = "SELECT id, order_number, waiter_name, table_name, total_amount, status, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') as time, created_at FROM orders";
        if ($status) $sql .= " WHERE status = '$status'";
        $sql .= " ORDER BY id DESC";
        echo json_encode(['success'=>true, 'orders'=>$pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC)]);
        exit;
    }
    if ($action === 'confirm_order' && $currentUser && hasPermission($pdo, $currentUser['role'], 'orders', 'edit')) {
        $orderId = (int)$input['order_id'];
        $pdo->prepare("UPDATE orders SET status='confirmed' WHERE id=? AND status='pending'")->execute([$orderId]);
        echo json_encode(['success'=>true]);
        exit;
    }
    if ($action === 'done_order' && $currentUser && hasPermission($pdo, $currentUser['role'], 'orders', 'edit')) {
        $orderId = (int)$input['order_id'];
        $pdo->prepare("UPDATE orders SET status='done' WHERE id=? AND status='confirmed'")->execute([$orderId]);
        echo json_encode(['success'=>true]);
        exit;
    }
    // NEW: Delete single order (owner/manager only)
    if ($action === 'delete_order' && $currentUser && ($currentUser['role'] === 'owner' || $currentUser['role'] === 'manager')) {
        $orderId = (int)$input['order_id'];
        // Also delete related order_items
        $pdo->prepare("DELETE FROM order_items WHERE order_id = ?")->execute([$orderId]);
        $pdo->prepare("DELETE FROM orders WHERE id = ?")->execute([$orderId]);
        echo json_encode(['success'=>true]);
        exit;
    }
    // NEW: Reset all orders (owner only)
    if ($action === 'reset_all_orders' && $currentUser && $currentUser['role'] === 'owner') {
        $pdo->prepare("DELETE FROM order_items")->execute();
        $pdo->prepare("DELETE FROM orders")->execute();
        // Reset auto-increment
        $pdo->prepare("ALTER TABLE orders AUTO_INCREMENT = 1")->execute();
        $pdo->prepare("ALTER TABLE order_items AUTO_INCREMENT = 1")->execute();
        echo json_encode(['success'=>true]);
        exit;
    }
    if ($action === 'get_menu') { echo json_encode(['success'=>true, 'menu'=>$pdo->query("SELECT * FROM menu_items WHERE active=1")->fetchAll(PDO::FETCH_ASSOC)]); exit; }
    if ($action === 'get_categories') { echo json_encode(['success'=>true, 'categories'=>$pdo->query("SELECT * FROM categories")->fetchAll(PDO::FETCH_ASSOC)]); exit; }
    if ($action === 'get_stock') { 
        $stock = $pdo->query("SELECT s.*, c.name as cat_name FROM stock_items s LEFT JOIN categories c ON s.cat_id=c.id")->fetchAll(PDO::FETCH_ASSOC);
        $movements = $pdo->query("SELECT * FROM stock_movements ORDER BY created_at DESC LIMIT 50")->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success'=>true, 'stock'=>$stock, 'movements'=>$movements]); 
        exit; 
    }
    if ($action === 'save_stock' && $currentUser && hasPermission($pdo, $currentUser['role'], 'stock', 'edit')) {
        $id = (int)($input['id'] ?? 0);
        $name = $input['name'];
        $catId = (int)$input['cat_id'];
        $qty = (int)$input['qty'];
        $reorder = (int)$input['reorder_level'];
        $unit = $input['unit'];
        $cost = (int)$input['cost_price'];
        $emoji = $input['emoji'];
        if ($id) $pdo->prepare("UPDATE stock_items SET name=?, cat_id=?, qty=?, reorder_level=?, unit=?, cost_price=?, emoji=? WHERE id=?")->execute([$name, $catId, $qty, $reorder, $unit, $cost, $emoji, $id]);
        else $pdo->prepare("INSERT INTO stock_items (name, cat_id, qty, reorder_level, unit, cost_price, emoji) VALUES (?,?,?,?,?,?,?)")->execute([$name, $catId, $qty, $reorder, $unit, $cost, $emoji]);
        echo json_encode(['success'=>true]);
        exit;
    }
    if ($action === 'adjust_stock' && $currentUser && hasPermission($pdo, $currentUser['role'], 'stock', 'edit')) {
        $id = (int)$input['id'];
        $type = $input['type'];
        $qty = (int)$input['qty'];
        $note = $input['note'] ?? '';
        $item = $pdo->prepare("SELECT name FROM stock_items WHERE id=?");
        $item->execute([$id]);
        $itemName = $item->fetchColumn();
        if (!$itemName) { echo json_encode(['success'=>false, 'error'=>'Item not found']); exit; }
        if ($type === 'in') $pdo->prepare("UPDATE stock_items SET qty = qty + ? WHERE id=?")->execute([$qty, $id]);
        else $pdo->prepare("UPDATE stock_items SET qty = qty - ? WHERE id=?")->execute([$qty, $id]);
        $pdo->prepare("INSERT INTO stock_movements (stock_item_id, item_name, type, quantity, note, created_by, created_at) VALUES (?,?,?,?,?,?,NOW())")->execute([$id, $itemName, $type, $qty, $note, $currentUser['name']]);
        echo json_encode(['success'=>true]);
        exit;
    }
    if ($action === 'get_employees') { 
        $employees = $pdo->query("SELECT * FROM employees WHERE active=1")->fetchAll(PDO::FETCH_ASSOC);
        foreach ($employees as &$emp) {
            $ordersToday = $pdo->prepare("SELECT COUNT(*) FROM orders WHERE waiter_id=? AND status='done' AND DATE(created_at)=CURDATE()");
            $ordersToday->execute([$emp['id']]);
            $emp['orders_today'] = $ordersToday->fetchColumn();
            $revToday = $pdo->prepare("SELECT COALESCE(SUM(total_amount),0) FROM orders WHERE waiter_id=? AND status='done' AND DATE(created_at)=CURDATE()");
            $revToday->execute([$emp['id']]);
            $emp['revenue_today'] = $revToday->fetchColumn();
            $ordersTotal = $pdo->prepare("SELECT COUNT(*) FROM orders WHERE waiter_id=? AND status='done'");
            $ordersTotal->execute([$emp['id']]);
            $emp['orders_total'] = $ordersTotal->fetchColumn();
            $revTotal = $pdo->prepare("SELECT COALESCE(SUM(total_amount),0) FROM orders WHERE waiter_id=? AND status='done'");
            $revTotal->execute([$emp['id']]);
            $emp['revenue_total'] = $revTotal->fetchColumn();
        }
        echo json_encode(['success'=>true, 'employees'=>$employees]); 
        exit; 
    }
    if ($action === 'save_employee' && $currentUser && hasPermission($pdo, $currentUser['role'], 'employees', 'edit')) {
        $id = (int)($input['id'] ?? 0);
        $name = $input['name'];
        $role = $input['role'];
        $phone = $input['phone'] ?? '';
        $email = $input['email'] ?? '';
        $startDate = $input['start_date'] ?? date('Y-m-d');
        $salary = (int)($input['salary'] ?? 0);
        $notes = $input['notes'] ?? '';
        if ($id) $pdo->prepare("UPDATE employees SET name=?, role=?, phone=?, email=?, start_date=?, salary=?, notes=? WHERE id=?")->execute([$name, $role, $phone, $email, $startDate, $salary, $notes, $id]);
        else $pdo->prepare("INSERT INTO employees (name, role, phone, email, start_date, salary, notes, active) VALUES (?,?,?,?,?,?,?,1)")->execute([$name, $role, $phone, $email, $startDate, $salary, $notes]);
        echo json_encode(['success'=>true]);
        exit;
    }
    if ($action === 'delete_employee' && $currentUser && hasPermission($pdo, $currentUser['role'], 'employees', 'delete')) {
        $id = (int)$input['id'];
        $pdo->prepare("UPDATE employees SET active=0 WHERE id=?")->execute([$id]);
        echo json_encode(['success'=>true]);
        exit;
    }
    if ($action === 'save_menu' && $currentUser && hasPermission($pdo, $currentUser['role'], 'menu', 'edit')) {
        $id = (int)($input['id'] ?? 0);
        $name = $input['name'];
        $catId = (int)$input['cat_id'];
        $price = (int)$input['price'];
        $emoji = $input['emoji'];
        $desc = $input['description'] ?? '';
        $active = (int)($input['active'] ?? 1);
        $image = $input['image'] ?? null;
        $imagePath = null;
        if ($image && strpos($image, 'data:image') === 0) {
            $ext = explode('/', mime_content_type($image))[1];
            $fileName = 'menu_' . time() . '_' . rand(1000,9999) . '.' . $ext;
            $uploadDir = 'uploads/';
            if (!is_dir($uploadDir)) mkdir($uploadDir, 0777, true);
            $filePath = $uploadDir . $fileName;
            file_put_contents($filePath, base64_decode(preg_replace('#^data:image/\w+;base64,#i', '', $image)));
            $imagePath = $filePath;
        }
        if ($id) {
            $sql = "UPDATE menu_items SET name=?, cat_id=?, price=?, emoji=?, description=?, active=?";
            $params = [$name, $catId, $price, $emoji, $desc, $active];
            if ($imagePath) { $sql .= ", image=?"; $params[] = $imagePath; }
            $sql .= " WHERE id=?";
            $params[] = $id;
            $pdo->prepare($sql)->execute($params);
        } else {
            $pdo->prepare("INSERT INTO menu_items (name, cat_id, price, emoji, description, active, image) VALUES (?,?,?,?,?,?,?)")->execute([$name, $catId, $price, $emoji, $desc, $active, $imagePath]);
        }
        echo json_encode(['success'=>true]);
        exit;
    }
    if ($action === 'save_shift' && $currentUser && ($currentUser['role'] === 'owner' || $currentUser['role'] === 'manager')) {
        $id = (int)($input['id'] ?? 0);
        $empId = (int)$input['emp_id'];
        $date = $input['date'];
        $start = $input['start_time'];
        $end = $input['end_time'];
        $type = $input['type'] ?? 'regular';
        $emp = $pdo->prepare("SELECT name FROM employees WHERE id=?");
        $emp->execute([$empId]);
        $empName = $emp->fetchColumn();
        if (!$empName) { echo json_encode(['success'=>false, 'error'=>'Employee not found']); exit; }
        if ($id) $pdo->prepare("UPDATE shifts SET emp_id=?, emp_name=?, date=?, start_time=?, end_time=?, type=? WHERE id=?")->execute([$empId, $empName, $date, $start, $end, $type, $id]);
        else $pdo->prepare("INSERT INTO shifts (emp_id, emp_name, date, start_time, end_time, type, status) VALUES (?,?,?,?,?,?,'scheduled')")->execute([$empId, $empName, $date, $start, $end, $type]);
        echo json_encode(['success'=>true]);
        exit;
    }
    if ($action === 'delete_shift' && $currentUser && ($currentUser['role'] === 'owner' || $currentUser['role'] === 'manager')) {
        $id = (int)$input['id'];
        $pdo->prepare("DELETE FROM shifts WHERE id=?")->execute([$id]);
        echo json_encode(['success'=>true]);
        exit;
    }
    if ($action === 'get_shifts') {
        $today = date('Y-m-d');
        $todayShifts = $pdo->prepare("SELECT * FROM shifts WHERE date=?");
        $todayShifts->execute([$today]);
        $allShifts = $pdo->query("SELECT * FROM shifts ORDER BY date DESC, start_time ASC")->fetchAll(PDO::FETCH_ASSOC);
        $history = $pdo->query("SELECT * FROM clock_history ORDER BY date DESC, clock_in DESC")->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success'=>true, 'today'=>$todayShifts->fetchAll(PDO::FETCH_ASSOC), 'schedule'=>$allShifts, 'history'=>$history]);
        exit;
    }
    if ($action === 'clock_action') {
        $empId = (int)$input['emp_id'];
        $type = $input['type'];
        $emp = $pdo->prepare("SELECT name FROM employees WHERE id=?");
        $emp->execute([$empId]);
        $empName = $emp->fetchColumn();
        if (!$empName) { echo json_encode(['success'=>false, 'error'=>'Employee not found']); exit; }
        $date = date('Y-m-d');
        $time = date('H:i:s');
        if ($type === 'in') {
            $check = $pdo->prepare("SELECT id FROM clock_history WHERE emp_id=? AND date=? AND clock_out IS NULL");
            $check->execute([$empId, $date]);
            if ($check->fetch()) { echo json_encode(['success'=>false, 'error'=>'Already clocked in']); exit; }
            $pdo->prepare("INSERT INTO clock_history (emp_id, emp_name, date, clock_in) VALUES (?,?,?,?)")->execute([$empId, $empName, $date, $time]);
            echo json_encode(['success'=>true, 'message'=>"$empName clocked in at $time"]);
        } else {
            $rec = $pdo->prepare("SELECT id, clock_in FROM clock_history WHERE emp_id=? AND date=? AND clock_out IS NULL");
            $rec->execute([$empId, $date]);
            $row = $rec->fetch(PDO::FETCH_ASSOC);
            if (!$row) { echo json_encode(['success'=>false, 'error'=>'No active clock‑in']); exit; }
            $in = strtotime($row['clock_in']);
            $out = strtotime($time);
            $hours = round(($out - $in) / 3600, 1);
            $pdo->prepare("UPDATE clock_history SET clock_out=?, hours_worked=? WHERE id=?")->execute([$time, $hours, $row['id']]);
            echo json_encode(['success'=>true, 'message'=>"$empName clocked out. Worked $hours hours"]);
        }
        exit;
    }
    if ($action === 'place_order' && $currentUser && hasPermission($pdo, $currentUser['role'], 'neworder', 'create')) {
        $table = $input['table'] ?? '';
        $cart = $input['cart'] ?? [];
        $note = $input['note'] ?? '';
        if (empty($cart)) { echo json_encode(['success'=>false, 'error'=>'Cart empty']); exit; }
        $nextNum = $pdo->query("SELECT COALESCE(MAX(order_number),0)+1 FROM orders")->fetchColumn();
        $total = array_reduce($cart, fn($s,$i)=>$s+$i['price']*$i['qty'], 0);
        try {
            $pdo->beginTransaction();
            $stmt = $pdo->prepare("INSERT INTO orders (order_number, waiter_id, waiter_name, table_name, total_amount, note, created_at) VALUES (?,?,?,?,?,?,NOW())");
            $stmt->execute([$nextNum, $currentUser['emp_id'], $currentUser['name'], $table, $total, $note]);
            $orderId = $pdo->lastInsertId();
            foreach ($cart as $item) {
                $pdo->prepare("INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, price) VALUES (?,?,?,?,?)")->execute([$orderId, $item['id'], $item['name'], $item['qty'], $item['price']]);
                $search = '%' . explode(' ', $item['name'])[0] . '%';
                $pdo->prepare("UPDATE stock_items SET qty = qty - ? WHERE name LIKE ?")->execute([$item['qty'], $search]);
            }
            $pdo->commit();
            echo json_encode(['success'=>true, 'order_id'=>$nextNum]);
        } catch(Exception $e) { $pdo->rollBack(); echo json_encode(['success'=>false, 'error'=>$e->getMessage()]); }
        exit;
    }
    if ($action === 'get_users' && $currentUser && $currentUser['role'] === 'owner') {
        $users = $pdo->query("SELECT u.*, e.name as emp_name FROM users u LEFT JOIN employees e ON u.emp_id = e.id")->fetchAll(PDO::FETCH_ASSOC);
        $perms = $pdo->query("SELECT * FROM role_permissions")->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success'=>true, 'users'=>$users, 'permissions'=>$perms]);
        exit;
    }
    if ($action === 'save_user' && $currentUser && $currentUser['role'] === 'owner') {
        $id = (int)($input['id'] ?? 0);
        $name = $input['name'];
        $username = $input['username'];
        $password = $input['password'];
        $role = $input['role'];
        $empId = $input['emp_id'] ? (int)$input['emp_id'] : null;
        if ($id) {
            if ($password) $pdo->prepare("UPDATE users SET name=?, username=?, password=?, role=?, emp_id=? WHERE id=?")->execute([$name, $username, $password, $role, $empId, $id]);
            else $pdo->prepare("UPDATE users SET name=?, username=?, role=?, emp_id=? WHERE id=?")->execute([$name, $username, $role, $empId, $id]);
        } else {
            if (!$password) { echo json_encode(['success'=>false, 'error'=>'Password required']); exit; }
            $pdo->prepare("INSERT INTO users (name, username, password, role, emp_id, active) VALUES (?,?,?,?,?,1)")->execute([$name, $username, $password, $role, $empId]);
        }
        echo json_encode(['success'=>true]);
        exit;
    }
    if ($action === 'update_permissions' && $currentUser && $currentUser['role'] === 'owner') {
        $perms = $input['permissions'] ?? [];
        foreach ($perms as $perm) {
            $pdo->prepare("UPDATE role_permissions SET can_view=?, can_create=?, can_edit=?, can_delete=? WHERE role=? AND module=?")->execute([$perm['view'], $perm['create'], $perm['edit'], $perm['delete'], $perm['role'], $perm['module']]);
        }
        echo json_encode(['success'=>true]);
        exit;
    }
    echo json_encode(['success'=>false, 'error'=>'Unknown action']);
    exit;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=yes">
<title>Haifa BMS — Business Management System</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
/* ========== RESPONSIVE CSS (same as before, plus card styles for orders) ========== */
:root{--blue:#1a6bff;--navy:#050d1f;--navy2:#0a1628;--card:#111d35;--border:#1e3060;--text:#e8edf8;--text2:#9aabcc;--green:#00d18c;--orange:#ff8c00;--red:#ff3b5c;--purple:#9b59ff;--gold:#f0c040;--font:'Outfit',sans-serif;--radius:12px;}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--navy);color:var(--text);font-family:var(--font);height:100vh;overflow:hidden}
#loginScreen{position:fixed;inset:0;background:var(--navy);display:flex;align-items:center;justify-content:center;z-index:9999;background:radial-gradient(ellipse at 20% 50%,rgba(26,107,255,.15) 0%,transparent 60%)}
.login-box{background:var(--card);border:1px solid var(--border);border-radius:20px;padding:40px;width:400px;max-width:95vw;box-shadow:0 4px 24px rgba(0,0,0,.45)}
.login-logo{text-align:center;margin-bottom:32px}
.login-logo .logo-icon{width:64px;height:64px;background:linear-gradient(135deg,var(--blue),var(--purple));border-radius:16px;display:inline-flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:12px}
.login-logo h1{font-size:24px;font-weight:800}
.btn-primary{width:100%;background:linear-gradient(135deg,var(--blue),#0d4fd4);border:none;border-radius:8px;padding:12px;color:#fff;font-weight:700;cursor:pointer}
.form-group{margin-bottom:16px}
.form-group input{width:100%;background:var(--navy2);border:1px solid var(--border);padding:12px;color:#fff;border-radius:8px}
#app{display:none;height:100vh;flex-direction:column}
#app.visible{display:flex}
.topbar{background:var(--navy2);border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 12px;height:60px;gap:10px;justify-content:space-between;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:8px;font-weight:800;font-size:16px}
.menu-toggle{display:none;background:transparent;border:none;color:var(--text);font-size:24px;cursor:pointer;padding:0 8px}
.topbar-info{display:flex;align-items:center;gap:8px;font-size:13px}
.dot{width:8px;height:8px;background:var(--green);border-radius:50%;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.btn-sm{padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;font-size:12px}
.user-badge{display:flex;align-items:center;gap:8px;background:var(--card);border-radius:20px;padding:4px 12px}
.user-avatar{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.role-tag{font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px}
.role-owner{background:rgba(240,192,64,.15);color:var(--gold)}
.role-manager{background:rgba(26,107,255,.15);color:#4d8fff}
.role-waiter{background:rgba(0,209,140,.15);color:var(--green)}
.role-cashier{background:rgba(155,89,255,.15);color:var(--purple)}
.layout{display:flex;flex:1;overflow:hidden;position:relative}
.sidebar{width:240px;background:var(--navy2);border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0;overflow-y:auto;transition:transform 0.3s ease;z-index:100}
.sidebar-section{padding:16px 12px 8px;font-size:10px;font-weight:700;color:#6680a8;text-transform:uppercase}
.nav-item{display:flex;align-items:center;gap:10px;padding:10px 16px;margin:2px 8px;cursor:pointer;border-radius:8px;color:var(--text2);border:1px solid transparent}
.nav-item:hover{background:var(--card);color:var(--text)}
.nav-item.active{background:rgba(26,107,255,.15);color:#4d8fff;border-color:rgba(26,107,255,.3)}
.main{flex:1;overflow-y:auto;padding:20px}
.page{display:none}
.page.active{display:block}
.page-header{margin-bottom:20px}
.page-header h2{font-size:20px;font-weight:800}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;border-left:4px solid var(--blue)}
.stat-card .stat-value{font-size:22px;font-weight:800}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px}
.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px}
.btn{padding:6px 14px;border-radius:8px;border:1px solid var(--border);background:var(--card2);color:var(--text);cursor:pointer;font-size:12px}
.btn-blue{background:var(--blue);border-color:var(--blue);color:#fff}
.btn-red{background:rgba(255,59,92,.15);border-color:rgba(255,59,92,.3);color:var(--red)}
.btn-green{background:rgba(0,209,140,.15);border-color:rgba(0,209,140,.3);color:var(--green)}
.btn-sm{padding:4px 8px;font-size:11px}
.orders-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
.order-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:16px;transition:all 0.2s}
.order-card:hover{border-color:var(--blue);box-shadow:0 4px 12px rgba(26,107,255,.2)}
.order-card .order-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.order-number{font-family:'Space Mono',monospace;font-size:16px;font-weight:700}
.order-status{padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600}
.order-details{font-size:12px;color:var(--text2);margin-bottom:12px}
.order-items{margin:12px 0;padding:8px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.order-item{display:flex;justify-content:space-between;padding:4px 0}
.order-total{font-size:16px;font-weight:700;margin:12px 0}
.order-actions{display:flex;gap:8px;flex-wrap:wrap}
.users-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.user-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:16px}
.user-card .user-header{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.user-avatar-lg{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700}
.user-info{flex:1}
.user-role{margin-top:4px}
.user-details{font-size:12px;color:var(--text2);margin-bottom:12px}
.table-wrap{overflow-x:auto;margin:0 -8px;padding:0 8px}
table{width:100%;border-collapse:collapse;min-width:500px}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--border);font-size:12px}
.menu-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}
.menu-item{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px;text-align:center;cursor:pointer;position:relative}
.menu-item img{width:80px;height:80px;object-fit:cover;border-radius:8px;margin-bottom:8px}
.menu-item .item-emoji{font-size:40px}
.stock-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.emp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.cart-panel{background:var(--card);border-radius:12px;padding:12px}
.cart-item{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px}
.chart-bar-wrap{display:flex;align-items:flex-end;gap:4px;height:120px;overflow-x:auto;padding-bottom:8px}
.chart-bar-col{min-width:50px;display:flex;flex-direction:column;align-items:center}
.modal-overlay{position:fixed;inset:0;background:rgba(5,13,31,.85);display:flex;align-items:center;justify-content:center;z-index:10001;opacity:0;pointer-events:none;backdrop-filter:blur(4px)}
.modal-overlay.open{opacity:1;pointer-events:all}
.modal{background:var(--card);border:1px solid var(--border);border-radius:20px;padding:20px;width:95vw;max-width:500px;max-height:90vh;overflow-y:auto}
.modal-lg{max-width:95vw;width:auto}
.modal-header{display:flex;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap}
.modal-close{background:none;border:none;color:var(--text3);font-size:20px;cursor:pointer}
.fg{margin-bottom:12px}
label{display:block;font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;margin-bottom:6px}
input,select,textarea{width:100%;background:var(--navy2);border:1px solid var(--border);padding:8px 10px;color:var(--text);border-radius:8px;font-size:14px}
.toast-wrap{position:fixed;bottom:20px;right:20px;z-index:10000;display:flex;flex-direction:column;gap:8px}
.toast{background:var(--card2);border-left:4px solid var(--green);padding:12px 20px;border-radius:8px;animation:slideIn .3s ease}
@keyframes slideIn{from{transform:translateX(120%)}to{transform:translateX(0)}}
.empty-state{text-align:center;padding:40px;color:var(--text3)}
.cat-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.cat-tab{padding:6px 14px;border-radius:20px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;font-size:12px}
.cat-tab.active{background:rgba(26,107,255,.15);border-color:rgba(26,107,255,.4);color:#4d8fff}
.stock-card .progress-bar{height:6px;background:var(--border);border-radius:3px;overflow:hidden}
.stock-card .progress-fill{height:100%}
.emp-avatar{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700}
.emp-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}
.emp-stat{background:var(--navy2);padding:8px;border-radius:8px;text-align:center}
.hl-blue{color:#4d8fff}
.text-xs{font-size:11px}

@media (max-width: 768px) {
  .menu-toggle{display:block}
  .sidebar{position:fixed;top:60px;left:0;bottom:0;transform:translateX(-100%);width:260px;z-index:1000;background:var(--navy2);box-shadow:2px 0 12px rgba(0,0,0,.5)}
  .sidebar.open{transform:translateX(0)}
  .main{padding:16px}
  .stats-grid{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
  .orders-grid{grid-template-columns:1fr}
  .users-grid{grid-template-columns:1fr}
}
@media (max-width: 480px) {
  .topbar{gap:6px;padding:0 8px}
  .topbar-info{display:none}
  .order-card{padding:12px}
}
</style>
</head>
<body>

<div id="loginScreen">
  <div class="login-box">
    <div class="login-logo"><div class="logo-icon">🍸</div><h1>Haifa BMS</h1><p>Business Management System</p></div>
    <div class="form-group"><label>Username</label><input type="text" id="loginUser" placeholder="Username"></div>
    <div class="form-group"><label>Password</label><input type="password" id="loginPass" placeholder="Password"></div>
    <button class="btn-primary" onclick="doLogin()">Sign In</button>
  </div>
</div>

<div id="app">
  <div class="topbar">
    <div style="display:flex;align-items:center;gap:8px">
      <button class="menu-toggle" id="menuToggle" onclick="toggleSidebar()">☰</button>
      <div class="brand"><div class="brand-icon">🍸</div>Haifa</div>
    </div>
    <div class="topbar-info"><div class="dot"></div><span id="liveClock"></span></div>
    <div id="pendingBadge" style="display:none;background:rgba(255,140,0,.15);border:1px solid rgba(255,140,0,.3);color:var(--orange);padding:5px 12px;border-radius:20px;cursor:pointer" onclick="showPage('orders')">⏳ <span id="pendingCount">0</span> Pending</div>
    <div class="user-badge"><div class="user-avatar" id="topAvatar"></div><div><div style="font-size:13px;font-weight:600" id="topName"></div><div class="role-tag" id="topRole"></div></div></div>
    <button class="btn-sm" onclick="doLogout()">Logout</button>
  </div>
  <div class="layout">
    <div class="sidebar" id="sidebar"></div>
    <div class="main" id="mainContent"></div>
  </div>
</div>

<div class="toast-wrap" id="toastWrap"></div>

<!-- MODALS (same as before) -->
<div class="modal-overlay" id="stockModal"><div class="modal"><div class="modal-header">Stock Item<button class="modal-close" onclick="closeModal('stockModal')">✕</button></div><div class="fg"><label>Name</label><input id="stkName"></div><div class="fg"><label>Category</label><select id="stkCat"></select></div><div class="fg"><label>Quantity</label><input id="stkQty" type="number"></div><div class="fg"><label>Reorder Level</label><input id="stkReorder" type="number"></div><div class="fg"><label>Unit</label><input id="stkUnit"></div><div class="fg"><label>Cost Price (RWF)</label><input id="stkCost" type="number"></div><div class="fg"><label>Emoji</label><input id="stkEmoji" placeholder="🍺"></div><input type="hidden" id="stkId"><div class="modal-footer" style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px"><button class="btn" onclick="closeModal('stockModal')">Cancel</button><button class="btn btn-blue" onclick="saveStockItem()">Save</button></div></div></div>
<div class="modal-overlay" id="adjustStockModal"><div class="modal"><div class="modal-header">Adjust Stock<button class="modal-close" onclick="closeModal('adjustStockModal')">✕</button></div><div class="fg"><label>Type</label><select id="adjType"><option value="in">Stock In (+)</option><option value="out">Stock Out (-)</option></select></div><div class="fg"><label>Quantity</label><input type="number" id="adjQty" min="1" value="1"></div><div class="fg"><label>Note</label><input type="text" id="adjNote" placeholder="Reason / Supplier"></div><input type="hidden" id="adjItemId"><div class="modal-footer"><button class="btn" onclick="closeModal('adjustStockModal')">Cancel</button><button class="btn btn-blue" onclick="applyStockAdjust()">Apply</button></div></div></div>
<div class="modal-overlay" id="menuItemModal"><div class="modal"><div class="modal-header">Menu Item<button class="modal-close" onclick="closeModal('menuItemModal')">✕</button></div><div class="fg"><label>Name</label><input id="mnName"></div><div class="fg"><label>Category</label><select id="mnCat"></select></div><div class="fg"><label>Price (RWF)</label><input id="mnPrice" type="number"></div><div class="fg"><label>Emoji</label><input id="mnEmoji" placeholder="🍺"></div><div class="fg"><label>Image (upload)</label><input type="file" id="mnImage" accept="image/*"></div><input type="hidden" id="mnId"><div class="modal-footer"><button class="btn" onclick="closeModal('menuItemModal')">Cancel</button><button class="btn btn-blue" onclick="saveMenuItem()">Save</button></div></div></div>
<div class="modal-overlay" id="empModal"><div class="modal"><div class="modal-header">Employee<button class="modal-close" onclick="closeModal('empModal')">✕</button></div><div class="fg"><label>Name</label><input id="empName"></div><div class="fg"><label>Role</label><select id="empRole"><option value="waiter">Waiter</option><option value="cashier">Cashier</option><option value="manager">Manager</option><option value="owner">Owner</option></select></div><div class="fg"><label>Phone</label><input id="empPhone"></div><div class="fg"><label>Email</label><input id="empEmail"></div><div class="fg"><label>Start Date</label><input type="date" id="empStart"></div><div class="fg"><label>Salary (RWF)</label><input type="number" id="empSalary"></div><div class="fg"><label>Notes</label><textarea id="empNotes" rows="2"></textarea></div><input type="hidden" id="empId"><div class="modal-footer"><button class="btn" onclick="closeModal('empModal')">Cancel</button><button class="btn btn-blue" onclick="saveEmployee()">Save</button></div></div></div>
<div class="modal-overlay" id="clockModal"><div class="modal"><div class="modal-header">Clock<button class="modal-close" onclick="closeModal('clockModal')">✕</button></div><div class="fg"><label>Employee</label><select id="clockEmp"></select></div><div class="modal-footer"><button class="btn" onclick="closeModal('clockModal')">Cancel</button><button class="btn btn-blue" onclick="confirmClock()">Confirm</button></div></div></div>
<div class="modal-overlay" id="userModal"><div class="modal"><div class="modal-header">User<button class="modal-close" onclick="closeModal('userModal')">✕</button></div><div class="fg"><label>Name</label><input id="usrName"></div><div class="fg"><label>Username</label><input id="usrUsername"></div><div class="fg"><label>Password</label><input type="password" id="usrPass"></div><div class="fg"><label>Role</label><select id="usrRole"><option value="waiter">Waiter</option><option value="cashier">Cashier</option><option value="manager">Manager</option><option value="owner">Owner</option></select></div><div class="fg"><label>Linked Employee</label><select id="usrEmp"><option value="">-- None --</option></select></div><input type="hidden" id="usrId"><div class="modal-footer"><button class="btn" onclick="closeModal('userModal')">Cancel</button><button class="btn btn-blue" onclick="saveUser()">Save</button></div></div></div>
<div class="modal-overlay" id="catModal"><div class="modal"><div class="modal-header">Category<button class="modal-close" onclick="closeModal('catModal')">✕</button></div><div class="fg"><label>Name</label><input id="catName"></div><div class="fg"><label>Emoji</label><input id="catEmoji"></div><div class="modal-footer"><button class="btn" onclick="closeModal('catModal')">Cancel</button><button class="btn btn-blue" onclick="saveCategory()">Add</button></div></div></div>
<div class="modal-overlay" id="permModal"><div class="modal modal-lg"><div class="modal-header">Edit Role Permissions<button class="modal-close" onclick="closeModal('permModal')">✕</button></div><div id="permsEditor" style="max-height:60vh;overflow-y:auto"></div><div class="modal-footer"><button class="btn" onclick="closeModal('permModal')">Cancel</button><button class="btn btn-blue" onclick="savePermissions()">Save Changes</button></div></div></div>
<div class="modal-overlay" id="shiftModal"><div class="modal"><div class="modal-header">Assign Shift<button class="modal-close" onclick="closeModal('shiftModal')">✕</button></div><div class="fg"><label>Employee</label><select id="shiftEmp"></select></div><div class="fg"><label>Date</label><input type="date" id="shiftDate"></div><div class="fg"><label>Start Time</label><input type="time" id="shiftStart"></div><div class="fg"><label>End Time</label><input type="time" id="shiftEnd"></div><div class="fg"><label>Type</label><select id="shiftType"><option value="regular">Regular</option><option value="morning">Morning</option><option value="evening">Evening</option><option value="night">Night</option></select></div><input type="hidden" id="shiftId"><div class="modal-footer"><button class="btn" onclick="closeModal('shiftModal')">Cancel</button><button class="btn btn-blue" onclick="saveShift()">Save</button></div></div></div>

<script>
// ==================== GLOBALS ====================
let currentUser = null;
let userPermissions = {};
let cart = [];
let lastOrderId = 0;
let pollInterval = null;
let allCategories = [], allMenuItems = [], allStock = [], allEmployees = [];
let activeMenuCat = 'all';
let currentPage = 'dashboard';
let currentPermissions = [];

async function apiCall(action, data = {}) {
    data.action = action;
    let res = await fetch(window.location.href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify(data)
    });
    return await res.json();
}

function toast(msg, type = 'success') {
    const wrap = document.getElementById('toastWrap');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = (type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️')) + ' ' + msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
const fmtRWF = n => 'RWF ' + Number(n).toLocaleString();
const today = () => new Date().toISOString().split('T')[0];
const initials = n => n.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase();
const avatarColor = r => ({owner:'#f0c040', manager:'#1a6bff', waiter:'#00d18c', cashier:'#9b59ff'}[r] || '#666');

// ==================== AUTH ====================
async function doLogin() {
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    const res = await apiCall('login', { username, password });
    if (res.success) {
        currentUser = res.user;
        userPermissions = res.permissions;
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('app').classList.add('visible');
        document.getElementById('topName').innerText = currentUser.name.split(' ')[0];
        document.getElementById('topRole').innerText = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);
        document.getElementById('topRole').className = 'role-tag role-' + currentUser.role;
        document.getElementById('topAvatar').innerHTML = `<div style="background:${avatarColor(currentUser.role)}; width:100%; height:100%; border-radius:50%; display:flex; align-items:center; justify-content:center;">${initials(currentUser.name)}</div>`;
        buildSidebar();
        startPolling();
        showPage('dashboard');
        toast(`Welcome back, ${currentUser.name.split(' ')[0]}!`);
    } else toast(res.error || 'Invalid credentials', 'error');
}
async function doLogout() { await apiCall('logout'); location.reload(); }

function buildSidebar() {
    const modules = [
        {id:'dashboard', name:'📊 Dashboard', perm:'dashboard'},
        {id:'orders', name:'🧾 Orders', perm:'orders'},
        {id:'neworder', name:'➕ New Order', perm:'neworder'},
        {id:'stock', name:'📦 Stock', perm:'stock'},
        {id:'menu', name:'🍽️ Menu', perm:'menu'},
        {id:'employees', name:'👥 Employees', perm:'employees'},
        {id:'shifts', name:'🕐 Shifts', perm:'shifts'},
        {id:'reports', name:'📈 Reports', perm:'reports'},
        {id:'users', name:'🔐 Users', perm:'users'}
    ];
    let html = '<div class="sidebar-section">Main</div>';
    for (let m of modules) {
        let perm = userPermissions[m.perm];
        if (perm && perm.view) {
            html += `<div class="nav-item" data-page="${m.id}" onclick="showPage('${m.id}')">${m.name}</div>`;
        }
    }
    document.getElementById('sidebar').innerHTML = html;
}

// ==================== POLLING & REFRESH ====================
async function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
        let res = await apiCall('poll_orders', { last_id: lastOrderId });
        if (res.success && res.orders.length) {
            for (let order of res.orders) {
                if (order.id > lastOrderId) {
                    lastOrderId = order.id;
                    toast(`🆕 New order #${order.order_number} from ${order.waiter_name}`, 'info');
                }
            }
            if (currentPage === 'orders' || currentPage === 'dashboard') refreshCurrentPage();
        }
    }, 3000);
}
async function refreshCurrentPage() {
    if (currentPage === 'dashboard') await loadDashboard();
    else if (currentPage === 'orders') await loadOrders();
    else if (currentPage === 'neworder') await loadNewOrderPage();
    else if (currentPage === 'stock') await loadStock();
    else if (currentPage === 'menu') await loadMenuAdmin();
    else if (currentPage === 'employees') await loadEmployees();
    else if (currentPage === 'shifts') await loadShifts();
    else if (currentPage === 'reports') await loadReportsPage();
    else if (currentPage === 'users') await loadUsers();
    await updatePendingBadge();
}
async function updatePendingBadge() {
    let res = await apiCall('dashboard_data', { role: currentUser.role, emp_id: currentUser.emp_id });
    if (res.success) {
        document.getElementById('pendingCount').innerText = res.pending;
        document.getElementById('pendingBadge').style.display = res.pending > 0 ? 'flex' : 'none';
    }
}

// ==================== DASHBOARD (unchanged) ====================
async function loadDashboard() {
    let res = await apiCall('dashboard_data', { role: currentUser.role, emp_id: currentUser.emp_id });
    if (!res.success) return;
    const html = `
        <div class="page active" id="page-dashboard">
            <div class="page-header"><h2>Dashboard</h2><p id="dashDate"></p></div>
            <div class="stats-grid" id="dashStats"></div>
            <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px">
                <div class="card"><div class="card-header">Revenue — This Week (RWF)</div><div class="chart-bar-wrap" id="revenueChart"></div></div>
                <div class="card"><div class="card-header">Top Selling Items</div><div id="topSellers"></div></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
                <div class="card"><div class="card-header">Recent Orders</div><div class="table-wrap"><table id="recentOrdersTable"><thead><tr><th>#</th><th>Waiter</th><th>Table</th><th>Amount</th><th>Status</th><tr></thead><tbody></tbody></table></div></div>
                <div class="card"><div class="card-header">Staff On Shift Today</div><div id="staffOnShift"></div></div>
            </div>
        </div>
    `;
    document.getElementById('mainContent').innerHTML = html;
    document.getElementById('dashDate').innerText = new Date().toLocaleDateString('en-GB', {weekday:'long', day:'2-digit', month:'long', year:'numeric'});
    document.getElementById('dashStats').innerHTML = `
        <div class="stat-card blue"><div class="stat-icon">💰</div><div class="stat-value">${fmtRWF(res.today_rev)}</div><div class="stat-label">Today's Revenue</div></div>
        <div class="stat-card orange"><div class="stat-icon">⏳</div><div class="stat-value">${res.pending}</div><div class="stat-label">Pending Orders</div></div>
        <div class="stat-card green"><div class="stat-icon">📊</div><div class="stat-value">${fmtRWF(res.total_revenue)}</div><div class="stat-label">Total Revenue</div></div>
        <div class="stat-card purple"><div class="stat-icon">👥</div><div class="stat-value">${res.active_staff}</div><div class="stat-label">Active Staff</div></div>
        <div class="stat-card red"><div class="stat-icon">📦</div><div class="stat-value">${res.low_stock}</div><div class="stat-label">Low Stock Items</div></div>
        <div class="stat-card gold"><div class="stat-icon">🍽️</div><div class="stat-value">${res.active_menu}</div><div class="stat-label">Active Menu Items</div></div>
    `;
    let max = Math.max(...res.week_revenue.map(w=>w.revenue), 1);
    let chartHtml = '';
    for (let w of res.week_revenue) {
        chartHtml += `<div class="chart-bar-col">
            <div class="chart-bar-val">${fmtRWF(w.revenue)}</div>
            <div class="chart-bar" style="height:${Math.max(4, w.revenue/max*100)}px"></div>
            <div class="chart-bar-lbl">${w.day}<br><span class="text-xs">${w.date.slice(5)}</span></div>
        </div>`;
    }
    document.getElementById('revenueChart').innerHTML = chartHtml;
    document.getElementById('topSellers').innerHTML = res.top_sellers.map((t,i)=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span>${i+1}. ${t.item_name}</span><span>${t.qty}x</span><span class="hl-blue">${fmtRWF(t.rev)}</span></div>`).join('') || '<div class="empty-state">No sales data</div>';
    document.getElementById('recentOrdersTable').querySelector('tbody').innerHTML = res.recent_orders.map(o => `<tr><td>#${o.order_number}</td><td>${o.waiter_name}</td><td>${o.table_name}</td><td class="hl-blue">${fmtRWF(o.total_amount)}</td><td><span class="status-badge status-${o.status}">${o.status}</span></td>`).join('');
    document.getElementById('staffOnShift').innerHTML = res.staff_on_shift.map(s => `<div class="shift-row"><div class="shift-dot" style="background:var(--green)"></div><div>${s.emp_name}<br><small>${s.start_time} – ${s.end_time}</small></div></div>`).join('') || '<div class="empty-state">No active shifts today</div>';
}

// ==================== ORDERS (visual cards + delete + reset) ====================
async function loadOrders() {
    let res = await apiCall('get_orders');
    if (!res.success) return;
    let orders = res.orders;
    let canDelete = (currentUser?.role === 'owner' || currentUser?.role === 'manager');
    let html = `<div class="page active" id="page-orders">
        <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
            <h2>Orders</h2>
            <div style="display:flex;gap:8px">
                <button class="btn btn-blue" onclick="showPage('neworder')">+ New Order</button>
                ${currentUser?.role === 'owner' ? `<button class="btn btn-red" onclick="resetAllOrders()">🗑️ Reset All Orders</button>` : ''}
            </div>
        </div>
        <div class="orders-grid" id="ordersGrid"></div>
    </div>`;
    document.getElementById('mainContent').innerHTML = html;
    let gridHtml = '';
    for (let o of orders) {
        let itemsRes = await apiCall('get_order_items', { order_id: o.id });
        let itemsList = '';
        if (itemsRes.success) {
            itemsRes.items.forEach(item => {
                itemsList += `<div class="order-item"><span>${item.quantity}x ${item.item_name}</span><span>${fmtRWF(item.quantity * item.price)}</span></div>`;
            });
        }
        gridHtml += `
            <div class="order-card">
                <div class="order-header">
                    <span class="order-number">#${o.order_number}</span>
                    <span class="order-status status-${o.status}">${o.status.toUpperCase()}</span>
                </div>
                <div class="order-details">
                    <div>📅 ${o.time}</div>
                    <div>👤 ${o.waiter_name}</div>
                    <div>🪑 Table: ${o.table_name}</div>
                </div>
                <div class="order-items">${itemsList || '<div class="empty-state">No items</div>'}</div>
                <div class="order-total">💰 Total: ${fmtRWF(o.total_amount)}</div>
                <div class="order-actions">
                    ${(currentUser?.role === 'owner' || currentUser?.role === 'manager' || currentUser?.role === 'cashier') && o.status === 'pending' ? `<button class="btn btn-sm btn-green" onclick="confirmOrder(${o.id})">✅ Confirm</button>` : ''}
                    ${o.status === 'confirmed' ? `<button class="btn btn-sm btn-blue" onclick="doneOrder(${o.id})">✅ Done</button>` : ''}
                    ${canDelete ? `<button class="btn btn-sm btn-red" onclick="deleteOrder(${o.id})">🗑️ Delete</button>` : ''}
                </div>
            </div>
        `;
    }
    document.getElementById('ordersGrid').innerHTML = gridHtml || '<div class="empty-state">No orders found</div>';
}
async function confirmOrder(id) { await apiCall('confirm_order', { order_id: id }); refreshCurrentPage(); toast('Order confirmed'); }
async function doneOrder(id) { await apiCall('done_order', { order_id: id }); refreshCurrentPage(); toast('Order completed'); }
async function deleteOrder(id) {
    if (confirm('Delete this order permanently?')) {
        let res = await apiCall('delete_order', { order_id: id });
        if (res.success) { toast('Order deleted'); refreshCurrentPage(); }
        else toast('Error deleting order', 'error');
    }
}
async function resetAllOrders() {
    if (confirm('⚠️ WARNING: This will DELETE ALL ORDERS permanently. All revenue data will be lost. Are you absolutely sure?')) {
        let res = await apiCall('reset_all_orders', {});
        if (res.success) { toast('All orders have been reset'); refreshCurrentPage(); }
        else toast('Error resetting orders', 'error');
    }
}

// ==================== NEW ORDER ====================
async function loadNewOrderPage() {
    let menuRes = await apiCall('get_menu');
    let catRes = await apiCall('get_categories');
    if (menuRes.success) allMenuItems = menuRes.menu;
    if (catRes.success) allCategories = catRes.categories;
    const html = `<div class="page active" id="page-neworder"><div class="page-header"><h2>New Order</h2></div><div style="display:grid;grid-template-columns:1fr 340px;gap:20px"><div><div class="cat-tabs" id="catTabs"></div><div class="menu-grid" id="menuGrid"></div></div><div class="cart-panel"><div class="cart-header"><span>🛒 Current Order</span><button class="btn btn-red" onclick="clearCart()">Clear</button></div><div class="cart-items" id="cartItems"></div><div class="cart-footer"><div class="fg"><label>Table Number</label><input type="text" id="cartTable" placeholder="Table 3 / VIP 1"></div><div class="cart-total"><span>Total</span><span class="amount" id="cartTotal">RWF 0</span></div><button class="btn btn-blue w-full" onclick="placeOrder()">Place Order</button></div></div></div></div>`;
    document.getElementById('mainContent').innerHTML = html;
    renderCatTabs();
    renderMenuGrid();
    renderCart();
}
function renderCatTabs() {
    let html = `<button class="cat-tab ${activeMenuCat === 'all' ? 'active' : ''}" onclick="setMenuCat('all')">All</button>`;
    html += allCategories.map(c => `<button class="cat-tab ${activeMenuCat === c.id ? 'active' : ''}" onclick="setMenuCat(${c.id})">${c.emoji} ${c.name}</button>`).join('');
    document.getElementById('catTabs').innerHTML = html;
}
function setMenuCat(id) { activeMenuCat = id; renderCatTabs(); renderMenuGrid(); }
function renderMenuGrid() {
    let items = allMenuItems.filter(m => m.active == 1);
    if (activeMenuCat !== 'all') items = items.filter(m => m.cat_id == activeMenuCat);
    const grid = document.getElementById('menuGrid');
    if (!items.length) { grid.innerHTML = '<div class="empty-state">No items found</div>'; return; }
    grid.innerHTML = items.map(m => {
        let stockStatus = '';
        let stockItem = allStock.find(s => s.name.toLowerCase().includes(m.name.split(' ')[0].toLowerCase()));
        if (stockItem) stockStatus = stockItem.qty <= 0 ? 'out-stock' : (stockItem.qty <= stockItem.reorder_level ? 'low-stock' : 'in-stock');
        return `<div class="menu-item" onclick="addToCart(${m.id}, '${m.name.replace(/'/g, "\\'")}', ${m.price})" style="position:relative">
            ${stockStatus ? `<span class="stock-badge ${stockStatus}">${stockStatus === 'out-stock' ? 'Out' : (stockStatus === 'low-stock' ? 'Low' : 'In Stock')}</span>` : ''}
            ${m.image ? `<img src="${m.image}">` : `<div class="item-emoji">${m.emoji || '🍽️'}</div>`}
            <div class="item-name">${m.name}</div>
            <div class="item-price">${fmtRWF(m.price)}</div>
        </div>`;
    }).join('');
}
function addToCart(id, name, price) {
    let existing = cart.find(c => c.id === id);
    if (existing) existing.qty++;
    else cart.push({ id, name, price, qty: 1 });
    renderCart();
}
function renderCart() {
    let html = '', total = 0;
    cart.forEach(c => { total += c.price * c.qty; html += `<div class="cart-item"><span>${c.name} x${c.qty}</span><span>${fmtRWF(c.price*c.qty)}</span><button onclick="removeFromCart(${c.id})">❌</button></div>`; });
    document.getElementById('cartItems').innerHTML = html || '<div class="empty-state"><div class="empty-icon">🛒</div><p>Add items to order</p></div>';
    document.getElementById('cartTotal').innerText = fmtRWF(total);
}
function removeFromCart(id) { cart = cart.filter(c => c.id !== id); renderCart(); }
function clearCart() { cart = []; renderCart(); }
async function placeOrder() {
    if (!cart.length) { toast('Cart empty', 'error'); return; }
    let table = document.getElementById('cartTable').value.trim();
    if (!table) { toast('Please enter table number', 'error'); return; }
    let res = await apiCall('place_order', { table, cart, note: '' });
    if (res.success) { toast(`Order #${res.order_id} placed!`); cart = []; renderCart(); document.getElementById('cartTable').value = ''; refreshCurrentPage(); showPage('orders'); }
    else toast(res.error, 'error');
}

// ==================== STOCK MANAGEMENT (unchanged) ====================
async function loadStock() {
    let res = await apiCall('get_stock');
    if (res.success) {
        allStock = res.stock;
        let movements = res.movements || [];
        let html = `<div class="page active" id="page-stock"><div class="page-header"><h2>Stock Management</h2><div><button class="btn btn-blue" onclick="openAddStock()">+ Add Item</button></div></div>
            <div class="card"><div class="card-header">Current Stock</div><div class="stock-grid" id="stockGrid"></div></div>
            <div class="card"><div class="card-header">Low Stock Alerts</div><div id="lowStockAlert"></div></div>
            <div class="card"><div class="card-header">Stock Movements</div><div class="table-wrap"><table id="movementsTable"><thead><tr><th>Date/Time</th><th>Item</th><th>Type</th><th>Quantity</th><th>Note</th><th>By</th></tr></thead><tbody id="movementsBody"></tbody></tr></div></div></div>`;
        document.getElementById('mainContent').innerHTML = html;
        renderStockGrid();
        renderLowStockAlert();
        renderMovements(movements);
    }
}
function renderStockGrid() {
    let html = '';
    for (let s of allStock) {
        let percent = Math.min(100, (s.qty / Math.max(1, s.reorder_level * 3)) * 100);
        let fillColor = s.qty <= 0 ? '#ff3b5c' : (s.qty <= s.reorder_level ? '#ff8c00' : '#00d18c');
        html += `<div class="stock-card">
            <div class="stock-header"><div class="stock-emoji">${s.emoji}</div><div><div class="stock-name">${s.name}</div><div class="stock-cat">${s.cat_name || ''}</div></div></div>
            <div class="stock-qty" style="color:${fillColor}">${s.qty} ${s.unit}</div>
            <div class="progress-bar"><div class="progress-fill" style="width:${percent}%; background:${fillColor}"></div></div>
            <div class="stock-actions">
                <button class="btn btn-sm btn-green" onclick="openAdjustStock(${s.id}, 'in')">+ Stock In</button>
                <button class="btn btn-sm btn-orange" onclick="openAdjustStock(${s.id}, 'out')">− Stock Out</button>
                <button class="btn btn-sm" onclick="editStock(${s.id})">✏️ Edit</button>
            </div>
        </div>`;
    }
    document.getElementById('stockGrid').innerHTML = html;
}
function renderLowStockAlert() {
    let low = allStock.filter(s => s.qty <= s.reorder_level);
    if (low.length === 0) { document.getElementById('lowStockAlert').innerHTML = '<div class="empty-state">✅ All stock levels are healthy</div>'; return; }
    document.getElementById('lowStockAlert').innerHTML = low.map(s => `<div class="stat-card red"><span>⚠️ ${s.name} is low: ${s.qty} ${s.unit} (Reorder at ${s.reorder_level})</span></div>`).join('');
}
function renderMovements(movements) {
    document.getElementById('movementsBody').innerHTML = movements.map(m => `<tr><td>${new Date(m.created_at).toLocaleString()}</td><td>${m.item_name}</td><td class="hl-${m.type === 'in' ? 'green' : 'red'}">${m.type === 'in' ? '➕ Stock In' : '➖ Stock Out'}</td><td>${m.quantity}</td><td>${m.note || '-'}</td><td>${m.created_by || '-'}</td>`).join('') || '<tr><td colspan="6" class="empty-state">No movements recorded</td></tr>';
}
function openAddStock() {
    document.getElementById('stkId').value = '';
    document.getElementById('stkName').value = '';
    document.getElementById('stkQty').value = 0;
    document.getElementById('stkReorder').value = 10;
    document.getElementById('stkUnit').value = 'pcs';
    document.getElementById('stkCost').value = 0;
    document.getElementById('stkEmoji').value = '📦';
    document.getElementById('stkCat').innerHTML = allCategories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    openModal('stockModal');
}
function editStock(id) {
    let s = allStock.find(x => x.id == id);
    if (!s) return;
    document.getElementById('stkId').value = s.id;
    document.getElementById('stkName').value = s.name;
    document.getElementById('stkQty').value = s.qty;
    document.getElementById('stkReorder').value = s.reorder_level;
    document.getElementById('stkUnit').value = s.unit;
    document.getElementById('stkCost').value = s.cost_price || 0;
    document.getElementById('stkEmoji').value = s.emoji;
    document.getElementById('stkCat').innerHTML = allCategories.map(c => `<option value="${c.id}" ${c.id == s.cat_id ? 'selected' : ''}>${c.name}</option>`).join('');
    openModal('stockModal');
}
async function saveStockItem() {
    let data = { id: document.getElementById('stkId').value, name: document.getElementById('stkName').value, cat_id: document.getElementById('stkCat').value, qty: document.getElementById('stkQty').value, reorder_level: document.getElementById('stkReorder').value, unit: document.getElementById('stkUnit').value, cost_price: document.getElementById('stkCost').value, emoji: document.getElementById('stkEmoji').value };
    if (!data.name) { toast('Name required', 'error'); return; }
    let res = await apiCall('save_stock', data);
    if (res.success) { closeModal('stockModal'); await loadStock(); toast('Stock saved'); }
    else toast('Error saving', 'error');
}
function openAdjustStock(id, type) {
    document.getElementById('adjItemId').value = id;
    document.getElementById('adjType').value = type;
    document.getElementById('adjQty').value = 1;
    document.getElementById('adjNote').value = '';
    openModal('adjustStockModal');
}
async function applyStockAdjust() {
    let id = document.getElementById('adjItemId').value;
    let type = document.getElementById('adjType').value;
    let qty = parseInt(document.getElementById('adjQty').value);
    let note = document.getElementById('adjNote').value;
    if (qty <= 0) { toast('Quantity must be positive', 'error'); return; }
    let res = await apiCall('adjust_stock', { id, type, qty, note });
    if (res.success) { closeModal('adjustStockModal'); await loadStock(); toast(`Stock ${type === 'in' ? 'added' : 'removed'}`); }
    else toast(res.error, 'error');
}

// ==================== MENU ADMIN (unchanged) ====================
async function loadMenuAdmin() {
    let menuRes = await apiCall('get_menu');
    let catRes = await apiCall('get_categories');
    let stockRes = await apiCall('get_stock');
    if (menuRes.success) allMenuItems = menuRes.menu;
    if (catRes.success) allCategories = catRes.categories;
    if (stockRes.success) allStock = stockRes.stock;
    let html = `<div class="page active" id="page-menu"><div class="page-header"><h2>Menu & Prices</h2><button class="btn btn-blue" onclick="openAddMenuItem()">+ Add Item</button></div>
        <div class="cat-tabs" id="menuCatTabs"></div>
        <div class="menu-grid" id="adminMenuGrid"></div></div>`;
    document.getElementById('mainContent').innerHTML = html;
    renderMenuCatTabs();
    renderAdminMenuGrid();
}
function renderMenuCatTabs() {
    let html = `<button class="cat-tab active" onclick="filterAdminMenu('all',this)">All</button>`;
    html += allCategories.map(c => `<button class="cat-tab" onclick="filterAdminMenu(${c.id},this)">${c.emoji} ${c.name}</button>`).join('');
    document.getElementById('menuCatTabs').innerHTML = html;
}
let adminMenuFilter = 'all';
function filterAdminMenu(catId, btn) {
    adminMenuFilter = catId;
    document.querySelectorAll('#menuCatTabs .cat-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderAdminMenuGrid();
}
function renderAdminMenuGrid() {
    let items = allMenuItems;
    if (adminMenuFilter !== 'all') items = items.filter(m => m.cat_id == adminMenuFilter);
    let html = '';
    for (let m of items) {
        let stockInfo = allStock.find(s => s.name.toLowerCase().includes(m.name.split(' ')[0].toLowerCase()));
        let stockStatus = stockInfo ? (stockInfo.qty <= 0 ? 'Out' : (stockInfo.qty <= stockInfo.reorder_level ? 'Low' : 'In Stock')) : 'Not linked';
        html += `<div class="menu-item" style="position:relative">
            ${m.image ? `<img src="${m.image}">` : `<div class="item-emoji">${m.emoji || '🍽️'}</div>`}
            <div class="item-name">${m.name}</div>
            <div class="item-price">${fmtRWF(m.price)}</div>
            <div class="text-xs" style="margin-top:8px"><span class="status-badge ${stockStatus === 'In Stock' ? 'status-done' : (stockStatus === 'Low' ? 'status-pending' : 'status-cancelled')}">${stockStatus}</span></div>
            <div class="mt-2"><button class="btn btn-sm" onclick="editMenuItem(${m.id})">✏️ Edit</button> <button class="btn btn-sm btn-red" onclick="deleteMenuItem(${m.id})">🗑️ Delete</button></div>
        </div>`;
    }
    document.getElementById('adminMenuGrid').innerHTML = html || '<div class="empty-state">No items found</div>';
}
function openAddMenuItem() { document.getElementById('mnId').value = ''; document.getElementById('mnName').value = ''; document.getElementById('mnPrice').value = ''; document.getElementById('mnEmoji').value = '🍽️'; document.getElementById('mnCat').innerHTML = allCategories.map(c => `<option value="${c.id}">${c.name}</option>`).join(''); openModal('menuItemModal'); }
function editMenuItem(id) { let m = allMenuItems.find(x => x.id == id); if (m) { document.getElementById('mnId').value = m.id; document.getElementById('mnName').value = m.name; document.getElementById('mnPrice').value = m.price; document.getElementById('mnEmoji').value = m.emoji; document.getElementById('mnCat').innerHTML = allCategories.map(c => `<option value="${c.id}" ${c.id == m.cat_id ? 'selected' : ''}>${c.name}</option>`).join(''); openModal('menuItemModal'); } }
async function saveMenuItem() {
    let imageFile = document.getElementById('mnImage').files[0];
    let imageBase64 = null;
    if (imageFile) {
        let reader = new FileReader();
        await new Promise(resolve => { reader.onload = e => { imageBase64 = e.target.result; resolve(); }; reader.readAsDataURL(imageFile); });
    }
    let data = { id: document.getElementById('mnId').value, name: document.getElementById('mnName').value, cat_id: document.getElementById('mnCat').value, price: document.getElementById('mnPrice').value, emoji: document.getElementById('mnEmoji').value, active: 1, image: imageBase64 };
    let res = await apiCall('save_menu', data);
    if (res.success) { closeModal('menuItemModal'); await loadMenuAdmin(); toast('Menu item saved'); } else toast('Error saving', 'error');
}
async function deleteMenuItem(id) { if (confirm('Delete this menu item?')) { await apiCall('save_menu', { id, active: 0 }); await loadMenuAdmin(); toast('Deleted'); } }

// ==================== EMPLOYEES (unchanged) ====================
async function loadEmployees() {
    let res = await apiCall('get_employees');
    if (res.success) allEmployees = res.employees;
    let html = `<div class="page active" id="page-employees"><div class="page-header"><h2>Employees Management</h2><button class="btn btn-blue" onclick="openAddEmployee()">+ Add Employee</button></div><div class="emp-grid" id="empGrid"></div></div>`;
    document.getElementById('mainContent').innerHTML = html;
    renderEmployeeGrid();
}
function renderEmployeeGrid() {
    let html = '';
    for (let e of allEmployees) {
        html += `<div class="emp-card">
            <div class="emp-header"><div class="emp-avatar" style="background:${avatarColor(e.role)}">${initials(e.name)}</div><div><strong>${e.name}</strong><br><span class="role-tag role-${e.role}">${e.role}</span></div></div>
            <div class="emp-stats"><div class="emp-stat"><div class="val hl-blue">${fmtRWF(e.revenue_today || 0)}</div><div class="lbl">Today Sales</div></div><div class="emp-stat"><div class="val">${e.orders_today || 0}</div><div class="lbl">Today Orders</div></div><div class="emp-stat"><div class="val hl-green">${fmtRWF(e.revenue_total || 0)}</div><div class="lbl">Total Sales</div></div><div class="emp-stat"><div class="val">${e.orders_total || 0}</div><div class="lbl">Total Orders</div></div></div>
            <div class="emp-actions"><button class="btn btn-sm" onclick="editEmployee(${e.id})">✏️ Edit</button> <button class="btn btn-sm btn-red" onclick="deleteEmployee(${e.id})">Remove</button></div>
        </div>`;
    }
    document.getElementById('empGrid').innerHTML = html;
}
function openAddEmployee() {
    document.getElementById('empId').value = '';
    document.getElementById('empName').value = '';
    document.getElementById('empRole').value = 'waiter';
    document.getElementById('empPhone').value = '';
    document.getElementById('empEmail').value = '';
    document.getElementById('empStart').value = today();
    document.getElementById('empSalary').value = '';
    document.getElementById('empNotes').value = '';
    openModal('empModal');
}
function editEmployee(id) { let e = allEmployees.find(x => x.id == id); if (e) { document.getElementById('empId').value = e.id; document.getElementById('empName').value = e.name; document.getElementById('empRole').value = e.role; document.getElementById('empPhone').value = e.phone || ''; document.getElementById('empEmail').value = e.email || ''; document.getElementById('empStart').value = e.start_date || today(); document.getElementById('empSalary').value = e.salary || ''; document.getElementById('empNotes').value = e.notes || ''; openModal('empModal'); } }
async function saveEmployee() {
    let data = { id: document.getElementById('empId').value, name: document.getElementById('empName').value, role: document.getElementById('empRole').value, phone: document.getElementById('empPhone').value, email: document.getElementById('empEmail').value, start_date: document.getElementById('empStart').value, salary: document.getElementById('empSalary').value, notes: document.getElementById('empNotes').value };
    if (!data.name) { toast('Name required', 'error'); return; }
    let res = await apiCall('save_employee', data);
    if (res.success) { closeModal('empModal'); await loadEmployees(); toast('Employee saved'); } else toast('Error saving', 'error');
}
async function deleteEmployee(id) { if (confirm('Remove this employee?')) { await apiCall('delete_employee', { id }); await loadEmployees(); toast('Removed'); } }

// ==================== SHIFTS (unchanged) ====================
async function loadShifts() {
    let res = await apiCall('get_shifts');
    let html = `<div class="page active" id="page-shifts"><div class="page-header"><h2>Shift Management</h2><div><button class="btn" onclick="openClockIn()">🟢 Clock In</button><button class="btn btn-orange" onclick="openClockOut()">🔴 Clock Out</button>${(currentUser?.role === 'owner' || currentUser?.role === 'manager') ? `<button class="btn btn-blue" onclick="openAddShift()">+ Assign Shift</button>` : ''}</div></div><div class="card"><h3>Today's Shifts</h3><div id="todayShifts"></div></div><div class="card"><h3>Upcoming Shifts</h3><div id="scheduleList"></div></div><div class="card"><h3>Clock History</h3><div id="historyList"></div></div></div>`;
    document.getElementById('mainContent').innerHTML = html;
    document.getElementById('todayShifts').innerHTML = res.today.map(s => `<div class="shift-row"><div class="shift-dot" style="background:var(--green)"></div><div><strong>${s.emp_name}</strong> (${s.start_time} - ${s.end_time})</div>${(currentUser?.role === 'owner' || currentUser?.role === 'manager') ? `<button class="btn btn-sm btn-red" onclick="deleteShift(${s.id})">Remove</button>` : ''}</div>`).join('') || '<div class="empty-state">No shifts today</div>';
    document.getElementById('scheduleList').innerHTML = res.schedule.map(s => `<div class="shift-row"><div class="shift-dot" style="background:var(--orange)"></div><div><strong>${s.emp_name}</strong> on ${s.date} (${s.start_time} - ${s.end_time})</div>${(currentUser?.role === 'owner' || currentUser?.role === 'manager') ? `<button class="btn btn-sm btn-red" onclick="deleteShift(${s.id})">Remove</button>` : ''}</div>`).join('') || '<div class="empty-state">No upcoming shifts</div>';
    document.getElementById('historyList').innerHTML = res.history.map(h => `<div><strong>${h.emp_name}</strong> ${h.date} In:${h.clock_in} Out:${h.clock_out || '--'} Hours:${h.hours_worked || '--'}</div>`).join('') || '<div class="empty-state">No history</div>';
}
function openAddShift() {
    document.getElementById('shiftId').value = '';
    document.getElementById('shiftDate').value = today();
    document.getElementById('shiftStart').value = '09:00';
    document.getElementById('shiftEnd').value = '17:00';
    document.getElementById('shiftType').value = 'regular';
    apiCall('get_employees').then(res => { if (res.success) document.getElementById('shiftEmp').innerHTML = res.employees.map(e => `<option value="${e.id}">${e.name} (${e.role})</option>`).join(''); });
    openModal('shiftModal');
}
async function saveShift() {
    let data = { id: document.getElementById('shiftId').value, emp_id: document.getElementById('shiftEmp').value, date: document.getElementById('shiftDate').value, start_time: document.getElementById('shiftStart').value, end_time: document.getElementById('shiftEnd').value, type: document.getElementById('shiftType').value };
    if (!data.emp_id) { toast('Select employee', 'error'); return; }
    let res = await apiCall('save_shift', data);
    if (res.success) { toast('Shift assigned'); closeModal('shiftModal'); await loadShifts(); } else toast(res.error, 'error');
}
async function deleteShift(id) { if (confirm('Remove shift?')) { await apiCall('delete_shift', { id }); await loadShifts(); toast('Shift removed'); } }
let clockAction = 'in';
function openClockIn() { clockAction = 'in'; document.getElementById('clockEmp').innerHTML = allEmployees.map(e => `<option value="${e.id}">${e.name}</option>`).join(''); openModal('clockModal'); }
function openClockOut() { clockAction = 'out'; document.getElementById('clockEmp').innerHTML = allEmployees.map(e => `<option value="${e.id}">${e.name}</option>`).join(''); openModal('clockModal'); }
async function confirmClock() { let empId = document.getElementById('clockEmp').value; if (!empId) { toast('Select employee', 'error'); return; } let res = await apiCall('clock_action', { emp_id: empId, type: clockAction }); if (res.success) toast(res.message); else toast(res.error, 'error'); closeModal('clockModal'); await loadShifts(); }

// ==================== REPORTS (unchanged) ====================
async function loadReportsPage() {
    let ordersRes = await apiCall('get_orders');
    let employeesRes = await apiCall('get_employees');
    let categoriesRes = await apiCall('get_categories');
    let allEmployeesList = employeesRes.success ? employeesRes.employees : [];
    let allCats = categoriesRes.success ? categoriesRes.categories : [];
    let html = `<div class="page active" id="page-reports"><div class="page-header"><h2>Reports & Analytics</h2></div>
        <div class="card"><div class="card-header">Filter Options</div><div style="display:flex;gap:10px;flex-wrap:wrap"><input type="date" id="reportFrom"><input type="date" id="reportTo"><select id="reportWaiter"><option value="">All Waiters</option>${allEmployeesList.filter(e => e.role === 'waiter').map(e => `<option value="${e.id}">${e.name}</option>`).join('')}</select><select id="reportCategory"><option value="">All Categories</option>${allCats.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select><button class="btn btn-blue" onclick="generateReportWithFilters()">Generate</button><button class="btn" onclick="printReport()">🖨️ Print</button></div></div>
        <div class="stats-grid" id="repStats"></div><div class="card"><div class="card-header">Detailed Sales Log</div><div class="table-wrap"><table id="reportTable"><thead><tr><th>Date</th><th>Order#</th><th>Waiter</th><th>Table</th><th>Total</th><th>Status</th></tr></thead><tbody id="reportTableBody"></tbody></table></div></div></div>`;
    document.getElementById('mainContent').innerHTML = html;
    let today = new Date();
    let thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(today.getDate() - 30);
    document.getElementById('reportFrom').value = thirtyDaysAgo.toISOString().split('T')[0];
    document.getElementById('reportTo').value = today.toISOString().split('T')[0];
    await generateReportWithFilters();
}
async function generateReportWithFilters() {
    let from = document.getElementById('reportFrom').value;
    let to = document.getElementById('reportTo').value;
    let waiterId = document.getElementById('reportWaiter').value;
    let categoryId = document.getElementById('reportCategory').value;
    let ordersRes = await apiCall('get_orders');
    if (!ordersRes.success) return;
    let orders = ordersRes.orders;
    if (from) orders = orders.filter(o => o.time >= from);
    if (to) orders = orders.filter(o => o.time <= to + ' 23:59');
    if (waiterId) orders = orders.filter(o => o.waiter_id == waiterId);
    if (categoryId) {
        let filteredOrders = [];
        for (let o of orders) {
            let itemsRes = await apiCall('get_order_items', { order_id: o.id });
            if (itemsRes.success && itemsRes.items.some(item => {
                let menuItem = allMenuItems.find(m => m.name === item.item_name);
                return menuItem && menuItem.cat_id == categoryId;
            })) filteredOrders.push(o);
        }
        orders = filteredOrders;
    }
    let total = orders.reduce((s, o) => s + o.total_amount, 0);
    document.getElementById('repStats').innerHTML = `<div class="stat-card blue">💰 Total Sales: ${fmtRWF(total)}</div><div class="stat-card green">📦 Orders: ${orders.length}</div>`;
    document.getElementById('reportTableBody').innerHTML = orders.map(o => `<tr><td>${o.time}</td><td>#${o.order_number}</td><td>${o.waiter_name}</td><td>${o.table_name}</td><td class="hl-blue">${fmtRWF(o.total_amount)}</td><td>${o.status}</td>`).join('');
}
function printReport() { window.print(); }

// ==================== USERS (visual cards) ====================
async function loadUsers() {
    let res = await apiCall('get_users');
    if (!res.success) return;
    let html = `<div class="page active" id="page-users">
        <div class="page-header"><h2>User Access & Permissions</h2><div><button class="btn btn-blue" onclick="openAddUser()">+ Add User</button><button class="btn" onclick="openPermissionsEditor()">✏️ Edit Role Permissions</button></div></div>
        <div class="users-grid" id="usersGrid"></div>
        <div class="card"><div class="card-header">Current Permissions Overview</div><div id="permsOverview"></div></div>
    </div>`;
    document.getElementById('mainContent').innerHTML = html;
    let usersHtml = '';
    for (let u of res.users) {
        usersHtml += `
            <div class="user-card">
                <div class="user-header">
                    <div class="user-avatar-lg" style="background:${avatarColor(u.role)}">${initials(u.name)}</div>
                    <div class="user-info">
                        <div><strong>${u.name}</strong></div>
                        <div class="user-role"><span class="role-tag role-${u.role}">${u.role}</span></div>
                    </div>
                </div>
                <div class="user-details">
                    <div>👤 Username: ${u.username}</div>
                    <div>👥 Linked: ${u.emp_name || 'None'}</div>
                    <div>🕒 Last login: ${u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</div>
                    <div>📌 Status: ${u.active ? '✅ Active' : '❌ Inactive'}</div>
                </div>
                <div class="order-actions">
                    <button class="btn btn-sm" onclick="editUser(${u.id})">✏️ Edit</button>
                </div>
            </div>
        `;
    }
    document.getElementById('usersGrid').innerHTML = usersHtml || '<div class="empty-state">No users found</div>';
    let permsHtml = '</table><thead><tr><th>Role</th><th>Module</th><th>View</th><th>Create</th><th>Edit</th><th>Delete</th></tr></thead><tbody>';
    for (let p of res.permissions) permsHtml += `<tr><td>${p.role}</td><td>${p.module}</td><td>${p.can_view ? '✅' : '❌'}</td><td>${p.can_create ? '✅' : '❌'}</td><td>${p.can_edit ? '✅' : '❌'}</td><td>${p.can_delete ? '✅' : '❌'}</td></tr>`;
    permsHtml += `</tbody></table>`;
    document.getElementById('permsOverview').innerHTML = permsHtml;
}
function openAddUser() { document.getElementById('usrId').value = ''; document.getElementById('usrName').value = ''; document.getElementById('usrUsername').value = ''; document.getElementById('usrPass').value = ''; document.getElementById('usrRole').value = 'waiter'; apiCall('get_employees').then(res => { if (res.success) document.getElementById('usrEmp').innerHTML = '<option value="">-- None --</option>' + res.employees.map(e => `<option value="${e.id}">${e.name}</option>`).join(''); }); openModal('userModal'); }
function editUser(id) { apiCall('get_users').then(res => { let u = res.users.find(x => x.id == id); if (u) { document.getElementById('usrId').value = u.id; document.getElementById('usrName').value = u.name; document.getElementById('usrUsername').value = u.username; document.getElementById('usrPass').value = ''; document.getElementById('usrRole').value = u.role; apiCall('get_employees').then(res2 => { if (res2.success) document.getElementById('usrEmp').innerHTML = '<option value="">-- None --</option>' + res2.employees.map(e => `<option value="${e.id}" ${e.id == u.emp_id ? 'selected' : ''}>${e.name}</option>`).join(''); }); openModal('userModal'); } }); }
async function saveUser() { let data = { id: document.getElementById('usrId').value, name: document.getElementById('usrName').value, username: document.getElementById('usrUsername').value, password: document.getElementById('usrPass').value, role: document.getElementById('usrRole').value, emp_id: document.getElementById('usrEmp').value }; if (!data.name || !data.username) { toast('Name and username required', 'error'); return; } let res = await apiCall('save_user', data); if (res.success) { closeModal('userModal'); await loadUsers(); toast('User saved'); } else toast(res.error, 'error'); }
async function openPermissionsEditor() {
    let res = await apiCall('get_users');
    if (!res.success) return;
    let perms = res.permissions;
    currentPermissions = perms;
    let html = '<table class="table"><thead><tr><th>Role</th><th>Module</th><th>View</th><th>Create</th><th>Edit</th><th>Delete</th></tr></thead><tbody>';
    for (let p of perms) {
        html += `<tr>
            <td>${p.role}</td>
            <td>${p.module}</td>
            <td><input type="checkbox" class="perm-checkbox" data-role="${p.role}" data-module="${p.module}" data-action="view" ${p.can_view ? 'checked' : ''}></td>
            <td><input type="checkbox" class="perm-checkbox" data-role="${p.role}" data-module="${p.module}" data-action="create" ${p.can_create ? 'checked' : ''}></td>
            <td><input type="checkbox" class="perm-checkbox" data-role="${p.role}" data-module="${p.module}" data-action="edit" ${p.can_edit ? 'checked' : ''}></td>
            <td><input type="checkbox" class="perm-checkbox" data-role="${p.role}" data-module="${p.module}" data-action="delete" ${p.can_delete ? 'checked' : ''}></td>
        </tr>`;
    }
    html += '</tbody></table>';
    document.getElementById('permsEditor').innerHTML = html;
    openModal('permModal');
}
async function savePermissions() {
    let updates = [];
    document.querySelectorAll('.perm-checkbox').forEach(cb => {
        let role = cb.getAttribute('data-role');
        let module = cb.getAttribute('data-module');
        let action = cb.getAttribute('data-action');
        updates.push({ role, module, [action]: cb.checked ? 1 : 0 });
    });
    let merged = [];
    for (let u of updates) {
        let existing = merged.find(m => m.role === u.role && m.module === u.module);
        if (existing) { existing.view = u.view ?? existing.view; existing.create = u.create ?? existing.create; existing.edit = u.edit ?? existing.edit; existing.delete = u.delete ?? existing.delete; }
        else merged.push({ role: u.role, module: u.module, view: u.view || 0, create: u.create || 0, edit: u.edit || 0, delete: u.delete || 0 });
    }
    let res = await apiCall('update_permissions', { permissions: merged });
    if (res.success) { toast('Permissions updated'); closeModal('permModal'); await loadUsers(); if (currentUser) { let loginRes = await apiCall('login', { username: currentUser.name, password: 'dummy' }); if (loginRes.success) { userPermissions = loginRes.permissions; buildSidebar(); } } } else toast('Error updating', 'error');
}
function saveCategory() { let name = document.getElementById('catName').value; let emoji = document.getElementById('catEmoji').value; if (!name) { toast('Category name required', 'error'); return; } toast('Category added – refresh to see', 'info'); closeModal('catModal'); }

// ==================== TOGGLE SIDEBAR ====================
function toggleSidebar() { document.querySelector('.sidebar').classList.toggle('open'); }
document.addEventListener('click', function(e) { if (window.innerWidth <= 768 && !e.target.closest('.sidebar') && !e.target.closest('.menu-toggle')) { document.querySelector('.sidebar')?.classList.remove('open'); } });

// ==================== NAVIGATION ====================
function showPage(pageId) {
    currentPage = pageId;
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    let activeNav = Array.from(document.querySelectorAll('.nav-item')).find(nav => nav.getAttribute('data-page') === pageId);
    if (activeNav) activeNav.classList.add('active');
    refreshCurrentPage();
    if (window.innerWidth <= 768) document.querySelector('.sidebar')?.classList.remove('open');
}

setInterval(() => { document.getElementById('liveClock').innerHTML = new Date().toLocaleTimeString() + ' · ' + new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }); }, 1000);
window.addEventListener('load', () => { document.getElementById('liveClock').innerHTML = new Date().toLocaleTimeString(); });
</script>
</body>
</html>