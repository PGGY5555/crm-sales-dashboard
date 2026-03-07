# Schema Mapping for Customer & Order Management

## Customer Management - Field Mapping

### X-axis (text search):
- 顧客姓名 → customers.name
- 顧客手機 → customers.phone
- 顧客信箱 → customers.email
- 收件人姓名 → orders.rawData (need to check) or separate field needed
- 收件人手機 → orders.rawData
- 收件人信箱 → orders.rawData

### Y-axis (condition filters):
- 註冊日期區間 → customers.registeredAt
- 生日月份 → customers.rawData (need to check)
- 顧客標籤 → customers.rawData (need to check)
- 會員等級 → customers.rawData (need to check)
- 持有購物金 → customers.rawData (need to check)
- 累積消費金額 → customers.totalSpent
- 累積消費次數 → customers.totalOrders
- 最後購買日期區間 → need to compute from orders
- 最後消費金額 → need to compute from orders
- 最後出貨日期區間 → customers.lastShipmentAt
- 生命週期分類 → customers.lifecycle

## Order Management - Field Mapping

### X-axis (text search):
- 訂單編號 → orders.externalId
- 顧客姓名 → orders.customerName
- 顧客手機 → orders.customerPhone
- 顧客信箱 → orders.customerEmail
- 收件人姓名 → orders.rawData
- 收件人手機 → orders.rawData
- 收件人信箱 → orders.rawData

### Y-axis (condition filters):
- 訂單來源 → orders.rawData (need to check)
- 付款方式 → orders.rawData
- 配送方式 → orders.rawData
- 收貨地址 → orders.rawData
- 出貨日期區間 → orders.shippedAt

## Missing columns - need to add to schema:
- customers: birthday, tags, memberLevel, credits (購物金)
- customers: lastPurchaseDate, lastPurchaseAmount (can compute from orders)
- orders: recipientName, recipientPhone, recipientEmail, orderSource, paymentMethod, shippingMethod, shippingAddress
